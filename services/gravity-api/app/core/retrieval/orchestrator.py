"""
Gravity Search — Retrieval Orchestrator
Dispatches parallel search requests across all 5 retrieval channels using asyncio.gather().
Target: <80ms total retrieval across all channels.

Architecture:
  Orchestrator
    ├─ asyncio.gather() ─┬─ Dense Search (Qdrant)      ~30ms
    │                    ├─ Sparse Search (ES BM25)     ~30ms
    │                    ├─ SPLADE Search (Qdrant)      ~30ms
    │                    ├─ Graph Search (Neo4j)        ~40ms
    │                    ├─ Structured Search (PG)      ~20ms
    │                    ├─ PageIndex Search (VectifyAI) ~variable
    │                    ├─ TurboQuant Search (in-mem)  ~10ms
    │                    ├─ GDELT Search (HTTP)         ~500ms
    │                    └─ MCP Search (FactSet/CapIQ)  ~2-10s
    └─ Returns: dict[channel_name → list[RetrievalResult]]
"""

import asyncio
import time
from typing import Any

import structlog

from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()


async def _gdelt_to_results(gdelt_client, query: str) -> list[RetrievalResult]:
    """Fetch GDELT articles and convert to RetrievalResult objects."""
    articles = await gdelt_client.search_articles(query=query, max_records=10)
    results = []
    for art in articles:
        text = art.get("snippet", art.get("title", ""))
        if not text:
            continue
        url = art.get("url", "")
        results.append(RetrievalResult(
            document_id=url,
            chunk_id=url,
            text=text,
            score=float(art.get("score", 0.6)),
            document_title=art.get("title", ""),
            document_type="news",
            source_quality=4,  # news < SEC filings in authority scoring
            metadata={
                "title": art.get("title", ""),
                "url": url,
                "source_url": url,
                "published_date": art.get("seendate", ""),
                "domain": art.get("domain", ""),
                "language": art.get("language", "English"),
                "filing_type": "news",
            },
        ))
    return results


class RetrievalOrchestrator:
    """Parallel dispatch to all search backends with graceful degradation."""

    def __init__(
        self,
        dense_search=None,
        sparse_search=None,
        splade_search=None,
        graph_search=None,
        structured_search=None,
        page_index_search=None,   # Channel 6: VectifyAI PageIndex (optional)
        turbo_quant_search=None,  # Channel 7: TurboQuant compressed ANN (optional)
        gdelt_search=None,        # Channel 8: GDELT global news (free, no key)
        mcp_search=None,          # Channel 9: MCP financial data (FactSet, CapIQ, etc.)
        multi_query=None,         # MultiQueryRetriever — replaces dense for MEDIUM/COMPLEX
    ):
        self.channels = {}
        if dense_search:
            self.channels["dense"] = dense_search
        if sparse_search:
            self.channels["bm25"] = sparse_search
        if splade_search:
            self.channels["splade"] = splade_search
        if graph_search:
            self.channels["graph"] = graph_search
        if structured_search:
            self.channels["structured"] = structured_search
        if page_index_search:
            self.channels["page_index"] = page_index_search
        if turbo_quant_search:
            self.channels["turbo_quant"] = turbo_quant_search
        if gdelt_search:
            self.channels["gdelt"] = gdelt_search
        if mcp_search:
            self.channels["mcp"] = mcp_search

        self._multi_query = multi_query
        logger.info("retrieval_orchestrator_init", channels=list(self.channels.keys()),
                    multi_query=multi_query is not None)

    async def search(
        self,
        query: str,
        expanded_terms: dict | None = None,
        filters: dict | None = None,
        channels: list[str] | None = None,
        entities: dict | None = None,
        complexity: str = "simple",
    ) -> dict[str, list[RetrievalResult]]:
        """
        Execute all retrieval channels in parallel.

        For MEDIUM/COMPLEX queries, the dense channel is replaced by
        MultiQueryRetriever (4 query variants × dense search → merged).
        This yields +10-20% recall with no latency increase (parallel execution).
        """
        start = time.perf_counter()

        active_channels = channels or list(self.channels.keys())
        active_channels = [c for c in active_channels if c in self.channels]

        if not active_channels:
            logger.warning("no_active_channels")
            return {}

        # For MEDIUM/COMPLEX: replace plain dense with multi-query expansion
        use_multi_query = (
            self._multi_query is not None
            and complexity in ("medium", "complex", "math")
            and "dense" in active_channels
        )

        tasks = {}
        for channel_name in active_channels:
            if channel_name == "dense" and use_multi_query:
                # Swap dense → multi-query (runs HyDE × 4 variants internally)
                tasks["dense"] = self._safe_multi_query(query, filters)
            else:
                channel = self.channels[channel_name]
                tasks[channel_name] = self._safe_search(
                    channel_name, channel, query, expanded_terms, filters, entities
                )

        task_list = list(tasks.values())
        channel_names = list(tasks.keys())
        results_list = await asyncio.gather(*task_list, return_exceptions=True)

        results = {}
        for name, result in zip(channel_names, results_list):
            if isinstance(result, Exception):
                logger.error("channel_failed", channel=name, error=str(result))
                results[name] = []
            else:
                results[name] = result

        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.info(
            "retrieval_complete",
            channels_queried=channel_names,
            multi_query_used=use_multi_query,
            total_results={k: len(v) for k, v in results.items()},
            latency_ms=round(elapsed_ms, 1),
        )
        return results

    async def _safe_multi_query(
        self, query: str, filters: dict | None
    ) -> list[RetrievalResult]:
        """Run MultiQueryRetriever with timeout and graceful fallback to plain dense."""
        try:
            results = await asyncio.wait_for(
                self._multi_query.search(query=query, filters=filters),
                timeout=self._CHANNEL_TIMEOUTS["dense"],
            )
            logger.debug("multi_query_search", results=len(results))
            return results
        except asyncio.TimeoutError:
            logger.warning("multi_query_timeout")
        except Exception as e:
            logger.warning("multi_query_failed", error=str(e))
        # Fallback: plain dense search
        if "dense" in self.channels:
            return await self._safe_search(
                "dense", self.channels["dense"], query, None, filters, None
            )
        return []

    # Per-channel timeout budgets (seconds).
    # BM25/dense increased to 8s to handle lazy-client cold-start on first query.
    _CHANNEL_TIMEOUTS: dict[str, float] = {
        "dense":      12.0,
        "bm25":       12.0,
        "splade":      8.0,
        "graph":       4.0,
        "structured":  4.0,
        "page_index": 30.0,   # PageIndex navigates document trees — allow more time
        "turbo_quant": 2.0,   # in-memory; fast
        "gdelt":       4.0,   # external HTTP; allow extra time
        "mcp":        15.0,   # MCP: external financial data APIs; variable latency
    }

    async def _safe_search(
        self,
        name: str,
        channel: Any,
        query: str,
        expanded_terms: dict | None,
        filters: dict | None,
        entities: dict | None,
    ) -> list[RetrievalResult]:
        """Execute a single channel search with per-channel timeout and error handling."""
        timeout_s = self._CHANNEL_TIMEOUTS.get(name, 2.0)
        try:
            t0 = time.perf_counter()

            if name == "dense":
                coro = channel.search(query=query, filters=filters)
            elif name == "bm25":
                coro = channel.search(query=query, expanded_terms=expanded_terms, filters=filters)
            elif name == "splade":
                coro = channel.search(query=query, filters=filters)
            elif name == "graph":
                coro = channel.search(query=query, entities=entities)
            elif name == "structured":
                coro = channel.search(query=query, entities=entities)
            elif name == "page_index":
                coro = channel.search(query=query, filters=filters)
            elif name == "turbo_quant":
                # TurboQuantSearch needs the embedder; it uses search_text()
                coro = channel.search_text(
                    query=query, embedder=channel._embedder if hasattr(channel, "_embedder") else None,
                    filters=filters,
                )
            elif name == "gdelt":
                # GDELT returns article dicts — convert to RetrievalResult inline
                coro = _gdelt_to_results(channel, query)
            elif name == "mcp":
                # MCP channel accepts entities for ticker extraction
                coro = channel.search(query=query, filters=filters, entities=entities)
            else:
                return []

            results = await asyncio.wait_for(coro, timeout=timeout_s)

            ms = (time.perf_counter() - t0) * 1000
            logger.debug("channel_search", channel=name, results=len(results), ms=round(ms, 1))
            return results

        except asyncio.TimeoutError:
            logger.warning("channel_timeout", channel=name, timeout_s=timeout_s)
            return []
        except Exception as e:
            logger.error("channel_error", channel=name, error=str(e))
            return []

    async def search_multi_entity(
        self,
        query: str,
        tickers: list[str],
        filters: dict | None = None,
        channels: list[str] | None = None,
        complexity: str = "medium",
    ) -> dict[str, list[RetrievalResult]]:
        """
        Parallel per-entity retrieval for comparison queries.

        Runs the full channel stack once per ticker independently, then merges.
        Each result is tagged with its source ticker so the LLM can attribute
        values correctly ("Apple revenue: $394B vs Microsoft revenue: $211B").

        Used when query_plan["entities"]["companies"] has 2+ entries.
        """
        if not tickers:
            return await self.search(query=query, filters=filters,
                                     channels=channels, complexity=complexity)

        logger.info("multi_entity_retrieval", tickers=tickers)

        # One full retrieval pass per entity, in parallel
        per_entity_tasks = [
            self.search(
                query=query,
                filters={**(filters or {}), "companies": [ticker]},
                channels=channels,
                complexity=complexity,
            )
            for ticker in tickers
        ]
        per_entity_results = await asyncio.gather(*per_entity_tasks, return_exceptions=True)

        # Merge: label each result with its ticker, combine into channel buckets
        merged: dict[str, list[RetrievalResult]] = {}
        for ticker, entity_result in zip(tickers, per_entity_results):
            if isinstance(entity_result, Exception):
                logger.warning("multi_entity_channel_failed", ticker=ticker, error=str(entity_result))
                continue
            for channel, results in entity_result.items():
                if channel not in merged:
                    merged[channel] = []
                for r in results:
                    # Tag metadata with entity source for LLM attribution
                    if r.metadata is None:
                        r.metadata = {}
                    r.metadata["entity_ticker"] = ticker
                    merged[channel].append(r)

        logger.info(
            "multi_entity_merged",
            tickers=tickers,
            total={ch: len(rs) for ch, rs in merged.items()},
        )
        return merged

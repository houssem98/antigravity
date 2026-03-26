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
    │                    └─ Structured Search (PG)      ~20ms
    └─ Returns: dict[channel_name → list[RetrievalResult]]
"""

import asyncio
import time
from typing import Any

import structlog

from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()


class RetrievalOrchestrator:
    """Parallel dispatch to all search backends with graceful degradation."""

    def __init__(
        self,
        dense_search=None,
        sparse_search=None,
        splade_search=None,
        graph_search=None,
        structured_search=None,
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

        logger.info("retrieval_orchestrator_init", channels=list(self.channels.keys()))

    async def search(
        self,
        query: str,
        expanded_terms: dict | None = None,
        filters: dict | None = None,
        channels: list[str] | None = None,
        entities: dict | None = None,
    ) -> dict[str, list[RetrievalResult]]:
        """
        Execute all retrieval channels in parallel.

        Args:
            query: The search query
            expanded_terms: Synonym/concept expansions from query understanding
            filters: Company, date, document type filters
            channels: Which channels to use (default: all available)
            entities: Extracted entities for graph/structured queries

        Returns:
            Dict mapping channel name → list of RetrievalResult
        """
        start = time.perf_counter()

        # Determine which channels to run
        active_channels = channels or list(self.channels.keys())
        active_channels = [c for c in active_channels if c in self.channels]

        if not active_channels:
            logger.warning("no_active_channels")
            return {}

        # Build tasks for each active channel
        tasks = {}
        for channel_name in active_channels:
            channel = self.channels[channel_name]
            task = self._safe_search(channel_name, channel, query, expanded_terms, filters, entities)
            tasks[channel_name] = task

        # Execute ALL channels in parallel
        task_list = list(tasks.values())
        channel_names = list(tasks.keys())
        results_list = await asyncio.gather(*task_list, return_exceptions=True)

        # Collect results, handling any failures gracefully
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
            total_results={k: len(v) for k, v in results.items()},
            latency_ms=round(elapsed_ms, 1),
        )

        return results

    # Per-channel timeout budgets (seconds).
    # BM25/dense increased to 8s to handle lazy-client cold-start on first query.
    _CHANNEL_TIMEOUTS: dict[str, float] = {
        "dense": 8.0,
        "bm25": 8.0,
        "splade": 4.0,
        "graph": 4.0,
        "structured": 4.0,
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

"""
Gravity Search — MCP Retrieval Channel

Queries financial data MCP servers (FactSet, S&P CapIQ, Morningstar, Daloopa, etc.)
and converts responses into RetrievalResult objects for RRF fusion.

This is Channel 9 in the hybrid retrieval architecture:
  Dense + BM25 + SPLADE + Graph + Structured + PageIndex + TurboQuant + GDELT + MCP

MCP servers expose structured financial data (fundamentals, estimates, transcripts)
via tools. This channel:
  1. Identifies which MCP tools are relevant for the query (ticker, data type)
  2. Calls the appropriate tools in parallel
  3. Converts results to RetrievalResult with source_quality=9 (institutional data)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time

import structlog

from app.core.retrieval.fusion import RetrievalResult
from app.core.retrieval.mcp_client import MCPRegistry, MCPClient, MCPToolResult, get_mcp_registry

logger = structlog.get_logger()


# ── Tool Selection Heuristics ──────────────────────────────────────────

# Keywords that indicate which type of MCP tool to call
_TOOL_INTENT_KEYWORDS: dict[str, list[str]] = {
    "financials":   ["revenue", "income", "ebitda", "margin", "cash flow", "balance sheet",
                     "earnings", "eps", "profit", "financial", "10-k", "10-q", "fundamentals"],
    "estimates":    ["estimate", "consensus", "forecast", "forward", "guidance", "outlook",
                     "analyst", "target price", "eps estimate"],
    "valuation":    ["valuation", "multiple", "ev/ebitda", "p/e", "price/earnings",
                     "enterprise value", "market cap", "dcf", "comps"],
    "transcripts":  ["earnings call", "transcript", "conference call", "management",
                     "commentary", "guidance", "q&a"],
    "news":         ["news", "headline", "breaking", "announcement", "press release"],
    "credit":       ["credit", "rating", "moody", "default", "spread", "bond", "debt"],
    "deals":        ["deal", "m&a", "merger", "acquisition", "ipo", "fundraising", "pe"],
}


def _classify_query_intent(query: str) -> list[str]:
    """Classify query into MCP tool categories based on keywords."""
    query_lower = query.lower()
    intents = []
    for intent, keywords in _TOOL_INTENT_KEYWORDS.items():
        if any(kw in query_lower for kw in keywords):
            intents.append(intent)
    return intents or ["financials"]  # default to financials


def _extract_tickers(query: str, entities: dict | None = None) -> list[str]:
    """Extract company tickers from query or entities dict."""
    tickers = []
    if entities:
        tickers = entities.get("companies", []) or entities.get("tickers", [])
    if not tickers:
        # Simple uppercase word extraction as fallback
        import re
        candidates = re.findall(r'\b[A-Z]{1,5}\b', query)
        # Filter out common words
        common = {"I", "A", "AN", "THE", "AND", "OR", "FOR", "IN", "OF", "TO", "IS",
                  "IT", "AT", "ON", "BY", "AS", "IF", "DO", "VS", "EPS", "LTM", "YOY",
                  "DCF", "LBO", "MCP", "SEC", "IPO", "CEO", "CFO", "COO", "CTO", "ETF",
                  "Q1", "Q2", "Q3", "Q4", "FY", "PE", "PS", "PB", "EV", "GDP", "CPI"}
        tickers = [c for c in candidates if c not in common and len(c) >= 2]
    return tickers[:5]  # cap at 5 tickers


def _select_tools_for_query(
    client: MCPClient,
    query: str,
    intents: list[str],
    tickers: list[str],
) -> list[tuple[str, dict]]:
    """
    Select the best tools from a client's available tools for the given query.

    Returns list of (tool_name, arguments) tuples.
    """
    if not client.tools:
        return []

    selected = []
    query_lower = query.lower()

    for tool in client.tools:
        tool_lower = tool.name.lower()
        desc_lower = tool.description.lower()

        # Match tool against query intents
        relevance_score = 0
        for intent in intents:
            intent_keywords = _TOOL_INTENT_KEYWORDS.get(intent, [])
            for kw in intent_keywords:
                if kw in tool_lower or kw in desc_lower:
                    relevance_score += 1

        if relevance_score == 0:
            continue

        # Build arguments from tool's input schema
        args = _build_tool_arguments(tool.input_schema, query, tickers)
        selected.append((tool.name, args))

    # Sort by relevance, take top 3 tools per client
    return selected[:3]


def _build_tool_arguments(
    schema: dict,
    query: str,
    tickers: list[str],
) -> dict:
    """Build tool arguments from the schema, query, and extracted entities."""
    args = {}
    properties = schema.get("properties", {})

    for prop_name, prop_schema in properties.items():
        prop_lower = prop_name.lower()

        # Ticker/symbol fields
        if prop_lower in ("ticker", "symbol", "company_ticker", "symbols", "cik"):
            if tickers:
                args[prop_name] = tickers[0] if "list" not in str(prop_schema.get("type", "")) else tickers
        # Query/question fields
        elif prop_lower in ("query", "question", "search_query", "q", "text"):
            args[prop_name] = query
        # Limit fields
        elif prop_lower in ("limit", "max_results", "count", "top_k"):
            args[prop_name] = prop_schema.get("default", 10)

    return args


# ── MCP Retrieval Channel ─────────────────────────────────────────────

class MCPRetrievalChannel:
    """
    Retrieval channel that queries MCP financial data servers.

    Implements the same search() interface as other retrieval channels
    (DenseSearch, SparseSearch, etc.) to produce RetrievalResult objects
    for RRF fusion.

    MCP results get source_quality=9 (institutional data, just below SEC primary).
    """

    def __init__(self, registry: MCPRegistry | None = None):
        self._registry = registry
        self._initialized = False

    async def _ensure_initialized(self) -> MCPRegistry:
        """Lazy-initialize the registry and discover tools."""
        if self._registry is None:
            self._registry = get_mcp_registry()
        if not self._initialized:
            await self._registry.initialize_all()
            await self._registry.discover_all_tools()
            self._initialized = True
        return self._registry

    async def search(
        self,
        query: str,
        filters: dict | None = None,
        entities: dict | None = None,
        top_k: int = 20,
    ) -> list[RetrievalResult]:
        """
        Query all enabled MCP servers and return results as RetrievalResult objects.

        Args:
            query: The user's search query
            filters: Optional filters (companies, document_types, etc.)
            entities: Extracted entities dict with "companies", "tickers", etc.
            top_k: Maximum results to return

        Returns:
            List of RetrievalResult objects with source_quality=9 and
            document_type="mcp_<provider>"
        """
        t0 = time.perf_counter()

        try:
            registry = await self._ensure_initialized()
        except Exception as e:
            logger.warning("mcp_channel_init_failed", error=str(e))
            return []

        clients = registry.get_enabled_clients()
        if not clients:
            logger.debug("mcp_no_enabled_clients")
            return []

        # Classify query intent and extract tickers
        intents = _classify_query_intent(query)
        tickers = _extract_tickers(query, entities)

        # Merge ticker info from filters
        if filters and filters.get("companies"):
            tickers = list(set(tickers + filters["companies"]))

        if not tickers:
            # MCP servers generally require a ticker — skip if none found
            logger.debug("mcp_no_tickers_found", query=query[:100])
            return []

        # For each client, select and call relevant tools in parallel
        call_tasks = []
        call_meta = []  # track (client_name, tool_name) for each task

        for client_name, client in clients.items():
            tool_calls = _select_tools_for_query(client, query, intents, tickers)
            for tool_name, args in tool_calls:
                call_tasks.append(client.call_tool(tool_name, args))
                call_meta.append((client_name, tool_name))

        if not call_tasks:
            logger.debug("mcp_no_matching_tools", intents=intents, tickers=tickers)
            return []

        # Execute all tool calls in parallel with timeout
        raw_results = await asyncio.gather(*call_tasks, return_exceptions=True)

        # Convert to RetrievalResult objects
        retrieval_results = []
        for (client_name, tool_name), result in zip(call_meta, raw_results):
            if isinstance(result, Exception):
                logger.warning("mcp_tool_exception", client=client_name, tool=tool_name, error=str(result))
                continue
            if result.is_error:
                logger.debug("mcp_tool_error", client=client_name, tool=tool_name)
                continue

            # Convert MCPToolResult content items to RetrievalResults
            text = result.text
            if not text or len(text.strip()) < 10:
                continue

            # Split large results into chunks of ~1500 chars for better fusion
            chunks = self._chunk_result(text, max_chars=1500)
            for i, chunk in enumerate(chunks):
                chunk_hash = hashlib.md5(chunk.encode()).hexdigest()[:12]
                retrieval_results.append(RetrievalResult(
                    chunk_id=f"mcp_{client_name}_{chunk_hash}",
                    document_id=f"mcp://{client_name}/{tool_name}",
                    text=chunk,
                    score=0.9 - (i * 0.05),  # Slight decay for later chunks
                    metadata={
                        "source": f"MCP:{client_name}",
                        "tool": tool_name,
                        "provider": client_name,
                        "source_url": f"mcp://{client_name}/{tool_name}",
                        "tickers": tickers,
                        "data_freshness": "real-time",
                    },
                    document_title=f"{client_name.title()} — {tool_name.replace('_', ' ').replace('__', ': ')}",
                    document_type=f"mcp_{client_name}",
                    source_quality=9,  # Institutional data — just below SEC primary
                    ticker=tickers[0] if tickers else "",
                ))

        # Sort by score, cap at top_k
        retrieval_results.sort(key=lambda r: r.score, reverse=True)
        retrieval_results = retrieval_results[:top_k]

        elapsed_ms = (time.perf_counter() - t0) * 1000
        logger.info(
            "mcp_retrieval",
            clients_queried=len(clients),
            tools_called=len(call_tasks),
            results=len(retrieval_results),
            intents=intents,
            tickers=tickers,
            latency_ms=round(elapsed_ms, 1),
        )

        return retrieval_results

    @staticmethod
    def _chunk_result(text: str, max_chars: int = 1500) -> list[str]:
        """Split a large MCP result into manageable chunks."""
        if len(text) <= max_chars:
            return [text]

        chunks = []
        # Try to split on double newlines first (paragraph boundaries)
        paragraphs = text.split("\n\n")
        current_chunk = ""
        for para in paragraphs:
            if len(current_chunk) + len(para) + 2 > max_chars and current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = para
            else:
                current_chunk = current_chunk + "\n\n" + para if current_chunk else para

        if current_chunk.strip():
            chunks.append(current_chunk.strip())

        return chunks or [text[:max_chars]]

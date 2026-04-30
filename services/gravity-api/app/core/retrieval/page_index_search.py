"""
PageIndex Retrieval Channel — VectifyAI PageIndex integration
Channel 6 in the hybrid retrieval architecture.

PageIndex is a vectorless, tree-based document retrieval system that achieves
98.7% accuracy on FinanceBench (Mafin 2.5). Instead of embedding similarity,
it uses a hierarchical document structure (like a TOC) and LLM reasoning to
navigate to the most relevant pages.

Reference: github.com/VectifyAI/PageIndex

Architecture within Gravity Search:
  1. Ingestion:  PDFs are registered with PageIndex API → doc_id stored in PG
  2. Query time: PageIndexSearch queries PG for relevant doc_ids (filtered by
                 ticker/filing type from query understanding), then navigates
                 each document tree via LLM to extract relevant pages.
  3. Output:    Page-level RetrievalResult objects fused via RRF alongside other channels.

Config (env vars / .env):
  PAGEINDEX_API_KEY    — VectifyAI API key (required to enable this channel)
  PAGEINDEX_WORKSPACE  — workspace name (default "gravity")
  PAGEINDEX_ENABLED    — "true" to activate
"""

from __future__ import annotations

import asyncio
import json
import time
import urllib.request
import urllib.parse
from typing import Any, Optional

import structlog

from app.core.retrieval.fusion import RetrievalResult
from app.config import settings

logger = structlog.get_logger()


# ─── PageIndex HTTP client ────────────────────────────────────────────────────

class PageIndexAPIError(Exception):
    pass


class PageIndexClient:
    """
    Thin HTTP wrapper around the PageIndex REST API.
    Mirrors the SDK's PageIndexClient interface without requiring the external package.
    """

    def __init__(
        self,
        api_key:        str,
        workspace:      str  = "gravity",
        base_url:       str  = "https://api.pageindex.ai",
        model:          str  = "claude-sonnet-4-6",
        retrieve_model: str  = "claude-haiku-4-5-20251001",
        timeout:        int  = 60,
    ):
        self.api_key        = api_key
        self.workspace      = workspace
        self.base_url       = base_url.rstrip("/")
        self.model          = model
        self.retrieve_model = retrieve_model
        self.timeout        = timeout

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type":  "application/json",
            "X-Workspace":   self.workspace,
        }

    def _get(self, path: str) -> dict:
        url = f"{self.base_url}{path}"
        req = urllib.request.Request(url, headers=self._headers(), method="GET")
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read())

    def _post(self, path: str, body: dict) -> dict:
        url     = f"{self.base_url}{path}"
        payload = json.dumps(body).encode()
        req     = urllib.request.Request(url, data=payload, headers=self._headers(), method="POST")
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read())

    def index(self, file_path: str, mode: str = "auto") -> str:
        """Upload and index a document (PDF or Markdown). Returns doc_id."""
        import mimetypes
        mime, _ = mimetypes.guess_type(file_path)
        with open(file_path, "rb") as fh:
            content = fh.read()
        # Multipart upload — simplified using urllib
        boundary = "----GravityBoundary"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{file_path}"\r\n'
            f"Content-Type: {mime or 'application/octet-stream'}\r\n\r\n"
        ).encode() + content + (
            f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"mode\"\r\n\r\n{mode}"
            f"\r\n--{boundary}--\r\n"
        ).encode()
        headers = self._headers()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        del headers["Content-Type"]  # let urllib set it
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        req  = urllib.request.Request(
            f"{self.base_url}/v1/documents",
            data=body, headers=headers, method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
        return data["doc_id"]

    def get_document(self, doc_id: str) -> dict:
        return self._get(f"/v1/documents/{doc_id}")

    def get_document_structure(self, doc_id: str) -> dict:
        """Returns hierarchical TOC-style tree (content stripped)."""
        return self._get(f"/v1/documents/{doc_id}/structure")

    def get_page_content(self, doc_id: str, pages: str) -> str:
        """
        Fetch text for specific pages.
        pages format: "5-7", "3,8,12", or "12"
        """
        data = self._post(f"/v1/documents/{doc_id}/pages", {"pages": pages})
        return data.get("content", "")

    def retrieve(self, doc_id: str, query: str, top_pages: int = 10) -> list[dict]:
        """
        Use PageIndex's built-in retrieval endpoint (LLM navigates tree).
        Returns list of {page, content, relevance_score}.
        """
        data = self._post(f"/v1/documents/{doc_id}/retrieve", {
            "query":      query,
            "top_pages":  top_pages,
            "model":      self.retrieve_model,
        })
        return data.get("results", [])


# ─── In-process LLM tree navigator (fallback when /retrieve endpoint unavailable)

def _structure_to_text(structure: dict, depth: int = 0, max_depth: int = 4) -> str:
    """Flatten hierarchical structure to a readable outline."""
    lines: list[str] = []
    indent = "  " * depth
    title  = structure.get("title") or structure.get("name") or ""
    pages  = structure.get("pages") or structure.get("page_range") or ""
    if title:
        page_hint = f" [pp.{pages}]" if pages else ""
        lines.append(f"{indent}{title}{page_hint}")
    if depth < max_depth:
        for child in structure.get("children") or structure.get("sections") or []:
            lines.append(_structure_to_text(child, depth + 1, max_depth))
    return "\n".join(lines)


async def _llm_navigate(structure: dict, query: str, model: str) -> list[str]:
    """
    Ask LLM to identify which page ranges in the document structure are most
    relevant to the query. Returns a list of page-range strings (e.g. ["12-15", "42"]).
    """
    outline  = _structure_to_text(structure)
    prompt   = (
        "You are a financial document navigator. Given the document outline below,\n"
        "identify the 1–3 most relevant section page ranges for the query.\n"
        "Reply with ONLY a JSON array of page-range strings, e.g. [\"12-15\", \"42\"].\n\n"
        f"QUERY: {query}\n\n"
        f"DOCUMENT OUTLINE:\n{outline[:4000]}"
    )
    import urllib.request as _ur
    payload = json.dumps({
        "provider": "anthropic",
        "model":    model,
        "prompt":   prompt,
        "max_tokens": 64,
    }).encode()
    req = _ur.Request(
        f"{settings.pageindex_base_url.replace('api.pageindex.ai', 'localhost:3002')}"
        "/api/llm/chat",  # proxy through market-server
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        # Use local market-server LLM proxy
        import os
        ms_url = os.getenv("MARKET_SERVER_URL", "http://localhost:3002")
        req = _ur.Request(
            f"{ms_url}/api/llm/chat",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with _ur.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        text = data.get("text", "[]").strip()
        return json.loads(text)
    except Exception as exc:
        logger.warning("page_index_llm_navigate_failed", error=str(exc))
        return []


# ─── Doc registry (maps gravity document_id → pageindex doc_id in memory)
# Populated on startup by PageIndexSearch.preload() from Postgres.

_doc_registry: dict[str, str] = {}  # gravity_doc_id → pageindex_doc_id


class PageIndexSearch:
    """
    Retrieval channel 6: hierarchical page-level retrieval via PageIndex API.

    At query time, the channel:
      1. Identifies candidate documents from filters (ticker, filing_type, date)
         and from registry (all indexed docs if no filter).
      2. For each candidate document (capped at top_docs), calls PageIndex
         /retrieve or falls back to LLM tree navigation.
      3. Fetches page content and returns RetrievalResult objects.
    """

    CHANNEL = "page_index"

    def __init__(
        self,
        client:   Optional[PageIndexClient] = None,
        top_docs: int  = 3,   # max documents to navigate per query
        top_k:    int  = 10,  # max pages per document
    ):
        self.client   = client
        self.top_docs = top_docs
        self.top_k    = top_k
        self._enabled = bool(client and settings.pageindex_api_key)

    # ── Public API ────────────────────────────────────────────────────────

    async def search(
        self,
        query:   str,
        filters: dict | None = None,
        top_k:   int  | None = None,
    ) -> list[RetrievalResult]:
        if not self._enabled:
            return []

        top_k = top_k or self.top_k
        t0    = time.perf_counter()

        # Identify candidate pageindex doc_ids
        candidate_doc_ids = self._filter_candidates(filters)
        if not candidate_doc_ids:
            return []

        tasks = [
            self._retrieve_from_doc(query, pageindex_id, gravity_id, top_k)
            for gravity_id, pageindex_id in list(candidate_doc_ids.items())[:self.top_docs]
        ]
        nested  = await asyncio.gather(*tasks, return_exceptions=True)
        results = [r for batch in nested if isinstance(batch, list) for r in batch]

        elapsed = (time.perf_counter() - t0) * 1000
        logger.info("page_index_search", query=query[:60], results=len(results), ms=round(elapsed, 1))
        return results

    # ── Registry management ───────────────────────────────────────────────

    def register_document(self, gravity_doc_id: str, pageindex_doc_id: str) -> None:
        """Called by PageIndexer after successfully indexing a document."""
        _doc_registry[gravity_doc_id] = pageindex_doc_id
        logger.info("page_index_registered", gravity_id=gravity_doc_id, pi_id=pageindex_doc_id)

    async def preload_registry(self, db_url: str) -> None:
        """Load gravity_doc_id → pageindex_doc_id mapping from Postgres on startup."""
        try:
            import asyncpg  # type: ignore
            conn = await asyncpg.connect(db_url)
            try:
                rows = await conn.fetch(
                    "SELECT gravity_doc_id, pageindex_doc_id FROM pageindex_registry"
                )
                for row in rows:
                    _doc_registry[row["gravity_doc_id"]] = row["pageindex_doc_id"]
                logger.info("page_index_registry_loaded", count=len(_doc_registry))
            finally:
                await conn.close()
        except Exception as exc:
            logger.warning("page_index_preload_failed", error=str(exc))

    # ── Internal helpers ──────────────────────────────────────────────────

    def _filter_candidates(self, filters: dict | None) -> dict[str, str]:
        """Return {gravity_doc_id: pageindex_doc_id} filtered by ticker/filing_type."""
        if not _doc_registry:
            return {}
        if not filters:
            return dict(_doc_registry)  # all indexed docs

        ticker      = (filters.get("ticker") or "").upper()
        filing_type = (filters.get("document_type") or filters.get("filing_type") or "").upper()

        matched = {}
        for gid, pid in _doc_registry.items():
            if ticker and ticker not in gid.upper():
                continue
            if filing_type and filing_type not in gid.upper():
                continue
            matched[gid] = pid
        return matched or dict(_doc_registry)  # if filter matches nothing, use all

    async def _retrieve_from_doc(
        self,
        query:          str,
        pageindex_id:   str,
        gravity_doc_id: str,
        top_k:          int,
    ) -> list[RetrievalResult]:
        """Navigate one document and return page-level results."""
        assert self.client is not None
        results: list[RetrievalResult] = []
        try:
            # Try /retrieve endpoint first (hosted navigation)
            loop     = asyncio.get_event_loop()
            raw      = await loop.run_in_executor(
                None,
                lambda: self.client.retrieve(pageindex_id, query, top_pages=top_k),
            )
            for i, page_hit in enumerate(raw):
                content = page_hit.get("content", "")
                page    = page_hit.get("page")
                score   = float(page_hit.get("relevance_score", 1.0 - i * 0.05))
                if not content:
                    continue
                results.append(RetrievalResult(
                    chunk_id    = f"{gravity_doc_id}:p{page}",
                    document_id = gravity_doc_id,
                    text        = content,
                    score       = score,
                    page        = page,
                    section     = f"page {page}",
                    document_title=gravity_doc_id,
                    metadata    = {"source_channel": self.CHANNEL, "pageindex_doc_id": pageindex_id},
                    source_channels=[self.CHANNEL],
                ))
        except Exception as exc:
            # Fallback: get structure + LLM navigate + fetch pages
            logger.debug("page_index_retrieve_fallback", doc=pageindex_id, error=str(exc))
            try:
                loop      = asyncio.get_event_loop()
                structure = await loop.run_in_executor(
                    None, lambda: self.client.get_document_structure(pageindex_id)
                )
                page_ranges = await _llm_navigate(
                    structure, query, settings.pageindex_retrieve_model
                )
                for pr in page_ranges[:top_k]:
                    content = await loop.run_in_executor(
                        None, lambda pr=pr: self.client.get_page_content(pageindex_id, pr)
                    )
                    if content:
                        results.append(RetrievalResult(
                            chunk_id    = f"{gravity_doc_id}:pages{pr}",
                            document_id = gravity_doc_id,
                            text        = content,
                            score       = 0.8,
                            section     = f"pages {pr}",
                            document_title=gravity_doc_id,
                            metadata    = {"source_channel": self.CHANNEL, "page_range": pr},
                            source_channels=[self.CHANNEL],
                        ))
            except Exception as exc2:
                logger.warning("page_index_fallback_failed", doc=pageindex_id, error=str(exc2))
        return results


# ─── Factory ─────────────────────────────────────────────────────────────────

def build_page_index_search() -> Optional[PageIndexSearch]:
    """Build PageIndexSearch if API key is configured; return None otherwise."""
    if not settings.pageindex_api_key:
        logger.debug("page_index_disabled", reason="no PAGEINDEX_API_KEY")
        return None
    client = PageIndexClient(
        api_key        = settings.pageindex_api_key,
        workspace      = settings.pageindex_workspace,
        base_url       = settings.pageindex_base_url,
        model          = settings.pageindex_model,
        retrieve_model = settings.pageindex_retrieve_model,
    )
    logger.info("page_index_enabled", workspace=settings.pageindex_workspace)
    return PageIndexSearch(
        client   = client,
        top_docs = 3,
        top_k    = settings.pageindex_top_k,
    )

"""
PageIndex Indexer — Registers SEC filing PDFs with VectifyAI PageIndex API.

Called during the ingestion pipeline after a document is processed. The returned
pageindex_doc_id is stored in Postgres so the PageIndexSearch channel can retrieve
it at query time.

Usage (called from pipeline.py):
    from app.ingestion.indexing.page_indexer import PageIndexer

    indexer = PageIndexer()
    if indexer.enabled:
        await indexer.index_document(
            gravity_doc_id="aapl_10k_2024",
            pdf_path="/data/pdfs/aapl_10k_2024.pdf",
        )
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Optional

import structlog

from app.config import settings

logger = structlog.get_logger()

# Postgres DDL (run once as a migration):
_REGISTRY_DDL = """
CREATE TABLE IF NOT EXISTS pageindex_registry (
    gravity_doc_id   TEXT PRIMARY KEY,
    pageindex_doc_id TEXT NOT NULL,
    indexed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pdf_path         TEXT,
    status           TEXT NOT NULL DEFAULT 'indexed'
);
CREATE INDEX IF NOT EXISTS idx_pir_status ON pageindex_registry(status);
"""


class PageIndexer:
    """
    Registers documents with the PageIndex API and stores the mapping in Postgres.
    Gracefully does nothing if PAGEINDEX_API_KEY is not set.
    """

    def __init__(self):
        self.enabled = bool(settings.pageindex_api_key)
        self._client = None
        self._search: Optional[object] = None  # PageIndexSearch, set externally

        if self.enabled:
            from app.core.retrieval.page_index_search import PageIndexClient
            self._client = PageIndexClient(
                api_key        = settings.pageindex_api_key,
                workspace      = settings.pageindex_workspace,
                base_url       = settings.pageindex_base_url,
                model          = settings.pageindex_model,
                retrieve_model = settings.pageindex_retrieve_model,
            )

    def set_search_channel(self, search) -> None:
        """Link to the PageIndexSearch instance so the registry stays in sync."""
        self._search = search

    async def ensure_registry_table(self, db_url: str) -> None:
        """Create the registry table if it doesn't exist."""
        try:
            import asyncpg  # type: ignore
            conn = await asyncpg.connect(db_url)
            try:
                await conn.execute(_REGISTRY_DDL)
            finally:
                await conn.close()
        except Exception as exc:
            logger.warning("page_indexer_ddl_failed", error=str(exc))

    async def index_document(
        self,
        gravity_doc_id: str,
        pdf_path:       str | Path,
        db_url:         Optional[str] = None,
        mode:           str = "auto",
    ) -> Optional[str]:
        """
        Index a PDF with PageIndex API and persist the mapping.

        Returns the pageindex_doc_id on success, None on failure.
        """
        if not self.enabled or self._client is None:
            return None

        pdf_path = str(pdf_path)
        if not Path(pdf_path).exists():
            logger.warning("page_indexer_pdf_not_found", path=pdf_path)
            return None

        logger.info("page_indexer_indexing", gravity_id=gravity_doc_id, path=pdf_path)
        try:
            loop            = asyncio.get_event_loop()
            pageindex_doc_id = await loop.run_in_executor(
                None,
                lambda: self._client.index(pdf_path, mode=mode),
            )

            # Persist mapping to Postgres
            if db_url:
                await self._persist(gravity_doc_id, pageindex_doc_id, pdf_path, db_url)

            # Register with in-memory search channel
            if self._search is not None:
                self._search.register_document(gravity_doc_id, pageindex_doc_id)

            logger.info(
                "page_indexer_done",
                gravity_id=gravity_doc_id,
                pi_id=pageindex_doc_id,
            )
            return pageindex_doc_id

        except Exception as exc:
            logger.error("page_indexer_failed", gravity_id=gravity_doc_id, error=str(exc))
            return None

    async def _persist(
        self,
        gravity_doc_id:   str,
        pageindex_doc_id: str,
        pdf_path:         str,
        db_url:           str,
    ) -> None:
        try:
            import asyncpg  # type: ignore
            conn = await asyncpg.connect(db_url)
            try:
                await conn.execute(
                    """
                    INSERT INTO pageindex_registry
                        (gravity_doc_id, pageindex_doc_id, pdf_path)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (gravity_doc_id) DO UPDATE
                        SET pageindex_doc_id = EXCLUDED.pageindex_doc_id,
                            pdf_path         = EXCLUDED.pdf_path,
                            indexed_at       = NOW(),
                            status           = 'indexed'
                    """,
                    gravity_doc_id, pageindex_doc_id, pdf_path,
                )
            finally:
                await conn.close()
        except Exception as exc:
            logger.warning("page_indexer_persist_failed", error=str(exc))

    async def index_bulk(
        self,
        documents: list[dict],   # [{gravity_doc_id, pdf_path}, ...]
        db_url:    Optional[str] = None,
        concurrency: int = 3,
    ) -> dict[str, str]:
        """
        Index multiple PDFs concurrently.
        Returns {gravity_doc_id: pageindex_doc_id} for successful indexing.
        """
        sem    = asyncio.Semaphore(concurrency)
        results: dict[str, str] = {}

        async def _one(doc: dict) -> None:
            async with sem:
                pid = await self.index_document(
                    doc["gravity_doc_id"],
                    doc["pdf_path"],
                    db_url=db_url,
                )
                if pid:
                    results[doc["gravity_doc_id"]] = pid

        await asyncio.gather(*[_one(d) for d in documents])
        logger.info("page_indexer_bulk_done", total=len(documents), indexed=len(results))
        return results

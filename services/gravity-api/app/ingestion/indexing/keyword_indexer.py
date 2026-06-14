"""
Gravity Search — Keyword Indexer (Elasticsearch BM25)
Bulk indexes ChunkOutput objects into Elasticsearch.
Field names MUST match sparse_search.py query expectations.
"""

import structlog

from app.config import settings
from app.db.elasticsearch import es_client, ensure_index
from app.ingestion.processing.chunker import ChunkOutput

logger = structlog.get_logger()


class KeywordIndexer:
    """
    Bulk indexes chunks into Elasticsearch for BM25 keyword search.

    Field names must match what sparse_search.py reads from ES _source:
      chunk_id, document_id, text, ticker, document_title, company_name,
      filing_type, filing_date, section, page, chunk_level
    """

    def __init__(self):
        self.index = settings.elasticsearch_index

    async def index_chunks(
        self,
        chunks: list[ChunkOutput],
        batch_size: int = 200,
    ) -> int:
        """
        Bulk index chunks for keyword search.

        Primary: Supabase Postgres FTS (the `chunks` table, document-copilot
        pattern — the keyword channel we actually run). Also mirrors to
        Elasticsearch if ES is provisioned. Returns max(rows written).
        """
        if not chunks:
            return 0

        # Supabase FTS write (the live keyword backend).
        sb_total = 0
        try:
            from app.db import supabase_rest
            if supabase_rest.configured():
                sb_total = await self._index_supabase(chunks, batch_size)
        except Exception as e:
            logger.warning("keyword_supabase_failed", error=str(e)[:160])

        # Elasticsearch mirror (only if provisioned; otherwise ensure_index throws).
        es_total = 0
        try:
            es_total = await self._index_es(chunks, batch_size)
        except Exception as e:
            logger.info("keyword_es_skipped", error=str(e)[:120])

        return max(sb_total, es_total)

    async def _index_supabase(self, chunks: list[ChunkOutput], batch_size: int) -> int:
        """Upsert paragraph-level chunks into the Supabase `chunks` table for FTS."""
        from app.db import supabase_rest

        rows = []
        for chunk in chunks:
            # Only the retrievable paragraph level (matches search_chunks_fts filter).
            if chunk.level not in (2, None):
                continue
            if not (chunk.text or "").strip():
                continue
            md = chunk.metadata or {}
            rows.append({
                "id": chunk.id,
                "document_id": chunk.document_id,
                "ticker": (md.get("ticker", "") or "").upper(),
                "company": md.get("company_name", "") or "",
                "document_title": md.get("document_title", "") or "",
                "filing_type": md.get("filing_type", "") or "",
                "filing_date": md.get("filing_date") or None,
                "section": chunk.section_name or "",
                "page": chunk.page_number,
                "chunk_level": chunk.level,
                "text": chunk.text,
            })
        if not rows:
            return 0
        # Dedupe by id (Postgres ON CONFLICT errors on dup ids within one batch).
        rows = list({r["id"]: r for r in rows}.values())

        total = 0
        for i in range(0, len(rows), batch_size):
            total += await supabase_rest.sb_insert(
                "chunks", rows[i:i + batch_size], on_conflict="id"
            )
        logger.info("keyword_supabase_indexed", total=total)
        return total

    async def _index_es(
        self,
        chunks: list[ChunkOutput],
        batch_size: int = 200,
    ) -> int:
        """Bulk index chunks into Elasticsearch (mirror; only if ES provisioned)."""
        if not chunks:
            return 0

        # Ensure index exists with financial analyzer
        await ensure_index()

        total = 0
        for batch_start in range(0, len(chunks), batch_size):
            batch = chunks[batch_start:batch_start + batch_size]

            # Build bulk operations: alternating action + document
            operations = []
            for chunk in batch:
                operations.append({
                    "index": {"_index": self.index, "_id": chunk.id}
                })
                operations.append({
                    "chunk_id": chunk.id,
                    "document_id": chunk.document_id,
                    "text": chunk.text,
                    "ticker": chunk.metadata.get("ticker", ""),
                    "company_name": chunk.metadata.get("company_name", ""),
                    "document_title": chunk.metadata.get("document_title", ""),
                    "filing_type": chunk.metadata.get("filing_type", ""),
                    "filing_date": chunk.metadata.get("filing_date") or None,
                    "section": chunk.section_name,
                    "page": chunk.page_number,
                    "chunk_level": chunk.level,
                    "token_count": chunk.token_count,
                    "metadata": chunk.metadata,
                })

            try:
                response = await es_client.bulk(operations=operations)
                errors = [item for item in response.get("items", [])
                          if item.get("index", {}).get("error")]
                if errors:
                    logger.warning("es_bulk_errors", count=len(errors))

                batch_count = len(batch)
                total += batch_count
                logger.info(
                    "keyword_batch_indexed",
                    batch=batch_start // batch_size + 1,
                    size=batch_count,
                    total_so_far=total,
                )
            except Exception as e:
                logger.error("es_bulk_failed", error=str(e), batch_size=len(batch))

        logger.info("keyword_indexing_complete", total_indexed=total)
        return total

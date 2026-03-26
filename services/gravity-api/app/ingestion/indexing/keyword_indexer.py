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
        Bulk index chunks into Elasticsearch.

        Returns number of chunks indexed.
        """
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

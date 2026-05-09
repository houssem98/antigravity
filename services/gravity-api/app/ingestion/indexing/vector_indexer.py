"""
Gravity Search — Vector Indexer (Qdrant)
Embeds document chunks and upserts dense + sparse vectors into Qdrant.
Field names MUST match dense_search.py and splade_search.py payload expectations.
"""

import structlog
from qdrant_client import models as qmodels

from app.db.qdrant import qdrant_client, ensure_collection, collection_for_org, DENSE_VECTOR_NAME, SPARSE_VECTOR_NAME
from app.ingestion.processing.chunker import ChunkOutput

logger = structlog.get_logger()


class VectorIndexer:
    """
    Indexes ChunkOutput objects into Qdrant with dense + sparse vectors.

    Payload field names must match what dense_search.py and splade_search.py
    read from Qdrant point payloads:
      chunk_id, document_id, text, ticker, document_title, section,
      filing_date, page, chunk_level, company_name, filing_type
    """

    def __init__(self, embedder, splade_encoder=None, turbo_quant=None):
        self.embedder = embedder          # VoyageEmbedder or LocalEmbedder
        self.splade = splade_encoder      # SpladeEncoder or None
        self.turbo_quant = turbo_quant    # TurboQuantSearch or None (optional)

    async def index_chunks(
        self,
        chunks: list[ChunkOutput],
        batch_size: int = 64,
        org_id: str | None = None,
    ) -> int:
        """
        Embed and upsert chunks to Qdrant.

        org_id: routes to per-tenant collection when MULTI_TENANT_QDRANT=true.
        Returns number of chunks indexed.
        """
        if not chunks:
            return 0

        collection = collection_for_org(org_id)
        await ensure_collection(collection)

        total = 0
        for batch_start in range(0, len(chunks), batch_size):
            batch = chunks[batch_start:batch_start + batch_size]

            # ── Dense embeddings ─────────────────────────────────────────
            texts = [c.text_with_metadata for c in batch]
            try:
                dense_vectors = await self.embedder.embed_documents(texts)
            except Exception as e:
                logger.error("embed_documents_failed", error=str(e), batch_size=len(batch))
                continue

            # ── SPLADE sparse vectors ────────────────────────────────────
            sparse_vectors = []
            for text in texts:
                if self.splade:
                    try:
                        sv = await self.splade.encode_document(text)
                    except Exception:
                        sv = {"indices": [], "values": []}
                else:
                    sv = {"indices": [], "values": []}
                sparse_vectors.append(sv)

            # ── Build Qdrant points ──────────────────────────────────────
            points = []
            for chunk, dense, sparse in zip(batch, dense_vectors, sparse_vectors):
                vector_dict = {DENSE_VECTOR_NAME: dense}
                if sparse.get("indices"):
                    vector_dict[SPARSE_VECTOR_NAME] = qmodels.SparseVector(
                        indices=sparse["indices"],
                        values=sparse["values"],
                    )

                # Entitlements: ingestion can stamp chunks with license keys
                # via chunk.metadata["entitlements"]. Default to ["public"]
                # for legacy / public-domain content (SEC EDGAR filings).
                entitlements = chunk.metadata.get("entitlements")
                if not entitlements or not isinstance(entitlements, list):
                    entitlements = ["public"]

                points.append(qmodels.PointStruct(
                    id=chunk.id,  # UUID string
                    vector=vector_dict,
                    payload={
                        "chunk_id": chunk.id,
                        "document_id": chunk.document_id,
                        "text": chunk.text,
                        "text_with_metadata": chunk.text_with_metadata,
                        "chunk_level": chunk.level,
                        "section": chunk.section_name,
                        "page": chunk.page_number,
                        "token_count": chunk.token_count,
                        "position": chunk.position,
                        # Fields from metadata (must match search result mapping)
                        "ticker": chunk.metadata.get("ticker", ""),
                        "company_name": chunk.metadata.get("company_name", ""),
                        "filing_type": chunk.metadata.get("filing_type", ""),
                        "filing_date": chunk.metadata.get("filing_date", ""),
                        "document_title": chunk.metadata.get("document_title", ""),
                        # ACL — pre-retrieval entitlement check (plan §6.11)
                        "entitlements": entitlements,
                    },
                ))

            # ── Upsert to Qdrant ─────────────────────────────────────────
            try:
                await qdrant_client.upsert(
                    collection_name=collection,
                    points=points,
                    wait=True,
                )
                total += len(points)
                logger.info(
                    "vector_batch_indexed",
                    batch=batch_start // batch_size + 1,
                    size=len(points),
                    total_so_far=total,
                )
            except Exception as e:
                logger.error("qdrant_upsert_failed", error=str(e), batch_size=len(points))
                continue

            # ── Mirror to TurboQuant in-memory index ─────────────────────
            if self.turbo_quant is not None and self.turbo_quant.ready:
                tq_payloads = [
                    {
                        "chunk_id":      p.payload.get("chunk_id"),
                        "document_id":   p.payload.get("document_id"),
                        "text":          p.payload.get("text"),
                        "document_title":p.payload.get("document_title"),
                        "section":       p.payload.get("section"),
                        "page":          p.payload.get("page"),
                        "metadata": {
                            "ticker":       p.payload.get("ticker"),
                            "filing_type":  p.payload.get("filing_type"),
                            "filing_date":  p.payload.get("filing_date"),
                            "company_name": p.payload.get("company_name"),
                        },
                    }
                    for p in points
                ]
                self.turbo_quant.add_vectors(dense_vectors, tq_payloads)

        logger.info("vector_indexing_complete", total_indexed=total)
        return total

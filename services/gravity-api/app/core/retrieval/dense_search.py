"""
Gravity Search — Dense Vector Search via Qdrant
Channel 1 of 5 in the hybrid retrieval architecture.
Uses voyage-finance-2 embeddings (1024 dim) with HNSW index.
"""

import structlog
from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()


class DenseSearch:
    """Semantic similarity search via Qdrant dense vectors, with optional HyDE."""

    def __init__(self, embedder, hyde=None):
        self.embedder = embedder
        self.hyde = hyde   # HyDE instance; if None, falls back to raw query embedding

    async def search(
        self,
        query: str,
        filters: dict | None = None,
        top_k: int | None = None,
        use_hyde: bool = False,  # default off: HyDE adds an LLM call that times out
                                 # dense under parallel load on small boxes. Multi-query
                                 # still opts in explicitly for medium/complex queries.
    ) -> list[RetrievalResult]:
        """
        Embed the query (via HyDE if available) and search for nearest neighbors.

        HyDE generates a hypothetical answer passage before embedding, dramatically
        closing the question/answer embedding-space gap for financial queries.
        """
        try:
            from qdrant_client import models
            from app.config import settings
            from app.db.qdrant import qdrant_client, collection_for_org, DENSE_VECTOR_NAME

            top_k = top_k or settings.dense_search_top_k
            org_id = (filters or {}).get("org_id")
            collection = collection_for_org(org_id)

            # ── HyDE embedding (preferred) or raw query embedding ────────
            if use_hyde and self.hyde is not None:
                query_vector = await self.hyde.embed_query(query)
            else:
                query_vector = await self.embedder.embed_query(query)

            qdrant_filter = self._build_filter(filters, models) if filters else None

            results = await qdrant_client.query_points(
                collection_name=collection,
                query=query_vector,
                using=DENSE_VECTOR_NAME,
                query_filter=qdrant_filter,
                limit=top_k,
                with_payload=True,
            )

            output = []
            for point in results.points:
                payload = point.payload or {}
                output.append(RetrievalResult(
                    chunk_id=payload.get("chunk_id", str(point.id)),
                    document_id=payload.get("document_id", ""),
                    text=payload.get("text", ""),
                    score=point.score,
                    metadata=payload,
                    document_title=payload.get("document_title", ""),
                    section=payload.get("section", ""),
                    page=payload.get("page"),
                    filing_date=payload.get("filing_date", ""),
                    ticker=payload.get("ticker", ""),
                ))

            logger.info("dense_search", results=len(output))
            return output
        except Exception as e:
            logger.warning("dense_search_unavailable", error=str(e))
            return []

    async def search_with_page_context(
        self,
        query: str,
        filters: dict | None = None,
        top_k: int | None = None,
        page_index_indexer=None,
    ) -> list[RetrievalResult]:
        """
        Dense search augmented with PageIndex context expansion.

        For each retrieved chunk, loads the corresponding PageIndex and expands
        context to include parent section + adjacent siblings (small-to-big retrieval).
        Returns RetrievalResult objects with enriched text.
        """
        results = await self.search(query=query, filters=filters, top_k=top_k)

        if not page_index_indexer:
            return results

        enriched = []
        for result in results:
            try:
                ctx = await page_index_indexer.get_context_for_chunk(
                    document_id=result.document_id,
                    chunk_id=result.chunk_id,
                    expand=True,
                )
                if ctx.get("context_texts"):
                    # Replace text with expanded context
                    expanded_text = "\n\n".join(ctx["context_texts"])
                    enriched.append(RetrievalResult(
                        chunk_id=result.chunk_id,
                        document_id=result.document_id,
                        text=expanded_text[:3000],  # cap at 3000 chars
                        score=result.score,
                        metadata={
                            **result.metadata,
                            "breadcrumb_path": ctx.get("breadcrumb_path", ""),
                            "section_title": ctx.get("section_title", ""),
                            "page_range": ctx.get("page_range", ""),
                        },
                        document_title=result.document_title,
                        section=ctx.get("section_title", "") or result.section,
                        page=result.page,
                        filing_date=result.filing_date,
                        ticker=result.ticker,
                    ))
                else:
                    enriched.append(result)
            except Exception:
                enriched.append(result)

        logger.info("dense_search_with_page_context", results=len(enriched))
        return enriched

    def _build_filter(self, filters: dict, models):
        """Convert API filter dict to Qdrant filter model.

        Always applies the entitlement ACL filter when a UserEntitlements
        object is present in `filters["user_entitlements"]`. This is the
        primary defense against prompt-injection exfiltration of unlicensed
        content (plan §6.11). Falls back to public-only when absent.
        """
        conditions = []
        if filters.get("companies"):
            conditions.append(models.FieldCondition(
                key="ticker", match=models.MatchAny(any=filters["companies"])))
        if filters.get("document_types"):
            conditions.append(models.FieldCondition(
                key="filing_type", match=models.MatchAny(any=filters["document_types"])))
        conditions.append(models.FieldCondition(
            key="chunk_level", match=models.MatchValue(value=2)))

        # Source-level entitlement ACL — pre-retrieval, fail-closed.
        from app.core.security.entitlements import (
            UserEntitlements, qdrant_entitlement_filter,
        )
        user = filters.get("user_entitlements")
        if not isinstance(user, UserEntitlements):
            user = UserEntitlements.public_only()
        conditions.append(qdrant_entitlement_filter(user))

        return models.Filter(must=conditions)

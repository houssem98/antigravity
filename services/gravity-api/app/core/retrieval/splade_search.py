"""
Gravity Search — SPLADE Learned Sparse Search (Channel 3)
Bridges dense and keyword search: captures synonyms with term-level precision.
"""

import structlog
from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()


class SpladeSearch:
    """Learned sparse search using SPLADE vectors stored in Qdrant."""

    def __init__(self, splade_encoder):
        self.encoder = splade_encoder

    async def search(
        self,
        query: str,
        filters: dict | None = None,
        top_k: int = 50,
    ) -> list[RetrievalResult]:
        try:
            from qdrant_client import models
            from app.db.qdrant import qdrant_client, collection_for_org, SPARSE_VECTOR_NAME

            org_id = (filters or {}).get("org_id")
            collection = collection_for_org(org_id)

            sparse_vector = await self.encoder.encode_query(query)

            # Always build a filter — entitlement ACL is mandatory.
            from app.core.security.entitlements import (
                UserEntitlements, qdrant_entitlement_filter,
            )
            conditions = []
            if filters:
                if filters.get("companies"):
                    conditions.append(models.FieldCondition(
                        key="ticker", match=models.MatchAny(any=filters["companies"])))
                if filters.get("document_types"):
                    conditions.append(models.FieldCondition(
                        key="filing_type", match=models.MatchAny(any=filters["document_types"])))
                conditions.append(models.FieldCondition(
                    key="chunk_level", match=models.MatchValue(value=2)))
            user = (filters or {}).get("user_entitlements")
            if not isinstance(user, UserEntitlements):
                user = UserEntitlements.public_only()
            conditions.append(qdrant_entitlement_filter(user))
            qdrant_filter = models.Filter(must=conditions)

            results = await qdrant_client.query_points(
                collection_name=collection,
                query=models.SparseVector(
                    indices=sparse_vector["indices"],
                    values=sparse_vector["values"],
                ),
                using=SPARSE_VECTOR_NAME,
                query_filter=qdrant_filter,
                limit=top_k,
                with_payload=True,
            )

            output = []
            for point in results.points:
                p = point.payload or {}
                output.append(RetrievalResult(
                    chunk_id=p.get("chunk_id", str(point.id)),
                    document_id=p.get("document_id", ""),
                    text=p.get("text", ""),
                    score=point.score,
                    metadata=p,
                    document_title=p.get("document_title", ""),
                    section=p.get("section", ""),
                    page=p.get("page"),
                    filing_date=p.get("filing_date", ""),
                    ticker=p.get("ticker", ""),
                ))

            logger.info("splade_search", results=len(output))
            return output
        except Exception as e:
            logger.warning("splade_search_unavailable", error=str(e))
            return []

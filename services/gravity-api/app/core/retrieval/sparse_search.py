"""
Gravity Search — Sparse Keyword Search via Elasticsearch BM25
Channel 2 of 5. Handles exact phrase matching, tickers, numbers, regulatory terms.
"""

import structlog
from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()


class SparseSearch:
    """BM25 keyword search via Elasticsearch."""

    def __init__(self):
        from app.config import settings
        self.index = settings.elasticsearch_index
        self.top_k = settings.sparse_search_top_k

    async def search(
        self,
        query: str,
        expanded_terms: dict | None = None,
        filters: dict | None = None,
        top_k: int | None = None,
    ) -> list[RetrievalResult]:
        try:
            from app.db.elasticsearch import es_client

            top_k = top_k or self.top_k

            should_clauses = [
                {"match": {"text": {"query": query, "boost": 2.0}}},
                {"match_phrase": {"text": {"query": query, "boost": 3.0, "slop": 2}}},
            ]

            if expanded_terms and expanded_terms.get("synonyms"):
                for syn in expanded_terms["synonyms"]:
                    should_clauses.append({"match": {"text": {"query": syn, "boost": 0.5}}})

            es_query = {
                "bool": {
                    "should": should_clauses,
                    "minimum_should_match": 1,
                    "filter": self._build_filters(filters) if filters else [],
                }
            }

            result = await es_client.search(
                index=self.index,
                query=es_query,
                size=top_k,
                _source=["chunk_id", "document_id", "text", "ticker", "document_title",
                          "section", "filing_date", "page", "chunk_level"],
            )

            output = []
            for hit in result["hits"]["hits"]:
                src = hit["_source"]
                output.append(RetrievalResult(
                    chunk_id=src.get("chunk_id", hit["_id"]),
                    document_id=src.get("document_id", ""),
                    text=src.get("text", ""),
                    score=hit["_score"],
                    metadata=src,
                    document_title=src.get("document_title", ""),
                    section=src.get("section", ""),
                    page=src.get("page"),
                    filing_date=src.get("filing_date", ""),
                    ticker=src.get("ticker", ""),
                ))

            logger.info("sparse_search", results=len(output))
            return output
        except Exception as e:
            logger.warning("sparse_search_unavailable", error=str(e))
            return []

    def _build_filters(self, filters: dict) -> list:
        es_filters = []
        if filters.get("companies"):
            es_filters.append({"terms": {"ticker": filters["companies"]}})
        if filters.get("document_types"):
            es_filters.append({"terms": {"filing_type": filters["document_types"]}})
        if filters.get("date_range"):
            dr = filters["date_range"]
            range_filter = {}
            if dr.get("from"):
                range_filter["gte"] = dr["from"]
            if dr.get("to"):
                range_filter["lte"] = dr["to"]
            if range_filter:
                es_filters.append({"range": {"filing_date": range_filter}})
        es_filters.append({"term": {"chunk_level": 2}})
        return es_filters

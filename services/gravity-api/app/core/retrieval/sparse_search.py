"""
Gravity Search — Sparse Keyword Search (Channel 2 of 5)
Exact phrase / ticker / number / regulatory-term matching.

Backend: **Supabase Postgres full-text search** (document-copilot pattern) via the
`search_chunks_fts` RPC — one DB we already run, replacing the Elasticsearch BM25
channel that was never provisioned on this deploy (every dispatch returned []).
Falls back to Elasticsearch only if ELASTICSEARCH_URL is explicitly configured.
"""

import structlog
from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()


class SparseSearch:
    """Keyword search. Primary: Supabase Postgres FTS. Fallback: Elasticsearch BM25."""

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
        top_k = top_k or self.top_k

        # Primary: Supabase Postgres FTS (the channel we actually run).
        try:
            from app.db import supabase_rest
            if supabase_rest.configured():
                return await self._search_supabase(query, expanded_terms, filters, top_k)
        except Exception as e:
            logger.warning("sparse_supabase_failed", error=str(e)[:160])

        # Fallback: Elasticsearch BM25 (only if ES is provisioned).
        return await self._search_es(query, expanded_terms, filters, top_k)

    async def _search_supabase(
        self, query: str, expanded_terms: dict | None, filters: dict | None, top_k: int
    ) -> list[RetrievalResult]:
        from app.db import supabase_rest

        # websearch_to_tsquery handles phrases/OR/-, so pass the raw query plus any
        # synonyms as additional OR terms.
        q = query
        if expanded_terms and expanded_terms.get("synonyms"):
            q = q + " " + " ".join(str(s) for s in expanded_terms["synonyms"][:6])

        tickers = None
        if filters and filters.get("companies"):
            tickers = [str(t).upper() for t in filters["companies"] if t]

        rows = await supabase_rest.sb_rpc(
            "search_chunks_fts",
            {"q": q, "tickers": tickers, "k": top_k},
        )
        out: list[RetrievalResult] = []
        for r in rows:
            txt = r.get("text", "")
            if not txt:
                continue
            out.append(RetrievalResult(
                chunk_id=r.get("id", ""),
                document_id=r.get("document_id", "") or "",
                text=txt,
                score=float(r.get("rank", 0.0) or 0.0),
                metadata=r,
                document_title=r.get("document_title", "") or "",
                section=r.get("section", "") or "",
                page=r.get("page"),
                filing_date=r.get("filing_date", "") or "",
                ticker=r.get("ticker", "") or "",
            ))
        logger.info("sparse_search_supabase", results=len(out),
                    tickers=tickers, q_len=len(q))
        return out

    async def _search_es(
        self, query: str, expanded_terms: dict | None, filters: dict | None, top_k: int
    ) -> list[RetrievalResult]:
        try:
            from app.db.elasticsearch import es_client

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
            logger.info("sparse_search_es", results=len(output))
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

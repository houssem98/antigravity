"""
Gravity Search — Structured Data Search (Channel 5)

Exact financial facts from the `gravity_financials` Elasticsearch index, which
holds XBRL/table-extracted (ticker × metric × period → value) triples produced
by the ingestion TableIndexer.

This replaces the previous NL→SQL path: that queried a PostgreSQL/TimescaleDB
session that is a permanent `None` stub on the deployment (asyncpg/uvicorn
deadlock), so it always returned nothing. Querying the ES index gives the LLM
exact tagged figures (e.g. "AAPL — Total Revenue (FY2022): $394,328M") so it
stops guessing the wrong period/line-item from prose.
"""

import structlog

from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()

FINANCIALS_INDEX = "gravity_financials"


class StructuredSearch:
    """Exact financial-fact lookup over the gravity_financials ES index."""

    def __init__(self, llm_client=None):
        self.llm = llm_client  # kept for interface compatibility; unused
        self._es = None

    def _es_client(self):
        if self._es is None:
            try:
                from app.db.elasticsearch import get_es_client
                self._es = get_es_client()
            except Exception as e:
                logger.warning("structured_es_unavailable", error=str(e))
                self._es = None
        return self._es

    @staticmethod
    def _tickers(entities: dict | None, filters: dict | None) -> list[str]:
        out: list[str] = []
        for src in (entities or {}).get("companies", []) or []:
            if isinstance(src, dict) and src.get("ticker"):
                out.append(str(src["ticker"]).upper())
        for t in (filters or {}).get("companies", []) or []:
            if t:
                out.append(str(t).upper())
        return list(dict.fromkeys(out))  # dedupe, keep order

    async def search(
        self,
        query: str,
        entities: dict | None = None,
        filters: dict | None = None,
        top_k: int = 10,
    ) -> list[RetrievalResult]:
        es = self._es_client()
        if es is None:
            return []
        try:
            tickers = self._tickers(entities, filters)
            must: list[dict] = []
            if tickers:
                must.append({"terms": {"ticker": tickers}})
            should = [
                {"multi_match": {
                    "query": query,
                    "fields": ["metric_name^3", "period^2", "caption", "source_section"],
                    "type": "best_fields",
                    "fuzziness": "AUTO",
                }},
            ]
            body = {
                "size": top_k,
                "query": {"bool": {"must": must, "should": should, "minimum_should_match": 1}},
            }
            resp = await es.search(index=FINANCIALS_INDEX, body=body)
            hits = (resp.get("hits", {}) or {}).get("hits", []) if isinstance(resp, dict) else []

            output: list[RetrievalResult] = []
            for h in hits:
                s = h.get("_source", {}) or {}
                val = s.get("value_raw") or s.get("value_float")
                if val is None:
                    continue
                unit = s.get("unit", "")
                fact = (
                    f"[Financial Fact] {s.get('ticker', '')} — {s.get('metric_name', '')} "
                    f"({s.get('period', '')}): {val}{(' ' + unit) if unit else ''} "
                    f"[source: {s.get('filing_type', '')} {s.get('filing_date', '')}]"
                )
                output.append(RetrievalResult(
                    chunk_id=f"fin_{str(h.get('_id', ''))[:48]}",
                    document_id=s.get("document_id", "gravity_financials"),
                    text=fact,
                    score=float(h.get("_score", 1.0) or 1.0),
                    metadata=s,
                    ticker=s.get("ticker", ""),
                ))
            logger.info("structured_search_es", results=len(output), tickers=tickers)
            return output
        except Exception as e:
            logger.warning("structured_search_failed", error=str(e))
            return []

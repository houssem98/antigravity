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
    def _fmt_value(s: dict) -> str:
        """Human-readable value: 211915000000 USD -> '$211,915 million ($211.9B)'."""
        vf = s.get("value_float")
        unit = (s.get("unit", "") or "").upper()
        if vf is None:
            return f"{s.get('value_raw', '')} {unit}".strip()
        try:
            vf = float(vf)
        except (TypeError, ValueError):
            return f"{s.get('value_raw', '')} {unit}".strip()
        if unit in ("USD", "") and abs(vf) >= 1e6:
            return f"${vf/1e6:,.0f} million (${vf/1e9:.2f}B)"
        if unit == "USD/SHARES" or "PERSHARE" in (s.get("caption", "") or "").upper():
            return f"${vf:,.2f} per share"
        if unit in ("SHARES",):
            return f"{vf:,.0f} shares"
        return f"{vf:,.2f} {unit}".strip()

    @classmethod
    def _fact_line(cls, s: dict) -> str:
        # Period-forward + plain metric + human value, so the LLM can't miss that
        # this is the exact figure for the asked fiscal year.
        return (
            f"[EXACT FILING FIGURE] {s.get('ticker', '')} {s.get('period', '')} — "
            f"{s.get('metric_name', '')}: {cls._fmt_value(s)} "
            f"(SEC XBRL, {s.get('filing_type', '')})"
        )

    async def _search_supabase(self, query, entities, filters, top_k) -> list[RetrievalResult]:
        from app.db import supabase_rest
        tickers = self._tickers(entities, filters)
        ql = (query or "").lower()
        metric = next((m for m in self._METRIC_TERMS if m in ql), None)

        # Ticker scope is MANDATORY. Without it, a metric-only filter ("revenue")
        # returns OTHER companies' facts (e.g. a Coca-Cola query surfacing Apple/
        # Tesla/Nike revenue rows) — the exact cross-company contamination we kill
        # everywhere else. No resolved ticker → no structured facts.
        if not tickers:
            return []
        flt: dict = {}
        if len(tickers) == 1:
            flt["ticker"] = f"eq.{tickers[0]}"
        else:
            flt["ticker"] = "in.(" + ",".join(tickers) + ")"
        if metric:
            flt["metric_name"] = f"ilike.*{metric.replace(' ', '*')}*"

        rows = await supabase_rest.sb_select("financials", flt, limit=top_k)
        out: list[RetrievalResult] = []
        for r in rows:
            if r.get("value_raw") is None and r.get("value_float") is None:
                continue
            out.append(RetrievalResult(
                chunk_id=f"fin_{r.get('id', '')}"[:48],
                document_id=str(r.get("document_id", "financials")),
                text=self._fact_line(r),
                score=5.0,  # exact tagged facts outrank prose
                metadata=r,
                ticker=r.get("ticker", ""),
            ))
        logger.info("structured_search_supabase", results=len(out), tickers=tickers, metric=metric)
        return out

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

    # Metric keywords → narrow the exact-facts lookup when the query names one.
    _METRIC_TERMS = [
        "revenue", "net income", "operating income", "gross margin", "operating margin",
        "net margin", "profit margin", "operating cash flow", "free cash flow", "cash flow",
        "capital expenditure", "capex", "total assets", "total liabilities", "long-term debt",
        "total debt", "cash and", "shareholders equity", "eps", "earnings per share",
        "return on equity", "roe", "dividend", "buyback", "share repurchase", "research and development",
    ]

    async def search(
        self,
        query: str,
        entities: dict | None = None,
        filters: dict | None = None,
        top_k: int = 10,
    ) -> list[RetrievalResult]:
        # Gated OFF by default: noisy table extraction outranks prose and hurts
        # accuracy. Re-enable (settings.structured_facts_enabled) once the
        # table-parser column-alignment is fixed.
        try:
            from app.config import settings as _s
            if not getattr(_s, "structured_facts_enabled", False):
                return []
        except Exception:
            return []

        # Prefer Supabase Postgres financials table (no Elasticsearch needed).
        try:
            from app.db import supabase_rest
            if supabase_rest.configured():
                rows = await self._search_supabase(query, entities, filters, top_k)
                return rows
        except Exception as e:
            logger.warning("structured_supabase_failed", error=str(e)[:160])

        # Fallback: Elasticsearch gravity_financials (if ES is provisioned).
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

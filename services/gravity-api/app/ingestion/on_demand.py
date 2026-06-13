"""
On-demand SEC filing ingestion.

When a customer asks about a company that isn't in the corpus yet, fetch its
recent EDGAR filings (10-K/10-Q/8-K), index them live, and let the query retry
retrieval — so "ask anything about a public company" returns a cited answer
instead of "not indexed".

Reuses the same building blocks as scripts/bulk_ingest_sp500.py:
  SECEdgarSource.fetch_company_filings  (resolves any ticker via edgartools)
  IngestionPipeline.ingest_bytes / ingest_from_url

Concurrent requests for the same ticker share one in-flight ingestion task, so a
burst of users asking about the same new company indexes it only once.
"""

import asyncio
from datetime import datetime, timedelta

import structlog

logger = structlog.get_logger()


def _parse_date(date_str: str) -> datetime:
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y%m%d"):
        try:
            return datetime.strptime(date_str[:10], fmt[: len(date_str[:10])])
        except (ValueError, TypeError):
            continue
    return datetime(2000, 1, 1)


class OnDemandIngestor:
    """Lazily ingests a single company's recent filings on a corpus miss."""

    def __init__(self, pipeline=None):
        from app.ingestion.pipeline import IngestionPipeline
        from app.ingestion.sources.sec_edgar import SECEdgarSource

        # MUST use create(): the bare IngestionPipeline() leaves every indexer
        # None, so chunks are produced but written to no index (dense/bm25/graph
        # all stay empty → retrieval finds nothing). create() wires the Qdrant /
        # Elasticsearch / Neo4j writers from app settings.
        self.pipeline = pipeline or IngestionPipeline.create()
        self.edgar = SECEdgarSource(ingestion_pipeline=self.pipeline)
        self._inflight: dict[str, asyncio.Task] = {}

    async def ensure_indexed(
        self,
        ticker: str,
        filing_types: list[str],
        max_filings: int = 6,
        years_back: int = 3,
    ) -> dict:
        """Ingest the company's recent filings if not already in flight. Idempotent
        per ticker across concurrent callers."""
        ticker = (ticker or "").upper().strip()
        if not ticker:
            return {"ticker": ticker, "status": "skip", "reason": "no ticker"}

        existing = self._inflight.get(ticker)
        if existing is not None:
            try:
                return await existing
            except Exception:  # the owner logs the failure; fall through to a fresh try
                pass

        task = asyncio.ensure_future(
            self._ingest(ticker, filing_types, max_filings, years_back)
        )
        self._inflight[ticker] = task
        try:
            return await task
        finally:
            self._inflight.pop(ticker, None)

    async def _ingest(
        self, ticker: str, filing_types: list[str], max_filings: int, years_back: int
    ) -> dict:
        result = {"ticker": ticker, "ok": 0, "errors": 0, "chunks": 0, "status": "ok"}
        try:
            filings = await self.edgar.fetch_company_filings(
                ticker=ticker, filing_types=filing_types, max_filings=max_filings
            )
        except Exception as e:
            logger.warning("on_demand_fetch_failed", ticker=ticker, error=str(e)[:200])
            return {**result, "status": "error", "reason": str(e)[:200]}

        if not filings:
            return {**result, "status": "not_found"}

        cutoff = datetime.now() - timedelta(days=365 * years_back)
        recent = [f for f in filings if _parse_date(f.get("filing_date", "")) > cutoff]
        if not recent:
            recent = filings[:max_filings]

        for filing in recent:
            try:
                url = filing.get("url", "")
                content = filing.get("content", "")
                ft = filing.get("filing_type", "unknown")
                fd = filing.get("filing_date", "")
                if content:
                    r = await self.pipeline.ingest_bytes(
                        content=content.encode("utf-8"),
                        content_type="text/html",
                        filename=f"{ticker}_{ft}_{fd}.html",
                        ticker=ticker,
                        filing_type=ft,
                        filing_date=fd,
                    )
                elif url:
                    r = await self.pipeline.ingest_from_url(
                        url=url, ticker=ticker, filing_type=ft, filing_date=fd
                    )
                else:
                    continue
                if r and not r.get("error"):
                    result["ok"] += 1
                    result["chunks"] += r.get("chunk_count", 0)
                else:
                    result["errors"] += 1
                await asyncio.sleep(0.15)  # EDGAR ≤10 req/s
            except Exception as e:
                logger.warning("on_demand_filing_failed", ticker=ticker, error=str(e)[:160])
                result["errors"] += 1

        logger.info(
            "on_demand_ingest_done",
            ticker=ticker, ok=result["ok"], errors=result["errors"], chunks=result["chunks"],
        )
        return result


_INGESTOR: OnDemandIngestor | None = None


def get_on_demand_ingestor() -> OnDemandIngestor:
    """Process-wide singleton (keeps the in-flight dedupe map shared)."""
    global _INGESTOR
    if _INGESTOR is None:
        _INGESTOR = OnDemandIngestor()
    return _INGESTOR

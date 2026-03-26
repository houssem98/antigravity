"""
Gravity Search — Polygon.io Real-Time Market Data Client
Fetches price snapshots, news, and aggregate bars from Polygon.io REST API.

Docs: https://polygon.io/docs
Env:  POLYGON_API_KEY (required for live data)
"""

import asyncio
import structlog
from datetime import date, timedelta
from typing import Any

import httpx

logger = structlog.get_logger()

POLYGON_BASE = "https://api.polygon.io"


class PolygonClient:
    """
    Async HTTP client for Polygon.io.
    Falls back to empty results when POLYGON_API_KEY is not set so the rest
    of the pipeline continues in dev without valid credentials.
    """

    def __init__(self, api_key: str | None = None):
        import os
        self.api_key = api_key or os.getenv("POLYGON_API_KEY", "")
        self._http: httpx.AsyncClient | None = None

    async def _client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                base_url=POLYGON_BASE,
                params={"apiKey": self.api_key},
                timeout=10.0,
            )
        return self._http

    async def close(self) -> None:
        if self._http and not self._http.is_closed:
            await self._http.aclose()

    # ── Public methods ────────────────────────────────────────────────────

    async def get_ticker_snapshot(self, ticker: str) -> dict[str, Any]:
        """
        Fetch the latest market snapshot for a single ticker.
        Returns normalized dict compatible with structured DB ingestion.
        """
        if not self.api_key:
            logger.warning("polygon_no_api_key", ticker=ticker)
            return {}
        try:
            client = await self._client()
            r = await client.get(f"/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}")
            r.raise_for_status()
            raw = r.json().get("ticker", {})
            day = raw.get("day", {})
            return {
                "ticker": ticker,
                "close": day.get("c"),
                "open": day.get("o"),
                "high": day.get("h"),
                "low": day.get("l"),
                "volume": day.get("v"),
                "vwap": raw.get("lastTrade", {}).get("p"),
                "date": date.today().isoformat(),
                "source": "polygon",
            }
        except Exception as e:
            logger.warning("polygon_snapshot_failed", ticker=ticker, error=str(e))
            return {}

    async def get_aggregate_bars(
        self,
        ticker: str,
        from_date: date | None = None,
        to_date: date | None = None,
        timespan: str = "day",
        limit: int = 90,
    ) -> list[dict[str, Any]]:
        """
        Fetch OHLCV aggregate bars for a ticker over a date range.
        Returns list of {date, open, high, low, close, volume} dicts.
        """
        if not self.api_key:
            return []
        from_date = from_date or (date.today() - timedelta(days=90))
        to_date = to_date or date.today()
        try:
            client = await self._client()
            r = await client.get(
                f"/v2/aggs/ticker/{ticker}/range/1/{timespan}/{from_date}/{to_date}",
                params={"adjusted": "true", "sort": "asc", "limit": limit},
            )
            r.raise_for_status()
            results = r.json().get("results", [])
            return [
                {
                    "ticker": ticker,
                    "date": date.fromtimestamp(bar["t"] / 1000).isoformat(),
                    "open": bar.get("o"),
                    "high": bar.get("h"),
                    "low": bar.get("l"),
                    "close": bar.get("c"),
                    "volume": bar.get("v"),
                    "vwap": bar.get("vw"),
                }
                for bar in results
            ]
        except Exception as e:
            logger.warning("polygon_agg_failed", ticker=ticker, error=str(e))
            return []

    async def get_ticker_news(
        self,
        ticker: str,
        limit: int = 10,
        published_utc_gte: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        Fetch recent news articles for a ticker from Polygon.
        Returns list of article dicts ready for document ingestion.
        """
        if not self.api_key:
            return []
        params: dict[str, Any] = {"ticker": ticker, "limit": limit, "order": "desc", "sort": "published_utc"}
        if published_utc_gte:
            params["published_utc.gte"] = published_utc_gte
        try:
            client = await self._client()
            r = await client.get("/v2/reference/news", params=params)
            r.raise_for_status()
            articles = r.json().get("results", [])
            return [
                {
                    "id": a.get("id", ""),
                    "title": a.get("title", ""),
                    "text": a.get("description", ""),
                    "url": a.get("article_url", ""),
                    "published_at": a.get("published_utc", ""),
                    "tickers": a.get("tickers", []),
                    "publisher": a.get("publisher", {}).get("name", ""),
                    "document_type": "news",
                    "source": "polygon",
                }
                for a in articles
            ]
        except Exception as e:
            logger.warning("polygon_news_failed", ticker=ticker, error=str(e))
            return []

    async def batch_snapshots(self, tickers: list[str]) -> dict[str, dict[str, Any]]:
        """Fetch snapshots for multiple tickers concurrently (max 10 in parallel)."""
        sem = asyncio.Semaphore(10)

        async def _fetch(t: str) -> tuple[str, dict]:
            async with sem:
                return t, await self.get_ticker_snapshot(t)

        results = await asyncio.gather(*[_fetch(t) for t in tickers])
        return {ticker: snap for ticker, snap in results if snap}


    async def publish_news(self, articles: list[dict], ticker: str = "") -> int:
        """Publish Polygon news articles to the Kafka ingestion pipeline."""
        from app.ingestion.producer import get_producer
        producer = get_producer()
        published = 0
        for article in articles:
            text = (article.get("title", "") + "\n" + article.get("text", "")).strip()
            if not text:
                continue
            ok = await producer.publish_bytes(
                content=text.encode(),
                content_type="text/plain",
                source="polygon",
                ticker=ticker or ",".join(article.get("tickers", [])),
                company_name="",
                filing_type="news",
                filing_date=article.get("published_at", "")[:10] if article.get("published_at") else None,
                source_url=article.get("url", ""),
                filename=article.get("title", "")[:80],
            )
            if ok:
                published += 1
        return published


# Module-level singleton
_client: PolygonClient | None = None


def get_polygon_client() -> PolygonClient:
    global _client
    if _client is None:
        _client = PolygonClient()
    return _client

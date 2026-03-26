"""
Gravity Search — GDELT 2.0 Event Database Client
Queries the GDELT Project's free public API for geopolitical and financial news events.

GDELT API reference: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
No API key required — free public access with rate-limit courtesy of ~3s between calls.

Primary use: surface macro / geopolitical risks relevant to financial queries
(tariff risk, sanctions, supply chain disruptions, ESG events).
"""

import asyncio
import structlog
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

logger = structlog.get_logger()

GDELT_DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc"
GDELT_GEO_API = "https://api.gdeltproject.org/api/v2/geo/geo"


class GDELTClient:
    """
    Async client for the GDELT Doc 2.0 API.
    Wraps article search with financial keyword expansion and rate limiting.
    """

    # GDELT returns max 250 articles per query; keep courtesy delay
    _RATE_LIMIT_DELAY = 3.0

    def __init__(self):
        self._http: httpx.AsyncClient | None = None
        self._last_request: datetime | None = None

    async def _client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(timeout=15.0)
        return self._http

    async def _throttle(self) -> None:
        """Ensure at least _RATE_LIMIT_DELAY seconds between requests."""
        if self._last_request is not None:
            elapsed = (datetime.now(timezone.utc) - self._last_request).total_seconds()
            if elapsed < self._RATE_LIMIT_DELAY:
                await asyncio.sleep(self._RATE_LIMIT_DELAY - elapsed)
        self._last_request = datetime.now(timezone.utc)

    async def close(self) -> None:
        if self._http and not self._http.is_closed:
            await self._http.aclose()

    # ── Public methods ────────────────────────────────────────────────────

    async def search_articles(
        self,
        query: str,
        mode: str = "artlist",
        max_records: int = 25,
        timespan_hours: int = 24,
        sort: str = "DateDesc",
        source_country: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        Full-text article search using GDELT Doc 2.0.

        Args:
            query: Search terms — supports GDELT operators like "(AAPL OR Apple) tariff"
            mode: "artlist" (articles), "timelinevol" (trend)
            max_records: Max articles to return (1–250)
            timespan_hours: Look-back window in hours
            sort: "DateDesc" | "DateAsc" | "Relevance" | "ToneDesc" | "ToneAsc"
            source_country: ISO 3166-1 country code filter (e.g. "US", "CN")

        Returns:
            List of article dicts ready for document ingestion.
        """
        await self._throttle()
        params: dict[str, Any] = {
            "query": query,
            "mode": mode,
            "maxrecords": min(max_records, 250),
            "timespan": f"{timespan_hours}h",
            "sort": sort,
            "format": "json",
        }
        if source_country:
            params["query"] += f" sourcecountry:{source_country}"

        try:
            client = await self._client()
            r = await client.get(GDELT_DOC_API, params=params)
            r.raise_for_status()
            data = r.json()
            articles = data.get("articles", [])
            logger.info("gdelt_search", query=query[:60], results=len(articles))
            return [
                {
                    "id": a.get("url", ""),
                    "title": a.get("title", ""),
                    "text": a.get("seendate", "") + " " + a.get("title", ""),
                    "url": a.get("url", ""),
                    "published_at": _parse_gdelt_date(a.get("seendate", "")),
                    "tickers": [],  # enriched downstream by KG entity linking
                    "publisher": a.get("domain", ""),
                    "language": a.get("language", ""),
                    "sentiment_tone": float(a.get("socialimage", {}).get("tone", 0) if isinstance(a.get("socialimage"), dict) else 0),
                    "document_type": "news",
                    "source": "gdelt",
                }
                for a in articles
            ]
        except Exception as e:
            logger.warning("gdelt_search_failed", query=query[:60], error=str(e))
            return []

    async def get_company_risk_signals(
        self,
        company_name: str,
        ticker: str = "",
        timespan_hours: int = 72,
    ) -> list[dict[str, Any]]:
        """
        Fetch geopolitical / macro risk signals for a company.
        Builds a GDELT query combining company name, ticker, and risk keywords.
        """
        risk_terms = "(tariff OR sanction OR supply chain OR lawsuit OR recall OR strike OR bankruptcy OR regulation)"
        name_part = f'"{company_name}"'
        if ticker:
            name_part += f" OR {ticker}"
        query = f"({name_part}) AND {risk_terms}"
        return await self.search_articles(
            query=query,
            timespan_hours=timespan_hours,
            max_records=20,
            sort="ToneAsc",  # most negative sentiment first = highest risk
        )

    async def get_sector_sentiment(
        self,
        sector_query: str,
        timespan_hours: int = 48,
    ) -> dict[str, Any]:
        """
        Fetch volume/tone timeline for a sector or theme (e.g., 'semiconductor tariff').
        Returns headline aggregate for structured context injection.
        """
        await self._throttle()
        params = {
            "query": sector_query,
            "mode": "timelinevol",
            "timespan": f"{timespan_hours}h",
            "format": "json",
        }
        try:
            client = await self._client()
            r = await client.get(GDELT_DOC_API, params=params)
            r.raise_for_status()
            data = r.json()
            timeline = data.get("timeline", [])
            if not timeline:
                return {}
            # Compute average volume over the window
            values = [p.get("value", 0) for item in timeline for p in item.get("data", [])]
            avg_vol = sum(values) / len(values) if values else 0
            return {
                "query": sector_query,
                "timespan_hours": timespan_hours,
                "avg_volume": round(avg_vol, 2),
                "peak_volume": max(values, default=0),
                "data_points": len(values),
                "source": "gdelt",
            }
        except Exception as e:
            logger.warning("gdelt_timeline_failed", query=sector_query[:60], error=str(e))
            return {}


def _parse_gdelt_date(gdelt_date: str) -> str:
    """
    Convert GDELT date string (YYYYMMDDHHMMSS) to ISO 8601.
    Returns empty string on failure.
    """
    try:
        dt = datetime.strptime(gdelt_date, "%Y%m%d%H%M%S")
        return dt.replace(tzinfo=timezone.utc).isoformat()
    except Exception:
        return gdelt_date


    async def publish_articles(
        self,
        articles: list[dict],
        ticker: str = "",
    ) -> int:
        """
        Publish a list of GDELT articles to the Kafka ingestion pipeline.
        Returns the number successfully published.
        """
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
                source="gdelt",
                ticker=ticker or "",
                company_name="",
                filing_type="news",
                filing_date=article.get("published_at", "")[:10] if article.get("published_at") else None,
                source_url=article.get("url", ""),
                filename=article.get("title", "")[:80],
            )
            if ok:
                published += 1
        return published


# Module-level singleton (no auth needed)
_client: GDELTClient | None = None


def get_gdelt_client() -> GDELTClient:
    global _client
    if _client is None:
        _client = GDELTClient()
    return _client

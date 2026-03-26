"""
Gravity Search — Refinitiv / LSEG Workspace Data Platform Client
Fetches fundamental estimates, consensus data, and news from LSEG Data Platform.

Docs: https://developers.lseg.com/en/api-catalog/refinitiv-data-platform
Env:
  REFINITIV_CLIENT_ID      — RDP OAuth2 client ID
  REFINITIV_CLIENT_SECRET  — RDP OAuth2 client secret
  REFINITIV_USERNAME       — Machine ID / username
  REFINITIV_PASSWORD       — Machine ID password

Note: Full Refinitiv SDK (refinitiv-data) requires a commercial license.
This stub uses the open REST API with OAuth2 for teams that already have
a Refinitiv Desktop or Data Platform subscription.
"""

import asyncio
import structlog
from datetime import datetime, timezone
from typing import Any

import httpx

logger = structlog.get_logger()

RDP_AUTH_URL = "https://api.refinitiv.com/auth/oauth2/v1/token"
RDP_BASE = "https://api.refinitiv.com"


class RefinitivClient:
    """
    Async REST client for Refinitiv Data Platform.
    Handles token refresh automatically. Returns empty results when credentials
    are absent, enabling zero-config local development.
    """

    def __init__(
        self,
        client_id: str | None = None,
        client_secret: str | None = None,
        username: str | None = None,
        password: str | None = None,
    ):
        import os
        self.client_id = client_id or os.getenv("REFINITIV_CLIENT_ID", "")
        self.client_secret = client_secret or os.getenv("REFINITIV_CLIENT_SECRET", "")
        self.username = username or os.getenv("REFINITIV_USERNAME", "")
        self.password = password or os.getenv("REFINITIV_PASSWORD", "")
        self._token: str | None = None
        self._token_expiry: datetime | None = None
        self._http: httpx.AsyncClient | None = None

    def _is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    async def _client(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(base_url=RDP_BASE, timeout=15.0)
        return self._http

    async def _get_token(self) -> str | None:
        """Obtain or refresh OAuth2 access token using password grant."""
        if not self._is_configured():
            return None
        now = datetime.now(timezone.utc)
        if self._token and self._token_expiry and now < self._token_expiry:
            return self._token
        try:
            async with httpx.AsyncClient(timeout=10.0) as auth_client:
                r = await auth_client.post(
                    RDP_AUTH_URL,
                    data={
                        "grant_type": "password",
                        "client_id": self.client_id,
                        "username": self.username,
                        "password": self.password,
                        "scope": "trapi",
                        "takeExclusiveSignOnControl": "true",
                    },
                    auth=(self.client_id, self.client_secret),
                )
                r.raise_for_status()
                payload = r.json()
                self._token = payload["access_token"]
                expires_in = int(payload.get("expires_in", 3600))
                self._token_expiry = datetime.now(timezone.utc).replace(
                    second=datetime.now(timezone.utc).second + expires_in - 60
                )
                return self._token
        except Exception as e:
            logger.warning("refinitiv_auth_failed", error=str(e))
            return None

    async def _get(self, path: str, params: dict | None = None) -> dict:
        token = await self._get_token()
        if not token:
            return {}
        try:
            client = await self._client()
            r = await client.get(
                path,
                params=params or {},
                headers={"Authorization": f"Bearer {token}"},
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            logger.warning("refinitiv_request_failed", path=path, error=str(e))
            return {}

    async def close(self) -> None:
        if self._http and not self._http.is_closed:
            await self._http.aclose()

    # ── Public methods ────────────────────────────────────────────────────

    async def get_consensus_estimates(
        self,
        ticker: str,
        metric: str = "Revenue",
        period: str = "FY2025",
    ) -> dict[str, Any]:
        """
        Fetch analyst consensus estimates for a given company / metric / period.
        Returns normalized dict: {ticker, metric, estimate, actual, period, analyst_count}
        """
        if not self._is_configured():
            logger.debug("refinitiv_not_configured", ticker=ticker)
            return {}
        data = await self._get(
            "/data/estimates/v3/bulk-estimates",
            params={
                "universe": ticker,
                "fields": f"TR.{metric}Mean,TR.{metric}Actual,TR.{metric}NumEst",
                "period": period,
            },
        )
        if not data:
            return {}
        # Parse RDP response envelope — actual shape depends on endpoint version
        try:
            rows = data.get("data", [[]])[0]
            headers = data.get("headers", [{}])
            return {
                "ticker": ticker,
                "metric": metric,
                "period": period,
                "estimate": rows[1] if len(rows) > 1 else None,
                "actual": rows[2] if len(rows) > 2 else None,
                "analyst_count": int(rows[3]) if len(rows) > 3 and rows[3] else 0,
                "source": "refinitiv",
            }
        except Exception:
            return {}

    async def get_company_fundamentals(self, ticker: str) -> dict[str, Any]:
        """
        Fetch key fundamental metrics: P/E, EV/EBITDA, market cap, sector.
        Returns normalized dict for structured DB insertion.
        """
        if not self._is_configured():
            return {}
        fields = ",".join([
            "TR.PriceToEarnings",
            "TR.EVToEBITDA",
            "TR.MarketCap",
            "TR.GICSSector",
            "TR.GICSIndustry",
            "TR.F.TotRevenue",
            "TR.F.NetInc",
            "TR.F.GrossProfit",
        ])
        data = await self._get(
            "/data/fundamental-and-reference/v1/views/fundamental-summary",
            params={"universe": ticker, "fields": fields},
        )
        if not data:
            return {}
        try:
            row = data.get("data", [[]])[0]
            headers = [h.get("displayName", "") for h in data.get("headers", [])]
            result = dict(zip(headers, row))
            result["ticker"] = ticker
            result["source"] = "refinitiv"
            return result
        except Exception:
            return {}

    async def get_news(self, ticker: str, limit: int = 10) -> list[dict[str, Any]]:
        """
        Fetch recent Reuters / LSEG news articles for a ticker.
        Returns list of article dicts for document ingestion.
        """
        if not self._is_configured():
            return []
        data = await self._get(
            "/data/news/v1/headlines",
            params={"query": ticker, "count": limit},
        )
        articles = data.get("data", [])
        return [
            {
                "id": a.get("storyId", ""),
                "title": a.get("headlineTitle", ""),
                "text": a.get("bodyText", a.get("headlineTitle", "")),
                "url": a.get("storyId", ""),  # story retrieval requires separate call
                "published_at": a.get("versionCreated", ""),
                "tickers": [ticker],
                "publisher": "Reuters / LSEG",
                "document_type": "news",
                "source": "refinitiv",
            }
            for a in articles
        ]

    async def batch_fundamentals(self, tickers: list[str]) -> dict[str, dict]:
        """Fetch fundamentals for multiple tickers concurrently."""
        sem = asyncio.Semaphore(5)

        async def _fetch(t: str) -> tuple[str, dict]:
            async with sem:
                return t, await self.get_company_fundamentals(t)

        results = await asyncio.gather(*[_fetch(t) for t in tickers])
        return {t: d for t, d in results if d}


# Module-level singleton
_client: RefinitivClient | None = None


def get_refinitiv_client() -> RefinitivClient:
    global _client
    if _client is None:
        _client = RefinitivClient()
    return _client

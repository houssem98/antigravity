"""
Gravity Search — News Source Aggregator
Primary: NewsAPI (newsapi.org) — 100 req/day free tier
Fallback: GDELT Event Database (public, no API key needed)
"""

import structlog
from datetime import datetime, timedelta

logger = structlog.get_logger()

NEWSAPI_URL = "https://newsapi.org/v2/everything"
GDELT_API_URL = "https://api.gdeltproject.org/api/v2/doc/doc"


class NewsSource:
    """
    Fetches recent news articles for a given company/ticker.
    Returns list of dicts: {title, url, content, published_at, source}
    """

    def __init__(self, api_key: str = ""):
        self.api_key = api_key  # From settings.newsapi_key (if available)

    async def fetch_company_news(
        self,
        ticker: str,
        company_name: str,
        days: int = 7,
    ) -> list[dict]:
        """
        Fetch recent news articles for a company.

        Args:
            ticker: Stock ticker (e.g., AAPL)
            company_name: Full company name (e.g., Apple Inc)
            days: How many days back to search

        Returns:
            List of article dicts
        """
        query = f'"{company_name}" OR "{ticker}"'

        if self.api_key:
            try:
                return await self._fetch_newsapi(query, days)
            except Exception as e:
                logger.warning("newsapi_failed", error=str(e))

        # Fallback to GDELT
        try:
            return await self._fetch_gdelt(company_name, days)
        except Exception as e:
            logger.warning("gdelt_failed", error=str(e))

        return []

    async def _fetch_newsapi(self, query: str, days: int) -> list[dict]:
        """Fetch from NewsAPI.org."""
        import httpx

        from_date = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")

        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                NEWSAPI_URL,
                params={
                    "q": query,
                    "from": from_date,
                    "language": "en",
                    "sortBy": "relevancy",
                    "pageSize": 20,
                    "apiKey": self.api_key,
                },
                headers={"User-Agent": "GravitySearch/1.0"},
            )
            response.raise_for_status()
            data = response.json()

        articles = []
        for article in data.get("articles", []):
            content = article.get("content") or article.get("description") or ""
            articles.append({
                "title": article.get("title", ""),
                "url": article.get("url", ""),
                "content": content,
                "published_at": article.get("publishedAt", ""),
                "source": article.get("source", {}).get("name", "NewsAPI"),
            })

        logger.info("newsapi_fetched", count=len(articles))
        return articles

    async def _fetch_gdelt(self, company_name: str, days: int) -> list[dict]:
        """Fetch from GDELT Project (public, no API key)."""
        import httpx

        from_date = (datetime.utcnow() - timedelta(days=days)).strftime("%Y%m%d%H%M%S")

        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                GDELT_API_URL,
                params={
                    "query": f'"{company_name}" sourcelang:english',
                    "mode": "artlist",
                    "maxrecords": 20,
                    "startdatetime": from_date,
                    "format": "json",
                },
                headers={"User-Agent": "GravitySearch/1.0"},
            )
            response.raise_for_status()
            data = response.json()

        articles = []
        for article in data.get("articles", []):
            articles.append({
                "title": article.get("title", ""),
                "url": article.get("url", ""),
                "content": article.get("seendate", ""),
                "published_at": article.get("seendate", ""),
                "source": article.get("domain", "GDELT"),
            })

        logger.info("gdelt_fetched", count=len(articles))
        return articles

"""
Social Signals — Reddit + StockTwits + SeekingAlpha (plan §6.9).

Three free public sources for equity sentiment. All results tagged
`document_type="social"` and `source_quality=2` so authority-aware fusion
deprioritizes them — they're context, never citations.

Reddit:
  Public JSON: append `.json` to any subreddit / post URL. No auth needed
  for read-only. Rate limit ~30 req/min for unauthenticated.
  https://www.reddit.com/r/{sub}/search.json?q={ticker}&restrict_sr=1

StockTwits:
  Free public stream: GET /api/2/streams/symbol/{symbol}.json
  Returns 30 most-recent messages w/ bullish/bearish sentiment label.
  https://api.stocktwits.com/api/2/streams/symbol/AAPL.json

SeekingAlpha:
  No free API. RSS feed for ticker analysis exists but ToS prohibits
  scraping for re-distribution. We provide a placeholder fetcher that
  returns empty unless `SA_API_KEY` (paid Pro) is set — keeps interface
  consistent without violating ToS by default.

Outputs RetrievalResult objects with metadata.sentiment_label and
metadata.unverified=True. Compliance message: "sentiment, unverified."
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Optional
from urllib.parse import quote

import structlog

from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()


_REDDIT_BASE = "https://www.reddit.com"
_STOCKTWITS_BASE = "https://api.stocktwits.com/api/2"
_USER_AGENT = "GravitySearch/1.0 (gravity@antigravity.ai)"

# Subreddits worth searching for equity discussion.
_DEFAULT_SUBREDDITS = [
    "wallstreetbets", "stocks", "investing", "SecurityAnalysis",
    "ValueInvesting", "options", "StockMarket",
]


@dataclass
class SocialPost:
    source: str           # "reddit" | "stocktwits" | "seekingalpha"
    post_id: str
    title: str
    body: str
    url: str
    author: str = ""
    created_at: str = ""
    score: int = 0          # upvotes / likes
    sentiment_label: str = ""  # "bullish" | "bearish" | "" (StockTwits classifies; Reddit doesn't)
    subreddit: str = ""


# ─── Reddit ───────────────────────────────────────────────────────────────────

async def fetch_reddit(
    ticker: str,
    subreddits: Optional[list[str]] = None,
    max_per_sub: int = 25,
    timeout: float = 8.0,
) -> list[SocialPost]:
    """
    Search each subreddit for posts mentioning the ticker.
    Public JSON endpoint, no auth.
    """
    import httpx
    subs = subreddits or _DEFAULT_SUBREDDITS
    posts: list[SocialPost] = []

    sem = asyncio.Semaphore(3)  # be polite to reddit.com

    async def _one(sub: str):
        url = (
            f"{_REDDIT_BASE}/r/{sub}/search.json"
            f"?q={quote(ticker)}&restrict_sr=1&sort=relevance&limit={max_per_sub}"
        )
        async with sem:
            try:
                async with httpx.AsyncClient(
                    timeout=timeout, headers={"User-Agent": _USER_AGENT},
                ) as client:
                    resp = await client.get(url)
                if resp.status_code != 200:
                    return
                data = resp.json()
                for child in (data.get("data") or {}).get("children") or []:
                    p = child.get("data") or {}
                    if not p.get("title"):
                        continue
                    posts.append(SocialPost(
                        source="reddit",
                        post_id=str(p.get("id", "")),
                        title=str(p.get("title", ""))[:300],
                        body=str(p.get("selftext", ""))[:2000],
                        url=f"{_REDDIT_BASE}{p.get('permalink', '')}",
                        author=str(p.get("author", "")),
                        created_at=str(p.get("created_utc", "")),
                        score=int(p.get("score", 0) or 0),
                        subreddit=sub,
                    ))
            except Exception as e:
                logger.debug("reddit_fetch_failed", sub=sub, error=str(e))

    await asyncio.gather(*[_one(s) for s in subs])
    logger.info("reddit_posts", ticker=ticker, count=len(posts), subs=len(subs))
    return posts


# ─── StockTwits ───────────────────────────────────────────────────────────────

async def fetch_stocktwits(ticker: str, timeout: float = 8.0) -> list[SocialPost]:
    """Public StockTwits stream for a symbol — last ~30 messages."""
    import httpx
    url = f"{_STOCKTWITS_BASE}/streams/symbol/{quote(ticker)}.json"
    try:
        async with httpx.AsyncClient(
            timeout=timeout, headers={"User-Agent": _USER_AGENT},
        ) as client:
            resp = await client.get(url)
        if resp.status_code != 200:
            logger.debug("stocktwits_status", ticker=ticker, status=resp.status_code)
            return []
        data = resp.json()
    except Exception as e:
        logger.debug("stocktwits_fetch_failed", ticker=ticker, error=str(e))
        return []

    out: list[SocialPost] = []
    for m in data.get("messages") or []:
        ent = m.get("entities") or {}
        sentiment = ((ent.get("sentiment") or {}).get("basic") or "").lower()
        out.append(SocialPost(
            source="stocktwits",
            post_id=str(m.get("id", "")),
            title="",  # StockTwits posts have no title
            body=str(m.get("body", ""))[:2000],
            url=f"https://stocktwits.com/{m.get('user', {}).get('username', '')}/message/{m.get('id', '')}",
            author=str((m.get("user") or {}).get("username", "")),
            created_at=str(m.get("created_at", "")),
            sentiment_label=sentiment,
        ))
    logger.info("stocktwits_posts", ticker=ticker, count=len(out))
    return out


# ─── SeekingAlpha (placeholder) ───────────────────────────────────────────────

async def fetch_seekingalpha(ticker: str, timeout: float = 8.0) -> list[SocialPost]:
    """
    SeekingAlpha has no free public API and ToS prohibits scraping for
    re-distribution. Returns [] unless SA_API_KEY is set (paid Pro tier).
    """
    import os
    if not os.getenv("SA_API_KEY"):
        return []
    # Real impl would call SA Pro. Placeholder logs+returns [].
    logger.info("seekingalpha_skipped_no_key", ticker=ticker)
    return []


# ─── Aggregator → RetrievalResult ─────────────────────────────────────────────

async def fetch_all_social(
    ticker: str,
    include_reddit: bool = True,
    include_stocktwits: bool = True,
    include_seekingalpha: bool = True,
) -> list[SocialPost]:
    tasks = []
    if include_reddit:
        tasks.append(fetch_reddit(ticker))
    if include_stocktwits:
        tasks.append(fetch_stocktwits(ticker))
    if include_seekingalpha:
        tasks.append(fetch_seekingalpha(ticker))
    nested = await asyncio.gather(*tasks, return_exceptions=True)
    out: list[SocialPost] = []
    for n in nested:
        if isinstance(n, list):
            out.extend(n)
        elif isinstance(n, Exception):
            logger.debug("social_task_failed", error=str(n))
    return out


def social_posts_to_results(
    posts: list[SocialPost],
    ticker: str = "",
    max_results: int = 50,
) -> list[RetrievalResult]:
    """
    Convert SocialPost list into RetrievalResult objects with low source_quality.
    Tagged metadata.unverified=True so downstream UI / agents can label.
    """
    results: list[RetrievalResult] = []
    for p in posts[:max_results]:
        text = (p.title + "\n" + p.body).strip() if p.title else p.body
        if not text:
            continue
        results.append(RetrievalResult(
            chunk_id=f"{p.source}::{p.post_id}",
            document_id=f"{p.source}::{p.post_id}",
            text=text[:2000],
            score=min(1.0, max(0.1, (p.score or 0) / 1000.0)),
            metadata={
                "source": p.source,
                "url": p.url,
                "source_url": p.url,
                "author": p.author,
                "created_at": p.created_at,
                "subreddit": p.subreddit,
                "sentiment_label": p.sentiment_label,
                "unverified": True,
                "ticker": ticker,
            },
            document_title=(p.title or f"{p.source} post {p.post_id}")[:200],
            document_type="social",
            source_quality=2,    # plan §6.4: "sentiment, unverified" tier
            ticker=ticker,
        ))
    logger.info("social_to_results", ticker=ticker, count=len(results))
    return results

"""
Gravity Search — Entity Resolver

Disambiguates company mentions to canonical (ticker, CIK, name) tuples using:
  1. In-memory ticker → CIK map bootstrapped from SEC company_tickers.json (free, ~800KB).
  2. Fuzzy name matching for partial/informal company names ("Apple" → AAPL not APLE).
  3. Confidence scoring — returns UNKNOWN when ambiguous rather than wrong answer.

Why this matters (from the benchmark doc):
  "Apple Inc." vs "Apple Hospitality REIT" — cosine similarity alone can't distinguish.
  A query for "Apple revenue" should never pull APLE (hotel REIT) passages.

Usage:
    resolver = await EntityResolver.build()          # downloads SEC map once, caches in Redis
    result = await resolver.resolve("Apple")         # → ResolvedEntity(ticker="AAPL", cik="320193", ...)
    result = await resolver.resolve("Apple Hospitality") # → ResolvedEntity(ticker="APLE", ...)
    result = await resolver.resolve("AAPL")          # → exact ticker lookup

Cache:
    SEC company_tickers.json is fetched once and cached in Redis (TTL 24h).
    Falls back to in-memory dict on Redis failure.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Optional

import httpx
import structlog

logger = structlog.get_logger()

_SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
_REDIS_KEY = "gravity:entity_resolver:company_tickers"
_CACHE_TTL = 86400  # 24h


@dataclass
class ResolvedEntity:
    ticker: str
    cik: str
    name: str
    confidence: float          # 0.0–1.0
    match_type: str            # "exact_ticker" | "exact_cik" | "fuzzy_name" | "unknown"
    alternatives: list[dict] = field(default_factory=list)  # other candidates


_UNKNOWN = ResolvedEntity(
    ticker="", cik="", name="", confidence=0.0, match_type="unknown"
)

# Common informal → canonical mappings that fuzzy match misses
_ALIASES: dict[str, str] = {
    "apple":         "AAPL",
    "google":        "GOOGL",
    "alphabet":      "GOOGL",
    "microsoft":     "MSFT",
    "amazon":        "AMZN",
    "meta":          "META",
    "facebook":      "META",
    "nvidia":        "NVDA",
    "tesla":         "TSLA",
    "netflix":       "NFLX",
    "berkshire":     "BRK.B",
    "jpmorgan":      "JPM",
    "jp morgan":     "JPM",
    "goldman":       "GS",
    "goldman sachs": "GS",
    "morgan stanley":"MS",
    "johnson":       "JNJ",  # ambiguous — prefer J&J by frequency
    "pfizer":        "PFE",
    "exxon":         "XOM",
    "chevron":       "CVX",
    "walmart":       "WMT",
    "visa":          "V",
    "mastercard":    "MA",
    "salesforce":    "CRM",
    "adobe":         "ADBE",
    "qualcomm":      "QCOM",
    "broadcom":      "AVGO",
    "oracle":        "ORCL",
    "intel":         "INTC",
    "amd":           "AMD",
    "palantir":      "PLTR",
    "snowflake":     "SNOW",
    "spotify":       "SPOT",
    "airbnb":        "ABNB",
    "uber":          "UBER",
    "lyft":          "LYFT",
    "coinbase":      "COIN",
    "robinhood":     "HOOD",
}


def _normalize(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()


def _token_overlap(a: str, b: str) -> float:
    """Simple token-overlap similarity — fast, no dependencies."""
    ta = set(_normalize(a).split())
    tb = set(_normalize(b).split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(len(ta), len(tb))


class EntityResolver:
    """
    Resolves company mentions → (ticker, CIK, name).

    Build via `await EntityResolver.build(redis_client)`.
    Call via `await resolver.resolve(mention)`.
    """

    def __init__(self, ticker_map: dict[str, dict], name_index: list[tuple[str, dict]]):
        # ticker_map: upper(ticker) → {ticker, cik, name}
        self._ticker_map = ticker_map
        # name_index: [(normalized_name, entry)] sorted by name length desc for greedy match
        self._name_index = name_index
        logger.info("entity_resolver_ready", companies=len(ticker_map))

    @classmethod
    async def build(cls, redis_client=None) -> "EntityResolver":
        """
        Build resolver from SEC company_tickers.json.
        Tries Redis cache first, falls back to live HTTP fetch.
        """
        raw: Optional[dict] = None

        # Try Redis cache
        if redis_client is not None:
            try:
                cached = await redis_client.get(_REDIS_KEY)
                if cached:
                    raw = json.loads(cached)
                    logger.debug("entity_resolver_cache_hit")
            except Exception as e:
                logger.warning("entity_resolver_redis_error", error=str(e))

        # Fetch from SEC if cache miss
        if raw is None:
            t0 = time.perf_counter()
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.get(
                        _SEC_TICKERS_URL,
                        headers={"User-Agent": "GravitySearch/1.0 (gravity@antigravity.ai)"},
                    )
                    resp.raise_for_status()
                    raw = resp.json()
                ms = (time.perf_counter() - t0) * 1000
                logger.info("entity_resolver_fetched", companies=len(raw), ms=round(ms))
            except Exception as e:
                logger.warning("entity_resolver_fetch_failed", error=str(e))
                raw = {}

            # Cache in Redis
            if raw and redis_client is not None:
                try:
                    await redis_client.setex(_REDIS_KEY, _CACHE_TTL, json.dumps(raw))
                except Exception:
                    pass

        return cls._from_raw(raw or {})

    @classmethod
    def _from_raw(cls, raw: dict) -> "EntityResolver":
        """Parse SEC company_tickers.json into lookup structures."""
        ticker_map: dict[str, dict] = {}
        name_index: list[tuple[str, dict]] = []

        for _idx, entry in raw.items():
            ticker = str(entry.get("ticker", "")).upper()
            cik = str(entry.get("cik_str", entry.get("cik", ""))).zfill(10)
            name = str(entry.get("title", "")).strip()
            if not ticker or not name:
                continue

            rec = {"ticker": ticker, "cik": cik, "name": name}
            ticker_map[ticker] = rec
            norm = _normalize(name)
            if norm:
                name_index.append((norm, rec))

        # Sort by name length descending so longer/more-specific names match first
        name_index.sort(key=lambda x: len(x[0]), reverse=True)
        return cls(ticker_map, name_index)

    async def resolve(self, mention: str, top_k: int = 3) -> ResolvedEntity:
        """
        Resolve a company mention to a canonical entity.

        Lookup priority:
          1. Exact ticker (AAPL, MSFT, BRK.B)
          2. Alias table (apple → AAPL, google → GOOGL)
          3. Fuzzy name match against SEC corpus
          4. UNKNOWN (confidence < 0.5)
        """
        if not mention:
            return _UNKNOWN

        mention_stripped = mention.strip()
        mention_upper = mention_stripped.upper()
        mention_norm = _normalize(mention_stripped)

        # ── 1. Exact ticker lookup ────────────────────────────────────────
        if mention_upper in self._ticker_map:
            e = self._ticker_map[mention_upper]
            return ResolvedEntity(
                ticker=e["ticker"], cik=e["cik"], name=e["name"],
                confidence=1.0, match_type="exact_ticker",
            )

        # ── 2. Alias table ────────────────────────────────────────────────
        alias_ticker = _ALIASES.get(mention_norm)
        if alias_ticker and alias_ticker in self._ticker_map:
            e = self._ticker_map[alias_ticker]
            return ResolvedEntity(
                ticker=e["ticker"], cik=e["cik"], name=e["name"],
                confidence=0.97, match_type="exact_ticker",
            )

        # ── 3. Fuzzy name match ───────────────────────────────────────────
        candidates: list[tuple[float, dict]] = []
        for norm_name, entry in self._name_index:
            score = _token_overlap(mention_norm, norm_name)
            if score >= 0.5:
                candidates.append((score, entry))
        candidates.sort(key=lambda x: x[0], reverse=True)

        if candidates:
            best_score, best = candidates[0]
            alternatives = [
                {"ticker": e["ticker"], "name": e["name"], "score": round(s, 3)}
                for s, e in candidates[1:top_k]
            ]
            # Require score ≥ 0.7 to avoid false positives
            if best_score >= 0.7:
                return ResolvedEntity(
                    ticker=best["ticker"], cik=best["cik"], name=best["name"],
                    confidence=round(best_score, 3), match_type="fuzzy_name",
                    alternatives=alternatives,
                )

        return _UNKNOWN

    async def resolve_many(self, mentions: list[str]) -> list[ResolvedEntity]:
        """Resolve multiple mentions concurrently."""
        import asyncio
        return await asyncio.gather(*[self.resolve(m) for m in mentions])

    def is_ready(self) -> bool:
        return len(self._ticker_map) > 0


# ── Module-level singleton (lazy-built) ──────────────────────────────────────

_resolver: Optional[EntityResolver] = None


async def get_resolver(redis_client=None) -> EntityResolver:
    """Return the module-level singleton, building it on first call."""
    global _resolver
    if _resolver is None or not _resolver.is_ready():
        _resolver = await EntityResolver.build(redis_client)
    return _resolver

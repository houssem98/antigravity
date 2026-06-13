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
    # Cross-references — populated lazily via enrich() when needed.
    lei: str = ""              # Legal Entity Identifier (ISO 17442) from GLEIF
    cusip: str = ""            # CUSIP — first 6 chars from SEC ticker file
    former_names: list[str] = field(default_factory=list)  # historical aliases
    parent_cik: str = ""       # if known parent (multi-CIK group)


_UNKNOWN = ResolvedEntity(
    ticker="", cik="", name="", confidence=0.0, match_type="unknown"
)

# GLEIF — Global LEI Foundation. Free public API.
# https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=APPLE+INC
_GLEIF_BASE = "https://api.gleif.org/api/v1/lei-records"

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


# Corporate suffixes / filler that dilute name matching. "Rocket Lab USA, Inc."
# must reduce to {rocket, lab} so a "Rocket Lab" mention is an exact token-set
# match instead of a 0.5 partial that ties with "Rocket Pharmaceuticals".
_CORP_STOPWORDS: frozenset[str] = frozenset({
    "inc", "incorporated", "corp", "corporation", "co", "company", "companies",
    "ltd", "limited", "plc", "lp", "llp", "llc", "holdings", "holding", "group",
    "the", "usa", "us", "sa", "ag", "nv", "se", "ab", "oyj", "class", "common",
    "stock", "ord", "ordinary", "shares", "share", "ads", "adr", "trust", "fund",
})


def _content_tokens(norm: str) -> set[str]:
    """Tokens of a normalized name with corporate suffixes/filler removed."""
    return {t for t in norm.split() if t and t not in _CORP_STOPWORDS}


def _token_overlap(a: str, b: str) -> float:
    """Content-token overlap similarity — fast, no dependencies."""
    ta = _content_tokens(_normalize(a))
    tb = _content_tokens(_normalize(b))
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
        # Containment-based: mention's tokens must all appear in entity name.
        # Score = mention-tokens / entity-tokens. Highest specificity wins.
        mention_tokens = _content_tokens(mention_norm)
        candidates: list[tuple[float, dict]] = []
        for norm_name, entry in self._name_index:
            name_tokens = _content_tokens(norm_name)
            if not name_tokens:
                continue
            if mention_tokens and mention_tokens.issubset(name_tokens):
                # Containment is a strong signal even when the official name has
                # extra descriptors ("Rivian" ⊂ "Rivian Automotive"). Floor the
                # score above the accept gate; exact set wins outright; ratio
                # still ranks specificity among containment matches.
                score = 1.0 if mention_tokens == name_tokens else 0.5 + 0.5 * (len(mention_tokens) / len(name_tokens))
                candidates.append((score, entry))
            else:
                # Symmetric token overlap as a fallback for partial overlaps
                score = _token_overlap(mention_norm, norm_name)
                if score >= 0.5:
                    candidates.append((score, entry))
        # Sort by score, then prefer the most specific (fewest-token) name on ties.
        candidates.sort(key=lambda x: (x[0], -len(_content_tokens(_normalize(x[1]["name"])))), reverse=True)

        if candidates:
            best_score, best = candidates[0]
            alternatives = [
                {"ticker": e["ticker"], "name": e["name"], "score": round(s, 3)}
                for s, e in candidates[1:top_k]
            ]
            # Require ≥ 0.5 — disambiguation surfaces alternatives so callers
            # can choose, instead of silently returning UNKNOWN.
            if best_score >= 0.5:
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

    async def disambiguate(
        self, mention: str, top_k: int = 5,
    ) -> list[ResolvedEntity]:
        """
        Return ALL plausible matches sorted by confidence, instead of one.

        Used by retrieval when the same name maps to multiple CIKs:
          "Apple"  → [Apple Inc. (AAPL), Apple Hospitality REIT (APLE)]
          "Coach"  → [Tapestry / Coach (TPR), Coach Industries (COHU)]

        Caller can ask the user to pick or filter by additional context
        (sector, market-cap, ticker hint).
        """
        if not mention:
            return []

        mention_norm = _normalize(mention)
        results: list[ResolvedEntity] = []

        # Exact ticker match always wins as #1
        upper = mention.strip().upper()
        if upper in self._ticker_map:
            e = self._ticker_map[upper]
            results.append(ResolvedEntity(
                ticker=e["ticker"], cik=e["cik"], name=e["name"],
                confidence=1.0, match_type="exact_ticker",
            ))

        # Token-containment candidates — every entity whose name contains all
        # mention tokens is a plausible match. Score by token-overlap.
        mention_tokens = set(mention_norm.split())
        for norm_name, entry in self._name_index:
            if entry["ticker"] == upper:
                continue  # already added above
            name_tokens = set(norm_name.split())
            if mention_tokens.issubset(name_tokens):
                # All mention tokens present in entity name = plausible match.
                score = len(mention_tokens) / max(len(name_tokens), 1)
                # Floor at 0.3 so short mentions ("Apple") still surface
                # multi-word entities ("Apple Hospitality REIT Inc").
                results.append(ResolvedEntity(
                    ticker=entry["ticker"], cik=entry["cik"], name=entry["name"],
                    confidence=round(max(score, 0.3), 3), match_type="fuzzy_name",
                ))
                if len(results) >= top_k * 2:
                    break

        results.sort(key=lambda r: r.confidence, reverse=True)
        return results[:top_k]

    async def enrich(
        self,
        entity: ResolvedEntity,
        with_lei: bool = True,
        with_submissions: bool = True,
        redis_client=None,
    ) -> ResolvedEntity:
        """
        Populate cross-reference IDs (LEI, former names, CUSIP-like ticker history)
        for an already-resolved entity. Network calls — call only when needed.
        """
        import asyncio
        tasks = []
        if with_lei and not entity.lei and entity.name:
            tasks.append(self._fetch_lei(entity.name, redis_client))
        else:
            tasks.append(None)
        if with_submissions and entity.cik and not entity.former_names:
            tasks.append(self._fetch_submissions_metadata(entity.cik, redis_client))
        else:
            tasks.append(None)

        results = await asyncio.gather(
            *[t for t in tasks if t is not None],
            return_exceptions=True,
        )
        idx = 0
        if with_lei and not entity.lei and entity.name:
            r = results[idx]; idx += 1
            if isinstance(r, str) and r:
                entity.lei = r
        if with_submissions and entity.cik and not entity.former_names:
            r = results[idx] if idx < len(results) else None
            if isinstance(r, dict):
                entity.former_names = r.get("former_names", [])
                entity.parent_cik = r.get("parent_cik", "") or entity.parent_cik
        return entity

    async def _fetch_lei(self, legal_name: str, redis_client=None) -> str:
        """Look up LEI by legal name via GLEIF public API. Caches per-name."""
        cache_key = f"gravity:lei:{_normalize(legal_name)}"
        if redis_client is not None:
            try:
                cached = await redis_client.get(cache_key)
                if cached:
                    return cached.decode() if isinstance(cached, bytes) else cached
            except Exception:
                pass
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                resp = await client.get(
                    _GLEIF_BASE,
                    params={"filter[entity.legalName]": legal_name, "page[size]": 5},
                    headers={"Accept": "application/vnd.api+json"},
                )
                if resp.status_code != 200:
                    return ""
                data = resp.json().get("data") or []
                if not data:
                    return ""
                # Prefer ACTIVE registrations
                for rec in data:
                    attrs = rec.get("attributes") or {}
                    reg = attrs.get("registration") or {}
                    if (reg.get("status") or "").upper() == "ISSUED":
                        lei = rec.get("id", "")
                        if redis_client is not None:
                            try:
                                await redis_client.setex(cache_key, _CACHE_TTL, lei)
                            except Exception:
                                pass
                        return lei
                # Fallback: first record
                lei = data[0].get("id", "")
                if redis_client is not None:
                    try:
                        await redis_client.setex(cache_key, _CACHE_TTL, lei)
                    except Exception:
                        pass
                return lei
        except Exception as e:
            logger.debug("lei_lookup_failed", name=legal_name, error=str(e))
            return ""

    async def _fetch_submissions_metadata(self, cik: str, redis_client=None) -> dict:
        """
        Fetch SEC submissions JSON metadata. Returns:
          {"former_names": [...], "parent_cik": "...", "tickers": [...]}
        Used to flag multi-CIK ambiguity (e.g. Apple Inc has only one CIK,
        Berkshire Hathaway A and B have separate CIKs).
        """
        cache_key = f"gravity:submissions_meta:{cik}"
        if redis_client is not None:
            try:
                cached = await redis_client.get(cache_key)
                if cached:
                    raw = cached.decode() if isinstance(cached, bytes) else cached
                    return json.loads(raw)
            except Exception:
                pass

        url = f"https://data.sec.gov/submissions/CIK{str(int(cik)).zfill(10)}.json"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    url,
                    headers={"User-Agent": "GravitySearch/1.0 (gravity@antigravity.ai)"},
                )
                if resp.status_code != 200:
                    return {}
                data = resp.json()
                meta = {
                    "former_names": [
                        n.get("name", "") for n in (data.get("formerNames") or [])
                        if n.get("name")
                    ],
                    "tickers": data.get("tickers") or [],
                    "parent_cik": "",  # SEC doesn't publish parent links here
                }
                if redis_client is not None:
                    try:
                        await redis_client.setex(cache_key, _CACHE_TTL, json.dumps(meta))
                    except Exception:
                        pass
                return meta
        except Exception as e:
            logger.debug("submissions_meta_failed", cik=cik, error=str(e))
            return {}


# ── Module-level singleton (lazy-built) ──────────────────────────────────────

_resolver: Optional[EntityResolver] = None


async def get_resolver(redis_client=None) -> EntityResolver:
    """Return the module-level singleton, building it on first call."""
    global _resolver
    if _resolver is None or not _resolver.is_ready():
        _resolver = await EntityResolver.build(redis_client)
    return _resolver

"""
Gravity Search — Cached Embedder (token optimizer)

Wraps any embedder and cuts the volume of text sent to the embedding API so the
rate-limit ceiling moves much further away:

  1. Content-hash cache (Redis): identical text is embedded once, ever. Re-ingesting
     the same filing, overlapping small-to-big chunks, and repeated queries become
     near-zero-cost cache hits instead of fresh API calls.
  2. Pre-embed text trim: collapse the whitespace/newline bloat that SEC filings
     carry, and cap absurdly long chunks — fewer tokens per request, same meaning.

All cached vectors are settings.embedding_dimensions long, so they stay drop-in
compatible with the Qdrant collection. Cache failures degrade silently to a live
embed — the cache can never break embedding.
"""

import hashlib
import re

import structlog

from app.config import settings

logger = structlog.get_logger()

try:
    import orjson

    def _dumps(o) -> bytes: return orjson.dumps(o)
    def _loads(b): return orjson.loads(b)
except Exception:  # pragma: no cover
    import json

    def _dumps(o) -> bytes: return json.dumps(o).encode()
    def _loads(b): return json.loads(b)


_WS = re.compile(r"[ \t]+")
_NL = re.compile(r"\n{3,}")
_MAX_CHARS = 24000  # ~8k tokens — guards the model context without truncating real chunks


def optimize_for_embedding(text: str) -> str:
    """Strip the whitespace bloat filings carry; cap pathological length. Keeps
    all semantic content — this is lossless for retrieval, only drops filler."""
    if not text:
        return text
    t = text.replace("\r\n", "\n").replace("\r", "\n")
    t = _WS.sub(" ", t)
    t = "\n".join(line.strip() for line in t.split("\n"))
    t = _NL.sub("\n\n", t).strip()
    if len(t) > _MAX_CHARS:
        t = t[:_MAX_CHARS]
    return t


class CachedEmbedder:
    """Content-hash embedding cache around an inner embedder."""

    name = "cached"

    def __init__(self, inner, redis=None, ttl: int = 2_592_000, tag: str = "v1"):
        self.inner = inner
        self._redis = redis
        self.ttl = ttl
        self.tag = tag
        self.dimensions = getattr(inner, "dimensions", settings.embedding_dimensions)

    def _key(self, text: str) -> str:
        h = hashlib.sha1(text.encode("utf-8", errors="ignore")).hexdigest()
        return f"emb:{self.tag}:{settings.embedding_dimensions}:{h}"

    async def _mget(self, keys: list[str]) -> list[list[float] | None]:
        if not self._redis or not keys:
            return [None] * len(keys)
        try:
            raw = await self._redis.mget(keys)
            out: list[list[float] | None] = []
            for v in raw:
                if v is None:
                    out.append(None)
                else:
                    try:
                        out.append(_loads(v))
                    except Exception:
                        out.append(None)
            return out
        except Exception as e:
            logger.debug("emb_cache_get_failed", error=str(e)[:120])
            return [None] * len(keys)

    async def _set(self, key: str, vec: list[float]) -> None:
        if not self._redis:
            return
        try:
            await self._redis.setex(key, self.ttl, _dumps(vec))
        except Exception:
            pass

    async def embed_query(self, query: str) -> list[float]:
        q = optimize_for_embedding(query)
        key = self._key("Q:" + q)
        hit = (await self._mget([key]))[0]
        if hit is not None:
            return hit
        vec = await self.inner.embed_query(q)
        await self._set(key, vec)
        return vec

    async def embed_documents(self, texts: list[str], batch_size: int = 128) -> list[list[float]]:
        if not texts:
            return []
        opt = [optimize_for_embedding(t) for t in texts]
        keys = [self._key(t) for t in opt]
        cached = await self._mget(keys)

        miss_idx = [i for i, c in enumerate(cached) if c is None]
        if miss_idx:
            miss_texts = [opt[i] for i in miss_idx]
            fresh = await self.inner.embed_documents(miss_texts, batch_size=batch_size)
            for j, i in enumerate(miss_idx):
                if j < len(fresh):
                    cached[i] = fresh[j]
                    await self._set(keys[i], fresh[j])
        logger.info(
            "emb_cache",
            total=len(texts), hits=len(texts) - len(miss_idx), misses=len(miss_idx),
        )
        # Return aligned 1:1 with `texts` (caller zips vectors↔chunks). Backfill any
        # residual gap with a live single embed so length always matches.
        result: list[list[float]] = []
        for i, c in enumerate(cached):
            if c is None:
                c = await self.inner.embed_query(opt[i])
                await self._set(keys[i], c)
            result.append(c)
        return result

"""
Gravity Search — Semantic Cache
Redis-based cache that matches queries by embedding similarity, not exact text.
A query with cosine similarity > 0.95 to a cached query returns the cached result.

Cache hit rate target: 20-30%
Estimated savings: 25-35% reduction in LLM API calls
"""

import json
import time
import hashlib

import numpy as np
import structlog

from app.config import settings
from app.db.redis import redis_client

logger = structlog.get_logger()

# v2: bumped to orphan pre-fix entries poisoned by cross-company drift
# (Amazon-labelled answers grounded on Kroger). Old keys age out via TTL.
CACHE_PREFIX = "gscache:v6:"
CACHE_EMBEDDING_PREFIX = "gscache_emb:v6:"


class SemanticCache:
    """Embedding-similarity cache for repeated/similar queries."""

    def __init__(self, embedder, ttl: int | None = None, threshold: float | None = None):
        self.embedder = embedder
        self.ttl = ttl or settings.semantic_cache_ttl
        self.threshold = threshold or settings.semantic_cache_threshold

    @staticmethod
    def _ns(tickers: list[str] | None) -> str:
        """Namespace cache by the resolved company set so a query about one
        company can never semantically match a cached answer for another — the
        query *template* ("revenue growth for X in 2025") is >0.95 similar across
        companies, so a global cache returns the wrong company's answer."""
        if not tickers:
            return "_"
        return "|".join(sorted({t.upper() for t in tickers if t}))

    async def get(self, query: str, tickers: list[str] | None = None) -> dict | None:
        """Check if a similar query exists in cache. Returns cached result or None."""
        try:
            ns = self._ns(tickers)
            # Quick exact-match check first (cheap)
            query_hash = hashlib.md5(query.lower().strip().encode()).hexdigest()
            exact = await redis_client.get(f"{CACHE_PREFIX}exact:{ns}:{query_hash}")
            if exact:
                logger.info("cache_hit", type="exact")
                return json.loads(exact)

            # Semantic similarity check (more expensive) — scan ONLY this
            # company namespace so cross-company false hits are impossible.
            query_embedding = await self.embedder.embed_query(query)

            keys = []
            async for key in redis_client.scan_iter(f"{CACHE_EMBEDDING_PREFIX}{ns}:*", count=100):
                keys.append(key)

            if not keys:
                return None

            # Compare against cached embeddings
            best_score = 0.0
            best_key = None

            for key in keys[:200]:  # Cap at 200 comparisons
                cached_emb_str = await redis_client.get(key)
                if not cached_emb_str:
                    continue
                cached_emb = json.loads(cached_emb_str)
                score = self._cosine_similarity(query_embedding, cached_emb)
                if score > best_score:
                    best_score = score
                    best_key = key

            if best_score >= self.threshold and best_key:
                # Retrieve the cached result
                result_key = best_key.replace(CACHE_EMBEDDING_PREFIX, CACHE_PREFIX)
                cached_result = await redis_client.get(result_key)
                if cached_result:
                    logger.info("cache_hit", type="semantic", score=round(best_score, 3))
                    return json.loads(cached_result)

            return None

        except Exception as e:
            logger.warning("cache_get_error", error=str(e))
            return None

    async def set(self, query: str, result: dict, tickers: list[str] | None = None) -> None:
        """Cache a query result with both exact and semantic matching, scoped to
        the resolved company namespace."""
        try:
            ns = self._ns(tickers)
            query_hash = hashlib.md5(query.lower().strip().encode()).hexdigest()

            # Store exact match (namespaced)
            await redis_client.setex(
                f"{CACHE_PREFIX}exact:{ns}:{query_hash}",
                self.ttl,
                json.dumps(result),
            )

            # Store result keyed by the embedding's namespaced key so get() can
            # map embedding-key → result-key by simple prefix swap.
            await redis_client.setex(
                f"{CACHE_PREFIX}{ns}:{query_hash}",
                self.ttl,
                json.dumps(result),
            )

            # Store embedding for semantic matching (namespaced)
            query_embedding = await self.embedder.embed_query(query)
            await redis_client.setex(
                f"{CACHE_EMBEDDING_PREFIX}{ns}:{query_hash}",
                self.ttl,
                json.dumps(query_embedding),
            )

            logger.debug("cache_set", ns=ns, query_hash=query_hash)

        except Exception as e:
            logger.warning("cache_set_error", error=str(e))

    def _cosine_similarity(self, a: list[float], b: list[float]) -> float:
        """Compute cosine similarity between two vectors."""
        a_arr = np.array(a)
        b_arr = np.array(b)
        dot = np.dot(a_arr, b_arr)
        norm = np.linalg.norm(a_arr) * np.linalg.norm(b_arr)
        if norm == 0:
            return 0.0
        return float(dot / norm)

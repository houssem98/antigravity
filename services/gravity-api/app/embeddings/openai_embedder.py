"""
Gravity Search — OpenAI Embedder (failover)

text-embedding-3-small with dimensions pinned to settings.embedding_dimensions
(1024) via the native `dimensions` parameter, so it is drop-in compatible with
the existing Qdrant collection. 8191-token context handles long filing chunks.
~$0.02/1M tokens — embedding a 10-K costs ~$0.01.
"""

import asyncio
import random

import structlog

from app.config import settings

logger = structlog.get_logger()


async def _with_backoff(coro_factory, *, what: str):
    """Run an embedding call, retrying on 429 / transient errors with exponential
    backoff + jitter so a rate-limit blip doesn't drop the request to failover."""
    attempts = max(1, getattr(settings, "embedding_max_retries", 4))
    last: Exception | None = None
    for i in range(attempts):
        try:
            return await coro_factory()
        except Exception as e:  # noqa: BLE001 — inspect message for rate-limit signal
            last = e
            msg = str(e).lower()
            retriable = "429" in msg or "rate limit" in msg or "timeout" in msg or "overloaded" in msg
            if not retriable or i == attempts - 1:
                raise
            delay = min(2 ** i, 16) + random.uniform(0, 0.5)
            logger.warning("openai_embed_retry", what=what, attempt=i + 1, delay_s=round(delay, 2))
            await asyncio.sleep(delay)
    raise last  # unreachable


class OpenAIEmbedder:
    """OpenAI text-embedding-3-large embeddings (1024-dim)."""

    name = "openai"

    def __init__(self, model: str = "text-embedding-3-small"):
        from openai import AsyncOpenAI

        self.model = model
        self.dimensions = settings.embedding_dimensions
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def embed_query(self, query: str) -> list[float]:
        resp = await _with_backoff(
            lambda: self._client.embeddings.create(
                model=self.model, input=[query], dimensions=self.dimensions,
            ),
            what="query",
        )
        return resp.data[0].embedding

    async def embed_documents(self, texts: list[str], batch_size: int = 128) -> list[list[float]]:
        all_embeddings: list[list[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            resp = await _with_backoff(
                lambda b=batch: self._client.embeddings.create(
                    model=self.model, input=b, dimensions=self.dimensions,
                ),
                what="documents",
            )
            all_embeddings.extend(d.embedding for d in resp.data)
            logger.debug("openai_embed_batch", batch=i // batch_size + 1, size=len(batch))
        return all_embeddings

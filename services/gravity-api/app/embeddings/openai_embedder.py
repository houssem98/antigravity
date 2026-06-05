"""
Gravity Search — OpenAI Embedder (failover)

text-embedding-3-small with dimensions pinned to settings.embedding_dimensions
(1024) via the native `dimensions` parameter, so it is drop-in compatible with
the existing Qdrant collection. 8191-token context handles long filing chunks.
~$0.02/1M tokens — embedding a 10-K costs ~$0.01.
"""

import structlog

from app.config import settings

logger = structlog.get_logger()


class OpenAIEmbedder:
    """OpenAI text-embedding-3-large embeddings (1024-dim)."""

    name = "openai"

    def __init__(self, model: str = "text-embedding-3-small"):
        from openai import AsyncOpenAI

        self.model = model
        self.dimensions = settings.embedding_dimensions
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def embed_query(self, query: str) -> list[float]:
        resp = await self._client.embeddings.create(
            model=self.model, input=[query], dimensions=self.dimensions,
        )
        return resp.data[0].embedding

    async def embed_documents(self, texts: list[str], batch_size: int = 128) -> list[list[float]]:
        all_embeddings: list[list[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            resp = await self._client.embeddings.create(
                model=self.model, input=batch, dimensions=self.dimensions,
            )
            all_embeddings.extend(d.embedding for d in resp.data)
            logger.debug("openai_embed_batch", batch=i // batch_size + 1, size=len(batch))
        return all_embeddings

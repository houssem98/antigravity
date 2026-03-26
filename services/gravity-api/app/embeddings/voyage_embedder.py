"""
Gravity Search — Voyage Finance Embedder
Primary embedding model: voyage-finance-2 (1024 dim, $0.12/M tokens)
Outperforms general-purpose embeddings by 7-12% on financial retrieval.
"""

import structlog
import voyageai

from app.config import settings

logger = structlog.get_logger()


class VoyageEmbedder:
    """Voyage AI voyage-finance-2 embeddings."""

    def __init__(self, model: str = "voyage-finance-2"):
        self.model = model
        self.client = voyageai.AsyncClient(api_key=settings.voyage_api_key)
        self.dimensions = settings.embedding_dimensions

    async def embed_query(self, query: str) -> list[float]:
        """Embed a single query string."""
        result = await self.client.embed(
            texts=[query],
            model=self.model,
            input_type="query",
        )
        return result.embeddings[0]

    async def embed_documents(self, texts: list[str], batch_size: int = 128) -> list[list[float]]:
        """Embed a batch of document chunks."""
        all_embeddings = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            result = await self.client.embed(
                texts=batch,
                model=self.model,
                input_type="document",
            )
            all_embeddings.extend(result.embeddings)
            logger.debug("embed_batch", batch=i // batch_size + 1, size=len(batch))
        return all_embeddings

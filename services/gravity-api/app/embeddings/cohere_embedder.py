"""
Gravity Search — Cohere Embedder (failover)

embed-english-v3.0 outputs 1024-dim vectors — a drop-in match for the existing
Qdrant collection — using the COHERE_API_KEY already configured for reranking.
No new key, free trial tier / cheap, so it's the cheapest path when Voyage/Gemini
are out of credit. (512-token context is fine: paragraph chunks are capped at 512
tokens; longer section chunks are truncated, which the reranker compensates for.)
"""

import asyncio
import structlog

from app.config import settings

logger = structlog.get_logger()

_BATCH = 96  # Cohere v3 caps embed batches at 96 texts


class CohereEmbedder:
    """Cohere embed-english-v3.0 embeddings (1024-dim)."""

    name = "cohere"

    def __init__(self, model: str = "embed-english-v3.0"):
        import cohere

        self.model = model
        self.dimensions = settings.embedding_dimensions
        self._client = cohere.Client(settings.cohere_api_key)

    async def _embed(self, texts: list[str], input_type: str) -> list[list[float]]:
        def _call() -> list[list[float]]:
            out: list[list[float]] = []
            for i in range(0, len(texts), _BATCH):
                r = self._client.embed(
                    texts=texts[i:i + _BATCH],
                    model=self.model,
                    input_type=input_type,
                )
                out.extend(r.embeddings)
            return out

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _call)

    async def embed_query(self, query: str) -> list[float]:
        out = await self._embed([query], "search_query")
        return out[0]

    async def embed_documents(self, texts: list[str], batch_size: int = _BATCH) -> list[list[float]]:
        return await self._embed(texts, "search_document")

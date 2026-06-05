"""
Gravity Search — Gemini Embedder (failover)

Uses Google's gemini-embedding-001 via the google-genai SDK. Output is
truncated (Matryoshka) to settings.embedding_dimensions (1024) so it is
drop-in compatible with the existing Qdrant collection. Truncated vectors
are L2-normalized per Google's guidance so cosine scoring stays correct.

Free tier on a GOOGLE_API_KEY makes this the natural no-cost fallback when
Voyage is rate-limited or out of credit.
"""

import asyncio
import math
import structlog

from app.config import settings

logger = structlog.get_logger()


def _l2_normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vec))
    if norm == 0:
        return vec
    return [v / norm for v in vec]


class GeminiEmbedder:
    """Google gemini-embedding-001 embeddings (1024-dim, normalized)."""

    name = "gemini"

    def __init__(self, model: str = "gemini-embedding-001"):
        from google import genai

        self.model = model
        self.dimensions = settings.embedding_dimensions
        self._client = genai.Client(api_key=settings.google_api_key)

    async def _embed(self, texts: list[str], task_type: str) -> list[list[float]]:
        from google.genai import types

        def _call() -> list[list[float]]:
            resp = self._client.models.embed_content(
                model=self.model,
                contents=texts,
                config=types.EmbedContentConfig(
                    task_type=task_type,
                    output_dimensionality=self.dimensions,
                ),
            )
            return [_l2_normalize(list(e.values)) for e in resp.embeddings]

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _call)

    async def embed_query(self, query: str) -> list[float]:
        out = await self._embed([query], task_type="RETRIEVAL_QUERY")
        return out[0]

    async def embed_documents(self, texts: list[str], batch_size: int = 100) -> list[list[float]]:
        all_embeddings: list[list[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            all_embeddings.extend(await self._embed(batch, task_type="RETRIEVAL_DOCUMENT"))
            logger.debug("gemini_embed_batch", batch=i // batch_size + 1, size=len(batch))
        return all_embeddings

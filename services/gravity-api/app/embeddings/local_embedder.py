"""
Gravity Search — Local Embedder Fallback
Uses Sentence Transformers (Fin-E5 or BGE-M3) for on-premises/compliance customers.
"""

import asyncio
import structlog
logger = structlog.get_logger()


class LocalEmbedder:
    """Local embedding using Sentence Transformers."""

    def __init__(self, model_name: str = "BAAI/bge-m3"):
        self.model_name = model_name
        self._model = None

    def _load(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(self.model_name)
            logger.info("local_embedder_loaded", model=self.model_name)

    async def _ensure_loaded(self):
        """Load model in a thread pool so the async event loop is not blocked."""
        if self._model is None:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._load)

    async def embed_query(self, query: str) -> list[float]:
        await self._ensure_loaded()
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, lambda: self._model.encode(query, normalize_embeddings=True).tolist()
        )

    async def embed_documents(self, texts: list[str], batch_size: int = 64) -> list[list[float]]:
        await self._ensure_loaded()
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, lambda: self._model.encode(texts, batch_size=batch_size, normalize_embeddings=True).tolist()
        )

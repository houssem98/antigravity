"""
Gravity Search — Jina Embedder (failover)

jina-embeddings-v3 via the Jina REST API. Output dims pinned to
settings.embedding_dimensions (1024, Matryoshka) so it's drop-in with the
existing Qdrant collection. Uses task-specific encoding (retrieval.passage for
documents, retrieval.query for queries). Generous free tier — good for bulk
indexing when Cohere/Gemini quotas are spent.
"""

import httpx
import structlog

from app.config import settings

logger = structlog.get_logger()

_URL = "https://api.jina.ai/v1/embeddings"
_MODEL = "jina-embeddings-v3"
_BATCH = 64  # keep requests well under Jina's per-request token cap


class JinaEmbedder:
    name = "jina"

    def __init__(self, model: str = _MODEL):
        self.model = model
        self.dimensions = settings.embedding_dimensions
        self._key = settings.jina_api_key

    async def _embed(self, texts: list[str], task: str) -> list[list[float]]:
        headers = {"Authorization": f"Bearer {self._key}", "Content-Type": "application/json"}
        out: list[list[float]] = []
        async with httpx.AsyncClient(timeout=60) as client:
            for i in range(0, len(texts), _BATCH):
                batch = texts[i:i + _BATCH]
                resp = await client.post(_URL, headers=headers, json={
                    "model": self.model,
                    "task": task,
                    "dimensions": self.dimensions,
                    "input": batch,
                })
                resp.raise_for_status()
                data = resp.json().get("data", [])
                out.extend(d["embedding"] for d in data)
                logger.debug("jina_embed_batch", batch=i // _BATCH + 1, size=len(batch))
        return out

    async def embed_query(self, query: str) -> list[float]:
        out = await self._embed([query], "retrieval.query")
        return out[0]

    async def embed_documents(self, texts: list[str], batch_size: int = _BATCH) -> list[list[float]]:
        return await self._embed(texts, "retrieval.passage")

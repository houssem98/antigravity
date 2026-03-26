"""
Gravity Search — Cohere Cross-Encoder Reranker
Reranks RRF-fused results using Cohere rerank-v3.5.
Takes top-30 passages, returns re-scored and re-ordered list.
Latency target: ~20ms for 30 passages.
"""

import time
import cohere
import structlog

from app.config import settings
from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()


class CohereReranker:
    """Cross-encoder reranking via Cohere rerank-v3.5."""

    def __init__(self, model: str = "rerank-v3.5"):
        self.model = model
        self.client = cohere.AsyncClientV2(api_key=settings.cohere_api_key)

    async def rerank(
        self,
        query: str,
        passages: list[RetrievalResult],
        top_k: int | None = None,
    ) -> list[RetrievalResult]:
        """Rerank passages using Cohere cross-encoder."""
        if not passages:
            return []

        top_k = top_k or settings.max_context_passages
        documents = [p.text for p in passages]

        t0 = time.perf_counter()
        try:
            response = await self.client.rerank(
                model=self.model,
                query=query,
                documents=documents,
                top_n=min(top_k, len(passages)),
                return_documents=False,
            )

            # Reorder passages by reranker score
            reranked = []
            for result in response.results:
                passage = passages[result.index]
                passage.score = result.relevance_score  # Override with reranker score
                reranked.append(passage)

            ms = (time.perf_counter() - t0) * 1000
            logger.info("cohere_rerank", passages=len(passages), returned=len(reranked), ms=round(ms, 1))
            return reranked

        except Exception as e:
            logger.error("rerank_failed", error=str(e))
            # Graceful degradation: return original order
            return passages[:top_k]

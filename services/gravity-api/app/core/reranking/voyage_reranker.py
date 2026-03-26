"""
Gravity Search — Voyage Reranker (voyage-rerank-2)
Cross-encoder fallback to Cohere. Finance-tuned passage reranking.
"""

import structlog
import voyageai

from app.config import settings
from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()


class VoyageReranker:
    """
    Voyage rerank-2 cross-encoder.
    Used as fallback when Cohere is unavailable.
    Finance-domain optimised; outperforms general cross-encoders on SEC filings.
    """

    MODEL = "rerank-2"

    def __init__(self):
        if not settings.voyage_api_key:
            logger.warning("voyage_reranker_no_key", msg="VOYAGE_API_KEY not set — reranker disabled")
            self._client = None
        else:
            self._client = voyageai.AsyncClient(api_key=settings.voyage_api_key)

    async def rerank(
        self,
        query: str,
        passages: list[RetrievalResult],
        top_k: int = 15,
    ) -> list[RetrievalResult]:
        """
        Rerank passages using Voyage rerank-2.
        Returns top_k passages sorted by cross-encoder relevance score.
        """
        if not self._client or not passages:
            return passages[:top_k]

        try:
            documents = [p.text for p in passages]

            result = await self._client.rerank(
                query=query,
                documents=documents,
                model=self.MODEL,
                top_k=top_k,
            )

            # Map Voyage indices back to original RetrievalResult objects
            reranked: list[RetrievalResult] = []
            for item in result.results:
                passage = passages[item.index]
                # Inject rerank score so downstream can use it
                passage.rrf_score = float(item.relevance_score)
                reranked.append(passage)

            logger.info(
                "voyage_rerank_complete",
                input_count=len(passages),
                output_count=len(reranked),
                top_score=round(reranked[0].rrf_score, 4) if reranked else 0,
            )
            return reranked

        except Exception as e:
            logger.error("voyage_rerank_failed", error=str(e))
            return passages[:top_k]

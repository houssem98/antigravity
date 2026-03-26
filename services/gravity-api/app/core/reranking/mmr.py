"""
Maximum Marginal Relevance (MMR) Diversity Reranking
=====================================================
After Cohere reranking the top passages are relevant but may be redundant
— 15 passages all quoting the same revenue figure from the same 10-K section.

MMR enforces diversity: each selected passage must be both relevant to the
query AND maximally different from already-selected passages.

Formula:
  MMR(d) = λ * relevance(d, q) - (1-λ) * max_sim(d, selected)

λ=0.7 weights relevance more than diversity (good for factual financial queries).
λ=0.5 gives equal weight (better for broad research questions).

Reference: Carbonell & Goldstein (1998). "The use of MMR, diversity-based
           reranking for reordering documents and producing summaries."
"""

from __future__ import annotations

import asyncio
import numpy as np
import structlog

from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / denom) if denom > 0 else 0.0


async def mmr_rerank(
    passages: list[RetrievalResult],
    embedder,
    top_k: int = 15,
    lambda_param: float = 0.7,
    max_concurrent_embeds: int = 16,
) -> list[RetrievalResult]:
    """
    Apply MMR to a list of reranked passages, returning top_k diverse results.

    Args:
        passages:      Cohere-reranked passages (already ordered by relevance).
        embedder:      VoyageEmbedder (used to embed passage texts).
        top_k:         Number of passages to return.
        lambda_param:  0=max diversity, 1=max relevance. Default 0.7.

    Returns:
        top_k passages selected for relevance + diversity.
    """
    if len(passages) <= top_k:
        return passages

    # Embed all passages in parallel
    semaphore = asyncio.Semaphore(max_concurrent_embeds)

    async def _embed_one(text: str) -> np.ndarray:
        async with semaphore:
            vec = await embedder.embed_query(text)
        return np.array(vec, dtype=np.float32)

    try:
        embeddings: list[np.ndarray] = await asyncio.gather(
            *[_embed_one(p.text) for p in passages]
        )
    except Exception as e:
        logger.warning("mmr_embed_failed", error=str(e))
        return passages[:top_k]

    n = len(passages)
    selected_indices: list[int] = []
    remaining_indices = list(range(n))

    # Relevance scores: use rrf_score if available, else Cohere score
    relevance = np.array([
        getattr(p, "rrf_score", 0) or p.score for p in passages
    ], dtype=np.float32)

    # Normalise relevance to [0, 1]
    rel_min, rel_max = relevance.min(), relevance.max()
    if rel_max > rel_min:
        relevance = (relevance - rel_min) / (rel_max - rel_min)

    # Greedy MMR selection
    while len(selected_indices) < top_k and remaining_indices:
        if not selected_indices:
            # First selection: highest relevance
            best = max(remaining_indices, key=lambda i: relevance[i])
        else:
            best = None
            best_score = -float("inf")
            sel_embs = [embeddings[j] for j in selected_indices]

            for i in remaining_indices:
                rel_score = lambda_param * float(relevance[i])
                max_sim = max(_cosine(embeddings[i], emb) for emb in sel_embs)
                mmr_score = rel_score - (1.0 - lambda_param) * max_sim
                if mmr_score > best_score:
                    best_score = mmr_score
                    best = i

        selected_indices.append(best)
        remaining_indices.remove(best)

    selected = [passages[i] for i in selected_indices]

    logger.info(
        "mmr_rerank",
        input_passages=len(passages),
        output_passages=len(selected),
        lambda_param=lambda_param,
    )
    return selected

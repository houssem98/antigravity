"""
HyDE — Hypothetical Document Embeddings
========================================
Instead of embedding the raw question, we generate a short hypothetical
passage that *would* perfectly answer the question, then embed that.

Why it works:
  A question ("What was Apple's revenue?") lives in a different embedding
  space than an answer ("Apple's revenue was $124.3B…").  HyDE bridges
  that gap: the hypothetical answer is semantically adjacent to real
  answer passages in the vector store, yielding +8–15 pp retrieval precision.

Reference: Gao et al. (2022) "Precise Zero-Shot Dense Retrieval without
           Relevance Labels". arXiv:2212.10496.

Usage:
    hyde = HyDE(llm_client=haiku_client, embedder=voyage_embedder)
    vector = await hyde.embed_query("What was TSMC CapEx in FY2025?")
    # Use `vector` in place of the raw query vector in Qdrant search.
"""

from __future__ import annotations

import structlog

from app.llm.base import LLMConfig, LLMMessage

logger = structlog.get_logger()

_HYDE_PROMPT = """\
Write a single concise paragraph (3–5 sentences) that would appear verbatim
in an SEC filing, earnings transcript, or financial news article and
perfectly answer the following question.

Rules:
- Use specific numbers, tickers, fiscal periods, and financial terminology.
- Write as if it is real sourced data (not "approximately" or "around").
- Do NOT say "In response to your question…" — just write the passage.

Question: {query}

Passage:"""


class HyDE:
    """Hypothetical Document Embedder for financial queries."""

    def __init__(self, llm_client, embedder):
        self.llm = llm_client      # Fast model (Haiku / Gemini Flash)
        self.embedder = embedder   # VoyageEmbedder

    async def generate_hypothetical_passage(self, query: str) -> str:
        """Generate a hypothetical ideal-answer passage for the query."""
        try:
            response = await self.llm.generate(
                messages=[LLMMessage(role="user", content=_HYDE_PROMPT.format(query=query))],
                config=LLMConfig(temperature=0.1, max_tokens=220),
            )
            passage = response.content.strip()
            logger.debug("hyde_passage_generated", query_len=len(query), passage_len=len(passage))
            return passage
        except Exception as e:
            logger.warning("hyde_generation_failed", error=str(e))
            return query  # Fall back to raw query

    async def embed_query(self, query: str) -> list[float]:
        """
        Return an embedding for the query using HyDE.

        1. Generate a hypothetical passage.
        2. Embed the passage (not the question).
        3. Return the embedding vector.
        """
        hypothetical = await self.generate_hypothetical_passage(query)
        vector = await self.embedder.embed_query(hypothetical)
        return vector

    async def embed_query_ensemble(self, query: str) -> list[float]:
        """
        Ensemble variant: average embeddings of the raw query AND the
        hypothetical passage.  More conservative; trades some precision
        for stability on short / ambiguous queries.
        """
        import numpy as np

        raw_vec, hyp_passage = await asyncio.gather(
            self.embedder.embed_query(query),
            self.generate_hypothetical_passage(query),
        )
        hyp_vec = await self.embedder.embed_query(hyp_passage)

        # Weighted average: 40% original query, 60% hypothetical
        arr = 0.4 * np.array(raw_vec) + 0.6 * np.array(hyp_vec)
        # Re-normalise to unit length for cosine similarity
        norm = float(np.linalg.norm(arr))
        if norm > 0:
            arr /= norm
        return arr.tolist()


import asyncio  # noqa: E402  (needed for ensemble method)

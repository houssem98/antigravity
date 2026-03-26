"""
Contextual Compression
======================
After retrieval and reranking, each passage may be 256–512 tokens but only
2–3 sentences actually answer the question.  Compressing before LLM context
construction removes noise, reduces token cost 40–60%, and improves accuracy
by letting the LLM focus on signal.

Algorithm:
  For each passage: ask a fast LLM (Haiku) to extract ONLY the answer-relevant
  sentences.  Keep the original text available for citation display; use the
  compressed extract for the LLM reasoning context.

Reference: Contextual Compression Retriever (LangChain, 2023).
"""

from __future__ import annotations

import asyncio
import structlog

from app.llm.base import LLMConfig, LLMMessage
from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()

_COMPRESS_PROMPT = """\
Extract ONLY the sentences from the passage below that directly help answer the question.

Rules:
- Copy exact wording from the passage (no paraphrasing).
- Include any specific numbers, dates, or proper nouns relevant to the question.
- If no sentence directly answers, copy the single most relevant sentence.
- Output ONLY the extracted sentences — no preamble, no commentary.

Question: {query}

Passage:
{text}

Relevant extract:"""


async def compress_passages(
    query: str,
    passages: list[RetrievalResult],
    llm_client,
    max_tokens_per_extract: int = 180,
    max_concurrent: int = 8,
) -> list[RetrievalResult]:
    """
    Compress each passage to its answer-relevant sentences in parallel.

    Mutates passages in-place:
      passage.original_text  — original full text (for citation display)
      passage.text           — compressed extract (for LLM context)

    Args:
        query:                 The user query
        passages:              Reranked list[RetrievalResult]
        llm_client:            Fast LLM (Haiku / Gemini Flash)
        max_tokens_per_extract: Max tokens for each compressed extract
        max_concurrent:        Parallel compress calls

    Returns:
        The same passages list with .text compressed.
    """
    semaphore = asyncio.Semaphore(max_concurrent)

    async def _compress_one(passage: RetrievalResult) -> RetrievalResult:
        # Preserve original for citation rendering
        passage.original_text = passage.text  # type: ignore[attr-defined]
        try:
            async with semaphore:
                response = await llm_client.generate(
                    messages=[LLMMessage(
                        role="user",
                        content=_COMPRESS_PROMPT.format(query=query, text=passage.text),
                    )],
                    config=LLMConfig(temperature=0.0, max_tokens=max_tokens_per_extract),
                )
            extract = response.content.strip()
            if extract:
                passage.text = extract
        except Exception as e:
            logger.warning("compress_passage_failed", chunk_id=passage.chunk_id, error=str(e))
            # Keep original text on failure
        return passage

    compressed = await asyncio.gather(*[_compress_one(p) for p in passages])

    original_tokens = sum(len(p.original_text.split()) for p in compressed)  # type: ignore[attr-defined]
    compressed_tokens = sum(len(p.text.split()) for p in compressed)
    reduction_pct = round((1 - compressed_tokens / max(original_tokens, 1)) * 100, 1)

    logger.info(
        "compression_complete",
        passages=len(compressed),
        original_words=original_tokens,
        compressed_words=compressed_tokens,
        reduction_pct=reduction_pct,
    )
    return list(compressed)

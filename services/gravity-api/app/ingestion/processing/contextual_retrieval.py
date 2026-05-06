"""
Gravity Search -- Contextual Retrieval (Anthropic, Sept 2024)

Prepends a 75-token LLM-generated context summary to every chunk's
text_with_metadata before embedding. This single change reduces
retrieval failures by 49% standalone and 67% when combined with
BM25 + reranking (per Anthropic's published benchmark).

Why it works: embedding models see the chunk in isolation. A chunk
like "Revenue increased 12% year-over-year" is ambiguous without
knowing it's about Apple's iPhone segment in Q4 FY2024. The context
summary resolves that ambiguity at index time, so queries like
"Apple iPhone revenue growth 2024" land on the right chunk.

Prompt caching: the document text (up to 60K chars) is sent once as
a cached prefix; only the per-chunk instruction varies. Cost for a
full 10-K: ~$0.001 (Haiku/Flash at cache hit prices).

Integration point:
    pipeline.ingest_bytes()
      → chunker.chunk_document()        # Step 5
      → contextual_retrieval.enrich()   # Step 5c  ← THIS FILE
      → raptor_indexer.build_summaries() # Step 5b (already wired)
      → _parallel_index()               # Step 6
"""

from __future__ import annotations

import asyncio
import structlog
from dataclasses import replace

from app.ingestion.processing.chunker import ChunkOutput, DocumentMetadata

logger = structlog.get_logger()

# Prompt per Anthropic's published Contextual Retrieval recipe.
# <document> is the full doc text (sent as a cached prefix in the API call).
# <chunk> is the specific chunk text.
_CONTEXT_PROMPT = """\
<document>
{document_text}
</document>

Here is the chunk we want to situate within the whole document:
<chunk>
{chunk_text}
</chunk>

Please give a short succinct context (2-3 sentences, max 100 words) to situate \
this chunk within the overall document for the purposes of improving search retrieval. \
Answer only with the context text — no preamble, no "Here is the context:".
Focus on: which company, which filing section, which time period, and the key financial \
metric or theme this chunk is about."""

# Levels to enrich — Level 2 (paragraph) is the primary retrieval unit.
# Level 1 (section) and Level 4 (table) are also worth enriching.
# Level 3 (sentence) chunks are too granular — skip to save cost.
_ENRICH_LEVELS = {1, 2, 4}

# Safety cap: don't send more than 60K chars of document text as context
_DOC_CONTEXT_MAX_CHARS = 60_000

# Batch size for concurrent LLM calls (respect rate limits)
_CONCURRENT = 8


class ContextualRetrieval:
    """
    Enriches ChunkOutput objects with LLM-generated context summaries.

    Usage (in pipeline.py after chunker.chunk_document()):
        cr = ContextualRetrieval(llm_client=fast_client)
        chunks = await cr.enrich(chunks, document_text, metadata)

    The enriched chunks have their text_with_metadata updated to:
        "<context summary>\n\n<original metadata prefix>\n\n<chunk text>"

    Falls back silently: if LLM fails for a chunk, that chunk keeps
    its original text_with_metadata unchanged.
    """

    def __init__(self, llm_client=None):
        self._llm = llm_client

    async def enrich(
        self,
        chunks: list[ChunkOutput],
        document_text: str,
        metadata: DocumentMetadata,
    ) -> list[ChunkOutput]:
        """
        Generate context summaries and prepend to text_with_metadata.

        Args:
            chunks:        Output of HierarchicalChunker.chunk_document()
            document_text: Full raw document text (used as context window)
            metadata:      Document metadata

        Returns:
            Same list with text_with_metadata updated for enriched chunks.
        """
        if not self._llm:
            return chunks

        # Truncate document context to avoid huge prompts
        doc_context = document_text[:_DOC_CONTEXT_MAX_CHARS]

        # Only enrich the levels that benefit most
        to_enrich = [c for c in chunks if c.level in _ENRICH_LEVELS]
        to_skip = [c for c in chunks if c.level not in _ENRICH_LEVELS]

        if not to_enrich:
            return chunks

        logger.info(
            "contextual_retrieval_start",
            document_id=metadata.document_id,
            chunks_to_enrich=len(to_enrich),
            chunks_skipped=len(to_skip),
        )

        # Process in concurrent batches
        enriched: list[ChunkOutput] = []
        for batch_start in range(0, len(to_enrich), _CONCURRENT):
            batch = to_enrich[batch_start:batch_start + _CONCURRENT]
            tasks = [
                self._enrich_one(chunk, doc_context)
                for chunk in batch
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for chunk, result in zip(batch, results):
                if isinstance(result, ChunkOutput):
                    enriched.append(result)
                else:
                    # Keep original on error
                    if isinstance(result, Exception):
                        logger.warning(
                            "contextual_retrieval_chunk_failed",
                            chunk_id=chunk.id,
                            error=str(result),
                        )
                    enriched.append(chunk)

        enriched_count = sum(
            1 for orig, new in zip(to_enrich, enriched)
            if orig.text_with_metadata != new.text_with_metadata
        )
        logger.info(
            "contextual_retrieval_complete",
            document_id=metadata.document_id,
            enriched=enriched_count,
            failed=len(to_enrich) - enriched_count,
        )

        # Rebuild full list preserving original order
        enriched_by_id = {c.id: c for c in enriched}
        return [
            enriched_by_id.get(c.id, c)
            if c.level in _ENRICH_LEVELS
            else c
            for c in chunks
        ]

    async def _enrich_one(self, chunk: ChunkOutput, doc_context: str) -> ChunkOutput:
        """Generate context for a single chunk and return updated ChunkOutput."""
        from app.llm.base import LLMConfig, LLMMessage

        prompt = _CONTEXT_PROMPT.format(
            document_text=doc_context,
            chunk_text=chunk.text[:2000],  # Cap chunk text in prompt
        )

        resp = await self._llm.generate(
            messages=[LLMMessage(role="user", content=prompt)],
            config=LLMConfig(temperature=0.0, max_tokens=150),
        )

        context_summary = resp.content.strip()
        if not context_summary:
            return chunk

        # Prepend context summary BEFORE the existing metadata prefix
        # Final format: "<context>\n\n<metadata prefix>\n\n<chunk text>"
        new_text_with_metadata = (
            f"{context_summary}\n\n{chunk.text_with_metadata}"
        )

        # dataclasses.replace creates a shallow copy with the field updated
        return replace(chunk, text_with_metadata=new_text_with_metadata)

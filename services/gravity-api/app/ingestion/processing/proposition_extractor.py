"""
Proposition Indexing — Extract Atomic Facts from Chunks
========================================================
Dense Passage Retrieval (DPR) studies show that indexing individual atomic
propositions rather than paragraphs improves retrieval precision by 15-30%
for factual questions.

Instead of returning a 400-token paragraph, we return a 15-token proposition:
  "Apple's Q4 2025 revenue was $124.3 billion."

Each proposition:
  - Is self-contained (includes entity + metric + value + time period)
  - Links back to its parent L2 chunk for context expansion
  - Is indexed as a Level 5 chunk in Qdrant

Reference: Chen et al. (2023) "Dense X Retrieval: What Retrieval Granularity
           Should We Use?" — arXiv:2312.06648
"""

from __future__ import annotations

import asyncio
import uuid
import re
import structlog

from app.ingestion.processing.chunker import ChunkOutput, DocumentMetadata

logger = structlog.get_logger()

_EXTRACTION_PROMPT = """Extract every atomic factual proposition from this financial document passage.

Rules:
1. Each proposition must be a single complete sentence
2. Include the entity (company/ticker) in each proposition
3. Include specific numbers, dates, and metrics when present
4. Do not include opinions, projections labeled as such, or vague statements
5. Each proposition must be self-contained (no "it", "they", "this" without referent)
6. Return ONLY a JSON array of strings

Example output:
["Apple's Q4 FY2025 net revenue was $124.3 billion.",
 "Apple's gross margin in Q4 FY2025 was 46.2%.",
 "Apple guided FY2026 revenue growth of 6-8% year-over-year."]

Passage (from {ticker} {filing_type}, {section}):
{text}

JSON array of propositions:"""


class PropositionExtractor:
    """
    Extracts atomic factual propositions from Level 2 paragraph chunks.

    Usage:
        extractor = PropositionExtractor(llm_client=gemini_flash)
        props = await extractor.extract(l2_chunk, metadata)
        # Returns list[ChunkOutput] with level=5
    """

    def __init__(self, llm_client=None, max_concurrent: int = 8):
        self.llm = llm_client
        self._sem = asyncio.Semaphore(max_concurrent)

    async def extract_from_chunks(
        self,
        chunks: list[ChunkOutput],
        metadata: DocumentMetadata,
    ) -> list[ChunkOutput]:
        """
        Extract propositions from all Level 2 chunks in a document.

        Args:
            chunks: All chunks from the hierarchical chunker
            metadata: Document metadata for enriching propositions

        Returns:
            List of Level 5 proposition ChunkOutput objects
        """
        if not self.llm:
            return []

        # Only process Level 2 (paragraph) chunks — they have the right density
        para_chunks = [c for c in chunks if c.level == 2 and len(c.text.split()) > 30]
        if not para_chunks:
            return []

        tasks = [self._extract_one(c, metadata) for c in para_chunks]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        propositions = []
        for result in results:
            if isinstance(result, list):
                propositions.extend(result)
            elif isinstance(result, Exception):
                logger.warning("proposition_extract_failed", error=str(result))

        logger.info(
            "propositions_extracted",
            document_id=metadata.document_id,
            source_chunks=len(para_chunks),
            propositions=len(propositions),
        )
        return propositions

    async def _extract_one(
        self,
        chunk: ChunkOutput,
        metadata: DocumentMetadata,
    ) -> list[ChunkOutput]:
        """Extract propositions from a single paragraph chunk."""
        async with self._sem:
            from app.llm.base import LLMConfig, LLMMessage

            prompt = _EXTRACTION_PROMPT.format(
                ticker=metadata.ticker,
                filing_type=metadata.filing_type,
                section=chunk.section_name or "Document",
                text=chunk.text[:2000],  # cap to keep costs low
            )

            try:
                response = await self.llm.generate(
                    messages=[LLMMessage(role="user", content=prompt)],
                    config=LLMConfig(temperature=0.0, max_tokens=1024, json_mode=False),
                )

                raw = response.content.strip()
                propositions = self._parse_propositions(raw)

                return [
                    self._make_proposition_chunk(prop, chunk, metadata, idx)
                    for idx, prop in enumerate(propositions)
                    if prop.strip()
                ]
            except Exception as e:
                logger.warning(
                    "proposition_llm_failed",
                    chunk_id=chunk.id,
                    error=str(e),
                )
                return []

    def _parse_propositions(self, raw: str) -> list[str]:
        """Parse LLM output into a list of proposition strings."""
        import json
        # Try JSON array first
        try:
            # Extract JSON array from text (handles markdown code blocks)
            match = re.search(r'\[.*\]', raw, re.DOTALL)
            if match:
                return json.loads(match.group(0))
        except (json.JSONDecodeError, AttributeError):
            pass

        # Fallback: split on newlines and clean up
        lines = []
        for line in raw.splitlines():
            line = line.strip().strip('"-,').strip()
            if len(line) > 20 and line.endswith('.'):
                lines.append(line)
        return lines

    def _make_proposition_chunk(
        self,
        text: str,
        parent: ChunkOutput,
        metadata: DocumentMetadata,
        idx: int,
    ) -> ChunkOutput:
        """Create a Level 5 proposition chunk with parent link."""
        # Inherit metadata prefix from parent
        parts = []
        if metadata.ticker:
            parts.append(f"[Ticker: {metadata.ticker}]")
        if metadata.filing_type:
            parts.append(f"[Filing: {metadata.filing_type}]")
        if parent.section_name:
            parts.append(f"[Section: {parent.section_name}]")
        prefix = " ".join(parts)
        text_with_meta = f"{prefix}\n\n{text}" if prefix else text

        return ChunkOutput(
            id=str(uuid.uuid4()),
            document_id=metadata.document_id,
            text=text,
            text_with_metadata=text_with_meta,
            level=5,  # Level 5 = atomic proposition
            section_name=parent.section_name,
            page_number=parent.page_number,
            token_count=len(text.split()),
            position=parent.position * 1000 + idx,  # Sub-position within parent
            metadata={
                "ticker": metadata.ticker,
                "company_name": metadata.company_name,
                "filing_type": metadata.filing_type,
                "filing_date": metadata.filing_date,
                "document_title": f"{metadata.ticker} {metadata.filing_type} {metadata.filing_date}",
                "is_proposition": True,
            },
            parent_chunk_id=parent.id,  # Links back to L2 paragraph for context expansion
        )

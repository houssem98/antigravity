"""
Gravity Search — RAPTOR-Style Summary Tree Indexer
Per FinRAG paper: builds hierarchical summary trees over document chunks
for multi-level abstraction retrieval.

How it works:
  1. Groups Level 2 (paragraph) chunks by section
  2. For each section group, generates an LLM summary
  3. Embeds the summary as a Level 0 "summary chunk" in Qdrant
  4. Summary chunks link back to their children via metadata

This allows retrieval at two abstraction levels:
  - Level 0: "What did Apple say about revenue?" → gets the SUMMARY
  - Level 2: "What was Apple's Q4 services revenue?" → gets the PARAGRAPH

Retrieval expansion: when a Level 0 chunk is retrieved, the system can
optionally expand to its child chunks for more detail.
"""

import asyncio
import uuid
import structlog

from app.config import settings
from app.ingestion.processing.chunker import ChunkOutput, DocumentMetadata

logger = structlog.get_logger()


class RaptorIndexer:
    """
    Builds RAPTOR-style summary trees over ingested chunks.

    Runs AFTER initial chunking and vector indexing.
    Creates Level 0 summary chunks for each document section.
    """

    def __init__(self, llm_client=None, embedder=None):
        self.llm = llm_client      # Gemini Flash for cheap summaries
        self.embedder = embedder    # VoyageEmbedder / LocalEmbedder

    async def build_summaries(
        self,
        chunks: list[ChunkOutput],
        metadata: DocumentMetadata,
    ) -> list[ChunkOutput]:
        """
        Generate Level 0 summary chunks from Level 2 paragraph chunks.

        Groups paragraph chunks by section name, generates a summary
        for each section, and returns Level 0 chunks ready for indexing.

        Args:
            chunks: All chunks from hierarchical chunking
            metadata: Document metadata

        Returns:
            List of Level 0 summary ChunkOutput objects
        """
        if not self.llm or not settings.raptor_enabled:
            return []

        # Group Level 2 chunks by section
        section_groups: dict[str, list[ChunkOutput]] = {}
        for chunk in chunks:
            if chunk.level == 2:
                key = chunk.section_name or "Full Document"
                if key not in section_groups:
                    section_groups[key] = []
                section_groups[key].append(chunk)

        if not section_groups:
            return []

        # Generate summaries for each section group
        summary_chunks = []
        tasks = []
        for section_name, para_chunks in section_groups.items():
            if len(para_chunks) < 2:
                # Skip sections with only 1 paragraph (no need to summarize)
                continue
            tasks.append(self._summarize_section(section_name, para_chunks, metadata))

        results = await asyncio.gather(*tasks, return_exceptions=True)
        for result in results:
            if isinstance(result, ChunkOutput):
                summary_chunks.append(result)
            elif isinstance(result, Exception):
                logger.warning("raptor_summary_failed", error=str(result))

        logger.info(
            "raptor_summaries_built",
            document_id=metadata.document_id,
            sections_summarized=len(summary_chunks),
            total_sections=len(section_groups),
        )

        return summary_chunks

    async def _summarize_section(
        self,
        section_name: str,
        para_chunks: list[ChunkOutput],
        metadata: DocumentMetadata,
    ) -> ChunkOutput:
        """Generate a summary for a group of paragraph chunks."""
        from app.llm.base import LLMConfig, LLMMessage

        # Combine paragraph texts (cap at ~4000 tokens to stay cheap)
        combined_text = "\n\n".join(c.text for c in para_chunks)
        if len(combined_text) > 12000:  # ~3000-4000 tokens
            combined_text = combined_text[:12000]

        child_ids = [c.id for c in para_chunks]

        prompt = f"""Summarize this financial document section in 2-4 sentences.
Focus on: key financial metrics, strategic decisions, risk factors, and outlook.
Include specific numbers when mentioned.

Section: {section_name}
Company: {metadata.company_name} ({metadata.ticker})
Filing: {metadata.filing_type} {metadata.filing_date}

Content:
{combined_text}

Summary:"""

        response = await self.llm.generate(
            messages=[LLMMessage(role="user", content=prompt)],
            config=LLMConfig(
                temperature=0.1,
                max_tokens=settings.raptor_summary_max_tokens,
            ),
        )

        summary_text = response.content.strip()

        # Build metadata prefix (same as HierarchicalChunker._make_chunk)
        parts = []
        if metadata.ticker:
            parts.append(f"[Ticker: {metadata.ticker}]")
        if metadata.company_name:
            parts.append(f"[Company: {metadata.company_name}]")
        if metadata.filing_type:
            parts.append(f"[Filing: {metadata.filing_type}]")
        if section_name:
            parts.append(f"[Section: {section_name} (Summary)]")
        prefix = " ".join(parts)
        text_with_meta = f"{prefix}\n\n{summary_text}" if prefix else summary_text

        return ChunkOutput(
            id=str(uuid.uuid4()),
            document_id=metadata.document_id,
            text=summary_text,
            text_with_metadata=text_with_meta,
            level=0,  # Level 0 = summary
            section_name=section_name,
            page_number=None,
            token_count=len(summary_text.split()),  # Rough estimate
            position=-1,  # Before all other chunks
            metadata={
                "ticker": metadata.ticker,
                "company_name": metadata.company_name,
                "filing_type": metadata.filing_type,
                "filing_date": metadata.filing_date,
                "document_title": f"{metadata.ticker} {metadata.filing_type} {metadata.filing_date}",
                "is_raptor_summary": True,
                "child_chunk_ids": child_ids,
                "child_count": len(child_ids),
            },
        )

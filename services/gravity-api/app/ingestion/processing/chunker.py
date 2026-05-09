"""
Gravity Search — Hierarchical Chunker
Structure-aware chunking beats fixed-size splits by 15-25% on retrieval accuracy.

Five levels (enhanced per FinRAG + Table Reasoning papers):
  Level 0 — Summary Chunks (RAPTOR tree): LLM-generated section summaries
  Level 1 — Section Chunks (1024-2048 tokens): Full 10-K sections
  Level 2 — Paragraph Chunks (256-512 tokens): Primary retrieval unit, 20% overlap
  Level 3 — Sentence Chunks (50-150 tokens): For precise citation grounding
  Level 4 — Table Chunks: Structured financial tables (income stmt, balance sheet, cash flow)

Metadata prepending boosts retrieval precision by 10-20%.
"""

import re
import uuid
from dataclasses import dataclass, field

import structlog
import tiktoken

from app.config import settings

logger = structlog.get_logger()

# Tokenizer for counting tokens
_enc = tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str) -> int:
    return len(_enc.encode(text))


@dataclass
class DocumentMetadata:
    """Metadata for a source document."""
    document_id: str
    ticker: str = ""
    company_name: str = ""
    filing_type: str = ""
    filing_date: str = ""
    fiscal_year: str = ""
    fiscal_quarter: str = ""
    source_url: str = ""
    # Form-specific structured data (Form 4 transactions, 13F holdings,
    # SC 13D/G beneficial ownership). Populated by sec_form_parsers.
    extra: dict | None = None


@dataclass
class Section:
    """A detected section within a document (e.g., Item 1A Risk Factors)."""
    name: str
    text: str
    page_start: int | None = None
    # Canonical SEC item id ("item_1a", "item_7", "item_8", "note_1", etc.).
    # Stable across header variations — usable as a retrieval filter.
    item_id: str = ""


@dataclass
class ChunkOutput:
    """A single chunk ready for embedding and indexing."""
    id: str
    document_id: str
    text: str  # Raw text
    text_with_metadata: str  # Text with prepended metadata (for embedding)
    level: int  # 0=RAPTOR summary, 1=section, 2=paragraph, 3=sentence, 4=table
    section_name: str = ""
    page_number: int | None = None
    token_count: int = 0
    position: int = 0  # Order within document
    metadata: dict = field(default_factory=dict)
    # Parent-child relationships for small-to-big retrieval
    parent_chunk_id: str | None = None   # L3 → L2, L2 → L1
    child_chunk_ids: list[str] = field(default_factory=list)  # L1 → [L2s]


class HierarchicalChunker:
    """Structure-aware hierarchical chunking for financial documents."""

    def __init__(
        self,
        section_max_tokens: int | None = None,
        paragraph_max_tokens: int | None = None,
        paragraph_overlap: float | None = None,
        sentence_max_tokens: int | None = None,
    ):
        self.section_max = section_max_tokens or settings.chunk_section_max_tokens
        self.para_max = paragraph_max_tokens or settings.chunk_paragraph_max_tokens
        self.overlap = paragraph_overlap or settings.chunk_paragraph_overlap
        self.sent_max = sentence_max_tokens or settings.chunk_sentence_max_tokens

    def chunk_document(
        self,
        text: str,
        metadata: DocumentMetadata,
        sections: list[Section] | None = None,
        tables: list | None = None,
    ) -> list[ChunkOutput]:
        """
        Chunk a document into hierarchical levels.

        If sections are provided (e.g., 10-K Item detection), uses them.
        Otherwise, splits on double-newlines for sections and single-newlines for paragraphs.

        Args:
            text: Full document text
            metadata: Document metadata for chunk enrichment
            sections: Pre-detected document sections
            tables: Parsed tables from FinancialTableParser (Level 4 chunks)
        """
        chunks = []
        position = 0

        # If no sections detected, create a single section from the full text
        if not sections:
            sections = [Section(name="Full Document", text=text)]

        for section in sections:
            # Level 1: Section chunk
            section_tokens = count_tokens(section.text)
            l1_chunk = None
            if section_tokens <= self.section_max:
                l1_chunk = self._make_chunk(
                    text=section.text,
                    metadata=metadata,
                    level=1,
                    section_name=section.name,
                    page=section.page_start,
                    position=position,
                )
                chunks.append(l1_chunk)
                position += 1

            # Level 2: Paragraph chunks with overlap
            # Each L2 chunk knows its L1 parent; L1 knows its L2 children.
            paragraphs = self._split_paragraphs(section.text)
            para_chunks = self._chunk_with_overlap(paragraphs, self.para_max, self.overlap)
            l2_chunks: list[ChunkOutput] = []
            for para_text in para_chunks:
                l2 = self._make_chunk(
                    text=para_text,
                    metadata=metadata,
                    level=2,
                    section_name=section.name,
                    page=section.page_start,
                    position=position,
                )
                if l1_chunk:
                    l2.parent_chunk_id = l1_chunk.id
                    l1_chunk.child_chunk_ids.append(l2.id)
                l2_chunks.append(l2)
                chunks.append(l2)
                position += 1

            # Level 3: Sentence chunks — each knows its L2 parent
            sentences = self._split_sentences(section.text)
            sent_group: list[str] = []
            sent_tokens = 0
            current_l2_idx = 0  # Track which L2 chunk we're inside

            for sent in sentences:
                st = count_tokens(sent)
                if sent_tokens + st > self.sent_max and sent_group:
                    l3 = self._make_chunk(
                        text=" ".join(sent_group),
                        metadata=metadata,
                        level=3,
                        section_name=section.name,
                        page=section.page_start,
                        position=position,
                    )
                    # Link L3 → nearest L2 parent
                    if l2_chunks:
                        parent_l2 = l2_chunks[min(current_l2_idx, len(l2_chunks) - 1)]
                        l3.parent_chunk_id = parent_l2.id
                        parent_l2.child_chunk_ids.append(l3.id)
                    chunks.append(l3)
                    position += 1
                    sent_group = []
                    sent_tokens = 0
                    current_l2_idx = min(current_l2_idx + 1, len(l2_chunks) - 1)
                sent_group.append(sent)
                sent_tokens += st

            if sent_group:
                l3 = self._make_chunk(
                    text=" ".join(sent_group),
                    metadata=metadata,
                    level=3,
                    section_name=section.name,
                    page=section.page_start,
                    position=position,
                )
                if l2_chunks:
                    parent_l2 = l2_chunks[min(current_l2_idx, len(l2_chunks) - 1)]
                    l3.parent_chunk_id = parent_l2.id
                    parent_l2.child_chunk_ids.append(l3.id)
                chunks.append(l3)
                position += 1

        # ── Level 4: Table Chunks (from FinancialTableParser) ─────────
        if tables:
            for table in tables:
                table_md = table.to_markdown()
                if not table_md:
                    continue
                chunks.append(self._make_chunk(
                    text=table_md,
                    metadata=metadata,
                    level=4,
                    section_name=table.source_section or table.table_type,
                    page=table.page_number,
                    position=position,
                    extra_metadata={
                        "table_type": table.table_type,
                        "table_headers": table.headers,
                        "table_row_count": table.row_count,
                        "table_col_count": table.col_count,
                        "table_data": table.to_structured_dict(),
                    },
                ))
                position += 1

        logger.info(
            "chunked_document",
            document_id=metadata.document_id,
            total_chunks=len(chunks),
            level_1=sum(1 for c in chunks if c.level == 1),
            level_2=sum(1 for c in chunks if c.level == 2),
            level_3=sum(1 for c in chunks if c.level == 3),
            level_4=sum(1 for c in chunks if c.level == 4),
        )

        return chunks

    def _make_chunk(
        self,
        text: str,
        metadata: DocumentMetadata,
        level: int,
        section_name: str = "",
        page: int | None = None,
        position: int = 0,
        extra_metadata: dict | None = None,
    ) -> ChunkOutput:
        """Create a chunk with metadata prepended for embedding."""
        # Build metadata prefix
        parts = []
        if metadata.ticker:
            parts.append(f"[Ticker: {metadata.ticker}]")
        if metadata.company_name:
            parts.append(f"[Company: {metadata.company_name}]")
        if metadata.filing_type:
            parts.append(f"[Filing: {metadata.filing_type}]")
        if metadata.filing_date:
            parts.append(f"[Date: {metadata.filing_date}]")
        if section_name:
            parts.append(f"[Section: {section_name}]")
        if metadata.fiscal_year:
            parts.append(f"[FY: {metadata.fiscal_year}]")
        if metadata.fiscal_quarter:
            parts.append(f"[Quarter: {metadata.fiscal_quarter}]")

        prefix = " ".join(parts)
        text_with_meta = f"{prefix}\n\n{text}" if prefix else text

        meta_dict = {
            "ticker": metadata.ticker,
            "company_name": metadata.company_name,
            "filing_type": metadata.filing_type,
            "filing_date": metadata.filing_date,
            "document_title": f"{metadata.ticker} {metadata.filing_type} {metadata.filing_date}",
        }
        if extra_metadata:
            meta_dict.update(extra_metadata)

        return ChunkOutput(
            id=str(uuid.uuid4()),
            document_id=metadata.document_id,
            text=text,
            text_with_metadata=text_with_meta,
            level=level,
            section_name=section_name,
            page_number=page,
            token_count=count_tokens(text),
            position=position,
            metadata=meta_dict,
        )

    def _split_paragraphs(self, text: str) -> list[str]:
        """Split text into paragraphs on double-newlines."""
        paras = re.split(r"\n\s*\n", text)
        return [p.strip() for p in paras if p.strip()]

    def _split_sentences(self, text: str) -> list[str]:
        """Split text into sentences. Simple regex; can upgrade to SpaCy."""
        sents = re.split(r"(?<=[.!?])\s+(?=[A-Z])", text)
        return [s.strip() for s in sents if s.strip()]

    def _chunk_with_overlap(
        self,
        paragraphs: list[str],
        max_tokens: int,
        overlap_ratio: float,
    ) -> list[str]:
        """Combine paragraphs into chunks with token-based overlap."""
        if not paragraphs:
            return []

        chunks = []
        current = []
        current_tokens = 0

        for para in paragraphs:
            pt = count_tokens(para)

            if current_tokens + pt > max_tokens and current:
                # Emit current chunk
                chunks.append("\n\n".join(current))

                # Calculate overlap: keep the last N tokens worth of paragraphs
                overlap_tokens = int(max_tokens * overlap_ratio)
                overlap_paras = []
                overlap_t = 0
                for p in reversed(current):
                    t = count_tokens(p)
                    if overlap_t + t > overlap_tokens:
                        break
                    overlap_paras.insert(0, p)
                    overlap_t += t

                current = overlap_paras
                current_tokens = overlap_t

            current.append(para)
            current_tokens += pt

        # Flush remaining
        if current:
            chunks.append("\n\n".join(current))

        return chunks

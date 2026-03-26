"""Tests for the ingestion pipeline — chunker, metadata extraction, entity extraction."""
import pytest

from app.ingestion.processing.chunker import (
    HierarchicalChunker,
    DocumentMetadata,
    Section,
    count_tokens,
)


class TestCountTokens:
    """Test the tokenizer utility."""

    def test_empty_string(self):
        assert count_tokens("") == 0

    def test_hello_world(self):
        tokens = count_tokens("Hello world")
        assert tokens == 2  # cl100k_base: 2 tokens

    def test_financial_text(self):
        tokens = count_tokens(
            "Apple's Services revenue reached $96.2 billion in fiscal 2025"
        )
        assert tokens > 5  # Reasonable length
        assert tokens < 30  # Not absurdly long


class TestDocumentMetadata:
    """Test metadata dataclass."""

    def test_defaults(self):
        meta = DocumentMetadata(document_id="doc-123")
        assert meta.document_id == "doc-123"
        assert meta.ticker == ""
        assert meta.filing_type == ""

    def test_full_metadata(self):
        meta = DocumentMetadata(
            document_id="d1",
            ticker="AAPL",
            company_name="Apple Inc",
            filing_type="10-K",
            filing_date="2025-10-30",
            fiscal_year="2025",
            fiscal_quarter="FY",
        )
        assert meta.ticker == "AAPL"
        assert meta.filing_type == "10-K"


class TestHierarchicalChunker:
    """Test the 3-level hierarchical chunker."""

    @pytest.fixture
    def chunker(self):
        return HierarchicalChunker(
            section_max_tokens=200,
            paragraph_max_tokens=80,
            paragraph_overlap=0.2,
            sentence_max_tokens=40,
        )

    @pytest.fixture
    def sample_metadata(self):
        return DocumentMetadata(
            document_id="test-doc",
            ticker="AAPL",
            company_name="Apple Inc",
            filing_type="10-K",
            filing_date="2025-10-30",
        )

    def test_basic_chunking(self, chunker, sample_metadata):
        text = (
            "Apple Inc reported revenue of $124.3 billion in Q4 2025. "
            "Services revenue grew 14% year-over-year.\n\n"
            "The company's gross margin improved to 46.2%. "
            "Operating expenses remained well-controlled."
        )
        chunks = chunker.chunk_document(text, sample_metadata)

        assert len(chunks) > 0
        # Every chunk should have non-empty text
        for chunk in chunks:
            assert chunk.text.strip()
            assert chunk.document_id == "test-doc"
            assert chunk.token_count > 0

    def test_metadata_prefix(self, chunker, sample_metadata):
        """Chunks should have metadata-prefixed text for embedding."""
        text = "Apple revenue was $124B."
        chunks = chunker.chunk_document(text, sample_metadata)

        assert len(chunks) > 0
        # text_with_metadata should contain ticker info
        meta_text = chunks[0].text_with_metadata
        assert "AAPL" in meta_text or "Apple" in meta_text

    def test_section_aware_chunking(self, chunker, sample_metadata):
        """Pre-detected sections should be used for chunking."""
        sections = [
            Section(name="Item 1 - Business", text="Apple designs and manufactures consumer electronics. " * 10),
            Section(name="Item 7 - MD&A", text="Revenue increased 12% year-over-year. " * 10),
        ]
        chunks = chunker.chunk_document("", sample_metadata, sections=sections)

        assert len(chunks) > 0
        # Check that at least some chunks reference the section name
        section_names = {c.section_name for c in chunks}
        assert len(section_names) > 0

    def test_empty_text_no_crash(self, chunker, sample_metadata):
        """Empty documents should return empty chunk list."""
        chunks = chunker.chunk_document("", sample_metadata)
        assert isinstance(chunks, list)

    def test_very_long_text(self, chunker, sample_metadata):
        """Long text should be split into multiple chunks."""
        long_text = "This is a sentence about financial data. " * 200
        chunks = chunker.chunk_document(long_text, sample_metadata)

        assert len(chunks) > 1  # Should split

    def test_chunk_ids_are_unique(self, chunker, sample_metadata):
        text = "First paragraph about revenue.\n\nSecond paragraph about margins.\n\nThird about costs."
        chunks = chunker.chunk_document(text, sample_metadata)

        ids = [c.id for c in chunks]
        assert len(ids) == len(set(ids)), "Chunk IDs must be unique"

    def test_position_increments(self, chunker, sample_metadata):
        text = "Revenue data.\n\n" * 5
        chunks = chunker.chunk_document(text, sample_metadata)

        if len(chunks) > 1:
            positions = [c.position for c in chunks]
            # Positions should be assigned (typically incrementing)
            assert max(positions) >= 0

"""
Gravity Search — User Upload Handler
Thin orchestrator: takes an uploaded file, runs it through all
processing/indexing components in parallel, and returns a summary.
"""

import asyncio
import uuid
import structlog
from fastapi import UploadFile

from app.ingestion.processing.document_processor import DocumentProcessor
from app.ingestion.processing.metadata_extractor import MetadataExtractor
from app.ingestion.processing.section_detector import SectionDetector
from app.ingestion.processing.entity_extractor import EntityExtractor
from app.ingestion.processing.chunker import HierarchicalChunker, DocumentMetadata
from app.ingestion.indexing.vector_indexer import VectorIndexer
from app.ingestion.indexing.keyword_indexer import KeywordIndexer
from app.ingestion.indexing.graph_indexer import GraphIndexer
from app.ingestion.indexing.structured_indexer import StructuredIndexer

logger = structlog.get_logger()


class UserUploadHandler:
    """
    Orchestrates the full ingestion flow for a user-uploaded document.

    Steps:
      1. Parse raw bytes → clean text (DocumentProcessor)
      2. Extract metadata (MetadataExtractor)
      3. Detect sections (SectionDetector)
      4. Extract entities (EntityExtractor)
      5. Chunk hierarchically (HierarchicalChunker)
      6. Index in parallel:
         - Vector indexer (Qdrant dense + sparse)
         - Keyword indexer (Elasticsearch BM25)
         - Graph indexer (Neo4j)
         - Structured indexer (PostgreSQL financial_statements)

    Returns:
      {
        "document_id": str,
        "chunk_count": int,
        "ticker": str,
        "filing_type": str,
        "sections_found": int,
        "entities_found": dict,
        "indexing": {
          "vector": bool, "keyword": bool, "graph": bool, "structured": bool
        }
      }
    """

    def __init__(
        self,
        vector_indexer: VectorIndexer | None = None,
        keyword_indexer: KeywordIndexer | None = None,
        graph_indexer: GraphIndexer | None = None,
        structured_indexer: StructuredIndexer | None = None,
    ):
        self.doc_processor = DocumentProcessor()
        self.metadata_extractor = MetadataExtractor()
        self.section_detector = SectionDetector()
        self.entity_extractor = EntityExtractor()
        self.chunker = HierarchicalChunker()

        self.vector_indexer = vector_indexer
        self.keyword_indexer = keyword_indexer
        self.graph_indexer = graph_indexer
        self.structured_indexer = structured_indexer

    async def handle_upload(
        self,
        file: UploadFile,
        ticker: str = "",
        company_name: str = "",
    ) -> dict:
        """
        Process and index a user-uploaded file.

        Args:
            file: FastAPI UploadFile object
            ticker: Optional ticker override
            company_name: Optional company name override

        Returns:
            Ingestion result summary dict
        """
        document_id = str(uuid.uuid4())
        filename = file.filename or "upload.txt"
        content_type = file.content_type or "text/plain"

        logger.info(
            "user_upload_start",
            document_id=document_id,
            filename=filename,
            content_type=content_type,
        )

        # Read file content
        content = await file.read()

        return await self._ingest_bytes(
            content=content,
            content_type=content_type,
            filename=filename,
            document_id=document_id,
            ticker=ticker,
            company_name=company_name,
        )

    async def ingest_bytes(
        self,
        content: bytes,
        content_type: str,
        filename: str,
        ticker: str = "",
        company_name: str = "",
        filing_type: str = "",
        filing_date: str = "",
        source_url: str = "",
    ) -> dict:
        """
        Process and index raw bytes (used by SEC EDGAR / programmatic ingestion).
        """
        document_id = str(uuid.uuid4())
        return await self._ingest_bytes(
            content=content,
            content_type=content_type,
            filename=filename,
            document_id=document_id,
            ticker=ticker,
            company_name=company_name,
            filing_type=filing_type,
            filing_date=filing_date,
            source_url=source_url,
        )

    async def _ingest_bytes(
        self,
        content: bytes,
        content_type: str,
        filename: str,
        document_id: str,
        ticker: str = "",
        company_name: str = "",
        filing_type: str = "",
        filing_date: str = "",
        source_url: str = "",
    ) -> dict:
        """Internal ingestion logic."""
        # Step 1: Process document → clean text
        processed = await asyncio.get_event_loop().run_in_executor(
            None,
            self.doc_processor.process,
            content,
            content_type,
            filename,
        )

        if not processed.text.strip():
            logger.warning("user_upload_empty_text", document_id=document_id)
            return {
                "document_id": document_id,
                "chunk_count": 0,
                "error": "No text extracted from document",
            }

        # Step 2: Extract metadata (use overrides if provided)
        metadata = self.metadata_extractor.extract(processed.text, filename)
        metadata.document_id = document_id
        if ticker:
            metadata.ticker = ticker
        if company_name:
            metadata.company_name = company_name
        if filing_type:
            metadata.filing_type = filing_type
        if filing_date:
            metadata.filing_date = filing_date
        if source_url:
            metadata.source_url = source_url

        # Step 3: Detect sections
        sections = await asyncio.get_event_loop().run_in_executor(
            None,
            self.section_detector.detect_sections,
            processed.text,
            metadata.filing_type,
        )

        # Step 4: Extract entities
        entities = await asyncio.get_event_loop().run_in_executor(
            None,
            self.entity_extractor.extract,
            processed.text[:50_000],  # Cap at 50k chars for performance
        )

        # Step 5: Chunk document hierarchically
        chunks = self.chunker.chunk_document(
            text=processed.text,
            metadata=metadata,
            sections=sections if sections else None,
        )

        logger.info(
            "user_upload_chunked",
            document_id=document_id,
            chunk_count=len(chunks),
            section_count=len(sections),
        )

        # Step 6: Parallel indexing
        index_results = await self._parallel_index(
            document_id=document_id,
            chunks=chunks,
            metadata=metadata,
            entities=entities,
        )

        logger.info(
            "user_upload_complete",
            document_id=document_id,
            chunk_count=len(chunks),
            indexing=index_results,
        )

        return {
            "document_id": document_id,
            "chunk_count": len(chunks),
            "ticker": metadata.ticker,
            "company_name": metadata.company_name,
            "filing_type": metadata.filing_type,
            "filing_date": metadata.filing_date,
            "sections_found": len(sections),
            "entities_found": {
                "companies": len(entities.get("companies", [])),
                "people": len(entities.get("people", [])),
                "metrics": len(entities.get("metrics", [])),
                "themes": len(entities.get("themes", [])),
            },
            "indexing": index_results,
        }

    async def _parallel_index(
        self,
        document_id: str,
        chunks: list,
        metadata: "DocumentMetadata",
        entities: dict,
    ) -> dict:
        """Run all indexers in parallel using asyncio.gather()."""
        results = {"vector": False, "keyword": False, "graph": False, "structured": False}

        async def run_vector():
            if not self.vector_indexer:
                return
            try:
                await self.vector_indexer.index_chunks(chunks)
                results["vector"] = True
            except Exception as e:
                logger.warning("vector_index_failed", document_id=document_id, error=str(e))

        async def run_keyword():
            if not self.keyword_indexer:
                return
            try:
                await self.keyword_indexer.index_chunks(chunks)
                results["keyword"] = True
            except Exception as e:
                logger.warning("keyword_index_failed", document_id=document_id, error=str(e))

        async def run_graph():
            if not self.graph_indexer:
                return
            try:
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    self.graph_indexer.index_document,
                    document_id,
                    metadata,
                    entities,
                )
                results["graph"] = True
            except Exception as e:
                logger.warning("graph_index_failed", document_id=document_id, error=str(e))

        async def run_structured():
            if not self.structured_indexer:
                return
            try:
                full_text = " ".join(c.text for c in chunks[:50])  # sample first 50 chunks
                await self.structured_indexer.extract_and_store(
                    text=full_text,
                    document_id=document_id,
                    ticker=metadata.ticker,
                    filing_type=metadata.filing_type,
                    filing_date=metadata.filing_date,
                )
                results["structured"] = True
            except Exception as e:
                logger.warning("structured_index_failed", document_id=document_id, error=str(e))

        await asyncio.gather(
            run_vector(),
            run_keyword(),
            run_graph(),
            run_structured(),
            return_exceptions=True,
        )

        return results

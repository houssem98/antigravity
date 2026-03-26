"""
Gravity Search — Main Ingestion Pipeline
Wires all processing, indexing, and knowledge graph components.
Entry point for all document ingestion (user upload, SEC EDGAR, earnings, news).

7-Step Flow:
  1. Process bytes → clean text (DocumentProcessor)
  2. Extract metadata (MetadataExtractor)
  3. Detect sections (SectionDetector)
  4. Extract entities (EntityExtractor)
  5. Chunk hierarchically (HierarchicalChunker)
  6. Parallel indexing:
     - Vector (Qdrant dense + sparse)
     - Keyword (Elasticsearch BM25)
     - Graph (Neo4j)
     - Structured (PostgreSQL financial_statements)
  7. Save document record to PostgreSQL
"""

import asyncio
import uuid
import structlog
from datetime import datetime

from app.ingestion.processing.document_processor import DocumentProcessor
from app.ingestion.processing.metadata_extractor import MetadataExtractor
from app.ingestion.processing.section_detector import SectionDetector
from app.ingestion.processing.entity_extractor import EntityExtractor
from app.ingestion.processing.chunker import HierarchicalChunker, DocumentMetadata

logger = structlog.get_logger()


class IngestionPipeline:
    """
    Main ingestion pipeline wiring all processing and indexing components.

    Usage:
        pipeline = IngestionPipeline.create()  # factory with auto-wiring
        result = await pipeline.ingest_bytes(content, content_type, filename)
        result = await pipeline.ingest_from_url(url, filing_type)
    """

    def __init__(
        self,
        vector_indexer=None,
        keyword_indexer=None,
        graph_indexer=None,
        structured_indexer=None,
        db_session_factory=None,
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
        self.db_session_factory = db_session_factory

    @classmethod
    def create(cls) -> "IngestionPipeline":
        """
        Factory: build a fully wired IngestionPipeline from app settings.
        Gracefully skips indexers if their backends are unavailable.
        """
        from app.dependencies import get_embedder, get_splade_encoder

        vector_indexer = None
        keyword_indexer = None
        graph_indexer = None
        structured_indexer = None

        try:
            from app.ingestion.indexing.vector_indexer import VectorIndexer
            embedder = get_embedder()
            splade = get_splade_encoder()
            vector_indexer = VectorIndexer(embedder=embedder, splade_encoder=splade)
        except Exception as e:
            logger.warning("vector_indexer_unavailable", error=str(e))

        try:
            from app.ingestion.indexing.keyword_indexer import KeywordIndexer
            from app.db.elasticsearch import get_es_client
            keyword_indexer = KeywordIndexer(es_client=get_es_client())
        except Exception as e:
            logger.warning("keyword_indexer_unavailable", error=str(e))

        try:
            from app.ingestion.indexing.graph_indexer import GraphIndexer
            from app.db.neo4j import get_neo4j_driver
            graph_indexer = GraphIndexer(driver=get_neo4j_driver())
        except Exception as e:
            logger.warning("graph_indexer_unavailable", error=str(e))

        try:
            from app.ingestion.indexing.structured_indexer import StructuredIndexer
            from app.llm.router import LLMRouter
            router = LLMRouter()
            fast_client = router.get_fast_client()
            structured_indexer = StructuredIndexer(llm_client=fast_client)
        except Exception as e:
            logger.warning("structured_indexer_unavailable", error=str(e))

        try:
            from app.db.postgres import async_session
            db_session_factory = async_session
        except Exception as e:
            logger.warning("db_session_unavailable", error=str(e))
            db_session_factory = None

        return cls(
            vector_indexer=vector_indexer,
            keyword_indexer=keyword_indexer,
            graph_indexer=graph_indexer,
            structured_indexer=structured_indexer,
            db_session_factory=db_session_factory,
        )

    async def ingest_from_url(
        self,
        url: str,
        filing_type: str = "",
        ticker: str = "",
        company_name: str = "",
        filing_date: str = "",
    ) -> dict:
        """
        Download content from URL and ingest it.

        Args:
            url: HTTP URL to download from
            filing_type: e.g. "10-K", "10-Q", "8-K", "earnings"
            ticker: Stock ticker
            company_name: Full company name
            filing_date: ISO date string

        Returns:
            Ingestion result dict
        """
        import httpx

        logger.info("ingest_from_url", url=url, filing_type=filing_type, ticker=ticker)

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.get(
                    url,
                    headers={"User-Agent": "GravitySearch/1.0 (gravity@antigravity.ai)"},
                    follow_redirects=True,
                )
                response.raise_for_status()
                content = response.content
                content_type = response.headers.get("content-type", "text/html").split(";")[0]
        except Exception as e:
            logger.error("ingest_url_download_failed", url=url, error=str(e))
            return {"error": f"Failed to download: {e}", "url": url}

        filename = url.split("/")[-1] or f"{ticker}_{filing_type}.html"
        return await self.ingest_bytes(
            content=content,
            content_type=content_type,
            filename=filename,
            ticker=ticker,
            company_name=company_name,
            filing_type=filing_type,
            filing_date=filing_date,
            source_url=url,
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
        document_id: str | None = None,
    ) -> dict:
        """
        Full 7-step ingestion of raw bytes content.

        Returns:
            {
              "document_id": str,
              "chunk_count": int,
              "ticker": str,
              "company_name": str,
              "filing_type": str,
              "sections_found": int,
              "entities": dict,
              "indexing": dict,
              "saved_to_db": bool,
            }
        """
        document_id = document_id or str(uuid.uuid4())

        logger.info(
            "pipeline_ingest_start",
            document_id=document_id,
            content_type=content_type,
            filename=filename,
            size_bytes=len(content),
        )

        # Step 1: Process bytes → clean text
        processed = await self.doc_processor.process(content, content_type, filename)

        if not processed.text.strip():
            logger.warning("pipeline_empty_text", document_id=document_id)
            return {
                "document_id": document_id,
                "chunk_count": 0,
                "error": "No extractable text in document",
            }

        # Step 2: Extract metadata
        metadata = await self.metadata_extractor.extract(processed.text, filename)
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

        # Step 4: Extract entities (cap text for performance)
        entities = await self.entity_extractor.extract(processed.text[:50_000])

        # Step 5: Chunk hierarchically (including Level 4 table chunks)
        chunks = self.chunker.chunk_document(
            text=processed.text,
            metadata=metadata,
            sections=sections if sections else None,
            tables=processed.tables if processed.tables else None,
        )

        logger.info(
            "pipeline_chunked",
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

        # Step 7: Save document record to PostgreSQL
        saved = await self._save_document_record(
            document_id=document_id,
            metadata=metadata,
            processed=processed,
            chunk_count=len(chunks),
            source_url=source_url,
        )

        result = {
            "document_id": document_id,
            "chunk_count": len(chunks),
            "ticker": metadata.ticker,
            "company_name": metadata.company_name,
            "filing_type": metadata.filing_type,
            "filing_date": metadata.filing_date,
            "sections_found": len(sections),
            "entities": {
                "companies": len(entities.get("companies", [])),
                "people": len(entities.get("people", [])),
                "metrics": len(entities.get("metrics", [])),
                "themes": len(entities.get("themes", [])),
            },
            "indexing": index_results,
            "saved_to_db": saved,
        }

        logger.info("pipeline_ingest_complete", **{k: v for k, v in result.items() if k != "entities"})
        return result

    async def _parallel_index(
        self,
        document_id: str,
        chunks: list,
        metadata: DocumentMetadata,
        entities: dict,
    ) -> dict:
        """Run all indexers concurrently."""
        results = {
            "vector": False,
            "keyword": False,
            "graph": False,
            "structured": False,
        }

        async def run_vector():
            if not self.vector_indexer:
                return
            try:
                await self.vector_indexer.index_chunks(chunks)
                results["vector"] = True
                logger.info("vector_indexed", document_id=document_id, count=len(chunks))
            except Exception as e:
                logger.warning("vector_index_failed", document_id=document_id, error=str(e))

        async def run_keyword():
            if not self.keyword_indexer:
                return
            try:
                await self.keyword_indexer.index_chunks(chunks)
                results["keyword"] = True
                logger.info("keyword_indexed", document_id=document_id, count=len(chunks))
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
                logger.info("graph_indexed", document_id=document_id)
            except Exception as e:
                logger.warning("graph_index_failed", document_id=document_id, error=str(e))

        async def run_structured():
            if not self.structured_indexer:
                return
            try:
                # Sample first 50 paragraph-level chunks for financial extraction
                para_chunks = [c for c in chunks if c.level == 2][:50]
                sample_text = " ".join(c.text for c in para_chunks)
                await self.structured_indexer.extract_and_store(
                    text=sample_text,
                    document_id=document_id,
                    ticker=metadata.ticker,
                    filing_type=metadata.filing_type,
                    filing_date=metadata.filing_date,
                )
                results["structured"] = True
                logger.info("structured_indexed", document_id=document_id)
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

    async def _save_document_record(
        self,
        document_id: str,
        metadata: DocumentMetadata,
        processed,
        chunk_count: int,
        source_url: str,
    ) -> bool:
        """Save document metadata to PostgreSQL Document table."""
        if not self.db_session_factory:
            return False

        try:
            from app.db.models import Document
            from sqlalchemy import text

            async with self.db_session_factory() as session:
                doc = Document(
                    id=document_id,
                    ticker=metadata.ticker,
                    company_name=metadata.company_name,
                    filing_type=metadata.filing_type,
                    filing_date=metadata.filing_date or None,
                    fiscal_year=metadata.fiscal_year or None,
                    title=processed.title or f"{metadata.ticker} {metadata.filing_type}",
                    source_url=source_url or metadata.source_url,
                    page_count=processed.page_count,
                    chunk_count=chunk_count,
                    status="indexed",
                    created_at=datetime.utcnow(),
                )
                session.add(doc)
                await session.commit()
            return True
        except Exception as e:
            logger.warning("save_document_failed", document_id=document_id, error=str(e))
            return False

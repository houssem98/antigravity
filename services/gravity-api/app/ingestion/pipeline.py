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
        page_indexer=None,
        table_indexer=None,
        raptor_indexer=None,
        contextual_retrieval=None,
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
        self.page_indexer = page_indexer
        self.table_indexer = table_indexer
        self.raptor_indexer = raptor_indexer
        self.contextual_retrieval = contextual_retrieval

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
            import os as _os
            from app.ingestion.indexing.vector_indexer import VectorIndexer
            embedder = get_embedder()
            # Only load the SPLADE encoder when explicitly enabled. The encoder
            # lazy-loads a ~500MB BERT model on first encode_document(), which
            # OOM-kills small (1GB) machines during ingestion. The SPLADE_ENABLED
            # flag must gate indexing, not just warmup.
            splade = (
                get_splade_encoder()
                if _os.getenv("SPLADE_ENABLED", "").lower() == "true"
                else None
            )
            vector_indexer = VectorIndexer(embedder=embedder, splade_encoder=splade)
        except Exception as e:
            logger.warning("vector_indexer_unavailable", error=str(e))

        try:
            from app.ingestion.indexing.keyword_indexer import KeywordIndexer
            keyword_indexer = KeywordIndexer()
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

        # PageIndexer — registers PDFs with VectifyAI PageIndex API
        page_indexer = None
        try:
            from app.ingestion.indexing.page_indexer import PageIndexer
            page_indexer = PageIndexer()
            if page_indexer.enabled:
                # Link to the live search channel so in-memory registry stays in sync
                try:
                    from app.dependencies import get_search_pipeline
                    sp = get_search_pipeline()
                    pi_search = sp.retrieval.channels.get("page_index")
                    if pi_search:
                        page_indexer.set_search_channel(pi_search)
                except Exception:
                    pass
        except Exception as e:
            logger.warning("page_indexer_unavailable", error=str(e))

        # TableIndexer -- converts ParsedTable objects into Qdrant/ES chunks + gravity_financials rows
        table_indexer = None
        try:
            from app.ingestion.indexing.table_indexer import TableIndexer
            from app.db.elasticsearch import get_es_client
            table_indexer = TableIndexer(
                vector_indexer=vector_indexer,
                keyword_indexer=keyword_indexer,
                es_client=get_es_client(),
            )
        except Exception as e:
            logger.warning("table_indexer_unavailable", error=str(e))

        # RaptorIndexer -- builds Level 0 summary chunks for multi-granularity retrieval
        raptor_indexer = None
        try:
            from app.ingestion.indexing.raptor_indexer import RaptorIndexer
            from app.llm.router import LLMRouter
            _raptor_router = LLMRouter()
            raptor_indexer = RaptorIndexer(
                llm_client=_raptor_router.get_fast_client(),
                embedder=get_embedder(),
            )
        except Exception as e:
            logger.warning("raptor_indexer_unavailable", error=str(e))

        # ContextualRetrieval -- Anthropic Sept 2024: prepend per-chunk context
        # summary to text_with_metadata before embedding (-49% retrieval failures)
        contextual_retrieval = None
        try:
            from app.ingestion.processing.contextual_retrieval import ContextualRetrieval
            from app.llm.router import LLMRouter as _CR_Router
            _cr_router = _CR_Router()
            contextual_retrieval = ContextualRetrieval(
                llm_client=_cr_router.get_fast_client()
            )
        except Exception as e:
            logger.warning("contextual_retrieval_unavailable", error=str(e))

        return cls(
            vector_indexer=vector_indexer,
            keyword_indexer=keyword_indexer,
            graph_indexer=graph_indexer,
            structured_indexer=structured_indexer,
            db_session_factory=db_session_factory,
            page_indexer=page_indexer,
            table_indexer=table_indexer,
            raptor_indexer=raptor_indexer,
            contextual_retrieval=contextual_retrieval,
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

        # Step 2.5: SEC form-specific structured parse for Form 4, 13F-HR,
        # SC 13D/G. Pulls structured fields (insider transactions, holdings,
        # beneficial ownership) into metadata.sec_form_data so retrieval
        # filters and agents can act on them as structured data, not regex.
        sec_form_data: dict = {}
        try:
            from app.ingestion.processing.sec_form_parsers import parse_sec_form
            sec_form_data = parse_sec_form(metadata.filing_type, content, processed.text) or {}
            if sec_form_data:
                if not hasattr(metadata, "extra") or metadata.extra is None:
                    metadata.extra = {}
                metadata.extra["sec_form_data"] = sec_form_data
                logger.info(
                    "sec_form_parsed",
                    document_id=document_id,
                    form=sec_form_data.get("form"),
                    fields=list(sec_form_data.keys()),
                )
        except Exception as e:
            logger.warning("sec_form_parse_failed", document_id=document_id, error=str(e))

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

        # Step 5a: Contextual Retrieval (Anthropic Sept 2024)
        # Prepend per-chunk LLM context to text_with_metadata before embedding.
        # -49% retrieval failures standalone, -67% with BM25+rerank.
        # Skips Level 3 (sentence) chunks — too granular to benefit.
        if self.contextual_retrieval:
            try:
                chunks = await self.contextual_retrieval.enrich(
                    chunks, processed.text, metadata
                )
            except Exception as e:
                logger.warning("contextual_retrieval_failed", document_id=document_id, error=str(e))

        # Step 5b: RAPTOR -- generate Level 0 summary chunks and append
        # Runs async, errors are non-fatal (summaries improve recall but aren't required)
        if self.raptor_indexer:
            try:
                raptor_summaries = await self.raptor_indexer.build_summaries(chunks, metadata)
                if raptor_summaries:
                    chunks = list(chunks) + raptor_summaries
                    logger.info(
                        "raptor_summaries_appended",
                        document_id=document_id,
                        summary_count=len(raptor_summaries),
                    )
            except Exception as e:
                logger.warning("raptor_build_failed", document_id=document_id, error=str(e))

        # Step 6: Parallel indexing
        index_results = await self._parallel_index(
            document_id=document_id,
            chunks=chunks,
            metadata=metadata,
            entities=entities,
            content=content,
            content_type=content_type,
            tables=processed.tables if processed.tables else None,
            xbrl_facts=processed.xbrl_facts if processed.xbrl_facts else None,
        )

        # Step 7: Save document record + normalized text + chunks to PostgreSQL.
        # raw_text is the normalized extracted text, so the corpus can be
        # re-chunked / re-embedded later without re-downloading or re-parsing.
        saved = await self._save_document_record(
            document_id=document_id,
            metadata=metadata,
            processed=processed,
            chunks=chunks,
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
        content: bytes = b"",
        content_type: str = "",
        tables: list | None = None,
        xbrl_facts: list | None = None,
    ) -> dict:
        """Run all indexers concurrently."""
        results = {
            "vector": False,
            "keyword": False,
            "graph": False,
            "structured": False,
            "page_index": False,
            "tables": False,
            "xbrl": False,
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
                para_chunks = [c for c in chunks if c.level == 2][:50]
                sample_text = " ".join(c.text for c in para_chunks)
                await self.structured_indexer.index_document(
                    document_id=document_id,
                    text=sample_text,
                    metadata={
                        "ticker": metadata.ticker,
                        "company_name": metadata.company_name,
                        "filing_type": metadata.filing_type,
                        "filing_date": metadata.filing_date,
                    },
                )
                results["structured"] = True
                logger.info("structured_indexed", document_id=document_id)
            except Exception as e:
                logger.warning("structured_index_failed", document_id=document_id, error=str(e))

        async def run_page_index():
            if not self.page_indexer or not self.page_indexer.enabled:
                return
            if content_type != "application/pdf":
                return
            import os, tempfile
            tmp_path = None
            try:
                from app.config import settings
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                    tmp.write(content)
                    tmp_path = tmp.name
                db_url = str(settings.postgres_url).replace("postgresql+psycopg://", "postgresql://")
                pi_id = await self.page_indexer.index_document(
                    gravity_doc_id=document_id,
                    pdf_path=tmp_path,
                    db_url=db_url,
                )
                if pi_id:
                    results["page_index"] = True
                    logger.info("page_index_indexed", document_id=document_id, pi_id=pi_id)
            except Exception as e:
                logger.warning("page_index_ingest_failed", document_id=document_id, error=str(e))
            finally:
                if tmp_path and os.path.exists(tmp_path):
                    os.unlink(tmp_path)

        async def run_tables():
            if not self.table_indexer or not tables:
                return
            try:
                meta_dict = {
                    "ticker": metadata.ticker,
                    "company_name": metadata.company_name,
                    "filing_type": metadata.filing_type,
                    "filing_date": metadata.filing_date,
                }
                tbl_result = await self.table_indexer.index_tables(tables, meta_dict, document_id)
                results["tables"] = tbl_result.get("chunks_indexed", 0) > 0 or tbl_result.get("rows_indexed", 0) > 0
                logger.info("tables_indexed", document_id=document_id, **tbl_result)
            except Exception as e:
                logger.warning("table_index_failed", document_id=document_id, error=str(e))

        async def run_xbrl():
            if not xbrl_facts:
                return
            if not self.vector_indexer and not self.keyword_indexer:
                return
            try:
                from app.ingestion.processing.chunker import ChunkOutput
                ticker = metadata.ticker
                company = metadata.company_name
                xbrl_chunks: list[ChunkOutput] = []
                for i, fact in enumerate(xbrl_facts):
                    sentence = fact.to_sentence(ticker=ticker, company=company)
                    # Qdrant point IDs must be int or UUID. Derive a deterministic
                    # UUID5 from the composite key so re-ingest stays idempotent.
                    import uuid as _uuid
                    chunk_id = str(_uuid.uuid5(
                        _uuid.NAMESPACE_URL,
                        f"{document_id}:xbrl:{fact.local_name}:{fact.context_id}",
                    ))
                    xbrl_chunks.append(ChunkOutput(
                        id=chunk_id,
                        document_id=document_id,
                        text=sentence,
                        text_with_metadata=sentence,
                        level=4,  # Same level as table chunks
                        section_name="XBRL Financial Data",
                        position=i,
                        metadata={
                            "xbrl_concept": fact.concept,
                            "metric_name": fact.metric_name,
                            "period": fact.period_label,
                            "value": fact.value,
                            "unit": fact.unit,
                            "source": "xbrl",
                        },
                    ))
                if self.vector_indexer and xbrl_chunks:
                    await self.vector_indexer.index_chunks(xbrl_chunks)
                if self.keyword_indexer and xbrl_chunks:
                    await self.keyword_indexer.index_chunks(xbrl_chunks)
                results["xbrl"] = len(xbrl_chunks) > 0
                logger.info("xbrl_indexed", document_id=document_id, facts=len(xbrl_chunks))
            except Exception as e:
                logger.warning("xbrl_index_failed", document_id=document_id, error=str(e))

        await asyncio.gather(
            run_vector(),
            run_keyword(),
            run_graph(),
            run_structured(),
            run_page_index(),
            run_tables(),
            run_xbrl(),
            return_exceptions=True,
        )

        return results

    async def _save_document_record(
        self,
        document_id: str,
        metadata: DocumentMetadata,
        processed,
        chunks,
        source_url: str,
    ) -> bool:
        """
        Persist the document, its normalized text (raw_text), and its chunks to
        PostgreSQL. The normalized text + chunk rows form the re-embed/re-chunk
        source of truth, so switching embedders or re-chunking never requires
        re-downloading or re-parsing the original filing.
        """
        if not self.db_session_factory:
            return False

        try:
            from app.db.models import Document, Chunk

            # Only fields that exist on the model; extras go in metadata JSON.
            doc_meta = {
                "company_name": metadata.company_name,
                "page_count": getattr(processed, "page_count", None),
            }

            async with self.db_session_factory() as session:
                # Re-ingest safety: drop any prior rows for this document id.
                existing = await session.get(Document, document_id)
                if existing is not None:
                    await session.delete(existing)  # cascades to chunks
                    await session.flush()

                session.add(Document(
                    id=document_id,
                    ticker=metadata.ticker,
                    filing_type=metadata.filing_type,
                    filing_date=metadata.filing_date or None,
                    fiscal_year=metadata.fiscal_year or None,
                    fiscal_quarter=getattr(metadata, "fiscal_quarter", None) or None,
                    title=getattr(processed, "title", "") or f"{metadata.ticker} {metadata.filing_type}",
                    source_url=source_url or metadata.source_url,
                    raw_text=processed.text,
                    doc_metadata=doc_meta,
                    chunk_count=len(chunks),
                    status="indexed",
                    created_at=datetime.utcnow(),
                ))

                # Persist chunks (skip RAPTOR L0 summaries — they are derived).
                for c in chunks:
                    if getattr(c, "level", None) == 0:
                        continue
                    session.add(Chunk(
                        id=c.id,
                        document_id=document_id,
                        text=c.text,
                        text_with_metadata=c.text_with_metadata,
                        chunk_level=c.level,
                        section_name=c.section_name or "",
                        page_number=c.page_number,
                        token_count=c.token_count,
                        position=c.position,
                        chunk_metadata=c.metadata or {},
                    ))

                await session.commit()
            return True
        except Exception as e:
            logger.warning("save_document_failed", document_id=document_id, error=str(e))
            return False

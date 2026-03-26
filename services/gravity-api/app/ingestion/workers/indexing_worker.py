"""
Gravity Search — Indexing Worker  (Flink Stage 5–6 equivalent)
Consumes: gravity.processed-documents
Produces: gravity.indexed-documents

Pipeline per message:
  Stage 5: HierarchicalChunker → 3-level chunks with metadata prepending
  Stage 6 (parallel):
    6a. VectorIndexer   → Qdrant (dense voyage-finance-2 + sparse SPLADE)
    6b. KeywordIndexer  → Elasticsearch BM25
    6c. GraphIndexer    → Neo4j (company / person / theme / filing nodes)
    6d. StructuredIndexer → PostgreSQL (financial metrics via Gemini Flash)
  Stage 7: Document record → PostgreSQL documents table
  → publish IndexedDocumentMessage to gravity.indexed-documents

Flink analogy:
  input stream  → DataStream<ProcessedDocumentMessage>
  flatMap       → HierarchicalChunker (one doc → many chunks)
  async sink    → parallel index writes (Qdrant, ES, Neo4j, PG)
  output stream → DataStream<IndexedDocumentMessage>
"""

from __future__ import annotations

import asyncio
import structlog
import uuid
from datetime import datetime, timezone

from app.ingestion.topics import (
    IndexedDocumentMessage,
    ProcessedDocumentMessage,
    Topics,
)
from app.ingestion.kafka_client import publish
from app.ingestion.workers.base import BaseWorker

logger = structlog.get_logger()


class IndexingWorker(BaseWorker[ProcessedDocumentMessage]):
    """
    Stateful indexing worker: builds embeddings and pushes to all backends.
    CPU/network-bound — fewer instances than processing workers.
    """

    input_topic = Topics.PROCESSED_DOCUMENTS
    input_schema = ProcessedDocumentMessage
    group_id = "gravity-indexing-workers"
    max_concurrency = 2  # embedding is expensive; keep bounded

    _chunker = None
    _vector_indexer = None
    _keyword_indexer = None
    _graph_indexer = None
    _structured_indexer = None
    _pipeline = None  # IngestionPipeline (for document record + structured extraction)

    async def setup(self) -> None:
        """Warm up all indexing components once at startup."""
        from app.ingestion.processing.hierarchical_chunker import HierarchicalChunker
        from app.ingestion.indexing.vector_indexer import VectorIndexer
        from app.ingestion.indexing.keyword_indexer import KeywordIndexer
        from app.ingestion.indexing.graph_indexer import GraphIndexer
        from app.ingestion.indexing.structured_indexer import StructuredIndexer

        self._chunker = HierarchicalChunker()
        self._vector_indexer = VectorIndexer()
        self._keyword_indexer = KeywordIndexer()
        self._graph_indexer = GraphIndexer()
        self._structured_indexer = StructuredIndexer()

        logger.info("indexing_worker_ready", backends=["qdrant", "elasticsearch", "neo4j", "postgres"])

    async def process(self, message: ProcessedDocumentMessage) -> None:
        """Run Stage 5–7 for one processed document."""
        log = logger.bind(
            msg_id=message.message_id,
            document_id=message.document_id,
            ticker=message.ticker,
            filing_type=message.filing_type,
        )
        log.info("indexing_start", sections=len(message.sections))

        # ── Stage 5: Hierarchical chunking ────────────────────────────────
        # Reconstruct section objects from the message DTO
        all_chunks = []
        for section in message.sections:
            # Build a minimal chunk input for the chunker
            section_chunks = self._chunker.chunk_section(
                text=section.text,
                section_name=section.name,
                document_id=message.document_id,
                ticker=message.ticker,
                company_name=message.company_name,
                filing_type=message.filing_type,
                filing_date=message.filing_date,
                document_title=message.title,
            )
            all_chunks.extend(section_chunks)

        if not all_chunks:
            log.warning("indexing_no_chunks_skip")
            return

        log.info("indexing_chunks_ready", chunk_count=len(all_chunks))

        # ── Stage 6: Parallel indexing across all 4 backends ──────────────
        results = await asyncio.gather(
            self._index_vectors(all_chunks, log),
            self._index_keywords(all_chunks, log),
            self._index_graph(message, log),
            self._index_structured(message, all_chunks, log),
            return_exceptions=True,
        )

        backends_ok = []
        backend_names = ["qdrant", "elasticsearch", "neo4j", "postgres_structured"]
        for name, result in zip(backend_names, results):
            if isinstance(result, Exception):
                log.warning(f"indexing_backend_failed", backend=name, error=str(result))
            else:
                backends_ok.append(name)

        # ── Stage 7: Save document record to PostgreSQL ───────────────────
        await self._save_document_record(message, len(all_chunks), log)

        # ── Publish completion event ──────────────────────────────────────
        completion = IndexedDocumentMessage(
            processed_message_id=message.message_id,
            document_id=message.document_id,
            ticker=message.ticker,
            filing_type=message.filing_type,
            chunk_count=len(all_chunks),
            index_backends=backends_ok,
        )
        await publish(
            topic=Topics.INDEXED_DOCUMENTS,
            message=completion,
            key=message.ticker or message.source,
        )

        log.info(
            "indexing_complete",
            chunk_count=len(all_chunks),
            backends_ok=backends_ok,
        )

    # ── Backend helpers ───────────────────────────────────────────────────

    async def _index_vectors(self, chunks, log) -> None:
        try:
            await self._vector_indexer.index_chunks(chunks)
        except Exception as e:
            log.warning("vector_index_failed", error=str(e))
            raise

    async def _index_keywords(self, chunks, log) -> None:
        try:
            await self._keyword_indexer.index_chunks(chunks)
        except Exception as e:
            log.warning("keyword_index_failed", error=str(e))
            raise

    async def _index_graph(self, message: ProcessedDocumentMessage, log) -> None:
        try:
            await self._graph_indexer.index_document(
                document_id=message.document_id,
                ticker=message.ticker,
                company_name=message.company_name,
                filing_type=message.filing_type,
                filing_date=message.filing_date,
                fiscal_year=message.fiscal_year,
                fiscal_quarter=message.fiscal_quarter,
                title=message.title,
                source_url=message.source_url,
                entities=message.entities,
            )
        except Exception as e:
            log.warning("graph_index_failed", error=str(e))
            raise

    async def _index_structured(
        self,
        message: ProcessedDocumentMessage,
        chunks,
        log,
    ) -> None:
        try:
            # Pass a sample of paragraph chunks for financial metric extraction
            para_chunks = [c for c in chunks if getattr(c, "chunk_level", 2) == 2]
            await self._structured_indexer.index_financial_metrics(
                document_id=message.document_id,
                ticker=message.ticker,
                filing_type=message.filing_type,
                filing_date=message.filing_date,
                fiscal_year=message.fiscal_year,
                chunks=para_chunks[:50],
            )
        except Exception as e:
            log.warning("structured_index_failed", error=str(e))
            raise

    async def _save_document_record(
        self,
        message: ProcessedDocumentMessage,
        chunk_count: int,
        log,
    ) -> None:
        try:
            from app.db.postgres import async_session
            from app.db.models import Document
            from sqlalchemy import select

            async with async_session() as session:
                # Upsert — idempotent on document_id
                existing = await session.get(Document, message.document_id)
                if existing is None:
                    from datetime import date as date_type
                    parsed_date = None
                    if message.filing_date:
                        try:
                            parsed_date = date_type.fromisoformat(message.filing_date[:10])
                        except ValueError:
                            pass

                    doc = Document(
                        id=message.document_id,
                        title=message.title or f"{message.ticker} {message.filing_type}",
                        ticker=message.ticker,
                        filing_type=message.filing_type,
                        filing_date=parsed_date,
                        fiscal_year=message.fiscal_year,
                        fiscal_quarter=message.fiscal_quarter,
                        source_url=message.source_url,
                        chunk_count=chunk_count,
                        status="indexed",
                    )
                    session.add(doc)
                else:
                    existing.chunk_count = chunk_count
                    existing.status = "indexed"
                await session.commit()
        except Exception as e:
            log.warning("document_record_save_failed", error=str(e))

    async def teardown(self) -> None:
        logger.info("indexing_worker_teardown")

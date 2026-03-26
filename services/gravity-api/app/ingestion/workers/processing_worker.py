"""
Gravity Search — Processing Worker  (Flink Stage 1–4 equivalent)
Consumes: gravity.raw-documents
Produces: gravity.processed-documents

Pipeline per message:
  Stage 1: DocumentProcessor  → clean text extraction (PDF / HTML / DOCX / TXT)
  Stage 2: MetadataExtractor  → ticker, company, filing type, dates
  Stage 3: SectionDetector    → document structure (MD&A, Risk Factors, Q&A …)
  Stage 4: EntityExtractor    → NER + theme detection (SpaCy + Gemini Flash)
  → publish ProcessedDocumentMessage to gravity.processed-documents

Flink analogy:
  input stream  → DataStream<RawDocumentMessage>
  map operator  → ProcessingFunction (Stage 1–4)
  output stream → DataStream<ProcessedDocumentMessage>
"""

from __future__ import annotations

import structlog

from app.ingestion.topics import (
    ProcessedDocumentMessage,
    RawDocumentMessage,
    SectionInfo,
    Topics,
)
from app.ingestion.kafka_client import publish
from app.ingestion.workers.base import BaseWorker

logger = structlog.get_logger()


class ProcessingWorker(BaseWorker[RawDocumentMessage]):
    """
    Stateless document processing: bytes → clean structured text.
    Multiple instances can run in parallel (same consumer group).
    """

    input_topic = Topics.RAW_DOCUMENTS
    input_schema = RawDocumentMessage
    group_id = "gravity-processing-workers"
    max_concurrency = 4

    # Lazy-loaded processing components
    _doc_processor = None
    _meta_extractor = None
    _section_detector = None
    _entity_extractor = None

    async def setup(self) -> None:
        """Warm up all processing components once at startup."""
        from app.ingestion.processing.document_processor import DocumentProcessor
        from app.ingestion.processing.metadata_extractor import MetadataExtractor
        from app.ingestion.processing.section_detector import SectionDetector
        from app.ingestion.processing.entity_extractor import EntityExtractor

        self._doc_processor = DocumentProcessor()
        self._meta_extractor = MetadataExtractor()
        self._section_detector = SectionDetector()
        self._entity_extractor = EntityExtractor()

        logger.info("processing_worker_ready", components=4)

    async def process(self, message: RawDocumentMessage) -> None:
        """Run the 4-stage processing pipeline for one raw document."""
        log = logger.bind(
            msg_id=message.message_id,
            source=message.source,
            ticker=message.ticker,
            filing_type=message.filing_type,
        )
        log.info("processing_start")

        content_bytes = message.decode_content()

        # ── Stage 1: Text extraction ──────────────────────────────────────
        processed_doc = await self._doc_processor.process(
            content=content_bytes,
            content_type=message.content_type,
            filename=message.filename or "",
        )
        if not processed_doc.text.strip():
            log.warning("processing_empty_text_skip")
            return

        # ── Stage 2: Metadata extraction ──────────────────────────────────
        # Seed from Kafka message fields; extractor fills in any blanks
        meta = await self._meta_extractor.extract(
            text=processed_doc.text[:5000],
            hint_ticker=message.ticker,
            hint_company=message.company_name,
            hint_filing_type=message.filing_type,
            hint_filing_date=message.filing_date,
        )

        # ── Stage 3: Section detection ────────────────────────────────────
        sections_raw = self._section_detector.detect(
            text=processed_doc.text,
            filing_type=meta.filing_type or message.filing_type,
        )
        sections = [
            SectionInfo(name=s.name, text=s.text, page_start=s.page_start)
            for s in sections_raw
        ]

        # ── Stage 4: Entity extraction ────────────────────────────────────
        entities = await self._entity_extractor.extract(
            text=processed_doc.text,
            ticker=meta.ticker or message.ticker,
        )

        # ── Publish to gravity.processed-documents ────────────────────────
        out_msg = ProcessedDocumentMessage(
            raw_message_id=message.message_id,
            source=message.source,
            text=processed_doc.text,
            title=processed_doc.title or message.filename,
            ticker=meta.ticker or message.ticker,
            company_name=meta.company_name or message.company_name,
            filing_type=meta.filing_type or message.filing_type,
            filing_date=meta.filing_date or message.filing_date,
            fiscal_year=meta.fiscal_year,
            fiscal_quarter=meta.fiscal_quarter,
            source_url=message.source_url,
            page_count=processed_doc.page_count,
            sections=sections,
            entities=entities,
            doc_metadata={
                "language": processed_doc.language,
                "original_source": message.source,
            },
        )

        success = await publish(
            topic=Topics.PROCESSED_DOCUMENTS,
            message=out_msg,
            key=out_msg.ticker or out_msg.source,
        )

        log.info(
            "processing_complete",
            text_len=len(out_msg.text),
            sections=len(sections),
            published_to_kafka=success,
        )

    async def teardown(self) -> None:
        logger.info("processing_worker_teardown")

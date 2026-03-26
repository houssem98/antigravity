"""
Gravity Search — Document Producer
Single entry-point for all data sources to publish raw documents to Kafka.

When Kafka is unavailable (dev, unit tests), falls back to synchronous
in-process ingestion via IngestionPipeline — zero config required.

Usage:
    producer = DocumentProducer()

    # From any source:
    await producer.publish_bytes(
        content=pdf_bytes,
        content_type="application/pdf",
        source="sec_edgar",
        ticker="AAPL",
        company_name="Apple Inc",
        filing_type="10-K",
        filing_date="2025-10-30",
        source_url="https://www.sec.gov/...",
    )
"""

from __future__ import annotations

import structlog
from typing import TYPE_CHECKING

from app.ingestion.topics import RawDocumentMessage, Topics
from app.ingestion.kafka_client import publish

if TYPE_CHECKING:
    pass

logger = structlog.get_logger()


class DocumentProducer:
    """
    Publishes raw document bytes to gravity.raw-documents Kafka topic.
    Falls back to direct pipeline ingestion when Kafka is unavailable.
    """

    def __init__(self, fallback_pipeline=None):
        """
        Args:
            fallback_pipeline: Optional IngestionPipeline instance used when
                               Kafka is not available. If None and Kafka is
                               absent, messages are logged and dropped.
        """
        self._pipeline = fallback_pipeline

    async def publish_bytes(
        self,
        content: bytes,
        content_type: str,
        source: str,
        ticker: str = "",
        company_name: str = "",
        filing_type: str = "",
        filing_date: str | None = None,
        source_url: str = "",
        filename: str = "",
    ) -> bool:
        """
        Publish raw document bytes to the ingestion pipeline.

        Returns True if published (Kafka or direct pipeline), False on failure.
        """
        msg = RawDocumentMessage.from_bytes(
            content=content,
            content_type=content_type,
            source=source,
            ticker=ticker,
            company_name=company_name,
            filing_type=filing_type,
            filing_date=filing_date,
            source_url=source_url,
            filename=filename,
        )

        # Try Kafka first
        ok = await publish(
            topic=Topics.RAW_DOCUMENTS,
            message=msg,
            key=source,
        )
        if ok:
            logger.info(
                "producer_published_kafka",
                source=source,
                ticker=ticker,
                filing_type=filing_type,
                msg_id=msg.message_id,
            )
            return True

        # Fallback: direct synchronous ingestion
        if self._pipeline is not None:
            try:
                result = await self._pipeline.ingest_bytes(
                    content=content,
                    content_type=content_type,
                    filename=filename,
                    ticker=ticker,
                    company_name=company_name,
                    filing_type=filing_type,
                    filing_date=filing_date,
                    source_url=source_url,
                )
                logger.info(
                    "producer_published_direct",
                    source=source,
                    ticker=ticker,
                    chunks=getattr(result, "chunk_count", 0),
                )
                return True
            except Exception as e:
                logger.warning("producer_direct_failed", source=source, error=str(e))
                return False

        logger.warning(
            "producer_no_backend_available",
            source=source,
            ticker=ticker,
            msg_id=msg.message_id,
        )
        return False

    async def publish_url(
        self,
        url: str,
        source: str,
        ticker: str = "",
        company_name: str = "",
        filing_type: str = "",
        filing_date: str | None = None,
    ) -> bool:
        """
        Fetch a URL and publish its content. Used by SEC EDGAR, news scrapers, etc.
        The actual HTTP fetch happens here so workers receive bytes, not URLs.
        """
        import httpx
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.get(url, headers={"User-Agent": "GravitySearch/1.0 (gravity@antigravity.ai)"})
                r.raise_for_status()
                content_type = r.headers.get("content-type", "text/html").split(";")[0].strip()
                return await self.publish_bytes(
                    content=r.content,
                    content_type=content_type,
                    source=source,
                    ticker=ticker,
                    company_name=company_name,
                    filing_type=filing_type,
                    filing_date=filing_date,
                    source_url=url,
                    filename=url.split("/")[-1],
                )
        except Exception as e:
            logger.warning("producer_url_fetch_failed", url=url[:100], error=str(e))
            return False


# Module-level singleton
_producer: DocumentProducer | None = None


def get_producer(pipeline=None) -> DocumentProducer:
    global _producer
    if _producer is None:
        _producer = DocumentProducer(fallback_pipeline=pipeline)
    return _producer

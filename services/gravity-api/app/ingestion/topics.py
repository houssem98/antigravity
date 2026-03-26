"""
Gravity Search — Kafka Topic Definitions & Message Schemas
Canonical source of truth for all Kafka topic names and Pydantic message envelopes.

Topics (all prefixed gravity.):
  gravity.raw-documents       ← raw bytes from any source; partitioned by source
  gravity.processed-documents ← text + metadata + sections + entities; partitioned by ticker
  gravity.indexed-documents   ← completion events after indexing; partitioned by ticker
  gravity.dead-letter         ← failed messages for inspection and replay

Partition key convention:
  raw-documents      → source (sec_edgar, earnings, news, …)
  processed-documents → ticker (AAPL, TSM, …); "" for news
  indexed-documents  → ticker
  dead-letter        → original_topic
"""

from __future__ import annotations

import base64
from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


# ── Topic names ───────────────────────────────────────────────────────────

class Topics:
    RAW_DOCUMENTS       = "gravity.raw-documents"
    PROCESSED_DOCUMENTS = "gravity.processed-documents"
    INDEXED_DOCUMENTS   = "gravity.indexed-documents"
    DEAD_LETTER         = "gravity.dead-letter"

    ALL = [RAW_DOCUMENTS, PROCESSED_DOCUMENTS, INDEXED_DOCUMENTS, DEAD_LETTER]


# ── Source literals ───────────────────────────────────────────────────────

SourceType = Literal[
    "sec_edgar",
    "earnings",
    "news",
    "gdelt",
    "refinitiv",
    "polygon",
    "user_upload",
]


# ── Raw document message ──────────────────────────────────────────────────

class RawDocumentMessage(BaseModel):
    """
    Published to gravity.raw-documents by every data source.
    Content bytes are base64-encoded to survive JSON serialisation.
    """
    message_id: str = Field(default_factory=lambda: str(uuid4()))
    source: SourceType
    content_b64: str                      # base64.b64encode(raw_bytes)
    content_type: str                     # "application/pdf" | "text/html" | "text/plain"
    filename: str = ""
    ticker: str = ""
    company_name: str = ""
    filing_type: str = ""                 # "10-K" | "earnings_transcript" | "news" | …
    filing_date: str | None = None        # ISO date string
    source_url: str = ""
    enqueued_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def decode_content(self) -> bytes:
        return base64.b64decode(self.content_b64)

    @classmethod
    def from_bytes(
        cls,
        content: bytes,
        content_type: str,
        source: SourceType,
        **kwargs,
    ) -> "RawDocumentMessage":
        return cls(
            source=source,
            content_b64=base64.b64encode(content).decode(),
            content_type=content_type,
            **kwargs,
        )


# ── Processed document message ────────────────────────────────────────────

class SectionInfo(BaseModel):
    name: str
    text: str
    page_start: int | None = None


class ProcessedDocumentMessage(BaseModel):
    """
    Published to gravity.processed-documents after Stage 1–4 (text + entities + sections).
    Ready for chunking and indexing.
    """
    message_id: str = Field(default_factory=lambda: str(uuid4()))
    raw_message_id: str = ""              # links back to originating RawDocumentMessage
    document_id: str = Field(default_factory=lambda: str(uuid4()))  # PG document id
    source: SourceType
    text: str
    title: str = ""
    ticker: str = ""
    company_name: str = ""
    filing_type: str = ""
    filing_date: str | None = None
    fiscal_year: int | None = None
    fiscal_quarter: str | None = None
    source_url: str = ""
    page_count: int = 0
    sections: list[SectionInfo] = Field(default_factory=list)
    entities: dict = Field(default_factory=dict)   # {companies, people, metrics, themes}
    doc_metadata: dict = Field(default_factory=dict)
    processed_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


# ── Indexed document message ──────────────────────────────────────────────

class IndexedDocumentMessage(BaseModel):
    """
    Published to gravity.indexed-documents after successful indexing.
    Consumed by downstream services that need to know when a document is searchable.
    """
    message_id: str = Field(default_factory=lambda: str(uuid4()))
    processed_message_id: str = ""
    document_id: str
    ticker: str = ""
    filing_type: str = ""
    chunk_count: int = 0
    index_backends: list[str] = Field(default_factory=list)  # ["qdrant", "es", "neo4j", "pg"]
    indexed_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


# ── Dead-letter message ───────────────────────────────────────────────────

class DeadLetterMessage(BaseModel):
    """
    Wraps any failed message with error context for inspection and replay.
    """
    message_id: str = Field(default_factory=lambda: str(uuid4()))
    original_topic: str
    original_message_id: str
    original_payload: str                 # JSON string of original message
    error_type: str
    error_detail: str
    worker: str                           # "processing" | "indexing"
    attempt: int = 1
    failed_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

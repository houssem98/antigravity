"""
Gravity Search — SQLAlchemy ORM Models
Defines all PostgreSQL + TimescaleDB tables.
"""

from datetime import datetime, date
from sqlalchemy import (
    Column, String, Text, Integer, Float, DateTime, Date, Boolean,
    ForeignKey, JSON, Index, UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class Company(Base):
    __tablename__ = "companies"

    id = Column(String(36), primary_key=True)
    name = Column(String(255), nullable=False, index=True)
    ticker = Column(String(10), unique=True, nullable=False, index=True)
    isin = Column(String(12), unique=True)
    sector = Column(String(100))
    industry = Column(String(100))
    country = Column(String(50))
    market_cap = Column(Float)
    exchange = Column(String(20))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Document(Base):
    __tablename__ = "documents"

    id = Column(String(36), primary_key=True)
    company_id = Column(String(36), ForeignKey("companies.id"), index=True)
    title = Column(String(500), nullable=False)
    ticker = Column(String(10), index=True)
    filing_type = Column(String(20), index=True)  # 10-K, 10-Q, 8-K, earnings_transcript, news
    filing_date = Column(Date, index=True)
    fiscal_year = Column(Integer)
    fiscal_quarter = Column(String(5))  # Q1, Q2, Q3, Q4, FY
    source_url = Column(Text)
    raw_text = Column(Text)
    doc_metadata = Column("metadata", JSON, default=dict)
    status = Column(String(20), default="pending")  # pending, processing, indexed, failed
    chunk_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    chunks = relationship("Chunk", back_populates="document", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_doc_ticker_date", "ticker", "filing_date"),
        Index("idx_doc_type_date", "filing_type", "filing_date"),
    )


class Chunk(Base):
    __tablename__ = "chunks"

    id = Column(String(36), primary_key=True)
    document_id = Column(String(36), ForeignKey("documents.id"), nullable=False, index=True)
    text = Column(Text, nullable=False)
    text_with_metadata = Column(Text)  # Text with prepended metadata for embedding
    chunk_level = Column(Integer, nullable=False)  # 1=section, 2=paragraph, 3=sentence
    section_name = Column(String(200))
    page_number = Column(Integer)
    token_count = Column(Integer)
    position = Column(Integer)  # Order within document
    chunk_metadata = Column("metadata", JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)

    document = relationship("Document", back_populates="chunks")

    __table_args__ = (
        Index("idx_chunk_doc_level", "document_id", "chunk_level"),
    )


class FinancialStatement(Base):
    """TimescaleDB hypertable for financial metrics (time-series)."""
    __tablename__ = "financial_statements"

    id = Column(String(36), primary_key=True)
    company_id = Column(String(36), ForeignKey("companies.id"), index=True)
    ticker = Column(String(10), nullable=False, index=True)
    metric_name = Column(String(100), nullable=False)  # revenue, ebitda, net_income, etc.
    value = Column(Float, nullable=False)
    currency = Column(String(3), default="USD")
    fiscal_year = Column(Integer, nullable=False)
    fiscal_quarter = Column(String(5))  # Q1, Q2, Q3, Q4, FY
    filing_date = Column(Date, nullable=False)
    source_document_id = Column(String(36))
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_fin_ticker_metric", "ticker", "metric_name"),
        Index("idx_fin_ticker_date", "ticker", "filing_date"),
    )


class ConsensusEstimate(Base):
    __tablename__ = "consensus_estimates"

    id = Column(String(36), primary_key=True)
    company_id = Column(String(36), ForeignKey("companies.id"))
    ticker = Column(String(10), nullable=False, index=True)
    metric_name = Column(String(100), nullable=False)
    estimate_value = Column(Float)
    actual_value = Column(Float)
    period = Column(String(10))  # FY2025, Q4 2025
    analyst_count = Column(Integer)
    estimate_date = Column(Date)
    source = Column(String(100))  # FactSet, Visible Alpha, etc.
    created_at = Column(DateTime, default=datetime.utcnow)


class PriceData(Base):
    """TimescaleDB hypertable for market data."""
    __tablename__ = "price_data"

    id = Column(String(36), primary_key=True)
    ticker = Column(String(10), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    open = Column(Float)
    high = Column(Float)
    low = Column(Float)
    close = Column(Float)
    volume = Column(Float)
    market_cap = Column(Float)

    __table_args__ = (
        UniqueConstraint("ticker", "date", name="uq_price_ticker_date"),
    )


class Workspace(Base):
    """A saved search result the user wants to revisit."""
    __tablename__ = "workspaces"

    id = Column(String(36), primary_key=True)
    name = Column(String(200), nullable=False)
    user_id = Column(String(36), index=True)
    query = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    search_id = Column(String(36), index=True)  # trace_id of the originating search
    snapshot = Column(JSON, default=dict)        # full search state (citations, sources, etc.)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_workspace_user_date", "user_id", "created_at"),
    )


class SearchLog(Base):
    """Audit trail for every search query."""
    __tablename__ = "search_logs"

    id = Column(String(36), primary_key=True)
    trace_id = Column(String(36), unique=True, index=True)
    query = Column(Text, nullable=False)
    user_id = Column(String(36), index=True)
    intent = Column(String(50))
    complexity = Column(String(20))
    model_used = Column(String(50))
    latency_ms = Column(Float)
    cost_usd = Column(Float)
    passages_retrieved = Column(Integer)
    cache_hit = Column(Boolean, default=False)
    answer_confidence = Column(String(10))
    user_feedback = Column(String(10))  # thumbs_up, thumbs_down, null
    filters = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_log_user_date", "user_id", "created_at"),
    )

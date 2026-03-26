"""
Gravity Search — Knowledge Graph Node/Relationship Type Definitions
Pure Python Pydantic models for type safety. No Neo4j-specific code.
These types flow between the graph indexer, builder, and API routes.
"""

from datetime import date
from typing import Optional
from pydantic import BaseModel


class CompanyNode(BaseModel):
    ticker: str
    name: str
    isin: Optional[str] = None
    cik: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    country: Optional[str] = None
    market_cap: Optional[float] = None
    exchange: Optional[str] = None


class PersonNode(BaseModel):
    id: str  # UUID
    name: str
    title: Optional[str] = None
    company: Optional[str] = None  # Current company ticker
    tenure_start: Optional[date] = None


class FilingNode(BaseModel):
    id: str  # Document UUID
    title: str
    filing_type: str  # 10-K, 10-Q, 8-K, earnings_transcript
    filing_date: Optional[date] = None
    ticker: Optional[str] = None
    fiscal_year: Optional[str] = None
    fiscal_quarter: Optional[str] = None
    source_url: Optional[str] = None


class EventNode(BaseModel):
    id: str
    name: str
    event_type: str  # earnings_call, investor_day, product_launch
    event_date: Optional[date] = None
    ticker: Optional[str] = None


class ThemeNode(BaseModel):
    name: str  # e.g., "tariff risk", "AI investment", "supply chain"
    frequency: int = 1
    sentiment_avg: Optional[float] = None


class FinancialMetricNode(BaseModel):
    id: str  # e.g., "AAPL_revenue_Q4_2025"
    metric: str  # "revenue", "ebitda", "gross_margin"
    value: float
    currency: str = "USD"
    unit: Optional[str] = None  # "M" (millions), "B" (billions), "%"
    period: Optional[str] = None  # "Q4 2025", "FY 2025"
    ticker: Optional[str] = None


class AnalystNode(BaseModel):
    name: str  # "Erik Woodring"
    firm: str  # "Morgan Stanley"
    coverage_universe: list[str] = []  # ["AAPL", "MSFT", "GOOGL"]


class Relationship(BaseModel):
    source_id: str
    source_type: str   # Company, Person, Filing, Theme, Event
    target_id: str
    target_type: str
    relationship_type: str  # FILED, CEO_OF, SUPPLIES_TO, MENTIONED_IN, HOSTED_BY
    properties: dict = {}

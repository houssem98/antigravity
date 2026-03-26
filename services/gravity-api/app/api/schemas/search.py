"""
Gravity Search — API Schemas (Pydantic v2)
Request and response models for the /v1/search endpoint.
"""

from datetime import date, datetime
from pydantic import BaseModel, Field


# ══════════════════════════════════════════════════════════════════════════
# REQUEST SCHEMAS
# ══════════════════════════════════════════════════════════════════════════

class DateRange(BaseModel):
    from_date: date | None = Field(None, alias="from")
    to_date: date | None = Field(None, alias="to")

    model_config = {"populate_by_name": True}


class SearchFilters(BaseModel):
    companies: list[str] = Field(default_factory=list, description="Ticker symbols to filter by")
    date_range: DateRange | None = None
    document_types: list[str] = Field(
        default_factory=list,
        description="e.g., 'earnings_transcript', '10-K', '10-Q', '8-K', 'news', 'broker_report'",
    )
    sections: list[str] = Field(
        default_factory=list,
        description="e.g., 'MD&A', 'Risk Factors', 'prepared_remarks', 'Q&A'",
    )
    sectors: list[str] = Field(default_factory=list, description="GICS sector names")


class SearchOptions(BaseModel):
    max_sources: int = Field(15, ge=1, le=50, description="Maximum source passages to retrieve")
    include_structured_data: bool = Field(True, description="Include financial data tables")
    confidence_threshold: float = Field(0.0, ge=0.0, le=1.0, description="Minimum confidence to return")
    response_format: str = Field("cited_json", description="'cited_json' | 'markdown' | 'plain'")
    stream: bool = Field(True, description="Enable WebSocket streaming")
    reasoning_depth: str = Field("auto", description="'auto' | 'fast' | 'deep' | 'exhaustive'")


class SearchRequest(BaseModel):
    """Main search request body for POST /v1/search."""
    query: str = Field(..., min_length=1, max_length=2000, description="Natural language search query")
    filters: SearchFilters = Field(default_factory=SearchFilters)
    options: SearchOptions = Field(default_factory=SearchOptions)
    conversation_id: str | None = Field(None, description="For follow-up queries in the same thread")

    model_config = {
        "json_schema_extra": {
            "examples": [{
                "query": "What did TSMC say about CapEx in Q4 2025?",
                "filters": {
                    "companies": ["TSM"],
                    "date_range": {"from": "2025-01-01", "to": "2025-12-31"},
                    "document_types": ["earnings_transcript", "10-K"],
                },
                "options": {
                    "max_sources": 15,
                    "include_structured_data": True,
                    "stream": True,
                    "reasoning_depth": "auto",
                },
            }]
        }
    }


# ══════════════════════════════════════════════════════════════════════════
# RESPONSE SCHEMAS
# ══════════════════════════════════════════════════════════════════════════

class Citation(BaseModel):
    id: int
    source: str = Field(..., description="Document title")
    section: str = Field("", description="Section within the document")
    page: int | None = Field(None, description="Page number if available")
    date: str = Field("", description="Document date")
    ticker: str = Field("", description="Company ticker")
    text: str = Field(..., description="Exact source text supporting the claim")
    url: str = Field("", description="Link to the original document")


class SourcePassage(BaseModel):
    id: str
    chunk_id: str
    title: str
    section: str = ""
    text: str
    ticker: str = ""
    date: str = ""
    document_type: str = ""
    source_quality: int = Field(5, ge=1, le=10, description="Authority score: 10=SEC filing, 9=transcript, 7=broker, 5=news")
    relevance_score: float = 0.0
    source_channels: list[str] = Field(default_factory=list)


class StructuredDataPoint(BaseModel):
    metric: str
    value: float | str
    period: str
    currency: str = "USD"
    source: str = ""


class SearchMetadata(BaseModel):
    trace_id: str
    latency_ms: float
    model_used: str
    complexity: str
    estimated_cost_usd: float = 0.0
    retrieval_channels: list[str] = Field(default_factory=list)
    passages_used: int = 0
    cache_hit: bool = False


class Contradiction(BaseModel):
    source_a: str
    source_b: str
    claim: str
    value_a: str
    value_b: str


class SearchResponse(BaseModel):
    """Complete search response (non-streaming)."""
    id: str = Field(..., description="Unique search result ID")
    answer: str = Field(..., description="AI-generated answer with inline [Source N] citations")
    citations: list[Citation] = Field(default_factory=list)
    sources: list[SourcePassage] = Field(default_factory=list)
    structured_data: list[StructuredDataPoint] = Field(default_factory=list)
    contradictions: list[Contradiction] = Field(default_factory=list)
    confidence: str = Field("MEDIUM", description="HIGH | MEDIUM | LOW")
    caveats: list[str] = Field(default_factory=list)
    follow_up_queries: list[str] = Field(default_factory=list)
    metadata: SearchMetadata | None = None

    model_config = {
        "json_schema_extra": {
            "examples": [{
                "id": "search_abc123",
                "answer": "TSMC guided FY2025 CapEx of $32B [1], up 12% YoY...",
                "citations": [{"id": 1, "source": "TSM Q4 2025 Transcript", "section": "Prepared Remarks",
                               "text": "We expect capital expenditure for 2025 to be approximately $32 billion..."}],
                "confidence": "HIGH",
                "follow_up_queries": ["How does TSMC's CapEx compare to Samsung?"],
                "metadata": {"trace_id": "abc-123", "latency_ms": 1240, "model_used": "claude-sonnet-4.5"},
            }]
        }
    }


# ══════════════════════════════════════════════════════════════════════════
# FEEDBACK SCHEMAS
# ══════════════════════════════════════════════════════════════════════════

class FeedbackRequest(BaseModel):
    """User thumbs-up / thumbs-down signal for a completed search."""
    search_id: str = Field(..., description="trace_id of the search to rate")
    rating: str = Field(..., pattern="^(up|down)$", description="'up' or 'down'")
    comment: str | None = Field(None, max_length=1000, description="Optional free-text comment")


class FeedbackResponse(BaseModel):
    success: bool
    search_id: str

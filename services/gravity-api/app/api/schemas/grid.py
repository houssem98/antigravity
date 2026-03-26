"""
Grid API Pydantic Schemas
=========================
Request/response models for the Generative Grid endpoint.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class AnswerTypeSchema(str, Enum):
    TEXT = "text"
    NUMERIC = "numeric"
    BOOLEAN = "boolean"
    DATE = "date"
    LIST = "list"
    NOT_FOUND = "not_found"


class GridQuestionSchema(BaseModel):
    question_id: str = Field(..., description="Unique identifier for this column")
    question: str = Field(..., description="The question to answer for each document")
    answer_type: AnswerTypeSchema = AnswerTypeSchema.TEXT
    unit: str = Field(default="", description="Expected unit (e.g. 'USD millions', '%')")
    time_period: str = Field(default="", description="Time period (e.g. 'FY2023', 'Q3 2024')")
    normalize: bool = Field(default=True, description="Normalize numeric answers to common unit")


class GridDocumentSchema(BaseModel):
    document_id: str
    ticker: str
    company_name: str
    filing_type: str = ""
    filing_date: str = ""
    display_label: str = ""


class GridRequestSchema(BaseModel):
    questions: list[GridQuestionSchema] = Field(..., min_length=1, max_length=20)
    documents: list[GridDocumentSchema] = Field(..., min_length=1, max_length=50)
    max_concurrency: int = Field(default=10, ge=1, le=20)
    confidence_threshold: float = Field(default=0.4, ge=0.0, le=1.0)
    include_excerpts: bool = True
    timeout_per_cell: float = Field(default=8.0, ge=1.0, le=30.0)

    model_config = {
        "json_schema_extra": {
            "example": {
                "questions": [
                    {
                        "question_id": "revenue",
                        "question": "What was total revenue?",
                        "answer_type": "numeric",
                        "unit": "USD billions",
                        "time_period": "FY2023",
                    },
                    {
                        "question_id": "guidance",
                        "question": "What revenue guidance was given for next fiscal year?",
                        "answer_type": "text",
                        "time_period": "FY2023",
                    },
                ],
                "documents": [
                    {
                        "document_id": "aapl_10k_2023",
                        "ticker": "AAPL",
                        "company_name": "Apple Inc",
                        "filing_type": "10-K",
                        "filing_date": "2023-10-30",
                    },
                    {
                        "document_id": "msft_10k_2023",
                        "ticker": "MSFT",
                        "company_name": "Microsoft Corp",
                        "filing_type": "10-K",
                        "filing_date": "2023-07-27",
                    },
                ],
            }
        }
    }


class GridCitationSchema(BaseModel):
    document_id: str
    ticker: str
    page: Optional[int] = None
    section: str = ""
    breadcrumb_path: str = ""
    excerpt: str = ""


class GridCellSchema(BaseModel):
    question_id: str
    document_id: str
    status: str
    answer: Any = None
    answer_type: AnswerTypeSchema = AnswerTypeSchema.TEXT
    confidence: float = 0.0
    citations: list[GridCitationSchema] = []
    raw_text: str = ""
    normalized_value: Any = None
    unit: str = ""
    error: str = ""
    latency_ms: float = 0.0


class GridRowSchema(BaseModel):
    """One row of the grid (one document, all questions answered)."""
    document_id: str
    ticker: str
    display_label: str
    cells: dict[str, GridCellSchema]  # question_id → cell


class GridResponseSchema(BaseModel):
    grid_id: str
    rows: list[GridRowSchema]
    questions: list[GridQuestionSchema]
    total_cells: int
    completed_cells: int
    not_found_cells: int
    error_cells: int
    latency_ms: float

    # Flat table format for CSV/spreadsheet export
    table: list[dict] = []

    model_config = {"json_schema_extra": {"description": "Generative Grid result"}}


class GridStreamEventSchema(BaseModel):
    """WebSocket streaming event for grid progressive rendering."""
    event_type: str  # "cell_complete" | "grid_complete" | "error"
    question_id: Optional[str] = None
    document_id: Optional[str] = None
    cell: Optional[GridCellSchema] = None
    progress: float = 0.0  # 0.0–1.0
    error: Optional[str] = None

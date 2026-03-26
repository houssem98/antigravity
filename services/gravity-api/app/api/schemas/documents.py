"""Document schemas."""
from datetime import datetime
from pydantic import BaseModel, Field

class DocumentMetadata(BaseModel):
    id: str
    title: str
    ticker: str = ""
    filing_type: str = ""
    filing_date: str = ""
    section: str = ""
    source: str = ""

class Chunk(BaseModel):
    id: str
    document_id: str
    text: str
    level: int = Field(2, description="1=section, 2=paragraph, 3=sentence")
    metadata: DocumentMetadata | None = None
    token_count: int = 0

class IngestRequest(BaseModel):
    filename: str
    content_type: str
    workspace_id: str | None = None

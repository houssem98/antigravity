"""Common schemas: pagination, errors, etc."""
from pydantic import BaseModel, Field

class ErrorResponse(BaseModel):
    error: str
    message: str
    trace_id: str = ""

class PaginationParams(BaseModel):
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=100)

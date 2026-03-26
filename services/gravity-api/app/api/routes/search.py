"""
Gravity Search — Search API Routes
POST /v1/search              — primary search (REST + WebSocket streaming)
POST /v1/search/structured   — natural language → SQL on financial_statements
POST /v1/search/batch        — up to 100 queries; async results via polling or webhook
GET  /v1/search/batch/{id}   — poll batch job status
"""

import asyncio
import uuid
from datetime import datetime
from typing import Any

import structlog
from fastapi import APIRouter, BackgroundTasks, HTTPException, WebSocket, WebSocketDisconnect, Depends, Response
from pydantic import BaseModel, Field

from app.api.schemas.search import SearchRequest, SearchResponse
from app.api.middleware.auth import require_auth, _validate_api_key
from app.api.middleware.rate_limit import check_rate_limit

logger = structlog.get_logger()
router = APIRouter()

# In-memory batch job store (replace with Redis in production)
_batch_jobs: dict[str, dict] = {}


@router.post("/search", response_model=SearchResponse)
async def search(
    request: SearchRequest,
    response: Response,
    auth: dict = Depends(require_auth)
):
    """
    Submit a search query. Returns a complete response with cited answer.

    For streaming responses, use the WebSocket endpoint at /v1/search/stream.
    """
    from app.dependencies import get_search_pipeline

    pipeline = get_search_pipeline()
    search_id = f"search_{uuid.uuid4().hex[:12]}"

    # Inject rate limit headers
    headers = await check_rate_limit(auth["user_id"], auth.get("tier", "free"))
    for k, v in headers.items():
        response.headers[k] = v

    # Collect all events from the pipeline (non-streaming mode)
    answer = ""
    sources = []
    citations: list = []
    follow_up_queries: list[str] = []
    structured_data: list = []
    contradictions: list = []
    caveats: list = []
    confidence = "MEDIUM"
    metadata_info: dict = {}

    async for event in pipeline.search(
        query=request.query,
        filters=request.filters.model_dump() if request.filters else None,
        stream=False,
        reasoning_depth=request.options.reasoning_depth,
        conversation_id=request.conversation_id,
    ):
        if event.type == "sources":
            raw = event.data
            sources = raw.get("sources", []) if isinstance(raw, dict) else (raw or [])
        elif event.type == "answer":
            d = event.data if isinstance(event.data, dict) else {}
            answer = d.get("answer", str(event.data) if not isinstance(event.data, dict) else "")
            citations = d.get("citations", [])
            follow_up_queries = d.get("follow_up_queries", [])
            structured_data = d.get("structured_data", [])
            contradictions = d.get("contradictions", [])
            caveats = d.get("caveats", [])
            confidence = d.get("confidence", "MEDIUM")
        elif event.type == "metadata":
            metadata_info = event.data or {}

    from app.api.schemas.search import SearchMetadata
    try:
        meta_model = SearchMetadata(**metadata_info) if metadata_info else None
    except Exception:
        meta_model = None

    return SearchResponse(
        id=search_id,
        answer=answer,
        citations=citations,
        sources=sources,
        structured_data=structured_data,
        contradictions=contradictions,
        caveats=caveats,
        confidence=confidence,
        follow_up_queries=follow_up_queries,
        metadata=meta_model,
    )


@router.websocket("/search/stream")
async def search_stream(websocket: WebSocket):
    """
    WebSocket endpoint for streaming search results.

    Client sends: {"query": "...", "filters": {...}, "options": {...}}
    Server streams: {"type": "status|sources|token|answer|metadata|error", "data": ...}

    Progressive rendering:
      1. status("Analyzing query...")        — instant
      2. status("Searching 500K+ docs...")   — <50ms
      3. sources([...])                      — <130ms (user can start reading)
      4. token("word ")                      — 200ms+ (streaming answer)
      5. answer({complete answer})           — when done
      6. metadata({latency, model, cost})    — final
    """
    await websocket.accept()
    logger.info("websocket_connected")

    try:
        # Require API key before proceeding (WebSocket limitation)
        auth_header = websocket.headers.get("X-API-Key")
        if not auth_header:
            await websocket.close(code=1008, reason="X-API-Key header missing")
            return
            
        auth_context = await _validate_api_key(auth_header)
        if not auth_context and websocket.app.state.settings.app_env.value != "development":
            await websocket.close(code=1008, reason="Invalid API key")
            return
            
        user_id = auth_context["user_id"] if auth_context else "dev_user"
        tier = auth_context.get("tier", "free") if auth_context else "unlimited"

        # Rate check before entering loop
        try:
            await check_rate_limit(user_id, tier)
        except HTTPException as e:
            await websocket.close(code=1008, reason=e.detail)
            return

        while True:
            # Wait for search request from client
            data = await websocket.receive_json()
            request = SearchRequest(**data)

            from app.dependencies import get_search_pipeline
            pipeline = get_search_pipeline()

            # Stream all events to client
            async for event in pipeline.search(
                query=request.query,
                filters=request.filters.model_dump() if request.filters else None,
                stream=True,
                reasoning_depth=request.options.reasoning_depth,
            ):
                await websocket.send_json({
                    "type": event.type,
                    "data": event.data,
                    "trace_id": event.trace_id,
                })

    except WebSocketDisconnect:
        logger.info("websocket_disconnected")
    except Exception as e:
        logger.error("websocket_error", error=str(e))
        try:
            await websocket.send_json({
                "type": "error",
                "data": {"message": "Internal server error"},
            })
        except Exception:
            pass


# ══════════════════════════════════════════════════════════════════════════
# Structured Search — Natural Language → SQL on financial_statements
# ══════════════════════════════════════════════════════════════════════════

class StructuredSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    companies: list[str] = Field(default_factory=list)
    date_range: dict[str, str] | None = None
    metrics: list[str] = Field(default_factory=list)
    limit: int = Field(50, ge=1, le=500)


class StructuredSearchResponse(BaseModel):
    id: str
    query: str
    sql_generated: str
    results: list[dict[str, Any]]
    row_count: int
    description: str
    latency_ms: float


@router.post("/search/structured", response_model=StructuredSearchResponse)
async def search_structured(
    request: StructuredSearchRequest,
    response: Response,
    auth: dict = Depends(require_auth)
):
    """
    Query structured financial data using natural language.
    Gemini Flash translates the query to SQL against financial_statements / TimescaleDB.

    Example: "Show Apple's quarterly revenue for the last 4 quarters"
    """
    import time
    import json
    from app.dependencies import get_llm_router
    from app.core.reasoning.prompts import NL_TO_SQL_SYSTEM
    from app.llm.base import LLMMessage, LLMConfig

    start = time.time()
    search_id = f"structured_{uuid.uuid4().hex[:12]}"

    # Inject rate limit headers
    headers = await check_rate_limit(auth["user_id"], auth.get("tier", "free"))
    for k, v in headers.items():
        response.headers[k] = v

    # Enrich the query with filter context
    context_parts = [request.query]
    if request.companies:
        context_parts.append(f"Filter to companies/tickers: {', '.join(request.companies)}")
    if request.date_range:
        context_parts.append(f"Date range: {request.date_range}")
    if request.metrics:
        context_parts.append(f"Metrics of interest: {', '.join(request.metrics)}")
    context_parts.append(f"Return at most {request.limit} rows.")
    enriched_query = "\n".join(context_parts)

    # Generate SQL via Gemini Flash
    sql = ""
    params: list = []
    description = ""
    try:
        llm_router = get_llm_router()
        fast_client = llm_router.get_fast_client()
        response = await fast_client.generate(
            messages=[
                LLMMessage(role="system", content=NL_TO_SQL_SYSTEM),
                LLMMessage(role="user", content=enriched_query),
            ],
            config=LLMConfig(temperature=0.0, max_tokens=512),
        )
        parsed = json.loads(response.content)
        sql = parsed.get("sql", "")
        params = parsed.get("params", [])
        description = parsed.get("description", "")
    except Exception as e:
        logger.warning("nl_to_sql_failed", error=str(e))
        raise HTTPException(status_code=503, detail=f"SQL generation failed: {e}")

    if not sql:
        raise HTTPException(status_code=422, detail="Could not generate SQL for this query")

    # Execute against PostgreSQL / TimescaleDB
    results: list[dict] = []
    try:
        from app.db.postgres import async_session
        from sqlalchemy import text
        # Convert $1/$2 placeholders → SQLAlchemy :p1/:p2
        safe_sql = sql
        for i, _ in enumerate(params, 1):
            safe_sql = safe_sql.replace(f"${i}", f":p{i}")
        param_dict = {f"p{i}": v for i, v in enumerate(params, 1)}
        async with async_session() as session:
            result = await session.execute(text(safe_sql), param_dict)
            results = [dict(row) for row in result.mappings().all()]
    except Exception as e:
        logger.warning("structured_query_exec_failed", sql=sql, error=str(e))
        raise HTTPException(status_code=503, detail=f"Database query failed: {e}")

    latency_ms = round((time.time() - start) * 1000, 1)
    logger.info("structured_search_done", query=request.query[:60], rows=len(results), latency_ms=latency_ms)

    return StructuredSearchResponse(
        id=search_id,
        query=request.query,
        sql_generated=sql,
        results=results,
        row_count=len(results),
        description=description,
        latency_ms=latency_ms,
    )


# ══════════════════════════════════════════════════════════════════════════
# Batch Search — up to 100 queries, async, webhook delivery
# ══════════════════════════════════════════════════════════════════════════

class BatchSearchRequest(BaseModel):
    queries: list[str] = Field(..., min_length=1, max_length=100)
    filters: dict | None = None
    webhook_url: str | None = Field(None, description="POST completed results here")
    reasoning_depth: str = Field("fast", description="Recommend 'fast' for batch")


class BatchSearchResponse(BaseModel):
    batch_id: str
    status: str
    total_queries: int
    completed: int
    results: list[dict]
    created_at: str
    completed_at: str | None = None


@router.post("/search/batch", response_model=BatchSearchResponse)
async def search_batch(
    request: BatchSearchRequest,
    background_tasks: BackgroundTasks,
    response: Response,
    auth: dict = Depends(require_auth)
):
    """
    Submit up to 100 queries as a background batch job.
    Poll GET /v1/search/batch/{id} for results, or provide a webhook_url
    to receive a POST when all queries complete.
    """
    if len(request.queries) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 queries per batch")

    # Rate limiting for batch
    headers = await check_rate_limit(auth["user_id"], auth.get("tier", "free"))
    for k, v in headers.items():
        response.headers[k] = v

    batch_id = f"batch_{uuid.uuid4().hex[:16]}"
    job: dict = {
        "batch_id": batch_id,
        "status": "queued",
        "total_queries": len(request.queries),
        "completed": 0,
        "results": [],
        "created_at": datetime.utcnow().isoformat(),
        "completed_at": None,
    }
    _batch_jobs[batch_id] = job
    background_tasks.add_task(
        _run_batch_job, batch_id, request.queries,
        request.filters, request.reasoning_depth, request.webhook_url,
    )
    logger.info("batch_queued", batch_id=batch_id, count=len(request.queries))
    return BatchSearchResponse(**job)


@router.get("/search/batch/{batch_id}", response_model=BatchSearchResponse)
async def get_batch_status(
    batch_id: str,
    response: Response,
    auth: dict = Depends(require_auth)
):
    """Poll status and results for a batch search job."""
    job = _batch_jobs.get(batch_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Batch job {batch_id} not found")

    # Rate limiting
    headers = await check_rate_limit(auth["user_id"], auth.get("tier", "free"))
    for k, v in headers.items():
        response.headers[k] = v
    return BatchSearchResponse(**job)


async def _run_batch_job(
    batch_id: str,
    queries: list[str],
    filters: dict | None,
    reasoning_depth: str,
    webhook_url: str | None,
):
    """Background coroutine: runs all queries with max concurrency=5."""
    from app.dependencies import get_search_pipeline

    job = _batch_jobs[batch_id]
    job["status"] = "processing"
    pipeline = get_search_pipeline()
    sem = asyncio.Semaphore(5)

    async def run_one(query: str) -> dict:
        async with sem:
            try:
                answer, sources, meta = "", [], {}
                async for event in pipeline.search(
                    query=query, filters=filters,
                    stream=False, reasoning_depth=reasoning_depth,
                ):
                    if event.type == "answer":
                        answer = event.data.get("answer", "") if isinstance(event.data, dict) else str(event.data)
                    elif event.type == "sources":
                        raw = event.data
                        sources = raw.get("sources", []) if isinstance(raw, dict) else (raw or [])
                    elif event.type == "metadata":
                        meta = event.data or {}
                job["completed"] += 1
                return {
                    "query": query, "answer": answer,
                    "source_count": len(sources),
                    "confidence": meta.get("confidence", "MEDIUM"),
                    "latency_ms": meta.get("latency_ms", 0),
                    "status": "ok",
                }
            except Exception as e:
                job["completed"] += 1
                return {"query": query, "answer": "", "status": "error", "error": str(e)}

    try:
        results = await asyncio.gather(*[run_one(q) for q in queries])
        job["results"] = list(results)
        job["status"] = "complete"
        job["completed_at"] = datetime.utcnow().isoformat()
        logger.info("batch_complete", batch_id=batch_id, count=len(queries))
        if webhook_url:
            await _fire_webhook(webhook_url, job)
    except Exception as e:
        job["status"] = "failed"
        job["completed_at"] = datetime.utcnow().isoformat()
        logger.error("batch_failed", batch_id=batch_id, error=str(e))


async def _fire_webhook(url: str, payload: dict):
    try:
        import httpx
        async with httpx.AsyncClient(timeout=30) as client:
            await client.post(url, json=payload)
        logger.info("webhook_fired", url=url)
    except Exception as e:
        logger.warning("webhook_failed", url=url, error=str(e))

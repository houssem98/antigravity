"""
Grid Search API Routes
======================
POST /v1/grid             — Synchronous grid execution (returns full result)
WebSocket /v1/grid/stream — Streaming grid (cells arrive as they complete)
"""

from __future__ import annotations

import json
import uuid

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.schemas.grid import (
    GridCellSchema,
    GridCitationSchema,
    GridDocumentSchema,
    GridQuestionSchema,
    GridRequestSchema,
    GridResponseSchema,
    GridRowSchema,
    GridStreamEventSchema,
)
from app.core.grid_engine import (
    GridDocument,
    GridQuestion,
    GridRequest,
    AnswerType,
    StreamingGridEngine,
)

logger = structlog.get_logger()
router = APIRouter(prefix="/v1/grid", tags=["grid"])


def _build_engine():
    """Lazy-load the grid engine with the search pipeline."""
    try:
        from app.dependencies import get_search_pipeline
        pipeline = get_search_pipeline()
        return StreamingGridEngine(search_pipeline=pipeline)
    except Exception as e:
        logger.warning("grid_engine_no_pipeline", error=str(e))
        return StreamingGridEngine()


def _schema_to_question(q: GridQuestionSchema) -> GridQuestion:
    return GridQuestion(
        question_id=q.question_id,
        question=q.question,
        answer_type=AnswerType(q.answer_type.value),
        unit=q.unit,
        time_period=q.time_period,
        normalize=q.normalize,
    )


def _schema_to_document(d: GridDocumentSchema) -> GridDocument:
    return GridDocument(
        document_id=d.document_id,
        ticker=d.ticker,
        company_name=d.company_name,
        filing_type=d.filing_type,
        filing_date=d.filing_date,
        display_label=d.display_label,
    )


def _cell_to_schema(cell) -> GridCellSchema:
    return GridCellSchema(
        question_id=cell.question_id,
        document_id=cell.document_id,
        status=cell.status.value,
        answer=cell.answer,
        answer_type=cell.answer_type.value,
        confidence=cell.confidence,
        citations=[
            GridCitationSchema(
                document_id=c.document_id,
                ticker=c.ticker,
                page=c.page,
                section=c.section,
                breadcrumb_path=c.breadcrumb_path,
                excerpt=c.excerpt,
            )
            for c in cell.citations
        ],
        raw_text=cell.raw_text,
        normalized_value=cell.normalized_value,
        unit=cell.unit,
        error=cell.error,
        latency_ms=cell.latency_ms,
    )


@router.post("", response_model=GridResponseSchema)
async def execute_grid(request: GridRequestSchema):
    """
    Execute a Generative Grid: N questions × M documents → structured table.

    All cells are resolved in parallel. Returns when complete.
    For progressive streaming, use the WebSocket endpoint instead.
    """
    grid_id = f"grid_{uuid.uuid4().hex[:12]}"
    engine = _build_engine()

    questions = [_schema_to_question(q) for q in request.questions]
    documents = [_schema_to_document(d) for d in request.documents]

    grid_request = GridRequest(
        questions=questions,
        documents=documents,
        max_concurrency=request.max_concurrency,
        confidence_threshold=request.confidence_threshold,
        include_excerpts=request.include_excerpts,
        timeout_per_cell=request.timeout_per_cell,
    )

    result = await engine.execute(grid_request)

    # Build row-based response
    rows = []
    for doc in result.documents:
        cells = {}
        for q in result.questions:
            cell = result.get_cell(doc.document_id, q.question_id)
            if cell:
                cells[q.question_id] = _cell_to_schema(cell)
        rows.append(GridRowSchema(
            document_id=doc.document_id,
            ticker=doc.ticker,
            display_label=doc.display_label,
            cells=cells,
        ))

    return GridResponseSchema(
        grid_id=grid_id,
        rows=rows,
        questions=request.questions,
        total_cells=result.total_cells,
        completed_cells=result.completed_cells,
        not_found_cells=result.not_found_cells,
        error_cells=result.error_cells,
        latency_ms=result.latency_ms,
        table=result.to_table(),
    )


@router.websocket("/stream")
async def stream_grid(websocket: WebSocket):
    """
    WebSocket endpoint for streaming grid execution.

    Client sends GridRequestSchema JSON.
    Server streams GridStreamEventSchema JSON messages as cells complete.

    Protocol:
      → Client sends: GridRequestSchema JSON
      ← Server sends: {"event_type": "cell_complete", "cell": {...}, "progress": 0.05}
      ← Server sends: {"event_type": "cell_complete", ...}
      ...
      ← Server sends: {"event_type": "grid_complete", "progress": 1.0, ...}
    """
    await websocket.accept()

    try:
        raw = await websocket.receive_text()
        data = json.loads(raw)
        request = GridRequestSchema(**data)
    except Exception as e:
        await websocket.send_json({"event_type": "error", "error": f"Invalid request: {e}"})
        await websocket.close()
        return

    engine = _build_engine()
    questions = [_schema_to_question(q) for q in request.questions]
    documents = [_schema_to_document(d) for d in request.documents]

    grid_request = GridRequest(
        questions=questions,
        documents=documents,
        max_concurrency=request.max_concurrency,
        confidence_threshold=request.confidence_threshold,
        include_excerpts=request.include_excerpts,
        timeout_per_cell=request.timeout_per_cell,
    )

    try:
        async for event in engine.execute_streaming(grid_request):
            if event["type"] == "cell":
                cell = event["cell"]
                msg = GridStreamEventSchema(
                    event_type="cell_complete",
                    question_id=cell.question_id,
                    document_id=cell.document_id,
                    cell=_cell_to_schema(cell),
                    progress=round(event["progress"], 3),
                )
                await websocket.send_json(msg.model_dump())

            elif event["type"] == "result":
                result = event["result"]
                await websocket.send_json({
                    "event_type": "grid_complete",
                    "progress": 1.0,
                    "total_cells": result.total_cells,
                    "completed_cells": result.completed_cells,
                    "not_found_cells": result.not_found_cells,
                    "error_cells": result.error_cells,
                    "latency_ms": result.latency_ms,
                    "table": result.to_table(),
                })

    except WebSocketDisconnect:
        logger.info("grid_ws_disconnected")
    except Exception as e:
        logger.error("grid_ws_error", error=str(e))
        try:
            await websocket.send_json({"event_type": "error", "error": str(e)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass

"""
Gravity Search — User Library (gravity-api native persistence).

Replaces the Supabase-direct persistence for Quick-Answer history. The Supabase
tables (qa_conversations / grid_runs) are bound to `auth.users` via a uuid FK,
which is incompatible with gravity-api's string user ids. This module owns the
data in gravity-api's own Postgres, keyed by the gravity user id (TEXT), and
exposes it through authenticated endpoints — one identity authority, no
cross-system JWT bridge.

Tables are `lib_`-prefixed so they never collide with the legacy Supabase
tables even when DATABASE_URL points at the same Postgres instance.

Every endpoint degrades gracefully when no DB pool is available (Windows dev /
no DATABASE_URL): reads return empty, writes no-op — history just isn't saved,
matching the prior client behaviour.
"""
from __future__ import annotations

import json
from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.api.routes.auth import _current_user
from app.core.security.auth_store import UserRecord
from app.db.postgres import get_db_pool

logger = structlog.get_logger()

router = APIRouter(prefix="/v1/library", tags=["Library"])


# ─── Schema ───────────────────────────────────────────────────────────────────

LIBRARY_DDL = """
CREATE TABLE IF NOT EXISTS lib_qa_conversations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT 'Untitled',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lib_qa_conv_user
    ON lib_qa_conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS lib_qa_turns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES lib_qa_conversations(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL DEFAULT '',
    citations       JSONB NOT NULL DEFAULT '[]',
    sources         JSONB NOT NULL DEFAULT '[]',
    structured_data JSONB NOT NULL DEFAULT '[]',
    chart_specs     JSONB NOT NULL DEFAULT '[]',
    follow_up       JSONB NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lib_qa_turns_conv
    ON lib_qa_turns (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS lib_reports (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          TEXT NOT NULL,
    query            TEXT NOT NULL DEFAULT '',
    title            TEXT NOT NULL DEFAULT '',
    summary          TEXT NOT NULL DEFAULT '',
    markdown         TEXT NOT NULL DEFAULT '',
    citations        JSONB NOT NULL DEFAULT '[]',
    sources_analyzed INTEGER NOT NULL DEFAULT 0,
    read_time        INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lib_reports_user
    ON lib_reports (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lib_grid_runs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      TEXT NOT NULL,
    name         TEXT NOT NULL DEFAULT '',
    def          JSONB NOT NULL DEFAULT '{}',
    cells        JSONB NOT NULL DEFAULT '{}',
    started_at   TEXT,
    completed_at TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lib_grid_runs_user
    ON lib_grid_runs (user_id, created_at DESC);
"""


async def ensure_library_schema(pool) -> None:
    """Create the library tables once at startup. No-op without a pool."""
    if pool is None:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(LIBRARY_DDL)
        logger.info("library_schema_ready")
    except Exception as e:  # pragma: no cover — startup best effort
        logger.warning("library_schema_failed", error=str(e))


# ─── Schemas ──────────────────────────────────────────────────────────────────

class ConversationMeta(BaseModel):
    id: str
    title: str
    created_at: str


class CreateConversationRequest(BaseModel):
    title: str = Field("Untitled", max_length=200)


class CreateConversationResponse(BaseModel):
    id: Optional[str] = None


class TurnRecord(BaseModel):
    role: str
    content: str = ""
    citations: list = Field(default_factory=list)
    sources: list = Field(default_factory=list)
    structuredData: list = Field(default_factory=list)
    chartSpecs: list = Field(default_factory=list)
    followUpQueries: list = Field(default_factory=list)


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _owns_conversation(conn, conversation_id: str, user_id: str) -> bool:
    owner = await conn.fetchval(
        "SELECT user_id FROM lib_qa_conversations WHERE id = $1", conversation_id
    )
    return owner == user_id


# ─── QA conversations ─────────────────────────────────────────────────────────

@router.get("/qa/conversations", response_model=list[ConversationMeta])
async def list_conversations(user: UserRecord = Depends(_current_user)):
    pool = get_db_pool()
    if pool is None:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, title, created_at FROM lib_qa_conversations "
            "WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100",
            user.user_id,
        )
    return [
        ConversationMeta(
            id=str(r["id"]), title=r["title"], created_at=r["created_at"].isoformat()
        )
        for r in rows
    ]


@router.post("/qa/conversations", response_model=CreateConversationResponse)
async def create_conversation(
    req: CreateConversationRequest, user: UserRecord = Depends(_current_user)
):
    pool = get_db_pool()
    if pool is None:
        return CreateConversationResponse(id=None)
    async with pool.acquire() as conn:
        new_id = await conn.fetchval(
            "INSERT INTO lib_qa_conversations (user_id, title) VALUES ($1, $2) RETURNING id",
            user.user_id, req.title or "Untitled",
        )
    return CreateConversationResponse(id=str(new_id))


@router.get("/qa/conversations/{conversation_id}/turns", response_model=list[TurnRecord])
async def load_turns(
    conversation_id: str, user: UserRecord = Depends(_current_user)
):
    pool = get_db_pool()
    if pool is None:
        return []
    async with pool.acquire() as conn:
        if not await _owns_conversation(conn, conversation_id, user.user_id):
            raise HTTPException(status_code=404, detail="conversation not found")
        rows = await conn.fetch(
            "SELECT role, content, citations, sources, structured_data, chart_specs, "
            "follow_up FROM lib_qa_turns WHERE conversation_id = $1 ORDER BY created_at ASC",
            conversation_id,
        )
    return [
        TurnRecord(
            role=r["role"],
            content=r["content"],
            citations=json.loads(r["citations"]),
            sources=json.loads(r["sources"]),
            structuredData=json.loads(r["structured_data"]),
            chartSpecs=json.loads(r["chart_specs"]),
            followUpQueries=json.loads(r["follow_up"]),
        )
        for r in rows
    ]


@router.post("/qa/conversations/{conversation_id}/turns", status_code=204)
async def save_turn(
    conversation_id: str, turn: TurnRecord, user: UserRecord = Depends(_current_user)
):
    pool = get_db_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        if not await _owns_conversation(conn, conversation_id, user.user_id):
            raise HTTPException(status_code=404, detail="conversation not found")
        await conn.execute(
            "INSERT INTO lib_qa_turns "
            "(conversation_id, user_id, role, content, citations, sources, "
            " structured_data, chart_specs, follow_up) "
            "VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb)",
            conversation_id, user.user_id, turn.role, turn.content,
            json.dumps(turn.citations), json.dumps(turn.sources),
            json.dumps(turn.structuredData), json.dumps(turn.chartSpecs),
            json.dumps(turn.followUpQueries),
        )
        await conn.execute(
            "UPDATE lib_qa_conversations SET updated_at = now() WHERE id = $1",
            conversation_id,
        )


@router.delete("/qa/conversations/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: str, user: UserRecord = Depends(_current_user)
):
    pool = get_db_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        # Scope the delete to the owner so a guessed id can't wipe another user's data.
        await conn.execute(
            "DELETE FROM lib_qa_conversations WHERE id = $1 AND user_id = $2",
            conversation_id, user.user_id,
        )


# ─── Research reports (Deep Research) ─────────────────────────────────────────

class ReportMeta(BaseModel):
    id: str
    query: str
    title: str
    summary: str = ""
    sources_analyzed: int = 0
    read_time: int = 0
    created_at: str


class Report(ReportMeta):
    markdown: str = ""
    citations: list = Field(default_factory=list)


class SaveReportRequest(BaseModel):
    query: str = ""
    title: str = ""
    summary: str = ""
    markdown: str = ""
    citations: list = Field(default_factory=list)
    sources_analyzed: int = 0
    read_time: int = 0


class SaveReportResponse(BaseModel):
    id: Optional[str] = None


@router.get("/reports", response_model=list[ReportMeta])
async def list_reports(user: UserRecord = Depends(_current_user)):
    pool = get_db_pool()
    if pool is None:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, query, title, summary, sources_analyzed, read_time, created_at "
            "FROM lib_reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200",
            user.user_id,
        )
    return [
        ReportMeta(
            id=str(r["id"]), query=r["query"], title=r["title"], summary=r["summary"],
            sources_analyzed=r["sources_analyzed"], read_time=r["read_time"],
            created_at=r["created_at"].isoformat(),
        )
        for r in rows
    ]


@router.post("/reports", response_model=SaveReportResponse)
async def save_report(req: SaveReportRequest, user: UserRecord = Depends(_current_user)):
    pool = get_db_pool()
    if pool is None:
        return SaveReportResponse(id=None)
    async with pool.acquire() as conn:
        new_id = await conn.fetchval(
            "INSERT INTO lib_reports "
            "(user_id, query, title, summary, markdown, citations, sources_analyzed, read_time) "
            "VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING id",
            user.user_id, req.query, req.title, req.summary, req.markdown,
            json.dumps(req.citations), req.sources_analyzed, req.read_time,
        )
    return SaveReportResponse(id=str(new_id))


@router.get("/reports/{report_id}", response_model=Report)
async def get_report(report_id: str, user: UserRecord = Depends(_current_user)):
    pool = get_db_pool()
    if pool is None:
        raise HTTPException(status_code=404, detail="report not found")
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            "SELECT id, query, title, summary, markdown, citations, sources_analyzed, "
            "read_time, created_at FROM lib_reports WHERE id = $1 AND user_id = $2",
            report_id, user.user_id,
        )
    if r is None:
        raise HTTPException(status_code=404, detail="report not found")
    return Report(
        id=str(r["id"]), query=r["query"], title=r["title"], summary=r["summary"],
        markdown=r["markdown"], citations=json.loads(r["citations"]),
        sources_analyzed=r["sources_analyzed"], read_time=r["read_time"],
        created_at=r["created_at"].isoformat(),
    )


@router.delete("/reports/{report_id}", status_code=204)
async def delete_report(report_id: str, user: UserRecord = Depends(_current_user)):
    pool = get_db_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM lib_reports WHERE id = $1 AND user_id = $2",
            report_id, user.user_id,
        )


# ─── Research grid runs ───────────────────────────────────────────────────────
# `def` is a Python keyword, so the request model aliases it; grid responses are
# plain dicts to preserve the `def` key the frontend expects.

class SaveGridRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str = ""
    def_: dict = Field(default_factory=dict, alias="def")
    cells: dict = Field(default_factory=dict)
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class SaveGridResponse(BaseModel):
    id: Optional[str] = None


def _grid_row_to_dict(r) -> dict:
    return {
        "id": str(r["id"]),
        "name": r["name"],
        "def": json.loads(r["def"]),
        "cells": json.loads(r["cells"]),
        "started_at": r["started_at"],
        "completed_at": r["completed_at"],
        "created_at": r["created_at"].isoformat(),
    }


@router.get("/grids")
async def list_grids(limit: int = 20, user: UserRecord = Depends(_current_user)):
    pool = get_db_pool()
    if pool is None:
        return []
    limit = max(1, min(limit, 100))
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, name, def, cells, started_at, completed_at, created_at "
            "FROM lib_grid_runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
            user.user_id, limit,
        )
    return [_grid_row_to_dict(r) for r in rows]


@router.post("/grids", response_model=SaveGridResponse)
async def save_grid(req: SaveGridRequest, user: UserRecord = Depends(_current_user)):
    pool = get_db_pool()
    if pool is None:
        return SaveGridResponse(id=None)
    async with pool.acquire() as conn:
        new_id = await conn.fetchval(
            "INSERT INTO lib_grid_runs (user_id, name, def, cells, started_at, completed_at) "
            "VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6) RETURNING id",
            user.user_id, req.name, json.dumps(req.def_), json.dumps(req.cells),
            req.started_at, req.completed_at,
        )
    return SaveGridResponse(id=str(new_id))


@router.get("/grids/latest")
async def latest_grid(user: UserRecord = Depends(_current_user)):
    pool = get_db_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            "SELECT id, name, def, cells, started_at, completed_at, created_at "
            "FROM lib_grid_runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
            user.user_id,
        )
    return _grid_row_to_dict(r) if r is not None else None


@router.get("/grids/{grid_id}")
async def get_grid(grid_id: str, user: UserRecord = Depends(_current_user)):
    pool = get_db_pool()
    if pool is None:
        raise HTTPException(status_code=404, detail="grid not found")
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            "SELECT id, name, def, cells, started_at, completed_at, created_at "
            "FROM lib_grid_runs WHERE id = $1 AND user_id = $2",
            grid_id, user.user_id,
        )
    if r is None:
        raise HTTPException(status_code=404, detail="grid not found")
    return _grid_row_to_dict(r)


@router.delete("/grids/{grid_id}", status_code=204)
async def delete_grid(grid_id: str, user: UserRecord = Depends(_current_user)):
    pool = get_db_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM lib_grid_runs WHERE id = $1 AND user_id = $2",
            grid_id, user.user_id,
        )

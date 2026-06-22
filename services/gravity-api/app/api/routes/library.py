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
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

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

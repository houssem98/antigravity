"""
Gravity Search — Workspace Routes
Save and retrieve named search snapshots for later review.
"""

import uuid
import structlog
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Any

logger = structlog.get_logger()
router = APIRouter()


async def get_db():
    from app.db.postgres import async_session
    async with async_session() as session:
        yield session


# ── Schemas ──────────────────────────────────────────────────────────────

class WorkspaceSaveRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="User-chosen name for this workspace")
    query: str = Field(..., description="The search query")
    answer: str = Field(..., description="The AI-generated answer")
    search_id: str = Field(..., description="trace_id of the originating search")
    snapshot: dict = Field(default_factory=dict, description="Full search state (citations, sources, etc.)")
    user_id: str | None = Field(None, description="Caller's user identifier (optional)")


class WorkspaceItem(BaseModel):
    id: str
    name: str
    query: str
    answer: str
    search_id: str
    created_at: str


class WorkspaceDetail(WorkspaceItem):
    snapshot: dict


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.post("/workspaces", response_model=WorkspaceItem, status_code=201)
async def save_workspace(
    body: WorkspaceSaveRequest,
    db: Any = Depends(get_db),
) -> WorkspaceItem:
    """Save a search result as a named workspace."""
    from app.db.models import Workspace

    workspace_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    workspace = Workspace(
        id=workspace_id,
        name=body.name,
        user_id=body.user_id,
        query=body.query,
        answer=body.answer,
        search_id=body.search_id,
        snapshot=body.snapshot,
        created_at=now,
        updated_at=now,
    )
    db.add(workspace)
    await db.commit()

    logger.info("workspace_saved", id=workspace_id, name=body.name, search_id=body.search_id)
    return WorkspaceItem(
        id=workspace_id,
        name=body.name,
        query=body.query,
        answer=body.answer,
        search_id=body.search_id,
        created_at=now.isoformat(),
    )


@router.get("/workspaces", response_model=list[WorkspaceItem])
async def list_workspaces(
    user_id: str | None = None,
    limit: int = 20,
    db: Any = Depends(get_db),
) -> list[WorkspaceItem]:
    """List saved workspaces, optionally filtered by user_id."""
    from sqlalchemy import select
    from app.db.models import Workspace

    try:
        q = select(Workspace).order_by(Workspace.created_at.desc()).limit(limit)
        if user_id:
            q = q.where(Workspace.user_id == user_id)

        result = await db.execute(q)
        rows = result.scalars().all()

        return [
            WorkspaceItem(
                id=r.id,
                name=r.name,
                query=r.query,
                answer=r.answer,
                search_id=r.search_id or "",
                created_at=r.created_at.isoformat() if r.created_at else "",
            )
            for r in rows
        ]
    except Exception as e:
        logger.warning("list_workspaces_failed", error=str(e))
        return []


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceDetail)
async def get_workspace(
    workspace_id: str,
    db: Any = Depends(get_db),
) -> WorkspaceDetail:
    """Retrieve a single workspace with its full snapshot."""
    from sqlalchemy import select
    from app.db.models import Workspace

    result = await db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    )
    row = result.scalar_one_or_none()

    if row is None:
        raise HTTPException(status_code=404, detail=f"Workspace '{workspace_id}' not found")

    return WorkspaceDetail(
        id=row.id,
        name=row.name,
        query=row.query,
        answer=row.answer,
        search_id=row.search_id or "",
        created_at=row.created_at.isoformat() if row.created_at else "",
        snapshot=row.snapshot or {},
    )


@router.delete("/workspaces/{workspace_id}", status_code=204)
async def delete_workspace(
    workspace_id: str,
    db: Any = Depends(get_db),
) -> None:
    """Delete a saved workspace."""
    from sqlalchemy import delete
    from app.db.models import Workspace

    result = await db.execute(
        delete(Workspace).where(Workspace.id == workspace_id).returning(Workspace.id)
    )
    row = result.fetchone()
    await db.commit()

    if row is None:
        raise HTTPException(status_code=404, detail=f"Workspace '{workspace_id}' not found")

    logger.info("workspace_deleted", id=workspace_id)

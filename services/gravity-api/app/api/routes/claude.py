"""
Gravity Search — Claude Managed Agent Routes

Exposes API endpoints to execute Claude Managed Agents.
These endpoints are consumed by the market-server.
"""

from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel

import structlog

from app.llm.managed_agent_client import get_managed_agent_client

logger = structlog.get_logger()
router = APIRouter(prefix="/claude", tags=["claude"])


class ClaudeResearchRequest(BaseModel):
    agent_slug: str
    query: str


@router.post("/research")
async def run_claude_research(req: ClaudeResearchRequest):
    """
    Run a headless research workflow via Claude's Managed Agents API.
    Used by market-server's claudeResearchService.ts.
    """
    client = get_managed_agent_client()
    try:
        # In a real app we'd stream this via SSE, but for simplicity
        # we'll await the full response here. The underlying client supports
        # an on_progress callback if we wanted to stream.
        result = await client.run_agent(
            agent_slug=req.agent_slug,
            input_text=req.query,
        )
        return {
            "status": "success",
            "session_id": result["session_id"],
            "report": result["result"],
        }
    except Exception as e:
        logger.error("claude_research_route_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/agents")
async def list_claude_agents():
    """List configured managed agents."""
    client = get_managed_agent_client()
    configured = {slug: bool(id_str) for slug, id_str in client.agent_ids.items()}
    return {
        "agents": configured
    }

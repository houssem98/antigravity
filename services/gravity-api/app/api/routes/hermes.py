"""
Gravity Search — Hermes Agent Routes

Exposes API endpoints to execute the NousResearch Hermes Agent.
These endpoints are consumed by the market-server.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import structlog

from app.llm.hermes_client import get_hermes_client

logger = structlog.get_logger()
router = APIRouter(prefix="/hermes", tags=["hermes"])


class HermesResearchRequest(BaseModel):
    query: str


@router.post("/research")
async def run_hermes_research(req: HermesResearchRequest):
    """
    Run a research workflow using the Hermes-3 Agent framework.
    Used by market-server's hermesResearchService.ts.
    """
    client = get_hermes_client()
    try:
        result = await client.run_agent(query=req.query)
        return {
            "status": "success",
            "session_id": result["session_id"],
            "report": result["result"],
        }
    except Exception as e:
        logger.error("hermes_research_route_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

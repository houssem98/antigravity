"""Trading Markets Hermes Integration - Ask questions about market data."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json

router = APIRouter(prefix="/trading/markets", tags=["trading"])


class AskRequest(BaseModel):
    """Request to ask Hermes about market data."""
    asset: str
    question: str
    context: dict = {}


async def stream_hermes_response(query: str, context: dict):
    """Stream responses from Hermes (placeholder - Phase 1 depends on core Hermes Phase 1)."""

    # Phase 1T: Until core Hermes Phase 1 (LLM router) is ready,
    # return mock response with streaming format

    mock_response = f"""Based on the {context.get('asset', 'asset')} market data:

The current market structure shows:
- Multiple exchanges trading {context.get('asset', 'asset')} with varying volumes
- Order book depth indicating liquidity levels
- Volume concentration on major CEX platforms

To provide more detailed analysis, I need access to the Hermes agent system which is currently in Phase 0 (safety net) in the main search pipeline.

Ask a question to engage with market analysis once Hermes integration is complete."""

    # Stream mock response token-by-token
    tokens = mock_response.split()
    for token in tokens:
        yield json.dumps({"token": token + " "}) + "\n"

    # Final message with citations (Phase 2+)
    yield json.dumps({
        "token": "",
        "citations": [
            "Markets Tab - Current Assets Data",
            "Exchange Volume Rankings"
        ],
        "done": True
    }) + "\n"


@router.post("/ask")
async def ask_about_market(request: AskRequest):
    """
    Ask Hermes about market data.

    Streams token-by-token response via Server-Sent Events.

    Phase 1T implementation:
    - User query input
    - Market context preparation
    - Streaming response (mock until Phase 1 core ready)
    - Citation tracking

    Depends on: Core Hermes Phase 1 (LLM router integration)
    """

    if not request.asset or not request.question:
        raise HTTPException(status_code=400, detail="asset and question required")

    try:
        # Build context for Hermes
        hermes_context = {
            "asset": request.asset,
            "exchanges": request.context.get("exchanges", []),
            "asset_info": request.context.get("asset_info", {}),
            "user_question": request.question,
        }

        # Return streaming response
        return StreamingResponse(
            stream_hermes_response(request.question, hermes_context),
            media_type="application/x-ndjson"
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Hermes query failed: {str(e)}"
        )

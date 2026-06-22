"""Trading Markets & Hermes Integration - Live market data + AI analysis."""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json

from app.services.markets.exchange_data_service import ExchangeDataService
from app.services.markets.caching_layer import MarketDataCache

router = APIRouter(prefix="/trading/markets", tags=["trading"])
market_service = ExchangeDataService()


class AskRequest(BaseModel):
    """Request to ask Hermes about market data."""
    asset: str
    question: str
    context: dict = {}


@router.get("/data")
async def get_market_data(
    asset: str = Query("BTC", description="Asset symbol (BTC, ETH, SOL)"),
    limit: int = Query(50, ge=1, le=250),
    sort: str = Query("volume_24h", description="Sort by: volume_24h, price, liquidity"),
    order: str = Query("desc", description="Order: asc or desc"),
):
    """
    Get live market data for an asset.

    Phase 1: Real data from CoinGecko + Binance API
    - Caching: 60s TTL via Redis
    - Fallback: return cached data on error
    - Always return something (never blank)
    """

    try:
        # Check cache first
        cached = await MarketDataCache.get(asset)
        if cached:
            return cached

        # Fetch live data
        data = await market_service.get_markets(asset, limit, sort, order)

        # Cache for 60s
        await MarketDataCache.set(asset, data, ttl=60)

        return data

    except Exception as e:
        # Fallback: return cached or empty
        cached = await MarketDataCache.get(asset)
        if cached:
            return cached

        return {
            "asset": asset.upper(),
            "exchanges": [],
            "metadata": {
                "source": "error",
                "health": "error",
                "error": str(e),
            },
        }


async def stream_hermes_response(context: dict):
    """Stream responses from Hermes (placeholder - Phase 1T depends on core Phase 1)."""

    mock_response = f"""Based on the {context.get('asset', 'asset')} market data:

The current market structure shows:
- Multiple exchanges trading {context.get('asset', 'asset')} with varying volumes
- Order book depth indicating liquidity levels
- Volume concentration on major CEX platforms

To provide more detailed analysis, I need access to the Hermes agent system which is currently in Phase 0 (safety net).

Ask a question to engage with market analysis once Hermes Phase 1 (LLM router) is ready."""

    tokens = mock_response.split()
    for token in tokens:
        yield json.dumps({"token": token + " "}) + "\n"

    yield json.dumps({
        "token": "",
        "citations": [
            "Markets Tab - Live Exchange Data",
            "Volume Rankings"
        ],
        "done": True
    }) + "\n"


@router.post("/ask")
async def ask_about_market(request: AskRequest):
    """
    Ask Hermes about market data.

    Phase 1T: Ask Hermes feature (sidepanel)
    Depends on: Core Hermes Phase 1 (LLM router integration)
    """

    if not request.asset or not request.question:
        raise HTTPException(status_code=400, detail="asset and question required")

    try:
        # Fetch live market context
        market_context = await get_market_data(asset=request.asset)

        hermes_context = {
            "asset": request.asset,
            "exchanges": market_context.get("exchanges", []),
            "metadata": market_context.get("metadata", {}),
            "user_question": request.question,
        }

        return StreamingResponse(
            stream_hermes_response(hermes_context),
            media_type="application/x-ndjson"
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Hermes query failed: {str(e)}"
        )

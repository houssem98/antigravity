"""
Time-series forecasting endpoint — Kronos foundation model.

POST /v1/forecast
    Request: {bars: [{ts, open, high, low, close, volume, amount}, ...], pred_len: 24, ...}
    Response: {forecast: [{ts, open, high, low, close, volume, amount}, ...], model: "kronos-small"}
"""

import logging
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.forecasting import get_kronos_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/forecast", tags=["forecast"])


class Bar(BaseModel):
    ts: str = Field(..., description="ISO timestamp")
    open: float
    high: float
    low: float
    close: float
    volume: float
    amount: float = 0.0


class ForecastRequest(BaseModel):
    bars: list[Bar] = Field(..., min_length=10, description="Historical OHLCV bars (>=10)")
    pred_len: int = Field(24, ge=1, le=512, description="Number of future bars")
    interval: str = Field("1h", description="Bar interval (1m, 5m, 1h, 1d, etc.)")
    temperature: float = Field(1.0, ge=0.1, le=2.0)
    top_p: float = Field(0.9, ge=0.1, le=1.0)
    sample_count: int = Field(1, ge=1, le=5)
    model: str = Field("small", pattern="^(mini|small|base|large)$")


class ForecastBar(BaseModel):
    ts: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    amount: float


class ForecastResponse(BaseModel):
    forecast: list[ForecastBar]
    model: str
    pred_len: int


_MODEL_MAP = {
    "mini": "NeoQuasar/Kronos-mini",
    "small": "NeoQuasar/Kronos-small",
    "base": "NeoQuasar/Kronos-base",
    "large": "NeoQuasar/Kronos-large",
}


@router.post("", response_model=ForecastResponse)
async def forecast(req: ForecastRequest) -> ForecastResponse:
    """Generate OHLCV forecast from historical bars using Kronos."""
    try:
        # Build historical DataFrame
        x_df = pd.DataFrame([
            {"open": b.open, "high": b.high, "low": b.low,
             "close": b.close, "volume": b.volume, "amount": b.amount}
            for b in req.bars
        ])
        x_ts = pd.to_datetime([b.ts for b in req.bars])

        # Generate future timestamps based on interval
        last_ts = x_ts[-1]
        freq = _interval_to_freq(req.interval)
        y_ts = pd.date_range(start=last_ts + pd.Timedelta(freq), periods=req.pred_len, freq=freq)

        service = get_kronos_service(model_id=_MODEL_MAP[req.model])
        pred_df = await service.predict(
            ohlcv_df=x_df,
            x_timestamps=pd.Series(x_ts),
            y_timestamps=pd.Series(y_ts),
            pred_len=req.pred_len,
            temperature=req.temperature,
            top_p=req.top_p,
            sample_count=req.sample_count,
        )

        forecast_bars = [
            ForecastBar(
                ts=ts.isoformat(),
                open=float(row["open"]),
                high=float(row["high"]),
                low=float(row["low"]),
                close=float(row["close"]),
                volume=float(row["volume"]),
                amount=float(row.get("amount", 0.0)),
            )
            for ts, (_, row) in zip(y_ts, pred_df.iterrows())
        ]

        return ForecastResponse(
            forecast=forecast_bars,
            model=f"kronos-{req.model}",
            pred_len=req.pred_len,
        )

    except Exception as e:
        logger.exception("forecast_failed")
        raise HTTPException(status_code=500, detail=f"Forecast failed: {e}")


@router.get("/health")
async def forecast_health():
    """Check if Kronos model is loaded."""
    service = get_kronos_service()
    return {"loaded": service.is_loaded(), "model": service.model_id}


def _interval_to_freq(interval: str) -> str:
    """Convert interval string to pandas frequency."""
    mapping = {
        "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min",
        "1h": "1h", "4h": "4h", "1d": "1D", "1w": "1W",
    }
    return mapping.get(interval, "1h")

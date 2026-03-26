"""
Analytics API Routes
====================
GET  /v1/analytics/sentiment/{ticker}        — Sentiment for a document/period
GET  /v1/analytics/sentiment/{ticker}/delta  — Delta between two periods
POST /v1/analytics/sentiment/batch           — Score multiple documents
GET  /v1/analytics/longitudinal/{ticker}     — Multi-period metric tracking
POST /v1/analytics/longitudinal/compare      — Period-to-period comparison
GET  /v1/analytics/longitudinal/{ticker}/guidance — Guidance vs actuals
"""

from __future__ import annotations

from typing import Optional

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

logger = structlog.get_logger()
router = APIRouter(prefix="/v1/analytics", tags=["analytics"])


# ── Request / Response Schemas ─────────────────────────────────────────────────

class SentimentScoreRequest(BaseModel):
    document_id: str
    ticker: str
    period: str                  # e.g. "Q3 2024"
    document_type: str = "earnings_transcript"
    text: str


class SentimentBatchRequest(BaseModel):
    documents: list[SentimentScoreRequest] = Field(..., max_length=20)


class LongitudinalRequest(BaseModel):
    ticker: str
    company_name: str = ""
    metrics: list[str] = Field(
        default=["revenue", "gross_margin", "operating_margin", "free_cash_flow"],
        max_length=10,
    )
    periods: list[str] = Field(..., max_length=20, description="e.g. ['Q1 2023', 'Q2 2023', ...]")
    generate_narrative: bool = True


class PeriodCompareRequest(BaseModel):
    ticker: str
    metric_name: str
    periods: list[str] = Field(..., min_length=2, max_length=20)
    period_a: str
    period_b: str


# ── Dependency helpers ─────────────────────────────────────────────────────────

def _get_sentiment_engine():
    try:
        from app.db.redis import redis_client
        from app.core.analytics.sentiment_engine import SentimentEngine
        return SentimentEngine(redis_client=redis_client)
    except Exception as e:
        logger.warning("sentiment_engine_unavailable", error=str(e))
        from app.core.analytics.sentiment_engine import SentimentEngine
        return SentimentEngine()


def _get_longitudinal_tracker():
    try:
        from app.db.redis import redis_client
        from app.core.analytics.longitudinal_tracker import LongitudinalTracker

        # Try to get ratio engine too
        ratio_engine = None
        try:
            from app.dependencies import get_search_pipeline
            pipeline = get_search_pipeline()
            ratio_engine = getattr(pipeline, 'ratio_engine', None)
        except Exception:
            pass

        # Try to get db pool
        db_pool = None
        try:
            from app.db.postgres import get_db_pool
            db_pool = get_db_pool()
        except Exception:
            pass

        return LongitudinalTracker(
            db_pool=db_pool,
            redis_client=redis_client,
            ratio_engine=ratio_engine,
        )
    except Exception as e:
        logger.warning("longitudinal_tracker_unavailable", error=str(e))
        from app.core.analytics.longitudinal_tracker import LongitudinalTracker
        return LongitudinalTracker()


# ── Sentiment Routes ──────────────────────────────────────────────────────────

@router.post("/sentiment/score")
async def score_sentiment(request: SentimentScoreRequest):
    """Score sentiment for a single document."""
    engine = _get_sentiment_engine()
    result = await engine.score_document(
        document_id=request.document_id,
        ticker=request.ticker,
        period=request.period,
        document_type=request.document_type,
        text=request.text,
    )
    return {
        "document_id": result.document_id,
        "ticker": result.ticker,
        "period": result.period,
        "overall_score": result.overall_score,
        "overall_label": result.overall_label,
        "magnitude": result.magnitude,
        "ceo_score": result.ceo_score,
        "cfo_score": result.cfo_score,
        "topic_scores": result.topic_scores,
        "prepared_remarks_score": result.prepared_remarks_score,
        "qa_session_score": result.qa_session_score,
        "key_positive_quotes": result.key_positive_quotes,
        "key_negative_quotes": result.key_negative_quotes,
        "forward_looking_score": result.forward_looking_score,
        "latency_ms": result.latency_ms,
    }


@router.get("/sentiment/{ticker}")
async def get_sentiment(
    ticker: str,
    document_id: str = Query(...),
    period: str = Query(...),
):
    """
    Get cached sentiment for a ticker/document.
    Returns 404 if not yet computed — use POST /sentiment/score to compute.
    """
    engine = _get_sentiment_engine()
    cached = await engine._load_cache(document_id)
    if not cached:
        raise HTTPException(
            status_code=404,
            detail=f"Sentiment not found for document_id={document_id}. "
                   "POST to /v1/analytics/sentiment/score to compute it.",
        )
    return {
        "ticker": cached.ticker,
        "period": cached.period,
        "overall_score": cached.overall_score,
        "overall_label": cached.overall_label,
        "topic_scores": cached.topic_scores,
        "ceo_score": cached.ceo_score,
    }


@router.get("/sentiment/{ticker}/delta")
async def get_sentiment_delta(
    ticker: str,
    current_doc_id: str = Query(...),
    prior_doc_id: str = Query(...),
    current_period: str = Query(...),
    prior_period: str = Query(...),
):
    """Compute sentiment delta between two periods."""
    engine = _get_sentiment_engine()
    delta = await engine.compute_delta(
        ticker=ticker,
        current_doc_id=current_doc_id,
        prior_doc_id=prior_doc_id,
        current_period=current_period,
        prior_period=prior_period,
    )
    return {
        "ticker": delta.ticker,
        "current_period": delta.current_period,
        "prior_period": delta.prior_period,
        "overall_delta": delta.overall_delta,
        "topic_deltas": delta.topic_deltas,
        "ceo_delta": delta.ceo_delta,
        "narrative": delta.narrative,
    }


@router.post("/sentiment/batch")
async def score_sentiment_batch(request: SentimentBatchRequest):
    """Score sentiment for multiple documents in parallel."""
    import asyncio
    engine = _get_sentiment_engine()

    tasks = [
        engine.score_document(
            document_id=doc.document_id,
            ticker=doc.ticker,
            period=doc.period,
            document_type=doc.document_type,
            text=doc.text,
        )
        for doc in request.documents
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    output = []
    for i, result in enumerate(results):
        if isinstance(Exception, type(result)) or isinstance(result, Exception):
            output.append({"document_id": request.documents[i].document_id, "error": str(result)})
        else:
            output.append({
                "document_id": result.document_id,
                "ticker": result.ticker,
                "period": result.period,
                "overall_score": result.overall_score,
                "overall_label": result.overall_label,
                "topic_scores": result.topic_scores,
            })
    return {"results": output}


# ── Longitudinal Routes ────────────────────────────────────────────────────────

@router.post("/longitudinal")
async def get_longitudinal_profile(request: LongitudinalRequest):
    """Build a full longitudinal metric profile for a ticker."""
    tracker = _get_longitudinal_tracker()
    profile = await tracker.get_profile(
        ticker=request.ticker,
        company_name=request.company_name or request.ticker,
        metrics=request.metrics,
        periods=request.periods,
        generate_narrative=request.generate_narrative,
    )

    metrics_out = {}
    for metric_name, series in profile.metrics.items():
        metrics_out[metric_name] = {
            "display_name": series.display_name,
            "unit": series.unit,
            "trend_direction": series.trend_direction,
            "trend_confidence": series.trend_confidence,
            "cagr": series.cagr,
            "mean": series.mean,
            "data_points": [
                {
                    "period": dp.period,
                    "value": dp.value,
                    "yoy_change": dp.yoy_change,
                    "qoq_change": dp.qoq_change,
                    "is_anomaly": dp.is_anomaly,
                }
                for dp in series.data_points
            ],
        }

    return {
        "ticker": profile.ticker,
        "company_name": profile.company_name,
        "periods_analyzed": profile.periods_analyzed,
        "metrics": metrics_out,
        "cross_metric_insights": profile.cross_metric_insights,
        "narrative": profile.narrative,
        "latency_ms": profile.latency_ms,
    }


@router.get("/longitudinal/{ticker}")
async def get_metric_series(
    ticker: str,
    metric: str = Query(..., description="Metric name, e.g. 'revenue', 'gross_margin'"),
    periods: str = Query(..., description="Comma-separated periods, e.g. 'Q1 2023,Q2 2023,Q3 2023'"),
):
    """Get a single metric time series for a ticker."""
    tracker = _get_longitudinal_tracker()
    period_list = [p.strip() for p in periods.split(",") if p.strip()]

    if not period_list:
        raise HTTPException(status_code=400, detail="At least one period required")

    series = await tracker.get_metric_series(
        ticker=ticker,
        metric_name=metric,
        periods=period_list,
    )

    return {
        "ticker": series.ticker,
        "metric_name": series.metric_name,
        "display_name": series.display_name,
        "unit": series.unit,
        "trend_direction": series.trend_direction,
        "cagr": series.cagr,
        "mean": series.mean,
        "data_points": [
            {
                "period": dp.period,
                "value": dp.value,
                "yoy_change": dp.yoy_change,
                "qoq_change": dp.qoq_change,
                "is_anomaly": dp.is_anomaly,
                "anomaly_z_score": dp.anomaly_z_score,
            }
            for dp in series.data_points
        ],
    }


@router.post("/longitudinal/compare")
async def compare_periods(request: PeriodCompareRequest):
    """Compare a metric between two specific periods."""
    tracker = _get_longitudinal_tracker()
    series = await tracker.get_metric_series(
        ticker=request.ticker,
        metric_name=request.metric_name,
        periods=request.periods,
    )
    result = tracker.compare_periods(series, request.period_a, request.period_b)
    return result


@router.get("/longitudinal/{ticker}/guidance")
async def get_guidance_vs_actuals(
    ticker: str,
    metric: str = Query(...),
    periods: str = Query(..., description="Comma-separated periods"),
):
    """Track management guidance vs actual results."""
    tracker = _get_longitudinal_tracker()
    period_list = [p.strip() for p in periods.split(",") if p.strip()]
    results = await tracker.track_guidance_vs_actuals(
        ticker=ticker,
        metric=metric,
        periods=period_list,
    )
    return {
        "ticker": ticker,
        "metric": metric,
        "guidance_vs_actuals": [
            {
                "period": r.period,
                "guidance_value": r.guidance_value,
                "actual_value": r.actual_value,
                "beat_miss": r.beat_miss,
                "beat_miss_pct": r.beat_miss_pct,
            }
            for r in results
        ],
    }

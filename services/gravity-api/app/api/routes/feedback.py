"""
Feedback API — User Quality Signals
POST /v1/feedback/{trace_id}         — submit thumbs up/down
GET  /v1/feedback/routing-report     — current routing quality report (admin)
POST /v1/feedback/recompute          — trigger override recomputation (admin)
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import structlog

logger = structlog.get_logger()
router = APIRouter(prefix="/v1/feedback", tags=["feedback"])


class FeedbackRequest(BaseModel):
    signal: str   # "positive" | "negative"
    comment: str = ""


@router.post("/{trace_id}")
async def submit_feedback(trace_id: str, body: FeedbackRequest):
    """Record explicit user feedback for a search result (thumbs up/down)."""
    if body.signal not in ("positive", "negative"):
        raise HTTPException(status_code=422, detail="signal must be 'positive' or 'negative'")

    try:
        from app.dependencies import get_feedback_loop
        feedback_loop = get_feedback_loop()
        if feedback_loop:
            await feedback_loop.record_user_signal(trace_id, body.signal)

        logger.info("user_feedback_recorded", trace_id=trace_id, signal=body.signal)
        return {"status": "ok", "trace_id": trace_id, "signal": body.signal}
    except Exception as e:
        logger.warning("feedback_api_failed", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to record feedback")


@router.get("/routing-report")
async def routing_report(hours: int = 24):
    """Return routing quality metrics for the last N hours."""
    try:
        from app.dependencies import get_feedback_loop
        feedback_loop = get_feedback_loop()
        if not feedback_loop:
            return {"error": "Feedback loop not configured"}
        report = await feedback_loop.generate_report(lookback_hours=hours)
        return report
    except Exception as e:
        logger.warning("routing_report_failed", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to generate report")


@router.post("/recompute")
async def recompute_overrides():
    """Trigger routing override recomputation (normally runs hourly)."""
    try:
        from app.dependencies import get_feedback_loop
        feedback_loop = get_feedback_loop()
        if not feedback_loop:
            return {"error": "Feedback loop not configured"}
        overrides = await feedback_loop.recompute_overrides()
        return {"status": "ok", "overrides_generated": len(overrides), "overrides": overrides}
    except Exception as e:
        logger.warning("recompute_overrides_failed", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to recompute overrides")

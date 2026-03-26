"""Gravity Search — Usage Routes"""

import structlog
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from typing import Any

from app.api.schemas.search import FeedbackRequest, FeedbackResponse

logger = structlog.get_logger()
router = APIRouter()

async def get_db():
    from app.db.postgres import async_session
    async with async_session() as session:
        yield session

@router.get("/usage")
async def get_usage_stats(
    days: int = 30,
    db: Any = Depends(get_db)
):
    """Real usage stats from the SearchLog audit table."""
    from sqlalchemy import select, func, Integer
    from app.db.models import SearchLog

    try:
        today = datetime.now(timezone.utc).date()
        past_date = today - timedelta(days=days)

        # Basic stats
        result = await db.execute(
            select(
                func.count(SearchLog.id).label("total_queries"),
                func.avg(SearchLog.latency_ms).label("avg_latency"),
                func.sum(SearchLog.cost_usd).label("total_cost"),
                func.sum(func.cast(SearchLog.cache_hit, Integer)).label("cache_hits")
            ).where(SearchLog.created_at >= past_date)
        )
        row = result.fetchone()

        # Queries per day
        daily_result = await db.execute(
            select(
                func.date(SearchLog.created_at).label("date"),
                func.count(SearchLog.id).label("queries")
            )
            .where(SearchLog.created_at >= past_date)
            .group_by(func.date(SearchLog.created_at))
            .order_by("date")
        )
        daily_trend = [{"date": str(r.date), "queries": r.queries} for r in daily_result.fetchall()]

        total_queries = row.total_queries or 0

        return {
            "period_days": days,
            "total_queries": total_queries,
            "avg_latency_ms": round(row.avg_latency or 0, 1),
            "total_cost_usd": round(row.total_cost or 0, 4),
            "cache_hit_rate": round((row.cache_hits / total_queries) * 100, 1) if total_queries else 0,
            "daily_trend": daily_trend,
        }
    except Exception as e:
        logger.warning("usage_stats_failed", error=str(e))
        return {
            "period_days": days,
            "total_queries": 0,
            "avg_latency_ms": 0,
            "total_cost_usd": 0,
            "cache_hit_rate": 0,
            "daily_trend": [],
        }


@router.post("/feedback", response_model=FeedbackResponse)
async def submit_feedback(
    body: FeedbackRequest,
    db: Any = Depends(get_db),
) -> FeedbackResponse:
    """
    Record user thumbs-up / thumbs-down for a completed search.
    Updates the user_feedback column in search_logs for the given trace_id.
    """
    from sqlalchemy import update
    from app.db.models import SearchLog

    try:
        result = await db.execute(
            update(SearchLog)
            .where(SearchLog.trace_id == body.search_id)
            .values(user_feedback="thumbs_up" if body.rating == "up" else "thumbs_down")
            .returning(SearchLog.id)
        )
        row = result.fetchone()
        await db.commit()

        if row is None:
            raise HTTPException(status_code=404, detail=f"Search '{body.search_id}' not found")

        logger.info(
            "feedback_recorded",
            search_id=body.search_id,
            rating=body.rating,
            has_comment=body.comment is not None,
        )
        return FeedbackResponse(success=True, search_id=body.search_id)

    except HTTPException:
        raise
    except Exception as e:
        logger.warning("feedback_failed", error=str(e), search_id=body.search_id)
        raise HTTPException(status_code=500, detail="Failed to record feedback")

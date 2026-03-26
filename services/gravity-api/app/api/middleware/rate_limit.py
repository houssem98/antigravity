"""
Gravity Search — Rate Limiter (Section 7.4 of build guide)
Two-layer enforcement matching the official pricing tiers:

Per-minute sliding window (burst protection):
  free        →    10 req/min
  individual  →    60 req/min
  team        →   120 req/min
  enterprise  → 10000 req/min (effectively unlimited)

Monthly quota (billing enforcement):
  free        →     100 queries/month
  individual  →   5,000 queries/month
  team        →  25,000 queries/month
  enterprise  →   unlimited

Both checks run on every request. Monthly counters are stored in Redis
with a TTL that expires at the end of the calendar month.
"""

import time
import structlog
from datetime import datetime, timezone
from fastapi import HTTPException

from app.db.redis import redis_client

logger = structlog.get_logger()

# Per-minute burst limits
MINUTE_LIMITS: dict[str, int] = {
    "free": 10,
    "individual": 60,
    "team": 120,
    "enterprise": 10_000,
    "unlimited": 100_000,
}

# Monthly quota limits (None = unlimited)
MONTHLY_LIMITS: dict[str, int | None] = {
    "free": 100,
    "individual": 5_000,
    "team": 25_000,
    "enterprise": None,
    "unlimited": None,
}


def _month_ttl() -> int:
    """Seconds until midnight UTC on the 1st of next month."""
    now = datetime.now(timezone.utc)
    if now.month == 12:
        next_month = now.replace(year=now.year + 1, month=1, day=1,
                                  hour=0, minute=0, second=0, microsecond=0)
    else:
        next_month = now.replace(month=now.month + 1, day=1,
                                  hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((next_month - now).total_seconds()))


class RateLimiter:
    """
    Two-layer Redis rate limiter:
      Layer 1 — per-minute sliding window (burst)
      Layer 2 — per-month quota (billing)
    """

    async def check(self, user_id: str, tier: str = "free") -> dict:
        """
        Enforce both per-minute and monthly limits.
        Returns response headers dict. Raises HTTP 429 if either limit exceeded.
        """
        headers: dict[str, str] = {}

        # ── Layer 1: Per-minute sliding window ──────────────────────────
        minute_limit = MINUTE_LIMITS.get(tier, 10)
        window_epoch = int(time.time() // 60)
        minute_key = f"ratelimit:minute:{user_id}:{window_epoch}"

        try:
            minute_count = await redis_client.incr(minute_key)
            if minute_count == 1:
                await redis_client.expire(minute_key, 120)
        except Exception as e:
            logger.warning("rate_limit_redis_error", error=str(e))
            return {"X-RateLimit-Limit": str(minute_limit), "X-RateLimit-Remaining": "1"}

        reset_at = (window_epoch + 1) * 60
        headers.update({
            "X-RateLimit-Limit": str(minute_limit),
            "X-RateLimit-Remaining": str(max(0, minute_limit - minute_count)),
            "X-RateLimit-Reset": str(reset_at),
        })

        if minute_count > minute_limit:
            logger.warning("minute_rate_exceeded", user_id=user_id, tier=tier, count=minute_count)
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded: {minute_limit} requests/minute. "
                       f"Resets in {reset_at - int(time.time())}s.",
                headers={"Retry-After": str(reset_at - int(time.time())), **headers},
            )

        # ── Layer 2: Monthly quota ───────────────────────────────────────
        monthly_limit = MONTHLY_LIMITS.get(tier)
        if monthly_limit is not None:
            now = datetime.now(timezone.utc)
            month_key = f"ratelimit:monthly:{user_id}:{now.year}:{now.month:02d}"
            try:
                monthly_count = await redis_client.incr(month_key)
                if monthly_count == 1:
                    await redis_client.expire(month_key, _month_ttl())
            except Exception as e:
                logger.warning("monthly_quota_redis_error", error=str(e))
                monthly_count = 0

            headers.update({
                "X-RateLimit-Monthly-Limit": str(monthly_limit),
                "X-RateLimit-Monthly-Remaining": str(max(0, monthly_limit - monthly_count)),
            })

            if monthly_count > monthly_limit:
                logger.warning("monthly_quota_exceeded",
                               user_id=user_id, tier=tier, count=monthly_count)
                raise HTTPException(
                    status_code=429,
                    detail=(
                        f"Monthly quota exceeded: {monthly_limit} queries/month for "
                        f"'{tier}' tier. Resets 1st of next month. "
                        f"Upgrade at antigravity.ai/pricing."
                    ),
                    headers={"Retry-After": str(_month_ttl()), **headers},
                )

        return headers


# Singleton
rate_limiter = RateLimiter()


async def check_rate_limit(user_id: str, tier: str = "free") -> dict:
    """FastAPI Depends convenience wrapper."""
    return await rate_limiter.check(user_id, tier)

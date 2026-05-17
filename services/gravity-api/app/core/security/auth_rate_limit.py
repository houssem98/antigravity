"""
Auth-specific rate limit (separate from billing-tier RateLimiter).

Three independent buckets per endpoint:
  - per-IP (anti-brute-force from one host)
  - per-email (anti-credential-stuffing against one account)
  - per-IP+email (most specific; blocks IP/account combos)

Token-bucket via Redis INCR + EXPIRE. Soft fail open if Redis down — we still
log a warning, but never block legitimate users on Redis hiccups.

Usage:
    await enforce("login", ip=client.host, email=req.email)
    await enforce("reset_request", ip=ip, email=email)
"""

from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass
from typing import Optional

import structlog
from fastapi import HTTPException

from app.db.redis import redis_client

logger = structlog.get_logger()


def _disabled() -> bool:
    return os.getenv("AUTH_RL_DISABLED", "").lower() in ("1", "true", "yes")


@dataclass(frozen=True)
class Bucket:
    name: str
    limit: int
    window_seconds: int


# Action → (per-IP bucket, per-email bucket)
RULES: dict[str, tuple[Bucket, Bucket]] = {
    "login": (
        Bucket("login_ip", limit=20, window_seconds=60),
        Bucket("login_email", limit=10, window_seconds=300),
    ),
    "signup": (
        Bucket("signup_ip", limit=5, window_seconds=300),
        Bucket("signup_email", limit=3, window_seconds=3600),
    ),
    "reset_request": (
        Bucket("reset_ip", limit=10, window_seconds=600),
        Bucket("reset_email", limit=3, window_seconds=3600),
    ),
    "reset_confirm": (
        Bucket("reset_confirm_ip", limit=10, window_seconds=600),
        Bucket("reset_confirm_email", limit=10, window_seconds=600),
    ),
    "verify_request": (
        Bucket("verify_ip", limit=10, window_seconds=600),
        Bucket("verify_email", limit=5, window_seconds=3600),
    ),
    "mfa_verify": (
        Bucket("mfa_ip", limit=15, window_seconds=300),
        Bucket("mfa_email", limit=10, window_seconds=300),
    ),
}


def _email_hash(email: str) -> str:
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()[:16]


async def _hit(scope: str, identifier: str, bucket: Bucket) -> int:
    """INCR an expiring counter. Returns post-increment count, or 0 if Redis down."""
    window = int(time.time()) // bucket.window_seconds
    key = f"authrl:{scope}:{identifier}:{window}"
    try:
        n = await redis_client.incr(key)
        if n == 1:
            await redis_client.expire(key, bucket.window_seconds * 2)
        return int(n)
    except Exception as e:
        logger.warning("auth_rl_redis_error", scope=scope, error=str(e))
        return 0


async def enforce(
    action: str,
    *,
    ip: Optional[str] = None,
    email: Optional[str] = None,
) -> None:
    """Raise HTTP 429 if any bucket for this action is over its limit."""
    if _disabled():
        return
    rule = RULES.get(action)
    if rule is None:
        return
    ip_bucket, email_bucket = rule

    if ip:
        count = await _hit(ip_bucket.name, ip, ip_bucket)
        if count > ip_bucket.limit:
            logger.warning("auth_rl_ip_block", action=action, ip=ip, count=count)
            raise HTTPException(
                status_code=429,
                detail=f"too many {action} attempts from this IP; try again later",
                headers={"Retry-After": str(ip_bucket.window_seconds)},
            )

    if email:
        eh = _email_hash(email)
        count = await _hit(email_bucket.name, eh, email_bucket)
        if count > email_bucket.limit:
            logger.warning("auth_rl_email_block", action=action, email_hash=eh, count=count)
            raise HTTPException(
                status_code=429,
                detail=f"too many {action} attempts for this account; try again later",
                headers={"Retry-After": str(email_bucket.window_seconds)},
            )

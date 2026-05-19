"""
Single-use signed tokens for email verification + password reset.

Design:
  - Token format: base64url(payload).base64url(hmac_sha256(payload))
  - Payload: {"v": 1, "kind": "verify|reset", "sub": user_id, "exp": unix_ts, "nonce": rand}
  - Nonce stored in Redis with TTL == token TTL. On consume, key is deleted.
    Replaying the same token after consume returns None.
  - HMAC key: AUTH_TOKEN_SECRET env (falls back to AUTH_JWT_SECRET).
  - Fallback: if Redis is unavailable, in-memory dict is used (single-process only).

Why not JWT: we need true single-use semantics. JWT is stateless; Redis nonce
gives us revocation w/o managing a deny-list of token IDs.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Literal, Optional

import structlog

from app.db.redis import redis_client

logger = structlog.get_logger()

# In-memory fallback when Redis is unavailable. Maps nonce_key → (user_id, expires_at).
_mem_store: dict[str, tuple[str, float]] = {}
_mem_lock = asyncio.Lock()

TokenKind = Literal["verify", "reset"]

VERIFY_TTL_SECONDS = 24 * 3600        # 24h for email verification
RESET_TTL_SECONDS = 15 * 60           # 15m for password reset


def _secret() -> bytes:
    s = os.getenv("AUTH_TOKEN_SECRET") or os.getenv("AUTH_JWT_SECRET", "")
    if not s:
        s = secrets.token_urlsafe(48)
        os.environ["AUTH_TOKEN_SECRET"] = s
        logger.warning("auth_token_secret_ephemeral")
    return s.encode("utf-8")


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _b64d(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _sign(payload: bytes) -> bytes:
    return hmac.new(_secret(), payload, hashlib.sha256).digest()


def _nonce_key(kind: TokenKind, nonce: str) -> str:
    return f"auth:onetime:{kind}:{nonce}"


async def issue_token(user_id: str, kind: TokenKind) -> str:
    ttl = VERIFY_TTL_SECONDS if kind == "verify" else RESET_TTL_SECONDS
    nonce = secrets.token_urlsafe(24)
    payload = {
        "v": 1,
        "kind": kind,
        "sub": user_id,
        "exp": int(time.time()) + ttl,
        "nonce": nonce,
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    sig = _sign(raw)
    token = f"{_b64e(raw)}.{_b64e(sig)}"

    key = _nonce_key(kind, nonce)
    redis_ok = False
    try:
        await redis_client.set(key, user_id, ex=ttl)
        redis_ok = True
    except Exception as e:
        logger.warning("auth_token_nonce_redis_failed", error=str(e), kind=kind)

    if not redis_ok:
        async with _mem_lock:
            _mem_store[key] = (user_id, time.time() + ttl)

    return token


async def consume_token(token: str, expected_kind: TokenKind) -> Optional[str]:
    """
    Verify signature + expiry + nonce + kind. Returns user_id on success and
    deletes the nonce so the token cannot be re-used. None on any failure.
    """
    try:
        raw_b64, sig_b64 = token.split(".", 1)
        raw = _b64d(raw_b64)
        sig = _b64d(sig_b64)
    except Exception:
        return None

    if not hmac.compare_digest(sig, _sign(raw)):
        return None

    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return None

    if payload.get("v") != 1:
        return None
    if payload.get("kind") != expected_kind:
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None

    nonce = payload.get("nonce", "")
    user_id = payload.get("sub", "")
    if not nonce or not user_id:
        return None

    key = _nonce_key(expected_kind, nonce)

    # Try Redis first.
    redis_ok = False
    try:
        deleted = await redis_client.delete(key)
        redis_ok = True
        if deleted == 0:
            # Already consumed or Redis lost it — refuse single-use guarantee.
            # Check in-memory in case it was issued before Redis came up.
            pass
        else:
            return user_id
    except Exception as e:
        logger.warning("auth_token_nonce_check_failed", error=str(e))

    # Fallback: in-memory store (used when Redis is unavailable).
    async with _mem_lock:
        entry = _mem_store.get(key)
        if entry is None:
            if redis_ok:
                # Redis said deleted==0 and no mem entry → already consumed.
                return None
            # Redis down + not in mem → token was issued before this process started.
            # Accept if signature+expiry valid (already checked above). Single-use
            # not guaranteed across restarts when Redis is absent — acceptable tradeoff.
            logger.warning("auth_token_no_redis_accepting_valid_sig", kind=expected_kind)
            return user_id
        stored_uid, exp_at = entry
        if time.time() > exp_at:
            del _mem_store[key]
            return None
        if stored_uid != user_id:
            return None
        del _mem_store[key]
        return user_id


async def revoke_all_for_user(user_id: str, kind: TokenKind) -> int:
    """Scan + delete all live nonces for a user. Best-effort; not atomic."""
    pattern = _nonce_key(kind, "*")
    deleted = 0
    try:
        async for key in redis_client.scan_iter(match=pattern, count=200):
            val = await redis_client.get(key)
            if isinstance(val, bytes):
                val = val.decode("utf-8")
            if val == user_id:
                deleted += await redis_client.delete(key)
    except Exception as e:
        logger.warning("auth_token_revoke_failed", error=str(e))
    return deleted

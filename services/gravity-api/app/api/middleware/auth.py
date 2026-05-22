"""
Gravity Search — API Key + JWT Authentication
FastAPI dependency (not HTTP middleware) so individual routes can opt in/out.

In DEVELOPMENT mode: all requests bypass auth (returns dev_user context).
In PRODUCTION mode: validates X-API-Key header against Redis-stored keys.
"""

import structlog
from fastapi import Header, HTTPException, Request
from typing import Optional

from app.config import settings, Environment

logger = structlog.get_logger()


async def require_auth(
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None),
) -> dict:
    """
    FastAPI dependency for authentication.

    Development: bypass auth, return dev_user context.
    Production: validate X-API-Key or Bearer JWT.

    Usage:
        @router.post("/search")
        async def search(auth: dict = Depends(require_auth)):
            user_id = auth["user_id"]
    """
    # Development bypass
    if settings.app_env == Environment.DEVELOPMENT:
        return {
            "user_id": "dev_user",
            "tier": "unlimited",
            "api_key": "dev",
        }

    # Production: validate API key
    if x_api_key:
        user = await _validate_api_key(x_api_key)
        if user:
            return user
        raise HTTPException(status_code=401, detail="Invalid API key")

    # Production: validate Bearer JWT
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        user = await _validate_jwt(token)
        if user:
            return user
        raise HTTPException(status_code=401, detail="Invalid token")

    raise HTTPException(
        status_code=401,
        detail="Authentication required. Provide X-API-Key header or Bearer token.",
    )


async def _validate_api_key(api_key: str) -> dict | None:
    """Validate API key against Redis store."""
    try:
        from app.db.redis import redis_client
        import json
        user_json = await redis_client.get(f"apikey:{api_key}")
        if user_json:
            return json.loads(user_json)
        return None
    except Exception as e:
        logger.warning("api_key_validation_error", error=str(e))
        return None


_JWKS_CACHE: dict = {"keys": None, "fetched_at": 0.0}


async def _supabase_jwks() -> dict | None:
    """Fetch + cache Supabase JWKS (24h)."""
    import os, time
    sb_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    if not sb_url:
        return None
    if _JWKS_CACHE["keys"] and (time.time() - _JWKS_CACHE["fetched_at"]) < 86400:
        return _JWKS_CACHE["keys"]
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as c:
            r = await c.get(f"{sb_url}/auth/v1/.well-known/jwks.json")
            if r.status_code != 200:
                return None
            data = r.json()
        _JWKS_CACHE["keys"] = data
        _JWKS_CACHE["fetched_at"] = time.time()
        return data
    except Exception as e:
        logger.warning("supabase_jwks_fetch_failed", error=str(e))
        return None


async def _validate_jwt(token: str) -> dict | None:
    """
    Validate JWT Bearer token. Tries three issuers in order:
      1. Supabase ES256 (current — asymmetric, JWKS-verified)
      2. Supabase HS256 (legacy projects, SUPABASE_JWT_SECRET)
      3. AuthStore.issue_access_token (AUTH_JWT_SECRET) — gravity-api own JWTs
    """
    import os
    from jose import jwt

    def _to_auth_dict(payload: dict, *, supabase: bool) -> dict:
        if supabase:
            return {
                "user_id": payload.get("sub", "unknown"),
                "email": payload.get("email", ""),
                "org_id": "",
                "role": payload.get("role", "authenticated"),
                "entitlements": ["public"],
                "tier": "free",
            }
        return {
            "user_id": payload.get("sub", "unknown"),
            "email": payload.get("email", ""),
            "org_id": payload.get("org_id", ""),
            "role": payload.get("role", "member"),
            "entitlements": payload.get("entitlements", []),
            "tier": payload.get("tier", "free"),
        }

    # 1. Supabase ES256 via JWKS (current default).
    try:
        unverified_header = jwt.get_unverified_header(token)
        alg = unverified_header.get("alg", "")
        kid = unverified_header.get("kid", "")
        if alg in ("ES256", "RS256"):
            jwks = await _supabase_jwks()
            if jwks and jwks.get("keys"):
                key = next((k for k in jwks["keys"] if k.get("kid") == kid), None) or jwks["keys"][0]
                payload = jwt.decode(
                    token, key, algorithms=[alg],
                    audience="authenticated",
                )
                return _to_auth_dict(payload, supabase=True)
    except Exception:
        pass

    # 2. Supabase HS256 (legacy projects).
    sb_secret = os.getenv("SUPABASE_JWT_SECRET", "")
    if sb_secret:
        try:
            payload = jwt.decode(
                token, sb_secret, algorithms=["HS256"],
                audience="authenticated",
            )
            return _to_auth_dict(payload, supabase=True)
        except Exception:
            pass

    # 3. Legacy gravity-api JWTs.
    own_secret = os.getenv("AUTH_JWT_SECRET", "")
    if own_secret:
        try:
            payload = jwt.decode(token, own_secret, algorithms=["HS256"])
            if payload.get("type") != "access":
                return None
            return _to_auth_dict(payload, supabase=False)
        except Exception:
            pass

    return None

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


async def _validate_jwt(token: str) -> dict | None:
    """Validate JWT Bearer token."""
    try:
        from jose import jwt, JWTError
        payload = jwt.decode(token, settings.anthropic_api_key, algorithms=["HS256"])
        return {
            "user_id": payload.get("sub", "unknown"),
            "tier": payload.get("tier", "free"),
        }
    except Exception:
        return None

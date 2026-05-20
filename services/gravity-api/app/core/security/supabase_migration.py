"""
On-the-fly migration of legacy Supabase users into Fly Postgres auth_users.

Background: market-ui used Supabase auth before we built the gravity-api auth
backend. Old accounts still exist in Supabase but unknown to our local store,
so /forgot-password silently no-ops for them.

Strategy: when a user is missing locally, check Supabase admin API by email.
If found, create a local record with an unguessable random password hash. The
user must then complete the password reset flow to set a real password.

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
"""
from __future__ import annotations

import os
import json
import secrets
from typing import Optional

import httpx
import structlog

from app.core.security.auth_store import AuthStore, UserRecord, _PWD

logger = structlog.get_logger()


async def import_from_supabase_if_exists(
    store: AuthStore, email: str
) -> Optional[UserRecord]:
    """
    Look up `email` in Supabase auth. If found, insert a local user record
    with a random password hash and return it. Otherwise None.
    """
    sb_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    srk = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not sb_url or not srk:
        return None

    norm = email.strip().lower()
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(
                f"{sb_url}/auth/v1/admin/users",
                params={"email": norm},
                headers={"apikey": srk, "Authorization": f"Bearer {srk}"},
            )
            if r.status_code != 200:
                logger.warning("supabase_lookup_failed", status=r.status_code)
                return None
            users = r.json().get("users", [])
    except Exception as e:
        logger.warning("supabase_lookup_exception", error=str(e))
        return None

    match = next((u for u in users if (u.get("email") or "").strip().lower() == norm), None)
    if not match:
        return None

    user_id = "u_" + secrets.token_urlsafe(12)
    placeholder_hash = _PWD.hash(secrets.token_urlsafe(32))
    email_verified = bool(match.get("email_confirmed_at"))

    if store.db is not None:
        try:
            async with store.db.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO auth_users
                      (user_id, email, password_hash, org_id, role, entitlements, email_verified)
                    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
                    ON CONFLICT (email) DO NOTHING
                    """,
                    user_id, norm, placeholder_hash, "", "member",
                    json.dumps(["public"]), email_verified,
                )
        except Exception as e:
            logger.warning("supabase_migration_db_failed", error=str(e), email=norm)
            return None

    logger.info("supabase_user_migrated", email=norm, user_id=user_id)
    return await store.get_by_email(norm)

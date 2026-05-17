"""
Self-Hosted User Auth Store (Path A1).

Replaces Supabase. Postgres-backed users + bcrypt passwords + HS256 JWT.
Integrates with:
  - SessionStore (N1) for session timeouts
  - MFA TOTP (N1) for 2FA
  - APIKeyStore (P0.4) for tenant secrets
  - UserEntitlements (P0.1) for retrieval ACL
  - AuditLogger (P0.3) for login + signup events

Why ditch Supabase:
  - Project paused/DNS-fail blocks login (reported 2026-05-08)
  - Existing security stack (P0.1-P0.6 + N1) already covers everything
    Supabase Auth provides except OAuth-provider login
  - Removes 3rd-party dep + $25/mo + DPA
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

import structlog
from passlib.context import CryptContext
from jose import jwt, JWTError

logger = structlog.get_logger()


# pbkdf2_sha256 — no native deps, no 72-byte cap, OWASP-approved.
# 600k rounds matches OWASP 2024 recommendation.
_PWD = CryptContext(
    schemes=["pbkdf2_sha256"],
    deprecated="auto",
    pbkdf2_sha256__rounds=600_000,
)

JWT_ALGO = "HS256"
JWT_TTL_HOURS = 12          # access token lifetime
JWT_REFRESH_TTL_DAYS = 30   # refresh token lifetime


def _jwt_secret() -> str:
    s = os.getenv("AUTH_JWT_SECRET", "")
    if not s:
        # Dev fallback — auto-generated per process. WARN.
        s = secrets.token_urlsafe(48)
        os.environ["AUTH_JWT_SECRET"] = s
        logger.warning(
            "auth_jwt_secret_ephemeral",
            note="Set AUTH_JWT_SECRET env. Without it, all sessions invalidate on restart.",
        )
    return s


# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class UserRecord:
    user_id: str
    email: str
    password_hash: str
    org_id: str = ""
    role: str = "member"            # admin/member/reviewer/auditor/viewer
    entitlements: list[str] = field(default_factory=lambda: ["public"])
    mfa_enabled: bool = False
    mfa_secret: str = ""
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_login_at: Optional[datetime] = None
    disabled: bool = False
    email_verified: bool = False
    email_verified_at: Optional[datetime] = None


# DDL — append-only-ish; updates only allowed for last_login_at, password_hash,
# mfa_*, disabled. App role configured to deny DELETE.
USER_DDL = """
CREATE TABLE IF NOT EXISTS auth_users (
    user_id        TEXT PRIMARY KEY,
    email          CITEXT UNIQUE NOT NULL,
    password_hash  TEXT NOT NULL,
    org_id         TEXT NOT NULL DEFAULT '',
    role           TEXT NOT NULL DEFAULT 'member',
    entitlements   JSONB NOT NULL DEFAULT '["public"]'::jsonb,
    mfa_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret     TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at  TIMESTAMPTZ,
    disabled       BOOLEAN NOT NULL DEFAULT FALSE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    email_verified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_auth_users_org ON auth_users (org_id);
"""

USER_MIGRATIONS = [
    "ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ",
]


# ─── Auth store ───────────────────────────────────────────────────────────────

class AuthStore:
    """
    Async user/password store backed by Postgres + in-memory fallback.

    Usage:
        store = AuthStore(db_pool=pool)
        user = await store.create_user(email="...", password="...", org_id="acme")
        u = await store.verify_password(email, password)
        token = store.issue_access_token(user)
        claims = store.decode_token(token)
    """

    def __init__(self, db_pool=None):
        self.db = db_pool
        self._mem: dict[str, UserRecord] = {}      # user_id -> rec
        self._mem_email: dict[str, str] = {}       # email lower -> user_id

    async def ensure_schema(self):
        if self.db is None:
            return
        try:
            async with self.db.acquire() as conn:
                # citext extension for case-insensitive email
                await conn.execute("CREATE EXTENSION IF NOT EXISTS citext")
                await conn.execute(USER_DDL)
                for stmt in USER_MIGRATIONS:
                    try:
                        await conn.execute(stmt)
                    except Exception as me:
                        logger.warning("auth_migration_failed", stmt=stmt[:80], error=str(me))
        except Exception as e:
            logger.warning("auth_schema_init_failed", error=str(e))

    # ── Create / read ────────────────────────────────────────────────────

    async def create_user(
        self,
        email: str,
        password: str,
        org_id: str = "",
        role: str = "member",
        entitlements: Optional[list[str]] = None,
    ) -> UserRecord:
        if not email or "@" not in email:
            raise ValueError("valid email required")
        if len(password) < 8:
            raise ValueError("password must be >= 8 characters")
        if role not in ("admin", "member", "reviewer", "auditor", "viewer"):
            raise ValueError(f"invalid role: {role}")

        norm_email = email.strip().lower()
        if await self._email_exists(norm_email):
            raise ValueError(f"email already registered: {norm_email}")

        user_id = "u_" + secrets.token_urlsafe(12)
        rec = UserRecord(
            user_id=user_id,
            email=norm_email,
            password_hash=_PWD.hash(password),
            org_id=org_id,
            role=role,
            entitlements=entitlements or ["public"],
        )

        if self.db is not None:
            await self.ensure_schema()
            try:
                import json
                async with self.db.acquire() as conn:
                    await conn.execute(
                        """
                        INSERT INTO auth_users
                          (user_id, email, password_hash, org_id, role, entitlements)
                        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
                        """,
                        user_id, norm_email, rec.password_hash, org_id,
                        role, json.dumps(rec.entitlements),
                    )
            except Exception as e:
                logger.warning("auth_create_user_db_failed", error=str(e))
                self._mem[user_id] = rec
                self._mem_email[norm_email] = user_id
        else:
            self._mem[user_id] = rec
            self._mem_email[norm_email] = user_id

        logger.info("auth_user_created", user_id=user_id, email=norm_email, org_id=org_id)
        return rec

    async def get_by_email(self, email: str) -> Optional[UserRecord]:
        norm = email.strip().lower()
        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    row = await conn.fetchrow(
                        "SELECT user_id, email, password_hash, org_id, role, entitlements, "
                        "mfa_enabled, mfa_secret, created_at, last_login_at, disabled, "
                        "COALESCE(email_verified, FALSE) AS email_verified, email_verified_at "
                        "FROM auth_users WHERE email = $1",
                        norm,
                    )
                if row:
                    return self._row_to_rec(row)
            except Exception as e:
                logger.warning("auth_get_by_email_failed", error=str(e))
        uid = self._mem_email.get(norm)
        return self._mem.get(uid) if uid else None

    async def get_by_id(self, user_id: str) -> Optional[UserRecord]:
        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    row = await conn.fetchrow(
                        "SELECT user_id, email, password_hash, org_id, role, entitlements, "
                        "mfa_enabled, mfa_secret, created_at, last_login_at, disabled, "
                        "COALESCE(email_verified, FALSE) AS email_verified, email_verified_at "
                        "FROM auth_users WHERE user_id = $1",
                        user_id,
                    )
                if row:
                    return self._row_to_rec(row)
            except Exception as e:
                logger.warning("auth_get_by_id_failed", error=str(e))
        return self._mem.get(user_id)

    async def _email_exists(self, norm_email: str) -> bool:
        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    row = await conn.fetchrow(
                        "SELECT 1 FROM auth_users WHERE email = $1", norm_email
                    )
                return row is not None
            except Exception:
                pass
        return norm_email in self._mem_email

    def _row_to_rec(self, row) -> UserRecord:
        import json
        ents = row["entitlements"]
        if isinstance(ents, str):
            ents = json.loads(ents)
        return UserRecord(
            user_id=row["user_id"],
            email=row["email"],
            password_hash=row["password_hash"],
            org_id=row["org_id"] or "",
            role=row["role"] or "member",
            entitlements=list(ents or ["public"]),
            mfa_enabled=bool(row["mfa_enabled"]),
            mfa_secret=row["mfa_secret"] or "",
            created_at=row["created_at"],
            last_login_at=row["last_login_at"],
            disabled=bool(row["disabled"]),
            email_verified=bool(row["email_verified"]) if "email_verified" in row.keys() else False,
            email_verified_at=row["email_verified_at"] if "email_verified_at" in row.keys() else None,
        )

    # ── Verify password (constant-time) ──────────────────────────────────

    async def verify_password(self, email: str, password: str) -> Optional[UserRecord]:
        rec = await self.get_by_email(email)
        if rec is None:
            # Run dummy hash compare to keep timing constant.
            try:
                _PWD.verify(password, _PWD.hash("dummy-timing-equalizer"))
            except Exception:
                pass
            return None
        if rec.disabled:
            return None
        if not _PWD.verify(password, rec.password_hash):
            return None
        await self._touch_login(rec.user_id)
        return rec

    async def _touch_login(self, user_id: str):
        now = datetime.now(timezone.utc)
        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    await conn.execute(
                        "UPDATE auth_users SET last_login_at = $1 WHERE user_id = $2",
                        now, user_id,
                    )
            except Exception:
                pass
        rec = self._mem.get(user_id)
        if rec is not None:
            rec.last_login_at = now

    # ── Password change / disable ────────────────────────────────────────

    async def change_password(self, user_id: str, new_password: str) -> bool:
        if len(new_password) < 8:
            raise ValueError("password must be >= 8 characters")
        new_hash = _PWD.hash(new_password)
        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    res = await conn.execute(
                        "UPDATE auth_users SET password_hash = $1 WHERE user_id = $2",
                        new_hash, user_id,
                    )
                    if "UPDATE 0" not in (res or ""):
                        return True
            except Exception as e:
                logger.warning("auth_change_password_failed", error=str(e))
        rec = self._mem.get(user_id)
        if rec is None:
            return False
        rec.password_hash = new_hash
        return True

    async def disable_user(self, user_id: str) -> bool:
        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    await conn.execute(
                        "UPDATE auth_users SET disabled = TRUE WHERE user_id = $1",
                        user_id,
                    )
            except Exception:
                pass
        rec = self._mem.get(user_id)
        if rec is not None:
            rec.disabled = True
        return True

    # ── MFA ──────────────────────────────────────────────────────────────

    async def enable_mfa(self, user_id: str, secret_b32: str) -> bool:
        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    await conn.execute(
                        "UPDATE auth_users SET mfa_enabled = TRUE, mfa_secret = $1 "
                        "WHERE user_id = $2",
                        secret_b32, user_id,
                    )
            except Exception:
                pass
        rec = self._mem.get(user_id)
        if rec is not None:
            rec.mfa_enabled = True
            rec.mfa_secret = secret_b32
        return True

    # ── Email verification ───────────────────────────────────────────────

    async def mark_email_verified(self, user_id: str) -> bool:
        now = datetime.now(timezone.utc)
        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    await conn.execute(
                        "UPDATE auth_users SET email_verified = TRUE, "
                        "email_verified_at = $1 WHERE user_id = $2",
                        now, user_id,
                    )
            except Exception as e:
                logger.warning("auth_mark_verified_failed", error=str(e))
        rec = self._mem.get(user_id)
        if rec is not None:
            rec.email_verified = True
            rec.email_verified_at = now
        return True

    # ── JWT issue / verify ───────────────────────────────────────────────

    def issue_access_token(self, user: UserRecord) -> str:
        now = datetime.now(timezone.utc)
        claims = {
            "sub": user.user_id,
            "email": user.email,
            "org_id": user.org_id,
            "role": user.role,
            "entitlements": user.entitlements,
            "type": "access",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=JWT_TTL_HOURS)).timestamp()),
        }
        return jwt.encode(claims, _jwt_secret(), algorithm=JWT_ALGO)

    def issue_refresh_token(self, user: UserRecord) -> str:
        now = datetime.now(timezone.utc)
        claims = {
            "sub": user.user_id,
            "type": "refresh",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(days=JWT_REFRESH_TTL_DAYS)).timestamp()),
        }
        return jwt.encode(claims, _jwt_secret(), algorithm=JWT_ALGO)

    def decode_token(self, token: str) -> Optional[dict]:
        try:
            return jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGO])
        except JWTError as e:
            logger.debug("jwt_decode_failed", error=str(e))
            return None

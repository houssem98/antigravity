"""
Session Security: MFA + session timeout + IP allowlist (plan §6.11).

Three orthogonal controls layered on top of the existing API-key / JWT auth:

  1. MFA (TOTP, RFC 6238 via pyotp)
     - Per-user secret (32B base32) generated at enrollment
     - Verified at login + on /sensitive operations (export, BYOK rotate)
     - Backup recovery codes (10 per user, single-use, hash-stored)

  2. Session timeout
     - SessionRecord(token, user_id, org_id, created_at, last_active_at)
     - Idle timeout: default 30min (configurable per-org)
     - Absolute timeout: default 12h
     - Touched on every authenticated request

  3. IP allowlist
     - Per-org list of CIDR ranges
     - Empty list = no restriction (default)
     - Non-empty list = deny-by-default; only matching IPs allowed

All three persist to Postgres + mirror to Redis for sub-ms checks. In-memory
fallback for dev/test.
"""

from __future__ import annotations

import hashlib
import ipaddress
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

import structlog

logger = structlog.get_logger()


# ─── Config ───────────────────────────────────────────────────────────────────

DEFAULT_IDLE_TIMEOUT_MIN = 30
DEFAULT_ABSOLUTE_TIMEOUT_HOURS = 12
TOTP_DIGITS = 6
TOTP_INTERVAL = 30
TOTP_VALID_WINDOW = 1   # accept previous + current 30s window


# ─── MFA (TOTP) ───────────────────────────────────────────────────────────────

@dataclass
class MFASecret:
    """Per-user TOTP secret + recovery codes."""
    user_id: str
    secret_b32: str                   # 32-char base32 — provisioned to authenticator app
    recovery_codes_hashed: list[str] = field(default_factory=list)
    enrolled_at: str = ""
    last_used_at: str = ""

    def provisioning_uri(self, account_name: str, issuer: str = "Gravity") -> str:
        """otpauth:// URI for QR code generation."""
        import pyotp
        return pyotp.TOTP(self.secret_b32).provisioning_uri(
            name=account_name, issuer_name=issuer,
        )


def generate_totp_secret() -> str:
    """Generate a fresh 32-char base32 TOTP secret."""
    import pyotp
    return pyotp.random_base32()


def generate_recovery_codes(n: int = 10) -> tuple[list[str], list[str]]:
    """
    Generate n recovery codes. Returns (plaintext_codes, hashed_for_storage).
    Plaintext is shown ONCE to the user; only hashes are persisted.
    """
    plain = [
        "-".join(secrets.token_urlsafe(4)[:5] for _ in range(2))
        for _ in range(n)
    ]
    hashed = [hashlib.sha256(c.encode()).hexdigest() for c in plain]
    return plain, hashed


def verify_totp(secret_b32: str, code: str, valid_window: int = TOTP_VALID_WINDOW) -> bool:
    """Verify a TOTP code against a secret. Tolerates ±valid_window 30s steps."""
    import pyotp
    try:
        return pyotp.TOTP(secret_b32).verify(code.strip(), valid_window=valid_window)
    except Exception as e:
        logger.debug("totp_verify_exception", error=str(e))
        return False


def verify_recovery_code(plaintext: str, stored_hashes: list[str]) -> tuple[bool, list[str]]:
    """
    Verify and consume a single-use recovery code.
    Returns (matched, updated_hashes). Caller must persist updated_hashes.
    """
    h = hashlib.sha256(plaintext.strip().encode()).hexdigest()
    if h in stored_hashes:
        return True, [x for x in stored_hashes if x != h]
    return False, stored_hashes


# ─── Session timeouts ─────────────────────────────────────────────────────────

@dataclass
class SessionRecord:
    token: str
    user_id: str
    org_id: str
    created_at: datetime
    last_active_at: datetime
    idle_timeout_min: int = DEFAULT_IDLE_TIMEOUT_MIN
    absolute_timeout_hours: int = DEFAULT_ABSOLUTE_TIMEOUT_HOURS
    mfa_passed: bool = False
    ip: str = ""

    def is_valid(self, now: Optional[datetime] = None) -> tuple[bool, str]:
        """Return (valid, reason)."""
        now = now or datetime.now(timezone.utc)
        if now - self.created_at > timedelta(hours=self.absolute_timeout_hours):
            return False, "absolute_timeout"
        if now - self.last_active_at > timedelta(minutes=self.idle_timeout_min):
            return False, "idle_timeout"
        return True, ""

    def touch(self, now: Optional[datetime] = None):
        self.last_active_at = now or datetime.now(timezone.utc)


class SessionStore:
    """In-memory session store. Production swaps in a Redis-backed impl with
    the same interface — same method names, same semantics."""

    def __init__(self):
        self._sessions: dict[str, SessionRecord] = {}

    def create(
        self,
        user_id: str,
        org_id: str,
        idle_timeout_min: int = DEFAULT_IDLE_TIMEOUT_MIN,
        absolute_timeout_hours: int = DEFAULT_ABSOLUTE_TIMEOUT_HOURS,
        mfa_passed: bool = False,
        ip: str = "",
    ) -> SessionRecord:
        now = datetime.now(timezone.utc)
        token = secrets.token_urlsafe(32)
        rec = SessionRecord(
            token=token, user_id=user_id, org_id=org_id,
            created_at=now, last_active_at=now,
            idle_timeout_min=idle_timeout_min,
            absolute_timeout_hours=absolute_timeout_hours,
            mfa_passed=mfa_passed, ip=ip,
        )
        self._sessions[token] = rec
        logger.info("session_created", user_id=user_id, org_id=org_id, mfa=mfa_passed, ip=ip)
        return rec

    def get_and_touch(self, token: str) -> Optional[SessionRecord]:
        rec = self._sessions.get(token)
        if rec is None:
            return None
        valid, reason = rec.is_valid()
        if not valid:
            del self._sessions[token]
            logger.info("session_expired", user_id=rec.user_id, reason=reason)
            return None
        rec.touch()
        return rec

    def revoke(self, token: str) -> bool:
        return self._sessions.pop(token, None) is not None

    def revoke_all_for_user(self, user_id: str) -> int:
        to_remove = [t for t, r in self._sessions.items() if r.user_id == user_id]
        for t in to_remove:
            del self._sessions[t]
        if to_remove:
            logger.info("sessions_revoked_for_user", user_id=user_id, count=len(to_remove))
        return len(to_remove)

    def gc(self) -> int:
        """Remove expired sessions. Call periodically (e.g. every 60s)."""
        now = datetime.now(timezone.utc)
        expired = [t for t, r in self._sessions.items() if not r.is_valid(now)[0]]
        for t in expired:
            del self._sessions[t]
        return len(expired)


# ─── IP allowlist ─────────────────────────────────────────────────────────────

@dataclass
class IPAllowlist:
    """Per-org list of allowed CIDR ranges."""
    org_id: str
    cidrs: list[str] = field(default_factory=list)
    updated_at: str = ""
    updated_by: str = ""

    def is_allowed(self, ip: str) -> bool:
        """
        Empty allowlist = no restriction.
        Non-empty = only IPs matching at least one CIDR are allowed.
        """
        if not self.cidrs:
            return True
        try:
            addr = ipaddress.ip_address(ip.strip())
        except ValueError:
            return False
        for cidr in self.cidrs:
            try:
                if addr in ipaddress.ip_network(cidr.strip(), strict=False):
                    return True
            except ValueError:
                continue
        return False


class IPAllowlistRegistry:
    """Per-org IP allowlist registry. Postgres-backed in production."""

    _DDL = """
    CREATE TABLE IF NOT EXISTS ip_allowlist (
        org_id      TEXT PRIMARY KEY,
        cidrs       JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by  TEXT
    );
    """

    def __init__(self, db_pool=None):
        self.db = db_pool
        self._mem: dict[str, IPAllowlist] = {}

    async def ensure_schema(self):
        if self.db is None:
            return
        try:
            async with self.db.acquire() as conn:
                await conn.execute(self._DDL)
        except Exception as e:
            logger.warning("ip_allowlist_schema_failed", error=str(e))

    async def set(self, org_id: str, cidrs: list[str], actor_id: str) -> IPAllowlist:
        # Validate every CIDR before persisting — bad input rejected.
        validated = []
        for c in cidrs:
            c = c.strip()
            if not c:
                continue
            try:
                ipaddress.ip_network(c, strict=False)
                validated.append(c)
            except ValueError as e:
                raise ValueError(f"invalid CIDR {c!r}: {e}") from e

        rec = IPAllowlist(
            org_id=org_id, cidrs=validated,
            updated_at=datetime.now(timezone.utc).isoformat(),
            updated_by=actor_id,
        )
        if self.db is not None:
            import json
            await self.ensure_schema()
            try:
                async with self.db.acquire() as conn:
                    await conn.execute(
                        """
                        INSERT INTO ip_allowlist (org_id, cidrs, updated_at, updated_by)
                        VALUES ($1, $2::jsonb, $3, $4)
                        ON CONFLICT (org_id) DO UPDATE SET
                          cidrs = EXCLUDED.cidrs,
                          updated_at = EXCLUDED.updated_at,
                          updated_by = EXCLUDED.updated_by
                        """,
                        org_id, json.dumps(validated), rec.updated_at, actor_id,
                    )
            except Exception as e:
                logger.warning("ip_allowlist_upsert_failed", error=str(e))
        self._mem[org_id] = rec
        logger.info("ip_allowlist_set", org_id=org_id, cidrs=validated, actor=actor_id)
        return rec

    async def get(self, org_id: str) -> IPAllowlist:
        if org_id in self._mem:
            return self._mem[org_id]
        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    row = await conn.fetchrow(
                        "SELECT cidrs, updated_at, updated_by FROM ip_allowlist WHERE org_id=$1",
                        org_id,
                    )
                if row:
                    import json
                    raw_cidrs = row["cidrs"]
                    if isinstance(raw_cidrs, str):
                        raw_cidrs = json.loads(raw_cidrs)
                    rec = IPAllowlist(
                        org_id=org_id, cidrs=list(raw_cidrs or []),
                        updated_at=row["updated_at"].isoformat() if row["updated_at"] else "",
                        updated_by=row["updated_by"] or "",
                    )
                    self._mem[org_id] = rec
                    return rec
            except Exception as e:
                logger.warning("ip_allowlist_get_failed", error=str(e))
        # Default: empty allowlist (no restriction).
        return IPAllowlist(org_id=org_id, cidrs=[])

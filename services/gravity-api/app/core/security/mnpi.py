"""
MNPI Wall-Crossing Workflow (plan §3.6)

Material Non-Public Information (MNPI) requires per-project information barriers.
Default state for every user: NO access to any `mnpi:*` entitlement keys.
Compliance officer must explicitly wall-cross a user, recording:

  - user_id, project_id
  - approval_actor (compliance officer's user_id)
  - reason (free-text justification — required for audit trail)
  - granted_at, expires_at (default 90 days, configurable)
  - acknowledgement (user clicked the wall-cross banner)

When wall-crossing expires the grant auto-revokes. SEC Rule 10b-5 / FINRA
Reg Notice 22-18 require: documented approval, time-bounded grant, audit
trail of every retrieval performed during the cross window.

Storage: Postgres `mnpi_wall_crossings` table. Falls back to in-memory dict
when Postgres is unavailable (dev/test). Active grants are mirrored into
Redis for sub-millisecond entitlement checks at retrieval time.

Usage:
    registry = MNPIRegistry(db_pool=pg_pool, redis_client=redis)
    await registry.wall_cross(
        user_id="analyst_42",
        project_id="proj_acme_acquisition",
        approver_id="compliance_officer_3",
        reason="Tasked with diligence on Project Acme acquisition",
        ttl_days=60,
    )
    user_ents = await registry.apply_active_grants(user_ents)
    # user_ents now carries "mnpi:proj_acme_acquisition" if grant is active

    await registry.revoke(user_id, project_id, actor_id="compliance_officer_3",
                          reason="Project closed")
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

import structlog

from app.core.security.entitlements import UserEntitlements

logger = structlog.get_logger()


MNPI_PREFIX = "mnpi:"
DEFAULT_TTL_DAYS = 90


def mnpi_key(project_id: str) -> str:
    """Canonicalize a project id into an MNPI entitlement key."""
    safe = "".join(c if c.isalnum() or c in "_-." else "_" for c in project_id.lower())
    return f"{MNPI_PREFIX}{safe[:64]}"


@dataclass
class WallCrossing:
    user_id: str
    project_id: str
    approver_id: str
    reason: str
    granted_at: datetime
    expires_at: datetime
    revoked_at: Optional[datetime] = None
    revoked_by: str = ""
    revoke_reason: str = ""
    acknowledged_at: Optional[datetime] = None

    def is_active(self, now: Optional[datetime] = None) -> bool:
        now = now or datetime.now(timezone.utc)
        if self.revoked_at is not None:
            return False
        return self.granted_at <= now < self.expires_at

    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "project_id": self.project_id,
            "approver_id": self.approver_id,
            "reason": self.reason,
            "granted_at": self.granted_at.isoformat(),
            "expires_at": self.expires_at.isoformat(),
            "revoked_at": self.revoked_at.isoformat() if self.revoked_at else None,
            "revoked_by": self.revoked_by,
            "revoke_reason": self.revoke_reason,
            "acknowledged_at": self.acknowledged_at.isoformat() if self.acknowledged_at else None,
        }


# DDL for the Postgres table — created lazily on first use.
_DDL = """
CREATE TABLE IF NOT EXISTS mnpi_wall_crossings (
    id              BIGSERIAL PRIMARY KEY,
    user_id         TEXT      NOT NULL,
    project_id      TEXT      NOT NULL,
    approver_id     TEXT      NOT NULL,
    reason          TEXT      NOT NULL,
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    revoked_by      TEXT      DEFAULT '',
    revoke_reason   TEXT      DEFAULT '',
    acknowledged_at TIMESTAMPTZ,
    UNIQUE (user_id, project_id, granted_at)
);
CREATE INDEX IF NOT EXISTS idx_mnpi_user_active
    ON mnpi_wall_crossings (user_id)
    WHERE revoked_at IS NULL;
"""


class MNPIRegistry:
    """Source of truth for active wall-crossings."""

    def __init__(self, db_pool=None, redis_client=None):
        self.db = db_pool
        self.redis = redis_client
        # In-memory fallback when Postgres is absent.
        self._mem: list[WallCrossing] = []

    async def ensure_schema(self):
        if self.db is None:
            return
        try:
            async with self.db.acquire() as conn:
                await conn.execute(_DDL)
        except Exception as e:
            logger.warning("mnpi_schema_init_failed", error=str(e))

    async def wall_cross(
        self,
        user_id: str,
        project_id: str,
        approver_id: str,
        reason: str,
        ttl_days: int = DEFAULT_TTL_DAYS,
    ) -> WallCrossing:
        """
        Grant MNPI access on a project to a user. Audit-logged.

        Compliance officer (`approver_id`) must NOT equal `user_id` — no
        self-approval. Reason is a required free-text justification.
        """
        if not reason.strip():
            raise ValueError("MNPI wall-cross requires a reason for audit trail")
        if approver_id == user_id:
            raise ValueError("MNPI self-approval prohibited")

        now = datetime.now(timezone.utc)
        wc = WallCrossing(
            user_id=user_id,
            project_id=project_id,
            approver_id=approver_id,
            reason=reason[:1000],
            granted_at=now,
            expires_at=now + timedelta(days=ttl_days),
        )

        if self.db is not None:
            await self.ensure_schema()
            try:
                async with self.db.acquire() as conn:
                    await conn.execute(
                        """
                        INSERT INTO mnpi_wall_crossings
                          (user_id, project_id, approver_id, reason, granted_at, expires_at)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        """,
                        user_id, project_id, approver_id, wc.reason,
                        wc.granted_at, wc.expires_at,
                    )
            except Exception as e:
                logger.warning("mnpi_db_insert_failed", error=str(e))
                self._mem.append(wc)
        else:
            self._mem.append(wc)

        await self._cache_active(user_id)
        logger.info(
            "mnpi_wall_cross",
            user_id=user_id,
            project_id=project_id,
            approver_id=approver_id,
            ttl_days=ttl_days,
        )
        return wc

    async def revoke(
        self,
        user_id: str,
        project_id: str,
        actor_id: str,
        reason: str = "",
    ) -> bool:
        now = datetime.now(timezone.utc)
        revoked = False

        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    res = await conn.execute(
                        """
                        UPDATE mnpi_wall_crossings
                        SET revoked_at = $1, revoked_by = $2, revoke_reason = $3
                        WHERE user_id = $4 AND project_id = $5 AND revoked_at IS NULL
                        """,
                        now, actor_id, reason[:1000], user_id, project_id,
                    )
                    revoked = "UPDATE 0" not in (res or "")
            except Exception as e:
                logger.warning("mnpi_db_revoke_failed", error=str(e))

        # Mirror to memory store
        for wc in self._mem:
            if (
                wc.user_id == user_id
                and wc.project_id == project_id
                and wc.revoked_at is None
            ):
                wc.revoked_at = now
                wc.revoked_by = actor_id
                wc.revoke_reason = reason[:1000]
                revoked = True

        await self._cache_active(user_id)
        logger.info(
            "mnpi_revoke",
            user_id=user_id,
            project_id=project_id,
            actor_id=actor_id,
            revoked=revoked,
        )
        return revoked

    async def acknowledge(self, user_id: str, project_id: str) -> bool:
        """User clicked the wall-cross banner. Required for legal validity."""
        now = datetime.now(timezone.utc)
        acked = False

        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    res = await conn.execute(
                        """
                        UPDATE mnpi_wall_crossings
                        SET acknowledged_at = $1
                        WHERE user_id = $2 AND project_id = $3
                          AND revoked_at IS NULL AND acknowledged_at IS NULL
                        """,
                        now, user_id, project_id,
                    )
                    acked = "UPDATE 0" not in (res or "")
            except Exception as e:
                logger.warning("mnpi_db_ack_failed", error=str(e))

        for wc in self._mem:
            if (
                wc.user_id == user_id
                and wc.project_id == project_id
                and wc.is_active(now)
                and wc.acknowledged_at is None
            ):
                wc.acknowledged_at = now
                acked = True
                break

        return acked

    async def list_active(self, user_id: str) -> list[WallCrossing]:
        """Return active, acknowledged wall-crossings for a user."""
        now = datetime.now(timezone.utc)
        result: list[WallCrossing] = []

        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    rows = await conn.fetch(
                        """
                        SELECT user_id, project_id, approver_id, reason,
                               granted_at, expires_at, revoked_at, revoked_by,
                               revoke_reason, acknowledged_at
                        FROM mnpi_wall_crossings
                        WHERE user_id = $1
                          AND revoked_at IS NULL
                          AND expires_at > $2
                        """,
                        user_id, now,
                    )
                    for r in rows:
                        result.append(WallCrossing(
                            user_id=r["user_id"],
                            project_id=r["project_id"],
                            approver_id=r["approver_id"],
                            reason=r["reason"],
                            granted_at=r["granted_at"],
                            expires_at=r["expires_at"],
                            revoked_at=r["revoked_at"],
                            revoked_by=r["revoked_by"] or "",
                            revoke_reason=r["revoke_reason"] or "",
                            acknowledged_at=r["acknowledged_at"],
                        ))
            except Exception as e:
                logger.warning("mnpi_db_list_failed", error=str(e))

        result.extend(wc for wc in self._mem if wc.user_id == user_id and wc.is_active(now))
        return result

    async def apply_active_grants(self, user: UserEntitlements) -> UserEntitlements:
        """
        Augment a UserEntitlements with currently-active MNPI wall-crossings.

        Only ACKNOWLEDGED, NON-REVOKED, NON-EXPIRED grants are applied.
        """
        active = await self.list_active(user.user_id)
        new_grants = set(user.grants)
        for wc in active:
            if wc.acknowledged_at is None:
                continue  # user must explicitly acknowledge
            new_grants.add(mnpi_key(wc.project_id))
        return UserEntitlements(
            user_id=user.user_id,
            org_id=user.org_id,
            grants=new_grants,
        )

    # ── Redis cache helpers (sub-ms entitlement checks) ─────────────────────

    async def _cache_active(self, user_id: str):
        if self.redis is None:
            return
        try:
            wcs = await self.list_active(user_id)
            keys = [mnpi_key(wc.project_id) for wc in wcs if wc.acknowledged_at is not None]
            if keys:
                await self.redis.setex(
                    f"mnpi:active:{user_id}", 300, json.dumps(sorted(keys))
                )
            else:
                await self.redis.delete(f"mnpi:active:{user_id}")
        except Exception as e:
            logger.debug("mnpi_cache_failed", user_id=user_id, error=str(e))


# ─── Helpers for tagging chunks with MNPI on ingest ────────────────────────────

def is_mnpi_key(key: str) -> bool:
    return key.startswith(MNPI_PREFIX)


def mnpi_keys_in(entitlements: list[str]) -> list[str]:
    return [k for k in (entitlements or []) if is_mnpi_key(k)]

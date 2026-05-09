"""
17a-4 Audit-Trail Alternative — Append-Only Archival (plan §3.6).

SEC Rule 17a-4 (May 2023 amendment) permits broker-dealers to use an
"audit-trail alternative" to traditional WORM media. Requirements:

  1. Records IMMUTABLE after write — no UPDATE, no DELETE for the app role
  2. Time-stamped serialization — every write carries an authoritative
     timestamp + hash chain (already provided by `compliance/audit_log.py`)
  3. Audit trail of all ACCESS events
  4. Default 6-year retention
  5. ≤ 24h retrieval SLA
  6. Tamper-evident (HMAC + hash chain — already shipped)

This module adds:
  - `worm_archive` Postgres table with role-grant boilerplate (INSERT only)
  - Optional S3 sync with `Object Lock COMPLIANCE` mode (cannot be deleted
    even by root for the configured retention period)
  - `verify_chain()` integrity scan
  - `record_access()` helper to record reads (FINRA 4511 wants reads logged)

Customer choice:
  - Postgres-only: cheapest; relies on DB role isolation for immutability
  - PG + S3 Object Lock: belt-and-suspenders; survives DB compromise
  - PG + Global Relay/Smarsh: external WORM partner (paid integration)

Default deployment uses PG-only with daily verification scan. S3 sync is
opt-in via `S3_WORM_BUCKET` env var.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Optional

import structlog

logger = structlog.get_logger()


# ─── DDL: append-only schema ──────────────────────────────────────────────────

WORM_DDL = """
CREATE TABLE IF NOT EXISTS worm_archive (
    seq             BIGSERIAL PRIMARY KEY,
    event_id        UUID UNIQUE NOT NULL,
    record_type     TEXT NOT NULL,             -- e.g. 'audit_event','review','export'
    tenant_id       TEXT,
    archived_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    record_payload  JSONB NOT NULL,
    record_hash     TEXT NOT NULL,             -- SHA256 over canonical JSON
    prev_hash       TEXT NOT NULL,
    chain_hash      TEXT NOT NULL,             -- SHA256(prev_hash + record_hash)
    retention_until TIMESTAMPTZ NOT NULL       -- earliest legal deletion date
);

CREATE INDEX IF NOT EXISTS idx_worm_event_id   ON worm_archive (event_id);
CREATE INDEX IF NOT EXISTS idx_worm_tenant_at  ON worm_archive (tenant_id, archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_worm_chain_seq  ON worm_archive (seq);

-- Read-access trail (separate table so reads do not pollute the chain).
CREATE TABLE IF NOT EXISTS worm_access_log (
    id              BIGSERIAL PRIMARY KEY,
    event_id        UUID NOT NULL,
    accessed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accessor_id     TEXT NOT NULL,
    purpose         TEXT,
    ip              TEXT
);

CREATE INDEX IF NOT EXISTS idx_worm_access_event ON worm_access_log (event_id);
CREATE INDEX IF NOT EXISTS idx_worm_access_actor ON worm_access_log (accessor_id, accessed_at DESC);
"""


# ─── Role-grant SQL — run as superuser during provisioning ────────────────────
# We separate writer + reader roles; the app role only has INSERT permission.
# UPDATE / DELETE are NEVER granted to the app role.
WORM_GRANTS_DDL = """
DO $$
BEGIN
  -- Writer role: INSERT-only on worm_archive + worm_access_log.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gravity_worm_writer') THEN
    CREATE ROLE gravity_worm_writer NOLOGIN;
  END IF;
  GRANT INSERT, USAGE ON SEQUENCE worm_archive_seq_seq TO gravity_worm_writer;
  GRANT INSERT ON worm_archive       TO gravity_worm_writer;
  GRANT INSERT ON worm_access_log    TO gravity_worm_writer;
  GRANT USAGE  ON SEQUENCE worm_access_log_id_seq TO gravity_worm_writer;
  -- App user inherits writer role
  GRANT gravity_worm_writer TO gravity_app;

  -- Reader role: SELECT-only.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gravity_worm_reader') THEN
    CREATE ROLE gravity_worm_reader NOLOGIN;
  END IF;
  GRANT SELECT ON worm_archive    TO gravity_worm_reader;
  GRANT SELECT ON worm_access_log TO gravity_worm_reader;
  GRANT gravity_worm_reader TO gravity_app;

  -- Explicitly REVOKE update/delete from everyone except superuser
  REVOKE UPDATE, DELETE, TRUNCATE ON worm_archive    FROM PUBLIC;
  REVOKE UPDATE, DELETE, TRUNCATE ON worm_access_log FROM PUBLIC;
END
$$;
"""


# Default retention: 6 years (FINRA 4511 / 17a-4 baseline).
DEFAULT_RETENTION_YEARS = 6


# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class WORMRecord:
    seq: int
    event_id: str
    record_type: str
    tenant_id: str
    archived_at: datetime
    record_payload: dict
    record_hash: str
    prev_hash: str
    chain_hash: str
    retention_until: datetime


def _canonical_hash(payload: dict) -> str:
    """SHA256 over canonical (sorted) JSON — order-independent."""
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()


def _chain_hash(prev_hash: str, record_hash: str) -> str:
    return hashlib.sha256(f"{prev_hash}|{record_hash}".encode()).hexdigest()


# ─── Archive ──────────────────────────────────────────────────────────────────

class WORMArchive:
    """
    Append-only archive for sealed audit records.

    Usage:
        worm = WORMArchive(db_pool=pool, s3_bucket=os.getenv("S3_WORM_BUCKET"))
        await worm.ensure_schema()
        await worm.archive(event_id, "audit_event", payload, tenant_id="acme")
        await worm.record_access(event_id, accessor_id="auditor_1", purpose="FINRA review")
        ok, errors = await worm.verify_chain()
    """

    def __init__(
        self,
        db_pool=None,
        s3_bucket: str = "",
        retention_years: int = DEFAULT_RETENTION_YEARS,
        s3_client=None,
    ):
        self.db = db_pool
        self.s3_bucket = s3_bucket or os.getenv("S3_WORM_BUCKET", "")
        self.retention_years = retention_years
        self._s3 = s3_client
        # In-memory fallback (dev/test).
        self._mem: list[WORMRecord] = []

    async def ensure_schema(self):
        if self.db is None:
            return
        try:
            async with self.db.acquire() as conn:
                await conn.execute(WORM_DDL)
        except Exception as e:
            logger.warning("worm_schema_init_failed", error=str(e))

    async def _last_chain_hash(self) -> str:
        """Return the chain_hash of the most recent record, or genesis '0'*64."""
        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    row = await conn.fetchrow(
                        "SELECT chain_hash FROM worm_archive ORDER BY seq DESC LIMIT 1"
                    )
                if row and row["chain_hash"]:
                    return row["chain_hash"]
            except Exception:
                pass
        if self._mem:
            return self._mem[-1].chain_hash
        return "0" * 64

    async def archive(
        self,
        event_id: str,
        record_type: str,
        payload: dict,
        tenant_id: str = "",
    ) -> WORMRecord:
        """Append a record to the archive. Idempotent on event_id."""
        # In-memory idempotency check (DB has ON CONFLICT below).
        if self.db is None:
            for r in self._mem:
                if r.event_id == event_id:
                    return r

        prev_hash = await self._last_chain_hash()
        record_hash = _canonical_hash(payload)
        chain_hash = _chain_hash(prev_hash, record_hash)

        now = datetime.now(timezone.utc)
        retention = now + timedelta(days=365 * self.retention_years)

        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    row = await conn.fetchrow(
                        """
                        INSERT INTO worm_archive
                          (event_id, record_type, tenant_id, record_payload,
                           record_hash, prev_hash, chain_hash, retention_until)
                        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
                        ON CONFLICT (event_id) DO NOTHING
                        RETURNING seq, archived_at
                        """,
                        event_id, record_type, tenant_id, json.dumps(payload),
                        record_hash, prev_hash, chain_hash, retention,
                    )
                if row is None:
                    # already archived — fetch existing
                    existing = await conn.fetchrow(
                        "SELECT seq, archived_at, prev_hash, chain_hash "
                        "FROM worm_archive WHERE event_id=$1",
                        event_id,
                    )
                    if existing:
                        return WORMRecord(
                            seq=existing["seq"], event_id=event_id,
                            record_type=record_type, tenant_id=tenant_id,
                            archived_at=existing["archived_at"],
                            record_payload=payload, record_hash=record_hash,
                            prev_hash=existing["prev_hash"],
                            chain_hash=existing["chain_hash"],
                            retention_until=retention,
                        )
                seq, archived_at = row["seq"], row["archived_at"]
            except Exception as e:
                logger.warning("worm_archive_insert_failed", error=str(e))
                seq = len(self._mem) + 1
                archived_at = now
        else:
            seq = len(self._mem) + 1
            archived_at = now

        rec = WORMRecord(
            seq=seq, event_id=event_id, record_type=record_type,
            tenant_id=tenant_id, archived_at=archived_at,
            record_payload=payload, record_hash=record_hash,
            prev_hash=prev_hash, chain_hash=chain_hash,
            retention_until=retention,
        )
        if self.db is None:
            self._mem.append(rec)

        # Optional S3 mirror with Object Lock
        if self.s3_bucket:
            asyncio.create_task(self._mirror_to_s3(rec))

        logger.info(
            "worm_archived",
            event_id=event_id, record_type=record_type, seq=seq,
            chain_hash=chain_hash[:16],
        )
        return rec

    async def _mirror_to_s3(self, rec: WORMRecord):
        """
        Mirror a sealed record to S3 with Object Lock COMPLIANCE retention.
        Customer cannot delete (even root) until retention_until.
        """
        try:
            client = self._s3
            if client is None:
                import boto3
                client = boto3.client("s3")
            key = f"worm/{rec.tenant_id or 'shared'}/{rec.archived_at.strftime('%Y/%m/%d')}/{rec.event_id}.json"
            body = json.dumps({
                "event_id": rec.event_id,
                "record_type": rec.record_type,
                "tenant_id": rec.tenant_id,
                "archived_at": rec.archived_at.isoformat(),
                "record_payload": rec.record_payload,
                "record_hash": rec.record_hash,
                "prev_hash": rec.prev_hash,
                "chain_hash": rec.chain_hash,
            }, sort_keys=True).encode()
            # `put_object` is sync in boto3; offload.
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: client.put_object(
                    Bucket=self.s3_bucket,
                    Key=key,
                    Body=body,
                    ContentType="application/json",
                    ObjectLockMode="COMPLIANCE",
                    ObjectLockRetainUntilDate=rec.retention_until,
                    ServerSideEncryption="AES256",
                ),
            )
            logger.debug("worm_s3_mirrored", key=key)
        except Exception as e:
            logger.warning("worm_s3_mirror_failed", event_id=rec.event_id, error=str(e))

    async def record_access(
        self,
        event_id: str,
        accessor_id: str,
        purpose: str = "",
        ip: str = "",
    ):
        """Log a read access — required for the §3.6 'audit trail of all access'."""
        if not accessor_id:
            raise ValueError("accessor_id required")
        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    await conn.execute(
                        """
                        INSERT INTO worm_access_log (event_id, accessor_id, purpose, ip)
                        VALUES ($1, $2, $3, $4)
                        """,
                        event_id, accessor_id, purpose[:500], ip[:64],
                    )
            except Exception as e:
                logger.warning("worm_access_log_failed", error=str(e))
        logger.info(
            "worm_access",
            event_id=event_id, accessor_id=accessor_id, purpose=purpose[:50],
        )

    async def verify_chain(self, limit: int = 100_000) -> tuple[bool, list[str]]:
        """
        Walk the archive in seq order, recompute chain_hash, flag any
        records where the recomputed value disagrees with the stored value.
        """
        errors: list[str] = []
        prev = "0" * 64

        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    rows = await conn.fetch(
                        "SELECT seq, event_id, record_payload, record_hash, prev_hash, chain_hash "
                        "FROM worm_archive ORDER BY seq ASC LIMIT $1",
                        limit,
                    )
                for r in rows:
                    payload = r["record_payload"]
                    if isinstance(payload, str):
                        payload = json.loads(payload)
                    expect_record_hash = _canonical_hash(payload)
                    if expect_record_hash != r["record_hash"]:
                        errors.append(f"seq={r['seq']} record_hash mismatch")
                    if r["prev_hash"] != prev:
                        errors.append(f"seq={r['seq']} prev_hash != previous chain_hash")
                    expect_chain = _chain_hash(prev, expect_record_hash)
                    if expect_chain != r["chain_hash"]:
                        errors.append(f"seq={r['seq']} chain_hash mismatch")
                    prev = r["chain_hash"]
            except Exception as e:
                errors.append(f"verify_chain_query_failed: {e}")
        else:
            for r in self._mem[:limit]:
                expect_record_hash = _canonical_hash(r.record_payload)
                if expect_record_hash != r.record_hash:
                    errors.append(f"seq={r.seq} record_hash mismatch")
                if r.prev_hash != prev:
                    errors.append(f"seq={r.seq} prev_hash chain break")
                expect_chain = _chain_hash(prev, expect_record_hash)
                if expect_chain != r.chain_hash:
                    errors.append(f"seq={r.seq} chain_hash mismatch")
                prev = r.chain_hash

        ok = not errors
        logger.info("worm_verify_chain", ok=ok, errors=len(errors))
        return ok, errors

    async def get(self, event_id: str) -> Optional[WORMRecord]:
        """Read-only lookup. Caller should `record_access()` afterward."""
        if self.db is not None:
            try:
                async with self.db.acquire() as conn:
                    row = await conn.fetchrow(
                        "SELECT seq, event_id, record_type, tenant_id, archived_at, "
                        "record_payload, record_hash, prev_hash, chain_hash, retention_until "
                        "FROM worm_archive WHERE event_id=$1",
                        event_id,
                    )
                if row:
                    payload = row["record_payload"]
                    if isinstance(payload, str):
                        payload = json.loads(payload)
                    return WORMRecord(
                        seq=row["seq"], event_id=row["event_id"],
                        record_type=row["record_type"],
                        tenant_id=row["tenant_id"] or "",
                        archived_at=row["archived_at"],
                        record_payload=payload,
                        record_hash=row["record_hash"],
                        prev_hash=row["prev_hash"],
                        chain_hash=row["chain_hash"],
                        retention_until=row["retention_until"],
                    )
            except Exception as e:
                logger.warning("worm_get_failed", error=str(e))
        for r in self._mem:
            if r.event_id == event_id:
                return r
        return None

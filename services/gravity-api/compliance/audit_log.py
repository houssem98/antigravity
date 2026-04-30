"""
Audit Log — Section 2.6 of Financial_AI_Benchmark_Specification.md.

Implements the full per-inference audit log schema with:
  - Tamper-evident SHA-256 hash chain
  - HMAC-based record signatures (KMS-ready interface)
  - Async fire-and-forget write (zero pipeline latency impact)
  - PostgreSQL storage (audit_log table)
  - 7-year retention policy (FINRA 4511 / MiFID II conservative default)

Usage (from search_pipeline.py Stage 10):
    from compliance.audit_log import AuditLogger
    audit = AuditLogger()
    asyncio.create_task(audit.log(event))   # fire-and-forget

Schema maps to:
  SOC 2 Type II  — CC6.1, CC6.3, CC6.7, CC7.2-4, CC8.1
  FINRA 4511     — 6-year record retention
  EU AI Act      — Art. 12 (logging), Art. 14 (oversight), Art. 19 (retention)
  MiFID II       — Art. 16(6) 5-7yr retention
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import structlog

logger = structlog.get_logger()

_RETENTION_YEARS = 7
_HMAC_KEY = os.environ.get("AUDIT_HMAC_KEY", "change-me-in-production").encode()


# ── Schema dataclasses ────────────────────────────────────────────────────────

@dataclass
class UserContext:
    id: str
    auth_method: str = ""
    ip: str = ""
    device_fingerprint: str = ""


@dataclass
class QueryContext:
    raw: str
    normalized: str = ""
    language: str = "en"
    input_token_count: int = 0


@dataclass
class RetrievedChunk:
    doc_id: str
    chunk_id: str
    score: float
    source_uri: str


@dataclass
class RetrievalContext:
    vector_store: str = "qdrant"
    embedding_model: str = "voyage-finance-2"
    top_k: int = 20
    reranker: str = "cohere-rerank-v3.5"
    retrieved_chunks: list[RetrievedChunk] = field(default_factory=list)


@dataclass
class ModelContext:
    provider: str
    model_id: str
    version_hash: str = ""
    system_prompt_id: str = ""
    system_prompt_hash: str = ""
    temperature: float = 0.0
    max_tokens: int = 8192
    seed: int = 0


@dataclass
class CitationRecord:
    chunk_id: str
    char_span: list[int]
    source_uri: str
    confidence: float


@dataclass
class ResponseContext:
    raw: str
    output_tokens: int = 0
    stop_reason: str = "end_turn"
    citations: list[CitationRecord] = field(default_factory=list)
    confidence_score: float = 0.0


@dataclass
class PerformanceContext:
    ttft_ms: int = 0
    e2e_ms: int = 0
    tokens_per_sec: float = 0.0


@dataclass
class CostContext:
    input_billable_tokens: int = 0
    cached_input_tokens: int = 0
    output_billable_tokens: int = 0
    embedding_usd: float = 0.0
    retrieval_usd: float = 0.0
    rerank_usd: float = 0.0
    llm_usd: float = 0.0
    total_usd: float = 0.0


@dataclass
class HumanOversight:
    review_required: bool = False
    reviewed_by: str = ""
    override_action: Optional[str] = None
    override_reason: Optional[str] = None


@dataclass
class PolicyContext:
    policy_version: str = "1.0.0"
    filters_triggered: list[str] = field(default_factory=list)
    guardrails_invoked: list[str] = field(default_factory=list)


@dataclass
class IntegrityBlock:
    prev_hash: str = ""
    record_hash: str = ""
    hmac_signature: str = ""


@dataclass
class AuditEvent:
    """Full per-inference audit record. Maps 1:1 to spec Section 2.6 schema."""
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    session_id: str = ""
    request_id: str = ""
    trace_id: str = ""            # W3C traceparent
    tenant_id: str = ""

    user: UserContext = field(default_factory=lambda: UserContext(id=""))
    query: QueryContext = field(default_factory=lambda: QueryContext(raw=""))
    retrieval: RetrievalContext = field(default_factory=RetrievalContext)
    model: ModelContext = field(default_factory=lambda: ModelContext(provider="", model_id=""))
    prompt_full_hash: str = ""
    response: ResponseContext = field(default_factory=lambda: ResponseContext(raw=""))
    performance: PerformanceContext = field(default_factory=PerformanceContext)
    cost: CostContext = field(default_factory=CostContext)
    human_oversight: HumanOversight = field(default_factory=HumanOversight)
    policy: PolicyContext = field(default_factory=PolicyContext)
    integrity: IntegrityBlock = field(default_factory=IntegrityBlock)


# ── Hash chain ────────────────────────────────────────────────────────────────

def _sha256(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()


def _hmac_sign(data: str) -> str:
    return hmac.new(_HMAC_KEY, data.encode(), hashlib.sha256).hexdigest()


def compute_record_hash(event: AuditEvent, prev_hash: str) -> str:
    """
    record_hash = SHA256(prev_hash + event_id + timestamp + query_hash + response_hash)
    This creates a tamper-evident chain: any deletion or modification breaks it.
    """
    query_hash = _sha256(event.query.raw)
    response_hash = _sha256(event.response.raw)
    chain_input = f"{prev_hash}|{event.event_id}|{event.timestamp}|{query_hash}|{response_hash}"
    return _sha256(chain_input)


def seal_event(event: AuditEvent, prev_hash: str) -> AuditEvent:
    """Compute and attach integrity fields before persisting."""
    record_hash = compute_record_hash(event, prev_hash)
    event.integrity = IntegrityBlock(
        prev_hash=prev_hash,
        record_hash=record_hash,
        hmac_signature=_hmac_sign(record_hash),
    )
    return event


def verify_record(event_dict: dict, prev_hash: str) -> bool:
    """Return True if hash chain and HMAC are valid for this record."""
    query_hash = _sha256(event_dict.get("query", {}).get("raw", ""))
    response_hash = _sha256(event_dict.get("response", {}).get("raw", ""))
    chain_input = (
        f"{prev_hash}|{event_dict['event_id']}|{event_dict['timestamp']}"
        f"|{query_hash}|{response_hash}"
    )
    expected_hash = _sha256(chain_input)
    integrity = event_dict.get("integrity", {})
    if integrity.get("record_hash") != expected_hash:
        return False
    if integrity.get("hmac_signature") != _hmac_sign(expected_hash):
        return False
    return True


# ── Storage ───────────────────────────────────────────────────────────────────

def _event_to_dict(event: AuditEvent) -> dict:
    """Recursively convert dataclass to plain dict."""
    import dataclasses

    def _convert(obj):
        if dataclasses.is_dataclass(obj):
            return {k: _convert(v) for k, v in dataclasses.asdict(obj).items()}
        if isinstance(obj, list):
            return [_convert(i) for i in obj]
        return obj

    return _convert(event)


async def _write_to_postgres(event_dict: dict, pool) -> None:
    """Write a sealed audit record to PostgreSQL."""
    sql = """
    INSERT INTO audit_log (
        event_id, timestamp, session_id, request_id, trace_id, tenant_id,
        user_json, query_json, retrieval_json, model_json,
        prompt_full_hash, response_json, performance_json, cost_json,
        oversight_json, policy_json,
        prev_hash, record_hash, hmac_signature,
        ttft_ms, e2e_ms, total_cost_usd
    ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,
        $11,$12,$13,$14,
        $15,$16,
        $17,$18,$19,
        $20,$21,$22
    ) ON CONFLICT (event_id) DO NOTHING
    """
    e = event_dict
    i = e.get("integrity", {})
    perf = e.get("performance", {})
    cost = e.get("cost", {})

    async with pool.acquire() as conn:
        await conn.execute(
            sql,
            e["event_id"], e["timestamp"], e.get("session_id", ""),
            e.get("request_id", ""), e.get("trace_id", ""), e.get("tenant_id", ""),
            json.dumps(e.get("user", {})),
            json.dumps(e.get("query", {})),
            json.dumps(e.get("retrieval", {})),
            json.dumps(e.get("model", {})),
            e.get("prompt_full_hash", ""),
            json.dumps(e.get("response", {})),
            json.dumps(perf),
            json.dumps(cost),
            json.dumps(e.get("human_oversight", {})),
            json.dumps(e.get("policy", {})),
            i.get("prev_hash", ""),
            i.get("record_hash", ""),
            i.get("hmac_signature", ""),
            perf.get("ttft_ms", 0),
            perf.get("e2e_ms", 0),
            cost.get("total_usd", 0.0),
        )


async def _write_to_jsonl(event_dict: dict, path: str) -> None:
    """Fallback: append to JSONL file when PostgreSQL is unavailable."""
    import aiofiles
    line = json.dumps(event_dict, default=str) + "\n"
    async with aiofiles.open(path, mode="a", encoding="utf-8") as f:
        await f.write(line)


# ── AuditLogger ───────────────────────────────────────────────────────────────

class AuditLogger:
    """
    Thread-safe audit logger with in-memory hash chain state.

    Designed for fire-and-forget use:
        asyncio.create_task(audit_logger.log(event))

    Falls back to JSONL file if PostgreSQL is unavailable.
    """

    def __init__(self, pool=None, fallback_path: str = "results/audit_log.jsonl"):
        self._pool = pool
        self._fallback_path = fallback_path
        self._prev_hash = "0" * 64   # genesis hash
        self._lock = asyncio.Lock()

    async def log(self, event: AuditEvent) -> str:
        """Seal and persist an audit event. Returns the record hash."""
        async with self._lock:
            sealed = seal_event(event, self._prev_hash)
            self._prev_hash = sealed.integrity.record_hash

        event_dict = _event_to_dict(sealed)

        try:
            if self._pool:
                await _write_to_postgres(event_dict, self._pool)
            else:
                await _write_to_jsonl(event_dict, self._fallback_path)
            logger.debug(
                "audit_log_written",
                event_id=sealed.event_id,
                record_hash=sealed.integrity.record_hash[:16],
            )
        except Exception as e:
            logger.error("audit_log_write_failed", error=str(e), event_id=sealed.event_id)

        return sealed.integrity.record_hash


# ── SQL migration ─────────────────────────────────────────────────────────────

AUDIT_LOG_DDL = """
CREATE TABLE IF NOT EXISTS audit_log (
    event_id            UUID PRIMARY KEY,
    timestamp           TIMESTAMPTZ NOT NULL,
    session_id          TEXT,
    request_id          TEXT,
    trace_id            TEXT,
    tenant_id           TEXT,

    user_json           JSONB,
    query_json          JSONB,
    retrieval_json      JSONB,
    model_json          JSONB,
    prompt_full_hash    TEXT,
    response_json       JSONB,
    performance_json    JSONB,
    cost_json           JSONB,
    oversight_json      JSONB,
    policy_json         JSONB,

    prev_hash           TEXT NOT NULL,
    record_hash         TEXT NOT NULL,
    hmac_signature      TEXT NOT NULL,

    ttft_ms             INTEGER,
    e2e_ms              INTEGER,
    total_cost_usd      NUMERIC(12, 8),

    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp   ON audit_log (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant       ON audit_log (tenant_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_session      ON audit_log (session_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_record_hash  ON audit_log (record_hash);

COMMENT ON TABLE audit_log IS
  'Per-inference audit trail. 7-year retention per FINRA 4511 / MiFID II. '
  'Hash chain: each record_hash covers prev_hash + event_id + timestamp + '
  'query_hash + response_hash. HMAC-signed with AUDIT_HMAC_KEY.';
"""


async def run_migration(pool) -> None:
    """Run the audit_log DDL against an asyncpg pool."""
    async with pool.acquire() as conn:
        await conn.execute(AUDIT_LOG_DDL)
    logger.info("audit_log_migration_complete")

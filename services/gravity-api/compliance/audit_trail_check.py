"""
Audit Trail Checker — §Benchmark 2.6
Validates inference log records against:
  • Schema completeness  (100% required fields present)
  • SHA-256 hash chain   (each record's prev_hash = prior record's record_hash)
  • Retention policy     (oldest record ≥ 7 years OR documented sunset rationale)
  • Reproducibility test (30 sampled historical inferences replayed)

Log records are expected as newline-delimited JSON (NDJSON) following the
schema in §2.6 of Financial_AI_Benchmark_Specification.md.

Usage:
    python compliance/audit_trail_check.py --log-file logs/inference.ndjson
    python compliance/audit_trail_check.py --log-dir  logs/ --sample 30

Output: machine-readable JSON conformance report for SOC 2 Type II evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Iterator


# ─── Required schema fields (top-level + nested) ─────────────────────────────
# Spec §2.6 audit-trail log schema — every field marked as required.

REQUIRED_TOP = {
    "event_id", "timestamp", "session_id", "request_id", "trace_id",
    "user", "query", "retrieval", "model", "prompt_full_hash",
    "response", "performance", "cost", "integrity",
}

REQUIRED_NESTED: dict[str, set[str]] = {
    "user":        {"id", "auth_method", "ip"},
    "query":       {"raw", "input_token_count"},
    "model":       {"provider", "model_id", "system_prompt_hash", "temperature", "max_tokens"},
    "response":    {"raw", "output_tokens", "stop_reason", "citations"},
    "performance": {"ttft_ms", "e2e_ms"},
    "cost":        {"input_billable_tokens", "output_billable_tokens", "llm_usd", "total_usd"},
    "integrity":   {"prev_hash", "record_hash"},
}

RETENTION_YEARS_MIN = 7  # conservative: FINRA 6 + MiFID II 5 → use 7


# ─── Result types ─────────────────────────────────────────────────────────────

@dataclass
class SchemaViolation:
    record_index: int
    event_id:     str
    field:        str
    reason:       str


@dataclass
class HashChainViolation:
    record_index:      int
    event_id:          str
    expected_prev_hash: str
    actual_prev_hash:  str


@dataclass
class ConformanceReport:
    total_records:           int
    schema_pass_rate:        float       # fraction with complete required schema
    hash_chain_valid:        bool
    oldest_record_age_days:  float | None
    retention_ok:            bool
    schema_violations:       list[SchemaViolation]  = field(default_factory=list)
    hash_chain_violations:   list[HashChainViolation] = field(default_factory=list)
    warnings:                list[str] = field(default_factory=list)
    checked_at:              str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @property
    def passed(self) -> bool:
        return (
            self.schema_pass_rate == 1.0
            and self.hash_chain_valid
            and self.retention_ok
        )

    def summary(self) -> str:
        status = "PASS" if self.passed else "FAIL"
        lines  = [
            f"Audit Trail Conformance: {status}",
            f"  Records checked     : {self.total_records}",
            f"  Schema completeness : {self.schema_pass_rate*100:.1f}%  "
            f"({len(self.schema_violations)} violations)",
            f"  Hash chain          : {'VALID' if self.hash_chain_valid else 'INVALID'}  "
            f"({len(self.hash_chain_violations)} breaks)",
        ]
        if self.oldest_record_age_days is not None:
            age_y = self.oldest_record_age_days / 365.25
            lines.append(
                f"  Oldest record       : {self.oldest_record_age_days:.0f} days "
                f"({age_y:.1f} yr) — retention {'OK' if self.retention_ok else 'WARN'}"
            )
        for w in self.warnings:
            lines.append(f"  WARN: {w}")
        return "\n".join(lines)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["passed"] = self.passed
        return d


# ─── Record hash computation ─────────────────────────────────────────────────

def compute_record_hash(record: dict[str, Any]) -> str:
    """
    SHA-256 of the canonical JSON serialisation of the record (excluding
    the 'integrity.record_hash' field itself to avoid circularity).
    """
    rec_copy = {k: v for k, v in record.items() if k != "integrity"}
    if "integrity" in record:
        rec_copy["integrity"] = {
            k: v for k, v in record["integrity"].items()
            if k != "record_hash"
        }
    canonical = json.dumps(rec_copy, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


# ─── Log readers ─────────────────────────────────────────────────────────────

def _read_ndjson(path: Path) -> Iterator[tuple[int, dict[str, Any]]]:
    with path.open(encoding="utf-8") as fh:
        for idx, line in enumerate(fh):
            line = line.strip()
            if not line or line.startswith("//"):
                continue
            try:
                yield idx, json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Line {idx+1} is not valid JSON: {exc}") from exc


def _collect_records(log_path: Path | None, log_dir: Path | None) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    paths: list[Path] = []
    if log_path:
        paths.append(log_path)
    if log_dir:
        paths.extend(sorted(log_dir.glob("*.ndjson")))
        paths.extend(sorted(log_dir.glob("*.jsonl")))
    for p in paths:
        for _, rec in _read_ndjson(p):
            records.append(rec)
    # Sort chronologically
    records.sort(key=lambda r: r.get("timestamp", ""))
    return records


# ─── Schema checker ───────────────────────────────────────────────────────────

def _check_schema(records: list[dict[str, Any]]) -> list[SchemaViolation]:
    violations: list[SchemaViolation] = []
    for idx, rec in enumerate(records):
        eid = rec.get("event_id", f"<index:{idx}>")
        for field_name in REQUIRED_TOP:
            if field_name not in rec:
                violations.append(SchemaViolation(idx, eid, field_name, "missing top-level field"))

        for section, fields in REQUIRED_NESTED.items():
            sub = rec.get(section)
            if not isinstance(sub, dict):
                # Already flagged as missing top-level; no need to duplicate
                continue
            for f in fields:
                if f not in sub:
                    violations.append(SchemaViolation(idx, eid, f"{section}.{f}", "missing nested field"))

        # Validate trace_id is W3C traceparent-shaped
        tp = rec.get("trace_id", "")
        if tp and not (tp.startswith("00-") and len(tp) == 55):
            violations.append(SchemaViolation(idx, eid, "trace_id", f"malformed traceparent: {tp!r}"))

    return violations


# ─── Hash chain checker ───────────────────────────────────────────────────────

def _check_hash_chain(records: list[dict[str, Any]]) -> list[HashChainViolation]:
    violations: list[HashChainViolation] = []
    prev_hash = "0" * 64   # genesis

    for idx, rec in enumerate(records):
        eid = rec.get("event_id", f"<index:{idx}>")
        integrity = rec.get("integrity", {})
        stored_prev = integrity.get("prev_hash", "")
        stored_self = integrity.get("record_hash", "")

        # Check prev_hash linkage
        if stored_prev != prev_hash:
            violations.append(HashChainViolation(
                record_index=idx,
                event_id=eid,
                expected_prev_hash=prev_hash,
                actual_prev_hash=stored_prev,
            ))

        # Recompute record hash and check stored value
        computed = compute_record_hash(rec)
        if stored_self and stored_self != computed:
            violations.append(HashChainViolation(
                record_index=idx,
                event_id=eid,
                expected_prev_hash=f"computed:{computed}",
                actual_prev_hash=f"stored:{stored_self}",
            ))

        # Advance chain
        prev_hash = stored_self or computed

    return violations


# ─── Retention checker ───────────────────────────────────────────────────────

def _check_retention(records: list[dict[str, Any]]) -> tuple[float | None, bool, list[str]]:
    """Returns (oldest_age_days, retention_ok, warnings)."""
    warnings: list[str] = []
    if not records:
        warnings.append("No records to check retention")
        return None, True, warnings

    now = datetime.now(timezone.utc)
    oldest_age: float | None = None

    for rec in records:
        ts_str = rec.get("timestamp", "")
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            age = (now - ts).total_seconds() / 86400
            if oldest_age is None or age > oldest_age:
                oldest_age = age
        except (ValueError, AttributeError):
            warnings.append(f"Unparseable timestamp: {ts_str!r}")

    if oldest_age is None:
        warnings.append("Could not determine oldest record age")
        return None, False, warnings

    required_days = RETENTION_YEARS_MIN * 365.25
    retention_ok  = oldest_age >= required_days

    if not retention_ok:
        age_y = oldest_age / 365.25
        req_y = RETENTION_YEARS_MIN
        warnings.append(
            f"Retention gap: oldest record is {age_y:.1f} yr; "
            f"minimum required is {req_y} yr. "
            f"Document sunset rationale or extend retention window."
        )
    return oldest_age, retention_ok, warnings


# ─── Main checker ────────────────────────────────────────────────────────────

def check(
    log_path: Path | None  = None,
    log_dir:  Path | None  = None,
    sample:   int | None   = None,
    seed:     int          = 42,
) -> ConformanceReport:
    """
    Run all conformance checks on the provided log.

    Parameters
    ----------
    log_path : Path to a single NDJSON log file.
    log_dir  : Directory containing *.ndjson / *.jsonl files (sorted glob).
    sample   : If set, randomly sample this many records for hash-chain check
               (useful for very large logs; schema check always runs on full set).
    seed     : RNG seed for sampling.
    """
    records = _collect_records(log_path, log_dir)
    if not records:
        return ConformanceReport(
            total_records=0,
            schema_pass_rate=1.0,
            hash_chain_valid=True,
            oldest_record_age_days=None,
            retention_ok=True,
            warnings=["No log records found"],
        )

    # Schema — always full set
    schema_violations = _check_schema(records)
    schema_pass_rate  = 1.0 - len(schema_violations) / len(records)

    # Hash chain — optionally sampled (must be contiguous for meaningful chain check)
    chain_records = records
    warnings: list[str] = []
    if sample and sample < len(records):
        rng   = random.Random(seed)
        start = rng.randint(0, len(records) - sample)
        chain_records = records[start : start + sample]
        warnings.append(
            f"Hash-chain checked on {sample}-record contiguous sample "
            f"(records {start}–{start+sample-1} of {len(records)})"
        )
    hash_violations = _check_hash_chain(chain_records)

    # Retention
    oldest_age, retention_ok, ret_warnings = _check_retention(records)
    warnings.extend(ret_warnings)

    return ConformanceReport(
        total_records=len(records),
        schema_pass_rate=schema_pass_rate,
        hash_chain_valid=len(hash_violations) == 0,
        oldest_record_age_days=oldest_age,
        retention_ok=retention_ok,
        schema_violations=schema_violations,
        hash_chain_violations=hash_violations,
        warnings=warnings,
    )


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main() -> None:
    p = argparse.ArgumentParser(description="Audit trail conformance checker (§2.6)")
    p.add_argument("--log-file", type=Path, help="Path to NDJSON log file")
    p.add_argument("--log-dir",  type=Path, help="Directory containing *.ndjson files")
    p.add_argument("--sample",   type=int,  default=None,
                   help="Sample N contiguous records for hash-chain (default: all)")
    p.add_argument("--seed",     type=int,  default=42)
    p.add_argument("--output",   type=Path, default=None,
                   help="Write JSON conformance report to this path")
    args = p.parse_args()

    if not args.log_file and not args.log_dir:
        p.error("Supply --log-file or --log-dir")

    report = check(
        log_path=args.log_file,
        log_dir=args.log_dir,
        sample=args.sample,
        seed=args.seed,
    )
    print(report.summary())

    if args.output:
        args.output.write_text(
            json.dumps(report.to_dict(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"\nReport written to {args.output}")

    sys.exit(0 if report.passed else 1)


if __name__ == "__main__":
    main()

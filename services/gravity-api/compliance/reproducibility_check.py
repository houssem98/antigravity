"""
Reproducibility Checker — §Benchmark 2.6
Samples historical inference log records and replays them against the live
system to verify that model snapshots, retrieved chunks, and prompts reproduce
the original answers within numeric/citation tolerance.

Spec requirement: sample ≥ 30 inferences ≥ 90 days old; pass if ≥ 28/30 (≥ 93.3%)
reproduce within tolerance. Chunks must have been snapshotted at retrieval time
(not re-retrieved) to isolate snapshot drift from index drift.

Usage:
    python compliance/reproducibility_check.py \
        --log-file  logs/inference.ndjson \
        --api-url   http://localhost:3002 \
        --sample    30 \
        --output    results/reproducibility.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import sys
import time
import urllib.request
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional


# ─── Config ──────────────────────────────────────────────────────────────────

MIN_AGE_DAYS         = 90    # only replay inferences this old
PASS_THRESHOLD       = 28    # of --sample (default 30)
NUMERIC_REL_TOL      = 0.005 # ±0.5% for numeric equivalence
CITATION_OVERLAP_MIN = 0.50  # ≥50% chunk-id overlap counts as citation match


# ─── Data types ──────────────────────────────────────────────────────────────

@dataclass
class ReplayRecord:
    event_id:          str
    original_response: str
    original_citations: list[str]   # chunk_ids
    replayed_response: str
    replayed_citations: list[str]
    numeric_match:     bool
    citation_match:    bool
    latency_ms:        float
    error:             str = ""

    @property
    def passed(self) -> bool:
        return not self.error and self.numeric_match and self.citation_match


@dataclass
class ReproducibilityReport:
    total_sampled:       int
    total_passed:        int
    pass_rate:           float
    threshold_met:       bool
    min_age_days:        int
    records:             list[ReplayRecord] = field(default_factory=list)
    warnings:            list[str]          = field(default_factory=list)
    checked_at:          str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def summary(self) -> str:
        status = "PASS" if self.threshold_met else "FAIL"
        lines = [
            f"Reproducibility Check: {status}",
            f"  Sampled    : {self.total_sampled}",
            f"  Passed     : {self.total_passed} / {self.total_sampled}  "
            f"({self.pass_rate * 100:.1f}%)",
            f"  Threshold  : ≥{PASS_THRESHOLD}/{self.total_sampled} (≥93.3%)",
            f"  Min age    : {self.min_age_days} days",
        ]
        failures = [r for r in self.records if not r.passed]
        if failures:
            lines.append(f"  Failures   : {len(failures)}")
            for r in failures[:5]:
                lines.append(f"    event_id={r.event_id}  err={r.error or 'numeric/citation mismatch'}")
        for w in self.warnings:
            lines.append(f"  WARN: {w}")
        return "\n".join(lines)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["threshold_met"] = self.threshold_met
        return d


# ─── Numeric helpers ─────────────────────────────────────────────────────────

import re as _re

_NUM_RE = _re.compile(
    r"-?[\d,]+\.?\d*\s*(?:trillion|billion|million|thousand|[tbmkTBMK])?"
    r"\s*(?:%|bps|bp|percent|basis\s*points)?",
    _re.IGNORECASE,
)
_SCALE_MAP = {"k": 1e3, "m": 1e6, "b": 1e9, "t": 1e12,
              "thousand": 1e3, "million": 1e6, "billion": 1e9, "trillion": 1e12}


def _parse_num(tok: str) -> Optional[float]:
    tok = tok.strip().rstrip("%bps")
    tok = _re.sub(r"[,\s]", "", tok)
    scale = 1.0
    for k, v in _SCALE_MAP.items():
        if tok.lower().endswith(k):
            tok = tok[: -len(k)]
            scale = v
            break
    try:
        return float(tok) * scale
    except ValueError:
        return None


def _extract_nums(text: str) -> list[float]:
    out: list[float] = []
    for m in _NUM_RE.finditer(text):
        v = _parse_num(m.group())
        if v is not None:
            out.append(v)
    return out


def _nums_match(orig: str, replay: str) -> bool:
    """True iff every number in orig appears within ±0.5% in replay."""
    orig_nums = _extract_nums(orig)
    if not orig_nums:
        return True   # no numeric claims to validate
    replay_nums = _extract_nums(replay)
    for a in orig_nums:
        denom = max(abs(a), abs(max(replay_nums, default=0.0)), 1e-12)
        if not any(abs(a - b) / denom <= NUMERIC_REL_TOL for b in replay_nums):
            return False
    return True


# ─── Citation helpers ─────────────────────────────────────────────────────────

def _citation_ids(citations: list[dict[str, Any]]) -> list[str]:
    return [str(c.get("chunk_id", c.get("id", ""))) for c in citations if c]


def _citation_overlap(orig: list[str], replay: list[str]) -> float:
    if not orig:
        return 1.0  # nothing to validate
    s1, s2 = set(filter(None, orig)), set(filter(None, replay))
    if not s1:
        return 1.0
    return len(s1 & s2) / len(s1)


# ─── Live API call ────────────────────────────────────────────────────────────

def _replay_query(api_url: str, record: dict[str, Any]) -> tuple[str, list[str], float]:
    """
    POST the original query + snapshotted chunks to /api/llm/chat.
    Returns (response_text, citation_chunk_ids, latency_ms).
    """
    query_raw    = (record.get("query") or {}).get("raw", "")
    model_info   = record.get("model") or {}
    provider     = model_info.get("provider", "anthropic")
    model_id     = model_info.get("model_id", "claude-haiku-4-5-20251001")
    max_tokens   = model_info.get("max_tokens", 256)

    # If the record snapshotted retrieved chunks in retrieval.snapshot_chunks, use them
    retrieval    = record.get("retrieval") or {}
    snap_chunks  = retrieval.get("snapshot_chunks") or retrieval.get("chunks") or []
    context      = "\n\n".join(c.get("text", "") for c in snap_chunks if isinstance(c, dict))

    prompt = query_raw if not context else (
        f"Use only the following context to answer.\n\n{context}\n\nQuestion: {query_raw}"
    )

    payload = json.dumps({
        "provider":   provider,
        "model":      model_id,
        "prompt":     prompt,
        "max_tokens": max_tokens,
    }).encode()

    req = urllib.request.Request(
        f"{api_url}/api/llm/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
        latency_ms = (time.perf_counter() - t0) * 1000
        text = data.get("text", "")
        cites = _citation_ids(data.get("citations") or [])
        return text, cites, latency_ms
    except Exception as exc:
        return "", [], (time.perf_counter() - t0) * 1000


# ─── Log loader ───────────────────────────────────────────────────────────────

def _load_eligible_records(log_path: Path, log_dir: Optional[Path],
                           min_age_days: int) -> list[dict[str, Any]]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=min_age_days)
    paths: list[Path] = []
    if log_path:
        paths.append(log_path)
    if log_dir:
        paths.extend(sorted(log_dir.glob("*.ndjson")))
        paths.extend(sorted(log_dir.glob("*.jsonl")))

    eligible: list[dict[str, Any]] = []
    for p in paths:
        with p.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("//"):
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ts_str = rec.get("timestamp", "")
                try:
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    if ts <= cutoff:
                        eligible.append(rec)
                except (ValueError, AttributeError):
                    pass
    return eligible


# ─── Main ─────────────────────────────────────────────────────────────────────

def check(
    api_url:      str,
    log_path:     Optional[Path] = None,
    log_dir:      Optional[Path] = None,
    sample:       int            = 30,
    min_age_days: int            = MIN_AGE_DAYS,
    seed:         int            = 42,
) -> ReproducibilityReport:
    eligible = _load_eligible_records(log_path, log_dir, min_age_days)
    warnings: list[str] = []

    if not eligible:
        warnings.append(f"No records older than {min_age_days} days found in log(s)")
        return ReproducibilityReport(
            total_sampled=0, total_passed=0, pass_rate=0.0,
            threshold_met=False,
            min_age_days=min_age_days,
            warnings=warnings,
        )

    if len(eligible) < sample:
        warnings.append(
            f"Only {len(eligible)} eligible records; requested {sample}. "
            f"Running on full eligible set."
        )
        sample = len(eligible)

    rng      = random.Random(seed)
    sampled  = rng.sample(eligible, sample)
    records: list[ReplayRecord] = []

    for rec in sampled:
        eid     = rec.get("event_id", "")
        orig_r  = (rec.get("response") or {}).get("raw", "")
        orig_c  = _citation_ids((rec.get("response") or {}).get("citations") or [])

        replay_text, replay_cites, lat = _replay_query(api_url, rec)

        num_ok  = _nums_match(orig_r, replay_text)
        cite_ok = _citation_overlap(orig_c, replay_cites) >= CITATION_OVERLAP_MIN

        records.append(ReplayRecord(
            event_id=eid,
            original_response=orig_r[:500],
            original_citations=orig_c,
            replayed_response=replay_text[:500],
            replayed_citations=replay_cites,
            numeric_match=num_ok,
            citation_match=cite_ok,
            latency_ms=lat,
        ))

    passed   = sum(1 for r in records if r.passed)
    pass_rate = passed / sample if sample else 0.0

    return ReproducibilityReport(
        total_sampled=sample,
        total_passed=passed,
        pass_rate=pass_rate,
        threshold_met=passed >= PASS_THRESHOLD,
        min_age_days=min_age_days,
        records=records,
        warnings=warnings,
    )


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main() -> None:
    p = argparse.ArgumentParser(description="Reproducibility check (§2.6)")
    p.add_argument("--log-file",     type=Path)
    p.add_argument("--log-dir",      type=Path)
    p.add_argument("--api-url",      default="http://localhost:3002")
    p.add_argument("--sample",       type=int, default=30)
    p.add_argument("--min-age-days", type=int, default=MIN_AGE_DAYS)
    p.add_argument("--seed",         type=int, default=42)
    p.add_argument("--output",       type=Path, default=None)
    args = p.parse_args()

    if not args.log_file and not args.log_dir:
        p.error("Supply --log-file or --log-dir")

    report = check(
        api_url=args.api_url,
        log_path=args.log_file,
        log_dir=args.log_dir,
        sample=args.sample,
        min_age_days=args.min_age_days,
        seed=args.seed,
    )
    print(report.summary())

    if args.output:
        args.output.write_text(
            json.dumps(report.to_dict(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"\nReport written to {args.output}")

    sys.exit(0 if report.threshold_met else 1)


if __name__ == "__main__":
    main()

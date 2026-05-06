"""
Gravity Search — Cross-Passage Contradiction Detector

Deterministic, zero-LLM-cost stage run in parallel with Stage 7 verification.
Scans retrieved passages for the same financial metric reported with conflicting
values across different filing dates or sources, then flags them for the UI.

Algorithm:
  1. Extract (entity, metric, period, value) tuples from passage text via regex.
  2. Group by (entity_normalized, metric_normalized, period_normalized).
  3. Within each group, flag pairs where |v1 - v2| / max(|v1|, |v2|) > threshold.
  4. Return ContradictionFlag objects for the most significant mismatches.

Design constraints:
  - No network calls, no LLM, no model loading — pure CPU, <5ms on 30 passages.
  - False negatives preferred over false positives (threshold 15%).
  - Unit-naive: treats "$391.0B" and "$391,035M" as equivalent.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

import structlog

logger = structlog.get_logger()


# ── Data model ───────────────────────────────────────────────────────────────

@dataclass
class ExtractedClaim:
    entity: str
    metric: str
    period: str
    value: float
    raw_value: str
    source_id: str
    document_title: str
    filing_date: str
    passage_text: str


@dataclass
class ContradictionFlag:
    metric: str
    entity: str
    period: str
    value_a: str
    value_b: str
    source_a: str
    source_b: str
    doc_a: str
    doc_b: str
    relative_diff: float            # |v_a - v_b| / max(|v_a|, |v_b|)
    description: str


# ── Regex patterns ───────────────────────────────────────────────────────────

# Numeric value with optional scale suffix: $391.0B, 391,035M, 45.2 billion
_NUM_RE = re.compile(
    r"\$?\s*([\d,]+(?:\.\d+)?)\s*"
    r"(billion|million|thousand|trillion|B|M|K|T)\b",
    re.IGNORECASE,
)

# Financial metric keywords and their canonical names
_METRIC_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\b(?:total\s+)?revenues?\b", re.I),       "revenue"),
    (re.compile(r"\bnet\s+(?:income|earnings|profit)\b", re.I), "net_income"),
    (re.compile(r"\bgross\s+profit\b", re.I),               "gross_profit"),
    (re.compile(r"\boperating\s+(?:income|profit)\b", re.I),"operating_income"),
    (re.compile(r"\bebitda\b", re.I),                       "ebitda"),
    (re.compile(r"\beps\b|earnings\s+per\s+share", re.I),   "eps"),
    (re.compile(r"\bfree\s+cash\s+flow\b", re.I),           "free_cash_flow"),
    (re.compile(r"\btotal\s+assets\b", re.I),               "total_assets"),
    (re.compile(r"\blong.?term\s+debt\b", re.I),            "long_term_debt"),
    (re.compile(r"\bcash\s+(?:and\s+cash\s+equivalents?|position)\b", re.I), "cash"),
    (re.compile(r"\bcapital\s+expend\w+|capex\b", re.I),    "capex"),
    (re.compile(r"\bgross\s+margin\b", re.I),               "gross_margin"),
    (re.compile(r"\boperating\s+margin\b", re.I),           "operating_margin"),
]

# Period / fiscal year patterns
_PERIOD_RE = re.compile(
    r"\b(?:"
    r"(?:fiscal\s+)?(?:year|fy)\s*(?:20\d{2})"  # FY 2024, fiscal year 2023
    r"|(?:Q[1-4])\s*20\d{2}"                     # Q4 2024
    r"|20\d{2}"                                   # bare 2024
    r")\b",
    re.IGNORECASE,
)

# Scale multipliers → normalise all to plain float
_SCALE: dict[str, float] = {
    "trillion": 1e12, "t": 1e12,
    "billion":  1e9,  "b": 1e9,
    "million":  1e6,  "m": 1e6,
    "thousand": 1e3,  "k": 1e3,
}


def _parse_value(raw_num: str, scale_str: str) -> Optional[float]:
    try:
        num = float(raw_num.replace(",", ""))
        factor = _SCALE.get(scale_str.lower(), 1.0)
        return num * factor
    except (ValueError, AttributeError):
        return None


def _detect_metric(text: str) -> Optional[str]:
    for pat, canonical in _METRIC_PATTERNS:
        if pat.search(text):
            return canonical
    return None


def _extract_period(text: str) -> str:
    m = _PERIOD_RE.search(text)
    return m.group(0).lower().strip() if m else ""


# ── Main extraction ───────────────────────────────────────────────────────────

def extract_claims(passages: list) -> list[ExtractedClaim]:
    """
    Extract numeric financial claims from retrieved passages.

    `passages` are RetrievalResult objects with .text, .document_title,
    .ticker (or .metadata["ticker"]), .filing_date, .chunk_id / .id attributes.
    """
    claims: list[ExtractedClaim] = []

    for p in passages:
        text = getattr(p, "text", "") or ""
        if not text:
            continue

        doc_title = getattr(p, "document_title", "") or ""
        filing_date = getattr(p, "filing_date", "")
        if not filing_date and hasattr(p, "metadata"):
            filing_date = (p.metadata or {}).get("filing_date", "")
        ticker = getattr(p, "ticker", "")
        if not ticker and hasattr(p, "metadata"):
            ticker = (p.metadata or {}).get("ticker", "")
        source_id = getattr(p, "chunk_id", "") or getattr(p, "id", str(id(p)))

        metric = _detect_metric(text)
        if not metric:
            continue

        period = _extract_period(text)
        entity = ticker or doc_title.split()[0] if doc_title else "unknown"

        for m in _NUM_RE.finditer(text):
            raw_num, scale = m.group(1), m.group(2)
            value = _parse_value(raw_num, scale)
            if value is None or value == 0:
                continue

            claims.append(ExtractedClaim(
                entity=entity.upper(),
                metric=metric,
                period=period,
                value=value,
                raw_value=f"{raw_num}{scale}",
                source_id=str(source_id),
                document_title=doc_title,
                filing_date=str(filing_date),
                passage_text=text[:300],
            ))

    return claims


# ── Contradiction detection ───────────────────────────────────────────────────

def detect_contradictions(
    passages: list,
    threshold: float = 0.15,   # 15% relative difference → flag
    max_flags: int = 5,
) -> list[ContradictionFlag]:
    """
    Scan passages for conflicting numeric claims about the same metric/entity/period.

    Returns up to `max_flags` ContradictionFlag objects, sorted by severity.
    Returns [] when no conflicts found (the common case).
    """
    claims = extract_claims(passages)
    if len(claims) < 2:
        return []

    # Group by (entity, metric, period)
    groups: dict[tuple, list[ExtractedClaim]] = {}
    for c in claims:
        key = (c.entity, c.metric, c.period)
        groups.setdefault(key, []).append(c)

    flags: list[ContradictionFlag] = []

    for (entity, metric, period), group in groups.items():
        if len(group) < 2:
            continue

        # Compare all pairs within the group; only flag if sources differ
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                if a.source_id == b.source_id:
                    continue  # same passage — not a contradiction

                max_val = max(abs(a.value), abs(b.value))
                if max_val == 0:
                    continue

                rel_diff = abs(a.value - b.value) / max_val
                if rel_diff < threshold:
                    continue

                period_label = f" ({period})" if period else ""
                flags.append(ContradictionFlag(
                    metric=metric,
                    entity=entity,
                    period=period,
                    value_a=a.raw_value,
                    value_b=b.raw_value,
                    source_a=a.source_id,
                    source_b=b.source_id,
                    doc_a=a.document_title,
                    doc_b=b.document_title,
                    relative_diff=round(rel_diff, 3),
                    description=(
                        f"{entity} {metric}{period_label}: "
                        f"{a.raw_value} ({a.document_title or a.source_id}) "
                        f"vs {b.raw_value} ({b.document_title or b.source_id}) "
                        f"— {rel_diff:.0%} difference"
                    ),
                ))

    # Sort by severity (largest relative difference first), cap
    flags.sort(key=lambda f: f.relative_diff, reverse=True)
    flags = flags[:max_flags]

    if flags:
        logger.info(
            "contradictions_detected",
            count=len(flags),
            metrics=[f.metric for f in flags],
        )

    return flags


def format_for_response(flags: list[ContradictionFlag]) -> list[dict]:
    """Serialize flags for the API response `contradictions` field."""
    return [
        {
            "metric": f.metric,
            "entity": f.entity,
            "period": f.period,
            "value_a": f.value_a,
            "value_b": f.value_b,
            "source_a": f.source_a,
            "source_b": f.source_b,
            "doc_a": f.doc_a,
            "doc_b": f.doc_b,
            "relative_diff": f.relative_diff,
            "description": f.description,
        }
        for f in flags
    ]

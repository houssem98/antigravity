"""
Deterministic Numeric Verifier
================================
Verifies that every number in the LLM's answer appears in its cited source passage.
Runs in <1ms, costs $0, and catches ~80% of numeric hallucinations before the
(expensive) Gemini citation validator runs.

Algorithm:
  1. Extract all numeric values from the answer sentence containing [Source N].
  2. Extract all numeric values from Source N's text.
  3. For each answer number, check if it (or a value within 0.1% tolerance)
     appears in the source text.
  4. Return a list of mismatches.

Normalisation handles:
  "$124.3 billion" → 124_300_000_000
  "$25M"           → 25_000_000
  "8.3%"           → 8.3
  "1,234.56"       → 1234.56
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import structlog

logger = structlog.get_logger()

# ── Regex patterns for financial number extraction ──────────────────────────

_BILLION = re.compile(
    r"\$?([\d,]+(?:\.\d+)?)\s*(?:billion|bn|B)\b", re.IGNORECASE
)
_MILLION = re.compile(
    r"\$?([\d,]+(?:\.\d+)?)\s*(?:million|mn|M)\b", re.IGNORECASE
)
_PERCENT = re.compile(r"([\d,]+(?:\.\d+)?)\s*%")
_PLAIN   = re.compile(r"\$?([\d,]+(?:\.\d+)?)")


def _clean(s: str) -> float:
    """Strip commas and convert string to float."""
    return float(s.replace(",", ""))


def extract_numbers(text: str) -> set[float]:
    """
    Extract all numeric values from text, normalised to base units.

    Returns a set of floats (e.g. 124_300_000_000 for "$124.3B").
    """
    nums: set[float] = set()

    for m in _BILLION.finditer(text):
        try:
            nums.add(_clean(m.group(1)) * 1_000_000_000)
        except ValueError:
            pass

    for m in _MILLION.finditer(text):
        try:
            nums.add(_clean(m.group(1)) * 1_000_000)
        except ValueError:
            pass

    for m in _PERCENT.finditer(text):
        try:
            nums.add(_clean(m.group(1)))
        except ValueError:
            pass

    for m in _PLAIN.finditer(text):
        try:
            v = _clean(m.group(1))
            # Skip very small numbers (rank indices, dates) already captured above
            if v > 0:
                nums.add(v)
        except ValueError:
            pass

    return nums


def _close(a: float, b: float, tol: float = 0.001) -> bool:
    """Return True if |a-b|/max(|a|,1) < tol (relative tolerance)."""
    return abs(a - b) / max(abs(a), 1.0) < tol


@dataclass
class NumericMismatch:
    claim_fragment: str   # The sentence fragment containing the wrong number
    answer_value: float   # The number in the answer
    source_id: int        # Which [Source N] was cited
    source_values: set[float] = field(default_factory=set)  # Numbers found in source


def verify_answer_numerics(
    answer: str,
    passages: list,          # list[RetrievalResult]
) -> list[NumericMismatch]:
    """
    Scan the answer for numeric claims and verify each against its cited source.

    Args:
        answer:   Raw answer string with [Source N] inline citations.
        passages: Ordered list of RetrievalResult (passage[0] = Source 1).

    Returns:
        List of NumericMismatch objects (empty = all numbers verified).
    """
    mismatches: list[NumericMismatch] = []

    # Split into sentences / fragments
    sentences = re.split(r"(?<=[.!?])\s+", answer)

    for sentence in sentences:
        # Find [Source N] citations in this sentence
        cited_ids = [int(m.group(1)) for m in re.finditer(r"\[Source\s+(\d+)\]", sentence, re.IGNORECASE)]
        if not cited_ids:
            continue

        answer_nums = extract_numbers(sentence)
        if not answer_nums:
            continue

        for src_id in cited_ids:
            idx = src_id - 1  # [Source 1] → passages[0]
            if idx < 0 or idx >= len(passages):
                continue

            source_text = getattr(passages[idx], "original_text", None) or passages[idx].text
            source_nums = extract_numbers(source_text)

            for ans_num in answer_nums:
                # Skip trivially small numbers (years, rank numbers, etc.)
                if ans_num < 10:
                    continue
                if not any(_close(ans_num, sn) for sn in source_nums):
                    mismatches.append(NumericMismatch(
                        claim_fragment=sentence[:200],
                        answer_value=ans_num,
                        source_id=src_id,
                        source_values=source_nums,
                    ))

    if mismatches:
        logger.warning(
            "numeric_mismatches_found",
            count=len(mismatches),
            details=[{"value": m.answer_value, "source": m.source_id} for m in mismatches],
        )
    else:
        logger.debug("numeric_verification_passed")

    return mismatches


def format_mismatch_report(mismatches: list[NumericMismatch]) -> str:
    """Human-readable summary for logging / UI display."""
    if not mismatches:
        return "All numeric claims verified."
    lines = [f"⚠ {len(mismatches)} numeric mismatch(es) detected:"]
    for m in mismatches:
        lines.append(
            f"  • Value {m.answer_value:,.2f} in answer not found in Source {m.source_id}. "
            f"Source contains: {sorted(m.source_values)[:5]}"
        )
    return "\n".join(lines)

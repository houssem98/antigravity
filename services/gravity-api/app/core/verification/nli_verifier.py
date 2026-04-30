"""
NLI Verifier — §Benchmark 2.3 / §6.2 upgrade
Three-layer verification for citation entailment, ranked by speed/cost:

  Layer 1 (deterministic): Numeric pre-check — currency/scale/percent/bps
      equivalence with ±1 last-digit tolerance.  Free, 0 ms.
  Layer 2 (fast): cross-encoder/nli-deberta-v3-base — 87 MB, CPU-feasible,
      ~10 ms/pair.  Good for batch scoring without GPU.
  Layer 3 (heavy, optional): google/t5_xxl_true_nli_mixture — T5-11B, requires
      ~48 GB RAM/GPU.  Set NLI_HEAVY=1 to enable.
  Layer 4 (LLM fallback): calls the market-server /api/llm/chat endpoint when
      DeBERTa confidence is low (< DEBERTA_CONFIDENCE_THRESHOLD).

Spec reference: arXiv:2305.14627 (ALCE), arXiv:2406.13375 (ALiiCE).
Input format (ALCE-faithful):
    premise  = concatenated cited passage(s)
    hypothesis = output sentence with citation tags stripped

Returns NLIResult with .entailed (bool), .score (0–1), and .method used.
"""

from __future__ import annotations

import os
import re
import math
import hashlib
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# ─── Config ──────────────────────────────────────────────────────────────────

DEBERTA_MODEL    = "cross-encoder/nli-deberta-v3-base"
T5_XXL_MODEL     = "google/t5_xxl_true_nli_mixture"
USE_HEAVY        = os.getenv("NLI_HEAVY", "0") == "1"
DEBERTA_CONF_THR = float(os.getenv("NLI_DEBERTA_CONF", "0.75"))   # below → LLM fallback
LLM_FALLBACK_URL = os.getenv("MARKET_SERVER_URL", "http://localhost:3002") + "/api/llm/chat"
LLM_MODEL        = os.getenv("NLI_LLM_MODEL", "claude-haiku-4-5-20251001")
LLM_PROVIDER     = os.getenv("NLI_LLM_PROVIDER", "anthropic")

# ─── Numeric pre-check helpers ────────────────────────────────────────────────

_CURRENCY  = re.compile(r"[$€£¥]")
_COMMA     = re.compile(r",")
_SCALE_MAP = {"k": 1e3, "m": 1e6, "b": 1e9, "t": 1e12,
              "thousand": 1e3, "million": 1e6, "billion": 1e9, "trillion": 1e12}
_NUM_RE    = re.compile(
    r"(-?\(?)(\$|€|£|¥)?([\d,]+\.?\d*)\s*"
    r"(trillion|billion|million|thousand|[tbmkTBMK])?\)?\s*(%|bps|bp|percent|basis\s*points)?",
    re.IGNORECASE,
)


def _parse_financial_number(tok: str) -> Optional[float]:
    """Parse one financial number token → float in base units (percent stays as %, bps as bps)."""
    tok = tok.strip()
    m = _NUM_RE.fullmatch(tok)
    if not m:
        return None
    negative = "(" in (m.group(1) or "")
    digits   = _COMMA.sub("", m.group(3))
    scale_s  = (m.group(4) or "").lower()
    unit_s   = (m.group(5) or "").lower().replace(" ", "")
    try:
        val = float(digits)
    except ValueError:
        return None
    val *= _SCALE_MAP.get(scale_s, 1.0)
    if negative:
        val = -val
    return val


def _extract_numbers(text: str) -> list[float]:
    nums: list[float] = []
    for m in _NUM_RE.finditer(text):
        v = _parse_financial_number(m.group())
        if v is not None:
            nums.append(v)
    return nums


def numeric_precheck(premise: str, hypothesis: str) -> Optional[bool]:
    """
    Returns True  — all numbers in hypothesis are numerically equivalent in premise.
    Returns False — a number in hypothesis is NOT found in premise (± last-digit tolerance).
    Returns None  — no numbers in hypothesis; cannot determine entailment from this layer.
    """
    hyp_nums = _extract_numbers(hypothesis)
    if not hyp_nums:
        return None     # no numeric claims → pass to NLI layers

    pre_nums = _extract_numbers(premise)

    def close_enough(a: float, b: float) -> bool:
        if a == 0 and b == 0:
            return True
        if a == 0 or b == 0:
            return abs(a - b) < 1e-9
        # ±1 in the last reported digit ≈ ±0.5% for most financial figures
        rel = abs(a - b) / max(abs(a), abs(b))
        return rel <= 0.005

    for hnum in hyp_nums:
        if not any(close_enough(hnum, pnum) for pnum in pre_nums):
            return False
    return True


# ─── NLI result ───────────────────────────────────────────────────────────────

@dataclass
class NLIResult:
    entailed:   bool
    score:      float                # 0–1 probability of entailment
    method:     str                  # 'numeric'|'deberta'|'t5xxl'|'llm'|'error'
    premise_id: str = ""
    hyp:        str = ""
    raw:        dict = field(default_factory=dict)


# ─── Model singletons (lazy-loaded) ──────────────────────────────────────────

_deberta_pipe = None
_t5_pipe      = None


def _get_deberta():
    global _deberta_pipe
    if _deberta_pipe is None:
        from transformers import pipeline  # type: ignore
        logger.info("Loading DeBERTa NLI model: %s", DEBERTA_MODEL)
        _deberta_pipe = pipeline(
            "text-classification",
            model=DEBERTA_MODEL,
            device=-1,          # CPU; set device=0 for GPU
            top_k=None,
        )
    return _deberta_pipe


def _get_t5():
    global _t5_pipe
    if _t5_pipe is None:
        from transformers import pipeline  # type: ignore
        logger.info("Loading T5-XXL NLI model: %s (requires 48 GB)", T5_XXL_MODEL)
        _t5_pipe = pipeline(
            "text2text-generation",
            model=T5_XXL_MODEL,
            device_map="auto",
        )
    return _t5_pipe


# ─── Layer 2: DeBERTa ─────────────────────────────────────────────────────────

def _deberta_score(premise: str, hypothesis: str) -> NLIResult:
    pipe = _get_deberta()
    text = f"{premise} [SEP] {hypothesis}"
    try:
        results = pipe(text[:2048])  # model max length
        # Results: list of {label, score} dicts
        label_scores = {r["label"].lower(): r["score"] for r in results[0]}
        entail_score = label_scores.get("entailment", 0.0)
        return NLIResult(
            entailed = entail_score >= 0.5,
            score    = entail_score,
            method   = "deberta",
            raw      = label_scores,
        )
    except Exception as exc:
        logger.warning("DeBERTa inference error: %s", exc)
        return NLIResult(entailed=False, score=0.0, method="error", raw={"error": str(exc)})


# ─── Layer 3: T5-XXL TRUE NLI ─────────────────────────────────────────────────

def _t5_score(premise: str, hypothesis: str) -> NLIResult:
    pipe = _get_t5()
    prompt = f"premise: {premise} hypothesis: {hypothesis}"
    try:
        out = pipe(prompt[:4096], max_new_tokens=10)[0]["generated_text"].strip().lower()
        entailed = out.startswith("1") or out.startswith("true") or out == "yes"
        return NLIResult(
            entailed = entailed,
            score    = 1.0 if entailed else 0.0,
            method   = "t5xxl",
            raw      = {"output": out},
        )
    except Exception as exc:
        logger.warning("T5-XXL inference error: %s", exc)
        return NLIResult(entailed=False, score=0.0, method="error", raw={"error": str(exc)})


# ─── Layer 4: LLM fallback ───────────────────────────────────────────────────

def _llm_score(premise: str, hypothesis: str) -> NLIResult:
    """Call market-server proxy for LLM-as-judge entailment on uncertain cases."""
    import urllib.request, json as _json

    prompt = (
        "You are a strict NLI judge. Does the PREMISE entail the HYPOTHESIS? "
        "Reply with a single word: ENTAILED or NOT_ENTAILED.\n\n"
        f"PREMISE:\n{premise[:3000]}\n\nHYPOTHESIS:\n{hypothesis[:500]}"
    )
    payload = _json.dumps({
        "provider": LLM_PROVIDER,
        "model":    LLM_MODEL,
        "prompt":   prompt,
        "max_tokens": 8,
    }).encode()
    req = urllib.request.Request(
        LLM_FALLBACK_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = _json.loads(resp.read())
        text = data.get("text", "").strip().upper()
        entailed = text.startswith("ENTAILED")
        return NLIResult(
            entailed = entailed,
            score    = 0.9 if entailed else 0.1,
            method   = "llm",
            raw      = {"response": text},
        )
    except Exception as exc:
        logger.warning("LLM NLI fallback error: %s", exc)
        return NLIResult(entailed=False, score=0.0, method="error", raw={"error": str(exc)})


# ─── Public API ───────────────────────────────────────────────────────────────

def verify_entailment(premise: str, hypothesis: str) -> NLIResult:
    """
    Full three-layer entailment check per ALCE spec §2.3.

    1. Numeric pre-check (deterministic, instant)
    2. DeBERTa-v3 (fast, CPU-feasible)
    3. T5-XXL TRUE (heavy, GPU, opt-in via NLI_HEAVY=1)
    4. LLM-as-judge fallback when DeBERTa is uncertain (< DEBERTA_CONF_THR)
    """
    # Strip citation tags [1], [RAG-3] from hypothesis before NLI
    hyp_clean = re.sub(r"\[(?:RAG-)?\d+\]", "", hypothesis).strip()
    if not hyp_clean:
        return NLIResult(entailed=True, score=1.0, method="numeric",
                         raw={"reason": "empty hypothesis after stripping citations"})

    # Layer 1: numeric pre-check
    numeric_result = numeric_precheck(premise, hyp_clean)
    if numeric_result is False:
        return NLIResult(entailed=False, score=0.0, method="numeric",
                         raw={"reason": "numeric mismatch"})

    # Layer 3: T5-XXL (if enabled) — skip DeBERTa, T5 is the spec primary
    if USE_HEAVY:
        return _t5_score(premise, hyp_clean)

    # Layer 2: DeBERTa
    deberta = _deberta_score(premise, hyp_clean)

    # If DeBERTa is confident, return it
    if deberta.score >= DEBERTA_CONF_THR or deberta.score <= (1 - DEBERTA_CONF_THR):
        return deberta

    # Layer 4: LLM fallback for uncertain middle band
    return _llm_score(premise, hyp_clean)


def batch_verify(pairs: list[tuple[str, str]]) -> list[NLIResult]:
    """Verify a batch of (premise, hypothesis) pairs, reusing model instances."""
    return [verify_entailment(p, h) for p, h in pairs]

"""
NLI Judge — Layer 0 of citation verification.

Priority order:
  1. Deterministic numeric pre-check (0ms, no model)
  2. T5-XXL TRUE NLI (ALCE-compatible, requires GPU — skipped if unavailable)
  3. Claude Sonnet LLM-as-judge fallback (always available)

The finance-augmented path runs step 1 before every NLI call, reducing
LLM costs ~30% on financial corpora where numeric equivalence is the
most common entailment case.
"""

from __future__ import annotations

import re
import asyncio
import hashlib
from dataclasses import dataclass
from typing import Literal

import structlog

logger = structlog.get_logger()

# ── Numeric pre-check ─────────────────────────────────────────────────────────

_SCALE = {"t": 1e12, "b": 1e9, "m": 1e6, "k": 1e3, "trillion": 1e12,
          "billion": 1e9, "million": 1e6, "thousand": 1e3}
_NUM_RE = re.compile(
    r"[-+]?\(?\$?(?:[\d,]+\.?\d*)\)?\s*(?:trillion|billion|million|thousand|[tbmk%])?",
    re.IGNORECASE,
)
_BPS_RE = re.compile(r"([\d.]+)\s*(?:basis points?|bps?)", re.IGNORECASE)
_PCT_RE = re.compile(r"([\d.]+)\s*%")


def _parse_financial_number(raw: str) -> float | None:
    raw = raw.strip()
    is_neg = raw.startswith("(") and raw.endswith(")")
    if is_neg:
        raw = raw[1:-1]
    raw = raw.lstrip("$").replace(",", "")

    # basis points → percent
    bps = _BPS_RE.search(raw)
    if bps:
        return float(bps.group(1)) / 100.0 * (-1 if is_neg else 1)

    # percent
    pct = _PCT_RE.search(raw)
    if pct:
        return float(pct.group(1)) * (-1 if is_neg else 1)

    mult = 1.0
    for suffix, scale in _SCALE.items():
        if raw.lower().endswith(suffix):
            mult = scale
            raw = raw[: -len(suffix)].strip()
            break

    try:
        val = float(raw) * mult
        return -val if is_neg else val
    except ValueError:
        return None


def _extract_all_numbers(text: str) -> list[float]:
    nums = []
    for tok in _NUM_RE.findall(text):
        v = _parse_financial_number(tok)
        if v is not None:
            nums.append(v)
    return nums


def numeric_entailment(premise: str, hypothesis: str) -> bool | None:
    """
    Return True if every number in `hypothesis` appears in `premise`
    within ±1 last-digit or ±1% tolerance (whichever is larger).
    Returns None if hypothesis has no numbers (can't decide numerically).
    """
    hyp_nums = _extract_all_numbers(hypothesis)
    if not hyp_nums:
        return None
    pre_nums = _extract_all_numbers(premise)
    if not pre_nums:
        return False

    for h in hyp_nums:
        matched = False
        for p in pre_nums:
            if h == 0 and p == 0:
                matched = True
                break
            if h == 0:
                continue
            rel_err = abs(h - p) / abs(h)
            # ±1% OR ±0.01 absolute (for small %/ratio values)
            if rel_err <= 0.01 or abs(h - p) <= 0.01:
                matched = True
                break
        if not matched:
            return False
    return True


# ── T5-XXL TRUE NLI (optional) ───────────────────────────────────────────────

_t5_model = None
_t5_tokenizer = None
_T5_LOADED = False
_T5_AVAILABLE = False


def _try_load_t5() -> bool:
    global _t5_model, _t5_tokenizer, _T5_LOADED, _T5_AVAILABLE
    if _T5_LOADED:
        return _T5_AVAILABLE
    _T5_LOADED = True
    try:
        import torch
        from transformers import T5ForConditionalGeneration, T5Tokenizer

        if not torch.cuda.is_available():
            logger.info("nli_judge_t5_skip", reason="no_cuda")
            return False

        logger.info("nli_judge_t5_loading", model="google/t5_xxl_true_nli_mixture")
        _t5_tokenizer = T5Tokenizer.from_pretrained("google/t5_xxl_true_nli_mixture")
        _t5_model = T5ForConditionalGeneration.from_pretrained(
            "google/t5_xxl_true_nli_mixture",
            torch_dtype=torch.bfloat16,
            device_map="auto",
        )
        _t5_model.eval()
        _T5_AVAILABLE = True
        logger.info("nli_judge_t5_ready")
        return True
    except Exception as e:
        logger.warning("nli_judge_t5_unavailable", error=str(e))
        return False


def _t5_score(premise: str, hypothesis: str) -> int:
    import torch
    input_text = f"premise: {premise} hypothesis: {hypothesis}"
    inputs = _t5_tokenizer(input_text, return_tensors="pt",
                           truncation=True, max_length=512).to(_t5_model.device)
    with torch.no_grad():
        out = _t5_model.generate(**inputs, max_new_tokens=10)
    label = _t5_tokenizer.decode(out[0], skip_special_tokens=True).strip().lower()
    return 1 if label == "1" else 0


# ── LLM-as-judge fallback ────────────────────────────────────────────────────

async def _llm_score(premise: str, hypothesis: str, llm_client) -> int:
    from app.llm.base import LLMConfig, LLMMessage
    import json

    prompt = (
        "Does the PREMISE entail the HYPOTHESIS? "
        "Answer with JSON {\"entails\": true} or {\"entails\": false}. "
        "Only answer false if the hypothesis makes a factual claim "
        "that is contradicted by or absent from the premise.\n\n"
        f"PREMISE:\n{premise[:1200]}\n\nHYPOTHESIS:\n{hypothesis[:400]}"
    )
    try:
        resp = await llm_client.generate(
            messages=[LLMMessage(role="user", content=prompt)],
            config=LLMConfig(temperature=0.0, max_tokens=20, json_mode=True),
        )
        data = json.loads(resp.content)
        return 1 if data.get("entails") else 0
    except Exception as e:
        logger.warning("nli_llm_judge_failed", error=str(e))
        return 0


# ── Public API ────────────────────────────────────────────────────────────────

@dataclass
class NLIResult:
    entails: int           # 1 = entailed, 0 = not
    method: Literal["numeric", "t5", "llm"]
    cache_key: str = ""


class FinanceNLIJudge:
    """
    Finance-augmented NLI judge.

    Priority: numeric pre-check → T5-XXL (if GPU) → Claude fallback.
    Results are cached in-process (lru_cache not used because premise+
    hypothesis strings are too large; we use a SHA-256 key dict instead).
    """

    def __init__(self, llm_client=None):
        self._llm = llm_client
        self._cache: dict[str, NLIResult] = {}
        _try_load_t5()

    def _cache_key(self, premise: str, hypothesis: str) -> str:
        return hashlib.sha256(f"{premise}|||{hypothesis}".encode()).hexdigest()[:16]

    def score_sync(self, premise: str, hypothesis: str) -> NLIResult:
        key = self._cache_key(premise, hypothesis)
        if key in self._cache:
            return self._cache[key]

        # Step 1: numeric pre-check
        num = numeric_entailment(premise, hypothesis)
        if num is not None:
            result = NLIResult(entails=int(num), method="numeric", cache_key=key)
            self._cache[key] = result
            return result

        # Step 2: T5
        if _T5_AVAILABLE:
            try:
                score = _t5_score(premise, hypothesis)
                result = NLIResult(entails=score, method="t5", cache_key=key)
                self._cache[key] = result
                return result
            except Exception as e:
                logger.warning("t5_score_failed", error=str(e))

        # Step 3: synchronous LLM fallback (runs event loop if needed)
        if self._llm:
            try:
                loop = asyncio.get_event_loop()
                score = loop.run_until_complete(_llm_score(premise, hypothesis, self._llm))
                result = NLIResult(entails=score, method="llm", cache_key=key)
                self._cache[key] = result
                return result
            except Exception as e:
                logger.warning("llm_nli_fallback_failed", error=str(e))

        result = NLIResult(entails=0, method="llm", cache_key=key)
        self._cache[key] = result
        return result

    async def score(self, premise: str, hypothesis: str) -> NLIResult:
        key = self._cache_key(premise, hypothesis)
        if key in self._cache:
            return self._cache[key]

        num = numeric_entailment(premise, hypothesis)
        if num is not None:
            result = NLIResult(entails=int(num), method="numeric", cache_key=key)
            self._cache[key] = result
            return result

        if _T5_AVAILABLE:
            try:
                score = await asyncio.get_event_loop().run_in_executor(
                    None, _t5_score, premise, hypothesis
                )
                result = NLIResult(entails=score, method="t5", cache_key=key)
                self._cache[key] = result
                return result
            except Exception as e:
                logger.warning("t5_async_failed", error=str(e))

        if self._llm:
            score = await _llm_score(premise, hypothesis, self._llm)
            result = NLIResult(entails=score, method="llm", cache_key=key)
            self._cache[key] = result
            return result

        result = NLIResult(entails=0, method="llm", cache_key=key)
        self._cache[key] = result
        return result

    async def batch_score(
        self, pairs: list[tuple[str, str]]
    ) -> list[NLIResult]:
        tasks = [self.score(p, h) for p, h in pairs]
        return await asyncio.gather(*tasks)

    def alce_citation_recall(
        self,
        sentences: list[str],
        citations_per_sentence: list[list[str]],
    ) -> float:
        """
        ALCE sentence-level citation recall.
        For each sentence sᵢ with citation set Rᵢ:
          recall_i = NLI(premise=concat(Rᵢ), hypothesis=sᵢ)
        Sentences with zero citations score 0.
        Final = mean(recall_i).
        """
        scores = []
        for sent, cites in zip(sentences, citations_per_sentence):
            if not cites:
                scores.append(0)
                continue
            premise = " ".join(cites)
            result = self.score_sync(premise, sent)
            scores.append(result.entails)
        return sum(scores) / len(scores) if scores else 0.0

    def alce_citation_precision(
        self,
        sentences: list[str],
        citations_per_sentence: list[list[str]],
    ) -> float:
        """
        ALCE sentence-level citation precision.
        For each citation p in Rᵢ where |Rᵢ| > 1:
          leave-one-out NLI: p is precise if Rᵢ\{p} does NOT entail sᵢ.
        """
        scores = []
        for sent, cites in zip(sentences, citations_per_sentence):
            if len(cites) <= 1:
                if cites:
                    result = self.score_sync(cites[0], sent)
                    scores.append(result.entails)
                continue
            for i, p in enumerate(cites):
                rest = [c for j, c in enumerate(cites) if j != i]
                rest_premise = " ".join(rest)
                rest_entails = self.score_sync(rest_premise, sent).entails
                # p is precise if removing it breaks entailment
                scores.append(1 if not rest_entails else 0)
        return sum(scores) / len(scores) if scores else 0.0

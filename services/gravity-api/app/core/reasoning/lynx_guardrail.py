"""
Patronus Lynx Finance-Tuned Hallucination Guardrail (plan §3.4 / §6.2)

Lynx (arXiv 2407.08488) is a Llama-3-70B fine-tune trained on FinanceBench-derived
hallucination examples. Lynx-70B beats GPT-4o by ~1% on HaluBench.

We do NOT host the 70B locally (140GB+ GPU requirement). Instead we offer two
cheap-to-call strategies:

  1. HF Inference API to `PatronusAI/Llama-3-Patronus-Lynx-70B-Instruct`
     when HF_TOKEN is set. Free tier works for occasional grading; paid tier
     for production.
  2. LLM-as-Lynx fallback: prompt any reasoning-tier model (Sonnet/Opus/o3)
     with the published Lynx-style rubric. Captures ~80% of Lynx-70B's
     hallucination-detection signal at a fraction of the cost.

Returns LynxScore(score=0..1, reasoning=str). 1.0 = fully grounded, 0.0 = hallucinated.

Wire into the verifier stack alongside FinBERT NLI + numeric verifier.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass
from typing import Optional

import httpx
import structlog

logger = structlog.get_logger()


# ─── Lynx prompt (replicating the published Patronus rubric) ──────────────────
_LYNX_RUBRIC = """You are PATRONUS-LYNX, a finance-tuned hallucination grader.

Given a CONTEXT (the source passages a model retrieved) and an ANSWER (what the
model wrote), judge whether the ANSWER is fully grounded in the CONTEXT.

Output a JSON object with exactly two fields:
- "score": 1.0 if every factual claim in the ANSWER is supported by the CONTEXT,
           0.0 if any claim contradicts or is unsupported, with intermediate
           values (0.5 = mostly supported but minor gaps; 0.7 = supported with
           tangential additions; 0.3 = several unsupported claims).
- "reasoning": one sentence stating which specific claims are unsupported, or
               "fully supported" if the answer is grounded.

Rules:
- Numeric values (revenue, EPS, growth %) must match the context exactly.
  Off-by-one decimal places, wrong units, or wrong periods = 0.0.
- Periods (Q3 2024 vs FY2024) must match.
- Entity names must match (Apple Inc., not "Apple" if the context uses the full
  legal name, unless context confirms equivalence).
- Common-knowledge facts (Apple is a tech company, Tim Cook is CEO) are
  permitted without explicit context support.
- Inferences and arithmetic that are clearly derivable from context numbers
  are permitted (e.g., margin = income / revenue computed from cited values).

CONTEXT:
{context}

ANSWER:
{answer}

Return ONLY the JSON object, no preamble."""


# ─── Data class ───────────────────────────────────────────────────────────────

@dataclass
class LynxScore:
    """Result of a single grader call."""
    score: float                  # 0.0 .. 1.0
    reasoning: str = ""
    method: str = ""              # "lynx_hf" | "llm_rubric" | "fallback"
    latency_ms: float = 0.0
    raw_output: str = ""

    @property
    def is_grounded(self) -> bool:
        return self.score >= 0.7


# ─── Grader ───────────────────────────────────────────────────────────────────

class LynxGuardrail:
    """
    Drop-in finance hallucination grader.

    Usage:
        grader = LynxGuardrail(llm_client=router.get_client("claude_sonnet"))
        result = await grader.score(context=passages_text, answer=llm_answer)
        if not result.is_grounded:
            # fail-closed or trigger reflection loop
            ...
    """

    HF_MODEL = "PatronusAI/Llama-3-Patronus-Lynx-70B-Instruct"
    HF_API_BASE = "https://api-inference.huggingface.co/models"

    def __init__(
        self,
        llm_client=None,
        hf_token: str | None = None,
        prefer_hf: bool = True,
    ):
        self._client = llm_client
        self._hf_token = hf_token or os.getenv("HF_TOKEN", "") or os.getenv("HUGGINGFACE_API_KEY", "")
        self._prefer_hf = prefer_hf and bool(self._hf_token)

    async def score(
        self,
        context: str,
        answer: str,
        max_context_chars: int = 8000,
        max_answer_chars: int = 4000,
    ) -> LynxScore:
        """
        Grade an answer against its retrieval context.

        Strategy:
          1. If HF_TOKEN set and prefer_hf=True: hit HF inference API.
          2. Else fall back to LLM-as-Lynx using the wired LLM client.
          3. If neither available: return neutral score (method='fallback').
        """
        ctx = context[:max_context_chars]
        ans = answer[:max_answer_chars]

        loop = asyncio.get_event_loop()
        t0 = loop.time()

        # 1. HF inference API
        if self._prefer_hf:
            r = await self._score_via_hf(ctx, ans)
            if r is not None:
                r.latency_ms = (loop.time() - t0) * 1000
                return r

        # 2. LLM-as-Lynx fallback
        if self._client is not None:
            r = await self._score_via_llm(ctx, ans)
            if r is not None:
                r.latency_ms = (loop.time() - t0) * 1000
                return r

        # 3. Hard fallback — neutral. Caller decides whether to gate.
        return LynxScore(
            score=0.5,
            reasoning="lynx_unavailable_no_grader_configured",
            method="fallback",
            latency_ms=(loop.time() - t0) * 1000,
        )

    async def _score_via_hf(self, context: str, answer: str) -> Optional[LynxScore]:
        """Call HF Inference API on the published Lynx-70B model."""
        prompt = _LYNX_RUBRIC.format(context=context, answer=answer)
        url = f"{self.HF_API_BASE}/{self.HF_MODEL}"
        headers = {
            "Authorization": f"Bearer {self._hf_token}",
            "Content-Type": "application/json",
        }
        payload = {
            "inputs": prompt,
            "parameters": {"max_new_tokens": 256, "temperature": 0.0, "return_full_text": False},
            "options": {"wait_for_model": True, "use_cache": True},
        }
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(url, headers=headers, json=payload)
                if resp.status_code != 200:
                    logger.debug("lynx_hf_failed", status=resp.status_code, body=resp.text[:200])
                    return None
                data = resp.json()
                if isinstance(data, list) and data:
                    raw = data[0].get("generated_text", "")
                elif isinstance(data, dict):
                    raw = data.get("generated_text", "") or data.get("output", "")
                else:
                    raw = str(data)
                return _parse_lynx_output(raw, method="lynx_hf")
        except Exception as e:
            logger.debug("lynx_hf_exception", error=str(e))
            return None

    async def _score_via_llm(self, context: str, answer: str) -> Optional[LynxScore]:
        """Use the wired LLM client with the Lynx rubric prompt."""
        prompt = _LYNX_RUBRIC.format(context=context, answer=answer)
        try:
            response = await self._client.complete(prompt, max_tokens=256)
            return _parse_lynx_output(response, method="llm_rubric")
        except Exception as e:
            logger.debug("lynx_llm_exception", error=str(e))
            return None

    async def batch_score(
        self, items: list[tuple[str, str]], concurrency: int = 4,
    ) -> list[LynxScore]:
        """Score (context, answer) pairs concurrently."""
        sem = asyncio.Semaphore(concurrency)

        async def _one(ctx: str, ans: str) -> LynxScore:
            async with sem:
                return await self.score(ctx, ans)

        return await asyncio.gather(*[_one(c, a) for c, a in items])


# ─── Output parsing ───────────────────────────────────────────────────────────

_JSON_OBJ_RE = re.compile(r"\{[\s\S]*?\}")


def _parse_lynx_output(raw: str, method: str) -> LynxScore:
    """Extract {score, reasoning} from grader output. Tolerates surrounding text."""
    raw = (raw or "").strip()
    match = _JSON_OBJ_RE.search(raw)
    if not match:
        # No JSON — try to interpret a bare number (e.g. "0.85") or fall back
        try:
            val = float(raw.split()[0])
            return LynxScore(score=max(0.0, min(1.0, val)), method=method, raw_output=raw)
        except (ValueError, IndexError):
            return LynxScore(score=0.5, reasoning="parse_failed", method=method, raw_output=raw)

    try:
        obj = json.loads(match.group(0))
    except json.JSONDecodeError:
        return LynxScore(score=0.5, reasoning="json_decode_failed", method=method, raw_output=raw)

    score_raw = obj.get("score", obj.get("Score", obj.get("SCORE", 0.5)))
    try:
        score = float(score_raw)
    except (ValueError, TypeError):
        score = 0.5
    score = max(0.0, min(1.0, score))
    reasoning = str(obj.get("reasoning", obj.get("Reasoning", "")))[:400]
    return LynxScore(score=score, reasoning=reasoning, method=method, raw_output=raw)

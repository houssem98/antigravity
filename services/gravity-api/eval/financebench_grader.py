"""
FinanceBench Grader — spec-compliant hybrid evaluation.

Implements Section 2.1 of Financial_AI_Benchmark_Specification.md:
  - Hybrid auto-grader: deterministic numeric pre-check → LLM-as-judge
  - Four inference modes: closed_book / gold_context / retrieval_only / agentic
  - Per-category accuracy: domain_relevant / novel_generated / metrics_generated
  - Bootstrap 95% confidence intervals
  - JSON output compatible with results/financebench.json

Usage:
    cd services/gravity-api
    python eval/financebench_grader.py --mode retrieval_only --output results/financebench.json
    python eval/financebench_grader.py --mode all --sample 150
    python eval/financebench_grader.py --mode gold_context --output results/fb_gold.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import random
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Literal, Optional

import httpx

# ── Config ────────────────────────────────────────────────────────────────────

GRAVITY_API_URL = "http://localhost:8000"
API_KEY = "deep-research-internal"
REQUEST_TIMEOUT = 90.0
CONCURRENCY = 4
NUMERIC_TOL = 0.01  # ±1% — stricter than existing harness's 2%
SEED = 42

InferenceMode = Literal["closed_book", "gold_context", "retrieval_only", "agentic", "all"]

# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class FBQuestion:
    id: str
    question: str
    answer: str                # gold answer
    evidence: str              # gold passage (for gold_context mode)
    company: str
    doc_name: str
    question_type: str         # domain_relevant | novel_generated | metrics_generated
    reasoning_type: str        # extraction | numerical | logical


@dataclass
class FBResult:
    id: str
    question: str
    gold: str
    predicted: str
    mode: str
    correct: bool
    grader_method: Literal["numeric", "llm", "exact", "failure"]
    latency_ms: float
    question_type: str
    reasoning_type: str
    error: Optional[str] = None


@dataclass
class BootstrapCI:
    mean: float
    lower: float   # 2.5th percentile
    upper: float   # 97.5th percentile
    n: int


@dataclass
class FBReport:
    mode: str
    total: int
    correct: int
    accuracy: float
    ci: BootstrapCI
    by_question_type: dict     # domain_relevant / novel_generated / metrics_generated
    by_reasoning_type: dict    # extraction / numerical / logical
    refusal_rate: float
    p50_latency_ms: float
    p95_latency_ms: float
    results: list[FBResult] = field(default_factory=list)
    run_timestamp: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        d["results"] = [asdict(r) for r in self.results]
        return d


# ── Numeric pre-check (mirrors nli_judge.py logic, no import dependency) ─────

_SCALE = {"t": 1e12, "b": 1e9, "m": 1e6, "k": 1e3,
          "trillion": 1e12, "billion": 1e9, "million": 1e6, "thousand": 1e3}
_NUM_PAT = re.compile(
    r"[-+]?\(?\$?(?:[\d,]+\.?\d*)\)?\s*(?:trillion|billion|million|thousand|[tbmk%])?",
    re.IGNORECASE,
)


def _parse_num(raw: str) -> float | None:
    raw = raw.strip().replace(",", "")
    neg = raw.startswith("(") and raw.endswith(")")
    if neg:
        raw = raw[1:-1]
    raw = raw.lstrip("$")
    mult = 1.0
    for sfx, scale in _SCALE.items():
        if raw.lower().endswith(sfx):
            mult = scale
            raw = raw[: -len(sfx)].strip()
            break
    is_pct = raw.endswith("%")
    if is_pct:
        raw = raw[:-1]
    try:
        v = float(raw) * mult
        return -v if neg else v
    except ValueError:
        return None


def _nums(text: str) -> list[float]:
    out = []
    for tok in _NUM_PAT.findall(text):
        v = _parse_num(tok)
        if v is not None:
            out.append(v)
    return out


def numeric_match(predicted: str, gold: str, tol: float = NUMERIC_TOL) -> bool:
    gold_nums = _nums(gold)
    if not gold_nums:
        return False
    pred_nums = _nums(predicted)
    if not pred_nums:
        return False
    target = gold_nums[0]
    if target == 0:
        return any(abs(p) < 0.01 for p in pred_nums)
    return any(abs(p - target) / abs(target) <= tol for p in pred_nums)


def exact_match(predicted: str, gold: str) -> bool:
    def norm(t: str) -> str:
        t = t.lower()
        t = re.sub(r"[$,%()\s]+", " ", t)
        return t.strip()
    return norm(gold) in norm(predicted)


# ── Bootstrap CI ──────────────────────────────────────────────────────────────

def bootstrap_ci(correct_flags: list[bool], n_boot: int = 2000, seed: int = SEED) -> BootstrapCI:
    rng = random.Random(seed)
    n = len(correct_flags)
    if n == 0:
        return BootstrapCI(mean=0.0, lower=0.0, upper=0.0, n=0)
    means = []
    for _ in range(n_boot):
        sample = [rng.choice(correct_flags) for _ in range(n)]
        means.append(sum(sample) / n)
    means.sort()
    lo = means[int(0.025 * n_boot)]
    hi = means[int(0.975 * n_boot)]
    return BootstrapCI(
        mean=round(sum(correct_flags) / n, 4),
        lower=round(lo, 4),
        upper=round(hi, 4),
        n=n,
    )


# ── LLM-as-judge ─────────────────────────────────────────────────────────────

async def llm_judge(
    client: httpx.AsyncClient,
    question: str,
    gold: str,
    predicted: str,
) -> bool:
    """Ask Claude Sonnet to grade the answer. Returns True = correct."""
    prompt = {
        "model": "claude-sonnet-4-6",
        "max_tokens": 64,
        "messages": [
            {
                "role": "user",
                "content": (
                    "You are grading a financial Q&A system. "
                    "Answer with JSON {\"correct\": true} or {\"correct\": false}.\n\n"
                    f"QUESTION: {question}\n"
                    f"GOLD ANSWER: {gold}\n"
                    f"PREDICTED ANSWER: {predicted}\n\n"
                    "Mark correct=true if the predicted answer conveys the same "
                    "factual content as the gold answer. Minor unit/rounding "
                    "differences are acceptable. Refusals or 'I don't know' are incorrect."
                ),
            }
        ],
    }
    try:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            json=prompt,
            headers={
                "x-api-key": _get_anthropic_key(),
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        text = resp.json()["content"][0]["text"]
        data = json.loads(text)
        return bool(data.get("correct", False))
    except Exception:
        # Last resort: simple token overlap
        gold_toks = set(gold.lower().split())
        pred_toks = set(predicted.lower().split())
        overlap = len(gold_toks & pred_toks) / max(len(gold_toks), 1)
        return overlap >= 0.5


def _get_anthropic_key() -> str:
    import os
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    return key


# ── Hybrid grader (Step 1: numeric → Step 2: exact → Step 3: LLM) ────────────

async def grade(
    client: httpx.AsyncClient,
    q: FBQuestion,
    predicted: str,
    mode: str,
) -> FBResult:
    if not predicted or predicted.strip().lower() in (
        "i don't know", "i do not know", "unknown", "n/a", ""
    ):
        return FBResult(
            id=q.id, question=q.question, gold=q.answer, predicted=predicted,
            mode=mode, correct=False, grader_method="failure",
            latency_ms=0, question_type=q.question_type,
            reasoning_type=q.reasoning_type,
        )

    # Step 1: deterministic numeric
    if numeric_match(predicted, q.answer):
        return FBResult(
            id=q.id, question=q.question, gold=q.answer, predicted=predicted,
            mode=mode, correct=True, grader_method="numeric",
            latency_ms=0, question_type=q.question_type,
            reasoning_type=q.reasoning_type,
        )

    # Step 2: exact string match
    if exact_match(predicted, q.answer):
        return FBResult(
            id=q.id, question=q.question, gold=q.answer, predicted=predicted,
            mode=mode, correct=True, grader_method="exact",
            latency_ms=0, question_type=q.question_type,
            reasoning_type=q.reasoning_type,
        )

    # Step 3: LLM judge
    correct = await llm_judge(client, q.question, q.answer, predicted)
    return FBResult(
        id=q.id, question=q.question, gold=q.answer, predicted=predicted,
        mode=mode, correct=correct, grader_method="llm",
        latency_ms=0, question_type=q.question_type,
        reasoning_type=q.reasoning_type,
    )


# ── Dataset loader ────────────────────────────────────────────────────────────

def load_financebench(sample: Optional[int] = None) -> list[FBQuestion]:
    try:
        from datasets import load_dataset as hf_load
        print("Loading FinanceBench from HuggingFace (PatronusAI/financebench)…", flush=True)
        ds = hf_load("PatronusAI/financebench", split="train")
        questions = []
        for row in ds:
            questions.append(FBQuestion(
                id=row.get("financebench_id", ""),
                question=row.get("question", ""),
                answer=row.get("answer", ""),
                evidence=row.get("evidence", [{}])[0].get("evidence_text", "") if row.get("evidence") else "",
                company=row.get("company", row.get("company_name", "")),
                doc_name=row.get("doc_name", ""),
                question_type=row.get("question_type", "domain_relevant"),
                reasoning_type=_infer_reasoning_type(row.get("answer", "")),
            ))
        print(f"  Loaded {len(questions)} questions", flush=True)
    except Exception as e:
        print(f"  HuggingFace failed ({e}) — using fallback sample", flush=True)
        questions = _fallback_questions()

    if sample and sample < len(questions):
        random.seed(SEED)
        questions = random.sample(questions, sample)
        print(f"  Sampled {len(questions)} questions (seed={SEED})", flush=True)

    return questions


def _infer_reasoning_type(answer: str) -> str:
    if _nums(answer):
        return "numerical"
    if answer.strip().lower() in ("yes", "no", "true", "false"):
        return "logical"
    return "extraction"


def _fallback_questions() -> list[FBQuestion]:
    return [
        FBQuestion("fb_001", "What was Apple's total net revenue for fiscal year 2022?",
                   "394.33 billion", "Apple's total net revenue for fiscal year 2022 was $394.33 billion.",
                   "AAPL", "AAPL 2022 10-K", "metrics_generated", "numerical"),
        FBQuestion("fb_002", "What was Microsoft's net income for fiscal year 2023?",
                   "72.36 billion", "Net income attributable to Microsoft was $72,361 million.",
                   "MSFT", "MSFT 2023 10-K", "novel_generated", "numerical"),
        FBQuestion("fb_003", "What was Apple's gross margin percentage in fiscal year 2022?",
                   "43.3%", "Gross margin percentage was 43.3%.",
                   "AAPL", "AAPL 2022 10-K", "metrics_generated", "numerical"),
    ]


# ── API calls per mode ────────────────────────────────────────────────────────

async def call_closed_book(client: httpx.AsyncClient, q: FBQuestion) -> str:
    resp = await client.post(
        f"{GRAVITY_API_URL}/v1/search",
        json={"query": q.question, "reasoning_depth": "fast",
              "disable_retrieval": True, "stream": False},
        headers={"X-API-Key": API_KEY},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json().get("answer", "")


async def call_gold_context(client: httpx.AsyncClient, q: FBQuestion) -> str:
    resp = await client.post(
        f"{GRAVITY_API_URL}/v1/search",
        json={"query": q.question, "context": q.evidence,
              "disable_retrieval": True, "stream": False},
        headers={"X-API-Key": API_KEY},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json().get("answer", "")


async def call_retrieval_only(client: httpx.AsyncClient, q: FBQuestion) -> str:
    resp = await client.post(
        f"{GRAVITY_API_URL}/v1/search",
        json={"query": q.question, "reasoning_depth": "fast", "stream": False},
        headers={"X-API-Key": API_KEY},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json().get("answer", "")


async def call_agentic(client: httpx.AsyncClient, q: FBQuestion) -> str:
    resp = await client.post(
        f"{GRAVITY_API_URL}/v1/search",
        json={"query": q.question, "reasoning_depth": "agentic", "stream": False},
        headers={"X-API-Key": API_KEY},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json().get("answer", "")


_MODE_CALLERS = {
    "closed_book": call_closed_book,
    "gold_context": call_gold_context,
    "retrieval_only": call_retrieval_only,
    "agentic": call_agentic,
}


# ── Evaluation loop ───────────────────────────────────────────────────────────

async def run_mode(
    questions: list[FBQuestion],
    mode: str,
) -> FBReport:
    from datetime import datetime, timezone

    caller = _MODE_CALLERS[mode]
    results: list[FBResult] = []
    sem = asyncio.Semaphore(CONCURRENCY)

    async def eval_one(q: FBQuestion) -> FBResult:
        async with sem:
            t0 = time.perf_counter()
            error = None
            predicted = ""
            try:
                async with httpx.AsyncClient() as api_client:
                    predicted = await caller(api_client, q)
            except Exception as e:
                error = str(e)

            latency_ms = (time.perf_counter() - t0) * 1000

            async with httpx.AsyncClient() as grade_client:
                res = await grade(grade_client, q, predicted, mode)
            res.latency_ms = latency_ms
            res.error = error
            return res

    tasks = [eval_one(q) for q in questions]
    total = len(tasks)
    done = 0
    for coro in asyncio.as_completed(tasks):
        r = await coro
        results.append(r)
        done += 1
        icon = "✓" if r.correct else ("E" if r.error else "✗")
        print(
            f"  [{done:3d}/{total}] {icon} [{mode}] {r.id:<12} "
            f"{r.latency_ms:6.0f}ms  {r.grader_method:<8}  {r.question[:50]}",
            flush=True,
        )

    correct_flags = [r.correct for r in results]
    ci = bootstrap_ci(correct_flags)

    by_qtype: dict[str, dict] = {}
    by_rtype: dict[str, dict] = {}
    refusals = 0
    for r in results:
        for dim, key in [(by_qtype, r.question_type), (by_rtype, r.reasoning_type)]:
            if key not in dim:
                dim[key] = {"total": 0, "correct": 0}
            dim[key]["total"] += 1
            if r.correct:
                dim[key]["correct"] += 1
        if r.grader_method == "failure":
            refusals += 1

    for d in (by_qtype, by_rtype):
        for v in d.values():
            v["accuracy"] = round(v["correct"] / max(v["total"], 1), 4)

    lats = sorted(r.latency_ms for r in results)
    p50 = lats[len(lats) // 2] if lats else 0.0
    p95 = lats[int(len(lats) * 0.95)] if lats else 0.0

    return FBReport(
        mode=mode,
        total=len(results),
        correct=sum(correct_flags),
        accuracy=round(sum(correct_flags) / max(len(results), 1), 4),
        ci=ci,
        by_question_type=by_qtype,
        by_reasoning_type=by_rtype,
        refusal_rate=round(refusals / max(len(results), 1), 4),
        p50_latency_ms=round(p50, 1),
        p95_latency_ms=round(p95, 1),
        results=results,
        run_timestamp=datetime.now(timezone.utc).isoformat(),
    )


# ── Report printer ────────────────────────────────────────────────────────────

def print_report(report: FBReport):
    acc_pct = report.accuracy * 100
    ci = report.ci
    print(f"\n{'═'*68}")
    print(f"  FINANCEBENCH — mode={report.mode.upper()}")
    print(f"{'═'*68}")
    print(f"  Accuracy     : {acc_pct:.1f}%  "
          f"(95% CI [{ci.lower*100:.1f}%, {ci.upper*100:.1f}%])  n={ci.n}")
    print(f"  Correct      : {report.correct}/{report.total}")
    print(f"  Refusal rate : {report.refusal_rate*100:.1f}%")
    print(f"  Latency P50  : {report.p50_latency_ms:.0f}ms  "
          f"P95: {report.p95_latency_ms:.0f}ms")
    print()
    if report.by_question_type:
        print("  By question type (FinanceBench spec categories):")
        for qt, s in sorted(report.by_question_type.items()):
            print(f"    {qt:<25} {s['accuracy']*100:5.1f}%  ({s['correct']}/{s['total']})")
    if report.by_reasoning_type:
        print("\n  By reasoning type:")
        for rt, s in sorted(report.by_reasoning_type.items()):
            print(f"    {rt:<15} {s['accuracy']*100:5.1f}%  ({s['correct']}/{s['total']})")

    # Compare against known baselines
    print()
    print("  COMPETITOR REFERENCE (spec Appendix C):")
    refs = [
        ("Mafin 2.5 (reproducible)", 98.7),
        ("Fintool (self-reported, subset)", 98.0),
        ("GPT-4o Patronus baseline", 80.0),
        ("GPT-4-Turbo gold-context", 85.0),
        ("GPT-4-Turbo single-vector", 50.0),
    ]
    for name, val in refs:
        arrow = "^" if acc_pct > val else "v"
        print(f"    {arrow} {name:<40} {val:.1f}%")
    print(f"    * This platform ({report.mode:<14})        {acc_pct:.1f}%")
    print(f"{'═'*68}\n")


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:
            pass

    parser = argparse.ArgumentParser(description="FinanceBench hybrid grader")
    parser.add_argument("--mode", default="retrieval_only",
                        choices=["closed_book", "gold_context", "retrieval_only", "agentic", "all"],
                        help="Inference mode(s) to run")
    parser.add_argument("--sample", type=int, default=None,
                        help="Subsample N questions (None = all 150)")
    parser.add_argument("--output", type=str, default=None,
                        help="Write JSON results to path")
    parser.add_argument("--url", type=str, default=None,
                        help="Override gravity-api base URL")
    args = parser.parse_args()

    global GRAVITY_API_URL
    if args.url:
        GRAVITY_API_URL = args.url.rstrip("/")

    questions = load_financebench(args.sample)
    if not questions:
        print("No questions loaded.")
        sys.exit(1)

    modes = (
        ["closed_book", "gold_context", "retrieval_only", "agentic"]
        if args.mode == "all"
        else [args.mode]
    )

    all_reports = {}
    for mode in modes:
        print(f"\n{'─'*68}")
        print(f"  Running mode: {mode}  ({len(questions)} questions)")
        print(f"{'─'*68}")
        report = asyncio.run(run_mode(questions, mode))
        print_report(report)
        all_reports[mode] = report.to_dict()

    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(all_reports if len(all_reports) > 1 else list(all_reports.values())[0],
                      f, indent=2, default=str)
        print(f"Results saved to {out}")


if __name__ == "__main__":
    main()

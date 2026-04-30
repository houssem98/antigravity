"""
FinQA + ConvFinQA Runner — §Benchmark 2.4
Numerical reasoning evaluation on SEC earnings data.

References:
  FinQA:      arXiv:2109.00122 (EMNLP 2021)  github.com/czyssrs/FinQA
  ConvFinQA:  arXiv:2210.03849 (EMNLP 2022)  github.com/czyssrs/ConvFinQA

Metrics:
  • Execution Accuracy — final numeric answer matches gold exe_ans (±0.5%)
  • Program Accuracy   — predicted DSL program is logically equivalent to gold
                         (allows commutative-operation argument-order reordering)

Usage:
    # FinQA on public dev set (gold context provided)
    python eval/finqa_runner.py --dataset finqa --split dev \
        --data-dir data/finqa --api-url http://localhost:3002 \
        --output results/finqa_dev.json

    # ConvFinQA dev set
    python eval/finqa_runner.py --dataset convfinqa --split dev \
        --data-dir data/convfinqa --api-url http://localhost:3002 \
        --output results/convfinqa_dev.json

    # Aiera noise-corrected subset (91 human-verified pairs)
    python eval/finqa_runner.py --dataset finqa --aiera \
        --data-dir data/finqa --api-url http://localhost:3002

Data preparation (run once):
    git clone https://github.com/czyssrs/FinQA data/finqa
    git clone https://github.com/czyssrs/ConvFinQA data/convfinqa
    # Aiera-verified: huggingface.co/datasets/Aiera/finqa-verified (91 pairs)
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
import statistics
import sys
import time
import urllib.request
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# ─── DSL definitions ─────────────────────────────────────────────────────────

DSL_OPS = {
    "add":           lambda a, b: a + b,
    "subtract":      lambda a, b: a - b,
    "multiply":      lambda a, b: a * b,
    "divide":        lambda a, b: a / b if b != 0 else float("nan"),
    "exp":           lambda a, b: a ** b,
    "greater":       lambda a, b: 1.0 if a > b else 0.0,
    "table-max":     lambda *args: max(args),
    "table-min":     lambda *args: min(args),
    "table-sum":     lambda *args: sum(args),
    "table-average": lambda *args: sum(args) / len(args) if args else float("nan"),
}

COMMUTATIVE_OPS = {"add", "multiply"}


# ─── Data loading ─────────────────────────────────────────────────────────────

def _load_finqa(data_dir: Path, split: str) -> list[dict]:
    path = data_dir / "dataset" / f"{split}.json"
    if not path.exists():
        alt = data_dir / f"{split}.json"
        if alt.exists():
            path = alt
        else:
            raise FileNotFoundError(f"FinQA {split} set not found at {path}")
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def _load_convfinqa(data_dir: Path, split: str) -> list[dict]:
    path = data_dir / "data" / f"{split}.json"
    if not path.exists():
        path = data_dir / f"{split}.json"
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def _load_aiera(data_dir: Path) -> list[dict]:
    """Aiera-verified 91-pair subset (HF: Aiera/finqa-verified)."""
    path = data_dir / "aiera_verified.json"
    if not path.exists():
        raise FileNotFoundError(
            f"Aiera-verified subset not found at {path}. "
            f"Download from huggingface.co/datasets/Aiera/finqa-verified"
        )
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


# ─── DSL program parser / executor ────────────────────────────────────────────

_STEP_RE = re.compile(
    r"(table-max|table-min|table-sum|table-average|add|subtract|multiply|divide|greater|exp)"
    r"\s*\(\s*(.*?)\s*\)\s*",
    re.IGNORECASE,
)
_NUM_RE  = re.compile(r"#(\d+)")  # reference to prior step result


def _execute_program(program_str: str, table: list[list] | None = None) -> Optional[float]:
    """
    Execute a FinQA DSL program string and return the final numeric result.
    Returns None if the program cannot be parsed or execution errors.

    Program format example:
        "subtract(table_max(table_1_col_2), table_min(table_1_col_2)), divide(#0, const_1)"
    or FinQANet format:
        "subtract(2323, 2100), divide(#0, 2100)"
    """
    steps = [s.strip() for s in _STEP_RE.findall(program_str)
             if s] if _STEP_RE.search(program_str) else []

    if not steps:
        # Flat format: "op ( arg1 , arg2 ) op2 ( arg3 , arg4 )"
        steps = re.split(r"\)\s*,?\s*(?=[a-z])", program_str, flags=re.IGNORECASE)

    memo: list[float] = []

    def _resolve(tok: str) -> Optional[float]:
        tok = tok.strip()
        ref = _NUM_RE.fullmatch(tok)
        if ref:
            idx = int(ref.group(1))
            return memo[idx] if idx < len(memo) else None
        tok = tok.replace(",", "")
        if tok.startswith("const_"):
            try:
                return float(tok.split("_", 1)[1])
            except ValueError:
                return None
        try:
            return float(tok)
        except ValueError:
            return None

    for step in steps:
        step = step.strip()
        if not step:
            continue
        m = re.match(
            r"(table-max|table-min|table-sum|table-average|add|subtract|multiply|divide|greater|exp)"
            r"\s*\(\s*(.*)\s*\)",
            step, re.IGNORECASE | re.DOTALL,
        )
        if not m:
            continue
        op   = m.group(1).lower()
        args = [a.strip() for a in m.group(2).split(",")]
        vals: list[float] = []
        for a in args:
            v = _resolve(a)
            if v is None:
                return None
            vals.append(v)
        try:
            result = DSL_OPS[op](*vals)
            memo.append(result)
        except (ZeroDivisionError, KeyError, TypeError):
            return None

    return memo[-1] if memo else None


def _nums_close(a: float, b: float, tol: float = 0.005) -> bool:
    if math.isnan(a) or math.isnan(b):
        return False
    denom = max(abs(a), abs(b), 1e-12)
    return abs(a - b) / denom <= tol


# ─── Program normalization for program accuracy ───────────────────────────────

def _normalize_program(prog: str) -> str:
    """Lowercase, strip whitespace; sort args of commutative ops for canonical form."""
    prog = prog.lower().strip()
    for op in COMMUTATIVE_OPS:
        def _sort_args(m: re.Match) -> str:
            args = sorted(a.strip() for a in m.group(1).split(","))
            return f"{op}({', '.join(args)})"
        prog = re.sub(rf"{op}\(([^)]+)\)", _sort_args, prog)
    return prog


def _programs_equivalent(pred: str, gold: str) -> bool:
    return _normalize_program(pred) == _normalize_program(gold)


# ─── Context builder ──────────────────────────────────────────────────────────

def _build_finqa_context(ex: dict) -> str:
    """Concatenate pre_text + table (as markdown) + post_text."""
    parts: list[str] = []
    if ex.get("pre_text"):
        parts.append(" ".join(ex["pre_text"]))
    if ex.get("table"):
        rows = ex["table"]
        if rows:
            header = " | ".join(str(c) for c in rows[0])
            sep    = " | ".join(["---"] * len(rows[0]))
            body   = "\n".join(" | ".join(str(c) for c in row) for row in rows[1:])
            parts.append(f"{header}\n{sep}\n{body}")
    if ex.get("post_text"):
        parts.append(" ".join(ex["post_text"]))
    return "\n\n".join(parts)


def _build_convfinqa_context(conv: dict) -> str:
    """First turn context (pre_text + table + post_text), shared across turns."""
    return _build_finqa_context(conv.get("annotation", conv))


# ─── API call ─────────────────────────────────────────────────────────────────

def _call_api(api_url: str, prompt: str, max_tokens: int = 256,
              model: str = "claude-haiku-4-5-20251001") -> tuple[str, float]:
    payload = json.dumps({
        "provider":   "anthropic",
        "model":      model,
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
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
        return data.get("text", ""), (time.perf_counter() - t0) * 1000
    except Exception as exc:
        return f"ERROR: {exc}", (time.perf_counter() - t0) * 1000


def _extract_answer(text: str) -> Optional[float]:
    """Extract the first number from model output as the final answer."""
    # Look for explicit "Answer: X" pattern first
    m = re.search(r"(?:answer|result|final)\s*[:\=]\s*(-?[\d,]+\.?\d*)", text, re.IGNORECASE)
    if m:
        try:
            return float(m.group(1).replace(",", ""))
        except ValueError:
            pass
    nums = re.findall(r"-?[\d,]+\.?\d+", text.replace(",", ""))
    if nums:
        try:
            return float(nums[-1])   # last number tends to be the answer
        except ValueError:
            pass
    return None


# ─── Result types ─────────────────────────────────────────────────────────────

@dataclass
class FinQAResult:
    example_id:       str
    question:         str
    gold_answer:      float
    gold_program:     str
    pred_answer:      Optional[float]
    pred_program:     str
    exec_correct:     bool
    prog_correct:     bool
    latency_ms:       float
    error:            str = ""


@dataclass
class ConvFinQAResult:
    conv_id:          str
    turn_results:     list[FinQAResult]
    turn_exec_acc:    float   # fraction of turns with correct answer
    turn_prog_acc:    float


@dataclass
class FinQAReport:
    dataset:          str     # "finqa" | "convfinqa"
    split:            str
    n_examples:       int
    n_turns:          int     # equals n_examples for FinQA, sum of turns for ConvFinQA
    exec_accuracy:    float
    prog_accuracy:    float
    ci_exec_95:       tuple[float, float]
    ci_prog_95:       tuple[float, float]
    aiera_subset:     bool
    results:          list[FinQAResult]
    ran_at:           str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def summary(self) -> str:
        lines = [
            f"{'FinQA' if self.dataset == 'finqa' else 'ConvFinQA'} — "
            f"{self.split}{'  [Aiera-verified]' if self.aiera_subset else ''}",
            f"  n={self.n_turns} turns from {self.n_examples} examples",
            f"  Execution accuracy : {self.exec_accuracy*100:.1f}%  "
            f"95% CI [{self.ci_exec_95[0]*100:.1f}%, {self.ci_exec_95[1]*100:.1f}%]",
            f"  Program  accuracy  : {self.prog_accuracy*100:.1f}%  "
            f"95% CI [{self.ci_prog_95[0]*100:.1f}%, {self.ci_prog_95[1]*100:.1f}%]",
        ]
        # Reference baselines
        if self.dataset == "finqa":
            lines.append(
                "  Reference (post-fix): FinQANet-RoBERTa-large 61.24% exec / 58.86% prog; "
                "GPT-4 ~76% exec"
            )
        else:
            lines.append("  Reference: GPT-4 PoT/CoT ~76–78% exec on dev set")
        errors = [r for r in self.results if r.error]
        if errors:
            lines.append(f"  Errors: {len(errors)}")
        return "\n".join(lines)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["ci_exec_95"] = list(self.ci_exec_95)
        d["ci_prog_95"] = list(self.ci_prog_95)
        return d


# ─── Bootstrap CI ─────────────────────────────────────────────────────────────

def _bootstrap_ci(values: list[float], n_boot: int = 2000, seed: int = 42) -> tuple[float, float]:
    if not values:
        return (0.0, 0.0)
    rng  = random.Random(seed)
    n    = len(values)
    boot = sorted(statistics.mean(rng.choices(values, k=n)) for _ in range(n_boot))
    return (boot[int(0.025 * n_boot)], boot[int(0.975 * n_boot)])


# ─── FinQA runner ─────────────────────────────────────────────────────────────

def _finqa_prompt(context: str, question: str, gold_program: str = "") -> str:
    prog_hint = (
        f"\n\nThe solution uses this arithmetic program (for reference):\n  {gold_program}"
        if gold_program else ""
    )
    return (
        "You are a financial analyst. Use the provided context to answer the question.\n"
        "Respond with ONLY the final numeric answer (e.g. '12.5%' or '$4.2B' or '0.42')."
        f"{prog_hint}\n\n"
        f"Context:\n{context}\n\nQuestion: {question}\n\nFinal answer:"
    )


def run_finqa(
    data_dir:   Path,
    api_url:    str,
    split:      str      = "dev",
    aiera:      bool     = False,
    sample:     int | None = None,
    seed:       int      = 42,
    model:      str      = "claude-haiku-4-5-20251001",
    gold_context: bool   = True,   # always true for spec §2.4 canonical setting
) -> FinQAReport:
    examples = _load_aiera(data_dir) if aiera else _load_finqa(data_dir, split)
    if sample and sample < len(examples):
        rng = random.Random(seed)
        examples = rng.sample(examples, sample)

    results: list[FinQAResult] = []

    for ex in examples:
        qa       = ex.get("qa", ex)
        eid      = ex.get("id", qa.get("uid", ""))
        question = qa.get("question", "")
        gold_exe = qa.get("exe_ans")
        gold_prog = qa.get("program", "")

        # Gold execution answer — may be string like "yes/no" or numeric
        if isinstance(gold_exe, str):
            try:
                gold_float = float(gold_exe.replace(",", "").replace("%", ""))
            except ValueError:
                gold_float = None
        else:
            gold_float = float(gold_exe) if gold_exe is not None else None

        context = _build_finqa_context(ex) if gold_context else ""
        prompt  = _finqa_prompt(context, question)

        pred_text, latency = _call_api(api_url, prompt, model=model)
        pred_float = _extract_answer(pred_text)

        exec_ok = (
            gold_float is not None
            and pred_float is not None
            and _nums_close(pred_float, gold_float)
        )

        # Program accuracy: extract DSL from pred_text if the model outputs one
        pred_prog_m = re.search(
            r"((?:add|subtract|multiply|divide|exp|greater|table-\w+)\s*\(.*?\)(?:,\s*(?:add|subtract|multiply|divide|exp|greater|table-\w+)\s*\(.*?\))*)",
            pred_text, re.IGNORECASE | re.DOTALL,
        )
        pred_prog = pred_prog_m.group(1).strip() if pred_prog_m else ""
        prog_ok   = bool(gold_prog and pred_prog and _programs_equivalent(pred_prog, gold_prog))

        results.append(FinQAResult(
            example_id=eid,
            question=question,
            gold_answer=gold_float or float("nan"),
            gold_program=gold_prog,
            pred_answer=pred_float,
            pred_program=pred_prog,
            exec_correct=exec_ok,
            prog_correct=prog_ok,
            latency_ms=latency,
        ))

    exec_vals = [1.0 if r.exec_correct else 0.0 for r in results if not r.error]
    prog_vals = [1.0 if r.prog_correct else 0.0 for r in results if not r.error]

    return FinQAReport(
        dataset="finqa",
        split="aiera" if aiera else split,
        n_examples=len(examples),
        n_turns=len(results),
        exec_accuracy=statistics.mean(exec_vals) if exec_vals else 0.0,
        prog_accuracy=statistics.mean(prog_vals) if prog_vals else 0.0,
        ci_exec_95=_bootstrap_ci(exec_vals),
        ci_prog_95=_bootstrap_ci(prog_vals),
        aiera_subset=aiera,
        results=results,
    )


# ─── ConvFinQA runner ─────────────────────────────────────────────────────────

def run_convfinqa(
    data_dir:   Path,
    api_url:    str,
    split:      str    = "dev",
    sample:     int | None = None,
    seed:       int    = 42,
    model:      str    = "claude-haiku-4-5-20251001",
) -> FinQAReport:
    conversations = _load_convfinqa(data_dir, split)
    if sample and sample < len(conversations):
        rng = random.Random(seed)
        conversations = rng.sample(conversations, sample)

    all_results: list[FinQAResult] = []

    for conv in conversations:
        context    = _build_convfinqa_context(conv)
        conv_id    = conv.get("id", "")
        turns      = conv.get("qa", [])
        if isinstance(turns, dict):
            turns = [turns]

        history: list[tuple[str, str]] = []  # [(q, a)] prior turns for conversational context

        for turn in turns:
            question   = turn.get("question", "")
            gold_exe   = turn.get("exe_ans")
            gold_prog  = turn.get("program", "")
            eid        = f"{conv_id}_t{len(history)}"

            try:
                gold_float = float(str(gold_exe).replace(",", "").replace("%", ""))
            except (ValueError, TypeError):
                gold_float = None

            # Build conversational prompt with history
            history_str = "\n".join(
                f"Q: {q}\nA: {a}" for q, a in history[-3:]  # last 3 turns
            )
            hist_prefix = f"Prior conversation:\n{history_str}\n\n" if history_str else ""
            prompt = (
                "You are a financial analyst. Use the provided context to answer.\n"
                "Respond with ONLY the final numeric answer.\n\n"
                f"Context:\n{context}\n\n{hist_prefix}Question: {question}\n\nFinal answer:"
            )

            pred_text, latency = _call_api(api_url, prompt, model=model)
            pred_float = _extract_answer(pred_text)

            exec_ok = (
                gold_float is not None
                and pred_float is not None
                and _nums_close(pred_float, gold_float)
            )

            pred_prog_m = re.search(
                r"((?:add|subtract|multiply|divide|exp|greater|table-\w+)\s*\(.*?\)(?:,\s*(?:add|subtract|multiply|divide|exp|greater|table-\w+)\s*\(.*?\))*)",
                pred_text, re.IGNORECASE,
            )
            pred_prog = pred_prog_m.group(1).strip() if pred_prog_m else ""
            prog_ok   = bool(gold_prog and pred_prog and _programs_equivalent(pred_prog, gold_prog))

            all_results.append(FinQAResult(
                example_id=eid,
                question=question,
                gold_answer=gold_float or float("nan"),
                gold_program=gold_prog,
                pred_answer=pred_float,
                pred_program=pred_prog,
                exec_correct=exec_ok,
                prog_correct=prog_ok,
                latency_ms=latency,
            ))

            history.append((question, pred_text.strip()[:200]))

    exec_vals = [1.0 if r.exec_correct else 0.0 for r in all_results if not r.error]
    prog_vals = [1.0 if r.prog_correct else 0.0 for r in all_results if not r.error]

    return FinQAReport(
        dataset="convfinqa",
        split=split,
        n_examples=len(conversations),
        n_turns=len(all_results),
        exec_accuracy=statistics.mean(exec_vals) if exec_vals else 0.0,
        prog_accuracy=statistics.mean(prog_vals) if prog_vals else 0.0,
        ci_exec_95=_bootstrap_ci(exec_vals),
        ci_prog_95=_bootstrap_ci(prog_vals),
        aiera_subset=False,
        results=all_results,
    )


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main() -> None:
    p = argparse.ArgumentParser(description="FinQA + ConvFinQA runner (§2.4)")
    p.add_argument("--dataset",   choices=["finqa", "convfinqa"], default="finqa")
    p.add_argument("--split",     default="dev",
                   help="'train', 'dev', or 'test' (test gold not released for ConvFinQA)")
    p.add_argument("--data-dir",  type=Path, required=True,
                   help="Root of czyssrs/FinQA or czyssrs/ConvFinQA clone")
    p.add_argument("--api-url",   default="http://localhost:3002")
    p.add_argument("--model",     default="claude-haiku-4-5-20251001")
    p.add_argument("--sample",    type=int, default=None)
    p.add_argument("--aiera",     action="store_true",
                   help="Use Aiera-verified 91-pair noise-corrected subset (FinQA only)")
    p.add_argument("--seed",      type=int, default=42)
    p.add_argument("--output",    type=Path, default=None)
    args = p.parse_args()

    if args.dataset == "finqa":
        report = run_finqa(
            args.data_dir, args.api_url,
            split=args.split, aiera=args.aiera,
            sample=args.sample, seed=args.seed, model=args.model,
        )
    else:
        if args.aiera:
            p.error("--aiera is only valid for --dataset finqa")
        report = run_convfinqa(
            args.data_dir, args.api_url,
            split=args.split, sample=args.sample, seed=args.seed, model=args.model,
        )

    print(report.summary())

    out = args.output or Path("results") / f"{args.dataset}_{args.split}_{int(time.time())}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report.to_dict(), indent=2), encoding="utf-8")
    print(f"\nSaved → {out}")


if __name__ == "__main__":
    main()

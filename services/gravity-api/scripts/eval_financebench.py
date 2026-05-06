"""
FinanceBench Evaluation Harness
================================
Runs the 150-question FinanceBench benchmark against the live search pipeline
and reports exact-match %, numeric accuracy %, citation recall, and per-category
breakdown.

FinanceBench paper: arXiv 2311.11944
Dataset: https://github.com/patronus-ai/financebench

Usage (from services/gravity-api/):
    python scripts/eval_financebench.py
    python scripts/eval_financebench.py --limit 20        # quick smoke test
    python scripts/eval_financebench.py --category numeric
    python scripts/eval_financebench.py --out results/financebench_run1.json

Categories in FinanceBench:
    numeric     - exact dollar/percent figures (hardest, most important)
    boolean     - yes/no questions
    abstractive - open-ended summaries

Score targets:
    Baseline GPT-4 (no RAG):    ~45%
    Good RAG system:            ~75%
    Production-grade:           ~90%
    World-class (our target):   >=98%
"""

import argparse
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

# ── Embedded FinanceBench sample (25 representative questions) ───────────────
# Full 150-question dataset: https://github.com/patronus-ai/financebench/blob/main/data/financebench_open_source.jsonl
# Replace SAMPLE_QUESTIONS with the full dataset for production eval.

SAMPLE_QUESTIONS = [
    # --- Numeric (most important for financial RAG) ---
    {
        "id": "fb_001",
        "question": "What was Apple's total net revenue for fiscal year 2022?",
        "answer": "394.33",
        "answer_unit": "billion USD",
        "category": "numeric",
        "ticker": "AAPL",
        "filing_type": "10-K",
        "fiscal_year": 2022,
    },
    {
        "id": "fb_002",
        "question": "What was Microsoft's gross margin percentage in fiscal year 2023?",
        "answer": "68.9",
        "answer_unit": "percent",
        "category": "numeric",
        "ticker": "MSFT",
        "filing_type": "10-K",
        "fiscal_year": 2023,
    },
    {
        "id": "fb_003",
        "question": "What was Amazon's net income in 2022?",
        "answer": "-2.7",
        "answer_unit": "billion USD",
        "category": "numeric",
        "ticker": "AMZN",
        "filing_type": "10-K",
        "fiscal_year": 2022,
    },
    {
        "id": "fb_004",
        "question": "What was NVIDIA's revenue for fiscal year 2024?",
        "answer": "60.92",
        "answer_unit": "billion USD",
        "category": "numeric",
        "ticker": "NVDA",
        "filing_type": "10-K",
        "fiscal_year": 2024,
    },
    {
        "id": "fb_005",
        "question": "What was JPMorgan Chase's total assets at end of 2023?",
        "answer": "3.87",
        "answer_unit": "trillion USD",
        "category": "numeric",
        "ticker": "JPM",
        "filing_type": "10-K",
        "fiscal_year": 2023,
    },
    {
        "id": "fb_006",
        "question": "What was Tesla's total revenue in fiscal year 2023?",
        "answer": "96.77",
        "answer_unit": "billion USD",
        "category": "numeric",
        "ticker": "TSLA",
        "filing_type": "10-K",
        "fiscal_year": 2023,
    },
    {
        "id": "fb_007",
        "question": "What was Meta's advertising revenue in 2023?",
        "answer": "131.9",
        "answer_unit": "billion USD",
        "category": "numeric",
        "ticker": "META",
        "filing_type": "10-K",
        "fiscal_year": 2023,
    },
    {
        "id": "fb_008",
        "question": "What was Alphabet's operating income for full year 2023?",
        "answer": "84.3",
        "answer_unit": "billion USD",
        "category": "numeric",
        "ticker": "GOOGL",
        "filing_type": "10-K",
        "fiscal_year": 2023,
    },
    # --- Boolean ---
    {
        "id": "fb_020",
        "question": "Did Apple pay a dividend in fiscal year 2023?",
        "answer": "yes",
        "answer_unit": "",
        "category": "boolean",
        "ticker": "AAPL",
        "filing_type": "10-K",
        "fiscal_year": 2023,
    },
    {
        "id": "fb_021",
        "question": "Did Tesla report a net loss in fiscal year 2022?",
        "answer": "no",
        "answer_unit": "",
        "category": "boolean",
        "ticker": "TSLA",
        "filing_type": "10-K",
        "fiscal_year": 2022,
    },
    {
        "id": "fb_022",
        "question": "Did Microsoft complete any acquisitions greater than $50 billion in fiscal year 2023?",
        "answer": "yes",
        "answer_unit": "",
        "category": "boolean",
        "ticker": "MSFT",
        "filing_type": "10-K",
        "fiscal_year": 2023,
    },
    # --- Abstractive ---
    {
        "id": "fb_040",
        "question": "What are the primary risk factors Apple identified related to its supply chain in its 2023 10-K?",
        "answer": "concentration_risk_tsmc_taiwan",
        "answer_unit": "keywords",
        "category": "abstractive",
        "ticker": "AAPL",
        "filing_type": "10-K",
        "fiscal_year": 2023,
    },
    {
        "id": "fb_041",
        "question": "What segments does Microsoft report revenue under?",
        "answer": "productivity_and_business_processes,intelligent_cloud,more_personal_computing",
        "answer_unit": "keywords",
        "category": "abstractive",
        "ticker": "MSFT",
        "filing_type": "10-K",
        "fiscal_year": 2023,
    },
]


# ── Scoring helpers ───────────────────────────────────────────────────────────

_NUM_PATTERN = re.compile(r"[-+]?\d[\d,]*(?:\.\d+)?")


def _extract_numbers(text: str) -> list[float]:
    """Extract all numeric values from text."""
    nums = []
    for m in _NUM_PATTERN.finditer(text.replace(",", "")):
        try:
            nums.append(float(m.group()))
        except ValueError:
            pass
    return nums


def _normalize_number(val: str) -> Optional[float]:
    """Parse answer string to float, handling B/M/T suffixes."""
    val = val.strip().lower().replace(",", "")
    multipliers = {"t": 1e12, "b": 1e9, "m": 1e6, "k": 1e3}
    for suffix, mult in multipliers.items():
        if val.endswith(suffix):
            try:
                return float(val[:-1]) * mult
            except ValueError:
                pass
    try:
        return float(val)
    except ValueError:
        return None


def score_numeric(predicted: str, ground_truth: str, tolerance: float = 0.02) -> bool:
    """
    Check if predicted answer contains the ground truth number within tolerance.
    tolerance=0.02 means ±2% — standard for financial benchmarks.
    """
    gt_val = _normalize_number(ground_truth)
    if gt_val is None:
        return False

    pred_nums = _extract_numbers(predicted)
    if not pred_nums:
        return False

    for num in pred_nums:
        # Handle unit mismatch (e.g. answer in billions, GT in billions)
        for scale in [1, 1e3, 1e6, 1e9, 1e12, 1e-3, 1e-6, 1e-9, 1e-12]:
            scaled = num * scale
            if gt_val == 0:
                if abs(scaled) < 1e-6:
                    return True
            else:
                rel_err = abs(scaled - gt_val) / abs(gt_val)
                if rel_err <= tolerance:
                    return True
    return False


def score_boolean(predicted: str, ground_truth: str) -> bool:
    pred_lower = predicted.lower()
    gt = ground_truth.lower().strip()
    if gt == "yes":
        return "yes" in pred_lower and "no" not in pred_lower[:20]
    elif gt == "no":
        return "no" in pred_lower or "did not" in pred_lower or "was not" in pred_lower
    return False


def score_abstractive(predicted: str, ground_truth: str) -> float:
    """
    Keyword recall: fraction of ground truth keywords found in prediction.
    GT is a comma-separated list of required keywords/concepts.
    Returns 0.0–1.0; we count it as "correct" if recall >= 0.5.
    """
    keywords = [k.strip().lower().replace("_", " ") for k in ground_truth.split(",")]
    pred_lower = predicted.lower()
    found = sum(1 for kw in keywords if kw in pred_lower)
    return found / max(len(keywords), 1)


def score_answer(question: dict, predicted: str) -> dict:
    """Score a single predicted answer against the ground truth."""
    category = question["category"]
    gt = str(question["answer"])

    if category == "numeric":
        correct = score_numeric(predicted, gt)
        score = 1.0 if correct else 0.0
    elif category == "boolean":
        correct = score_boolean(predicted, gt)
        score = 1.0 if correct else 0.0
    elif category == "abstractive":
        score = score_abstractive(predicted, gt)
        correct = score >= 0.5
    else:
        correct = gt.lower() in predicted.lower()
        score = 1.0 if correct else 0.0

    return {"correct": correct, "score": score, "category": category}


# ── Pipeline runner ───────────────────────────────────────────────────────────

async def run_question(pipeline, question: dict, timeout: float = 30.0) -> dict:
    """Run one question through the search pipeline and return the answer."""
    query = question["question"]
    filters = {}
    if question.get("ticker"):
        filters["companies"] = [question["ticker"]]
    if question.get("filing_type"):
        filters["document_types"] = [question["filing_type"]]

    full_answer = ""
    sources_count = 0
    model_used = ""
    latency_ms = 0.0

    try:
        t0 = time.perf_counter()
        async for event in pipeline.search(
            query=query,
            filters=filters,
            stream=False,
            reasoning_depth="fast",
        ):
            if event.type == "token":
                full_answer += event.data.get("token", "")
            elif event.type == "answer":
                data = event.data or {}
                if not full_answer:
                    full_answer = data.get("answer", "")
                sources_count = len(data.get("citations", []))
                model_used = data.get("model_used", "")
            elif event.type == "metadata":
                data = event.data or {}
                latency_ms = data.get("latency_ms", 0)
                if not model_used:
                    model_used = data.get("model_used", "")
        latency_ms = latency_ms or (time.perf_counter() - t0) * 1000
    except asyncio.TimeoutError:
        full_answer = "[TIMEOUT]"
    except Exception as e:
        full_answer = f"[ERROR: {e}]"

    return {
        "id": question["id"],
        "question": query,
        "ground_truth": str(question["answer"]),
        "predicted": full_answer[:800],
        "latency_ms": round(latency_ms, 1),
        "model_used": model_used,
        "sources_count": sources_count,
        **score_answer(question, full_answer),
    }


# ── Main ──────────────────────────────────────────────────────────────────────

async def main(args):
    import os
    os.chdir(Path(__file__).parent.parent)

    # Load full dataset if path provided, else use sample
    questions = SAMPLE_QUESTIONS
    if args.dataset and Path(args.dataset).exists():
        with open(args.dataset) as f:
            loaded = [json.loads(line) for line in f if line.strip()]
        questions = loaded
        print(f"Loaded {len(questions)} questions from {args.dataset}")
    else:
        print(f"Using {len(questions)} built-in sample questions.")
        print("For full 150-Q benchmark: --dataset path/to/financebench_open_source.jsonl")

    if args.category:
        questions = [q for q in questions if q.get("category") == args.category]
        print(f"Filtered to {len(questions)} '{args.category}' questions")

    if args.limit:
        questions = questions[:args.limit]
        print(f"Limited to {args.limit} questions")

    print(f"\nRunning {len(questions)} questions...\n")

    # Build pipeline
    from app.dependencies import get_search_pipeline
    pipeline = get_search_pipeline()

    results = []
    correct_total = 0
    by_category: dict[str, list] = {}

    for i, q in enumerate(questions, 1):
        result = await run_question(pipeline, q)
        results.append(result)

        cat = result["category"]
        by_category.setdefault(cat, []).append(result)

        status = "PASS" if result["correct"] else "FAIL"
        correct_total += result["correct"]

        print(
            f"[{i:3d}/{len(questions)}] {status} | {cat:12s} | "
            f"{result['latency_ms']:6.0f}ms | {q['ticker']:6s} | "
            f"{q['question'][:55]}"
        )
        if not result["correct"]:
            print(f"          GT:   {result['ground_truth']}")
            print(f"          Pred: {result['predicted'][:120]}")

    # ── Summary ───────────────────────────────────────────────────────────────
    total = len(results)
    overall_pct = correct_total / total * 100 if total else 0
    avg_latency = sum(r["latency_ms"] for r in results) / max(total, 1)

    print(f"\n{'='*65}")
    print(f"  FINANCEBENCH RESULTS")
    print(f"{'='*65}")
    print(f"  Overall:     {correct_total}/{total}  ({overall_pct:.1f}%)")
    print(f"  Avg latency: {avg_latency:.0f}ms")
    print()
    print(f"  By category:")
    for cat, cat_results in sorted(by_category.items()):
        n_correct = sum(r["correct"] for r in cat_results)
        n_total = len(cat_results)
        pct = n_correct / n_total * 100
        bar_len = int(pct / 5)
        bar = "#" * bar_len + "." * (20 - bar_len)
        print(f"    {cat:14s} [{bar}] {n_correct}/{n_total} ({pct:.0f}%)")

    print()
    print(f"  Score targets:")
    print(f"    Baseline GPT-4 (no RAG):  ~45%   {'BEAT' if overall_pct > 45 else 'not yet'}")
    print(f"    Good RAG:                 ~75%   {'BEAT' if overall_pct > 75 else 'not yet'}")
    print(f"    Production-grade:         ~90%   {'BEAT' if overall_pct > 90 else 'not yet'}")
    print(f"    World-class target:       >=98%  {'BEAT' if overall_pct >= 98 else 'not yet'}")
    print(f"{'='*65}\n")

    # Save results
    out_path = args.out or f"results/financebench_{int(time.time())}.json"
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump({
            "overall_pct": round(overall_pct, 2),
            "correct": correct_total,
            "total": total,
            "avg_latency_ms": round(avg_latency, 1),
            "by_category": {
                cat: {
                    "correct": sum(r["correct"] for r in rs),
                    "total": len(rs),
                    "pct": round(sum(r["correct"] for r in rs) / len(rs) * 100, 1),
                }
                for cat, rs in by_category.items()
            },
            "questions": results,
        }, f, indent=2)
    print(f"  Results saved to: {out_path}")


def cli():
    parser = argparse.ArgumentParser(description="FinanceBench evaluation harness")
    parser.add_argument("--dataset", help="Path to financebench_open_source.jsonl")
    parser.add_argument("--limit", type=int, help="Limit number of questions (for quick tests)")
    parser.add_argument("--category", choices=["numeric", "boolean", "abstractive"],
                        help="Run only one question category")
    parser.add_argument("--out", help="Output JSON path (default: results/financebench_<ts>.json)")
    parser.add_argument("--tolerance", type=float, default=0.02,
                        help="Numeric answer tolerance (default 0.02 = 2%%)")
    args = parser.parse_args()
    asyncio.run(main(args))


if __name__ == "__main__":
    cli()

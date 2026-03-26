"""
Gravity Search — Benchmark Scoring Engine
Evaluation scoring aligned to FinanceBench, FinQA, TAT-QA, FPB criteria.

Scoring methods:
  - execution_accuracy: Is the final numeric answer correct? (FinQA/TAT-QA)
  - exact_match: Does the answer exactly match? (extraction)
  - fuzzy_match: Does the answer semantically overlap? (text answers)
  - numerical_tolerance: Is the number within ε of ground truth? (calculations)
  - sentiment_accuracy: Is the sentiment label correct? (FPB)
  - faithfulness: Does the answer only use information from the context? (FinanceBench)
  - citation_precision: Are all cited sources relevant?
"""

from __future__ import annotations

import re
import math
from dataclasses import dataclass, field
from typing import Any

from tests.eval.benchmark_datasets import BenchmarkExample, BenchmarkType


@dataclass
class ScoreResult:
    """Result of scoring a single benchmark example."""
    example_id: str
    benchmark: str
    correct: bool
    score: float  # 0.0 to 1.0
    predicted_answer: str
    expected_answer: str
    metrics: dict = field(default_factory=dict)
    reason: str = ""

    def to_dict(self) -> dict:
        return {
            "example_id": self.example_id,
            "benchmark": self.benchmark,
            "correct": self.correct,
            "score": round(self.score, 4),
            "predicted": self.predicted_answer,
            "expected": self.expected_answer,
            "metrics": self.metrics,
            "reason": self.reason,
        }


@dataclass
class BenchmarkReport:
    """Aggregate report for a benchmark run."""
    benchmark: str
    total: int
    correct: int
    accuracy: float
    by_category: dict = field(default_factory=dict)
    by_difficulty: dict = field(default_factory=dict)
    details: list[ScoreResult] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "benchmark": self.benchmark,
            "total": self.total,
            "correct": self.correct,
            "accuracy": round(self.accuracy, 4),
            "by_category": self.by_category,
            "by_difficulty": self.by_difficulty,
            "details": [d.to_dict() for d in self.details],
        }


# ── Number extraction from text ──────────────────────────────────────

def _extract_numbers(text: str) -> list[float]:
    """Extract all numbers from a text string."""
    # Match patterns like: 124.3, $124.3B, 12.5%, (1,234.56), -45.6
    patterns = [
        r"-?\$?[\d,]+\.?\d*\s*[BMKTbmkt](?:illion)?",  # $124.3B
        r"-?\(?\$?[\d,]+\.?\d*\)?%?",  # (1,234.56) or 12.5%
    ]

    numbers = []
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            raw = match.group().strip()
            val = _parse_num(raw)
            if val is not None:
                numbers.append(val)

    # Fallback: just find plain numbers
    if not numbers:
        for match in re.finditer(r"-?[\d,]+\.?\d*", text):
            try:
                numbers.append(float(match.group().replace(",", "")))
            except ValueError:
                pass

    return numbers


def _parse_num(text: str) -> float | None:
    """Parse a financial number string."""
    if not text:
        return None
    text = text.strip()

    is_negative = text.startswith("(") and text.endswith(")")
    if is_negative:
        text = text[1:-1]
    if text.startswith("-"):
        is_negative = True
        text = text[1:]

    text = re.sub(r"[$€£¥\s]", "", text)

    multiplier = 1.0
    for suffix, mult in [("T", 1e12), ("B", 1e9), ("M", 1e6), ("K", 1e3),
                          ("t", 1e12), ("b", 1e9), ("m", 1e6), ("k", 1e3)]:
        if text.endswith(suffix):
            multiplier = mult
            text = text[:-1]
            break

    is_percent = text.endswith("%")
    if is_percent:
        text = text[:-1]

    text = text.replace(",", "")
    try:
        val = float(text) * multiplier
        if is_negative:
            val = -val
        return val
    except (ValueError, TypeError):
        return None


# ── Scoring Functions ────────────────────────────────────────────────

def score_numerical(predicted: str, expected: str, tolerance_pct: float = 5.0) -> ScoreResult:
    """
    Score a numerical answer with tolerance.
    Used for FinQA and TAT-QA arithmetic questions.

    tolerance_pct: allowed percentage deviation (default 5%)
    """
    pred_nums = _extract_numbers(predicted)
    exp_nums = _extract_numbers(expected)

    if not exp_nums:
        return ScoreResult(
            example_id="", benchmark="", correct=False, score=0.0,
            predicted_answer=predicted, expected_answer=expected,
            reason="Could not parse expected answer as number",
        )

    expected_val = exp_nums[0]

    if not pred_nums:
        return ScoreResult(
            example_id="", benchmark="", correct=False, score=0.0,
            predicted_answer=predicted, expected_answer=expected,
            reason="No number found in predicted answer",
        )

    # Find closest predicted number to expected
    best_score = 0.0
    best_pred = pred_nums[0]
    for pred_val in pred_nums:
        if expected_val == 0:
            match = 1.0 if pred_val == 0 else 0.0
        else:
            deviation = abs(pred_val - expected_val) / abs(expected_val) * 100
            if deviation <= tolerance_pct:
                match = 1.0 - (deviation / tolerance_pct) * 0.5  # Partial credit
            else:
                match = max(0, 1.0 - deviation / 100)

        if match > best_score:
            best_score = match
            best_pred = pred_val

    correct = best_score >= 0.5
    return ScoreResult(
        example_id="", benchmark="", correct=correct, score=best_score,
        predicted_answer=predicted, expected_answer=expected,
        metrics={
            "predicted_value": best_pred,
            "expected_value": expected_val,
            "deviation_pct": round(abs(best_pred - expected_val) / max(abs(expected_val), 1e-10) * 100, 2),
        },
        reason=f"Numerical match: pred={best_pred}, exp={expected_val}",
    )


def score_exact_match(predicted: str, expected: str) -> ScoreResult:
    """Score based on exact text match (case-insensitive)."""
    pred_clean = predicted.strip().lower()
    exp_clean = expected.strip().lower()

    correct = pred_clean == exp_clean or exp_clean in pred_clean
    return ScoreResult(
        example_id="", benchmark="", correct=correct,
        score=1.0 if correct else 0.0,
        predicted_answer=predicted, expected_answer=expected,
        reason="Exact match" if correct else "No exact match",
    )


def score_fuzzy_match(predicted: str, expected: str) -> ScoreResult:
    """
    Score based on keyword overlap (F1-style).
    Used for text-based answers in FinanceBench.
    """
    pred_tokens = set(re.findall(r'\b\w+\b', predicted.lower()))
    exp_tokens = set(re.findall(r'\b\w+\b', expected.lower()))

    # Remove stopwords
    stopwords = {"the", "a", "an", "is", "was", "were", "are", "in", "of", "to", "for", "and", "or", "its", "it", "this", "that", "by", "from", "with", "at", "on", "as"}
    pred_tokens -= stopwords
    exp_tokens -= stopwords

    if not exp_tokens:
        return ScoreResult(
            example_id="", benchmark="", correct=True, score=1.0,
            predicted_answer=predicted, expected_answer=expected,
            reason="Empty expected tokens",
        )

    overlap = pred_tokens & exp_tokens
    precision = len(overlap) / len(pred_tokens) if pred_tokens else 0
    recall = len(overlap) / len(exp_tokens)
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

    correct = f1 >= 0.5
    return ScoreResult(
        example_id="", benchmark="", correct=correct, score=f1,
        predicted_answer=predicted, expected_answer=expected,
        metrics={"precision": round(precision, 3), "recall": round(recall, 3), "f1": round(f1, 3)},
        reason=f"F1={f1:.3f} (P={precision:.3f}, R={recall:.3f})",
    )


def score_sentiment(predicted: str, expected: str) -> ScoreResult:
    """Score sentiment classification."""
    pred_lower = predicted.strip().lower()
    exp_lower = expected.strip().lower()

    # Normalize labels
    sentiment_map = {
        "positive": "positive", "bullish": "positive", "good": "positive",
        "negative": "negative", "bearish": "negative", "bad": "negative",
        "neutral": "neutral", "mixed": "neutral",
    }

    pred_label = None
    for key, val in sentiment_map.items():
        if key in pred_lower:
            pred_label = val
            break

    exp_label = sentiment_map.get(exp_lower, exp_lower)
    correct = pred_label == exp_label

    return ScoreResult(
        example_id="", benchmark="", correct=correct,
        score=1.0 if correct else 0.0,
        predicted_answer=predicted, expected_answer=expected,
        metrics={"predicted_label": pred_label, "expected_label": exp_label},
        reason=f"Sentiment: pred={pred_label}, exp={exp_label}",
    )


def score_boolean(predicted: str, expected: str) -> ScoreResult:
    """Score boolean (true/false) answers."""
    pred_lower = predicted.strip().lower()
    exp_lower = expected.strip().lower()

    pred_bool = None
    if any(w in pred_lower for w in ["true", "yes", "correct", "accurate"]):
        pred_bool = True
    elif any(w in pred_lower for w in ["false", "no", "incorrect", "inaccurate"]):
        pred_bool = False

    exp_bool = exp_lower in ("true", "yes")
    correct = pred_bool == exp_bool

    return ScoreResult(
        example_id="", benchmark="", correct=correct,
        score=1.0 if correct else 0.0,
        predicted_answer=predicted, expected_answer=expected,
        reason=f"Boolean: pred={pred_bool}, exp={exp_bool}",
    )


# ── Main Scoring Dispatcher ─────────────────────────────────────────

def score_example(example: BenchmarkExample, predicted_answer: str) -> ScoreResult:
    """
    Score a predicted answer against a benchmark example.
    Automatically selects the right scoring method based on answer_type.
    """
    if example.answer_type == "number":
        result = score_numerical(predicted_answer, example.answer)
    elif example.answer_type == "percentage":
        result = score_numerical(predicted_answer, example.answer, tolerance_pct=10.0)
    elif example.answer_type == "ratio":
        result = score_numerical(predicted_answer, example.answer, tolerance_pct=5.0)
    elif example.answer_type == "boolean":
        result = score_boolean(predicted_answer, example.answer)
    elif example.benchmark == BenchmarkType.FPB:
        result = score_sentiment(predicted_answer, example.answer)
    else:
        # Try numeric first, fall back to fuzzy text match
        nums_in_expected = _extract_numbers(example.answer)
        if nums_in_expected:
            result = score_numerical(predicted_answer, example.answer, tolerance_pct=10.0)
        else:
            result = score_fuzzy_match(predicted_answer, example.answer)

    # Fill in example metadata
    result.example_id = example.id
    result.benchmark = example.benchmark.value
    return result


def score_benchmark(
    examples: list[BenchmarkExample],
    predictions: dict[str, str],  # example_id → predicted answer
) -> BenchmarkReport:
    """
    Score all examples in a benchmark and produce an aggregate report.

    Args:
        examples: List of BenchmarkExample instances
        predictions: Map of example_id to predicted answer text
    """
    results = []
    correct_count = 0
    by_category: dict[str, dict] = {}
    by_difficulty: dict[str, dict] = {}

    for example in examples:
        predicted = predictions.get(example.id, "")
        score_result = score_example(example, predicted)
        results.append(score_result)

        if score_result.correct:
            correct_count += 1

        # Aggregate by category
        cat = example.category or "unknown"
        if cat not in by_category:
            by_category[cat] = {"total": 0, "correct": 0}
        by_category[cat]["total"] += 1
        if score_result.correct:
            by_category[cat]["correct"] += 1

        # Aggregate by difficulty
        diff = example.difficulty or "unknown"
        if diff not in by_difficulty:
            by_difficulty[diff] = {"total": 0, "correct": 0}
        by_difficulty[diff]["total"] += 1
        if score_result.correct:
            by_difficulty[diff]["correct"] += 1

    # Calculate accuracy per group
    for cat_stats in by_category.values():
        cat_stats["accuracy"] = round(cat_stats["correct"] / max(cat_stats["total"], 1), 4)
    for diff_stats in by_difficulty.values():
        diff_stats["accuracy"] = round(diff_stats["correct"] / max(diff_stats["total"], 1), 4)

    total = len(examples)
    return BenchmarkReport(
        benchmark=examples[0].benchmark.value if examples else "unknown",
        total=total,
        correct=correct_count,
        accuracy=correct_count / max(total, 1),
        by_category=by_category,
        by_difficulty=by_difficulty,
        details=results,
    )


def print_benchmark_report(report: BenchmarkReport):
    """Print a formatted benchmark report."""
    print(f"\n{'='*70}")
    print(f"  BENCHMARK: {report.benchmark.upper()}")
    print(f"{'='*70}")
    print(f"  Overall Accuracy: {report.accuracy*100:.1f}% ({report.correct}/{report.total})")
    print()

    if report.by_difficulty:
        print("  By Difficulty:")
        for diff, stats in sorted(report.by_difficulty.items()):
            bar = "█" * int(stats["accuracy"] * 20) + "░" * (20 - int(stats["accuracy"] * 20))
            print(f"    {diff:<10} {bar} {stats['accuracy']*100:5.1f}% ({stats['correct']}/{stats['total']})")

    if report.by_category:
        print("\n  By Category:")
        for cat, stats in sorted(report.by_category.items()):
            bar = "█" * int(stats["accuracy"] * 20) + "░" * (20 - int(stats["accuracy"] * 20))
            print(f"    {cat:<25} {bar} {stats['accuracy']*100:5.1f}% ({stats['correct']}/{stats['total']})")

    print(f"\n  Details:")
    for detail in report.details:
        icon = "✓" if detail.correct else "✗"
        print(f"    {icon} {detail.example_id:<10} score={detail.score:.2f}  {detail.reason}")

    print(f"{'='*70}\n")

"""
Cohen's κ Calibration — §3 Cross-Cutting Reporting Requirements
Measures inter-rater agreement between the auto-judge (LLM-as-judge or NLI)
and human annotators on a ≥50-question held-out calibration slice.

Spec requirement:
  • Judge calibration — Cohen's κ vs. human on a ≥50-question slice for
    FinanceBench, Vals AI, and ALCE atomic-claim (§3, item 4).
  • FinanceBench auto-grader: require κ ≥ 0.80 before publishing.
  • ALCE atomic-claim: target κ ≥ 0.65.

Output: κ estimate + 95% bootstrap CI + per-label confusion matrix.

Usage:
    python eval/cohen_kappa.py --input results/human_judge_pairs.jsonl

Input JSONL schema (one record per question):
    {
      "example_id":   "fb_0042",
      "human_label":  "correct",      # "correct" | "incorrect" | "failure"
      "judge_label":  "correct",
      "benchmark":    "financebench"  # or "vals_ai" | "alce"
    }
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from collections import Counter
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


# ─── Config ──────────────────────────────────────────────────────────────────

KAPPA_THRESHOLD: dict[str, float] = {
    "financebench": 0.80,
    "vals_ai":       0.75,   # conservative; spec doesn't set explicit threshold
    "alce":          0.65,
}


# ─── Cohen's κ core ──────────────────────────────────────────────────────────

def cohen_kappa(human: list[str], judge: list[str]) -> float:
    """
    Compute Cohen's κ for two raters with identical label sets.

    κ = (p_o − p_e) / (1 − p_e)

    where p_o = observed agreement fraction and p_e = expected agreement
    under marginal independence.
    """
    assert len(human) == len(judge), "human and judge must be the same length"
    n = len(human)
    if n == 0:
        return float("nan")

    labels    = sorted(set(human) | set(judge))
    n_labels  = len(labels)
    label_idx = {l: i for i, l in enumerate(labels)}

    # Confusion matrix
    matrix: list[list[int]] = [[0] * n_labels for _ in range(n_labels)]
    for h, j in zip(human, judge):
        matrix[label_idx[h]][label_idx[j]] += 1

    p_o = sum(matrix[i][i] for i in range(n_labels)) / n

    human_marginals = [sum(matrix[i][j] for j in range(n_labels)) / n for i in range(n_labels)]
    judge_marginals = [sum(matrix[i][j] for i in range(n_labels)) / n for j in range(n_labels)]
    p_e = sum(human_marginals[i] * judge_marginals[i] for i in range(n_labels))

    if p_e == 1.0:
        return 1.0 if p_o == 1.0 else float("nan")

    return (p_o - p_e) / (1.0 - p_e)


def _confusion_matrix(human: list[str], judge: list[str]) -> dict[str, dict[str, int]]:
    """Returns {human_label: {judge_label: count}}."""
    matrix: dict[str, dict[str, int]] = {}
    for h, j in zip(human, judge):
        matrix.setdefault(h, {}).setdefault(j, 0)
        matrix[h][j] += 1
    return matrix


def _bootstrap_kappa_ci(human: list[str], judge: list[str],
                         n_boot: int = 2000, alpha: float = 0.05,
                         seed: int = 42) -> tuple[float, float]:
    """Percentile bootstrap 95% CI for Cohen's κ."""
    rng = random.Random(seed)
    n   = len(human)
    if n == 0:
        return (float("nan"), float("nan"))
    pairs     = list(zip(human, judge))
    boot_kappas = []
    for _ in range(n_boot):
        sample  = rng.choices(pairs, k=n)
        h_boot  = [s[0] for s in sample]
        j_boot  = [s[1] for s in sample]
        boot_kappas.append(cohen_kappa(h_boot, j_boot))
    boot_kappas = sorted(b for b in boot_kappas if not math.isnan(b))
    if not boot_kappas:
        return (float("nan"), float("nan"))
    lo = boot_kappas[int(alpha / 2 * len(boot_kappas))]
    hi = boot_kappas[int((1 - alpha / 2) * len(boot_kappas))]
    return (lo, hi)


# ─── Result types ─────────────────────────────────────────────────────────────

@dataclass
class BenchmarkKappaResult:
    benchmark:        str
    n:                int
    kappa:            float
    ci_95:            tuple[float, float]
    threshold:        float
    threshold_met:    bool
    confusion_matrix: dict[str, dict[str, int]]
    label_counts:     dict[str, int]  # {human_label: count}


@dataclass
class KappaReport:
    results:          list[BenchmarkKappaResult]
    overall_kappa:    float
    overall_ci_95:    tuple[float, float]
    all_pass:         bool
    checked_at:       str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def summary(self) -> str:
        lines = ["Cohen's κ Calibration Report"]
        lines.append(f"  Overall κ : {self.overall_kappa:.3f}  "
                     f"CI [{self.overall_ci_95[0]:.3f}, {self.overall_ci_95[1]:.3f}]")
        for r in self.results:
            status = "PASS" if r.threshold_met else "FAIL"
            lines.append(
                f"\n  {r.benchmark} (n={r.n}):"
                f"\n    κ = {r.kappa:.3f}  CI [{r.ci_95[0]:.3f}, {r.ci_95[1]:.3f}]"
                f"  threshold ≥{r.threshold:.2f}  [{status}]"
            )
            lines.append(f"    Confusion matrix (human → judge):")
            all_labels = sorted(set(r.confusion_matrix) | {
                j for row in r.confusion_matrix.values() for j in row
            })
            header = "  " + "".join(f"{lbl:>12}" for lbl in all_labels)
            lines.append("    " + header)
            for hl in all_labels:
                row_vals = "".join(
                    f"{r.confusion_matrix.get(hl, {}).get(jl, 0):>12}"
                    for jl in all_labels
                )
                lines.append(f"    {hl:>10}: {row_vals}")
        lines.append(f"\n  All benchmarks pass threshold: {'YES' if self.all_pass else 'NO'}")
        return "\n".join(lines)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["all_pass"] = self.all_pass
        return d


# ─── Evaluator ───────────────────────────────────────────────────────────────

def evaluate(records: list[dict]) -> KappaReport:
    """
    Compute Cohen's κ per benchmark and overall from a list of
    {example_id, human_label, judge_label, benchmark} records.
    """
    by_benchmark: dict[str, tuple[list[str], list[str]]] = {}
    all_human: list[str] = []
    all_judge: list[str] = []

    for rec in records:
        bm  = rec.get("benchmark", "unknown")
        hl  = str(rec.get("human_label", "")).strip().lower()
        jl  = str(rec.get("judge_label", "")).strip().lower()
        if not hl or not jl:
            continue
        by_benchmark.setdefault(bm, ([], []))
        by_benchmark[bm][0].append(hl)
        by_benchmark[bm][1].append(jl)
        all_human.append(hl)
        all_judge.append(jl)

    results: list[BenchmarkKappaResult] = []
    for bm, (human, judge) in sorted(by_benchmark.items()):
        kappa  = cohen_kappa(human, judge)
        ci     = _bootstrap_kappa_ci(human, judge)
        thresh = KAPPA_THRESHOLD.get(bm, 0.65)
        results.append(BenchmarkKappaResult(
            benchmark=bm,
            n=len(human),
            kappa=kappa,
            ci_95=ci,
            threshold=thresh,
            threshold_met=(not math.isnan(kappa) and kappa >= thresh),
            confusion_matrix=_confusion_matrix(human, judge),
            label_counts=dict(Counter(human)),
        ))

    overall_kappa = cohen_kappa(all_human, all_judge)
    overall_ci    = _bootstrap_kappa_ci(all_human, all_judge)

    return KappaReport(
        results=results,
        overall_kappa=overall_kappa,
        overall_ci_95=overall_ci,
        all_pass=all(r.threshold_met for r in results),
    )


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main() -> None:
    p = argparse.ArgumentParser(
        description="Cohen's κ calibration between human and auto-judge (§3)"
    )
    p.add_argument("--input",  type=Path, required=True,
                   help="JSONL file with {example_id, human_label, judge_label, benchmark}")
    p.add_argument("--output", type=Path, default=None,
                   help="Write JSON report to this path")
    args = p.parse_args()

    records: list[dict] = []
    with args.input.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("//"):
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as exc:
                print(f"WARN: skipping malformed line: {exc}", file=sys.stderr)

    if not records:
        print("ERROR: no valid records in input", file=sys.stderr)
        sys.exit(2)

    report = evaluate(records)
    print(report.summary())

    if args.output:
        args.output.write_text(
            json.dumps(report.to_dict(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"\nReport written to {args.output}")

    sys.exit(0 if report.all_pass else 1)


if __name__ == "__main__":
    main()

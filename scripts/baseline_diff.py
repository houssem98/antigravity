"""
Compare two deepeval JSON snapshots — detect quality regressions for Hermes rollout.

Usage:
    python scripts/baseline_diff.py baselines/pre-hermes.json baselines/post-phase-1.json

Exit codes:
    0 — within tolerance (safe)
    1 — regression detected (manual review needed)
    2 — critical regression (auto-rollback recommended)
"""

import json
import sys
from pathlib import Path

# Auto-rollback thresholds (relative drops)
ROLLBACK_PASS_RATE_DROP = 0.05      # 5%
ROLLBACK_METRIC_DROP = 0.05         # 5%
ROLLBACK_LATENCY_INCREASE = 0.5     # 50%


def load(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def main():
    if len(sys.argv) != 3:
        print("usage: python baseline_diff.py <baseline.json> <candidate.json>")
        sys.exit(2)

    baseline = load(sys.argv[1])
    candidate = load(sys.argv[2])

    print(f"\n{'='*70}")
    print(f"Baseline:  {Path(sys.argv[1]).name}  ({baseline.get('timestamp')})")
    print(f"Candidate: {Path(sys.argv[2]).name}  ({candidate.get('timestamp')})")
    print(f"{'='*70}\n")

    pass_diff = candidate.get("pass_rate", 0) - baseline.get("pass_rate", 0)
    print(f"Pass rate:  {baseline.get('pass_rate', 0)*100:.1f}% -> {candidate.get('pass_rate', 0)*100:.1f}%  "
          f"({pass_diff*100:+.1f}pt)")

    # Metric-by-metric diff
    b_metrics = baseline.get("metric_averages", {})
    c_metrics = candidate.get("metric_averages", {})
    critical = False
    warnings = []

    for metric, b_score in b_metrics.items():
        c_score = c_metrics.get(metric, 0)
        diff = c_score - b_score
        flag = "  "
        if diff < -ROLLBACK_METRIC_DROP:
            flag = " !"
            critical = True
        elif diff < -0.02:
            flag = " ?"
            warnings.append(metric)
        print(f"{flag} {metric:<28} {b_score:.3f} -> {c_score:.3f}  ({diff:+.3f})")

    print()

    if pass_diff < -ROLLBACK_PASS_RATE_DROP:
        print(f"CRITICAL: pass_rate dropped {-pass_diff*100:.1f}pt (threshold: {ROLLBACK_PASS_RATE_DROP*100:.0f}pt)")
        critical = True

    if critical:
        print("\n=== AUTO-ROLLBACK RECOMMENDED ===")
        print("Run: fly secrets set HERMES_ENABLED=false -a gravity-api-prod && fly deploy")
        sys.exit(2)
    elif warnings:
        print(f"WARN: minor regressions in: {', '.join(warnings)}")
        sys.exit(1)
    else:
        print("OK: within tolerance, safe to proceed.")
        sys.exit(0)


if __name__ == "__main__":
    main()

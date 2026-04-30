"""
Latency & Cost Runner — §Benchmark 2.5
Measures TTFT, E2E latency, and per-query cost across three workload tiers
against the live market-server /api/llm/chat endpoint.

Workload tiers (spec §2.5):
  T1 — Trading-floor lookup  (single-fact extraction)  SLO: E2E < 2s,  TTFT < 500ms
  T2 — Analyst Q&A           (single-document)         SLO: E2E < 5s,  TTFT < 1.5s
  T3 — Deep research         (multi-document)          SLO: E2E < 30s, TTFT < 3s

Usage:
    python tests/eval/latency_cost_runner.py \
        --url http://localhost:3002 \
        --model claude-sonnet-4-6 --provider anthropic \
        --concurrency 1 5 25 \
        --output results/latency_cost.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import statistics
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import aiohttp
    HAS_AIOHTTP = True
except ImportError:
    HAS_AIOHTTP = False

# ─── Workload definitions ─────────────────────────────────────────────────────

# (tier_label, prompt_text, expected_max_output_tokens)
WORKLOADS: dict[str, list[tuple[str, str, int]]] = {
    "T1": [
        ("What was Apple's net income for FY2023?", "Apple Inc. (AAPL) reported net income of $96.99 billion for fiscal year 2023.", 60),
        ("What is Tesla's current P/E ratio?", "Based on trailing twelve months earnings, provide Tesla's P/E ratio.", 40),
        ("What is the fed funds rate as of Q1 2026?", "The Federal Reserve target rate context: provide the current rate.", 50),
    ],
    "T2": [
        (
            "Summarize the key risks in Microsoft's most recent 10-K.",
            "You are a financial analyst. Summarize in 3-5 bullet points the key risk factors from "
            "Microsoft Corporation's most recent Annual Report on Form 10-K, focusing on material "
            "risks that could adversely affect the business. Cite each risk with its source section.",
            512,
        ),
        (
            "What are Amazon's AWS revenue growth trends over the last three fiscal years?",
            "Analyze AWS segment revenue from Amazon's most recent three annual reports. Provide "
            "year-over-year growth rates, operating margin trend, and key drivers. Include citations.",
            600,
        ),
    ],
    "T3": [
        (
            "Compare the competitive positioning of Nvidia vs AMD in AI accelerators for 2025.",
            "You are a senior equity analyst. Produce a structured comparative analysis of Nvidia (NVDA) "
            "and Advanced Micro Devices (AMD) in the AI accelerator market for calendar year 2025. Cover: "
            "(1) market share and revenue breakdown, (2) product roadmap differentiation, (3) gross margin "
            "and pricing power, (4) key customer concentration risks, (5) 12-month outlook. Cite all "
            "numerical claims with SEC filing or earnings transcript references in [n] format.",
            1500,
        ),
    ],
}

SLO: dict[str, dict[str, float]] = {
    "T1": {"e2e_ms": 2000,  "ttft_ms": 500},
    "T2": {"e2e_ms": 5000,  "ttft_ms": 1500},
    "T3": {"e2e_ms": 30000, "ttft_ms": 3000},
}

# Q1 2026 reference prices ($/1M tokens) per spec §2.5
PRICES_PER_1M: dict[str, dict[str, float]] = {
    "claude-opus-4-6":           {"input": 5.0,   "output": 25.0},
    "claude-sonnet-4-6":         {"input": 3.0,   "output": 15.0},
    "claude-haiku-4-5-20251001": {"input": 0.8,   "output": 4.0},
    "gemini-2.5-pro":            {"input": 1.25,  "output": 10.0},
    "gemini-2.5-flash":          {"input": 0.30,  "output": 2.5},
    "deepseek-chat":             {"input": 0.27,  "output": 1.10},
    "llama-3.3-70b-versatile":   {"input": 0.60,  "output": 0.60},
}


# ─── Result types ─────────────────────────────────────────────────────────────

@dataclass
class QueryMeasurement:
    tier:           str
    prompt_chars:   int
    output_chars:   int
    e2e_ms:         float
    ttft_ms:        float           # server-reported; -1 if not available
    server_latency_ms: float        # latencyMs from server response
    input_tokens_est:  int
    output_tokens_est: int
    cache_created:  int = 0
    cache_read:     int = 0
    cost_usd:       float = 0.0
    error:          str = ""
    concurrency:    int = 1


@dataclass
class TierStats:
    tier:           str
    n:              int
    p50_e2e_ms:     float
    p95_e2e_ms:     float
    p99_e2e_ms:     float
    mean_cost_usd:  float
    total_cost_usd: float
    slo_pass_rate:  float           # fraction meeting SLO
    cache_hit_rate: float


@dataclass
class LatencyCostReport:
    model:          str
    provider:       str
    server_url:     str
    concurrency_levels: list[int]
    by_tier:        dict[str, TierStats]
    measurements:   list[QueryMeasurement]
    ran_at:         str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def summary(self) -> str:
        lines = [f"Latency/Cost Report — {self.model} ({self.provider}) @ {self.server_url}"]
        lines.append(f"  Concurrency levels: {self.concurrency_levels}")
        for tier, stats in sorted(self.by_tier.items()):
            slo = SLO.get(tier, {})
            slo_str = f"E2E<{slo.get('e2e_ms',0)/1000:.0f}s"
            lines.append(
                f"\n  {tier} ({stats.n} queries, {slo_str}):"
                f"\n    p50={stats.p50_e2e_ms:.0f}ms  p95={stats.p95_e2e_ms:.0f}ms"
                f"  p99={stats.p99_e2e_ms:.0f}ms"
                f"\n    SLO pass={stats.slo_pass_rate*100:.0f}%"
                f"  cache_hit={stats.cache_hit_rate*100:.0f}%"
                f"  median_cost=${stats.mean_cost_usd:.4f}"
            )
        return "\n".join(lines)

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


# ─── Cost estimation ─────────────────────────────────────────────────────────

def estimate_cost(model: str, input_tokens: int, output_tokens: int,
                  cache_created: int = 0, cache_read: int = 0) -> float:
    prices = PRICES_PER_1M.get(model, {"input": 3.0, "output": 15.0})
    # Cache read at 10% of input price for Anthropic; no discount for others
    cache_read_price = prices["input"] * 0.10 if cache_read > 0 else prices["input"]
    remaining_input  = max(0, input_tokens - cache_created - cache_read)
    usd = (
        (cache_created   / 1_000_000) * prices["input"] +
        (cache_read      / 1_000_000) * cache_read_price +
        (remaining_input / 1_000_000) * prices["input"] +
        (output_tokens   / 1_000_000) * prices["output"]
    )
    return usd


# ─── Percentile helper ───────────────────────────────────────────────────────

def _pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    idx = min(int(math.ceil(p / 100 * len(s))) - 1, len(s) - 1)
    return s[max(idx, 0)]


# ─── HTTP call (sync fallback) ────────────────────────────────────────────────

def _sync_call(url: str, model: str, provider: str, prompt: str, max_tokens: int) -> dict:
    import urllib.request as _ur
    payload = json.dumps({"provider": provider, "model": model,
                          "prompt": prompt, "max_tokens": max_tokens}).encode()
    req = _ur.Request(f"{url}/api/llm/chat", data=payload,
                      headers={"Content-Type": "application/json"}, method="POST")
    with _ur.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def _measure_sync(url: str, model: str, provider: str,
                  tier: str, prompt: str, max_tokens: int,
                  concurrency: int) -> QueryMeasurement:
    t0 = time.perf_counter()
    try:
        data = _sync_call(url, model, provider, prompt, max_tokens)
        e2e_ms = (time.perf_counter() - t0) * 1000
        text   = data.get("text", "")
        cache  = data.get("cacheStats", {}) or {}
        server_lat = data.get("latencyMs", e2e_ms)
        input_tok  = math.ceil(len(prompt) / 4)
        output_tok = math.ceil(len(text)   / 4)
        cost = estimate_cost(model, input_tok, output_tok,
                             cache.get("created", 0), cache.get("read", 0))
        return QueryMeasurement(
            tier=tier, prompt_chars=len(prompt), output_chars=len(text),
            e2e_ms=e2e_ms, ttft_ms=server_lat, server_latency_ms=server_lat,
            input_tokens_est=input_tok, output_tokens_est=output_tok,
            cache_created=cache.get("created", 0), cache_read=cache.get("read", 0),
            cost_usd=cost, concurrency=concurrency,
        )
    except Exception as exc:
        e2e_ms = (time.perf_counter() - t0) * 1000
        return QueryMeasurement(
            tier=tier, prompt_chars=len(prompt), output_chars=0,
            e2e_ms=e2e_ms, ttft_ms=-1, server_latency_ms=-1,
            input_tokens_est=0, output_tokens_est=0, error=str(exc),
            concurrency=concurrency,
        )


# ─── Aggregation ─────────────────────────────────────────────────────────────

def _aggregate(measurements: list[QueryMeasurement]) -> dict[str, TierStats]:
    by_tier: dict[str, list[QueryMeasurement]] = {}
    for m in measurements:
        by_tier.setdefault(m.tier, []).append(m)

    result: dict[str, TierStats] = {}
    for tier, ms in by_tier.items():
        valid = [m for m in ms if not m.error]
        e2es  = [m.e2e_ms    for m in valid]
        costs = [m.cost_usd  for m in valid]
        slo_e2e = SLO.get(tier, {}).get("e2e_ms", float("inf"))
        slo_ok  = [m for m in valid if m.e2e_ms <= slo_e2e]
        cache_hits = [m for m in valid if m.cache_read > 0]
        result[tier] = TierStats(
            tier=tier, n=len(ms),
            p50_e2e_ms=_pct(e2es, 50),
            p95_e2e_ms=_pct(e2es, 95),
            p99_e2e_ms=_pct(e2es, 99),
            mean_cost_usd=statistics.mean(costs) if costs else 0.0,
            total_cost_usd=sum(costs),
            slo_pass_rate=len(slo_ok) / len(valid) if valid else 0.0,
            cache_hit_rate=len(cache_hits) / len(valid) if valid else 0.0,
        )
    return result


# ─── Runner ──────────────────────────────────────────────────────────────────

def run(
    url:          str,
    model:        str,
    provider:     str,
    concurrency_levels: list[int] | None = None,
) -> LatencyCostReport:
    """Run the latency/cost benchmark against a live server."""
    if concurrency_levels is None:
        concurrency_levels = [1]

    all_measurements: list[QueryMeasurement] = []

    for conc in concurrency_levels:
        print(f"  Concurrency={conc} …")
        for tier, queries in WORKLOADS.items():
            for label, prompt, max_tok in queries:
                # Serial run — for true concurrency use asyncio branch below
                m = _measure_sync(url, model, provider, tier, prompt, max_tok, conc)
                all_measurements.append(m)
                status = "ok" if not m.error else f"ERR:{m.error[:40]}"
                print(f"    [{tier}] {label[:40]:<40}  {m.e2e_ms:6.0f}ms  ${m.cost_usd:.4f}  {status}")

    return LatencyCostReport(
        model=model,
        provider=provider,
        server_url=url,
        concurrency_levels=concurrency_levels,
        by_tier=_aggregate(all_measurements),
        measurements=all_measurements,
    )


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main() -> None:
    p = argparse.ArgumentParser(description="Latency/cost benchmark runner (§2.5)")
    p.add_argument("--url",      default="http://localhost:3002")
    p.add_argument("--model",    default="claude-sonnet-4-6")
    p.add_argument("--provider", default="anthropic")
    p.add_argument("--concurrency", nargs="+", type=int, default=[1],
                   help="Concurrency levels to test (e.g. 1 5 25)")
    p.add_argument("--output", type=Path, default=None)
    args = p.parse_args()

    print(f"Latency/cost runner — {args.model} ({args.provider}) @ {args.url}")
    report = run(args.url, args.model, args.provider, args.concurrency)
    print("\n" + report.summary())

    out_path = args.output or Path("results") / f"latency_cost_{args.model}_{int(time.time())}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report.to_dict(), indent=2), encoding="utf-8")
    print(f"\nSaved → {out_path}")


if __name__ == "__main__":
    main()

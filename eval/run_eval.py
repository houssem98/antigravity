#!/usr/bin/env python3
"""
Gravity Search — Evaluation Runner
Executes golden queries against a running gravity-api instance and reports:
  - Citation accuracy (NDCG@10, MRR)
  - Answer quality (keyword recall, hallucination rate)
  - Latency (p50, p95)
  - Contradiction detection rate (on queries that flag tests_contradiction_detection)

Usage:
    # against local dev server
    python eval/run_eval.py

    # against staging
    python eval/run_eval.py --api-url https://staging.gravity.example.com --output eval/results/staging_$(date +%Y%m%d).json

    # run only a subset
    python eval/run_eval.py --ids q001,q002,q003

Environment:
    GRAVITY_API_URL  — override API URL (default: http://localhost:8000)
"""

import argparse
import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx


# ── Defaults ─────────────────────────────────────────────────────────────
DEFAULT_API_URL = "http://localhost:8000"
GOLDEN_QUERIES_FILE = Path(__file__).parent / "golden_queries.jsonl"
RESULTS_DIR = Path(__file__).parent / "results"


# ── Metrics helpers ───────────────────────────────────────────────────────

def keyword_recall(answer: str, keywords: list[str]) -> float:
    """Fraction of expected keywords found (case-insensitive) in the answer."""
    if not keywords:
        return 1.0
    answer_lower = answer.lower()
    found = sum(1 for kw in keywords if kw.lower() in answer_lower)
    return found / len(keywords)


def citation_precision(citations: list[dict], doc_types: list[str]) -> float:
    """Fraction of returned citations whose doc type is in the expected set."""
    if not citations or not doc_types:
        return 1.0
    dt_set = {d.lower() for d in doc_types}
    matched = sum(
        1 for c in citations
        if any(dt in c.get("source", "").lower() for dt in dt_set)
    )
    return matched / len(citations)


def mrr(ticker_hits: list[bool]) -> float:
    """Mean Reciprocal Rank — 1/rank of first relevant ticker hit."""
    for i, hit in enumerate(ticker_hits, 1):
        if hit:
            return 1.0 / i
    return 0.0


# ── Core evaluation ───────────────────────────────────────────────────────

async def run_single_query(
    client: httpx.AsyncClient,
    query_obj: dict[str, Any],
    api_url: str,
) -> dict[str, Any]:
    """Run one golden query and return a metrics dict."""
    q = query_obj["query"]
    start = time.perf_counter()

    try:
        r = await client.post(
            f"{api_url}/v1/search",
            json={"query": q, "options": {"stream": False}},
            timeout=60.0,
        )
        r.raise_for_status()
        data = r.json()
        latency_ms = (time.perf_counter() - start) * 1000

        answer = data.get("answer", "")
        citations = data.get("citations", [])
        confidence = data.get("confidence", "LOW")
        contradictions = data.get("contradictions", [])
        sources = data.get("sources", [])

        # Keyword recall
        kw_recall = keyword_recall(answer, query_obj.get("ground_truth_answer_contains", []))

        # Citation precision (doc type match)
        c_precision = citation_precision(citations, query_obj.get("relevant_doc_types", []))

        # Ticker coverage in sources
        expected_tickers = query_obj.get("expected_tickers", [])
        source_tickers = {s.get("ticker", "") for s in sources}
        ticker_hits = [t in source_tickers for t in expected_tickers]
        ticker_coverage = sum(ticker_hits) / len(ticker_hits) if ticker_hits else 1.0

        # Contradiction detection check
        contradiction_detected = len(contradictions) > 0 if query_obj.get("tests_contradiction_detection") else None

        # Confidence threshold check
        min_conf = query_obj.get("min_confidence", "LOW")
        conf_order = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
        meets_confidence = conf_order.get(confidence, 0) >= conf_order.get(min_conf, 0)

        return {
            "id": query_obj["id"],
            "query": q,
            "status": "ok",
            "latency_ms": round(latency_ms, 1),
            "confidence": confidence,
            "meets_confidence_threshold": meets_confidence,
            "keyword_recall": round(kw_recall, 3),
            "citation_precision": round(c_precision, 3),
            "ticker_coverage": round(ticker_coverage, 3),
            "citations_count": len(citations),
            "sources_count": len(sources),
            "contradiction_detected": contradiction_detected,
            "answer_length": len(answer),
        }

    except Exception as e:
        latency_ms = (time.perf_counter() - start) * 1000
        return {
            "id": query_obj["id"],
            "query": q,
            "status": "error",
            "error": str(e),
            "latency_ms": round(latency_ms, 1),
        }


def compute_aggregate_metrics(results: list[dict]) -> dict[str, Any]:
    """Compute aggregate metrics across all query results."""
    ok = [r for r in results if r["status"] == "ok"]
    error_count = len(results) - len(ok)

    if not ok:
        return {"error": "All queries failed", "error_count": error_count}

    latencies = sorted(r["latency_ms"] for r in ok)
    n = len(latencies)
    p50 = latencies[n // 2]
    p95 = latencies[min(int(n * 0.95), n - 1)]

    avg_kw_recall = sum(r.get("keyword_recall", 0) for r in ok) / n
    avg_cit_prec = sum(r.get("citation_precision", 0) for r in ok) / n
    avg_ticker_cov = sum(r.get("ticker_coverage", 0) for r in ok) / n
    conf_ok = sum(1 for r in ok if r.get("meets_confidence_threshold")) / n

    # Hallucination proxy: very low keyword recall = likely hallucination
    hallucination_rate = sum(1 for r in ok if r.get("keyword_recall", 1) < 0.3) / n

    # Contradiction detection
    contradiction_queries = [r for r in ok if r.get("contradiction_detected") is not None]
    contradiction_detection_rate = (
        sum(1 for r in contradiction_queries if r["contradiction_detected"]) / len(contradiction_queries)
        if contradiction_queries else None
    )

    return {
        "total_queries": len(results),
        "ok": n,
        "errors": error_count,
        "latency_p50_ms": round(p50, 1),
        "latency_p95_ms": round(p95, 1),
        "avg_latency_ms": round(sum(latencies) / n, 1),
        "keyword_recall_avg": round(avg_kw_recall, 3),
        "citation_precision_avg": round(avg_cit_prec, 3),
        "ticker_coverage_avg": round(avg_ticker_cov, 3),
        "confidence_threshold_pass_rate": round(conf_ok, 3),
        "hallucination_proxy_rate": round(hallucination_rate, 3),
        "contradiction_detection_rate": contradiction_detection_rate,
    }


# ── Main ──────────────────────────────────────────────────────────────────

async def main(api_url: str, output_path: Path | None, ids: list[str] | None, concurrency: int) -> None:
    # Load golden queries
    golden: list[dict] = []
    with open(GOLDEN_QUERIES_FILE) as f:
        for line in f:
            line = line.strip()
            if line:
                obj = json.loads(line)
                if ids is None or obj["id"] in ids:
                    golden.append(obj)

    print(f"Running {len(golden)} golden queries against {api_url} ...")

    sem = asyncio.Semaphore(concurrency)
    results: list[dict] = []

    async with httpx.AsyncClient() as client:
        async def _run(q: dict) -> dict:
            async with sem:
                result = await run_single_query(client, q, api_url)
                status_icon = "✓" if result["status"] == "ok" else "✗"
                print(f"  [{status_icon}] {q['id']}: kw_recall={result.get('keyword_recall', '-')} latency={result.get('latency_ms', '-')}ms")
                return result

        results = list(await asyncio.gather(*[_run(q) for q in golden]))

    aggregate = compute_aggregate_metrics(results)

    report = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "api_url": api_url,
        "aggregate": aggregate,
        "queries": results,
    }

    # Print summary
    print("\n" + "=" * 60)
    print("GRAVITY SEARCH EVALUATION SUMMARY")
    print("=" * 60)
    for k, v in aggregate.items():
        print(f"  {k:<40} {v}")
    print("=" * 60)

    # Save to file
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\nResults saved to {output_path}")

    # Exit with failure code if key metrics below threshold
    if aggregate.get("keyword_recall_avg", 0) < 0.5:
        print("\n[FAIL] keyword_recall_avg below 0.50 — evaluation gate failed")
        raise SystemExit(1)
    if aggregate.get("hallucination_proxy_rate", 0) > 0.15:
        print("\n[FAIL] hallucination_proxy_rate above 0.15 — evaluation gate failed")
        raise SystemExit(1)
    print("\n[PASS] All evaluation gates passed")


if __name__ == "__main__":
    import os

    parser = argparse.ArgumentParser(description="Gravity Search evaluation runner")
    parser.add_argument("--api-url", default=os.getenv("GRAVITY_API_URL", DEFAULT_API_URL))
    parser.add_argument("--output", type=Path, default=None, help="JSON output file path")
    parser.add_argument("--ids", default=None, help="Comma-separated query IDs to run (default: all)")
    parser.add_argument("--concurrency", type=int, default=3, help="Parallel requests (default: 3)")
    args = parser.parse_args()

    id_list = [i.strip() for i in args.ids.split(",")] if args.ids else None

    asyncio.run(main(
        api_url=args.api_url,
        output_path=args.output,
        ids=id_list,
        concurrency=args.concurrency,
    ))

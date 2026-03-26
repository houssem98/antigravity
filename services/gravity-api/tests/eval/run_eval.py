"""
Gravity Search — Evaluation Harness
Runs all golden queries through the live search pipeline and measures quality.

Usage:
    cd backend
    uv run python tests/eval/run_eval.py [--url http://localhost:8000] [--verbose]

Outputs:
    - Per-query table: latency, confidence, answer snippet
    - Aggregate metrics: MRR, NDCG@5, p95 latency
    - Writes results to tests/eval/results_<timestamp>.json
"""

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx

GOLDEN_QUERIES_PATH = Path(__file__).parent / "golden_queries.json"
RESULTS_DIR = Path(__file__).parent


def load_golden_queries() -> list[dict]:
    with open(GOLDEN_QUERIES_PATH) as f:
        data = json.load(f)
    return data["queries"]


async def run_query(
    client: httpx.AsyncClient,
    base_url: str,
    query: dict,
    verbose: bool = False,
) -> dict:
    """Run a single query against the search API and collect results."""
    start = time.time()
    result = {
        "query_id": query["id"],
        "query": query["query"],
        "category": query.get("category", "unknown"),
        "expected_sources": query.get("expected_sources", []),
        "latency_ms": 0,
        "answer": "",
        "confidence": 0.0,
        "sources": [],
        "from_cache": False,
        "error": None,
    }

    try:
        response = await client.post(
            f"{base_url}/v1/search",
            json={
                "query": query["query"],
                "response_format": "json",
                "max_sources": 10,
            },
            timeout=60.0,
        )
        latency_ms = (time.time() - start) * 1000
        result["latency_ms"] = round(latency_ms, 1)

        if response.status_code != 200:
            result["error"] = f"HTTP {response.status_code}: {response.text[:200]}"
            return result

        data = response.json()
        result["answer"] = data.get("answer", "")
        result["confidence"] = data.get("confidence", 0.0)
        result["sources"] = data.get("sources", [])
        result["from_cache"] = data.get("from_cache", False)

        if verbose:
            print(f"\n  Query: {query['query'][:60]}...")
            print(f"  Answer: {result['answer'][:120]}...")
            print(f"  Confidence: {result['confidence']:.2f}")
            print(f"  Sources: {len(result['sources'])}")
            print(f"  Latency: {result['latency_ms']}ms")

    except httpx.TimeoutException:
        result["latency_ms"] = (time.time() - start) * 1000
        result["error"] = "timeout"
    except Exception as e:
        result["latency_ms"] = (time.time() - start) * 1000
        result["error"] = str(e)

    return result


def print_results_table(results: list[dict], metrics: dict):
    """Print a formatted results table to stdout."""
    print("\n" + "=" * 80)
    print("GRAVITY SEARCH EVALUATION RESULTS")
    print("=" * 80)
    print(f"{'ID':<15} {'Category':<25} {'Latency':>10} {'Conf':>6} {'Status':<12}")
    print("-" * 80)

    for r in results:
        status = "✓ OK" if not r.get("error") and r.get("answer") else "✗ " + (r.get("error") or "no answer")[:8]
        latency = f"{r['latency_ms']:.0f}ms"
        conf = f"{r['confidence']:.2f}"
        cat = r["category"][:24]
        qid = r["query_id"][:14]
        print(f"{qid:<15} {cat:<25} {latency:>10} {conf:>6} {status:<12}")

    print("=" * 80)
    print("AGGREGATE METRICS")
    print("=" * 80)
    print(f"  Total queries:        {metrics['total_queries']}")
    print(f"  Answer rate:          {metrics['answer_rate']*100:.1f}%")
    print(f"  High confidence rate: {metrics['high_confidence_rate']*100:.1f}%  (≥0.7)")
    print(f"  Cache hit rate:       {metrics['cache_hit_rate']*100:.1f}%")
    print(f"  MRR:                  {metrics['mrr']:.4f}")
    print(f"  NDCG@5:               {metrics['ndcg_at_5']:.4f}")
    print()
    print(f"  Avg latency:          {metrics['avg_latency_ms']:.0f}ms")
    print(f"  P50 latency:          {metrics['p50_latency_ms']:.0f}ms")
    print(f"  P95 latency:          {metrics['p95_latency_ms']:.0f}ms")
    print(f"  P99 latency:          {metrics['p99_latency_ms']:.0f}ms")

    if metrics.get("by_category"):
        print()
        print("  By category:")
        for cat, stats in metrics["by_category"].items():
            print(f"    {cat:<30} avg {stats['avg_latency_ms']:.0f}ms  conf {stats['avg_confidence']:.2f}")

    print("=" * 80 + "\n")


async def main():
    parser = argparse.ArgumentParser(description="Run Gravity Search evaluation")
    parser.add_argument("--url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--verbose", action="store_true", help="Show per-query details")
    parser.add_argument("--output", default="", help="Custom output file path")
    args = parser.parse_args()

    queries = load_golden_queries()
    print(f"Running {len(queries)} golden queries against {args.url}")

    results = []
    async with httpx.AsyncClient() as client:
        # Check API health first
        try:
            r = await client.get(f"{args.url}/health", timeout=5.0)
            if r.status_code != 200:
                print(f"WARNING: API health check failed: {r.status_code}")
        except Exception:
            print(f"ERROR: Cannot reach API at {args.url}")
            sys.exit(1)

        # Run queries sequentially to avoid rate limiting
        for i, query in enumerate(queries, start=1):
            print(f"  [{i}/{len(queries)}] {query['id']}: {query['query'][:50]}...", end=" ", flush=True)
            result = await run_query(client, args.url, query, verbose=args.verbose)
            results.append(result)
            status = f"{result['latency_ms']:.0f}ms" if not result.get("error") else f"ERROR: {result['error']}"
            print(status)

    # Compute metrics
    from tests.eval.metrics import compute_metrics
    metrics = compute_metrics(results)

    # Print table
    print_results_table(results, metrics)

    # Save results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = args.output or RESULTS_DIR / f"results_{timestamp}.json"
    with open(output_path, "w") as f:
        json.dump(
            {
                "timestamp": timestamp,
                "api_url": args.url,
                "metrics": metrics,
                "results": results,
            },
            f,
            indent=2,
        )
    print(f"Results saved to: {output_path}")


if __name__ == "__main__":
    # Add backend to path when running directly
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    asyncio.run(main())

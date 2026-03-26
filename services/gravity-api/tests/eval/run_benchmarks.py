"""
Gravity Search — Benchmark Evaluation Runner
Runs benchmarks against the live Gravity Search pipeline and scores results.

Usage:
    cd services/gravity-api
    python -m tests.eval.run_benchmarks [--benchmark financebench|finqa|tatqa|fpb|all]
                                        [--url http://localhost:8000]
                                        [--output results.json]

This runner:
  1. Loads benchmark examples from benchmark_datasets.py
  2. For each example, calls the Gravity Search API
  3. Scores responses using benchmark_scorer.py
  4. Prints a formatted report with accuracy breakdowns
  5. Saves full results to JSON
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

# Ensure project root is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from tests.eval.benchmark_datasets import (
    BenchmarkType,
    BenchmarkExample,
    get_benchmark,
    get_all_examples,
    ALL_BENCHMARKS,
)
from tests.eval.benchmark_scorer import (
    score_example,
    score_benchmark,
    print_benchmark_report,
    BenchmarkReport,
)


RESULTS_DIR = Path(__file__).parent


async def run_single_example(
    client: httpx.AsyncClient,
    base_url: str,
    example: BenchmarkExample,
    verbose: bool = False,
) -> dict:
    """
    Run a single benchmark example against the API.

    Returns a dict with:
      { "example_id", "predicted_answer", "latency_ms", "error", "raw_response" }
    """
    start = time.time()

    # Build the query — for table/context examples, prepend context
    query = example.question
    if example.table_context:
        query = f"Given the following financial data:\n{example.table_context}\n\n{example.question}"
    elif example.context:
        query = f"Context: {example.context}\n\nQuestion: {example.question}"

    result = {
        "example_id": example.id,
        "benchmark": example.benchmark.value,
        "query": query,
        "predicted_answer": "",
        "latency_ms": 0,
        "error": None,
        "raw_response": None,
    }

    try:
        response = await client.post(
            f"{base_url}/v1/search",
            json={
                "query": query,
                "response_format": "json",
                "max_sources": 10,
            },
            timeout=120.0,
        )
        result["latency_ms"] = round((time.time() - start) * 1000, 1)

        if response.status_code != 200:
            result["error"] = f"HTTP {response.status_code}"
            return result

        data = response.json()
        result["predicted_answer"] = data.get("answer", "")
        result["raw_response"] = {
            "confidence": data.get("confidence", 0),
            "sources_count": len(data.get("sources", [])),
            "citations_count": len(data.get("citations", [])),
        }

        if verbose:
            print(f"    Answer: {result['predicted_answer'][:80]}...")
            print(f"    Expected: {example.answer[:80]}")

    except httpx.TimeoutException:
        result["latency_ms"] = round((time.time() - start) * 1000, 1)
        result["error"] = "timeout"
    except Exception as e:
        result["latency_ms"] = round((time.time() - start) * 1000, 1)
        result["error"] = str(e)[:200]

    return result


async def run_benchmark_suite(
    base_url: str,
    benchmark_type: BenchmarkType | None = None,
    verbose: bool = False,
) -> dict:
    """
    Run a full benchmark suite and return scored results.

    Args:
        base_url: API URL
        benchmark_type: Specific benchmark to run, or None for all
        verbose: Print per-query details
    """
    # Select benchmarks to run
    if benchmark_type:
        benchmarks_to_run = {benchmark_type: get_benchmark(benchmark_type)}
    else:
        benchmarks_to_run = ALL_BENCHMARKS

    all_reports: list[BenchmarkReport] = []
    all_raw_results: list[dict] = []

    async with httpx.AsyncClient() as client:
        # Health check
        try:
            r = await client.get(f"{base_url}/health", timeout=5.0)
            if r.status_code != 200:
                print(f"⚠ API health check returned {r.status_code}")
        except Exception:
            print(f"✗ Cannot reach API at {base_url}")
            sys.exit(1)

        for btype, examples in benchmarks_to_run.items():
            print(f"\n{'─'*60}")
            print(f"  Running {btype.value.upper()} ({len(examples)} examples)")
            print(f"{'─'*60}")

            predictions: dict[str, str] = {}
            raw_results: list[dict] = []

            for i, example in enumerate(examples, 1):
                icon = "🔍" if btype == BenchmarkType.FINANCE_BENCH else \
                       "🔢" if btype == BenchmarkType.FINQA else \
                       "📊" if btype == BenchmarkType.TAT_QA else \
                       "💬" if btype == BenchmarkType.FPB else "📋"

                print(f"  {icon} [{i}/{len(examples)}] {example.id}: {example.question[:55]}...", end=" ", flush=True)

                result = await run_single_example(client, base_url, example, verbose)
                raw_results.append(result)
                all_raw_results.append(result)

                if result["error"]:
                    print(f"✗ {result['error']}")
                    predictions[example.id] = ""
                else:
                    # Quick score preview
                    score_result = score_example(example, result["predicted_answer"])
                    icon_result = "✓" if score_result.correct else "✗"
                    print(f"{icon_result} {result['latency_ms']:.0f}ms (score={score_result.score:.2f})")
                    predictions[example.id] = result["predicted_answer"]

            # Score the benchmark
            report = score_benchmark(examples, predictions)
            print_benchmark_report(report)
            all_reports.append(report)

    # Overall summary
    total_examples = sum(r.total for r in all_reports)
    total_correct = sum(r.correct for r in all_reports)
    overall_accuracy = total_correct / max(total_examples, 1)

    print(f"\n{'═'*70}")
    print(f"  OVERALL BENCHMARK RESULTS")
    print(f"{'═'*70}")
    print(f"  Total Examples: {total_examples}")
    print(f"  Total Correct:  {total_correct}")
    print(f"  Overall Accuracy: {overall_accuracy*100:.1f}%")
    print()
    for report in all_reports:
        bar = "█" * int(report.accuracy * 30) + "░" * (30 - int(report.accuracy * 30))
        print(f"  {report.benchmark:<15} {bar} {report.accuracy*100:5.1f}% ({report.correct}/{report.total})")
    print(f"{'═'*70}\n")

    return {
        "timestamp": datetime.now().isoformat(),
        "api_url": base_url,
        "overall_accuracy": round(overall_accuracy, 4),
        "total_examples": total_examples,
        "total_correct": total_correct,
        "benchmarks": {r.benchmark: r.to_dict() for r in all_reports},
        "raw_results": all_raw_results,
    }


async def main():
    parser = argparse.ArgumentParser(description="Run Gravity Search Benchmarks")
    parser.add_argument(
        "--benchmark",
        choices=["financebench", "finqa", "tatqa", "fpb", "all"],
        default="all",
        help="Which benchmark to run (default: all)",
    )
    parser.add_argument("--url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--verbose", action="store_true", help="Show predictions")
    parser.add_argument("--output", default="", help="Output JSON path")
    args = parser.parse_args()

    # Map CLI arg to BenchmarkType
    benchmark_map = {
        "financebench": BenchmarkType.FINANCE_BENCH,
        "finqa": BenchmarkType.FINQA,
        "tatqa": BenchmarkType.TAT_QA,
        "fpb": BenchmarkType.FPB,
        "all": None,
    }
    benchmark_type = benchmark_map[args.benchmark]

    results = await run_benchmark_suite(args.url, benchmark_type, args.verbose)

    # Save results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = args.output or RESULTS_DIR / f"benchmark_results_{timestamp}.json"
    with open(output_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"Results saved to: {output_path}")


if __name__ == "__main__":
    asyncio.run(main())

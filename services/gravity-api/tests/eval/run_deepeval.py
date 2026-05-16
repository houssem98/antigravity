"""
Gravity RAG — deepeval standalone evaluation runner.

Hits the live search API, evaluates with deepeval's RAG triad, and writes
a JSON results file alongside the existing run_eval.py output format.

Usage:
    cd services/gravity-api
    python tests/eval/run_deepeval.py
    python tests/eval/run_deepeval.py --url http://localhost:8000 --limit 20
    python tests/eval/run_deepeval.py --categories simple_lookup temporal_reasoning
    python tests/eval/run_deepeval.py --output results_deepeval.json

Requirements:
    export ANTHROPIC_API_KEY=sk-ant-...
    export GRAVITY_API_URL=http://localhost:8000  (or pass --url)
    # Optional — push results to Confident AI dashboard:
    export CONFIDENT_AI_API_KEY=...
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


# ── Helpers ───────────────────────────────────────────────────────────────────

def load_queries(categories: list[str] | None, limit: int) -> list[dict]:
    with open(GOLDEN_QUERIES_PATH) as f:
        data = json.load(f)
    queries = data["queries"]
    if categories:
        queries = [q for q in queries if q.get("category") in categories]
    return queries[:limit]


async def fetch_result(
    client: httpx.AsyncClient, base_url: str, query: str
) -> dict:
    """Call /v1/search and return {answer, sources, latency_ms}."""
    start = time.time()
    try:
        resp = await client.post(
            f"{base_url}/v1/search",
            json={"query": query, "response_format": "json", "max_sources": 8},
            timeout=60.0,
        )
        latency_ms = (time.time() - start) * 1000
        resp.raise_for_status()
        data = resp.json()
        return {
            "answer": data.get("answer", ""),
            "sources": data.get("sources", []),
            "latency_ms": round(latency_ms, 1),
            "error": None,
        }
    except Exception as e:
        return {
            "answer": "",
            "sources": [],
            "latency_ms": round((time.time() - start) * 1000, 1),
            "error": str(e),
        }


# ── Main ──────────────────────────────────────────────────────────────────────

async def run(args: argparse.Namespace):
    from deepeval import evaluate
    from deepeval.test_case import LLMTestCase
    from deepeval.metrics import (
        AnswerRelevancyMetric,
        FaithfulnessMetric,
        ContextualRelevancyMetric,
    )
    from tests.eval.judge_model import AnthropicJudge

    # Optional: push to Confident AI dashboard
    confident_key = os.environ.get("CONFIDENT_AI_API_KEY")
    if confident_key:
        import deepeval as _de
        _de.login_with_confident_api_key(confident_key)

    base_url = args.url
    queries = load_queries(args.categories or None, args.limit)
    print(f"Evaluating {len(queries)} queries against {base_url}")

    judge = AnthropicJudge()
    metrics = [
        AnswerRelevancyMetric(threshold=0.7, model=judge, include_reason=True),
        FaithfulnessMetric(threshold=0.7, model=judge, include_reason=True),
        ContextualRelevancyMetric(threshold=0.6, model=judge, include_reason=True),
    ]

    # ── 1. Fetch pipeline outputs (sequential to avoid rate limiting)
    raw_results: list[dict] = []
    async with httpx.AsyncClient() as client:
        # Health check
        try:
            h = await client.get(f"{base_url}/health", timeout=5.0)
            if h.status_code != 200:
                print(f"WARNING: health check returned {h.status_code}")
        except Exception:
            print(f"ERROR: Cannot reach {base_url}")
            sys.exit(1)

        for i, q in enumerate(queries, start=1):
            print(f"  [{i}/{len(queries)}] {q['id']}: {q['query'][:55]}...", end=" ", flush=True)
            result = await fetch_result(client, base_url, q["query"])
            raw_results.append({"query": q, "pipeline": result})
            status = f"{result['latency_ms']:.0f}ms" if not result["error"] else f"ERR: {result['error'][:30]}"
            print(status)

    # ── 2. Build deepeval test cases
    test_cases: list[LLMTestCase] = []
    for item in raw_results:
        if item["pipeline"]["error"]:
            continue
        sources = item["pipeline"]["sources"]
        context = [
            s.get("text", s.get("passage", "")) for s in sources
            if s.get("text") or s.get("passage")
        ]
        test_cases.append(
            LLMTestCase(
                input=item["query"]["query"],
                actual_output=item["pipeline"]["answer"],
                retrieval_context=context or ["[no context retrieved]"],
                metadata={
                    "query_id": item["query"]["id"],
                    "category": item["query"].get("category"),
                    "latency_ms": item["pipeline"]["latency_ms"],
                },
            )
        )

    if not test_cases:
        print("No valid test cases — all queries errored.")
        sys.exit(1)

    # ── 3. Evaluate
    from deepeval.evaluate.configs import AsyncConfig, DisplayConfig

    print(f"\nRunning deepeval on {len(test_cases)} test cases (judge: {judge.get_model_name()})...")
    eval_results = evaluate(
        test_cases=test_cases,
        metrics=metrics,
        async_config=AsyncConfig(run_async=True, max_concurrent=5),
        display_config=DisplayConfig(show_indicator=True, print_results=False, inspect_after_run=False),
    )

    # ── 4. Summarise
    print("\n" + "=" * 72)
    print("DEEPEVAL RAG TRIAD RESULTS")
    print("=" * 72)

    passed = total = 0
    metric_scores: dict[str, list[float]] = {}

    for tc_result in eval_results.test_results:
        total += 1
        tc_passed = all(m.success for m in tc_result.metrics_data)
        if tc_passed:
            passed += 1
        qid = tc_result.metadata.get("query_id", "?") if tc_result.metadata else "?"
        cat = tc_result.metadata.get("category", "?") if tc_result.metadata else "?"
        mark = "✓" if tc_passed else "✗"
        scores = " | ".join(
            f"{m.name[:12]}: {m.score:.2f}" for m in tc_result.metrics_data
        )
        print(f"  {mark} {qid:<12} [{cat:<30}] {scores}")
        for m in tc_result.metrics_data:
            metric_scores.setdefault(m.name, []).append(m.score or 0.0)

    print("-" * 72)
    print(f"  Pass rate: {passed}/{total} ({100*passed/total:.1f}%)")
    for metric_name, scores in metric_scores.items():
        avg = sum(scores) / len(scores)
        print(f"  Avg {metric_name[:30]:<32}: {avg:.3f}")
    print("=" * 72 + "\n")

    # ── 5. Save
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = args.output or str(RESULTS_DIR / f"deepeval_results_{timestamp}.json")

    serialised = []
    for tc_result in eval_results.test_results:
        serialised.append({
            "input": tc_result.input,
            "actual_output": tc_result.actual_output,
            "passed": all(m.success for m in tc_result.metrics_data),
            "metadata": tc_result.metadata,
            "metrics": [
                {
                    "name": m.name,
                    "score": m.score,
                    "success": m.success,
                    "reason": m.reason,
                    "threshold": m.threshold,
                }
                for m in tc_result.metrics_data
            ],
        })

    with open(output_path, "w") as f:
        json.dump(
            {
                "timestamp": timestamp,
                "api_url": base_url,
                "judge_model": judge.get_model_name(),
                "pass_rate": passed / total if total else 0,
                "metric_averages": {k: sum(v) / len(v) for k, v in metric_scores.items()},
                "results": serialised,
            },
            f,
            indent=2,
        )
    print(f"Results saved to: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="deepeval RAG evaluation for Gravity API")
    parser.add_argument("--url", default=os.environ.get("GRAVITY_API_URL", "http://localhost:8000"))
    parser.add_argument("--limit", type=int, default=20, help="Max queries to evaluate")
    parser.add_argument("--categories", nargs="+", help="Filter to specific categories")
    parser.add_argument("--output", default="", help="Output JSON path")
    args = parser.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY not set")
        sys.exit(1)

    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    asyncio.run(run(args))


if __name__ == "__main__":
    main()

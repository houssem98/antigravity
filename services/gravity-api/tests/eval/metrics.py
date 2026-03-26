"""
Gravity Search — Evaluation Metrics
Computes retrieval and answer quality metrics from eval results.

Metrics:
  - avg_latency_ms, p50_latency_ms, p95_latency_ms, p99_latency_ms
  - answer_rate: fraction of queries with non-empty answer
  - high_confidence_rate: fraction with confidence >= 0.7
  - mrr: Mean Reciprocal Rank (if expected sources provided)
  - ndcg: Normalized Discounted Cumulative Gain
  - cache_hit_rate: fraction served from semantic cache
"""

import math
from typing import Any


def compute_metrics(results: list[dict]) -> dict:
    """
    Compute aggregate metrics from a list of query evaluation results.

    Each result dict should have:
      {
        "query_id": str,
        "latency_ms": float,
        "answer": str,
        "confidence": float,
        "sources": list[dict],    # [{"ticker": ..., "section": ..., ...}]
        "from_cache": bool,
        "expected_sources": list[str],  # optional, for MRR/NDCG
      }

    Returns:
      {
        "total_queries": int,
        "avg_latency_ms": float,
        "p50_latency_ms": float,
        "p95_latency_ms": float,
        "p99_latency_ms": float,
        "answer_rate": float,
        "high_confidence_rate": float,
        "cache_hit_rate": float,
        "mrr": float,
        "ndcg_at_5": float,
        "by_category": dict,
      }
    """
    if not results:
        return {"total_queries": 0, "error": "no results"}

    n = len(results)
    latencies = sorted([r.get("latency_ms", 0) for r in results])
    answers_present = [1 for r in results if r.get("answer", "").strip()]
    high_conf = [1 for r in results if r.get("confidence", 0) >= 0.7]
    cache_hits = [1 for r in results if r.get("from_cache", False)]

    mrr_scores = [_mrr_score(r) for r in results]
    ndcg_scores = [_ndcg_at_k(r, k=5) for r in results]

    # By-category breakdown
    by_category: dict[str, dict] = {}
    for r in results:
        cat = r.get("category", "unknown")
        if cat not in by_category:
            by_category[cat] = {"count": 0, "latencies": [], "conf_sum": 0}
        by_category[cat]["count"] += 1
        by_category[cat]["latencies"].append(r.get("latency_ms", 0))
        by_category[cat]["conf_sum"] += r.get("confidence", 0)

    category_summary = {
        cat: {
            "count": v["count"],
            "avg_latency_ms": round(_avg(v["latencies"]), 1),
            "avg_confidence": round(v["conf_sum"] / v["count"], 3),
        }
        for cat, v in by_category.items()
    }

    return {
        "total_queries": n,
        "avg_latency_ms": round(_avg(latencies), 1),
        "p50_latency_ms": round(_percentile(latencies, 50), 1),
        "p95_latency_ms": round(_percentile(latencies, 95), 1),
        "p99_latency_ms": round(_percentile(latencies, 99), 1),
        "answer_rate": round(sum(answers_present) / n, 3),
        "high_confidence_rate": round(sum(high_conf) / n, 3),
        "cache_hit_rate": round(sum(cache_hits) / n, 3),
        "mrr": round(_avg(mrr_scores), 4),
        "ndcg_at_5": round(_avg(ndcg_scores), 4),
        "by_category": category_summary,
    }


def _mrr_score(result: dict) -> float:
    """
    Compute Reciprocal Rank for a single result.
    MRR = 1/rank of first relevant source.
    """
    expected = result.get("expected_sources", [])
    if not expected:
        return 1.0  # No ground truth → assume correct

    sources = result.get("sources", [])
    for rank, source in enumerate(sources, start=1):
        # Match by ticker or document title substring
        source_str = f"{source.get('ticker', '')} {source.get('document_title', '')}".lower()
        for exp in expected:
            if exp.lower() in source_str or any(
                word in source_str for word in exp.lower().split()
            ):
                return 1.0 / rank

    return 0.0  # No relevant source found


def _ndcg_at_k(result: dict, k: int = 5) -> float:
    """
    Compute NDCG@k for a single result.
    Binary relevance: 1 if source matches expected, 0 otherwise.
    """
    expected = result.get("expected_sources", [])
    if not expected:
        return 1.0

    sources = result.get("sources", [])[:k]
    relevance = []
    for source in sources:
        source_str = f"{source.get('ticker', '')} {source.get('document_title', '')}".lower()
        rel = 0
        for exp in expected:
            if exp.lower() in source_str or any(
                word in source_str for word in exp.lower().split()
            ):
                rel = 1
                break
        relevance.append(rel)

    dcg = sum(rel / math.log2(i + 2) for i, rel in enumerate(relevance))
    ideal_rel = sorted(relevance, reverse=True)
    idcg = sum(rel / math.log2(i + 2) for i, rel in enumerate(ideal_rel))

    return dcg / idcg if idcg > 0 else 0.0


def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _percentile(sorted_values: list[float], pct: int) -> float:
    if not sorted_values:
        return 0.0
    idx = int(math.ceil(pct / 100.0 * len(sorted_values))) - 1
    return sorted_values[max(0, min(idx, len(sorted_values) - 1))]

"""
Gravity RAG Quality Suite — deepeval RAG triad.

Requires a live Gravity API:
    export GRAVITY_API_URL=http://localhost:8000
    export ANTHROPIC_API_KEY=...
    deepeval test run tests/eval/test_deepeval_rag.py

Skipped automatically when GRAVITY_API_URL is unset (CI without live infra).

Metrics evaluated per query:
  - AnswerRelevancyMetric  (is the answer on-topic?)
  - FaithfulnessMetric     (are claims grounded in retrieved context?)
  - ContextualRelevancyMetric (are the retrieved sources relevant to the query?)
"""

import os
import json
import httpx
import pytest
from pathlib import Path

import deepeval
from deepeval import assert_test
from deepeval.test_case import LLMTestCase
from deepeval.metrics import (
    AnswerRelevancyMetric,
    FaithfulnessMetric,
    ContextualRelevancyMetric,
)

from tests.eval.judge_model import AnthropicJudge

# ── Config ────────────────────────────────────────────────────────────────────

GRAVITY_API_URL = os.environ.get("GRAVITY_API_URL", "")
JUDGE = AnthropicJudge()

# Subset of golden queries: 5 per category (20 total) for manageable CI time.
_GOLDEN_PATH = Path(__file__).parent / "golden_queries.json"

_CATEGORY_BUDGET = {
    "simple_lookup":          5,
    "multi_document_synthesis": 4,
    "temporal_reasoning":     4,
    "calculation":            4,
    "contradiction_detection": 2,
    "entity_relationship":    1,
}

# ── Load & slice representative queries ───────────────────────────────────────

def _load_test_queries() -> list[dict]:
    with open(_GOLDEN_PATH) as f:
        data = json.load(f)
    budget = dict(_CATEGORY_BUDGET)
    selected = []
    for q in data["queries"]:
        cat = q.get("category", "")
        if budget.get(cat, 0) > 0:
            selected.append(q)
            budget[cat] -= 1
    return selected


_TEST_QUERIES = _load_test_queries() if _GOLDEN_PATH.exists() else []


# ── API call helper ───────────────────────────────────────────────────────────

def _call_api(query: str) -> dict:
    """Hit /v1/search and return {answer, sources} dict."""
    resp = httpx.post(
        f"{GRAVITY_API_URL}/v1/search",
        json={"query": query, "response_format": "json", "max_sources": 8},
        timeout=60.0,
    )
    resp.raise_for_status()
    return resp.json()


# ── deepeval test cases ───────────────────────────────────────────────────────

def _build_test_case(q: dict) -> LLMTestCase:
    data = _call_api(q["query"])
    retrieval_context = [
        s.get("text", s.get("passage", "")) for s in data.get("sources", [])
        if s.get("text") or s.get("passage")
    ]
    return LLMTestCase(
        input=q["query"],
        actual_output=data.get("answer", ""),
        retrieval_context=retrieval_context or ["[no context retrieved]"],
    )


# ── Metrics ───────────────────────────────────────────────────────────────────

answer_relevancy = AnswerRelevancyMetric(
    threshold=0.7,
    model=JUDGE,
    include_reason=True,
)
faithfulness = FaithfulnessMetric(
    threshold=0.7,
    model=JUDGE,
    include_reason=True,
)
contextual_relevancy = ContextualRelevancyMetric(
    threshold=0.6,
    model=JUDGE,
    include_reason=True,
)


# ── Tests ─────────────────────────────────────────────────────────────────────

pytestmark = pytest.mark.skipif(
    not GRAVITY_API_URL,
    reason="GRAVITY_API_URL not set — skipping live RAG eval. "
           "Run: export GRAVITY_API_URL=http://localhost:8000",
)


@pytest.mark.parametrize("query_entry", _TEST_QUERIES, ids=[q["id"] for q in _TEST_QUERIES])
def test_rag_quality(query_entry: dict):
    """End-to-end RAG quality: answer relevancy + faithfulness + contextual relevancy."""
    test_case = _build_test_case(query_entry)
    assert_test(test_case, [answer_relevancy, faithfulness, contextual_relevancy])


@pytest.mark.parametrize(
    "query_entry",
    [q for q in _TEST_QUERIES if q.get("category") == "simple_lookup"],
    ids=[q["id"] for q in _TEST_QUERIES if q.get("category") == "simple_lookup"],
)
def test_simple_lookup_faithfulness(query_entry: dict):
    """Simple lookup queries must have near-perfect faithfulness (threshold=0.85)."""
    strict = FaithfulnessMetric(threshold=0.85, model=JUDGE, include_reason=True)
    test_case = _build_test_case(query_entry)
    assert_test(test_case, [strict])


@pytest.mark.parametrize(
    "query_entry",
    [q for q in _TEST_QUERIES if q.get("category") == "contradiction_detection"],
    ids=[q["id"] for q in _TEST_QUERIES if q.get("category") == "contradiction_detection"],
)
def test_contradiction_detection_relevancy(query_entry: dict):
    """Contradiction queries must cite contradicting sources (contextual relevancy=0.75)."""
    strict = ContextualRelevancyMetric(threshold=0.75, model=JUDGE, include_reason=True)
    test_case = _build_test_case(query_entry)
    assert_test(test_case, [strict])

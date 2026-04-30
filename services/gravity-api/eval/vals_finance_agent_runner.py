"""
Vals AI Finance Agent Benchmark — Section 2.2 of Financial_AI_Benchmark_Specification.md.

Implements the Vals AI v1.1 tool harness:
  EDGAR_search   → wraps gravity-api SEC EDGAR source
  web_search     → Tavily (or fallback search)
  parse_html_page → chunks a filing URL into a KV store
  retrieve_information → runs gravity-api retrieval on parsed context
  submit         → explicit final answer (required by v1.1)

Usage:
    # Public 50 (development — DO NOT headline this number):
    python eval/vals_finance_agent_runner.py --split public --output results/vals_public.json

    # Private 150 (if licensed):
    python eval/vals_finance_agent_runner.py --split private \
        --dataset path/to/private.csv --output results/vals_private.json

    # Prepare official submission package:
    python eval/vals_finance_agent_runner.py --split public --submit-mode

IMPORTANT: Submit held-out results to platform.vals.ai — never self-report
           the public-50 score as the main number (see spec Section 2.2).
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Literal, Optional

import httpx

GRAVITY_API_URL = "http://localhost:8000"
API_KEY = "deep-research-internal"
REQUEST_TIMEOUT = 120.0
CONCURRENCY = 2  # Vals AI queries are expensive; keep low

ANCHOR_DATE = "2025-04-07"  # Vals AI benchmark anchor date

# ── Public 50 questions (from huggingface.co/datasets/vals-ai/finance_agent_benchmark) ──

PUBLIC_50_QUESTIONS = [
    # Subset representative of the 9 task categories.
    # In production, load from: huggingface.co/datasets/vals-ai/finance_agent_benchmark
    {
        "id": "vals_001",
        "question": "What was the total revenue of Apple Inc. for fiscal year 2024 (ending September 2024)?",
        "category": "quantitative_retrieval",
        "difficulty": "easy",
    },
    {
        "id": "vals_002",
        "question": "Did Microsoft beat or miss EPS consensus estimates in Q2 FY2025?",
        "category": "beat_or_miss",
        "difficulty": "medium",
    },
    {
        "id": "vals_003",
        "question": "What is NVIDIA's GAAP gross margin for Q3 FY2025 and how does it differ from non-GAAP gross margin?",
        "category": "gaap_non_gaap",
        "difficulty": "medium",
    },
    {
        "id": "vals_004",
        "question": "Describe Amazon's capital allocation strategy for FY2024 based on their 10-K.",
        "category": "qualitative_retrieval",
        "difficulty": "easy",
    },
    {
        "id": "vals_005",
        "question": "Calculate Alphabet's revenue CAGR from 2020 to 2024.",
        "category": "numerical_reasoning",
        "difficulty": "easy",
    },
]


# ── Tool harness datastructures ───────────────────────────────────────────────

@dataclass
class ToolCall:
    name: str
    args: dict
    result: str
    latency_ms: float


@dataclass
class ValsResult:
    id: str
    question: str
    category: str
    difficulty: str
    final_answer: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    total_latency_ms: float = 0.0
    cost_usd: float = 0.0
    error: Optional[str] = None

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


@dataclass
class ValsReport:
    split: str
    total: int
    answered: int
    answer_rate: float
    avg_tool_calls: float
    avg_latency_ms: float
    avg_cost_usd: float
    by_category: dict
    results: list[ValsResult] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


# ── KV store for parsed filings (in-memory per run) ──────────────────────────

_kv_store: dict[str, list[str]] = {}


# ── Tool implementations ──────────────────────────────────────────────────────

async def tool_edgar_search(
    client: httpx.AsyncClient,
    company: str,
    form_type: str = "10-K",
    year: Optional[str] = None,
) -> str:
    """Wraps gravity-api SEC EDGAR source."""
    query = f"{company} {form_type}"
    if year:
        query += f" {year}"
    try:
        resp = await client.post(
            f"{GRAVITY_API_URL}/v1/search",
            json={
                "query": query,
                "reasoning_depth": "fast",
                "stream": False,
                "filters": {"filing_type": form_type, "ticker": company},
            },
            headers={"X-API-Key": API_KEY},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        sources = data.get("sources", [])
        if sources:
            return json.dumps([
                {"title": s.get("title", ""), "url": s.get("url", ""),
                 "text": s.get("text", s.get("content", ""))[:500]}
                for s in sources[:5]
            ])
        return json.dumps({"error": "No EDGAR results found", "query": query})
    except Exception as e:
        return json.dumps({"error": str(e)})


async def tool_web_search(client: httpx.AsyncClient, query: str) -> str:
    """Tavily web search — falls back to gravity-api web search."""
    tavily_key = os.environ.get("TAVILY_API_KEY", "")
    if tavily_key:
        try:
            resp = await client.post(
                "https://api.tavily.com/search",
                json={"query": query, "max_results": 5, "search_depth": "basic"},
                headers={"Authorization": f"Bearer {tavily_key}"},
                timeout=15.0,
            )
            resp.raise_for_status()
            results = resp.json().get("results", [])
            return json.dumps([{"title": r.get("title"), "url": r.get("url"),
                                "content": r.get("content", "")[:400]} for r in results])
        except Exception as e:
            pass  # fall through to gravity-api

    # Fallback: gravity-api search
    try:
        resp = await client.post(
            f"{GRAVITY_API_URL}/v1/search",
            json={"query": query, "reasoning_depth": "fast", "stream": False},
            headers={"X-API-Key": API_KEY},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json().get("answer", "")[:800]
    except Exception as e:
        return json.dumps({"error": str(e)})


async def tool_parse_html_page(client: httpx.AsyncClient, url: str) -> str:
    """Fetch and chunk a filing URL into the in-memory KV store."""
    context_id = f"ctx_{hash(url) % 100000:05d}"
    try:
        resp = await client.get(url, timeout=30.0,
                                headers={"User-Agent": "gravity-research-bot/1.0"})
        resp.raise_for_status()
        text = resp.text

        # Strip HTML tags
        import re
        text = re.sub(r'<[^>]+>', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()

        # Chunk into ~500-char passages
        chunks = [text[i:i+500] for i in range(0, len(text), 400)][:50]
        _kv_store[context_id] = chunks

        return json.dumps({
            "context_id": context_id,
            "chunks": len(chunks),
            "preview": text[:200],
        })
    except Exception as e:
        return json.dumps({"error": str(e), "url": url})


async def tool_retrieve_information(
    client: httpx.AsyncClient, question: str, context_id: str
) -> str:
    """Run retrieval over a previously parsed context (or gravity-api if missing)."""
    chunks = _kv_store.get(context_id, [])
    if chunks:
        # Simple keyword match over stored chunks
        q_words = set(question.lower().split())
        scored = []
        for chunk in chunks:
            chunk_words = set(chunk.lower().split())
            score = len(q_words & chunk_words) / max(len(q_words), 1)
            scored.append((score, chunk))
        scored.sort(reverse=True)
        top = [c for _, c in scored[:3]]
        return json.dumps({"context_id": context_id, "passages": top})

    # Fall back to gravity-api retrieval
    try:
        resp = await client.post(
            f"{GRAVITY_API_URL}/v1/search",
            json={"query": question, "reasoning_depth": "fast", "stream": False},
            headers={"X-API-Key": API_KEY},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        return json.dumps({
            "answer": data.get("answer", ""),
            "sources": data.get("sources", [])[:3],
        })
    except Exception as e:
        return json.dumps({"error": str(e)})


# ── Agent loop ────────────────────────────────────────────────────────────────

TOOLS_SPEC = [
    {
        "name": "EDGAR_search",
        "description": "Search SEC EDGAR for company filings (10-K, 10-Q, 8-K, S-1).",
        "parameters": {
            "type": "object",
            "properties": {
                "company": {"type": "string", "description": "Company name or ticker"},
                "form_type": {"type": "string", "description": "Filing type, e.g. 10-K"},
                "year": {"type": "string", "description": "Fiscal year, e.g. 2024"},
            },
            "required": ["company"],
        },
    },
    {
        "name": "web_search",
        "description": "Search the web for financial information.",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    },
    {
        "name": "parse_html_page",
        "description": "Fetch and parse a URL into a searchable context.",
        "parameters": {
            "type": "object",
            "properties": {"url": {"type": "string"}},
            "required": ["url"],
        },
    },
    {
        "name": "retrieve_information",
        "description": "Answer a question using a previously parsed context.",
        "parameters": {
            "type": "object",
            "properties": {
                "question": {"type": "string"},
                "context_id": {"type": "string"},
            },
            "required": ["question", "context_id"],
        },
    },
    {
        "name": "submit",
        "description": "Submit the final answer. MUST be called to complete the task.",
        "parameters": {
            "type": "object",
            "properties": {"answer": {"type": "string"}},
            "required": ["answer"],
        },
    },
]


async def run_agent(
    client: httpx.AsyncClient,
    question: dict,
) -> ValsResult:
    """
    Run the Vals AI v1.1 agent harness for a single question.
    Uses Claude Sonnet via gravity-api orchestration.
    """
    tool_calls: list[ToolCall] = []
    t0 = time.perf_counter()

    system = (
        f"You are a financial research agent. Today's date is {ANCHOR_DATE}. "
        "Use the provided tools to answer financial questions accurately. "
        "You MUST call the 'submit' tool with your final answer when done. "
        "Always cite your sources."
    )

    messages = [{"role": "user", "content": question["question"]}]
    final_answer = ""
    max_turns = 8
    cost = 0.0

    # Use Claude directly for the agent loop
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not anthropic_key:
        return ValsResult(
            id=question["id"],
            question=question["question"],
            category=question.get("category", ""),
            difficulty=question.get("difficulty", ""),
            final_answer="",
            error="ANTHROPIC_API_KEY not set",
            total_latency_ms=(time.perf_counter() - t0) * 1000,
        )

    for turn in range(max_turns):
        payload = {
            "model": "claude-sonnet-4-6",
            "max_tokens": 1024,
            "system": system,
            "tools": TOOLS_SPEC,
            "messages": messages,
        }

        try:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                json=payload,
                headers={
                    "x-api-key": anthropic_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                timeout=60.0,
            )
            resp.raise_for_status()
            data = resp.json()

            # Track cost (approximate)
            usage = data.get("usage", {})
            cost += usage.get("input_tokens", 0) * 3 / 1_000_000
            cost += usage.get("output_tokens", 0) * 15 / 1_000_000

            content = data.get("content", [])
            stop_reason = data.get("stop_reason", "")

            messages.append({"role": "assistant", "content": content})

            if stop_reason == "end_turn":
                # Extract text from response
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        final_answer = block.get("text", "")
                break

            if stop_reason == "tool_use":
                tool_results = []
                for block in content:
                    if not isinstance(block, dict) or block.get("type") != "tool_use":
                        continue
                    tool_name = block.get("name", "")
                    tool_args = block.get("input", {})
                    tool_id = block.get("id", "")

                    t_tool = time.perf_counter()
                    if tool_name == "EDGAR_search":
                        result = await tool_edgar_search(client, **tool_args)
                    elif tool_name == "web_search":
                        result = await tool_web_search(client, **tool_args)
                    elif tool_name == "parse_html_page":
                        result = await tool_parse_html_page(client, **tool_args)
                    elif tool_name == "retrieve_information":
                        result = await tool_retrieve_information(client, **tool_args)
                    elif tool_name == "submit":
                        final_answer = tool_args.get("answer", "")
                        tool_calls.append(ToolCall(
                            name="submit", args=tool_args,
                            result=final_answer,
                            latency_ms=(time.perf_counter() - t_tool) * 1000,
                        ))
                        break  # done
                    else:
                        result = json.dumps({"error": f"Unknown tool: {tool_name}"})

                    tool_latency = (time.perf_counter() - t_tool) * 1000
                    tool_calls.append(ToolCall(
                        name=tool_name, args=tool_args,
                        result=result[:300], latency_ms=tool_latency,
                    ))
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": result,
                    })

                if final_answer:
                    break

                messages.append({"role": "user", "content": tool_results})

        except Exception as e:
            return ValsResult(
                id=question["id"],
                question=question["question"],
                category=question.get("category", ""),
                difficulty=question.get("difficulty", ""),
                final_answer="",
                tool_calls=tool_calls,
                total_latency_ms=(time.perf_counter() - t0) * 1000,
                cost_usd=cost,
                error=str(e),
            )

    return ValsResult(
        id=question["id"],
        question=question["question"],
        category=question.get("category", ""),
        difficulty=question.get("difficulty", ""),
        final_answer=final_answer,
        tool_calls=tool_calls,
        total_latency_ms=(time.perf_counter() - t0) * 1000,
        cost_usd=round(cost, 6),
    )


# ── Dataset loader ────────────────────────────────────────────────────────────

def load_questions(split: str, dataset_path: Optional[str] = None) -> list[dict]:
    if dataset_path:
        with open(dataset_path, encoding="utf-8") as f:
            reader = csv.DictReader(f)
            return [{"id": r.get("id", str(i)), "question": r["question"],
                     "category": r.get("category", ""), "difficulty": r.get("difficulty", "")}
                    for i, r in enumerate(reader)]

    if split == "public":
        try:
            from datasets import load_dataset as hf_load
            ds = hf_load("vals-ai/finance_agent_benchmark", split="train")
            return [{"id": str(r.get("id", i)), "question": r["question"],
                     "category": r.get("category", ""), "difficulty": r.get("difficulty", "")}
                    for i, r in enumerate(ds)]
        except Exception as e:
            print(f"HuggingFace failed ({e}), using built-in sample.", flush=True)
            return PUBLIC_50_QUESTIONS

    print(f"No dataset found for split='{split}'. Pass --dataset for private/held-out.", flush=True)
    return []


# ── Main ──────────────────────────────────────────────────────────────────────

async def run_eval(questions: list[dict]) -> list[ValsResult]:
    sem = asyncio.Semaphore(CONCURRENCY)
    results = []

    async def run_one(q: dict, idx: int) -> ValsResult:
        async with sem:
            print(f"  [{idx+1}/{len(questions)}] {q['id']}: {q['question'][:60]}…", flush=True)
            async with httpx.AsyncClient() as client:
                result = await run_agent(client, q)
            icon = "✓" if result.final_answer and not result.error else "✗"
            print(
                f"    {icon} {result.total_latency_ms:.0f}ms  "
                f"{len(result.tool_calls)} tools  "
                f"${result.cost_usd:.4f}  "
                f"{result.final_answer[:60]}",
                flush=True,
            )
            return result

    tasks = [run_one(q, i) for i, q in enumerate(questions)]
    for coro in asyncio.as_completed(tasks):
        results.append(await coro)
    return results


def aggregate(results: list[ValsResult], split: str) -> ValsReport:
    n = len(results)
    answered = sum(1 for r in results if r.final_answer and not r.error)
    by_cat: dict = {}
    for r in results:
        cat = r.category or "unknown"
        if cat not in by_cat:
            by_cat[cat] = {"total": 0, "answered": 0}
        by_cat[cat]["total"] += 1
        if r.final_answer:
            by_cat[cat]["answered"] += 1
    for v in by_cat.values():
        v["answer_rate"] = round(v["answered"] / max(v["total"], 1), 3)

    return ValsReport(
        split=split,
        total=n,
        answered=answered,
        answer_rate=round(answered / max(n, 1), 4),
        avg_tool_calls=round(sum(len(r.tool_calls) for r in results) / max(n, 1), 2),
        avg_latency_ms=round(sum(r.total_latency_ms for r in results) / max(n, 1), 1),
        avg_cost_usd=round(sum(r.cost_usd for r in results) / max(n, 1), 6),
        by_category=by_cat,
        results=results,
    )


def print_report(report: ValsReport):
    print(f"\n{'═'*65}")
    print(f"  VALS AI FINANCE AGENT — split={report.split.upper()}")
    print(f"{'═'*65}")
    print(f"  Total questions   : {report.total}")
    print(f"  Answered          : {report.answered}  ({report.answer_rate*100:.1f}%)")
    print(f"  Avg tool calls    : {report.avg_tool_calls:.1f}")
    print(f"  Avg latency       : {report.avg_latency_ms:.0f}ms")
    print(f"  Avg cost/query    : ${report.avg_cost_usd:.4f}")
    print()
    if report.by_category:
        print("  By category:")
        for cat, s in sorted(report.by_category.items()):
            print(f"    {cat:<30} {s['answer_rate']*100:.0f}%  (n={s['total']})")
    print()
    print("  IMPORTANT: Do not headline the public-50 answer rate.")
    print("  Submit to platform.vals.ai for official held-out grading.")
    print(f"  Leaderboard leader: Claude Opus 4.7 = 64.37% (April 2026)")
    print(f"{'═'*65}\n")


def main():
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:
            pass

    parser = argparse.ArgumentParser(description="Vals AI Finance Agent harness")
    parser.add_argument("--split", default="public",
                        choices=["public", "private", "held_out"],
                        help="Dataset split to run")
    parser.add_argument("--dataset", type=str, default=None,
                        help="Path to CSV dataset (private/held_out splits)")
    parser.add_argument("--output", type=str, default="results/vals_ai.json")
    parser.add_argument("--submit-mode", action="store_true",
                        help="Package results for vals.ai submission")
    parser.add_argument("--url", type=str, default=None)
    args = parser.parse_args()

    global GRAVITY_API_URL
    if args.url:
        GRAVITY_API_URL = args.url.rstrip("/")

    questions = load_questions(args.split, args.dataset)
    if not questions:
        print("No questions loaded.", file=sys.stderr)
        sys.exit(1)

    print(f"Running {len(questions)} questions (split={args.split})…\n")
    results = asyncio.run(run_eval(questions))
    report = aggregate(results, args.split)
    print_report(report)

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report.to_dict(), f, indent=2, default=str)
    print(f"Saved to {out}")

    if args.submit_mode:
        submission = {
            "system": "antigravity/gravity-api",
            "model": "claude-sonnet-4-6 (router)",
            "harness_version": "vals_ai_v1.1",
            "anchor_date": ANCHOR_DATE,
            "results": [
                {"id": r.id, "answer": r.final_answer,
                 "tool_calls": len(r.tool_calls), "latency_ms": r.total_latency_ms}
                for r in results
            ],
        }
        sub_path = out.parent / "vals_submission.json"
        with open(sub_path, "w", encoding="utf-8") as f:
            json.dump(submission, f, indent=2)
        print(f"Submission package saved to {sub_path}")
        print("Upload to: platform.vals.ai")


if __name__ == "__main__":
    main()

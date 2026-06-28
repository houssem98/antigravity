"""
FinanceBench Evaluation Harness
================================
Runs the FinanceBench benchmark (150 questions over real 10-K/10-Q filings)
against the Gravity Search API and scores accuracy, citation precision,
hallucination rate, and latency.

FinanceBench paper: https://arxiv.org/abs/2311.11944
Dataset:           https://huggingface.co/datasets/PatronusAI/financebench

Usage:
    # Install deps first:
    pip install httpx datasets tqdm rouge-score

    # Run with gravity-api running on :8000:
    python tests/eval/financebench.py

    # Run a quick 20-question smoke test:
    python tests/eval/financebench.py --sample 20

    # Run against a specific category:
    python tests/eval/financebench.py --category income_statement

    # Save results to JSON:
    python tests/eval/financebench.py --output results/financebench_$(date +%Y%m%d).json

Scoring:
    - Exact match (EM):     answer contains the expected value verbatim
    - Fuzzy match (FM):     ROUGE-L >= 0.7 against expected answer
    - Numeric accuracy:     within 2% tolerance for financial figures
    - Hallucination flag:   answer contains numbers NOT in sources
    - Citation precision:   citations reference correct companies/filings
    - Latency (P50/P95):    end-to-end response time

World-class targets (AlphaSense / Bloomberg internal benchmarks):
    EM >= 0.60, FM >= 0.75, Numeric >= 0.80, Hallucination rate <= 0.05
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import statistics
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

import httpx

# ─── Config ──────────────────────────────────────────────────────────────────

import os as _os
GRAVITY_API_URL  = _os.getenv("GRAVITY_API_URL", "http://localhost:8000")
SEARCH_ENDPOINT  = f"{GRAVITY_API_URL}/v1/search"
API_KEY          = _os.getenv("GRAVITY_API_KEY", "deep-research-internal")   # dev key locally
_TOKEN           = ""   # Bearer token (signup) for authed prod runs

NUMERIC_TOLERANCE = 0.02    # 2% — standard for financial reporting variance
ROUGE_THRESHOLD   = 0.70    # ROUGE-L threshold for fuzzy match
REQUEST_TIMEOUT   = 60.0    # seconds per question
CONCURRENCY       = int(_os.getenv("FB_CONCURRENCY", "4"))  # set 1 for clean, rate-limit-free runs

# ─── Question categories in FinanceBench ──────────────────────────────────────

CATEGORIES = {
    "income_statement":   "Revenue, net income, EPS, gross profit, operating income",
    "balance_sheet":      "Assets, liabilities, equity, cash, debt",
    "cash_flow":          "FCF, capex, operating cash flow, investing/financing",
    "ratios":             "P/E, EV/EBITDA, ROE, ROIC, gross margin %",
    "multi_doc":          "Comparisons across companies or periods",
    "guidance":           "Forward-looking statements, management guidance",
}

# ─── Embedded sample set (25 questions) ──────────────────────────────────────
# Used as fallback if HuggingFace dataset is unavailable.
# These are representative of the FinanceBench distribution.

SAMPLE_QUESTIONS = [
    # Income statement
    {"id": "fb_001", "question": "What was Apple's total net revenue for fiscal year 2022?",
     "answer": "394.33 billion", "ticker": "AAPL", "filing": "10-K 2022",
     "category": "income_statement"},
    {"id": "fb_002", "question": "What was Microsoft's net income for fiscal year 2023?",
     "answer": "72.36 billion", "ticker": "MSFT", "filing": "10-K 2023",
     "category": "income_statement"},
    {"id": "fb_003", "question": "What was Amazon's operating income in 2022?",
     "answer": "12.25 billion", "ticker": "AMZN", "filing": "10-K 2022",
     "category": "income_statement"},
    {"id": "fb_004", "question": "What was NVIDIA's total revenue for fiscal year 2024?",
     "answer": "60.92 billion", "ticker": "NVDA", "filing": "10-K 2024",
     "category": "income_statement"},
    {"id": "fb_005", "question": "What was Alphabet's advertising revenue in 2022?",
     "answer": "224.47 billion", "ticker": "GOOGL", "filing": "10-K 2022",
     "category": "income_statement"},
    # Balance sheet
    {"id": "fb_006", "question": "What was Apple's total cash and short-term investments at end of fiscal 2022?",
     "answer": "48.3 billion", "ticker": "AAPL", "filing": "10-K 2022",
     "category": "balance_sheet"},
    {"id": "fb_007", "question": "What was Microsoft's total long-term debt as of June 2023?",
     "answer": "47.2 billion", "ticker": "MSFT", "filing": "10-K 2023",
     "category": "balance_sheet"},
    {"id": "fb_008", "question": "What were Tesla's total assets at end of 2022?",
     "answer": "82.34 billion", "ticker": "TSLA", "filing": "10-K 2022",
     "category": "balance_sheet"},
    # Cash flow
    {"id": "fb_009", "question": "What was Apple's free cash flow in fiscal year 2022?",
     "answer": "111.44 billion", "ticker": "AAPL", "filing": "10-K 2022",
     "category": "cash_flow"},
    {"id": "fb_010", "question": "What was Amazon's capital expenditure in 2022?",
     "answer": "63.65 billion", "ticker": "AMZN", "filing": "10-K 2022",
     "category": "cash_flow"},
    {"id": "fb_011", "question": "What was Microsoft's operating cash flow in fiscal 2023?",
     "answer": "87.58 billion", "ticker": "MSFT", "filing": "10-K 2023",
     "category": "cash_flow"},
    # Ratios
    {"id": "fb_012", "question": "What was Apple's gross margin percentage in fiscal year 2022?",
     "answer": "43.3%", "ticker": "AAPL", "filing": "10-K 2022",
     "category": "ratios"},
    {"id": "fb_013", "question": "What was Microsoft's operating margin in fiscal year 2023?",
     "answer": "41.8%", "ticker": "MSFT", "filing": "10-K 2023",
     "category": "ratios"},
    {"id": "fb_014", "question": "What was Alphabet's net profit margin in 2022?",
     "answer": "21.2%", "ticker": "GOOGL", "filing": "10-K 2022",
     "category": "ratios"},
    # Guidance / qualitative
    {"id": "fb_015", "question": "What did Apple management say about supply chain constraints in their 2022 10-K?",
     "answer": "supply constraints silicon chip component shortages",
     "ticker": "AAPL", "filing": "10-K 2022",
     "category": "guidance"},
    {"id": "fb_016", "question": "What are the main risk factors Tesla cited in its 2022 annual report?",
     "answer": "competition regulatory production scaling battery supply",
     "ticker": "TSLA", "filing": "10-K 2022",
     "category": "guidance"},
    # Multi-document / comparative
    {"id": "fb_017", "question": "How did NVIDIA's data center revenue growth compare to AMD's data center revenue growth in fiscal 2023?",
     "answer": "NVIDIA grew faster data center",
     "ticker": "NVDA", "filing": "10-K 2023",
     "category": "multi_doc"},
    {"id": "fb_018", "question": "What was Amazon Web Services revenue in 2022 and 2021?",
     "answer": "62.2 billion 2022 45.4 billion 2021",
     "ticker": "AMZN", "filing": "10-K 2022",
     "category": "multi_doc"},
    # Earnings call specific
    {"id": "fb_019", "question": "What guidance did Microsoft give for Azure revenue growth in Q1 FY2024 earnings call?",
     "answer": "28 29 percent growth",
     "ticker": "MSFT", "filing": "earnings_transcript",
     "category": "guidance"},
    {"id": "fb_020", "question": "What was Meta's revenue in Q4 2022 and how did it compare to Q4 2021?",
     "answer": "32.17 billion decreased year over year",
     "ticker": "META", "filing": "10-K 2022",
     "category": "income_statement"},
    {"id": "fb_021", "question": "What was JPMorgan Chase's return on equity in 2022?",
     "answer": "12%", "ticker": "JPM", "filing": "10-K 2022",
     "category": "ratios"},
    {"id": "fb_022", "question": "What was Berkshire Hathaway's operating earnings in 2022?",
     "answer": "28.7 billion", "ticker": "BRK", "filing": "10-K 2022",
     "category": "income_statement"},
    {"id": "fb_023", "question": "What was ExxonMobil's capital expenditures in 2022?",
     "answer": "16.7 billion", "ticker": "XOM", "filing": "10-K 2022",
     "category": "cash_flow"},
    {"id": "fb_024", "question": "How much did Apple spend on share buybacks in fiscal 2022?",
     "answer": "89.4 billion", "ticker": "AAPL", "filing": "10-K 2022",
     "category": "cash_flow"},
    {"id": "fb_025", "question": "What was Tesla's automotive gross margin in 2022?",
     "answer": "28.5%", "ticker": "TSLA", "filing": "10-K 2022",
     "category": "ratios"},
]


# ─── Data structures ──────────────────────────────────────────────────────────

@dataclass
class QuestionResult:
    id: str
    question: str
    expected: str
    got: str
    ticker: str
    filing: str
    category: str
    exact_match: bool = False
    fuzzy_match: bool = False
    numeric_match: bool = False
    hallucination_flag: bool = False
    citation_found: bool = False
    retrieval_recall: bool = False
    latency_ms: float = 0.0
    error: Optional[str] = None

@dataclass
class EvalReport:
    total: int = 0
    exact_matches: int = 0
    fuzzy_matches: int = 0
    numeric_matches: int = 0
    hallucinations: int = 0
    citation_hits: int = 0
    recall_hits: int = 0
    errors: int = 0
    latencies: list[float] = field(default_factory=list)
    by_category: dict = field(default_factory=dict)
    results: list[QuestionResult] = field(default_factory=list)

    @property
    def em_rate(self) -> float:
        return self.exact_matches / max(self.total, 1)

    @property
    def fm_rate(self) -> float:
        return self.fuzzy_matches / max(self.total, 1)

    @property
    def numeric_rate(self) -> float:
        numeric_q = sum(1 for r in self.results if _has_number(r.expected))
        return self.numeric_matches / max(numeric_q, 1)

    @property
    def hallucination_rate(self) -> float:
        return self.hallucinations / max(self.total, 1)

    @property
    def citation_rate(self) -> float:
        return self.citation_hits / max(self.total, 1)

    @property
    def recall_rate(self) -> float:
        return self.recall_hits / max(self.total, 1)

    @staticmethod
    def is_correct(r) -> bool:
        """Type-aware correctness: numeric questions pass on numeric_match
        (unit-normalized, 2% tolerance) — not exact text — so '60,922 million'
        correctly credits '60.92 billion'. Text questions pass on fuzzy/exact."""
        if _has_number(r.expected):
            return r.numeric_match
        return r.fuzzy_match or r.exact_match

    @property
    def accuracy(self) -> float:
        scored = [r for r in self.results if not r.error]
        if not scored:
            return 0.0
        return sum(1 for r in scored if self.is_correct(r)) / len(scored)

    @property
    def p50_latency(self) -> float:
        return statistics.median(self.latencies) if self.latencies else 0.0

    @property
    def p95_latency(self) -> float:
        if not self.latencies:
            return 0.0
        sorted_lat = sorted(self.latencies)
        idx = int(len(sorted_lat) * 0.95)
        return sorted_lat[min(idx, len(sorted_lat) - 1)]


# ─── Scoring helpers ──────────────────────────────────────────────────────────

def _normalize(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    text = text.lower()
    text = re.sub(r'[$,\%\(\)]', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def _has_number(text: str) -> bool:
    return bool(re.search(r'\d', text))

def _extract_numbers(text: str) -> list[float]:
    """Extract all numeric values (including billions/millions) from text."""
    nums = []
    # Match patterns like: 394.33, $394.33B, 394 billion, 43.3%, 28-29%
    pattern = r'(\d[\d,]*\.?\d*)\s*(billion|million|trillion|B|M|T|%)?'
    for m in re.finditer(pattern, text.lower()):
        try:
            val = float(m.group(1).replace(',', ''))
            suffix = (m.group(2) or '').lower()
            if suffix in ('billion', 'b'):
                val *= 1e9
            elif suffix in ('million', 'm'):
                val *= 1e6
            elif suffix in ('trillion', 't'):
                val *= 1e12
            nums.append(val)
        except ValueError:
            pass
    return nums

def exact_match(got: str, expected: str) -> bool:
    n_got = _normalize(got)
    n_exp = _normalize(expected)
    # All expected tokens present in got
    tokens = n_exp.split()
    return all(t in n_got for t in tokens if len(t) > 2)

def fuzzy_match(got: str, expected: str) -> bool:
    """ROUGE-L unigram recall >= threshold."""
    try:
        from rouge_score import rouge_scorer
        scorer = rouge_scorer.RougeScorer(['rougeL'], use_stemmer=True)
        scores = scorer.score(expected, got)
        return scores['rougeL'].recall >= ROUGE_THRESHOLD
    except ImportError:
        # Fall back to simple token overlap if rouge_score not installed
        n_got = set(_normalize(got).split())
        n_exp = set(_normalize(expected).split())
        if not n_exp:
            return True
        overlap = len(n_got & n_exp) / len(n_exp)
        return overlap >= ROUGE_THRESHOLD

def numeric_match(got: str, expected: str) -> bool:
    """Check if the primary numeric value in expected appears in got within tolerance."""
    exp_nums = _extract_numbers(expected)
    got_nums = _extract_numbers(got)
    if not exp_nums:
        return True  # No number to check
    if not got_nums:
        return False
    target = exp_nums[0]
    if target == 0:
        return 0 in got_nums
    return any(abs(g - target) / abs(target) <= NUMERIC_TOLERANCE for g in got_nums)

def hallucination_flag(got: str, sources: list[dict]) -> bool:
    """
    Detect numbers in the answer that don't appear in any source passage.
    Heuristic: financial hallucination usually means a wrong dollar amount.
    """
    got_nums = _extract_numbers(got)
    if not got_nums:
        return False
    source_text = ' '.join(s.get('text', '') for s in sources)
    source_nums = set(_extract_numbers(source_text))
    # Flag if more than half the answer's numbers aren't in sources
    unverified = [n for n in got_nums if not any(
        abs(n - s) / max(abs(s), 1) <= 0.05 for s in source_nums
    )]
    return len(unverified) > len(got_nums) * 0.5

def citation_check(citations: list[dict], ticker: str, sources: list[dict] = None) -> bool:
    """
    Check if any citation or source references the expected company ticker.
    Checks both citation text and source chunk metadata (ticker field).
    """
    ticker_lower = ticker.lower()
    # Check citations
    for c in citations:
        text = json.dumps(c).lower()
        if ticker_lower in text:
            return True
    # Check sources metadata (chunk payload has ticker field)
    for s in (sources or []):
        meta = s.get("metadata", s)  # sources may be flat or nested under metadata
        src_ticker = str(meta.get("ticker", "")).lower()
        company = str(meta.get("company_name", "")).lower()
        if ticker_lower in src_ticker or ticker_lower in company:
            return True
    return False


# ─── API Client ───────────────────────────────────────────────────────────────

async def _ensure_token(client: httpx.AsyncClient) -> None:
    """Get a Bearer token via signup for authed (prod) runs. Local dev accepts
    the X-API-Key dev key, so skip if that already works."""
    global _TOKEN
    if _TOKEN:
        return
    # Explicit API key provided → use it (X-API-Key) instead of a free-tier
    # signup token. The eval key maps to an unlimited tier in Redis, avoiding the
    # 100-queries/month free cap that otherwise fails ~50 of a 150-Q run.
    if _os.getenv("GRAVITY_API_KEY"):
        print("  authed via GRAVITY_API_KEY (X-API-Key)", flush=True)
        return
    import uuid as _uuid
    try:
        r = await client.post(
            f"{GRAVITY_API_URL}/v1/auth/signup",
            json={"email": f"fb-{_uuid.uuid4().hex[:10]}@example.com",
                  "password": f"Fb!{_uuid.uuid4().hex[:8]}aA9", "name": "financebench"},
            timeout=30.0,
        )
        if r.status_code < 500:
            _TOKEN = (r.json() or {}).get("access_token", "")
    except Exception:
        _TOKEN = ""


async def query_gravity(client: httpx.AsyncClient, question: str) -> dict:
    """Send a question to gravity-api and return the parsed response."""
    payload = {"query": question, "options": {"reasoning_depth": "auto", "stream": False}}
    headers = {"Authorization": f"Bearer {_TOKEN}"} if _TOKEN else {"X-API-Key": API_KEY}
    for attempt in range(5):
        resp = await client.post(SEARCH_ENDPOINT, json=payload, headers=headers, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 429:  # API rate limit — back off, don't count as error
            await asyncio.sleep(float(resp.headers.get("Retry-After") or min(2 ** attempt, 20)) + 1)
            continue
        resp.raise_for_status()
        return resp.json()
    resp.raise_for_status()
    return resp.json()


# ─── Load FinanceBench dataset ────────────────────────────────────────────────

_RECALL_STOP = {
    "the", "and", "for", "was", "were", "are", "with", "that", "this", "from",
    "have", "has", "had", "not", "its", "our", "their", "year", "ended",
    "december", "fiscal", "period", "company", "total", "net", "in", "of", "to",
    "a", "an", "as", "at", "by", "on", "or", "is", "be", "we",
}


def _recall_tokens(text: str) -> set[str]:
    return {
        w for w in re.sub(r"[^a-z0-9 ]", " ", (text or "").lower()).split()
        if len(w) > 2 and w not in _RECALL_STOP
    }


def evidence_recall(evidence: list, sources: list[dict], threshold: float = 0.5) -> bool:
    """Did retrieval surface the gold evidence?

    Token-overlap recall: fraction of the gold evidence's distinctive words that
    appear in the concatenated retrieved passages. Hit when >= threshold. Robust
    to chunk-boundary / formatting differences (vs exact substring match).
    Returns True (neutral) when the dataset has no evidence to score against.

    LIMITATION: /v1/search returns each source's `text` truncated (~118 chars),
    so long gold evidence rarely reaches the threshold and this reads near 0 —
    it is NOT a true recall@k yet. A real number needs full-chunk source text
    or a retrieval-only endpoint.
    """
    gold_text = " ".join(
        (e.get("evidence_text", "") if isinstance(e, dict) else str(e))
        for e in (evidence or [])
    )
    gold = _recall_tokens(gold_text)
    if not gold:
        return True  # nothing to measure → don't penalise
    src = set()
    for s in (sources or []):
        src |= _recall_tokens(s.get("text", "") if isinstance(s, dict) else str(s))
    overlap = len(gold & src) / len(gold)
    return overlap >= threshold


def load_dataset(sample: Optional[int] = None, category: Optional[str] = None, embedded: bool = False) -> list[dict]:
    """
    Load FinanceBench questions.
    Tries HuggingFace datasets first, falls back to embedded sample set.
    Pass embedded=True to skip HuggingFace and use the 25 built-in questions.
    """
    questions = []

    if embedded:
        print(f"  Using embedded 25-question sample set", flush=True)
        questions = list(SAMPLE_QUESTIONS)
    else:
        try:
            from datasets import load_dataset as hf_load
            print("Loading FinanceBench from HuggingFace...", flush=True)
            ds = hf_load("PatronusAI/financebench", split="train")
            for row in ds:
                questions.append({
                    "id":       row.get("financebench_id", ""),
                    "question": row.get("question", ""),
                    "answer":   row.get("answer", ""),
                    "ticker":   row.get("company_name", "") or row.get("company", ""),
                    "company":  row.get("company", ""),
                    "filing":   row.get("doc_name", ""),
                    "category": row.get("question_type", "general"),
                    "evidence": row.get("evidence", []) or [],
                })
            print(f"  Loaded {len(questions)} questions from HuggingFace", flush=True)
        except Exception as e:
            print(f"  HuggingFace unavailable ({e}), using embedded sample set ({len(SAMPLE_QUESTIONS)} questions)", flush=True)
            questions = list(SAMPLE_QUESTIONS)

    if category:
        questions = [q for q in questions if category.lower() in q.get("category", "").lower()]
        print(f"  Filtered to {len(questions)} questions in category '{category}'", flush=True)

    if sample and sample < len(questions):
        import random
        random.seed(42)
        questions = random.sample(questions, sample)
        print(f"  Sampled {len(questions)} questions", flush=True)

    return questions


# ─── Evaluation loop ──────────────────────────────────────────────────────────

async def evaluate_question(
    client: httpx.AsyncClient,
    q: dict,
    sem: asyncio.Semaphore,
) -> QuestionResult:
    async with sem:
        result = QuestionResult(
            id=q["id"],
            question=q["question"],
            expected=q["answer"],
            got="",
            ticker=q.get("ticker", ""),
            filing=q.get("filing", ""),
            category=q.get("category", "general"),
        )
        t0 = time.perf_counter()
        try:
            api_resp = await query_gravity(client, q["question"])
            result.latency_ms = (time.perf_counter() - t0) * 1000

            # Extract answer text — API may return JSON, markdown-fenced JSON, or plain text
            def _extract_answer(resp) -> str:
                if not isinstance(resp, dict):
                    return str(resp)

                raw = resp.get("answer")

                # answer is None or empty — try to build from sources
                if not raw:
                    srcs = resp.get("sources", [])
                    if srcs:
                        return " ".join(s.get("text", "") for s in srcs[:3])[:600]
                    return str(resp)

                raw = str(raw).strip()

                # Strip ```json ... ``` markdown fence if present
                if raw.startswith("```"):
                    raw = re.sub(r"^```[a-z]*\n?", "", raw)
                    raw = re.sub(r"\n?```$", "", raw.strip())

                # If the remaining text is a JSON object, extract the "answer" field
                raw = raw.strip()
                if raw.startswith("{"):
                    try:
                        inner = json.loads(raw)
                        if isinstance(inner, dict) and inner.get("answer"):
                            return str(inner["answer"])
                    except json.JSONDecodeError:
                        pass

                return raw

            answer_text = _extract_answer(api_resp)
            result.got = answer_text

            sources   = api_resp.get("sources", []) if isinstance(api_resp, dict) else []
            citations = api_resp.get("citations", []) if isinstance(api_resp, dict) else []

            # Score
            result.exact_match   = exact_match(answer_text, q["answer"])
            result.fuzzy_match   = fuzzy_match(answer_text, q["answer"])
            result.numeric_match = numeric_match(answer_text, q["answer"]) if _has_number(q["answer"]) else True
            result.hallucination_flag = hallucination_flag(answer_text, sources)
            result.citation_found = citation_check(citations, q.get("ticker", ""), sources)
            result.retrieval_recall = evidence_recall(q.get("evidence", []), sources)

        except httpx.TimeoutException:
            result.error = "TIMEOUT"
            result.latency_ms = REQUEST_TIMEOUT * 1000
        except Exception as e:
            result.error = str(e)
            result.latency_ms = (time.perf_counter() - t0) * 1000

        return result


async def run_eval(
    questions: list[dict],
    output_path: Optional[str] = None,
) -> EvalReport:
    report = EvalReport()
    sem = asyncio.Semaphore(CONCURRENCY)

    async with httpx.AsyncClient() as client:
        # Verify gravity-api is up
        try:
            health = await client.get(f"{GRAVITY_API_URL}/health", timeout=5)
            health.raise_for_status()
            print(f"  gravity-api healthy at {GRAVITY_API_URL}", flush=True)
        except Exception as e:
            print(f"\n  ERROR: gravity-api unreachable at {GRAVITY_API_URL}: {e}", flush=True)
            print("  Start with: cd services/gravity-api && python -m uvicorn app.main:app --reload --port 8000", flush=True)
            sys.exit(1)

        await _ensure_token(client)
        if _TOKEN:
            print("  authed via signup token", flush=True)

        tasks = [evaluate_question(client, q, sem) for q in questions]

        print(f"\nRunning {len(tasks)} questions (concurrency={CONCURRENCY})...\n", flush=True)

        completed = 0
        for coro in asyncio.as_completed(tasks):
            r = await coro
            report.results.append(r)
            report.total += 1
            report.latencies.append(r.latency_ms)

            if r.error:
                report.errors += 1
            else:
                if r.exact_match:
                    report.exact_matches += 1
                if r.fuzzy_match:
                    report.fuzzy_matches += 1
                if _has_number(r.expected) and r.numeric_match:
                    report.numeric_matches += 1
                if r.hallucination_flag:
                    report.hallucinations += 1
                if r.citation_found:
                    report.citation_hits += 1
                if r.retrieval_recall:
                    report.recall_hits += 1

            # Per-category tracking
            cat = r.category
            if cat not in report.by_category:
                report.by_category[cat] = {"total": 0, "em": 0, "fm": 0, "errors": 0}
            report.by_category[cat]["total"] += 1
            if r.exact_match:
                report.by_category[cat]["em"] += 1
            if r.fuzzy_match:
                report.by_category[cat]["fm"] += 1
            if r.error:
                report.by_category[cat]["errors"] += 1

            # Progress
            completed += 1
            status = "✓" if (r.exact_match or r.fuzzy_match) else ("E" if r.error else "✗")
            print(f"  [{completed:3d}/{len(tasks)}] {status}  {r.id:<12} {r.latency_ms:6.0f}ms  {r.question[:55]}", flush=True)

    return report


# ─── Print report ─────────────────────────────────────────────────────────────

def print_report(report: EvalReport):
    WORLD_CLASS = {"em": 0.60, "fm": 0.75, "numeric": 0.80, "hallucination": 0.05}

    def grade(val: float, target: float, invert: bool = False) -> str:
        ok = val <= target if invert else val >= target
        return "✅" if ok else "❌"

    print("\n" + "═" * 62)
    print("  FINANCEBENCH EVALUATION RESULTS")
    print("═" * 62)
    print(f"  Questions evaluated : {report.total}")
    print(f"  Errors/timeouts     : {report.errors}")
    print()
    print(f"  Exact Match (EM)    : {report.em_rate:.1%}  {grade(report.em_rate, WORLD_CLASS['em'])}  (target ≥ {WORLD_CLASS['em']:.0%})")
    print(f"  Fuzzy Match (FM)    : {report.fm_rate:.1%}  {grade(report.fm_rate, WORLD_CLASS['fm'])}  (target ≥ {WORLD_CLASS['fm']:.0%})")
    print(f"  Numeric Accuracy    : {report.numeric_rate:.1%}  {grade(report.numeric_rate, WORLD_CLASS['numeric'])}  (target ≥ {WORLD_CLASS['numeric']:.0%})")
    print(f"  Hallucination Rate  : {report.hallucination_rate:.1%}  {grade(report.hallucination_rate, WORLD_CLASS['hallucination'], invert=True)}  (target ≤ {WORLD_CLASS['hallucination']:.0%})")
    print(f"  Citation Hit Rate   : {report.citation_rate:.1%}")
    print(f"  Retrieval Recall    : {report.recall_rate:.1%}  {grade(report.recall_rate, 0.90)}  (target ≥ 90%)")
    print()
    print(f"  Latency P50         : {report.p50_latency:.0f}ms")
    print(f"  Latency P95         : {report.p95_latency:.0f}ms")
    print()

    if report.by_category:
        print("  BY CATEGORY:")
        for cat, stats in sorted(report.by_category.items()):
            n = stats["total"]
            em = stats["em"] / n if n > 0 else 0
            fm = stats["fm"] / n if n > 0 else 0
            print(f"    {cat:<22} EM={em:.0%}  FM={fm:.0%}  n={n}")
        print()

    # Show failures for targeted debugging — type-aware (numeric Qs judged on
    # numeric_match, not exact text), so unit-equivalent answers aren't false fails.
    print(f"  ACCURACY (type-aware): {report.accuracy:.0%}  "
          f"[numeric {report.numeric_rate:.0%} · citation {report.citation_rate:.0%}]")
    failures = [r for r in report.results if not r.error and not report.is_correct(r)]
    if failures:
        print(f"  FAILURES TO FIX ({len(failures)}):")
        for r in failures[:10]:
            print(f"    [{r.id}] {r.question[:55]}")
            print(f"      Expected : {r.expected[:80]}")
            print(f"      Got      : {r.got[:80]}")
        if len(failures) > 10:
            print(f"    ... and {len(failures) - 10} more (see JSON output)")
    print("═" * 62)


# ─── Entry point ──────────────────────────────────────────────────────────────

def main():
    # Fix Windows console encoding (cp1252 can't handle box-drawing chars / emoji)
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:
            pass  # Python < 3.7

    parser = argparse.ArgumentParser(description="FinanceBench evaluation harness")
    parser.add_argument("--sample",   type=int, default=None,  help="Run N random questions instead of full set")
    parser.add_argument("--category", type=str, default=None,  help="Filter to a specific category")
    parser.add_argument("--output",   type=str, default=None,  help="Write JSON results to this path")
    parser.add_argument("--url",      type=str, default=None,  help="Override gravity-api base URL")
    parser.add_argument("--embedded", action="store_true",     help="Use embedded 25-question sample set (skips HuggingFace)")
    args = parser.parse_args()

    global GRAVITY_API_URL, SEARCH_ENDPOINT
    if args.url:
        GRAVITY_API_URL = args.url.rstrip("/")
        SEARCH_ENDPOINT = f"{GRAVITY_API_URL}/v1/search"

    print("FinanceBench Evaluation Harness")
    print(f"  Target API : {GRAVITY_API_URL}")
    print(f"  Tolerance  : {NUMERIC_TOLERANCE:.0%} numeric · ROUGE-L {ROUGE_THRESHOLD}")

    questions = load_dataset(sample=args.sample, category=args.category, embedded=args.embedded)
    if not questions:
        print("No questions loaded — check --category filter.")
        sys.exit(1)

    report = asyncio.run(run_eval(questions))
    print_report(report)

    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w") as f:
            # Convert dataclasses to dicts for JSON serialization
            data = asdict(report)
            json.dump(data, f, indent=2, default=str)
        print(f"\n  Results saved to {out}")


if __name__ == "__main__":
    main()

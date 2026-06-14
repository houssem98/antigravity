"""
FinanceBench eval — closed-book over PageIndex (the Mafin 2.5 engine).

This is the apples-to-apples comparison: each FinanceBench question ships with a
specific source filing (doc_name). We upload that PDF to PageIndex (tree-parse),
then answer the question via PageIndex's Chat API (reasoning-based navigation +
generation in one call), and score against the gold answer.

Contrast with financebench.py, which queries our prod open-corpus pipeline (which
lacks the historical filings → 51% empty, 16% accuracy). This harness measures the
*retrieval-engine ceiling* before we plumb PageIndex into prod.

Run:
  PAGEINDEX_API_KEY=... python -m tests.eval.financebench_pageindex --sample 30 \
      --output tests/eval/out/fb_pageindex.json

Needs: datasets, rouge-score, httpx. Doc uploads are cached in --cache so re-runs
skip re-indexing (PageIndex doc_ids are durable).
"""

import argparse
import asyncio
import json
import os
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path

import httpx

# Reuse the type-aware scorers from the prod harness.
from tests.eval.financebench import (
    _has_number, numeric_match, fuzzy_match, exact_match, load_dataset,
)

PI_KEY    = os.getenv("PAGEINDEX_API_KEY", "")
PI_BASE   = os.getenv("PAGEINDEX_BASE_URL", "https://api.pageindex.ai")
PDF_BASE  = "https://raw.githubusercontent.com/patronus-ai/financebench/main/pdfs"
CACHE     = os.getenv("PI_DOC_CACHE", "tests/eval/out/pi_doc_cache.json")

INDEX_CONCURRENCY = int(os.getenv("PI_INDEX_CONCURRENCY", "3"))
CHAT_CONCURRENCY  = int(os.getenv("PI_CHAT_CONCURRENCY", "4"))
PROCESS_TIMEOUT_S = int(os.getenv("PI_PROCESS_TIMEOUT", "300"))


def _h() -> dict:
    return {"api_key": PI_KEY}


def _load_cache() -> dict:
    try:
        return json.load(open(CACHE))
    except Exception:
        return {}


def _save_cache(c: dict) -> None:
    Path(CACHE).parent.mkdir(parents=True, exist_ok=True)
    json.dump(c, open(CACHE, "w"), indent=2)


# ─── PageIndex doc lifecycle ──────────────────────────────────────────────────

async def ensure_doc(client: httpx.AsyncClient, doc_name: str, cache: dict,
                     lock: asyncio.Lock) -> str | None:
    """Return a PageIndex doc_id for doc_name, indexing it if needed (cached)."""
    if doc_name in cache:
        return cache[doc_name]

    # download PDF from the FinanceBench github repo
    url = f"{PDF_BASE}/{doc_name}.pdf"
    try:
        r = await client.get(url, timeout=90, follow_redirects=True)
        if r.status_code != 200 or not r.content:
            print(f"  [pdf-miss] {doc_name} ({r.status_code})", flush=True)
            return None
        pdf = r.content
    except Exception as e:
        print(f"  [pdf-err] {doc_name}: {str(e)[:80]}", flush=True)
        return None

    # upload
    try:
        up = await client.post(f"{PI_BASE}/doc/", headers=_h(),
                               files={"file": (f"{doc_name}.pdf", pdf, "application/pdf")},
                               timeout=180)
        if up.status_code >= 300:
            print(f"  [upload-fail] {doc_name}: {up.status_code} {up.text[:120]}", flush=True)
            return None
        doc_id = up.json().get("doc_id")
    except Exception as e:
        print(f"  [upload-err] {doc_name}: {str(e)[:80]}", flush=True)
        return None

    # poll until processed
    t0 = time.time()
    while time.time() - t0 < PROCESS_TIMEOUT_S:
        await asyncio.sleep(6)
        try:
            st = await client.get(f"{PI_BASE}/doc/{doc_id}/", headers=_h(), timeout=30)
            j = st.json()
            if j.get("retrieval_ready") or j.get("status") in ("completed", "complete", "ready", "success"):
                break
        except Exception:
            continue

    async with lock:
        cache[doc_name] = doc_id
        _save_cache(cache)
    print(f"  [indexed] {doc_name} -> {doc_id} ({time.time()-t0:.0f}s)", flush=True)
    return doc_id


async def ask(client: httpx.AsyncClient, doc_id: str, question: str) -> str:
    """Answer a question over a doc via PageIndex Chat API (retrieval + gen)."""
    try:
        r = await client.post(
            f"{PI_BASE}/chat/completions", headers={**_h(), "Content-Type": "application/json"},
            json={"messages": [{"role": "user", "content": question}],
                  "doc_id": doc_id, "stream": False, "enable_citations": True},
            timeout=180,
        )
        if r.status_code >= 300:
            return ""
        return r.json()["choices"][0]["message"]["content"] or ""
    except Exception:
        return ""


# ─── Eval ─────────────────────────────────────────────────────────────────────

@dataclass
class Result:
    id: str
    category: str
    question: str
    expected: str
    got: str
    correct: bool
    numeric_q: bool
    latency_ms: float
    no_doc: bool = False


@dataclass
class Report:
    results: list = field(default_factory=list)
    no_doc: int = 0

    @property
    def total(self): return len(self.results)
    @property
    def answered(self): return [r for r in self.results if not r.no_doc]
    @property
    def correct(self): return sum(1 for r in self.results if r.correct)
    @property
    def accuracy(self):
        a = self.answered
        return (sum(1 for r in a if r.correct) / len(a)) if a else 0.0
    @property
    def accuracy_all(self):
        return (self.correct / self.total) if self.total else 0.0
    @property
    def numeric_acc(self):
        nq = [r for r in self.answered if r.numeric_q]
        return (sum(1 for r in nq if r.correct) / len(nq)) if nq else 0.0


def score(got: str, expected: str) -> bool:
    if not got.strip():
        return False
    if _has_number(expected):
        return numeric_match(got, expected) or exact_match(got, expected)
    return fuzzy_match(got, expected) or exact_match(got, expected)


async def run(questions: list[dict], output: str | None):
    if not PI_KEY:
        print("ERROR: set PAGEINDEX_API_KEY"); sys.exit(1)

    cache = _load_cache()
    lock = asyncio.Lock()
    report = Report()

    async with httpx.AsyncClient() as client:
        # 1. index all unique docs first (cached)
        docs = sorted({q["filing"] for q in questions if q.get("filing")})
        print(f"Indexing {len(docs)} unique docs (cached={sum(1 for d in docs if d in cache)})...", flush=True)
        sem_i = asyncio.Semaphore(INDEX_CONCURRENCY)
        async def _idx(d):
            async with sem_i:
                return d, await ensure_doc(client, d, cache, lock)
        doc_map = dict(await asyncio.gather(*[_idx(d) for d in docs]))

        # 2. answer each question
        print(f"\nAnswering {len(questions)} questions...", flush=True)
        sem_c = asyncio.Semaphore(CHAT_CONCURRENCY)
        async def _q(q):
            doc_id = doc_map.get(q.get("filing"))
            t0 = time.perf_counter()
            if not doc_id:
                return Result(q["id"], q.get("category", "?"), q["question"],
                              q["answer"], "", False, _has_number(q["answer"]),
                              0.0, no_doc=True)
            async with sem_c:
                got = await ask(client, doc_id, q["question"])
            ms = (time.perf_counter() - t0) * 1000
            ok = score(got, q["answer"])
            return Result(q["id"], q.get("category", "?"), q["question"],
                          q["answer"], got, ok, _has_number(q["answer"]), ms)

        done = 0
        for coro in asyncio.as_completed([_q(q) for q in questions]):
            r = await coro
            report.results.append(r)
            if r.no_doc:
                report.no_doc += 1
            done += 1
            mark = "✓" if r.correct else ("·" if r.no_doc else "✗")
            print(f"  [{done:3}/{len(questions)}] {mark} {r.id}  {r.got[:60].replace(chr(10),' ')}", flush=True)

    # report
    print("\n" + "=" * 62)
    print("  FINANCEBENCH × PAGEINDEX (closed-book)")
    print("=" * 62)
    print(f"  Questions          : {report.total}")
    print(f"  No-doc (pdf miss)  : {report.no_doc}")
    print(f"  Accuracy (answered): {report.accuracy:.0%}  ({report.correct}/{len(report.answered)})")
    print(f"  Accuracy (all)     : {report.accuracy_all:.0%}")
    print(f"  Numeric accuracy   : {report.numeric_acc:.0%}")
    print("=" * 62)
    fails = [r for r in report.answered if not r.correct]
    print(f"  FAILURES ({len(fails)}):")
    for r in fails[:12]:
        print(f"    [{r.id}] {r.question[:55]}")
        print(f"      exp: {r.expected[:70]}")
        print(f"      got: {r.got[:70]}")

    if output:
        Path(output).parent.mkdir(parents=True, exist_ok=True)
        json.dump({"summary": {"total": report.total, "no_doc": report.no_doc,
                               "accuracy_answered": report.accuracy,
                               "accuracy_all": report.accuracy_all,
                               "numeric_acc": report.numeric_acc},
                   "results": [asdict(r) for r in report.results]},
                  open(output, "w"), indent=2, default=str)
        print(f"\n  saved {output}")


def main():
    if sys.platform == "win32":
        try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError: pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=None)
    ap.add_argument("--category", type=str, default=None)
    ap.add_argument("--output", type=str, default=None)
    args = ap.parse_args()

    questions = load_dataset(sample=args.sample, category=args.category)
    print(f"PageIndex closed-book eval — {len(questions)} questions\n")
    asyncio.run(run(questions, args.output))


if __name__ == "__main__":
    main()

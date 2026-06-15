"""
FinanceBench eval — deterministic numeric answering over SEC XBRL exact facts.

For each question: resolve the company's CIK, pull its SEC XBRL companyfacts for the
relevant fiscal years (the company's OWN tagged numbers), hand the LLM ONLY that
exact-facts table, and let it compute/answer. The figures come from SEC, not from
prose retrieval — so wrong-period and table-misalignment errors are eliminated, and
the model can only ground on real tagged values.

This proves the numeric ceiling of the XBRL exact-facts channel (closed-book), the
same way financebench_pageindex.py proved the tree-nav ceiling.

Run:
  python -m tests.eval.financebench_xbrl --sample 40 --output tests/eval/out/fb_xbrl.json
Needs ANTHROPIC_API_KEY (read from services/gravity-api/.env), datasets, rouge-score, httpx.
"""

import argparse
import asyncio
import json
import os
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path

import httpx

from tests.eval.financebench import (
    _has_number, numeric_match, fuzzy_match, exact_match, load_dataset,
)
from app.ingestion.sources.sec_xbrl import SECXBRLClient, facts_to_block

# Answer LLM. Anthropic local keys are dead, so default to DeepSeek (strong at
# financial arithmetic, OpenAI-compatible). Override with XBRL_PROVIDER=groq|deepseek.
CONCURRENCY = int(os.getenv("XBRL_CONCURRENCY", "4"))
PROVIDER = os.getenv("XBRL_PROVIDER", "deepseek").lower()

_PROVIDERS = {
    "deepseek": ("https://api.deepseek.com/chat/completions", "deepseek-chat", "DEEPSEEK_API_KEY"),
    "groq": ("https://api.groq.com/openai/v1/chat/completions", "llama-3.3-70b-versatile", "GROQ_API_KEY"),
    # Ollama: free, unlimited, local. No API key. Model via XBRL_ANSWER_MODEL.
    "ollama": ("http://localhost:11434/v1/chat/completions", "qwen2.5-coder:7b", "OLLAMA_NO_KEY"),
}


def _envkey(name: str) -> str:
    if os.getenv(name):
        return os.getenv(name, "")
    envp = Path(".env")
    if envp.exists():
        for line in envp.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"')
    return ""


_LLM_URL, ANSWER_MODEL, _KEYENV = _PROVIDERS.get(PROVIDER, _PROVIDERS["deepseek"])
ANSWER_MODEL = os.getenv("XBRL_ANSWER_MODEL", ANSWER_MODEL)
LLM_KEY = _envkey(_KEYENV)

SYSTEM = (
    "You are a financial analyst. Answer the question using ONLY the SEC XBRL exact "
    "facts provided. These are the company's own tagged figures. You may do arithmetic "
    "(ratios, growth, CAGR, margins) using ONLY these numbers. If the needed figure is "
    "not in the facts, reply exactly: INSUFFICIENT_FACTS. Give the final number clearly "
    "(with unit/%); be concise."
)


async def answer_with_facts(client: httpx.AsyncClient, question: str, facts_block: str) -> str:
    content = (
        f"SEC XBRL EXACT FACTS:\n{facts_block}\n\n"
        f"QUESTION: {question}\n\n"
        "Answer using only the facts above. Show the final number."
    )
    headers = {"Content-Type": "application/json"}
    if LLM_KEY:  # Ollama needs no auth; an empty "Bearer " is an illegal header
        headers["Authorization"] = f"Bearer {LLM_KEY}"
    try:
        r = await client.post(
            _LLM_URL,
            headers=headers,
            json={"model": ANSWER_MODEL, "max_tokens": 700, "temperature": 0,
                  "messages": [{"role": "system", "content": SYSTEM},
                               {"role": "user", "content": content}]},
            timeout=120,
        )
        if r.status_code >= 300:
            return f"__ERR__ {r.status_code} {r.text[:100]}"
        return r.json()["choices"][0]["message"]["content"] or ""
    except Exception as e:
        return f"__ERR__ {str(e)[:100]}"


def _company_from_filing(doc_name: str) -> str:
    """'AMERICAN_WATER_WORKS_2020_10K' -> 'AMERICAN WATER WORKS' (text before the year)."""
    if not doc_name:
        return ""
    m = re.split(r"_(?:19|20)\d{2}", doc_name)[0]
    return m.replace("_", " ").strip()


def _fiscal_years(q: dict) -> list[int]:
    """Target year from doc_period, plus 3 prior years for change/CAGR/avg questions."""
    yrs: set[int] = set()
    base = None
    # doc_period if numeric
    try:
        base = int(str(q.get("filing", "")).split("_")[1])
    except Exception:
        pass
    found = sorted({int(y) for y in re.findall(r"((?:19|20)\d{2})", q.get("question", ""))})
    if base:
        for d in range(0, 4):
            yrs.add(base - d)
    for y in found:
        yrs.add(y); yrs.add(y - 1)
    if not yrs and base:
        yrs = {base}
    return sorted(yrs)


@dataclass
class R:
    id: str; category: str; question: str; expected: str; got: str
    correct: bool; numeric_q: bool; no_facts: bool = False


@dataclass
class Rep:
    results: list = field(default_factory=list)
    @property
    def total(self): return len(self.results)
    @property
    def usable(self): return [r for r in self.results if not r.no_facts]
    @property
    def correct(self): return sum(1 for r in self.results if r.correct)
    @property
    def acc_usable(self):
        u = self.usable
        return sum(1 for r in u if r.correct) / len(u) if u else 0.0
    @property
    def acc_all(self): return self.correct / self.total if self.total else 0.0
    @property
    def numeric_acc(self):
        nq = [r for r in self.usable if r.numeric_q]
        return sum(1 for r in nq if r.correct) / len(nq) if nq else 0.0


def _extract_gold_number(expected: str):
    from tests.eval.financebench import _extract_numbers
    nums = _extract_numbers(expected)
    return nums[0] if nums else None


def facts_cover_gold(rows: list[dict], expected: str, tol: float = 0.02) -> bool:
    """LLM-free: does the gold numeric answer appear among the XBRL values
    (scale-aware: XBRL is in actual $, gold is often in millions)?
    Proves the exact-facts source CONTAINS the answer — the retrieval ceiling."""
    gold = _extract_gold_number(expected)
    if gold is None or gold == 0:
        return False
    for r in rows:
        v = r.get("value")
        try:
            v = float(v)
        except (TypeError, ValueError):
            continue
        for scale in (1, 1e3, 1e6, 1e9):
            for cand in (v, v / scale, v * scale):
                if cand != 0 and abs(cand - gold) / abs(gold) <= tol:
                    return True
    return False


def score(got: str, expected: str) -> bool:
    if not got.strip() or got.startswith("__ERR__") or "INSUFFICIENT_FACTS" in got:
        return False
    if _has_number(expected):
        return numeric_match(got, expected) or exact_match(got, expected)
    return fuzzy_match(got, expected) or exact_match(got, expected)


async def run(questions: list[dict], output: str | None, coverage: bool = False):
    if not coverage and not LLM_KEY and PROVIDER != "ollama":
        print(f"ERROR: no {_KEYENV} (provider={PROVIDER})"); sys.exit(1)
    sec = SECXBRLClient()
    rep = Rep()
    facts_cache: dict[int, dict] = {}

    async with httpx.AsyncClient() as llm:
        sem = asyncio.Semaphore(CONCURRENCY)

        async def one(q: dict) -> R:
            numeric_q = _has_number(q["answer"])
            company = q.get("company") or q.get("ticker") or _company_from_filing(q.get("filing", ""))
            cik = await sec.resolve_cik(ticker=company, company=company)
            if not cik:
                cik = await sec.resolve_cik(company=_company_from_filing(q.get("filing", "")))
            if not cik:
                return R(q["id"], q.get("category", "?"), q["question"], q["answer"],
                         "__no_cik__", False, numeric_q, no_facts=True)
            try:
                if cik not in facts_cache:
                    facts_cache[cik] = await sec.get_company_facts(cik)
                # Coverage probe checks against ALL tagged concepts (true ceiling);
                # the LLM path uses the compact CORE set to bound context.
                from app.ingestion.sources.sec_xbrl import CORE_CONCEPTS
                rows = sec.extract_facts(facts_cache[cik], _fiscal_years(q),
                                         concepts=None if coverage else CORE_CONCEPTS)
            except Exception as e:
                return R(q["id"], q.get("category", "?"), q["question"], q["answer"],
                         f"__facts_err__ {str(e)[:60]}", False, numeric_q, no_facts=True)
            if not rows:
                return R(q["id"], q.get("category", "?"), q["question"], q["answer"],
                         "__no_facts__", False, numeric_q, no_facts=True)
            # Coverage mode: LLM-free. Only meaningful for numeric Qs.
            if coverage:
                if not numeric_q:
                    return R(q["id"], q.get("category", "?"), q["question"], q["answer"],
                             "__non_numeric__", False, numeric_q, no_facts=True)
                covered = facts_cover_gold(rows, q["answer"])
                return R(q["id"], q.get("category", "?"), q["question"], q["answer"],
                         f"covered={covered}", covered, numeric_q)
            block = facts_to_block(rows)
            async with sem:
                got = await answer_with_facts(llm, q["question"], block)
            return R(q["id"], q.get("category", "?"), q["question"], q["answer"],
                     got, score(got, q["answer"]), numeric_q)

        done = 0
        for coro in asyncio.as_completed([one(q) for q in questions]):
            r = await coro
            rep.results.append(r)
            done += 1
            mark = "✓" if r.correct else ("·" if r.no_facts else "✗")
            print(f"  [{done:3}/{len(questions)}] {mark} {r.id}  {r.got[:60].replace(chr(10),' ')}", flush=True)

    print("\n" + "=" * 62)
    print("  FINANCEBENCH × SEC-XBRL exact facts (closed-book)")
    print("=" * 62)
    print(f"  Questions            : {rep.total}")
    print(f"  No-facts (cik/concept miss): {sum(1 for r in rep.results if r.no_facts)}")
    print(f"  Accuracy (with facts): {rep.acc_usable:.0%}  ({rep.correct}/{len(rep.usable)})")
    print(f"  Accuracy (all)       : {rep.acc_all:.0%}")
    print(f"  Numeric accuracy     : {rep.numeric_acc:.0%}")
    print("=" * 62)
    fails = [r for r in rep.usable if not r.correct]
    print(f"  FAILURES ({len(fails)}):")
    for r in fails[:12]:
        print(f"    [{r.id}] {r.question[:55]}")
        print(f"      exp: {r.expected[:70]}")
        print(f"      got: {r.got[:90].replace(chr(10),' ')}")

    if output:
        Path(output).parent.mkdir(parents=True, exist_ok=True)
        json.dump({"summary": {"total": rep.total,
                               "acc_with_facts": rep.acc_usable, "acc_all": rep.acc_all,
                               "numeric_acc": rep.numeric_acc},
                   "results": [asdict(r) for r in rep.results]},
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
    ap.add_argument("--coverage", action="store_true",
                    help="LLM-free: measure whether gold numeric answers exist in SEC XBRL facts")
    args = ap.parse_args()
    questions = load_dataset(sample=args.sample, category=args.category)
    mode = "COVERAGE (LLM-free)" if args.coverage else f"answer model={ANSWER_MODEL}"
    print(f"SEC-XBRL eval — {len(questions)} questions ({mode})\n")
    asyncio.run(run(questions, args.output, coverage=args.coverage))


if __name__ == "__main__":
    main()

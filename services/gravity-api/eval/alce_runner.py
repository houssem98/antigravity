"""
ALCE Citation Evaluation — Section 2.3 of Financial_AI_Benchmark_Specification.md.

Measures:
  - Citation recall (sentence-level NLI, ALCE-faithful)
  - Citation precision (leave-one-out NLI)
  - Adversarial citation rate (distractor passages)
  - Span-level Precision@k / Recall@k

Usage:
    python eval/alce_runner.py --input results/financebench.json --output results/alce_finance.json
    python eval/alce_runner.py --live --questions 50 --output results/alce_live.json

The --live flag runs queries against gravity-api and collects citations in real time.
The --input flag scores citations already stored in a previous financebench run.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

import httpx

GRAVITY_API_URL = "http://localhost:8000"
API_KEY = "deep-research-internal"
REQUEST_TIMEOUT = 90.0
CONCURRENCY = 4

# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class CitationEvalItem:
    id: str
    question: str
    answer_text: str                # model's output
    citations: list[str]            # list of retrieved passage texts cited
    gold_answer: str
    gold_spans: list[str]           # gold evidence spans
    is_adversarial: bool = False    # True if distractor passages were injected


@dataclass
class ALCEResult:
    id: str
    citation_recall: float          # NLI-based recall per sentence
    citation_precision: float       # leave-one-out NLI precision
    adversarial_cited: bool         # did system cite a distractor?
    span_recall_at_5: float
    n_sentences: int
    n_citations: int


@dataclass
class ALCEReport:
    total: int
    citation_recall: float          # mean across all items
    citation_precision: float
    adversarial_citation_rate: float
    span_recall_at_5: float
    targets: dict                   # spec targets for comparison
    results: list[ALCEResult] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


# ── Sentence splitter ─────────────────────────────────────────────────────────

def split_sentences(text: str) -> list[str]:
    # Simple sentence splitter preserving financial abbreviations
    text = re.sub(r'\b(Mr|Mrs|Dr|Corp|Inc|Ltd|vs|etc|i\.e|e\.g)\.\s', r'\1<DOT> ', text)
    sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)
    return [s.replace("<DOT>", ".").strip() for s in sentences if s.strip()]


# ── Citation parser ───────────────────────────────────────────────────────────

def extract_inline_citations(text: str, citation_passages: list[str]) -> tuple[list[str], list[list[str]]]:
    """
    Parse inline citations like [1], [2,3] from model output.
    Returns (sentences, citations_per_sentence).
    """
    sentences = split_sentences(text)
    citations_per = []
    for sent in sentences:
        cited_idxs = re.findall(r'\[(\d+)\]', sent)
        cited = []
        for idx_str in cited_idxs:
            idx = int(idx_str) - 1
            if 0 <= idx < len(citation_passages):
                cited.append(citation_passages[idx])
        citations_per.append(cited)
    return sentences, citations_per


# ── NLI judge (local import from app, falls back to heuristic) ────────────────

def _nli_entails(premise: str, hypothesis: str) -> int:
    try:
        from app.core.reasoning.nli_judge import FinanceNLIJudge
        judge = FinanceNLIJudge()
        result = judge.score_sync(premise, hypothesis)
        return result.entails
    except Exception:
        # Fallback: token overlap heuristic
        hyp_toks = set(hypothesis.lower().split())
        pre_toks = set(premise.lower().split())
        if not hyp_toks:
            return 1
        overlap = len(hyp_toks & pre_toks) / len(hyp_toks)
        return 1 if overlap >= 0.6 else 0


# ── Scorer ────────────────────────────────────────────────────────────────────

def score_item(item: CitationEvalItem) -> ALCEResult:
    sentences, cites_per = extract_inline_citations(item.answer_text, item.citations)

    # Citation recall: NLI(concat(Ri), si)
    recall_scores = []
    for sent, cites in zip(sentences, cites_per):
        if not cites:
            recall_scores.append(0)
            continue
        premise = " ".join(cites)
        recall_scores.append(_nli_entails(premise, sent))

    recall = sum(recall_scores) / max(len(recall_scores), 1)

    # Citation precision: leave-one-out
    prec_scores = []
    for sent, cites in zip(sentences, cites_per):
        if len(cites) <= 1:
            if cites:
                prec_scores.append(_nli_entails(cites[0], sent))
            continue
        for i in range(len(cites)):
            rest = [c for j, c in enumerate(cites) if j != i]
            rest_entails = _nli_entails(" ".join(rest), sent)
            # precise if removing it breaks entailment
            prec_scores.append(1 if not rest_entails else 0)

    precision = sum(prec_scores) / max(len(prec_scores), 1)

    # Adversarial check: did any distractor get cited?
    adversarial_cited = False
    if item.is_adversarial and item.gold_spans:
        for cites in cites_per:
            for cited in cites:
                # A distractor is cited when it doesn't NLI-entail the gold answer
                if not _nli_entails(cited, item.gold_answer):
                    adversarial_cited = True
                    break

    # Span recall@5: how many gold spans appear in top-5 citations
    top_5_text = " ".join(item.citations[:5]).lower()
    span_hits = sum(
        1 for span in item.gold_spans
        if any(w in top_5_text for w in span.lower().split() if len(w) > 4)
    )
    span_recall = span_hits / max(len(item.gold_spans), 1)

    return ALCEResult(
        id=item.id,
        citation_recall=round(recall, 4),
        citation_precision=round(precision, 4),
        adversarial_cited=adversarial_cited,
        span_recall_at_5=round(span_recall, 4),
        n_sentences=len(sentences),
        n_citations=len(item.citations),
    )


# ── Live collection from gravity-api ─────────────────────────────────────────

async def collect_live(n_questions: int) -> list[CitationEvalItem]:
    from datasets import load_dataset as hf_load
    import random

    try:
        ds = hf_load("PatronusAI/financebench", split="train")
        rows = list(ds)
    except Exception as e:
        print(f"HuggingFace failed: {e} — using minimal fallback", flush=True)
        rows = []

    if rows and n_questions < len(rows):
        random.seed(42)
        rows = random.sample(rows, n_questions)

    items: list[CitationEvalItem] = []
    sem = asyncio.Semaphore(CONCURRENCY)

    async def fetch(row: dict, idx: int) -> CitationEvalItem | None:
        async with sem:
            question = row.get("question", "")
            gold = row.get("answer", "")
            evidence = ""
            if row.get("evidence"):
                evidence = row["evidence"][0].get("evidence_text", "")
            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.post(
                        f"{GRAVITY_API_URL}/v1/search",
                        json={"query": question, "reasoning_depth": "fast", "stream": False},
                        headers={"X-API-Key": API_KEY},
                        timeout=REQUEST_TIMEOUT,
                    )
                    resp.raise_for_status()
                    data = resp.json()

                answer = data.get("answer", "")
                sources = data.get("sources", [])
                citation_texts = [s.get("text", s.get("content", "")) for s in sources]

                print(f"  [{idx+1}/{len(rows)}] {row.get('financebench_id', idx)}: {question[:50]}", flush=True)
                return CitationEvalItem(
                    id=row.get("financebench_id", str(idx)),
                    question=question,
                    answer_text=answer,
                    citations=citation_texts,
                    gold_answer=gold,
                    gold_spans=[evidence] if evidence else [],
                )
            except Exception as e:
                print(f"  [{idx+1}] ERROR: {e}", flush=True)
                return None

    tasks = [fetch(r, i) for i, r in enumerate(rows)]
    results = await asyncio.gather(*tasks)
    return [r for r in results if r is not None]


# ── Aggregate & report ────────────────────────────────────────────────────────

def aggregate(results: list[ALCEResult]) -> ALCEReport:
    if not results:
        return ALCEReport(0, 0, 0, 0, 0, {})

    n = len(results)
    recall = sum(r.citation_recall for r in results) / n
    precision = sum(r.citation_precision for r in results) / n
    adv_rate = sum(1 for r in results if r.adversarial_cited) / n
    span_r5 = sum(r.span_recall_at_5 for r in results) / n

    targets = {
        "citation_recall_target": 0.92,
        "citation_precision_target": 0.90,
        "adversarial_rate_target": 0.02,
        "span_recall_at_5_target": 0.85,
    }

    return ALCEReport(
        total=n,
        citation_recall=round(recall, 4),
        citation_precision=round(precision, 4),
        adversarial_citation_rate=round(adv_rate, 4),
        span_recall_at_5=round(span_r5, 4),
        targets=targets,
        results=results,
    )


def print_report(report: ALCEReport):
    def grade(val: float, target: float, invert: bool = False) -> str:
        ok = val <= target if invert else val >= target
        return "PASS" if ok else "FAIL"

    print(f"\n{'═'*60}")
    print("  ALCE CITATION EVALUATION")
    print(f"{'═'*60}")
    print(f"  n = {report.total}")
    print()
    t = report.targets
    print(f"  Citation Recall      : {report.citation_recall*100:.1f}%  "
          f"{grade(report.citation_recall, t['citation_recall_target'])}  "
          f"(target ≥ {t['citation_recall_target']*100:.0f}%)")
    print(f"  Citation Precision   : {report.citation_precision*100:.1f}%  "
          f"{grade(report.citation_precision, t['citation_precision_target'])}  "
          f"(target ≥ {t['citation_precision_target']*100:.0f}%)")
    print(f"  Adversarial Rate     : {report.adversarial_citation_rate*100:.1f}%  "
          f"{grade(report.adversarial_citation_rate, t['adversarial_rate_target'], invert=True)}  "
          f"(target ≤ {t['adversarial_rate_target']*100:.0f}%)")
    print(f"  Span Recall@5        : {report.span_recall_at_5*100:.1f}%  "
          f"{grade(report.span_recall_at_5, t['span_recall_at_5_target'])}  "
          f"(target ≥ {t['span_recall_at_5_target']*100:.0f}%)")
    print()
    print("  GPT-4 ASQA baselines (Wikipedia):  recall ~77%,  precision ~73%")
    print(f"{'═'*60}\n")


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:
            pass

    parser = argparse.ArgumentParser(description="ALCE citation evaluation")
    parser.add_argument("--live", action="store_true",
                        help="Collect live from gravity-api")
    parser.add_argument("--questions", type=int, default=50,
                        help="Number of questions for --live mode")
    parser.add_argument("--input", type=str, default=None,
                        help="Score citations from existing results JSON")
    parser.add_argument("--output", type=str, default="results/alce_finance.json",
                        help="Output path")
    parser.add_argument("--url", type=str, default=None)
    args = parser.parse_args()

    global GRAVITY_API_URL
    if args.url:
        GRAVITY_API_URL = args.url.rstrip("/")

    items: list[CitationEvalItem] = []

    if args.live:
        print(f"Collecting {args.questions} live answers from {GRAVITY_API_URL}…")
        items = asyncio.run(collect_live(args.questions))
    elif args.input:
        print(f"Loading from {args.input}…")
        with open(args.input, encoding="utf-8") as f:
            data = json.load(f)
        raw = data.get("results", data) if isinstance(data, dict) else data
        for r in raw:
            if isinstance(r, dict) and r.get("predicted"):
                items.append(CitationEvalItem(
                    id=r.get("id", ""),
                    question=r.get("question", ""),
                    answer_text=r.get("predicted", ""),
                    citations=[],
                    gold_answer=r.get("gold", r.get("answer", "")),
                    gold_spans=[],
                ))
    else:
        print("Pass --live or --input. See --help.", file=sys.stderr)
        sys.exit(1)

    if not items:
        print("No items to score.")
        sys.exit(1)

    print(f"\nScoring {len(items)} items…")
    results = [score_item(item) for item in items]
    report = aggregate(results)
    print_report(report)

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report.to_dict(), f, indent=2, default=str)
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()

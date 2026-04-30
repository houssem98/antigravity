"""
ALCE Finance Extension — §Benchmark 2.3
Sentence-level citation recall and precision for SEC filings, adapted from:
    arXiv:2305.14627 (ALCE / Gao et al., EMNLP 2023)
    arXiv:2406.13375 (ALiiCE atomic-claim extension)

Key extensions over the original ALCE:
  • Deterministic numeric pre-check before NLI (currency, scale, percent, bps)
  • Adversarial-citation detection (peer-company or prior-FY distractors)
  • Span-level Precision@k / Recall@k over character-overlap gold spans
  • Bootstrap 95% CI reporting (critical: public FinanceBench n=150 → ±7 pp)
  • Unanswerable-question detection scoring

Usage:
    from tests.eval.alce_finance_extension import ALCEFinanceEvaluator

    ev = ALCEFinanceEvaluator()
    report = ev.evaluate(examples)
    print(report.summary())
"""

from __future__ import annotations

import re
import math
import random
import statistics
from dataclasses import dataclass, field
from typing import Optional

from app.core.verification.nli_verifier import verify_entailment, NLIResult


# ─── Data contracts ───────────────────────────────────────────────────────────

@dataclass
class CitedPassage:
    """A passage cited by the model response."""
    chunk_id:   str
    text:       str
    source_uri: str = ""
    char_start: int = -1
    char_end:   int = -1
    is_adversarial: bool = False  # True = deliberately planted distractor


@dataclass
class GoldSpan:
    """Ground-truth evidence span from the annotated dataset."""
    filename:   str
    char_start: int
    char_end:   int
    text:       str = ""


@dataclass
class ALCEExample:
    """One evaluation example."""
    example_id:   str
    question:     str
    gold_answer:  str
    response:     str                      # model output (may contain [1],[2] tags)
    cited_passages: list[CitedPassage]     # passages cited by index [1],[2]…
    gold_spans:   list[GoldSpan] = field(default_factory=list)
    is_unanswerable: bool = False          # no evidence exists → correct to refuse


@dataclass
class SentenceScore:
    sentence:   str
    citation_ids: list[int]               # 1-indexed, matching cited_passages
    recall:     float                     # 1 if NLI(concat_cited → sentence), else 0
    precision:  float                     # leave-one-out NLI result
    nli_method: str = ""


@dataclass
class ALCEExampleResult:
    example_id:      str
    sentence_scores: list[SentenceScore]
    recall:          float                # mean recall over all sentences
    precision:       float                # mean precision over sentences with ≥2 citations
    adversarial_citations: int            # count of distractor passages cited
    span_recall_at: dict[int, float]      # k → span Recall@k (char-overlap)
    unanswerable_handled: Optional[bool]  # None if not unanswerable
    nli_methods_used: dict[str, int]      # method → count


@dataclass
class ALCEReport:
    n:                    int
    citation_recall:      float           # §2.3 headline metric
    citation_precision:   float
    adversarial_rate:     float           # fraction citing ≥1 distractor
    span_recall_at:       dict[int, float]
    unanswerable_refusal_rate: Optional[float]
    ci_recall_95:         tuple[float, float]
    ci_precision_95:      tuple[float, float]
    nli_method_breakdown: dict[str, int]
    details:              list[ALCEExampleResult]

    def summary(self) -> str:
        lines = [
            f"ALCE Finance — n={self.n}",
            f"  Citation recall    : {self.citation_recall*100:.1f}%  "
            f"95% CI [{self.ci_recall_95[0]*100:.1f}%, {self.ci_recall_95[1]*100:.1f}%]",
            f"  Citation precision : {self.citation_precision*100:.1f}%  "
            f"95% CI [{self.ci_precision_95[0]*100:.1f}%, {self.ci_precision_95[1]*100:.1f}%]",
            f"  Adversarial cite   : {self.adversarial_rate*100:.1f}%  (target ≤2%)",
        ]
        for k, v in sorted(self.span_recall_at.items()):
            lines.append(f"  Span Recall@{k:2d}    : {v*100:.1f}%")
        if self.unanswerable_refusal_rate is not None:
            lines.append(f"  Unanswerable refusal: {self.unanswerable_refusal_rate*100:.1f}%")
        lines.append(f"  NLI methods: " + ", ".join(
            f"{m}={c}" for m, c in sorted(self.nli_method_breakdown.items())
        ))
        return "\n".join(lines)

    def to_dict(self) -> dict:
        return {
            "n": self.n,
            "citation_recall":    round(self.citation_recall, 4),
            "citation_precision": round(self.citation_precision, 4),
            "adversarial_rate":   round(self.adversarial_rate, 4),
            "span_recall_at":     {str(k): round(v, 4) for k, v in self.span_recall_at.items()},
            "unanswerable_refusal_rate": (
                round(self.unanswerable_refusal_rate, 4)
                if self.unanswerable_refusal_rate is not None else None
            ),
            "ci_recall_95":       [round(x, 4) for x in self.ci_recall_95],
            "ci_precision_95":    [round(x, 4) for x in self.ci_precision_95],
            "nli_method_breakdown": self.nli_method_breakdown,
        }


# ─── Sentence splitter ───────────────────────────────────────────────────────

_CITATION_RE = re.compile(r"\[(?:RAG-)?\d+(?:,\s*\d+)*\]")
_SENT_RE     = re.compile(r"(?<=[.!?])\s+(?=[A-Z(])")


def _split_sentences(text: str) -> list[tuple[str, list[int]]]:
    """
    Split response into (sentence_text, [citation_ids]) pairs.
    Citations are 1-indexed and extracted before the sentence boundary.
    """
    sentences = []
    for raw in _SENT_RE.split(text.strip()):
        raw = raw.strip()
        if not raw:
            continue
        ids: list[int] = []
        for m in _CITATION_RE.finditer(raw):
            inner = m.group()[1:-1]
            for part in re.split(r",\s*", inner):
                part = part.strip().lstrip("RAG-")
                try:
                    ids.append(int(part))
                except ValueError:
                    pass
        clean = _CITATION_RE.sub("", raw).strip()
        sentences.append((clean, ids))
    return sentences


# ─── Span-level Recall@k ─────────────────────────────────────────────────────

def _char_overlap(gold: GoldSpan, cited: CitedPassage) -> bool:
    """True iff cited passage filename-matches gold and char ranges overlap."""
    if not cited.source_uri:
        return False
    gold_file = gold.filename.replace("\\", "/").split("/")[-1].lower()
    cited_file = cited.source_uri.replace("\\", "/").split("/")[-1].lower()
    if gold_file not in cited_file and cited_file not in gold_file:
        return False
    if cited.char_start < 0 or cited.char_end < 0:
        return False
    return cited.char_start < gold.char_end and cited.char_end > gold.char_start


def _span_recall_at_k(gold_spans: list[GoldSpan], cited_passages: list[CitedPassage],
                      ks: list[int]) -> dict[int, float]:
    result: dict[int, float] = {}
    if not gold_spans:
        return {k: 1.0 for k in ks}   # no gold spans → not penalized
    for k in ks:
        top_k = cited_passages[:k]
        found = sum(1 for g in gold_spans if any(_char_overlap(g, c) for c in top_k))
        result[k] = found / len(gold_spans)
    return result


# ─── Bootstrap CI ────────────────────────────────────────────────────────────

def _bootstrap_ci(values: list[float], n_boot: int = 2000,
                  alpha: float = 0.05, seed: int = 42) -> tuple[float, float]:
    """Percentile bootstrap 95% CI for a mean."""
    if not values:
        return (0.0, 0.0)
    rng = random.Random(seed)
    n = len(values)
    boot_means = sorted(
        statistics.mean(rng.choices(values, k=n))
        for _ in range(n_boot)
    )
    lo = boot_means[int(alpha / 2 * n_boot)]
    hi = boot_means[int((1 - alpha / 2) * n_boot)]
    return (lo, hi)


# ─── Unanswerable detection ──────────────────────────────────────────────────

_REFUSAL_PATTERNS = re.compile(
    r"\b(cannot\s+find|no\s+(evidence|information|data)|not\s+(available|found|present)|"
    r"unable\s+to\s+(answer|find)|information\s+(not|unavailable)|"
    r"does\s+not\s+(contain|include|mention|address))\b",
    re.IGNORECASE,
)


def _response_refuses(response: str) -> bool:
    return bool(_REFUSAL_PATTERNS.search(response))


# ─── Core evaluator ──────────────────────────────────────────────────────────

class ALCEFinanceEvaluator:
    """
    Evaluates citation recall and precision per ALCE §2.3 of the benchmark spec.

    Parameters
    ----------
    span_ks : list[int]
        Values of k for Precision@k / Recall@k over gold char-spans.
    """

    def __init__(self, span_ks: list[int] | None = None):
        self.span_ks = span_ks or [1, 5, 10, 20]

    def _score_example(self, ex: ALCEExample) -> ALCEExampleResult:
        sentence_scores: list[SentenceScore] = []
        nli_methods: dict[str, int] = {}

        for sent_text, cite_ids in _split_sentences(ex.response):
            if not sent_text:
                continue

            # Map citation ids → passages
            passages = [ex.cited_passages[i - 1]
                        for i in cite_ids
                        if 0 < i <= len(ex.cited_passages)]

            if not passages:
                # No citations → recall = 0 (per ALCE spec)
                sentence_scores.append(SentenceScore(
                    sentence=sent_text, citation_ids=cite_ids,
                    recall=0.0, precision=0.0, nli_method="no_citation",
                ))
                continue

            # ── Recall: NLI(concat all passages → sentence)
            concat_premise = " ".join(p.text for p in passages)
            recall_result  = verify_entailment(concat_premise, sent_text)
            nli_methods[recall_result.method] = nli_methods.get(recall_result.method, 0) + 1
            recall_score = 1.0 if recall_result.entailed else 0.0

            # ── Precision: leave-one-out (only meaningful when ≥2 citations)
            if len(passages) < 2:
                precision_score = recall_score   # single citation = same as recall
            else:
                # A citation is IMPRECISE if the others suffice without it.
                n_precise = 0
                for i, _ in enumerate(passages):
                    rest_premise = " ".join(p.text for j, p in enumerate(passages) if j != i)
                    rest_result  = verify_entailment(rest_premise, sent_text)
                    nli_methods[rest_result.method] = nli_methods.get(rest_result.method, 0) + 1
                    if not rest_result.entailed:
                        # Removing citation i breaks entailment → this citation IS precise
                        n_precise += 1
                # Score: fraction of citations that are individually necessary
                precision_score = n_precise / len(passages)

            sentence_scores.append(SentenceScore(
                sentence=sent_text, citation_ids=cite_ids,
                recall=recall_score, precision=precision_score,
                nli_method=recall_result.method,
            ))

        # ── Aggregate recall/precision
        recalls    = [s.recall    for s in sentence_scores]
        precisions = [s.precision for s in sentence_scores if s.citation_ids]

        recall    = statistics.mean(recalls)    if recalls    else 0.0
        precision = statistics.mean(precisions) if precisions else 0.0

        # ── Adversarial citations
        adv = sum(
            1 for i in set(cid
                            for s in sentence_scores
                            for cid in s.citation_ids
                            if 0 < cid <= len(ex.cited_passages))
            if ex.cited_passages[i - 1].is_adversarial
        )

        # ── Span Recall@k
        span_recall = _span_recall_at_k(ex.gold_spans, ex.cited_passages, self.span_ks)

        # ── Unanswerable handling
        unanswerable_handled: Optional[bool] = None
        if ex.is_unanswerable:
            unanswerable_handled = _response_refuses(ex.response)

        return ALCEExampleResult(
            example_id=ex.example_id,
            sentence_scores=sentence_scores,
            recall=recall,
            precision=precision,
            adversarial_citations=adv,
            span_recall_at=span_recall,
            unanswerable_handled=unanswerable_handled,
            nli_methods_used=nli_methods,
        )

    def evaluate(self, examples: list[ALCEExample]) -> ALCEReport:
        results = [self._score_example(ex) for ex in examples]
        if not results:
            empty: dict[int, float] = {k: 0.0 for k in self.span_ks}
            return ALCEReport(
                n=0, citation_recall=0.0, citation_precision=0.0,
                adversarial_rate=0.0, span_recall_at=empty,
                unanswerable_refusal_rate=None,
                ci_recall_95=(0.0, 0.0), ci_precision_95=(0.0, 0.0),
                nli_method_breakdown={}, details=[],
            )

        recalls    = [r.recall    for r in results]
        precisions = [r.precision for r in results]
        adv_flags  = [1 if r.adversarial_citations > 0 else 0 for r in results]

        # Span Recall@k averaged across examples
        span_recall_at: dict[int, float] = {}
        for k in self.span_ks:
            vals = [r.span_recall_at.get(k, 0.0) for r in results]
            span_recall_at[k] = statistics.mean(vals) if vals else 0.0

        # Unanswerable refusal rate
        unan_results = [r.unanswerable_handled for r in results if r.unanswerable_handled is not None]
        unan_rate = statistics.mean([float(x) for x in unan_results]) if unan_results else None

        # NLI method breakdown
        methods: dict[str, int] = {}
        for r in results:
            for m, c in r.nli_methods_used.items():
                methods[m] = methods.get(m, 0) + c

        return ALCEReport(
            n=len(results),
            citation_recall=statistics.mean(recalls),
            citation_precision=statistics.mean(precisions),
            adversarial_rate=statistics.mean(adv_flags) if adv_flags else 0.0,
            span_recall_at=span_recall_at,
            unanswerable_refusal_rate=unan_rate,
            ci_recall_95=_bootstrap_ci(recalls),
            ci_precision_95=_bootstrap_ci(precisions),
            nli_method_breakdown=methods,
            details=results,
        )

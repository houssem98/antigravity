# Evaluation & Benchmarks — proving the product works

Credibility = **provable numbers on recognized benchmarks + a regression gate that
runs every deploy.** This directory holds both.

## The metrics we track

| Metric | What it proves | Runner |
|---|---|---|
| **FinanceBench** accuracy | matches the recognized SEC-filing RAG benchmark — the headline number for finance buyers | `financebench.py` / `scripts/eval_financebench.py` |
| **Faithfulness** (deepeval) | answer is grounded in sources — no hallucination | `run_deepeval.py` |
| **Answer relevancy** (deepeval) | answer actually addresses the question | `run_deepeval.py` |
| **Contextual relevancy** (deepeval) | retrieval pulled the right context | `run_deepeval.py` |
| **Company-correctness** ⭐ | every cited source belongs to the company asked about — catches cross-company drift / cache poisoning | `company_correctness.py` |
| **Retrieval MRR / nDCG@5** | the right document ranks high | `metrics.py` |
| **Latency p50/p95, cost** | SLA + unit economics | `latency_cost_runner.py` |

⭐ Company-correctness is the guardrail the RAG triad **misses**: a wrong-company
answer can still score high on faithfulness (it's faithful to the wrong context it
was handed). It's a hard CI gate.

## Run them

```bash
# Golden set (200 queries, 6 categories) through the deepeval RAG triad
GRAVITY_API_URL=https://gravity-api-prod.fly.dev \
  python tests/eval/run_deepeval.py --limit 50 --output /tmp/deepeval.json

# Company-correctness gate (fails if <95% cited the right company)
GRAVITY_API_URL=https://gravity-api-prod.fly.dev \
  python tests/eval/company_correctness.py --limit 50 --threshold 0.95 --output /tmp/cc.json

# FinanceBench (headline external benchmark)
python tests/eval/financebench.py            # or scripts/eval_financebench.py

# Compare against a stored baseline (regression detection)
python scripts/baseline_diff.py baselines/pre-hermes.json /tmp/deepeval.json
```

`company_correctness.py` verdicts per query (single-company golden queries):
`pass` (right company, clean) · `mixed` (right + foreign leaked) · `wrong`
(answered a different company) · `no_sources` · `error`. Dual-class tickers
(GOOG≡GOOGL, BRK.A≡BRK.B) are treated as the same company.

## The regression gate (CI)

`.github/workflows/deepeval.yml` (currently `.disabled` — re-enable to activate)
runs weekly + on demand:
1. deepeval RAG triad (reports pass rate + per-metric)
2. **company-correctness gate** — `--threshold 0.95`, **not** continue-on-error, so a
   cross-company regression (the Amazon→Kroger bug class) **fails the build**.

Every bug from the on-demand/hallucination debugging round was a silent regression
a gated eval catches before prod. Wire new golden queries as coverage grows.

## What to publish for customer credibility

- **FinanceBench accuracy** (recognized 3rd-party benchmark beats self-claims)
- **Faithfulness %** and **citation accuracy** (verifiable, every claim cited)
- **Company-correctness %** (answers the buyer's #1 fear: "is this even the right
  company?")
- **p95 latency + uptime SLA**, daily-fresh corpus
- Reproducible methodology (this README + the runners) — let buyers re-run it

## External benchmarks worth adding

FinanceBench (primary) · FinQA / ConvFinQA (numerical reasoning) · TAT-QA
(table+text) · DocFinQA (long-doc) · RAGBench / RGB (general RAG robustness).

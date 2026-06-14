# Roadmap: antigravity → Mafin-level financial RAG

**Goal:** match Mafin 2.5 — ~98.7% FinanceBench, hallucination-free, SEC + earnings
+ real-time, Russell 3000 coverage.
**Today (measured this session):** ~30-40% FinanceBench (25-Q sample, type-aware),
0-50% hallucination (prompt-dependent), 100% company-correct, 80-96% citation.
**Reference:** Mafin 2.5 98.7% · Perplexity 45% · GPT-4o 31%.

## Why we're at ~35% (root causes found)
- **Retrieval is dense-only.** ES + Neo4j unprovisioned → bm25, SPLADE-sparse,
  graph, and structured-facts channels are dead. 1 of 5 channels live.
- **Exact facts noisy.** Table parser mis-aligns columns (footnote refs read as
  figures) → the structured channel *regressed* accuracy 40→20, now gated off.
- **Hallucination not deterministic.** Prompt tuning oscillates 0↔50%; no
  post-gen grounding enforcement.
- **Coverage.** 319 S&P, no real-time. (On-demand can pull any ticker, not pre-indexed.)

---

## Phase 1 — Hallucination → ~0 (credibility floor) · FREE · ~days
The cardinal sin for finance. Stop relying on the prompt.
- **Validator-enforced grounding**: after generation, verify every figure/claim is
  present in the retrieved sources (use existing Lynx/NLI + citation validator);
  **strip or refuse** any unsupported number. Deterministic — kills hallucination
  *without* over-refusing (only unsupported claims drop).
- Keep the `grounded-or-refuse` prompt as a first line; the validator is the guarantee.
- **Target:** FailSafe hallucination **0%**, robustness ≥ 80%. Gate it in CI.

## Phase 2 — Retrieval quality (the 40→70 jump) · the big lever
The accuracy ceiling is retrieval. Two routes:
- **2A Build (defensible, slower):**
  - Provision keyword search — **Supabase Postgres FTS** (no new infra; document-copilot
    pattern) → revive bm25.
  - Add **reasoning/section navigation** — route a query to the right statement/section
    of a filing (RAPTOR summaries already coded; or a tree-of-contents nav like PageIndex).
  - Re-rank with the financial reranker (Cohere already wired).
- **2B Buy (fast, lock-in):** integrate the **PageIndex API** (the engine under
  Mafin's 98.7%). Rent retrieval quality; you depend on a competitor for your moat.
- **Target:** FinanceBench **40 → 70%**.

## Phase 3 — Exact-facts precision (numeric 30→80) · the numeric gap
- **Fix the table-parser column alignment** (the bug that regressed us) — period-column
  detection per row.
- **XBRL canonical facts**: index `us-gaap` concept → value → period (clean, tagged)
  instead of scraped cells. `xbrl_extractor` already produces these; route them to the
  `financials` table.
- Re-enable the **structured channel** (gated) once facts are clean; exact
  `(ticker × metric × period)` lookup beats prose for numbers.
- Unit-normalization + numeric verification (recompute FCF = OCF − capex, etc.).
- **Target:** numeric accuracy **30 → 80%**.

## Phase 4 — Coverage + freshness (match Mafin's data breadth)
- **Pre-index full S&P 500** then **Russell 3000** (on-demand already resolves any
  ticker; make it a scheduled backfill).
- **Real-time market data** — Alpha Vantage key already on Fly; wire price/quote into
  answers (Mafin advertises real-time).
- **Earnings-call transcripts** (source exists) — broaden beyond filings.
- **Target:** any public company + real-time figures.

## Phase 5 — Answer model + reasoning (70→90+) 
- Stronger synthesis model for complex/multi-hop (route hard Qs to a reasoning model).
- Agentic multi-step for synthesis/calculation (orchestrator exists).
- Self-consistency / verification loop on numeric answers.
- **Target:** FinanceBench **70 → 90%+**.

## Phase 6 — Eval moat (prove it, keep it)
- Run the **full 150-Q FinanceBench** (not the 25 sample) + **FinDER** (retrieval) +
  **FailSafe** (trust) + **FinTagging** (XBRL) in CI, gated, weekly.
- Fix the eval harness rate-limit errors (use an internal high-tier key, not free-tier
  signups) so numbers aren't noisy.
- Publish the scoreboard — credibility = provable numbers.

---

## Sequencing & ROI
| Phase | Lever | Cost | Lift |
|---|---|---|---|
| 1 | Validator grounding | free | 0 hallucination (trust floor) |
| 2 | Retrieval (FTS + nav, or PageIndex) | low / API $ | **40→70** (biggest) |
| 3 | Clean exact facts (parser + XBRL) | free | numeric 30→80 |
| 4 | Coverage + real-time | compute | breadth |
| 5 | Answer model | LLM $ | 70→90+ |
| 6 | Eval moat | free | provable |

**Do in order.** Phase 1 first (credibility, free, fixes today's oscillation).
Phase 2 is the single biggest accuracy lever. Phases 3-5 close to Mafin-class.

## Build vs Buy (the strategic fork)
- **Buy PageIndex API** → fast path to ~Mafin retrieval, but you rent your core moat
  from a direct competitor (Vectify), who sees your usage. Good to *benchmark the
  ceiling*.
- **Build (Phases 2A/3)** → slower, but it's *your* engine. Recommended for a
  defensible product; use PageIndex only to benchmark.

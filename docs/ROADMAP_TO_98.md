# Roadmap to 98% FinanceBench (Mafin / PageIndex class)

**Target:** ≥98% FinanceBench, hallucination-free — match Mafin 2.5 (98.7%).
**Live baseline (probed prod 2026-06-14):** dense-only; Apple FY23 revenue
returned **$313.7B** (real $383.3B), MSFT FY23 op-income **$83.4B** (real $88.5B).
Confident, cited, wrong. → numeric accuracy broken even on flagship large-caps.

## Root cause (proven, not guessed)
Mafin's 98.7% is **PageIndex = reasoning-based tree retrieval**, not vector search.
PageIndex builds a hierarchical node tree of each filing (TOC-like) and an LLM
*navigates* to the exact node (e.g. "Consolidated Statements of Operations →
FY2023 column"), then pulls the exact figure. No chunking, no cosine top-k → it
never "ranks the wrong fiscal-year chunk."

Our pipeline is dense-only (4 of 5 channels dead; bm25/splade/graph/structured
unprovisioned or gated). Cosine similarity on overlapping chunks picks the wrong
period → wrong number. **Tuning embeddings cannot reach 98%. The paradigm must change.**

---

## Trajectory (each phase has a FinanceBench gate)
| Phase | Lever | Expected FB | Effort |
|---|---|---|---|
| 0 | Honest measurement (full 150-Q) | baseline ~35% | days |
| 1 | **Rent PageIndex** (tree-nav retrieval) | **35 → 80%** | week 1 |
| 2 | Validator grounding (0 wrong numbers) | 80 → 85% | week 2 |
| 3 | **XBRL exact facts** (numeric = lookup) | 85 → 95% | weeks 3-4 |
| 4 | Build own tree-nav (own the moat) | hold 95%, drop Vectify dep | weeks 5-8 |
| 5 | Coverage + model routing + CI gates | 95 → 98% | ongoing |

---

## Phase 0 — Measure honestly · days · FREE
Can't hit 98% blind. Today's number is a 25-Q sample with rate-limit noise.
- Run **full 150-Q FinanceBench** against prod.
- Fix eval auth: use a real high-tier key, not free-tier signups (kills 429 noise).
- Lock the scorer (numeric tolerance, period-aware).
- **Output:** trustworthy baseline + per-question failure log (retrieval miss vs
  wrong-number vs refusal).

## Phase 1 — Rent the engine, hit the number FAST · week 1
We already wired it: `page_indexer.py` + `page_index_search.py`, config flags
`pageindex_enabled` / `PAGEINDEX_API_KEY` (currently off, no key).
- Get free PageIndex API key (dash.pageindex.ai).
- `fly secrets set PAGEINDEX_API_KEY=… -a gravity-api-prod`; `pageindex_enabled=True`.
- Route filing / numeric queries through PageIndex tree-nav (make it the primary
  channel for single-company-single-metric questions; keep dense as fallback).
- Re-run Phase-0 eval.
- **Gate:** FinanceBench ≥ 80%. (This IS the engine under Mafin's 98.7% — expect
  the big jump here.) Proves the ceiling and ships a 98%-class product immediately.
- **Tradeoff:** renting core retrieval from a competitor (Vectify); they see usage.
  Acceptable to hit the number now → build own in Phase 4.

## Phase 2 — Validator grounding · week 2 · FREE
Kill the wrong-number class the prompt can't (proven: grounded-or-refuse let
Apple $313.7B through).
- Post-generation: extract every `$N` / `N%` / period figure from the answer.
- Verify each appears in a retrieved node (exact + unit-normalized match).
- Unsupported figure → strip sentence / refuse + log `grounding_violation`.
- Gate behind `grounding_validator_enabled`; add to FailSafe eval.
- **Gate:** FailSafe hallucination = 0%; no FinanceBench answer counts as correct
  unless its number is in-source.

## Phase 3 — XBRL exact facts (the last numeric points) · weeks 3-4 · FREE
For "X revenue FY23"-type Qs, answer should be a **lookup, not a retrieval guess**.
This is how Mafin gets numeric right every time.
- Ingest **SEC XBRL frames / Financial Statement Data Sets** → canonical
  `us-gaap concept → value → period → ticker` (clean tagged values, not scraped cells).
- Fixes the table-parser column bug that regressed us 40→20 (skip scraping; use
  SEC's own tagged numbers).
- Route pure-numeric questions to XBRL exact; prose only for narrative.
- Re-enable structured channel (`structured_facts_enabled=True`) on clean data.
- Numeric verification (FCF = OCF − capex; unit/scale normalization).
- **Gate:** numeric subset ≥ 95%.

## Phase 4 — Build own tree-nav (own the moat) · weeks 5-8
Remove the Vectify dependency; make the 98% engine *ours*.
- Parse 10-K/10-Q into hierarchical node tree (section → subsection → statement).
- LLM tree-navigation retrieval (reasoning, not embedding) → exact node fetch.
- Keep PageIndex as a benchmark oracle to regression-test our engine against.
- **Gate:** own engine ≥ rented PageIndex score on the 150-Q set.

## Phase 5 — Close to 98% + keep it · ongoing
- **Coverage:** pre-index S&P 500 → Russell 3000 (on-demand already resolves any
  ticker; make it scheduled) so FinanceBench docs are all warm.
- **Model routing:** hard/multi-hop Qs → reasoning model; self-consistency on numbers.
- **CI gates, weekly:** FinanceBench 150-Q + FinDER (retrieval) + FailSafe (trust)
  + company-correctness. Block deploys on regression.
- **Gate:** FinanceBench ≥ 98%, sustained run-over-run.

---

## Decision: rent then build
1. **Now:** rent PageIndex (Phase 1) → hit ~80-98% fast, prove it, ship.
2. **Then:** build own tree-nav (Phase 4) → defensible moat, drop competitor dep.
3. **Always:** XBRL exact facts (Phase 3) + validator (Phase 2) are ours regardless
   of rent/build — they're the trust + numeric layers Mafin also has.

**Single fastest move to a real number this week:** get the PageIndex key, flip
the flag we already wired, re-run the 150-Q eval.

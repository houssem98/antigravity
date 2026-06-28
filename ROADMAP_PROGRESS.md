# Roadmap Progress — Research Grid + Quick Answer → world-class (Hebbia/AlphaSense/Rogo tier)

Durable state ledger for the `/loop` engineering run. **Read this first every iteration.**
One shippable task per iteration. P0 before P1, etc. Skip BLOCKED tasks.

- **Branch:** `roadmap/world-class`
- **NEXT:** P1-d span-level citations (needs gravity-api char-offset storage + deploy) OR P3 frontend. Backfill STOPPED at 77/316 (~106 tickers backfilled); deploys unblocked. P1-b deployed + validated.

---

## Task checklist

### P0 — Fix what's broken
- [x] **P0-a** Build/confirm eval harness + capture baselines — *DONE. FinanceBench sample-15 vs prod: numeric 33%, citation 20%, halluc 7%, 5/15 timed out, p50 33.6s.*
- [x] **P0-b** Fix table column-alignment bug + regression test — *DONE. Root cause: `table_indexer._extract_rows` mapped header col_idx into data row; SEC `$`/spacer `<td>`s misalign it. Fixed: align numeric cells to period cols by ORDER (`_row_numeric_values`). 2 regression tests pass. NOTE: stored 152k rows stay wrong until re-ingest (P1-a) — FinanceBench won't move from code alone.*
- [x] **P0-c** Grid concurrency: parallel for deepseek/claude, serial for Gemini — *DONE. `startRun` concurrency = `selectedModel==='gemini' ? 1 : 6`. `runGrid` already has a safe cursor worker-pool. Built + deployed; bundle shows `==="gemini"?1:6`. Expected ~6× grid wall-time for paid models (exact /100-cell throughput needs in-browser timing).*
- [x] **P0-d** Clean `filing_date` + fix root cause — *DONE. Ledger overstated it: 2026 dates are VALID (current year); real issue = impossible future dates. Nulled future-dated (chunks 2,829, doc_trees 7; financials clean, no NULLs) via `scripts/fix_future_filing_dates.py` on Fly (Supabase PostgREST 500s on the 2,829 because the generated `tsv` recomputes per row → ran server-side w/ statement_timeout=0). Root cause: `metadata_extractor._extract_date` returned the FIRST body date → grabbed lease/debt-maturity future dates. Fixed: pick latest plausible (1994..today). +4 regression tests pass. gravity-api redeploy deferred to P1-a (EDGAR poller uses explicit metadata dates, so low urgency).*
- [x] **P0-e** Confirm reranker fires; fix — *DONE. It fired but FAILED: prod COHERE key is an exhausted Trial key (429 every call) → no rerank + ~3.2s/query wasted. Switched `get_reranker()` to prefer Voyage rerank-2 (finance-tuned). Deployed gravity-api. Voyage fails FAST (rerank_ms 3200→172) — ~3s/query latency win. Rerank QUALITY still BLOCKED: Voyage free tier = 3 RPM (multi-query 429s); needs a PAID Voyage/Cohere key (user action). Also confirmed bm25/FTS channel fires.*

### P1 — Accuracy
- [x] **P1-a** XBRL backfill (validated on 29 FinanceBench tickers) — *DONE/validated. financials 152,086→168,177; extracted with P0-b fix. RESULT (sample-30 vs 33% baseline): numeric 30% (FLAT), citation 20% (flat), but hallucinations 7%→**0%**, timeouts 5/15→**0**, latency p50 33.6s→**17.9s**. KEY: backfill FIXED coverage (0 "sources lack data", was the baseline's main failure) but numeric DIDN'T move — remaining failures are derived/analytical Qs (ratios, trends, segment compare) returning EMPTY answers in fast mode → need agentic reasoning (P1-c), not more data. Full S&P backfill = cheap coverage win but won't lift FinanceBench numeric; deferred/optional.*
- [x] **P1-b** Tune hybrid fusion RRF weights — *DONE + deployed + validated. Fixed latent bug: live `authority_aware_rrf` used PLAIN RRF, so `weighted_rrf` channel weights (structured=1.2, tree_nav=1.1) never applied. Wired weighted base via shared `DEFAULT_CHANNEL_WEIGHTS`. 3 tests. Deployed (backfill stopped first). WARM sample-30 vs post-P1-a 30%: numeric 30% (FLAT — structured already pinned, as predicted), citation 20%→**27%**, errors 0, p50 17.9s→**13.2s**. Net neutral-positive → KEEP. (First post-deploy run was cold-start confounded: 8/30 timeouts; warm re-run clean.)*
- [~] **P1-c** Agentic cells — *INVESTIGATED, redirected. Probed fast vs agentic on a derived-metric Q (AMCOR quick-ratio YoY): IDENTICAL answers, both compute FY2023 (0.89x) but report FY2022 missing. Agentic is NOT the lever — the class is data-DEPTH limited, not reasoning limited. Also found: eval's "empty got" was a wrong-field display artifact; the model DOES answer (declines correctly when prior-year data absent). `structured_search` already requests multi-period (line 88-95); the FY2022 facts are simply not ingested (backfill depth = 4 filings/3yr). Real lever for YoY-derived Qs = deeper historical backfill (more 10-Ks/years) — big, slow. Deferred pending that.*
- [ ] **P1-d** Span-level citations (store char offsets at ingest; highlight exact passage)

### P2 — Corpus moat
- [ ] **P2-a** Add earnings-call transcripts ingestion source
- [ ] **P2-b** Add news / press-release source
- [ ] **P2-c** Freshness SLA: ingest < 1h of EDGAR publish

### P3 — Source viewer + workflow
- [ ] **P3-a** Filing/PDF source viewer with citation jump-to-span
- [ ] **P3-b** Export grid → Excel/model
- [ ] **P3-c** Save/share grid views
- [ ] **P3-d** Deepen cross-doc comparison in grid

### P4 — Scale / enterprise
- [ ] **P4-a** Quick-answer p95 < 2s
- [ ] **P4-b** Grid 100 cells < 60s
- [ ] **P4-c** Enforce entitlements/permissions, audit log, SSO

---

## Benchmarks (target — current)

| Metric | Target | Current | Source |
|---|---|---|---|
| FinanceBench numeric QA | ≥80% | **33%** (5/15 sample, prod) | `tests/eval/financebench.py` |
| Company-correctness | 100% | unmeasured | `tests/eval/company_correctness.py` |
| Retrieval recall@10 | ≥0.90 | **~7%** (weak proxy) | source text widened 500→2000 (recall 0→7%); still a weak proxy — gold evidence phrased differently than chunks, 0.5 token-overlap too strict. Directional only. |
| Citation faithfulness | ≥95% | **27%** hit-rate (8/30, was 20%) | financebench citation_check |
| Hallucination rate | <2% | **0%** (0/30, was 7%) | financebench hallucination flag |
| Quick-answer p95 latency | <2s | **p50 17.9s** (was 33.6s; 0 timeouts, was 5/15) | financebench latencies |
| Grid throughput /100 cells | <60s | slow (serial conc=1) | — |
| Corpus coverage | 500+ cos, +transcripts, <1h fresh | 283 cos, 1,603 filings, SEC-only | Supabase |

---

## Eval log (before → after per task)

- **Recall eval infra (P1-b support)** — added `evidence_recall` to `financebench.py` (token-overlap of gold FinanceBench `evidence` vs retrieved source text, hit ≥0.5) + `retrieval_recall` per-Q + `recall_rate` in report/summary. 4 unit tests pass. Built deploy-free during backfill; RUN it alongside the P1-b deploy+measure once backfill done (gives the first retrieval recall@k number + makes fusion tuning principled). Note: sample is deterministic (`seed(42)`) so same-N runs ARE comparable before/after.

- **P0-a (baseline)** — eval harness present: `financebench.py`, `financebench_xbrl.py`, `company_correctness.py`, `latency_cost_runner.py`, `judge_model.py`, `run_eval.py`. Local venv has httpx/datasets/tqdm/rouge_score. Prod `/v1/search` reachable (HTTP 200, ~13.5s, channels `[structured,dense,tree_nav]`). FinanceBench sample-15 baseline running → results pending.

## Observations / leads
- **n=30 FinanceBench is NOISY** — citation swung 27%→17% and halluc 0→20% on the SAME deterministic sample across runs (LLM nondeterminism). Numeric is stable (~30%). Use n≥50 (or full 150) for trustworthy small deltas; treat ±10pt at n=30 as noise.
- Widened source text 500→2000 (`search_pipeline.py:849`) — better citation-panel snippets + recall headroom; recall 0→7% (still weak proxy).
- Prod fast-mode query returned channels `[structured, dense, tree_nav]` — **FTS/bm25 keyword channel did NOT fire** despite the 101k-chunk backfill. Investigate whether `search_chunks_fts` is wired into the fast pipeline / fusion (candidate sub-task under P1-b or new P0).
- Latency ~13.5s single probe; **sample-15 p50 33.6s, 5/15 timed out at 60s** → latency is also an accuracy floor (timeouts score as errors). Big P4-a problem, partially blocks accuracy.
- Baseline failures cluster on **derived/ratio metrics** (DPO, quick ratio, gross-margin trend, regional revenue) and tickers possibly outside the 283-corpus (AMCOR, Boeing, Corning, MGM) → answer = "sources do not contain". Points at P1-a (broad backfill) + P2 (coverage) + structured-channel depth, not just the column bug.
- EM/FM = 0% (strict). Numeric (2% tol) = 33% is the meaningful figure.

## Blockers
- Qdrant/DB backfills must run on Fly (local Qdrant `:6333` down, DB password not local).
- Supabase DDL only via dashboard SQL editor.
- **Rerank quality BLOCKED on paid key (user action):** prod COHERE_API_KEY = exhausted Trial (429); VOYAGE_API_KEY works but free tier = 3 RPM → 429s under multi-query load. Add a payment method on Voyage (dashboard.voyageai.com) OR a production Cohere key to unlock real reranking (~+0.02–0.08 NDCG). Code already prefers Voyage and fails fast (172ms), so no latency cost meanwhile.

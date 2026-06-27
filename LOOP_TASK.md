# LOOP TASK — Research Grid + Quick Answer → world-class (Hebbia / AlphaSense / Rogo tier)

> Standing instructions for the `/loop` engineering run. **Read this + `ROADMAP_PROGRESS.md` first every iteration.**
> The loop prompt is a one-liner that points here, so each fire stays small/cache-cheap.

## Per-iteration cycle (one task, then end so the loop re-fires)
1. Read `ROADMAP_PROGRESS.md` (state). Pick the single highest-priority UNCHECKED task (P0 before P1…). Skip BLOCKED.
2. If no eval baseline exists yet, that IS task #1.
3. Implement ONLY that one task. Small + shippable.
4. Measure with the relevant eval. Record before→after in the ledger. If a number didn't move, say so plainly.
5. Verify (typecheck + build; deploy-verify if UI). Don't break prod.
6. Commit on branch `roadmap/world-class` (one commit per task). Don't push unless told.
7. Update `ROADMAP_PROGRESS.md` (check task, append metrics, set NEXT). End iteration.
8. EXIT loop (stop scheduling) only when all P0–P4 done AND benchmarks met.

## Guardrails
- Ask before destructive/irreversible: schema drops, mass re-ingest, force-push, prod data deletes.
- Never repeat a checked task. If blocked, log blocker + mark BLOCKED, move on.
- Honest reporting — measured numbers, not claims.

## Repo facts
- Quick Answer: `apps/market-ui/src/pages/SearchPage.tsx`. Grid: `apps/market-ui/src/components/grid/GridView.tsx` + `services/gridResearch.ts`.
- Backend: `services/gravity-api` (FastAPI). Channels: dense (Qdrant) + FTS (Supabase `chunks` / `rpc/search_chunks_fts`) + structured (Supabase `financials`) + tree-nav (`doc_trees`). Reranker code in `app/core/retrieval/`. Agentic loop in `app/core/agents/orchestrator.py`.
- Corpus: 283 cos, 1,603 filings (8-K heavy), 101,083 FTS chunks, 152,086 XBRL facts. Qdrant 478,666 pts (99,967 at chunk_level=2). SEC only. `filing_date` dirty.

## Gotchas (don't re-waste cycles)
- Local Qdrant `:6333` + DB password NOT available locally. Qdrant/DB backfills MUST run on Fly: `fly ssh console -a gravity-api-prod -C "python scripts/..."`. Prod Qdrant URL/key + `DATABASE_URL` only in Fly secrets.
- Qdrant payload key is `company_name` (not `company`); text in `text`; retrievable = `chunk_level==2`.
- Supabase DDL only via dashboard SQL editor. Data ops via PostgREST service-role key or asyncpg-on-Fly.
- Deploy UI: `vercel --prod --yes` from repo root (project `market-ui`, alias `market-ui-self.vercel.app`). Verify on deployed bundle, not localhost.
- Eval: `services/gravity-api/tests/eval/`. FinanceBench: `GRAVITY_API_URL=https://gravity-api-prod.fly.dev FB_CONCURRENCY=4 GRAVITY_API_KEY=deep-research-internal .venv/Scripts/python.exe tests/eval/financebench.py --sample N --output tests/eval/out/<f>.json`. venv has httpx/datasets/tqdm/rouge_score.

## Plan (highest ROI first)
- **P0** (a) eval harness + baselines; (b) table column-align bug + regression test; (c) grid concurrency parallel 5–8 for deepseek/claude, keep 1 for free Gemini; (d) clean `filing_date`; (e) confirm reranker fires in `fusion.py`.
- **P1** (a) broad XBRL backfill 283→full S&P (`backfill_financials.py --resume` on Fly); (b) tune RRF fusion weights; (c) agentic grid cells via `orchestrator.py` (not 1-shot); (d) span-level citations (char offsets + highlight).
- **P2** (a) earnings-call transcripts; (b) news/press; (c) freshness <1h of EDGAR publish.
- **P3** (a) filing/PDF source viewer w/ citation jump-to-span; (b) export grid→Excel; (c) save/share grid views; (d) deepen cross-doc comparison.
- **P4** (a) quick-answer p95<2s; (b) grid 100 cells<60s; (c) enforce entitlements/permissions, audit log, SSO.

## Benchmark targets
FinanceBench numeric ≥80%; company-correctness 100%; retrieval recall@10 ≥0.90; citation faithfulness ≥95%; hallucination <2%; quick-answer p95 <2s; grid /100 cells <60s; corpus 500+ cos +transcripts <1h fresh.

## Open leads (from the run)
- FTS/bm25 channel did NOT fire in a prod fast-mode probe despite the 101k backfill — verify `search_chunks_fts` is wired into the fast pipeline/fusion.
- Latency p50 33.6s, 5/15 FinanceBench timeouts → latency is also an accuracy floor.
- Baseline failures cluster on derived ratios + likely out-of-corpus tickers (AMCOR/Boeing/Corning/MGM).

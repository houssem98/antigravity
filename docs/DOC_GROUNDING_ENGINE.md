# GravityIndex — Doc-Grounding Engine (own the Mafin path)

Vectorless, reasoning-based tree retrieval over SEC filings. Replicates the
PageIndex paradigm that gets Mafin to 98.7% FinanceBench — built in-house so it's
our moat, no per-doc rent, no competitor dependency.

## Why (proven this session)
- Open-corpus retrieval (dense + XBRL + scoping + ratios) plateaus at **~28%**
  (GPT-4o tier). Every mechanism is correct; the ceiling is the *paradigm*.
- We proved the Mafin way works: PageIndex on 3M's 10-K returned "$1,577M" + page
  cite — exact. FinanceBench is **closed-book**: each Q ships its source filing;
  Mafin indexes THAT doc's structure and navigates to the exact node.
- **The 28→90 jump is this engine.** Nothing else gets there.

## How it works
```
INGEST (once per filing)
  filing → parse into a hierarchical NODE TREE (TOC-like):
     Item 7 MD&A
       └ Results of Operations
            └ Net sales [pp. 28-30]
     Item 8 Financial Statements
       └ Consolidated Statements of Operations [pp. 40-42]   ← FY values live here
       └ Consolidated Balance Sheets [pp. 43-44]
  each node: {id, title, level, page range, 1-line summary, content ref}
  store the tree (Supabase doc_trees); leaf content in chunks/text.

QUERY (no embeddings)
  1. resolve ticker + filing → candidate doc(s)         (entity resolver, done)
  2. load the doc's tree OUTLINE (titles + summaries only — compact, ~2KB)
  3. LLM NAVIGATES: "given this outline + the question, which node(s) hold the
     answer?" → returns node_ids  (reasoning, not similarity)
  4. fetch those nodes' full content
  5. answer from exactly that content (+ XBRL exact facts for the number)
```

## Architecture (fits our stack — Supabase + the existing pipeline)
- **Store**: `doc_trees` (Supabase) — doc_id, ticker, filing_type, period, tree JSONB.
  Leaf content reuses the `chunks` table (node_id → chunk_ids) or inline text.
- **Builder**: `app/ingestion/indexing/tree_builder.py` — filing → tree. Reuses the
  existing `section_detector` + financial-statement detection; LLM writes the
  1-line node summaries (cheap, gemini_flash, once per filing).
- **Channel**: `app/core/retrieval/tree_nav_search.py` — the retrieval channel.
  Given query + candidate docs, LLM-navigates each tree → fetches nodes →
  RetrievalResult[]. Fused/reranked alongside dense+XBRL like any channel.
- **Routing**: filing/section/narrative queries → tree-nav; pure-number → XBRL
  exact (done); ratios → ratio engine (done). Tree-nav fills the "read the filing"
  gap that dense fakes.

## Roadmap — phases (each shippable + measurable)
**Phase 1 — Tree store + builder (foundation)**
- `doc_trees` migration; `tree_builder.py` (section_detector → nodes + summaries).
- Script to build trees for a ticker's filings. Gate: tree built + queryable for AAPL/KO.

**Phase 2 — Tree-nav retrieval channel (the engine)**
- `tree_nav_search.py`: outline → LLM navigate → fetch nodes. Register as a channel
  (gated `tree_nav_enabled`). Gate: returns the right section for "Apple net sales".

**Phase 3 — Closed-book FinanceBench harness**
- Build trees for the FinanceBench doc set; eval tree-nav closed-book (like
  financebench_pageindex.py but our engine). Gate: ≥70% on the numeric subset.

**Phase 4 — Wire into prod pipeline + route**
- Add tree-nav to the orchestrator; route filing/narrative queries to it; fuse with
  XBRL + dense. Gate: prod FinanceBench (open-corpus) 28 → 60%+.

**Phase 5 — Coverage + polish**
- Build trees for S&P 500 / Russell 3000 filings (scheduled ingestion).
- Node-summary quality, multi-doc navigation, page-citations in answers.
- Gate: FinanceBench ≥ 85%, then climb to Mafin-class.

## Trajectory
| Phase | Lever | FinanceBench |
|---|---|---|
| now | open-corpus + XBRL + ratios | 28% |
| 1-2 | tree store + nav channel | (mechanism) |
| 3 | closed-book proof | 70%+ numeric |
| 4 | wired into prod | 60%+ |
| 5 | coverage + polish | 85% → Mafin-class |

## Why ours beats renting PageIndex
- No per-doc/per-query cost; no competitor seeing our usage.
- Tunable to SEC structure (Items, statements) we know cold.
- Fuses with our XBRL exact-facts + ratio engine — PageIndex doesn't have those.
- It's the moat: the engine IS the product.

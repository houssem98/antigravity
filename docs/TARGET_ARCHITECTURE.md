# Target Retrieval Architecture (the runnable path to 98%)

Decision (2026-06-14): collapse the 5-store design onto **2 stores we actually
run** (Qdrant + Supabase), add **tree-nav** for exact retrieval, keep our
fusion/rerank/validator brain. Amputate the 3 dead limbs.

## The three inputs, and what we take from each
- **PageIndex (Mafin's engine)** → take the *retrieval paradigm*: LLM
  tree-navigation to the exact filing node (solves the proven wrong-period bug;
  dense can't). Rent now, build later.
- **document-copilot (daveebbelaar)** → take the *storage pattern*: one Supabase
  Postgres holds vectors-or-FTS + structured tables. Revives keyword search via
  **Postgres FTS — no Elasticsearch**. Matches the infra we already run.
- **Our 5-channel** → keep the *fusion brain*: RRF (`fusion.py`) + Cohere rerank +
  Qdrant dense. Drop the channels whose backend we never provisioned.

## Target topology
```
                    ┌─ exact/numeric Q ─┐
query → understand ─┤                   ├─ PageIndex tree-nav  (rent→build)  ← 98% engine
                    │                   ├─ XBRL exact facts (Supabase)        ← never-wrong nums
                    └─ narrative Q ─────┼─ dense (Qdrant)                     ← keep
                                        └─ keyword FTS (Supabase Postgres)    ← document-copilot
                                              ↓
                                     RRF fuse + Cohere rerank   ← keep our brain
                                              ↓
                                     validator grounding         ← trust floor
                                              ↓
                                          answer
KILLED: Elasticsearch (bm25 old), Neo4j (graph), SPLADE — never provisioned,
returned [], lied in metadata.
```

## Stores: 5 → 2
| Store | Was | Now |
|---|---|---|
| Qdrant | dense | **dense (keep)** |
| Supabase Postgres | structured only | **FTS keyword + structured facts + XBRL + chunks** |
| Elasticsearch | bm25 + splade | **REMOVED** (unprovisioned) |
| Neo4j | graph | **REMOVED** (unprovisioned) |
| Postgres (Timescale) | structured SQL | **REMOVED** (None stub) |

## Channels: honest set
- `dense` (Qdrant) — narrative recall. Live.
- `keyword` (Supabase Postgres FTS) — exact phrase / ticker / number. **NEW** (replaces dead ES bm25).
- `structured` (Supabase financials / XBRL) — exact tagged facts. Gated until clean.
- `page_index` (tree-nav) — exact section/period navigation. **The 98% lever.**
- KILLED: `bm25`(ES), `splade`, `graph`.

## Migration steps (code)
1. **Honest metadata** — report only channels that returned data (done).
2. **Gate dead channels** — don't register graph/ES-bm25/splade unless backend
   configured (done). Prod stops dispatching dead channels + fake keys.
3. **Postgres FTS keyword** — `chunks` table in Supabase (text + tsvector + GIN),
   ingestion writes chunks, `SparseSearch` queries FTS via RPC. Needs backfill on Fly.
4. **PageIndex** — set key, `pageindex_enabled=True`, route filing/numeric Qs.
5. **XBRL exact** — SEC frames API → `financials`, re-enable structured channel.

## Why this fits us (not the other way)
- We run Supabase + Qdrant today; we will not operate ES + Neo4j clusters.
- document-copilot's one-DB pattern = our ops reality.
- PageIndex's paradigm = our accuracy goal.
- Our fusion+rerank+validator = the orchestration glue both lack.
```
```

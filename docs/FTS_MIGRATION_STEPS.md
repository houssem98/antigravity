# Postgres FTS Migration — Restore Keyword Retrieval

**Status**: Migration SQL ready (0003_chunks_fts.sql), backfill script needed, disabled on Fly

**Why**: Replace dead Elasticsearch BM25 with Postgres FTS (one DB, same infra we run)

## Quick Start (Fly prod)

### 1. Apply migration
```bash
# Via Supabase dashboard:
# - SQL Editor → paste supabase/migrations/0003_chunks_fts.sql
# - Run to create chunks table + search_chunks_fts() function

# OR via psql:
psql $DATABASE_URL < supabase/migrations/0003_chunks_fts.sql
```

### 2. Backfill chunks from Qdrant
```bash
# Run on Fly gravity-api pod (has DB_URL + QDRANT_URL access):
python scripts/backfill_chunks_fts.py --limit 10000

# Test: verify chunks table has rows:
psql $DATABASE_URL -c "select count(*) from public.chunks;"
```

### 3. Enable in config
- Set `KEYWORD_SEARCH_ENABLED=true` in Fly secrets
- Restart gravity-api pod

### 4. Verify in search
- Query: "Apple revenue"
- Should now hit sparse channel (Postgres FTS)
- Check metadata: `"channels": {"sparse": true}` in response

## Files

- **Migration**: `supabase/migrations/0003_chunks_fts.sql` — creates chunks table + search_chunks_fts RPC
- **Backfill**: `services/gravity-api/scripts/backfill_chunks_fts.py` — load Qdrant → Supabase
- **Search impl**: `services/gravity-api/app/core/retrieval/sparse_search.py` — SparseSearch class (already written)

## What it replaces

Old (dead): Elasticsearch BM25 channel (unprovisioned, returned [] silently)
New: Postgres FTS via `search_chunks_fts()` RPC call

## Impact

- Keyword retrieval restored (~5-10% of queries)
- Improves recall on ticker/phrase/number lookups
- No new infra (uses Supabase Postgres we already run)

## Next (after FTS live)

1. **PageIndex tree-nav** — exact section/period navigation (the 98% lever)
2. **XBRL structured facts** — numeric accuracy via SEC frames API
3. **Hybrid fusion** — RRF blend dense (Qdrant) + keyword (FTS) + structured (XBRL)

## Notes

- FTS uses websearch_to_tsquery (handles quoted phrases, OR, -)
- Chunks at level 2 only (paragraphs, the retrievable unit)
- Ranking by ts_rank (BM25-ish scoring)
- tsvector auto-generated on insert (no compute cost)

# Provision Elasticsearch — revive 3 dead retrieval channels

Prod runs on **Qdrant/dense only**. `ELASTICSEARCH_URL` isn't set, so the client
defaults to `localhost:9200` → "Connection error". That kills three channels:

- **BM25 keyword** (Elasticsearch `gravity_chunks`)
- **SPLADE sparse** (Elasticsearch)
- **Structured exact-facts** (Elasticsearch `gravity_financials`)

Bringing ES online lifts retrieval quality across the board and unblocks the
numeric-accuracy work (exact figures instead of prose guesses). One env var.

## 1. Get an Elasticsearch endpoint

Any works — pick one:

| Option | Notes |
|---|---|
| **Elastic Cloud** (elastic.co/cloud) | 14-day free trial, then paid. Managed, simplest. Gives an endpoint + API key. |
| **Bonsai** (bonsai.io) | Free Sandbox tier (35MB) — fine to validate, too small for full corpus. |
| **Self-host on Fly** | `fly launch` an `elasticsearch:8.x` machine in the same org; cheapest at scale, more ops. |

You need: the **URL** (`https://...:9243` or `:443`) and an **API key** or
`user:pass`.

## 2. Set the Fly secret

```bash
cd services/gravity-api

# URL with inline basic auth:
fly secrets set ELASTICSEARCH_URL="https://USER:PASS@your-cluster.es.cloud:9243" -a gravity-api-prod

# or URL + API key (if the client reads ELASTICSEARCH_API_KEY):
fly secrets set ELASTICSEARCH_URL="https://your-cluster.es.cloud:9243" -a gravity-api-prod
```

Fly restarts the app. Confirm the channels stop erroring:

```bash
fly logs -a gravity-api-prod | grep -iE "sparse_search_unavailable|structured_search_failed"
# should go quiet
```

## 3. Backfill the exact-facts index

The bulk corpus was indexed before `table_indexer` was wired, so
`gravity_financials` is empty for older filings. Re-extract tables (cheap — no
embeddings/LLM):

```bash
cd services/gravity-api
# point at the SAME ES you set on Fly, then run locally:
ELASTICSEARCH_URL="https://USER:PASS@your-cluster.es.cloud:9243" \
  python scripts/backfill_financials.py --tickers AAPL MSFT NVDA AMZN GOOGL   # smoke test
ELASTICSEARCH_URL="..." python scripts/backfill_financials.py --resume        # full S&P 500
```

It writes `(ticker × metric × period → value)` rows the structured channel reads.
Progress is saved to `backfill_financials_progress.json` (resumable).

## 4. Re-measure

```bash
GRAVITY_API_URL=https://gravity-api-prod.fly.dev \
  python tests/eval/financebench.py --embedded   # expect a jump from the 40% baseline
python tests/eval/company_correctness.py --threshold 0.95
```

## Why this is the lever
The structured channel (`app/core/retrieval/structured_search.py`) already queries
`gravity_financials` — it activates the instant ES is reachable. With ES up,
numeric questions get the exact tagged figure (e.g. "AAPL — Total Revenue
(FY2022): $394,328M") instead of the LLM picking a wrong period/line-item from
prose. That's the path from ~40% to 70%+ on FinanceBench.

> Also missing: `NEO4J_URI` (graph channel). Lower priority than ES — graph adds
> entity-relationship retrieval, not exact figures.

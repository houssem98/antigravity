#!/usr/bin/env python3
"""
Backfill the `gravity_financials` Elasticsearch index.

The bulk corpus was ingested with a bare IngestionPipeline() (table_indexer was
None), so its XBRL/table financial rows (ticker x metric x period -> value) were
never indexed. The structured retrieval channel reads that index for exact
figures, so it is empty for older filings. This re-extracts tables from each
company's recent filings and indexes only the financial rows — no embeddings, no
LLM, so it is cheap and fast.

REQUIRES: ELASTICSEARCH_URL set to a reachable Elasticsearch (see
tests/eval/README or docs). The script aborts early if ES is unreachable.

Usage:
  python scripts/backfill_financials.py --tickers AAPL MSFT NVDA
  python scripts/backfill_financials.py                 # all S&P 500
  python scripts/backfill_financials.py --limit 50 --resume
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

FILING_TYPES = ["10-K", "10-Q"]          # financial statements live in these
YEARS_BACK = 3
PROGRESS = Path(__file__).parent.parent / "backfill_financials_progress.json"


async def backfill_ticker(ticker, edgar, processor, table_indexer, max_filings):
    res = {"ticker": ticker, "filings": 0, "rows": 0, "errors": 0}
    try:
        filings = await edgar.fetch_company_filings(
            ticker=ticker, filing_types=FILING_TYPES, max_filings=max_filings
        )
    except Exception as e:
        return {**res, "errors": 1, "reason": str(e)[:120]}

    cutoff = datetime.now() - timedelta(days=365 * YEARS_BACK)
    for f in filings or []:
        try:
            fd = f.get("filing_date", "")
            try:
                if fd and datetime.strptime(fd[:10], "%Y-%m-%d") < cutoff:
                    continue
            except ValueError:
                pass

            content = f.get("content", "")
            url = f.get("url", "")
            if not content and url:
                import httpx
                async with httpx.AsyncClient(
                    headers={"User-Agent": "gravity-backfill contact@example.com"}, timeout=40
                ) as c:
                    content = (await c.get(url)).text
            if not content:
                continue

            raw = content.encode("utf-8") if isinstance(content, str) else content
            processed = await processor.process(raw, "text/html", f"{ticker}_{fd}.html")
            tables = getattr(processed, "tables", None)
            if not tables:
                continue

            meta = {
                "ticker": ticker,
                "company_name": f.get("company_name", ticker),
                "filing_type": f.get("filing_type", ""),
                "filing_date": fd,
            }
            out = await table_indexer.index_tables(tables, meta, f"backfill_{ticker}_{fd}")
            res["filings"] += 1
            res["rows"] += out.get("rows_indexed", 0)
            await asyncio.sleep(0.15)  # EDGAR <=10 req/s
        except Exception as e:
            res["errors"] += 1
            print(f"    [{ticker}] filing error: {str(e)[:80]}")
    return res


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", nargs="+", help="specific tickers (default: all S&P 500)")
    ap.add_argument("--limit", type=int, help="cap number of tickers")
    ap.add_argument("--max-filings", type=int, default=4)
    ap.add_argument("--resume", action="store_true", help="skip tickers already done")
    args = ap.parse_args()

    from app.db.elasticsearch import get_es_client
    from app.ingestion.indexing.table_indexer import TableIndexer
    from app.ingestion.processing.document_processor import DocumentProcessor
    from app.ingestion.sources.sec_edgar import SECEdgarSource

    es = get_es_client()
    try:
        await es.info()
    except Exception as e:
        print(f"ERROR: Elasticsearch unreachable ({str(e)[:120]}).")
        print("Set ELASTICSEARCH_URL (+ auth) to a running instance, then re-run.")
        sys.exit(1)
    print("Elasticsearch reachable — starting backfill.\n")

    processor = DocumentProcessor()
    table_indexer = TableIndexer(vector_indexer=None, keyword_indexer=None, es_client=es)
    edgar = SECEdgarSource(ingestion_pipeline=None)

    if args.tickers:
        tickers = [t.upper() for t in args.tickers]
    else:
        from scripts.bulk_ingest_sp500 import SP500_TICKERS
        tickers = list(SP500_TICKERS)
    if args.limit:
        tickers = tickers[: args.limit]

    done: set[str] = set()
    total_rows = 0
    if args.resume and PROGRESS.exists():
        st = json.loads(PROGRESS.read_text())
        done = set(st.get("done", []))
        total_rows = st.get("total_rows", 0)
        tickers = [t for t in tickers if t not in done]
        print(f"Resuming — {len(done)} done, {len(tickers)} remaining.\n")

    for i, t in enumerate(tickers, 1):
        r = await backfill_ticker(t, edgar, processor, table_indexer, args.max_filings)
        total_rows += r["rows"]
        print(f"[{i}/{len(tickers)}] {t}: filings={r['filings']} rows={r['rows']} err={r['errors']}")
        done.add(t)
        PROGRESS.write_text(json.dumps({"done": sorted(done), "total_rows": total_rows}))

    print(f"\nDONE — {len(done)} tickers, {total_rows} financial rows -> gravity_financials")


if __name__ == "__main__":
    asyncio.run(main())

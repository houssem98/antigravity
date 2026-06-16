"""
Build GravityIndex doc trees (Supabase doc_trees) from the chunks already in
Qdrant — the foundation of the vectorless tree-nav engine.

Run ON FLY (Qdrant Cloud + Supabase service key in env):
  fly ssh console -a gravity-api-prod -C "env PYTHONPATH=/app python /app/scripts/build_trees.py --tickers AAPL,MSFT,KO"
  fly ssh console -a gravity-api-prod -C "env PYTHONPATH=/app python /app/scripts/build_trees.py --sp500"

Then: apply migration 0004_doc_trees.sql, set TREE_NAV_ENABLED=true, re-bench.
"""

import argparse
import asyncio
import sys

from app.ingestion.indexing.tree_builder import build_trees_for_ticker


def _sp500() -> list[str]:
    try:
        import httpx
        r = httpx.get("https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv",
                      timeout=30, follow_redirects=True)
        return [ln.split(",")[0].strip() for ln in r.text.strip().splitlines()[1:] if ln]
    except Exception as e:
        print("sp500 fetch failed:", e); return []


async def main(tickers: list[str]):
    total = 0
    for i, tk in enumerate(tickers):
        try:
            n = await build_trees_for_ticker(tk)
            total += n
            print(f"  [{i+1}/{len(tickers)}] {tk}: {n} nodes", flush=True)
        except Exception as e:
            print(f"  [{i+1}/{len(tickers)}] {tk}: ERR {str(e)[:100]}", flush=True)
    print(f"DONE total nodes: {total}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", type=str, default="")
    ap.add_argument("--sp500", action="store_true")
    args = ap.parse_args()
    tks = _sp500() if args.sp500 else [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    if not tks:
        print("no tickers"); sys.exit(1)
    print(f"building trees for {len(tks)} tickers")
    asyncio.run(main(tks))

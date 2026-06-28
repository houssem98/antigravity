#!/usr/bin/env python3
"""Null out impossible future filing_date values (data cleanup, P0-d).

filing_date is TEXT. Some 'document'-type filings got a date parsed from the
body (lease/debt-maturity/contract dates) instead of the actual filing date,
producing impossible years (2027-2031). Those break recency ranking and date
filters, so we null them. Run on Fly where DATABASE_URL is set:

    fly ssh console -a gravity-api-prod -C "python scripts/fix_future_filing_dates.py"
"""

import asyncio
import os

import asyncpg

CUTOFF = "2026-12-31"  # lexicographic compare works for YYYY-MM-DD text
TABLES = ("chunks", "doc_trees", "financials")


async def main():
    db = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(db)
    try:
        await conn.execute("SET statement_timeout=0")  # tsv recompute on chunks is slow
        for t in TABLES:
            before = await conn.fetchval(
                f"select count(*) from public.{t} where filing_date > $1", CUTOFF
            )
            res = await conn.execute(
                f"update public.{t} set filing_date=null where filing_date > $1", CUTOFF
            )
            after = await conn.fetchval(
                f"select count(*) from public.{t} where filing_date > $1", CUTOFF
            )
            print(f"{t}: future-dated {before} -> {after}  ({res})")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())

#!/usr/bin/env python3
"""Backfill Supabase chunks table from Qdrant for FTS keyword search."""

import argparse
import asyncio
import os
import sys

import asyncpg
import structlog
from qdrant_client.async_client import AsyncQdrantClient

logger = structlog.get_logger()


async def backfill():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6333")
    qdrant_key = os.getenv("QDRANT_API_KEY", "")
    db_url = os.getenv("DATABASE_URL")

    if not db_url:
        logger.error("database_url_required")
        sys.exit(1)

    # Fetch from Qdrant
    qdr = AsyncQdrantClient(url=qdrant_url, api_key=qdrant_key)
    points, _ = await qdr.scroll("gravity_chunks", limit=args.limit or 10000, with_payload=True)

    logger.info("fetched", count=len(points))

    # Backfill to Supabase
    conn = await asyncpg.connect(db_url)
    try:
        inserted = 0
        for p in points:
            meta = p.payload or {}
            if not args.dry_run:
                await conn.execute(
                    """insert into public.chunks (id, document_id, ticker, company,
                       document_title, filing_type, filing_date, section, page, chunk_level, text)
                       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                       on conflict (id) do nothing""",
                    str(p.id), meta.get("document_id"), meta.get("ticker"), meta.get("company"),
                    meta.get("document_title"), meta.get("filing_type"), meta.get("filing_date"),
                    meta.get("section"), meta.get("page"), meta.get("chunk_level"), meta.get("text")
                )
                inserted += 1
            if inserted % 100 == 0:
                logger.info("progress", inserted=inserted)
        logger.info("done", inserted=inserted, dry_run=args.dry_run)
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(backfill())

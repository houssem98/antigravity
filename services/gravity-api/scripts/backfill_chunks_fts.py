#!/usr/bin/env python3
"""Backfill Supabase chunks table from Qdrant for FTS keyword search.

Paginated full scroll + batched inserts. Backfills only chunk_level=2 (the
retrievable paragraph level used by public.search_chunks_fts), so the keyword
channel matches the dense/tree corpus instead of lagging behind it.

Idempotent: on conflict (id) do nothing — safe to re-run.
"""

import argparse
import asyncio
import os
import sys

import asyncpg
import structlog
from qdrant_client import AsyncQdrantClient
from qdrant_client import models as qm

logger = structlog.get_logger()

INSERT = """insert into public.chunks (id, document_id, ticker, company,
    document_title, filing_type, filing_date, section, page, chunk_level, text)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    on conflict (id) do nothing"""


def _to_int(v):
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


async def backfill():
    ap = argparse.ArgumentParser()
    ap.add_argument("--level", type=int, default=2,
                    help="chunk_level to backfill; -1 = all levels")
    ap.add_argument("--page", type=int, default=1000, help="Qdrant scroll page size")
    ap.add_argument("--batch", type=int, default=1000, help="Postgres insert batch size")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6333")
    qdrant_key = os.getenv("QDRANT_API_KEY", "")
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        logger.error("database_url_required")
        sys.exit(1)

    qdr = AsyncQdrantClient(url=qdrant_url, api_key=qdrant_key)
    flt = None
    if args.level is not None and args.level >= 0:
        flt = qm.Filter(must=[qm.FieldCondition(
            key="chunk_level", match=qm.MatchValue(value=args.level))])

    conn = await asyncpg.connect(db_url)
    offset = None
    seen = inserted = skipped = 0
    batch = []
    try:
        while True:
            points, offset = await qdr.scroll(
                "gravity_chunks", scroll_filter=flt, limit=args.page,
                offset=offset, with_payload=True, with_vectors=False,
            )
            if not points:
                break
            for p in points:
                seen += 1
                meta = p.payload or {}
                text = meta.get("text")
                if not text:
                    skipped += 1
                    continue
                batch.append((
                    str(p.id), meta.get("document_id"), meta.get("ticker"),
                    meta.get("company") or meta.get("company_name"), meta.get("document_title"),
                    meta.get("filing_type"), meta.get("filing_date"),
                    meta.get("section"), _to_int(meta.get("page")),
                    _to_int(meta.get("chunk_level")), text,
                ))
                if len(batch) >= args.batch:
                    if not args.dry_run:
                        await conn.executemany(INSERT, batch)
                    inserted += len(batch)
                    batch = []
                    logger.info("progress", seen=seen, inserted=inserted, skipped=skipped)
            if offset is None:
                break
        if batch and not args.dry_run:
            await conn.executemany(INSERT, batch)
            inserted += len(batch)
        logger.info("done", seen=seen, inserted=inserted, skipped=skipped, dry_run=args.dry_run)
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(backfill())

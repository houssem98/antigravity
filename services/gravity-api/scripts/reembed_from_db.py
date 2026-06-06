"""
Re-embed chunks from PostgreSQL into Qdrant (no re-download, no re-parse)
========================================================================
Payoff of the normalized-text + chunk store (document-copilot pattern): once
filings are ingested, their chunks live in Postgres. Switching embedders or
recovering an empty/rebuilt Qdrant collection then costs only an embed pass over
stored chunk text — no EDGAR round-trips, no HTML parsing, no re-chunking.

Reads `chunks` rows (optionally filtered by ticker), rebuilds ChunkOutput
objects, and re-embeds them via the live embedder failover chain through the
existing VectorIndexer (so Qdrant payloads stay identical to first ingest).

Deliberately avoids IngestionPipeline.create()/get_search_pipeline() so it does
NOT cold-start the full stack (the thing that OOMs small machines).

Usage (on the warm box or anywhere with DB + Qdrant + an embedder key):
    python scripts/reembed_from_db.py                 # all chunks
    python scripts/reembed_from_db.py --tickers AAPL MSFT
    python scripts/reembed_from_db.py --batch 64 --limit 5000
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


async def main() -> None:
    ap = argparse.ArgumentParser(description="Re-embed stored chunks into Qdrant")
    ap.add_argument("--tickers", nargs="+", default=None, help="Only these tickers")
    ap.add_argument("--batch", type=int, default=64, help="Embed batch size")
    ap.add_argument("--limit", type=int, default=None, help="Max chunks this run")
    args = ap.parse_args()

    from sqlalchemy import select
    from app.db.postgres import async_session
    from app.db.models import Chunk, Document
    from app.ingestion.indexing.vector_indexer import VectorIndexer
    from app.ingestion.processing.chunker import ChunkOutput
    from app.dependencies import get_embedder

    # Embedder failover chain; SPLADE left off (heavy + optional).
    vector_indexer = VectorIndexer(embedder=get_embedder(), splade_encoder=None)

    async with async_session() as session:
        stmt = select(Chunk).join(Document, Chunk.document_id == Document.id)
        if args.tickers:
            stmt = stmt.where(Document.ticker.in_([t.upper() for t in args.tickers]))
        stmt = stmt.order_by(Chunk.document_id, Chunk.position)
        if args.limit:
            stmt = stmt.limit(args.limit)
        rows = (await session.execute(stmt)).scalars().all()

    if not rows:
        print("No chunks found in Postgres (ingest some filings first).")
        return

    chunks = [
        ChunkOutput(
            id=r.id,
            document_id=r.document_id,
            text=r.text,
            text_with_metadata=r.text_with_metadata or r.text,
            level=r.chunk_level,
            section_name=r.section_name or "",
            page_number=r.page_number,
            token_count=r.token_count or 0,
            position=r.position or 0,
            metadata=r.chunk_metadata or {},
        )
        for r in rows
    ]

    print(f"Re-embedding {len(chunks)} chunks (batch={args.batch})...")
    t0 = time.time()
    indexed = await vector_indexer.index_chunks(chunks, batch_size=args.batch)
    print(f"DONE in {time.time()-t0:.0f}s | indexed={indexed}/{len(chunks)} chunks into Qdrant")


if __name__ == "__main__":
    asyncio.run(main())

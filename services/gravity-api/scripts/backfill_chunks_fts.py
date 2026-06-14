"""
Backfill the Supabase `chunks` table (Postgres FTS keyword channel) from the
chunks already indexed in Qdrant. Existing corpus lives only in Qdrant; this
copies paragraph-level chunk text into Supabase so the revived keyword channel
(sparse_search → search_chunks_fts) has data without re-ingesting from EDGAR.

Run ON FLY (has QDRANT_URL + SUPABASE_SERVICE_ROLE_KEY in env):
  fly ssh console -a gravity-api-prod -C "python scripts/backfill_chunks_fts.py"

Idempotent: upserts by chunk id (on_conflict=id).
"""

import asyncio
import sys

from app.config import settings
from app.db.qdrant import qdrant_client, collection_for_org
from app.db import supabase_rest


async def backfill(batch: int = 500) -> int:
    if not supabase_rest.configured():
        print("SUPABASE not configured (need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)")
        return 0

    collection = collection_for_org(None)
    print(f"scroll qdrant collection={collection}")

    offset = None
    written = 0
    scanned = 0
    while True:
        points, offset = await qdrant_client.scroll(
            collection_name=collection,
            limit=batch,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        if not points:
            break

        rows = []
        for p in points:
            scanned += 1
            pl = p.payload or {}
            if pl.get("chunk_level") not in (2, None):
                continue
            text = pl.get("text") or ""
            if not text.strip():
                continue
            rows.append({
                "id": str(pl.get("chunk_id") or p.id),
                "document_id": pl.get("document_id", "") or "",
                "ticker": (pl.get("ticker", "") or "").upper(),
                "company": pl.get("company_name", "") or "",
                "document_title": pl.get("document_title", "") or "",
                "filing_type": pl.get("filing_type", "") or "",
                "filing_date": pl.get("filing_date") or None,
                "section": pl.get("section", "") or "",
                "page": pl.get("page"),
                "chunk_level": pl.get("chunk_level"),
                "text": text,
            })

        if rows:
            rows = list({r["id"]: r for r in rows}.values())  # dedupe within batch
            written += await supabase_rest.sb_insert("chunks", rows, on_conflict="id")
            print(f"  scanned={scanned} written={written}")

        if offset is None:
            break

    print(f"DONE scanned={scanned} written={written}")
    return written


if __name__ == "__main__":
    n = asyncio.run(backfill())
    sys.exit(0 if n >= 0 else 1)

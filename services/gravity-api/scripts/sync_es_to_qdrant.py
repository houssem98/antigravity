"""
ES → Qdrant Bulk Sync
=====================
Reads all chunks from Elasticsearch, embeds with voyage-finance-2 (1024-dim),
upserts to Qdrant gravity_chunks collection.

Features:
  - Checkpoint file for resume after interruption
  - Progress bar + ETA + running cost estimate
  - Dry-run mode (count only, no embeddings called)
  - Batch size tunable (default 128 — voyage max per call)

Usage (from services/gravity-api/):
    python scripts/sync_es_to_qdrant.py
    python scripts/sync_es_to_qdrant.py --dry-run
    python scripts/sync_es_to_qdrant.py --batch 64 --scroll-size 500
    python scripts/sync_es_to_qdrant.py --resume   # skip already-synced IDs

Cost estimate:
  voyage-finance-2 = $0.12 / 1M tokens
  121,374 chunks × ~250 tokens avg = ~30.3M tokens ≈ $3.64 total
"""

import argparse
import asyncio
import json
import os
import sys
import time
import uuid
from pathlib import Path

# ── path hack so we can import app.* when running as a script ───────────────
sys.path.insert(0, str(Path(__file__).parent.parent))

import structlog
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

logger = structlog.get_logger()

CHECKPOINT_FILE = Path(__file__).parent.parent / ".sync_checkpoint.json"
VOYAGE_PRICE_PER_M = 0.12   # $ per 1M tokens
AVG_TOKENS_PER_CHUNK = 250  # rough estimate for cost projection


# ── Checkpoint helpers ───────────────────────────────────────────────────────

def load_checkpoint() -> set[str]:
    if CHECKPOINT_FILE.exists():
        data = json.loads(CHECKPOINT_FILE.read_text())
        ids = set(data.get("synced_ids", []))
        print(f"[resume] checkpoint loaded — {len(ids):,} chunks already synced")
        return ids
    return set()


def save_checkpoint(synced_ids: set[str]) -> None:
    CHECKPOINT_FILE.write_text(json.dumps({"synced_ids": list(synced_ids)}, indent=2))


# ── ES scroll ───────────────────────────────────────────────────────────────

async def scroll_all_chunks(es_url: str, index: str, scroll_size: int):
    """Async generator yielding raw ES hits via scroll API."""
    import httpx

    async with httpx.AsyncClient(base_url=es_url, timeout=60) as client:
        # Initial scroll
        resp = await client.post(
            f"/{index}/_search",
            params={"scroll": "5m"},
            json={
                "size": scroll_size,
                "query": {"match_all": {}},
                "_source": [
                    "chunk_id", "document_id", "text", "text_with_metadata",
                    "ticker", "company_name", "filing_type", "filing_date",
                    "document_title", "section", "page", "chunk_level",
                    "token_count", "position", "entitlements",
                ],
            },
        )
        resp.raise_for_status()
        body = resp.json()
        scroll_id = body["_scroll_id"]
        hits = body["hits"]["hits"]

        while hits:
            for hit in hits:
                yield hit["_source"]

            # Continue scroll
            resp = await client.post(
                "/_search/scroll",
                json={"scroll": "5m", "scroll_id": scroll_id},
            )
            resp.raise_for_status()
            body = resp.json()
            scroll_id = body["_scroll_id"]
            hits = body["hits"]["hits"]

        # Clean up scroll context
        try:
            await client.delete("/_search/scroll", json={"scroll_id": scroll_id})
        except Exception:
            pass


async def count_es_chunks(es_url: str, index: str) -> int:
    import httpx
    async with httpx.AsyncClient(base_url=es_url, timeout=30) as client:
        resp = await client.get(f"/{index}/_count")
        resp.raise_for_status()
        return resp.json()["count"]


# ── Main sync ────────────────────────────────────────────────────────────────

async def run_sync(args):
    from app.config import settings
    from app.db.qdrant import qdrant_client, ensure_collection, DENSE_VECTOR_NAME
    from app.embeddings.voyage_embedder import VoyageEmbedder
    from qdrant_client import models as qmodels

    es_url = os.getenv("ELASTICSEARCH_URL", "http://localhost:9200")
    es_index = settings.elasticsearch_index

    print(f"\n{'='*60}")
    print("  ES -> Qdrant Sync")
    print(f"  ES:     {es_url}/{es_index}")
    print(f"  Qdrant: {settings.qdrant_url} / {settings.qdrant_collection}")
    print(f"  Model:  voyage-finance-2 (1024-dim)")
    print(f"{'='*60}\n")

    # Count total
    total = await count_es_chunks(es_url, es_index)
    print(f"  Total chunks in ES: {total:,}")

    est_tokens = total * AVG_TOKENS_PER_CHUNK
    est_cost = est_tokens / 1_000_000 * VOYAGE_PRICE_PER_M
    print(f"  Est. voyage cost:   ~${est_cost:.2f}  ({est_tokens/1e6:.1f}M tokens)")

    if args.dry_run:
        print("\n[dry-run] Exiting - no embeddings or upserts performed.")
        return

    print()
    input("Press Enter to start sync (Ctrl-C to abort)...")
    print()

    # Ensure collection exists (creates with INT8 quant if needed)
    await ensure_collection()

    embedder = VoyageEmbedder()
    synced_ids = load_checkpoint() if args.resume else set()
    _rate_limit_backoff = 20  # seconds; doubles on repeated rate-limit hits

    batch: list[dict] = []
    total_synced = len(synced_ids)
    total_skipped = 0
    start_time = time.time()
    last_save = time.time()

    def _eta_str(done: int, total: int, elapsed: float) -> str:
        if done == 0:
            return "?"
        rate = done / elapsed
        remaining = (total - done) / rate
        m, s = divmod(int(remaining), 60)
        h, m = divmod(m, 60)
        return f"{h:02d}:{m:02d}:{s:02d}"

    def _progress(done: int, total: int, elapsed: float) -> None:
        pct = done / total * 100 if total else 0
        bar_len = 40
        filled = int(bar_len * pct / 100)
        bar = "█" * filled + "░" * (bar_len - filled)
        eta = _eta_str(done, total, elapsed)
        rate = done / elapsed if elapsed > 0 else 0
        cost_so_far = (done * AVG_TOKENS_PER_CHUNK / 1_000_000) * VOYAGE_PRICE_PER_M
        print(
            f"\r[{bar}] {pct:5.1f}%  {done:,}/{total:,}  "
            f"{rate:.0f}/s  ETA {eta}  ${cost_so_far:.3f}",
            end="",
            flush=True,
        )

    async def _flush_batch(batch: list[dict]) -> None:
        nonlocal total_synced

        texts = [
            c.get("text_with_metadata") or c.get("text", "")
            for c in batch
        ]

        # Retry with exponential backoff on Voyage rate-limit errors
        nonlocal _rate_limit_backoff
        for _attempt in range(6):
            try:
                dense_vectors = await embedder.embed_documents(texts, batch_size=len(batch))
                _rate_limit_backoff = 20  # reset on success
                break
            except Exception as _e:
                if "rate" in str(_e).lower() or "limit" in str(_e).lower():
                    print(f"\n[rate-limit] sleeping {_rate_limit_backoff}s (attempt {_attempt+1}/6)...")
                    await asyncio.sleep(_rate_limit_backoff)
                    _rate_limit_backoff = min(_rate_limit_backoff * 2, 300)
                else:
                    raise
        else:
            raise RuntimeError(f"Embedding failed after 6 retries: {_e}")

        points = []
        for chunk, dense in zip(batch, dense_vectors):
            chunk_id = chunk.get("chunk_id") or str(uuid.uuid4())
            point_id = str(uuid.uuid5(uuid.NAMESPACE_URL, chunk_id))

            ents = chunk.get("entitlements")
            if not isinstance(ents, list) or not ents:
                ents = ["public"]
            points.append(qmodels.PointStruct(
                id=point_id,
                vector={DENSE_VECTOR_NAME: dense},
                payload={
                    "chunk_id":       chunk_id,
                    "document_id":    chunk.get("document_id", ""),
                    "text":           chunk.get("text", ""),
                    "text_with_metadata": chunk.get("text_with_metadata", ""),
                    "ticker":         chunk.get("ticker", ""),
                    "company_name":   chunk.get("company_name", ""),
                    "filing_type":    chunk.get("filing_type", ""),
                    "filing_date":    chunk.get("filing_date", ""),
                    "document_title": chunk.get("document_title", ""),
                    "section":        chunk.get("section", ""),
                    "page":           chunk.get("page"),
                    "chunk_level":    chunk.get("chunk_level", 2),
                    "token_count":    chunk.get("token_count"),
                    "position":       chunk.get("position"),
                    "entitlements":   ents,   # ACL — pre-retrieval filter (P0.1)
                },
            ))
            synced_ids.add(chunk_id)

        await qdrant_client.upsert(
            collection_name=settings.qdrant_collection,
            points=points,
            wait=False,  # async upsert — faster throughput
        )
        total_synced += len(points)

    try:
        async for chunk in scroll_all_chunks(es_url, es_index, args.scroll_size):
            chunk_id = chunk.get("chunk_id", "")

            if args.resume and chunk_id in synced_ids:
                total_skipped += 1
                continue

            batch.append(chunk)

            if len(batch) >= args.batch:
                await _flush_batch(batch)
                batch = []

                elapsed = time.time() - start_time
                _progress(total_synced + total_skipped, total, elapsed)

                # Checkpoint every 60s
                if time.time() - last_save > 60:
                    save_checkpoint(synced_ids)
                    last_save = time.time()

        # Flush remainder
        if batch:
            await _flush_batch(batch)
            elapsed = time.time() - start_time
            _progress(total_synced + total_skipped, total, elapsed)

    except KeyboardInterrupt:
        print("\n\n[interrupted] Saving checkpoint...")
        save_checkpoint(synced_ids)
        print(f"Checkpoint saved — {total_synced:,} synced so far. Re-run with --resume.")
        return

    save_checkpoint(synced_ids)

    elapsed = time.time() - start_time
    m, s = divmod(int(elapsed), 60)
    final_cost = (total_synced * AVG_TOKENS_PER_CHUNK / 1_000_000) * VOYAGE_PRICE_PER_M

    print(f"\n\n{'='*60}")
    print(f"  Done!")
    print(f"  Synced:   {total_synced:,} chunks")
    print(f"  Skipped:  {total_skipped:,} (already in Qdrant)")
    print(f"  Time:     {m}m {s}s")
    print(f"  Est cost: ${final_cost:.2f}")
    print(f"{'='*60}\n")

    if CHECKPOINT_FILE.exists() and total_synced == total:
        CHECKPOINT_FILE.unlink()
        print("Checkpoint file removed (sync complete).")


# ── Entry point ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Sync Elasticsearch chunks to Qdrant")
    parser.add_argument("--dry-run", action="store_true",
                        help="Count chunks and estimate cost, then exit without syncing")
    parser.add_argument("--resume", action="store_true",
                        help="Skip chunk IDs already saved in checkpoint file")
    parser.add_argument("--batch", type=int, default=128,
                        help="Embedding batch size (default: 128, voyage max)")
    parser.add_argument("--scroll-size", type=int, default=500,
                        help="ES scroll page size (default: 500)")
    args = parser.parse_args()

    asyncio.run(run_sync(args))


if __name__ == "__main__":
    main()

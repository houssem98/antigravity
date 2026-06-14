"""
Free Redis (Upstash) space when the DB hits its capacity quota.

The semantic-cache embeddings (gscache_emb:* — 1024-float JSON blobs) and cached
results (gscache:*) are the space hogs; conversation history (conv:*) and stale
rate-limit counters add more. This deletes those namespaces but KEEPS apikey:*
(API keys live in Redis — flushing all would revoke them).

Run ON FLY:
  fly ssh console -a gravity-api-prod -C "env PYTHONPATH=/app python /app/scripts/redis_cleanup.py"
"""

import asyncio
from app.db.redis import redis_client

PATTERNS = ["gscache_emb:*", "gscache:*", "conv:*", "ratelimit:minute:*"]


async def main():
    total = 0
    for pat in PATTERNS:
        n = 0
        batch = []
        async for key in redis_client.scan_iter(pat, count=1000):
            batch.append(key)
            if len(batch) >= 500:
                await redis_client.delete(*batch)
                n += len(batch); batch = []
        if batch:
            await redis_client.delete(*batch)
            n += len(batch)
        print(f"  {pat}: deleted {n}")
        total += n
    print(f"DONE deleted {total} keys (apikey:* preserved)")
    try:
        info = await redis_client.info("memory")
        print("used_memory_human:", info.get("used_memory_human"))
    except Exception:
        pass


if __name__ == "__main__":
    asyncio.run(main())

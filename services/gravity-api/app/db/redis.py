"""Gravity Search — Redis Client (caching + semantic cache)"""

import redis.asyncio as redis
from app.config import settings

class RedisLazyClient:
    def __init__(self):
        self._client = None

    def __getattr__(self, name):
        if self._client is None:
            self._client = redis.from_url(
                settings.redis_url,
                decode_responses=True,
                max_connections=50,
            )
        return getattr(self._client, name)

redis_client = RedisLazyClient()

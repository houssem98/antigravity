"""Market data caching layer with Redis."""

import json
from typing import Optional, Dict, Any
from datetime import datetime, timedelta

from app.db.redis import redis_client

DEFAULT_TTL = 60  # 60 seconds


class MarketDataCache:
    """Cache market data in Redis with TTL."""

    @staticmethod
    def _key(asset: str) -> str:
        """Generate cache key."""
        return f"markets:{asset.lower()}"

    @staticmethod
    async def get(asset: str) -> Optional[Dict[str, Any]]:
        """Get cached market data."""
        try:
            key = MarketDataCache._key(asset)
            data = await redis_client.get(key)
            if data:
                return json.loads(data)
        except Exception:
            pass
        return None

    @staticmethod
    async def set(asset: str, data: Dict[str, Any], ttl: int = DEFAULT_TTL) -> bool:
        """Cache market data."""
        try:
            key = MarketDataCache._key(asset)
            await redis_client.setex(key, ttl, json.dumps(data))
            return True
        except Exception:
            return False

    @staticmethod
    async def delete(asset: str) -> bool:
        """Delete cached data."""
        try:
            key = MarketDataCache._key(asset)
            await redis_client.delete(key)
            return True
        except Exception:
            return False

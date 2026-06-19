"""Redis cache client with async support and JSON serialization."""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


class CacheClient:
    """Async Redis cache client wrapping redis.asyncio.

    Usage::

        cache = CacheClient(url="redis://localhost:6379")
        await cache.connect()
        await cache.set("key", {"data": 42}, ttl=3600)
        val = await cache.get("key")  # returns dict or None
    """

    def __init__(self, url: str = "redis://localhost:6379"):
        self.url = url
        self._client = None

    async def connect(self) -> None:
        try:
            import redis.asyncio as aioredis
            self._client = aioredis.from_url(
                self.url,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=5,
            )
            await self._client.ping()
            logger.info("Redis connected: %s", self.url)
        except Exception as exc:
            logger.warning("Redis unavailable (%s): %s — caching disabled", self.url, exc)
            self._client = None

    async def get(self, key: str) -> Any | None:
        if self._client is None:
            return None
        try:
            raw = await self._client.get(key)
            if raw is None:
                return None
            return json.loads(raw)
        except Exception as exc:
            logger.debug("Cache get error for key '%s': %s", key, exc)
            return None

    async def set(self, key: str, value: Any, ttl: int = 3600) -> bool:
        if self._client is None:
            return False
        try:
            await self._client.setex(key, ttl, json.dumps(value, default=str))
            return True
        except Exception as exc:
            logger.debug("Cache set error for key '%s': %s", key, exc)
            return False

    async def delete(self, key: str) -> None:
        if self._client:
            try:
                await self._client.delete(key)
            except Exception:
                pass

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()
            logger.info("Redis connection closed")

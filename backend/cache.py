"""Redis cache client with async support, JSON serialization, and in-process fallback.

When Redis is unreachable the client transparently falls back to a bounded
in-process TTL dictionary. That keeps request-level memoisation (model inference,
Open-Meteo fetches) working on single-task deployments that run without an
ElastiCache node, instead of silently disabling every cache read.

The fallback is deliberately *not* a substitute for Redis in a scaled
deployment: it is per-process, so multiple tasks would each hold their own copy,
and cross-process pub/sub is unavailable. `_client is None` therefore remains the
correct check for "real Redis present" (see DataPipeline._publish).
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

#: Cap on fallback entries. Prediction payloads dominate; 512 grid-cell
#: responses is a few hundred MB worst case, so keep this conservative.
DEFAULT_LOCAL_MAX_ENTRIES = 256


class CacheClient:
    """Async Redis cache client wrapping redis.asyncio.

    Usage::

        cache = CacheClient(url="redis://localhost:6379")
        await cache.connect()
        await cache.set("key", {"data": 42}, ttl=3600)
        val = await cache.get("key")  # returns dict or None

    Parameters
    ----------
    url:
        Redis connection URL.
    local_fallback:
        When True (default) and Redis cannot be reached, values are cached in
        this process instead. Set False to restore strict "no Redis, no cache"
        behaviour.
    local_max_entries:
        Maximum number of fallback entries retained before the oldest-expiring
        keys are evicted.
    """

    def __init__(
        self,
        url: str = "redis://localhost:6379",
        *,
        local_fallback: bool = True,
        local_max_entries: int = DEFAULT_LOCAL_MAX_ENTRIES,
    ):
        self.url = url
        self._client = None
        self._local_fallback = local_fallback
        self._local_max_entries = max(1, local_max_entries)
        # key -> (expires_at_monotonic, json_text)
        self._local: dict[str, tuple[float, str]] = {}

    @property
    def backend(self) -> str:
        """Return which store is serving reads: 'redis', 'in-process', or 'none'."""
        if self._client is not None:
            return "redis"
        return "in-process" if self._local_fallback else "none"

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
            self._client = None
            if self._local_fallback:
                logger.warning(
                    "Redis unavailable (%s): %s — falling back to in-process cache "
                    "(per-task, no pub/sub)", self.url, exc,
                )
            else:
                logger.warning("Redis unavailable (%s): %s — caching disabled", self.url, exc)

    # ── Local fallback helpers ────────────────────────────────────────────────

    def _local_get(self, key: str) -> str | None:
        entry = self._local.get(key)
        if entry is None:
            return None
        expires_at, raw = entry
        if expires_at <= time.monotonic():
            self._local.pop(key, None)
            return None
        return raw

    def _local_set(self, key: str, raw: str, ttl: int) -> None:
        now = time.monotonic()
        # Drop anything already expired before considering eviction.
        for expired in [k for k, (exp, _) in self._local.items() if exp <= now]:
            self._local.pop(expired, None)
        if key not in self._local and len(self._local) >= self._local_max_entries:
            oldest = min(self._local, key=lambda k: self._local[k][0])
            self._local.pop(oldest, None)
        self._local[key] = (now + max(1, ttl), raw)

    # ── Public API ────────────────────────────────────────────────────────────

    async def get(self, key: str) -> Any | None:
        if self._client is None:
            if not self._local_fallback:
                return None
            raw = self._local_get(key)
            return json.loads(raw) if raw is not None else None
        try:
            raw = await self._client.get(key)
            if raw is None:
                return None
            return json.loads(raw)
        except Exception as exc:
            logger.debug("Cache get error for key '%s': %s", key, exc)
            return None

    async def set(self, key: str, value: Any, ttl: int = 3600) -> bool:
        try:
            raw = json.dumps(value, default=str)
        except (TypeError, ValueError) as exc:
            logger.debug("Cache set skipped for key '%s' (unserialisable): %s", key, exc)
            return False
        if self._client is None:
            if not self._local_fallback:
                return False
            self._local_set(key, raw, ttl)
            return True
        try:
            await self._client.setex(key, ttl, raw)
            return True
        except Exception as exc:
            logger.debug("Cache set error for key '%s': %s", key, exc)
            return False

    async def delete(self, key: str) -> None:
        self._local.pop(key, None)
        if self._client:
            try:
                await self._client.delete(key)
            except Exception:
                pass

    async def close(self) -> None:
        self._local.clear()
        if self._client:
            await self._client.aclose()
            logger.info("Redis connection closed")

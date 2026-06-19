"""PostgreSQL + PostGIS database client for historical climate queries."""

from __future__ import annotations

import logging
from datetime import date

logger = logging.getLogger(__name__)


class DatabaseClient:
    """Async PostgreSQL client using asyncpg.

    Manages the climate_observations table with PostGIS spatial indexing
    for efficient bounding-box queries.
    """

    def __init__(self, url: str):
        self.url = url
        self._pool = None

    async def connect(self) -> None:
        try:
            import asyncpg
            # Convert SQLAlchemy-style URL to asyncpg format
            pg_url = self.url.replace("postgresql://", "postgresql://")
            self._pool = await asyncpg.create_pool(pg_url, min_size=2, max_size=10)
            logger.info("PostgreSQL connected: %s", self.url.split("@")[-1])
        except Exception as exc:
            logger.warning("PostgreSQL unavailable: %s — historical queries disabled", exc)
            self._pool = None

    async def query_historical(
        self,
        start_date: date,
        end_date: date,
        lat_min: float,
        lat_max: float,
        lon_min: float,
        lon_max: float,
        variable: str,
        limit: int = 500,
    ) -> list[dict]:
        """Spatial-temporal query using PostGIS ST_MakeEnvelope."""
        if self._pool is None:
            return []
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    obs_date::text AS date,
                    ST_Y(geom::geometry) AS lat,
                    ST_X(geom::geometry) AS lon,
                    variable,
                    value
                FROM climate_observations
                WHERE
                    obs_date BETWEEN $1 AND $2
                    AND variable = $3
                    AND geom && ST_MakeEnvelope($4, $5, $6, $7, 4326)
                ORDER BY obs_date, lat, lon
                LIMIT $8
                """,
                start_date, end_date, variable,
                lon_min, lat_min, lon_max, lat_max,
                limit,
            )
            return [dict(r) for r in rows]

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()

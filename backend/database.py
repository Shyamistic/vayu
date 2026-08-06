"""PostgreSQL + PostGIS database client for historical climate and IoT queries."""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import UTC, date, datetime
from typing import Any

logger = logging.getLogger(__name__)

_SIMULATED_MARKERS = ("mock", "simulat", "synthetic", "climatolog")
_UNVERSIONED_MARKERS = ("", "unknown", "unversioned", "none", "null")


class EvidenceValidationError(ValueError):
    """Raised when a record cannot be safely retained as operational evidence."""


def canonical_payload_checksum(payload: Any) -> str:
    """Return a stable SHA-256 digest for JSON evidence payloads.

    JSON is serialised with sorted keys and compact separators so equivalent
    mappings produce the same digest regardless of insertion order.
    """
    try:
        canonical = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise EvidenceValidationError("evidence payload must be finite JSON data") from exc
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _require_timestamp(name: str, value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise EvidenceValidationError(f"{name} must be a timezone-aware datetime")
    return value.astimezone(UTC)


def _require_version(name: str, value: str | None) -> str:
    normalized = value.strip() if isinstance(value, str) else ""
    if normalized.lower() in _UNVERSIONED_MARKERS:
        raise EvidenceValidationError(f"{name} is required for evidence archival")
    return normalized


def _validate_evidence_provenance(
    *,
    source_identifier: str | None,
    retrieved_at: datetime,
    freshness_at: datetime,
    quality_flags: list[str] | None,
) -> tuple[str, datetime, datetime, list[str]]:
    source = source_identifier.strip() if isinstance(source_identifier, str) else ""
    if not source:
        raise EvidenceValidationError("source_identifier is required for evidence archival")
    flags = list(quality_flags or [])
    if not all(isinstance(flag, str) and flag.strip() for flag in flags):
        raise EvidenceValidationError("quality_flags must contain non-empty strings")
    provenance_text = " ".join([source, *flags]).lower()
    if any(marker in provenance_text for marker in _SIMULATED_MARKERS):
        raise EvidenceValidationError("mock, simulated, synthetic, or climatological data cannot be archived as evidence")
    return (
        source,
        _require_timestamp("retrieved_at", retrieved_at),
        _require_timestamp("freshness_at", freshness_at),
        flags,
    )


class DatabaseClient:
    """Async PostgreSQL client using asyncpg.

    Manages the climate_observations table with PostGIS spatial indexing
    for efficient bounding-box queries, plus IoT station_readings tables.
    """

    def __init__(self, url: str):
        self.url = url
        self._pool = None

    @property
    def connected(self) -> bool:
        """True when a live connection pool exists.

        Every query method already returns an empty result when the pool is
        absent, so callers cannot distinguish "no rows" from "no database". This
        exposes the difference for /health, which otherwise reports a lean
        deployment as fully healthy.
        """
        return self._pool is not None

    async def connect(self) -> None:
        try:
            import asyncpg
            pg_url = self.url.replace("postgresql://", "postgresql://")
            self._pool = await asyncpg.create_pool(pg_url, min_size=2, max_size=10)
            logger.info("PostgreSQL connected: %s", self.url.split("@")[-1])
        except Exception as exc:
            logger.warning("PostgreSQL unavailable: %s — historical queries disabled", exc)
            self._pool = None

    # ── Climate observations ──────────────────────────────────────────────────

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

    # ── IoT station queries ───────────────────────────────────────────────────

    async def get_all_stations(self) -> list[dict]:
        """Return all registered stations with their latest readings and health status."""
        if self._pool is None:
            return []
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    s.station_id,
                    s.name,
                    s.lat,
                    s.lon,
                    s.alt,
                    s.description,
                    s.installed_at::text,
                    s.is_active,
                    s.metadata,
                    -- Latest reading columns
                    r.timestamp::text           AS last_seen,
                    r.temperature_c,
                    r.humidity_pct,
                    r.pressure_hpa,
                    r.light_lux,
                    r.soil_moisture_pct,
                    r.rain_detected,
                    r.wind_speed_ms,
                    r.wind_gust_ms,
                    r.water_level_cm,
                    r.battery_v,
                    r.solar_v,
                    r.charging_ma
                FROM iot_stations s
                LEFT JOIN LATERAL (
                    SELECT *
                    FROM station_readings sr
                    WHERE sr.station_id = s.station_id
                    ORDER BY sr.timestamp DESC
                    LIMIT 1
                ) r ON TRUE
                WHERE s.is_active = TRUE
                ORDER BY s.station_id
                """
            )
            return [dict(r) for r in rows]

    async def get_station_by_id(self, station_id: str) -> dict | None:
        """Return a single station with its latest reading."""
        if self._pool is None:
            return None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    s.station_id,
                    s.name,
                    s.lat,
                    s.lon,
                    s.alt,
                    s.description,
                    s.installed_at::text,
                    s.is_active,
                    s.metadata,
                    r.timestamp::text           AS last_seen,
                    r.temperature_c,
                    r.humidity_pct,
                    r.pressure_hpa,
                    r.light_lux,
                    r.soil_moisture_pct,
                    r.rain_detected,
                    r.wind_speed_ms,
                    r.wind_gust_ms,
                    r.water_level_cm,
                    r.battery_v,
                    r.solar_v,
                    r.charging_ma
                FROM iot_stations s
                LEFT JOIN LATERAL (
                    SELECT *
                    FROM station_readings sr
                    WHERE sr.station_id = s.station_id
                    ORDER BY sr.timestamp DESC
                    LIMIT 1
                ) r ON TRUE
                WHERE s.station_id = $1
                """,
                station_id,
            )
            return dict(row) if row else None

    async def get_station_readings(
        self,
        station_id: str,
        limit: int = 100,
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> list[dict]:
        """Return historical sensor readings for a station, ordered by timestamp desc."""
        if self._pool is None:
            return []
        async with self._pool.acquire() as conn:
            if start and end:
                rows = await conn.fetch(
                    """
                    SELECT
                        id, station_id,
                        timestamp::text AS timestamp,
                        temperature_c, humidity_pct, pressure_hpa,
                        light_lux, soil_moisture_pct, rain_detected,
                        wind_speed_ms, wind_gust_ms, water_level_cm,
                        battery_v, solar_v, charging_ma,
                        lat, lon
                    FROM station_readings
                    WHERE station_id = $1
                      AND timestamp BETWEEN $2 AND $3
                    ORDER BY timestamp DESC
                    LIMIT $4
                    """,
                    station_id, start, end, limit,
                )
            elif start:
                rows = await conn.fetch(
                    """
                    SELECT
                        id, station_id,
                        timestamp::text AS timestamp,
                        temperature_c, humidity_pct, pressure_hpa,
                        light_lux, soil_moisture_pct, rain_detected,
                        wind_speed_ms, wind_gust_ms, water_level_cm,
                        battery_v, solar_v, charging_ma,
                        lat, lon
                    FROM station_readings
                    WHERE station_id = $1 AND timestamp >= $2
                    ORDER BY timestamp DESC
                    LIMIT $3
                    """,
                    station_id, start, limit,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT
                        id, station_id,
                        timestamp::text AS timestamp,
                        temperature_c, humidity_pct, pressure_hpa,
                        light_lux, soil_moisture_pct, rain_detected,
                        wind_speed_ms, wind_gust_ms, water_level_cm,
                        battery_v, solar_v, charging_ma,
                        lat, lon
                    FROM station_readings
                    WHERE station_id = $1
                    ORDER BY timestamp DESC
                    LIMIT $2
                    """,
                    station_id, limit,
                )
            return [dict(r) for r in rows]

    async def insert_station_reading(self, payload: dict[str, Any]) -> int | None:
        """Insert a new telemetry reading from an IoT station. Returns the new row id."""
        if self._pool is None:
            return None
        sensors = payload.get("sensors", {})
        power = payload.get("power", {})
        gps = payload.get("gps", {})
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO station_readings (
                    station_id, timestamp,
                    temperature_c, humidity_pct, pressure_hpa, light_lux,
                    soil_moisture_pct, rain_detected,
                    wind_speed_ms, wind_gust_ms, water_level_cm,
                    battery_v, solar_v, charging_ma,
                    lat, lon, raw_payload
                ) VALUES (
                    $1, $2,
                    $3, $4, $5, $6,
                    $7, $8,
                    $9, $10, $11,
                    $12, $13, $14,
                    $15, $16, $17::jsonb
                )
                ON CONFLICT DO NOTHING
                RETURNING id
                """,
                payload.get("station_id"),
                payload.get("timestamp"),
                sensors.get("temperature_c"),
                sensors.get("humidity_pct"),
                sensors.get("pressure_hpa"),
                sensors.get("light_lux"),
                sensors.get("soil_moisture_pct"),
                sensors.get("rain_detected"),
                sensors.get("wind_speed_ms"),
                sensors.get("wind_gust_ms"),
                sensors.get("water_level_cm"),
                power.get("battery_v"),
                power.get("solar_v"),
                power.get("charging_ma"),
                gps.get("lat"),
                gps.get("lon"),
                str(payload),
            )
            return int(row["id"]) if row else None

    async def upsert_station(self, station: dict[str, Any]) -> None:
        """Register or update a station record (upsert by station_id)."""
        if self._pool is None:
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO iot_stations (station_id, name, lat, lon, alt, description, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
                ON CONFLICT (station_id) DO UPDATE
                    SET name = EXCLUDED.name,
                        lat  = EXCLUDED.lat,
                        lon  = EXCLUDED.lon,
                        alt  = EXCLUDED.alt,
                        description = EXCLUDED.description,
                        metadata    = EXCLUDED.metadata
                """,
                station.get("station_id"),
                station.get("name", station.get("station_id")),
                station.get("lat", 0.0),
                station.get("lon", 0.0),
                station.get("alt", 0.0),
                station.get("description"),
                str(station.get("metadata", {})),
            )

    # ── Provenance-preserving evidence archives ───────────────────────────────

    async def archive_observation(
        self,
        *,
        source_identifier: str,
        region: str | None,
        payload: dict[str, Any],
        retrieved_at: datetime,
        freshness_at: datetime,
        observed_at: datetime | None = None,
        quality_flags: list[str] | None = None,
    ) -> int | None:
        """Append a source-attributed observation payload with an immutable digest.

        Validation intentionally runs before checking database availability: a
        caller cannot treat an invalid or simulated payload as archiveable merely
        because persistence is currently offline.
        """
        source, retrieved, freshness, flags = _validate_evidence_provenance(
            source_identifier=source_identifier,
            retrieved_at=retrieved_at,
            freshness_at=freshness_at,
            quality_flags=quality_flags,
        )
        observation_time = _require_timestamp("observed_at", observed_at) if observed_at else None
        checksum = canonical_payload_checksum(payload)
        if self._pool is None:
            return None
        payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
        flags_json = json.dumps(flags, separators=(",", ":"))
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO observation_archive (
                    source_identifier, region, observed_at, retrieved_at,
                    freshness_at, quality_flags, payload, payload_checksum
                ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
                ON CONFLICT (source_identifier, region, freshness_at, payload_checksum)
                DO NOTHING
                RETURNING id
                """,
                source, region, observation_time, retrieved, freshness,
                flags_json, payload_json, checksum,
            )
            return int(row["id"]) if row else None

    async def archive_prediction(
        self,
        *,
        cycle_id: str | None,
        prediction_date: date,
        target_date: date,
        lead_day: int,
        region: str,
        grid_cells: list[dict[str, Any]],
        source_identifier: str,
        retrieved_at: datetime,
        freshness_at: datetime,
        forecast_issue_time: datetime,
        forecast_target_time: datetime,
        model_version: str | None,
        run_version: str | None,
        manifest_version: str | None,
        calibration_version: str | None,
        quality_flags: list[str] | None = None,
    ) -> int | None:
        """Append a fully-versioned, non-simulated forecast evidence record.

        Every field required to reproduce or qualify an operational forecast is
        mandatory. Incomplete provenance fails closed rather than creating a
        superficially credible record that cannot support later verification.
        """
        if not isinstance(lead_day, int) or not 1 <= lead_day <= 7:
            raise EvidenceValidationError("lead_day must be an integer in the operational range 1..7")
        if not isinstance(region, str) or not region.strip():
            raise EvidenceValidationError("region is required for prediction archival")
        if not isinstance(grid_cells, list) or not grid_cells:
            raise EvidenceValidationError("grid_cells must be a non-empty list")
        source, retrieved, freshness, flags = _validate_evidence_provenance(
            source_identifier=source_identifier,
            retrieved_at=retrieved_at,
            freshness_at=freshness_at,
            quality_flags=quality_flags,
        )
        issue_time = _require_timestamp("forecast_issue_time", forecast_issue_time)
        target_time = _require_timestamp("forecast_target_time", forecast_target_time)
        if target_time.date() != target_date:
            raise EvidenceValidationError("forecast_target_time must fall on target_date")
        if target_time <= issue_time:
            raise EvidenceValidationError("forecast_target_time must be after forecast_issue_time")
        expected_lead = (target_date - issue_time.date()).days
        if expected_lead != lead_day:
            raise EvidenceValidationError("lead_day must match forecast_issue_time and target_date")
        model = _require_version("model_version", model_version)
        run = _require_version("run_version", run_version)
        manifest = _require_version("manifest_version", manifest_version)
        calibration = _require_version("calibration_version", calibration_version)
        checksum = canonical_payload_checksum(grid_cells)
        if self._pool is None:
            return None
        cells_json = json.dumps(grid_cells, sort_keys=True, separators=(",", ":"), allow_nan=False)
        flags_json = json.dumps(flags, separators=(",", ":"))
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO prediction_archive (
                    cycle_id, prediction_date, target_date, lead_day, region,
                    grid_cells, source_identifier, retrieved_at, freshness_at,
                    forecast_issue_time, forecast_target_time, model_version,
                    run_version, manifest_version, calibration_version, quality_flags,
                    payload_checksum, evidence_complete
                ) VALUES (
                    $1::uuid, $2, $3, $4, $5,
                    $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                    $16::jsonb, $17, TRUE
                )
                ON CONFLICT (forecast_issue_time, target_date, lead_day, region, payload_checksum)
                WHERE evidence_complete
                DO NOTHING
                RETURNING id
                """,
                cycle_id, prediction_date, target_date, lead_day, region.strip(),
                cells_json, source, retrieved, freshness, issue_time, target_time, model, run,
                manifest, calibration, flags_json, checksum,
            )
            return int(row["id"]) if row else None

    async def record_operational_cycle_run(self, payload: dict[str, Any]) -> None:
        """Persist operational status without mutating archived evidence rows."""
        if self._pool is None:
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO operational_cycle_runs (
                    cycle_id, started_at, completed_at, status, model_version,
                    regions_processed, predictions_archived, data_latency_seconds,
                    quality_control_flags, error, stages
                ) VALUES (
                    $1::uuid, $2::timestamptz, $3::timestamptz, $4, $5,
                    $6::jsonb, $7, $8, $9, $10, $11::jsonb
                )
                ON CONFLICT (cycle_id) DO UPDATE SET
                    completed_at = EXCLUDED.completed_at,
                    status = EXCLUDED.status,
                    regions_processed = EXCLUDED.regions_processed,
                    predictions_archived = EXCLUDED.predictions_archived,
                    data_latency_seconds = EXCLUDED.data_latency_seconds,
                    quality_control_flags = EXCLUDED.quality_control_flags,
                    error = EXCLUDED.error,
                    stages = EXCLUDED.stages
                """,
                payload["cycle_id"], payload["started_at"], payload.get("completed_at"),
                payload["status"], payload["model_version"],
                json.dumps(payload.get("regions_processed", [])),
                payload.get("predictions_archived", 0), payload.get("data_latency_seconds"),
                payload.get("quality_control_flags", 0), payload.get("error"),
                json.dumps(payload.get("stages", [])),
            )

    async def get_latest_operational_cycle_run(self) -> dict[str, Any] | None:
        """Return the newest persisted operational-cycle status."""
        if self._pool is None:
            return None
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT cycle_id::text, started_at::text, completed_at::text, status,
                       model_version, regions_processed, predictions_archived,
                       data_latency_seconds, quality_control_flags, error, stages
                FROM operational_cycle_runs
                ORDER BY started_at DESC
                LIMIT 1
                """
            )
            return dict(row) if row else None

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()

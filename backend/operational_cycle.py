"""Twice-daily operational forecast production cycle (Requirement 85).

This module is deliberately independent of the FastAPI request lifecycle so an ECS
scheduled task can run the full download → QC → inference → post-process → archive
workflow at 00:00 and 12:00 UTC. A failed run alerts operations and retries once
exactly 30 minutes later.
"""
from __future__ import annotations

import asyncio
import copy
import logging
import math
import os
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx

from backend.cache import CacheClient
from backend.database import DatabaseClient
from backend.evidence_ingestion import IngestionState, LiveReplayIngestionAdapter
from backend.pipeline import DataPipeline, REGION_GRID_POINTS

logger = logging.getLogger(__name__)

OPERATIONAL_STATUS_CACHE_KEY = "operational_cycle:last_status"
STATUS_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
RETRY_DELAY_SECONDS = 30 * 60
ForecastInference = Callable[[str, date, int, dict[str, Any]], Awaitable[list[Any]]]
ObservationLoader = Callable[[], Awaitable[dict[str, dict[str, Any]]]]
AlertPublisher = Callable[[str, dict[str, Any]], Awaitable[bool]]


class QualityControlError(ValueError):
    """Raised when downloaded observations are not safe for model inference."""


@dataclass
class OperationalCycleResult:
    cycle_id: str
    started_at: str
    completed_at: str | None = None
    status: str = "running"
    model_version: str = "unknown"
    regions_processed: list[str] = field(default_factory=list)
    predictions_archived: int = 0
    data_latency_seconds: float | None = None
    quality_control_flags: int = 0
    error: str | None = None
    stages: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "cycle_id": self.cycle_id,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "status": self.status,
            "model_version": self.model_version,
            "regions_processed": self.regions_processed,
            "predictions_archived": self.predictions_archived,
            "data_latency_seconds": self.data_latency_seconds,
            "quality_control_flags": self.quality_control_flags,
            "error": self.error,
            "stages": self.stages,
        }


class SnsAlertPublisher:
    """Publish cycle-failure alerts through the configured SNS topic."""

    def __init__(self, topic_arn: str | None = None) -> None:
        self._topic_arn = topic_arn or os.getenv("SNS_ALERT_TOPIC_ARN")

    async def __call__(self, subject: str, payload: dict[str, Any]) -> bool:
        if not self._topic_arn:
            logger.error("SNS alert topic is not configured; unable to publish: %s", subject)
            return False
        try:
            import boto3

            message = "VAYU operational prediction cycle failure\n\n" + "\n".join(
                f"{key}: {value}" for key, value in payload.items()
            )
            await asyncio.to_thread(
                boto3.client("sns").publish,
                TopicArn=self._topic_arn,
                Subject=subject[:100],
                Message=message,
            )
            return True
        except Exception as exc:
            logger.exception("Failed to publish SNS operational-cycle alert: %s", exc)
            return False


def quality_control_observations(observations: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Remove non-finite or physically implausible observation values.

    Open-Meteo responses are checked before inference. At least one valid weather
    field must remain; otherwise the cycle is failed rather than archiving a
    fabricated forecast.
    """
    cleaned = copy.deepcopy(observations)
    hourly = cleaned.get("hourly")
    if not isinstance(hourly, dict):
        raise QualityControlError("observations have no hourly weather fields")

    ranges = {
        "temperature_2m": (-60.0, 65.0),
        "apparent_temperature": (-70.0, 75.0),
        "relative_humidity_2m": (0.0, 100.0),
        "precipitation": (0.0, 500.0),
        "wind_speed_10m": (0.0, 150.0),
        "wind_direction_10m": (0.0, 360.0),
        "surface_pressure": (500.0, 1100.0),
        "cloud_cover": (0.0, 100.0),
    }
    flags = 0
    valid_values = 0
    for field, values in hourly.items():
        if not isinstance(values, list):
            continue
        minimum, maximum = ranges.get(field, (-float("inf"), float("inf")))
        cleaned_values: list[float | None] = []
        for value in values:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                cleaned_values.append(None)
                flags += 1
                continue
            numeric_value = float(value)
            if not math.isfinite(numeric_value) or not minimum <= numeric_value <= maximum:
                cleaned_values.append(None)
                flags += 1
                continue
            cleaned_values.append(numeric_value)
            valid_values += 1
        hourly[field] = cleaned_values

    if valid_values == 0:
        raise QualityControlError("all downloaded weather observations failed quality control")
    return cleaned, flags


def post_process_grid_cells(cells: list[Any]) -> list[dict[str, Any]]:
    """Validate physical bounds and serialize forecast cells for archive storage."""
    processed: list[dict[str, Any]] = []
    for cell in cells:
        raw = cell.model_dump() if hasattr(cell, "model_dump") else dict(cell)
        lat, lon = float(raw["lat"]), float(raw["lon"])
        rainfall = max(0.0, min(500.0, float(raw["rainfall"])))
        temp_max = max(-60.0, min(65.0, float(raw["temp_max"])))
        temp_min = max(-70.0, min(60.0, float(raw["temp_min"])))
        if not all(math.isfinite(value) for value in (lat, lon, rainfall, temp_max, temp_min)):
            raise QualityControlError("inference returned non-finite grid-cell values")
        raw.update({
            "lat": lat,
            "lon": lon,
            "rainfall": rainfall,
            "temp_max": temp_max,
            "temp_min": min(temp_min, temp_max),
            "rainfall_uncertainty": max(0.0, float(raw.get("rainfall_uncertainty", 0.0))),
            "temp_max_uncertainty": max(0.0, float(raw.get("temp_max_uncertainty", 0.0))),
            "temp_min_uncertainty": max(0.0, float(raw.get("temp_min_uncertainty", 0.0))),
        })
        processed.append(raw)
    if not processed:
        raise QualityControlError("inference returned no grid cells")
    return processed


class DailyPredictionCycle:
    """Automates the production forecast workflow for every active region."""

    def __init__(
        self,
        cache: CacheClient,
        db: DatabaseClient,
        *,
        regions: list[str] | None = None,
        model_version: str | None = None,
        observation_loader: ObservationLoader | None = None,
        inference: ForecastInference | None = None,
        alert_publisher: AlertPublisher | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._cache = cache
        self._db = db
        self._ingestion = LiveReplayIngestionAdapter(db)
        self._regions = regions or list(REGION_GRID_POINTS)
        self._model_version = model_version or os.getenv("MODEL_VERSION", "1.0.0")
        self._observation_loader = observation_loader or self._download_observations
        self._inference = inference or self._production_inference
        self._alert_publisher = alert_publisher or SnsAlertPublisher()
        self._sleep = sleep

    async def run_with_retry(self) -> OperationalCycleResult:
        """Run once, alert on failure, then retry a single time after 30 minutes."""
        try:
            return await self.run_once()
        except Exception as first_error:
            failure = self._failure_result(first_error)
            await self._persist_status(failure)
            await self._alert_publisher(
                "VAYU daily prediction cycle failed; retry scheduled",
                failure.to_dict(),
            )
            logger.exception("Operational cycle failed; retrying in 30 minutes")
            await self._sleep(RETRY_DELAY_SECONDS)
            try:
                return await self.run_once()
            except Exception as retry_error:
                failure = self._failure_result(retry_error)
                await self._persist_status(failure)
                await self._alert_publisher(
                    "VAYU daily prediction cycle retry failed",
                    failure.to_dict(),
                )
                raise

    async def run_once(self) -> OperationalCycleResult:
        """Execute data download → QC → inference → post-processing → storage."""
        started = datetime.now(UTC)
        result = OperationalCycleResult(
            cycle_id=str(uuid.uuid4()),
            started_at=started.isoformat(),
            model_version=self._model_version,
        )
        await self._persist_status(result)

        try:
            result.stages.append("data_download")
            downloaded = await self._observation_loader()
            missing_regions = set(self._regions) - set(downloaded)
            if missing_regions:
                raise QualityControlError(f"missing downloaded observations for {sorted(missing_regions)}")

            result.stages.append("quality_control")
            observations: dict[str, dict[str, Any]] = {}
            for region in self._regions:
                cleaned, flags = quality_control_observations(downloaded[region])
                # Cached and climatological fallbacks may be displayed as stale,
                # but must never become operational evidence or trigger a new
                # archived forecast without a traceable fresh source.
                if cleaned.get("stale"):
                    raise QualityControlError(
                        f"{region} observations are stale ({cleaned.get('stale_reason', 'unknown reason')}); "
                        "refusing to archive a forecast as production evidence"
                    )
                retrieved_at = _parse_evidence_timestamp(cleaned.get("fetched_at"), "fetched_at")
                freshness_at = _parse_evidence_timestamp(
                    cleaned.get("freshness_at", cleaned.get("fetched_at")),
                    "freshness_at",
                )
                observation_flags = [f"qc_invalid_values_removed:{flags}"] if flags else []
                ingestion_result = await self._ingestion.append_live(
                    "open-meteo-forecast",
                    cleaned,
                    retrieved_at=retrieved_at,
                    quality_flags=observation_flags,
                )
                if ingestion_result.state is not IngestionState.FRESH:
                    raise QualityControlError(
                        f"{region} observation evidence is {ingestion_result.state}: "
                        f"{ingestion_result.reason or 'archive rejected'}"
                    )
                observations[region] = cleaned
                result.quality_control_flags += flags
            result.data_latency_seconds = _data_latency_seconds(observations, started)

            result.stages.append("inference")
            prediction_date = started.date()
            run_version = os.getenv("MODEL_RUN_VERSION")
            manifest_version = os.getenv("DATA_MANIFEST_VERSION")
            calibration_version = os.getenv("CALIBRATION_VERSION")
            forecast_source = os.getenv("FORECAST_SOURCE_IDENTIFIER", "vayu-model-inference")
            for region in self._regions:
                observation = observations[region]
                retrieved_at = _parse_evidence_timestamp(observation.get("fetched_at"), "fetched_at")
                freshness_at = _parse_evidence_timestamp(
                    observation.get("freshness_at", observation.get("fetched_at")),
                    "freshness_at",
                )
                prediction_flags = [
                    f"input_qc_invalid_values_removed:{result.quality_control_flags}"
                ] if result.quality_control_flags else []
                for lead_day in range(1, 8):
                    target_date = prediction_date + timedelta(days=lead_day)
                    raw_cells = await self._inference(region, target_date, lead_day, observation)

                    result.stages.append("post_processing") if "post_processing" not in result.stages else None
                    grid_cells = post_process_grid_cells(raw_cells)

                    result.stages.append("storage") if "storage" not in result.stages else None
                    await self._db.archive_prediction(
                        cycle_id=result.cycle_id,
                        prediction_date=prediction_date,
                        target_date=target_date,
                        lead_day=lead_day,
                        region=region,
                        grid_cells=grid_cells,
                        source_identifier=forecast_source,
                        retrieved_at=retrieved_at,
                        freshness_at=freshness_at,
                        forecast_issue_time=started,
                        forecast_target_time=datetime(
                            target_date.year, target_date.month, target_date.day, tzinfo=UTC
                        ),
                        model_version=self._model_version,
                        run_version=run_version,
                        manifest_version=manifest_version,
                        calibration_version=calibration_version,
                        quality_flags=prediction_flags,
                    )
                    await self._cache.set(
                        f"predict:{target_date}:{region}:day{lead_day}",
                        {
                            "request_date": str(target_date),
                            "lead_times": list(range(1, 8)),
                            "grid_cells": grid_cells,
                            "model_version": self._model_version,
                            "input_data_timestamp": started.isoformat(),
                            "cached": False,
                        },
                        ttl=24 * 60 * 60,
                    )
                    result.predictions_archived += 1
                result.regions_processed.append(region)

            result.status = "healthy"
            result.completed_at = datetime.now(UTC).isoformat()
            await self._persist_status(result)
            logger.info(
                "Operational cycle completed: cycle=%s forecasts=%d regions=%s",
                result.cycle_id,
                result.predictions_archived,
                result.regions_processed,
            )
            return result
        except Exception as exc:
            result.status = "failed"
            result.error = str(exc)
            result.completed_at = datetime.now(UTC).isoformat()
            await self._persist_status(result)
            raise

    async def _download_observations(self) -> dict[str, dict[str, Any]]:
        """Download Open-Meteo observations using the existing ingestion client."""
        pipeline = DataPipeline(cache=self._cache, regions=self._regions)
        async with httpx.AsyncClient(timeout=pipeline._http_timeout) as client:
            pipeline._http = client
            pairs = await asyncio.gather(
                *(pipeline._fetch_observations(region) for region in self._regions)
            )
        return {region: observation for region, (observation, _stale) in zip(self._regions, pairs)}

    async def _production_inference(
        self,
        region: str,
        target_date: date,
        lead_day: int,
        _: dict[str, Any],
    ) -> list[Any]:
        """Run the same VAYU model path used by the public prediction endpoint."""
        from backend import main as api

        if not getattr(api, "_model_checkpoint_loaded", False):
            raise QualityControlError(
                "a trained model checkpoint was not loaded; refusing to archive random-model forecasts"
            )
        cells = api._get_real_predictions(target_date, region, lead_day)
        if cells is None:
            raise QualityControlError(
                "real VAYU inference is unavailable; refusing to archive mock or simulated forecasts"
            )
        return cells

    async def _persist_status(self, result: OperationalCycleResult) -> None:
        payload = result.to_dict()
        await self._cache.set(OPERATIONAL_STATUS_CACHE_KEY, payload, ttl=STATUS_CACHE_TTL_SECONDS)
        await self._db.record_operational_cycle_run(payload)

    def _failure_result(self, error: Exception) -> OperationalCycleResult:
        now = datetime.now(UTC).isoformat()
        return OperationalCycleResult(
            cycle_id=str(uuid.uuid4()),
            started_at=now,
            completed_at=now,
            status="failed",
            model_version=self._model_version,
            error=str(error),
        )


def _parse_evidence_timestamp(value: Any, field_name: str) -> datetime:
    """Parse a source-supplied provenance time or fail the production cycle."""
    if not isinstance(value, str):
        raise QualityControlError(f"observation {field_name} is missing")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise QualityControlError(f"observation {field_name} is invalid: {value!r}") from exc
    if parsed.tzinfo is None:
        raise QualityControlError(f"observation {field_name} must include a timezone")
    return parsed.astimezone(UTC)


def _data_latency_seconds(observations: dict[str, dict[str, Any]], now: datetime) -> float | None:
    timestamps: list[datetime] = []
    for observation in observations.values():
        raw_timestamp = observation.get("fetched_at")
        if not isinstance(raw_timestamp, str):
            continue
        try:
            timestamp = datetime.fromisoformat(raw_timestamp.replace("Z", "+00:00"))
            timestamps.append(timestamp if timestamp.tzinfo else timestamp.replace(tzinfo=UTC))
        except ValueError:
            logger.warning("Ignoring invalid observation timestamp: %r", raw_timestamp)
    if not timestamps:
        return None
    return max(0.0, round((now - min(timestamps)).total_seconds(), 3))


async def get_operational_status(
    cache: CacheClient | None,
    db: DatabaseClient | None,
    model_version: str,
) -> dict[str, Any]:
    """Return a durable monitoring status, preferring the most recent cache value."""
    payload = await cache.get(OPERATIONAL_STATUS_CACHE_KEY) if cache else None
    if not payload and db:
        payload = await db.get_latest_operational_cycle_run()
    payload = payload or {}
    return {
        "last_prediction_time": payload.get("completed_at"),
        "model_version": payload.get("model_version", model_version),
        "data_latency_seconds": payload.get("data_latency_seconds"),
        "system_health": payload.get("status", "unknown"),
        "last_cycle_id": payload.get("cycle_id"),
        "predictions_archived": payload.get("predictions_archived", 0),
        "error": payload.get("error"),
    }


async def run_scheduled_cycle() -> None:
    """CLI entry point used by the scheduled ECS Fargate task."""
    from ai_engine.climate_model import VayuClimateModel
    from ai_engine.config import ModelConfig
    from backend import main as api

    cache = CacheClient(url=os.getenv("REDIS_URL", "redis://localhost:6379"))
    db = DatabaseClient(url=os.getenv("DATABASE_URL", "postgresql://vayu:vayu_dev@localhost:5432/vayu_climate"))
    await cache.connect()
    await db.connect()
    try:
        model_path = os.getenv("MODEL_PATH", "/app/checkpoints/vayu_best.pt")
        if os.path.exists(model_path):
            api._model = VayuClimateModel.load(model_path, device="cuda" if api.torch.cuda.is_available() else "cpu")
            api._model_checkpoint_loaded = True
        else:
            api._model = VayuClimateModel(ModelConfig())
            api._model.eval()
            api._model_checkpoint_loaded = False
        cycle = DailyPredictionCycle(cache, db)
        await cycle.run_with_retry()
    finally:
        await cache.close()
        await db.close()


def main() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    asyncio.run(run_scheduled_cycle())


if __name__ == "__main__":
    main()

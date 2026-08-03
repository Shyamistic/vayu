"""Unit tests for the real-time data pipeline (Task 17.4).

Tests cover:
  - Graceful fallback to cached observations when Open-Meteo is unavailable
  - Correct stale-flagging in pipeline results
  - Observation aggregation across multiple grid points
  - Redis pub/sub event publishing
  - Pipeline result structure

Requirements validated: 73.1, 73.2, 73.3, 73.4, 73.5
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import numpy as np


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

def make_mock_cache(store: dict | None = None) -> MagicMock:
    """Return a mock CacheClient that uses an in-memory dict as backing store."""
    store = store if store is not None else {}
    cache = MagicMock()
    cache.url = "redis://localhost:6379"
    cache._client = MagicMock()  # simulate connected Redis

    async def _get(key: str) -> Any | None:
        return store.get(key)

    async def _set(key: str, value: Any, ttl: int = 3600) -> bool:
        store[key] = value
        return True

    async def _delete(key: str) -> None:
        store.pop(key, None)

    cache.get = _get
    cache.set = _set
    cache.delete = _delete

    # publish on the underlying redis client
    cache._client.publish = AsyncMock(return_value=1)

    return cache


def sample_openmeteo_response(lat: float = 12.5, lon: float = 75.5) -> dict:
    """Return a minimal Open-Meteo API response for one grid point."""
    return {
        "latitude": lat,
        "longitude": lon,
        "hourly": {
            "time": [f"2025-07-15T{h:02d}:00" for h in range(24)],
            "temperature_2m": [28.0 + i * 0.1 for i in range(24)],
            "relative_humidity_2m": [75.0] * 24,
            "precipitation": [0.1] * 24,
            "wind_speed_10m": [3.5] * 24,
            "wind_direction_10m": [220.0] * 24,
            "surface_pressure": [1008.0] * 24,
            "cloud_cover": [60.0] * 24,
            "apparent_temperature": [30.0] * 24,
        },
    }


# ---------------------------------------------------------------------------
# DataPipeline unit tests
# ---------------------------------------------------------------------------

from backend.pipeline import (
    DataPipeline,
    PREDICTION_UPDATED_CHANNEL,
    REGION_GRID_POINTS,
)


class TestObservationAggregation:
    """Tests for _aggregate_point_observations."""

    def setup_method(self):
        self.cache = make_mock_cache()
        self.pipeline = DataPipeline(cache=self.cache, regions=["pilot"])

    def _make_point(self, temp_offset: float = 0.0) -> dict:
        return {
            "lat": 12.5,
            "lon": 75.5,
            "fetched_at": datetime.now(UTC).isoformat(),
            "hourly": {
                "temperature_2m": [28.0 + temp_offset] * 24,
                "relative_humidity_2m": [75.0] * 24,
                "precipitation": [0.5] * 24,
                "wind_speed_10m": [3.0] * 24,
                "wind_direction_10m": [180.0] * 24,
                "surface_pressure": [1010.0] * 24,
                "cloud_cover": [50.0] * 24,
                "apparent_temperature": [30.0 + temp_offset] * 24,
            },
        }

    def test_daily_summary_temp_max_min(self):
        """Daily summary should capture max and min from hourly temperature."""
        # Two points with different offsets
        points = [self._make_point(0.0), self._make_point(2.0)]
        result = self.pipeline._aggregate_point_observations("pilot", points)

        assert result["daily_summary"]["temp_max_c"] is not None
        assert result["daily_summary"]["temp_min_c"] is not None
        # Mean of (28.0 and 30.0) = 29.0, so max should be 29.0 across 24 identical hours
        assert abs(result["daily_summary"]["temp_mean_c"] - 29.0) < 0.1

    def test_precipitation_sum(self):
        """Precipitation sum should be sum across 24 hours."""
        points = [self._make_point()]
        result = self.pipeline._aggregate_point_observations("pilot", points)
        # 0.5 mm/hr × 24 hrs = 12.0 mm
        assert abs(result["daily_summary"]["precipitation_sum_mm"] - 12.0) < 0.1

    def test_region_and_num_points_recorded(self):
        """Aggregated result should record region id and point count."""
        points = [self._make_point(), self._make_point(), self._make_point()]
        result = self.pipeline._aggregate_point_observations("north_east_india", points)
        assert result["region"] == "north_east_india"
        assert result["num_points"] == 3
        assert result["stale"] is False

    def test_single_point_aggregation(self):
        """Aggregation over one point should be identical to that point's values."""
        points = [self._make_point(0.0)]
        result = self.pipeline._aggregate_point_observations("pilot", points)
        assert result["hourly"]["temperature_2m"] is not None
        assert len(result["hourly"]["temperature_2m"]) == 24


class TestFallbackBehavior:
    """Tests for graceful fallback when Open-Meteo is unavailable (Req 73.5)."""

    def test_fallback_returns_stale_flag(self):
        """_build_fallback_observations must mark stale=True."""
        cache = make_mock_cache()
        pipeline = DataPipeline(cache=cache, regions=["pilot"])
        fallback = pipeline._build_fallback_observations("pilot")

        assert fallback["stale"] is True
        assert "stale_reason" in fallback

    def test_fallback_contains_climatological_values(self):
        """Fallback must provide plausible climatological values, not zeros."""
        cache = make_mock_cache()
        pipeline = DataPipeline(cache=cache, regions=["pilot"])
        fallback = pipeline._build_fallback_observations("central_india")

        summary = fallback["daily_summary"]
        assert summary["temp_max_c"] > 0
        assert summary["temp_min_c"] > 0
        assert summary["precipitation_sum_mm"] >= 0

    @pytest.mark.asyncio
    async def test_fetch_observations_uses_cache_when_openmeteo_fails(self):
        """When all grid point fetches fail, cached data should be returned as stale."""
        cached_obs = {
            "region": "pilot",
            "fetched_at": "2025-07-15T09:00:00+00:00",
            "stale": False,
            "num_points": 3,
            "hourly": {"temperature_2m": [30.0] * 24},
            "daily_summary": {"temp_max_c": 33.0, "temp_min_c": 24.0, "precipitation_sum_mm": 8.0},
        }
        store = {"observations:pilot": cached_obs}
        cache = make_mock_cache(store)
        pipeline = DataPipeline(cache=cache, regions=["pilot"])

        # Patch _fetch_single_point to always return None (simulating failure)
        async def _always_fail(lat, lon):
            return None

        pipeline._fetch_single_point = _always_fail

        obs, is_stale = await pipeline._fetch_observations("pilot")

        assert is_stale is True
        assert obs.get("stale") is True
        # Original observation data should still be returned
        assert obs.get("daily_summary", {}).get("temp_max_c") == 33.0

    @pytest.mark.asyncio
    async def test_fetch_observations_returns_fresh_on_success(self):
        """When Open-Meteo returns data, stale flag must be False."""
        cache = make_mock_cache()
        pipeline = DataPipeline(cache=cache, regions=["pilot"])
        pipeline._http = MagicMock()  # prevent real HTTP

        # Patch _fetch_single_point to return a valid observation
        async def _mock_fetch(lat, lon):
            return {
                "lat": lat, "lon": lon,
                "fetched_at": datetime.now(UTC).isoformat(),
                "hourly": {
                    "temperature_2m": [30.0] * 24,
                    "relative_humidity_2m": [70.0] * 24,
                    "precipitation": [0.2] * 24,
                    "wind_speed_10m": [4.0] * 24,
                    "wind_direction_10m": [200.0] * 24,
                    "surface_pressure": [1005.0] * 24,
                    "cloud_cover": [40.0] * 24,
                    "apparent_temperature": [32.0] * 24,
                },
            }

        pipeline._fetch_single_point = _mock_fetch

        obs, is_stale = await pipeline._fetch_observations("pilot")

        assert is_stale is False
        assert obs.get("stale") is False
        assert obs["region"] == "pilot"

    @pytest.mark.asyncio
    async def test_no_cache_no_openmeteo_returns_climatological_fallback(self):
        """When both cache and Open-Meteo fail, a non-null climatological fallback is returned."""
        cache = make_mock_cache()  # empty store — no cache
        pipeline = DataPipeline(cache=cache, regions=["pilot"])

        async def _always_fail(lat, lon):
            return None

        pipeline._fetch_single_point = _always_fail

        obs, is_stale = await pipeline._fetch_observations("pilot")

        assert is_stale is True
        assert obs is not None
        assert "daily_summary" in obs
        assert obs["daily_summary"]["temp_max_c"] > 0


class TestPubSubPublishing:
    """Tests for Redis pub/sub event publishing (Req 73.3)."""

    @pytest.mark.asyncio
    async def test_publish_sends_prediction_updated_event(self):
        """_publish_update_event must call Redis publish with the correct channel."""
        cache = make_mock_cache()
        pipeline = DataPipeline(cache=cache, regions=["pilot"])

        from backend.pipeline import PipelineResult
        result = PipelineResult()
        result.regions_updated = ["pilot"]
        result.regions_stale = []
        result.predictions_stored = 7

        published = await pipeline._publish_update_event(result)

        assert published is True
        # Verify Redis publish was called with the right channel
        cache._client.publish.assert_awaited_once()
        channel_arg = cache._client.publish.call_args[0][0]
        assert channel_arg == PREDICTION_UPDATED_CHANNEL

    @pytest.mark.asyncio
    async def test_publish_event_payload_contains_required_fields(self):
        """The published JSON payload must contain event, timestamp, and region lists."""
        cache = make_mock_cache()
        pipeline = DataPipeline(cache=cache, regions=["pilot"])

        from backend.pipeline import PipelineResult
        result = PipelineResult()
        result.regions_updated = ["pilot", "western_ghats"]
        result.regions_stale = ["north_east_india"]
        result.predictions_stored = 14

        await pipeline._publish_update_event(result)

        # Extract the JSON payload passed to publish
        payload_str = cache._client.publish.call_args[0][1]
        payload = json.loads(payload_str)

        assert payload["event"] == "prediction_updated"
        assert "timestamp" in payload
        assert "regions_updated" in payload
        assert "regions_stale" in payload
        assert "predictions_stored" in payload
        assert isinstance(payload["freshness_sla_met"], bool)

    @pytest.mark.asyncio
    async def test_publish_graceful_when_redis_unavailable(self):
        """publish should return False without raising when Redis is disconnected."""
        cache = make_mock_cache()
        cache._client = None  # Simulate disconnected Redis

        pipeline = DataPipeline(cache=cache, regions=["pilot"])

        from backend.pipeline import PipelineResult
        result = PipelineResult()
        result.regions_updated = ["pilot"]

        published = await pipeline._publish_update_event(result)

        # Must not raise — just return False
        assert published is False

    @pytest.mark.asyncio
    async def test_publish_records_error_on_redis_exception(self):
        """If Redis.publish raises, the error should be recorded in result.errors."""
        cache = make_mock_cache()
        cache._client.publish = AsyncMock(side_effect=RuntimeError("connection reset"))

        pipeline = DataPipeline(cache=cache, regions=["pilot"])

        from backend.pipeline import PipelineResult
        result = PipelineResult()
        result.regions_updated = ["pilot"]

        published = await pipeline._publish_update_event(result)

        assert published is False
        assert any("redis_publish_failed" in e for e in result.errors)


class TestPipelineRunOnce:
    """Integration-style tests for the full run_once() cycle."""

    @pytest.mark.asyncio
    async def test_run_once_returns_pipeline_result(self):
        """run_once() must complete and return a PipelineResult with required fields."""
        cache = make_mock_cache()
        pipeline = DataPipeline(cache=cache, regions=["pilot"])
        pipeline._http = MagicMock()

        async def _mock_fetch(lat, lon):
            return {
                "lat": lat, "lon": lon,
                "fetched_at": datetime.now(UTC).isoformat(),
                "hourly": {
                    "temperature_2m": [30.0] * 24,
                    "relative_humidity_2m": [70.0] * 24,
                    "precipitation": [0.1] * 24,
                    "wind_speed_10m": [3.0] * 24,
                    "wind_direction_10m": [180.0] * 24,
                    "surface_pressure": [1008.0] * 24,
                    "cloud_cover": [55.0] * 24,
                    "apparent_temperature": [31.0] * 24,
                },
            }

        pipeline._fetch_single_point = _mock_fetch

        result = await pipeline.run_once()

        assert result is not None
        assert isinstance(result.ran_at, str)
        assert isinstance(result.regions_updated, list)
        assert isinstance(result.regions_stale, list)
        assert isinstance(result.predictions_stored, int)
        assert isinstance(result.event_published, bool)
        assert isinstance(result.errors, list)

    @pytest.mark.asyncio
    async def test_run_once_stores_last_run_in_cache(self):
        """After run_once(), pipeline:last_run key should exist in cache."""
        store: dict = {}
        cache = make_mock_cache(store)
        pipeline = DataPipeline(cache=cache, regions=["pilot"])
        pipeline._http = MagicMock()

        async def _mock_fetch(lat, lon):
            return None  # force stale path

        pipeline._fetch_single_point = _mock_fetch

        await pipeline.run_once()

        assert "pipeline:last_run" in store

    @pytest.mark.asyncio
    async def test_run_once_predictions_stored_matches_lead_days(self):
        """For one region, exactly 7 prediction metadata entries should be stored."""
        store: dict = {}
        cache = make_mock_cache(store)
        pipeline = DataPipeline(cache=cache, regions=["pilot"])
        pipeline._http = MagicMock()

        async def _mock_fetch(lat, lon):
            return {
                "lat": lat, "lon": lon,
                "fetched_at": datetime.now(UTC).isoformat(),
                "hourly": {
                    "temperature_2m": [30.0] * 24,
                    "relative_humidity_2m": [70.0] * 24,
                    "precipitation": [0.1] * 24,
                    "wind_speed_10m": [3.0] * 24,
                    "wind_direction_10m": [180.0] * 24,
                    "surface_pressure": [1008.0] * 24,
                    "cloud_cover": [55.0] * 24,
                    "apparent_temperature": [31.0] * 24,
                },
            }

        pipeline._fetch_single_point = _mock_fetch

        result = await pipeline.run_once()

        # 7 lead days × 1 region = 7 predictions stored (metadata entries)
        assert result.predictions_stored == 7

    @pytest.mark.asyncio
    async def test_stale_regions_on_full_failure(self):
        """When all fetches fail, the region should appear in regions_stale."""
        cache = make_mock_cache()
        pipeline = DataPipeline(cache=cache, regions=["central_india"])
        pipeline._http = MagicMock()

        async def _always_fail(lat, lon):
            return None

        pipeline._fetch_single_point = _always_fail

        result = await pipeline.run_once()

        assert "central_india" in result.regions_stale
        assert "central_india" not in result.regions_updated


class TestRegionGridPoints:
    """Sanity checks on the region → grid point configuration."""

    def test_all_five_regions_defined(self):
        """All five VAYU regions must have at least one grid point."""
        expected = {
            "pilot", "western_ghats", "north_east_india",
            "indo_gangetic_plain", "central_india",
        }
        assert expected.issubset(set(REGION_GRID_POINTS.keys()))

    def test_grid_points_are_valid_india_coordinates(self):
        """All grid points must be within Indian geographic bounds."""
        for region_id, points in REGION_GRID_POINTS.items():
            for lat, lon in points:
                assert 6.0 <= lat <= 38.0, f"{region_id}: lat {lat} out of range"
                assert 66.0 <= lon <= 100.0, f"{region_id}: lon {lon} out of range"

    def test_each_region_has_at_least_one_point(self):
        """Each region must have ≥1 representative grid point."""
        for region_id, points in REGION_GRID_POINTS.items():
            assert len(points) >= 1, f"{region_id} has no grid points"

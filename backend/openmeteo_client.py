"""Open-Meteo API client for VAYU backend.

Open-Meteo is a free weather API (no API key required for non-commercial use
under 10,000 daily calls). It aggregates multiple NWP models including
ECMWF IFS and provides ERA5 reanalysis.

Use cases in VAYU:
  1. NWP baseline: ECMWF 7-day forecast for the Western Ghats region
     → Powers NWPComparisonPanel on the frontend
  2. CAPE feature: Convective Available Potential Energy — best predictor
     of deep convective rainfall (orographic thunderstorms over WG)
  3. ERA5 historical archive: for Aurora bias correction integration
  4. Live current weather: for frontend AQI/weather overlays

API docs: https://open-meteo.com/en/docs
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Base URLs (all free, no API key)
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL  = "https://archive-api.open-meteo.com/v1/archive"

# Representative grid point for Western Ghats (~Mysuru–Coorg corridor)
WG_LAT = 12.5
WG_LON = 75.5


class OpenMeteoClient:
    """Async HTTP client for Open-Meteo APIs."""

    def __init__(self, timeout: float = 10.0):
        self._client = httpx.AsyncClient(timeout=timeout)

    async def close(self):
        await self._client.aclose()

    # ── NWP baseline (ECMWF IFS) ─────────────────────────────────────────────

    async def get_ecmwf_forecast(
        self,
        lat: float = WG_LAT,
        lon: float = WG_LON,
        forecast_days: int = 7,
    ) -> dict[str, Any]:
        """Fetch ECMWF IFS 7-day daily forecast for a WG grid point.

        Returns daily: precipitation_sum, temperature_2m_max/min, cape_max.
        Used by NWPComparisonPanel to show ECMWF skill vs VAYU.
        """
        params = {
            "latitude": lat,
            "longitude": lon,
            "daily": ",".join([
                "precipitation_sum",
                "temperature_2m_max",
                "temperature_2m_min",
                "precipitation_probability_max",
                "wind_speed_10m_max",
            ]),
            "hourly": "cape",     # Convective Available Potential Energy
            "forecast_days": forecast_days,
            "models": "ecmwf_ifs025",   # ECMWF IFS at 0.25°
            "timezone": "Asia/Kolkata",
        }
        try:
            r = await self._client.get(FORECAST_URL, params=params)
            r.raise_for_status()
            data = r.json()
            return self._parse_ecmwf_response(data)
        except Exception as e:
            logger.warning("Open-Meteo ECMWF fetch failed: %s — returning empty", e)
            return {"error": str(e), "daily": {}, "hourly": {}}

    def _parse_ecmwf_response(self, raw: dict) -> dict[str, Any]:
        """Normalize the Open-Meteo response."""
        daily  = raw.get("daily", {})
        hourly = raw.get("hourly", {})
        times  = daily.get("time", [])

        # Daily aggregates
        parsed_daily = {
            "time": times,
            "precipitation_mm": daily.get("precipitation_sum", []),
            "temp_max_c": daily.get("temperature_2m_max", []),
            "temp_min_c": daily.get("temperature_2m_min", []),
            "precip_prob_pct": daily.get("precipitation_probability_max", []),
            "wind_speed_kmh": daily.get("wind_speed_10m_max", []),
        }

        # Mean daily CAPE from hourly (24 values per day → daily mean)
        cape_h = hourly.get("cape", [])
        if cape_h:
            daily_cape = []
            for i in range(0, min(len(cape_h), len(times) * 24), 24):
                slice_vals = [v for v in cape_h[i:i+24] if v is not None]
                daily_cape.append(max(slice_vals) if slice_vals else 0.0)
            parsed_daily["cape_max_jkg"] = daily_cape

        return {
            "model": "ecmwf_ifs025",
            "latitude": raw.get("latitude"),
            "longitude": raw.get("longitude"),
            "daily": parsed_daily,
            "forecast_days": len(times),
        }

    # ── Multi-model comparison ────────────────────────────────────────────────

    async def get_multi_model_forecast(
        self,
        lat: float = WG_LAT,
        lon: float = WG_LON,
        forecast_days: int = 7,
    ) -> dict[str, Any]:
        """Fetch daily precipitation forecasts from multiple NWP models.

        Returns a dict keyed by model name with 7-day precipitation arrays.
        Used to benchmark VAYU against ECMWF, GFS, ICON, etc.
        """
        models = {
            "ecmwf_ifs": "ecmwf_ifs025",
            "gfs":        "gfs_seamless",
            "icon":       "icon_seamless",
            "gem":        "gem_seamless",
        }

        results: dict[str, Any] = {}
        tasks = []

        async def _fetch(model_key: str, model_id: str):
            params = {
                "latitude": lat,
                "longitude": lon,
                "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min",
                "forecast_days": forecast_days,
                "models": model_id,
                "timezone": "Asia/Kolkata",
            }
            try:
                r = await self._client.get(FORECAST_URL, params=params)
                r.raise_for_status()
                data = r.json()
                daily = data.get("daily", {})
                results[model_key] = {
                    "precipitation_mm": daily.get("precipitation_sum", []),
                    "temp_max_c":       daily.get("temperature_2m_max", []),
                    "temp_min_c":       daily.get("temperature_2m_min", []),
                    "time":             daily.get("time", []),
                }
            except Exception as e:
                logger.debug("Model %s fetch failed: %s", model_key, e)
                results[model_key] = {"error": str(e)}

        await asyncio.gather(*[_fetch(k, v) for k, v in models.items()])
        return results

    # ── ERA5 historical archive ───────────────────────────────────────────────

    async def get_era5_history(
        self,
        lat: float = WG_LAT,
        lon: float = WG_LON,
        start: str = "2024-01-01",
        end: str | None = None,
    ) -> dict[str, Any]:
        """Fetch ERA5 reanalysis historical data.

        Returns daily precipitation and temperature for a date range.
        Used as additional training data and for Aurora integration.
        Free via Open-Meteo archive API (no key, ERA5 backend).
        """
        if end is None:
            end = (date.today() - timedelta(days=5)).isoformat()  # ERA5 ~5 day lag

        params = {
            "latitude": lat,
            "longitude": lon,
            "start_date": start,
            "end_date": end,
            "daily": ",".join([
                "precipitation_sum",
                "temperature_2m_max",
                "temperature_2m_min",
                "wind_speed_10m_max",
                "shortwave_radiation_sum",
            ]),
            "timezone": "Asia/Kolkata",
        }
        try:
            r = await self._client.get(ARCHIVE_URL, params=params)
            r.raise_for_status()
            data = r.json()
            daily = data.get("daily", {})
            return {
                "source": "era5_open_meteo",
                "latitude": lat,
                "longitude": lon,
                "start_date": start,
                "end_date": end,
                "daily": {
                    "time":               daily.get("time", []),
                    "precipitation_mm":   daily.get("precipitation_sum", []),
                    "temp_max_c":         daily.get("temperature_2m_max", []),
                    "temp_min_c":         daily.get("temperature_2m_min", []),
                    "wind_speed_kmh":     daily.get("wind_speed_10m_max", []),
                    "radiation_mj_m2":    daily.get("shortwave_radiation_sum", []),
                },
            }
        except Exception as e:
            logger.warning("Open-Meteo ERA5 archive fetch failed: %s", e)
            return {"error": str(e), "daily": {}}


# Module-level singleton (initialized by backend lifespan)
_openmeteo: OpenMeteoClient | None = None


def get_openmeteo() -> OpenMeteoClient:
    global _openmeteo
    if _openmeteo is None:
        _openmeteo = OpenMeteoClient()
    return _openmeteo

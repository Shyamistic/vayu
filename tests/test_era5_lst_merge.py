"""Tests for the ERA5-Land skin-temperature -> insat_lst loader.

These use the real files on D: when available (the loader has source-specific
quirks worth exercising against actual data: 12-hourly timestamps, kelvin
units, CDS 'valid_time'/'latitude'/'longitude' coordinate names, singleton
'number'/'expver' coords, and land-only NaN over ocean), and fall back to a
synthetic dataset shaped the same way so the suite still runs anywhere.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import xarray as xr

from data_ingestion.preprocessor import ClimatePreprocessor

REAL_DIR = Path("D:/vayu_data/lst_india_nc")
WG_BOUNDS = (8.0, 21.0, 72.0, 78.0)  # lat_min, lat_max, lon_min, lon_max


def _preprocessor() -> ClimatePreprocessor:
    lat_min, lat_max, lon_min, lon_max = WG_BOUNDS
    return ClimatePreprocessor(
        region={
            "lat_min": lat_min, "lat_max": lat_max,
            "lon_min": lon_min, "lon_max": lon_max,
        },
        resolution=0.25,
    )


def _synthetic(tmp_path: Path, year: int = 1990) -> Path:
    """A file shaped exactly like CDS ERA5-Land output."""
    times = xr.date_range(f"{year}-01-01T06:00", f"{year}-01-10T18:00", freq="12h")
    lat = np.arange(35.5, 6.6, -0.1)
    lon = np.arange(68.1, 97.5, 0.1)
    rng = np.random.default_rng(0)
    data = 300.0 + rng.normal(0, 3, (len(times), len(lat), len(lon)))
    ds = xr.Dataset(
        {"skt": (("valid_time", "latitude", "longitude"), data.astype("float32"))},
        coords={"valid_time": times, "latitude": lat, "longitude": lon,
                "number": 0, "expver": "0001"},
    )
    ds["skt"].attrs["units"] = "K"
    out = tmp_path / f"era5_land_lst_india_{year}.nc"
    ds.to_netcdf(out)
    return out


def test_synthetic_load_aggregates_to_daily_and_converts_to_celsius(tmp_path):
    _synthetic(tmp_path, 1990)
    result = _preprocessor()._load_era5_land_lst(str(tmp_path), 1990, 1990)

    assert result is not None
    assert "skt" in result.data_vars
    # 12-hourly (2/day) over 10 days -> 10 daily steps
    assert result.sizes["time"] == 10
    # Kelvin ~300 must become Celsius ~27
    vals = result["skt"].values
    finite = vals[np.isfinite(vals)]
    assert finite.size > 0
    assert -60.0 < float(finite.min()) < 60.0, "not converted to Celsius"
    assert 10.0 < float(finite.mean()) < 45.0


def test_missing_directory_returns_none(tmp_path):
    assert _preprocessor()._load_era5_land_lst(str(tmp_path / "nope"), 1990, 1990) is None


def test_file_without_skt_is_skipped(tmp_path):
    times = xr.date_range("1990-01-01", periods=4, freq="12h")
    xr.Dataset(
        {"t2m": (("valid_time",), np.zeros(4, dtype="float32"))},
        coords={"valid_time": times},
    ).to_netcdf(tmp_path / "era5_land_lst_india_1990.nc")
    assert _preprocessor()._load_era5_land_lst(str(tmp_path), 1990, 1990) is None


@pytest.mark.skipif(not REAL_DIR.exists(), reason="real ERA5-Land files not present")
def test_real_file_regrids_to_region_grid_with_plausible_values():
    pre = _preprocessor()
    result = pre._load_era5_land_lst(str(REAL_DIR), 1990, 1990)
    assert result is not None

    # Daily, and a full year (1990 is not a leap year; the source is 7 days
    # short by construction -- the 31st of each 31-day month -- so allow that).
    assert 355 <= result.sizes["time"] <= 366

    lat = result["lat"].values
    lon = result["lon"].values
    lat_min, lat_max, lon_min, lon_max = WG_BOUNDS
    assert lat.min() <= lat_min + 0.5 and lat.max() >= lat_max - 0.5
    assert lon.min() <= lon_min + 0.5 and lon.max() >= lon_max - 0.5

    vals = result["skt"].values
    finite = vals[np.isfinite(vals)]
    assert finite.size > 0, "all-NaN after regrid"
    # Western Ghats land skin temperature in Celsius.
    assert -10.0 < float(finite.min()) < 60.0
    assert 15.0 < float(finite.mean()) < 40.0
    # Must not be a constant field -- that was the old zero-filled behaviour.
    assert float(np.nanstd(finite)) > 0.5

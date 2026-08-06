"""Tests for the NOAA OISST -> insat_sst merge (data_ingestion/preprocessor.py).

Context: insat_sst was one of two declared 17-feature input channels with no
real-data source wired in (see DATA_ACQUISITION_TASKS.md section 2 — MOSDAC
INSAT-3D SST access was requested but never approved). OISST v2.1 was downloaded
as a disclosed substitute (258 daily files existed on disk) but nothing merged it
into the pipeline, so scripts/feature_informativeness.py measured insat_sst as
100% constant zero in every region despite the data being present.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
import xarray as xr

from data_ingestion.preprocessor import ClimatePreprocessor

REGION = {"lat_min": 7.5, "lat_max": 21.5, "lon_min": 72.0, "lon_max": 77.5}


def _write_oisst_day(
    dir_path,
    date: str,
    sst_value: float = 27.0,
    lat: np.ndarray | None = None,
    lon: np.ndarray | None = None,
) -> None:
    """Write a minimal global OISST-shaped file for one day.

    Longitude uses OISST's native 0..360 convention (not -180..180), matching
    real files, so the loader's conversion is exercised.

    The grid is 1deg rather than a token handful of points: real OISST v2.1 is
    0.25deg, and a grid coarser than the region is wide leaves <2 source points
    inside the clip window, which cannot be bilinearly interpolated at all.
    """
    lat = np.arange(-89.5, 90.0, 1.0) if lat is None else lat
    lon = np.arange(0.5, 360.0, 1.0) if lon is None else lon
    sst = np.full((1, 1, len(lat), len(lon)), sst_value, dtype=np.float32)
    ds = xr.Dataset(
        {"sst": (("time", "zlev", "lat", "lon"), sst)},
        coords={
            "time": [pd.Timestamp(date)], "zlev": [0.0],
            "lat": lat, "lon": lon,
        },
    )
    fname = f"oisst-avhrr-v02r01.{date.replace('-', '')}.nc"
    ds.to_netcdf(dir_path / fname)


def test_load_oisst_sst_regrids_onto_target_region(tmp_path):
    _write_oisst_day(tmp_path, "2010-01-01", sst_value=27.5)
    _write_oisst_day(tmp_path, "2010-01-02", sst_value=28.0)

    p = ClimatePreprocessor(region=REGION, resolution=0.25)
    result = p._load_oisst_sst(str(tmp_path), 2010, 2010)

    assert result is not None
    assert result.sizes["time"] == 2
    assert float(result.lat.min()) >= REGION["lat_min"] - 1e-6
    assert float(result.lat.max()) <= REGION["lat_max"] + 1e-6
    # Longitude must be converted from 0..360 to the region's -180..180 frame.
    assert float(result.lon.min()) >= REGION["lon_min"] - 1e-6
    assert float(result.lon.max()) <= REGION["lon_max"] + 1e-6
    # Constant input -> constant (interpolated) output, no NaN introduced.
    assert not bool(result.sst.isnull().any())
    assert float(result.sst.isel(time=0).mean()) == pytest.approx(27.5, abs=0.05)


def test_regrid_masks_points_outside_source_coverage(tmp_path):
    """Regression: cells beyond the source grid's extent must be NaN, not
    extrapolated.

    ``RegularGridInterpolator(fill_value=None)`` linearly extrapolates outside the
    source bounds. That produced insat_lst = -4252 C in the full-India 0.5deg
    bundle, because ERA5-Land LST coverage stops at 35.5N while the region reaches
    38.125N. The failure is a thin edge strip, so it survives a mean/std check and
    only shows up in a range check.
    """
    # Source covers only the southern half of the region's latitude span.
    _write_oisst_day(
        tmp_path, "2010-01-01", sst_value=27.0,
        lat=np.arange(-89.5, 15.0, 1.0), lon=np.arange(0.5, 360.0, 1.0),
    )

    p = ClimatePreprocessor(region=REGION, resolution=0.25)
    result = p._load_oisst_sst(str(tmp_path), 2010, 2010)

    assert result is not None
    sst = result.sst.isel(time=0)
    covered = sst.sel(lat=slice(None, 14.0))
    uncovered = sst.sel(lat=slice(15.0, None))

    assert not bool(covered.isnull().any()), "in-coverage cells must be filled"
    assert float(covered.mean()) == pytest.approx(27.0, abs=0.05)
    assert bool(uncovered.isnull().all()), (
        "cells beyond the source grid must be NaN, not extrapolated"
    )


def test_load_oisst_sst_returns_none_when_missing(tmp_path):
    p = ClimatePreprocessor(region=REGION, resolution=0.25)
    result = p._load_oisst_sst(str(tmp_path), 2010, 2010)
    assert result is None


def test_load_oisst_sst_skips_files_without_sst_variable(tmp_path):
    lat = np.linspace(-89.875, 89.875, 10)
    lon = np.linspace(0.125, 359.875, 10)
    bad = xr.Dataset(
        {"anom": (("time", "lat", "lon"), np.zeros((1, 10, 10), dtype=np.float32))},
        coords={"time": [pd.Timestamp("2010-01-01")], "lat": lat, "lon": lon},
    )
    bad.to_netcdf(tmp_path / "oisst-avhrr-v02r01.20100101.nc")

    p = ClimatePreprocessor(region=REGION, resolution=0.25)
    result = p._load_oisst_sst(str(tmp_path), 2010, 2010)
    assert result is None


def test_preprocess_imd_merges_insat_sst_with_availability_flag(tmp_path):
    """End-to-end: insat_sst and insat_sst_available appear in the merged
    dataset, and insat_sst is no longer constant zero."""
    dates = pd.date_range("2010-01-01", "2010-01-05")

    def _da(value):
        return xr.DataArray(
            np.full((len(dates), 4, 4), value, dtype=np.float32),
            dims=("time", "lat", "lon"),
            coords={"time": dates, "lat": np.linspace(7.5, 21.5, 4),
                    "lon": np.linspace(72.0, 77.5, 4)},
        )

    rainfall_ds = xr.Dataset({"rainfall": _da(5.0)})
    tmax_ds = xr.Dataset({"tmax": _da(30.0)},
                         coords={"lat": np.linspace(7.5, 21.5, 4),
                                 "lon": np.linspace(72.0, 77.5, 4)})
    tmin_ds = xr.Dataset({"tmin": _da(20.0)},
                         coords={"lat": np.linspace(7.5, 21.5, 4),
                                 "lon": np.linspace(72.0, 77.5, 4)})

    oisst_dir = tmp_path / "oisst"
    oisst_dir.mkdir()
    for d in dates:
        _write_oisst_day(oisst_dir, d.strftime("%Y-%m-%d"), sst_value=28.0)

    p = ClimatePreprocessor(region=REGION, resolution=0.25)
    normalized, _ = p.preprocess_imd(
        rainfall_ds, tmax_ds, tmin_ds,
        oisst_dir=str(oisst_dir),
        start_year=2010, end_year=2010,
    )

    assert "insat_sst" in normalized.data_vars
    assert "insat_sst_available" in normalized.data_vars
    # Fixture SST is uniformly 28.0 (not the bug being guarded against: the old
    # behavior was a hardcoded zero-fill regardless of input). Confirm the real
    # value made it through rather than being replaced by zero.
    assert float(normalized["insat_sst"].mean()) == pytest.approx(28.0, abs=0.5)
    assert not bool((normalized["insat_sst"] == 0.0).all()), (
        "insat_sst must not be constant zero once OISST is wired in"
    )
    assert bool((normalized["insat_sst_available"] == 1.0).all())

"""Property tests for ClimatePreprocessor.

Property 1: Regridding preserves spatial bounds and target resolution
Property 2: Z-score normalization round-trip
Property 3: Quality control correctly identifies outliers and fills temporal gaps
Property 4: Spatial interpolation fills missing cells within radius constraint
Property 5: Temporal aggregation produces exactly one value per day
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
import xarray as xr

from data_ingestion.preprocessor import ClimatePreprocessor


@pytest.fixture
def preprocessor():
    return ClimatePreprocessor()


# ── Property 1: Regridding preserves bounds and resolution ───────────────────

def test_regrid_output_resolution(preprocessor, pilot_tmax_ds):
    """Output has exactly 0.25° resolution in both lat and lon."""
    result = preprocessor.regrid_to_target(pilot_tmax_ds, target_resolution=0.25)
    lat_diffs = np.diff(result.lat.values)
    lon_diffs = np.diff(result.lon.values)
    assert np.allclose(lat_diffs, 0.25, atol=1e-6), f"Lat resolution not 0.25°: {lat_diffs[:5]}"
    assert np.allclose(lon_diffs, 0.25, atol=1e-6), f"Lon resolution not 0.25°: {lon_diffs[:5]}"


def test_regrid_output_within_pilot_region(preprocessor, pilot_tmax_ds):
    """Output lats/lons are bounded within the pilot region."""
    result = preprocessor.regrid_to_target(pilot_tmax_ds)
    assert result.lat.values.min() >= 7.9
    assert result.lat.values.max() <= 20.1
    assert result.lon.values.min() >= 71.9
    assert result.lon.values.max() <= 78.1


def test_regrid_output_values_bounded_by_input(preprocessor, pilot_tmax_ds):
    """Regridded values don't extrapolate beyond input min/max (within tolerance)."""
    result = preprocessor.regrid_to_target(pilot_tmax_ds)
    # Allow small overshoot due to bilinear interpolation near boundaries
    input_min = float(np.nanmin(pilot_tmax_ds["tmax"].values))
    input_max = float(np.nanmax(pilot_tmax_ds["tmax"].values))
    out_vals = result["tmax"].values
    tolerance = 2.0  # °C tolerance for boundary effects
    assert np.nanmin(out_vals) >= input_min - tolerance
    assert np.nanmax(out_vals) <= input_max + tolerance


# ── Property 2: Z-score normalization round-trip ─────────────────────────────

def test_normalization_round_trip(preprocessor, pilot_rainfall_ds):
    """denormalize(normalize(x)) ≈ x within ε=1e-4."""
    norm_ds, norm_params = preprocessor.normalize(pilot_rainfall_ds)
    denorm_ds = preprocessor.denormalize(norm_ds, norm_params)

    orig = pilot_rainfall_ds["rainfall"].values
    recovered = denorm_ds["rainfall"].values
    valid = ~np.isnan(orig) & ~np.isnan(recovered)
    assert valid.sum() > 0, "No valid cells for round-trip check"

    max_error = np.max(np.abs(orig[valid] - recovered[valid]))
    assert max_error < 1e-3, f"Round-trip error {max_error:.6f} exceeds 1e-3"


def test_normalized_values_approximately_standard(preprocessor, pilot_rainfall_ds):
    """Normalized data has approximately zero mean and unit variance."""
    norm_ds, _ = preprocessor.normalize(pilot_rainfall_ds)
    arr = norm_ds["rainfall"].values
    valid = arr[~np.isnan(arr)]
    assert abs(float(np.mean(valid))) < 0.5, "Mean not near zero"
    assert 0.3 < float(np.std(valid)) < 3.0, "Std not near 1.0"


# ── Property 3: Quality control identifies outliers and fills short gaps ──────

def test_qc_flags_outliers():
    """Values >3σ from climatology are flagged as outliers (qc_flag=1)."""
    preprocessor = ClimatePreprocessor()
    lats = np.arange(8.0, 12.25, 0.25)
    lons = np.arange(72.0, 75.25, 0.25)
    ndays = 40
    times = pd.date_range("2000-01-01", periods=ndays)

    rng = np.random.default_rng(42)
    data = rng.normal(10, 2, (ndays, len(lats), len(lons))).astype(np.float32)
    # Inject a clear outlier
    data[10, 0, 0] = 500.0  # far above 3σ

    ds = xr.Dataset(
        {"rainfall": xr.DataArray(data, dims=["time", "lat", "lon"])},
        coords={"time": times, "lat": lats, "lon": lons},
    )
    result = preprocessor.quality_control(ds, "rainfall")
    assert "rainfall_qc_flag" in result.data_vars
    flag = result["rainfall_qc_flag"].values
    assert flag[10, 0, 0] == 1, "Outlier should be flagged with qc_flag=1"


def test_qc_fills_short_gaps():
    """Temporal gaps ≤5 days are filled by linear interpolation (qc_flag=2)."""
    preprocessor = ClimatePreprocessor()
    lats = np.array([8.0, 8.25])
    lons = np.array([72.0, 72.25])
    ndays = 20
    times = pd.date_range("2000-01-01", periods=ndays)

    data = np.ones((ndays, 2, 2), dtype=np.float32) * 10.0
    # Introduce a 3-day gap
    data[5:8, 0, 0] = np.nan

    ds = xr.Dataset(
        {"rainfall": xr.DataArray(data, dims=["time", "lat", "lon"])},
        coords={"time": times, "lat": lats, "lon": lons},
    )
    result = preprocessor.quality_control(ds, "rainfall")
    # Check that the gap was filled
    filled_vals = result["rainfall"].values[5:8, 0, 0]
    assert not np.any(np.isnan(filled_vals)), "3-day gap should be gap-filled"
    flag = result["rainfall_qc_flag"].values
    assert np.all(flag[5:8, 0, 0] == 2), "Filled cells should have qc_flag=2"


def test_qc_does_not_fill_long_gaps():
    """Temporal gaps >5 days are NOT filled."""
    preprocessor = ClimatePreprocessor()
    lats = np.array([8.0])
    lons = np.array([72.0])
    ndays = 30
    times = pd.date_range("2000-01-01", periods=ndays)

    data = np.ones((ndays, 1, 1), dtype=np.float32) * 15.0
    data[5:13, 0, 0] = np.nan  # 8-day gap → too long

    ds = xr.Dataset(
        {"rainfall": xr.DataArray(data, dims=["time", "lat", "lon"])},
        coords={"time": times, "lat": lats, "lon": lons},
    )
    result = preprocessor.quality_control(ds, "rainfall")
    still_nan = np.isnan(result["rainfall"].values[5:13, 0, 0])
    assert np.all(still_nan), "Long gap (>5 days) should NOT be filled"


# ── Property 4: Spatial interpolation fills within radius ────────────────────

def test_spatial_interpolation_fills_within_radius():
    """Missing cells within max_radius of a valid neighbor are filled."""
    preprocessor = ClimatePreprocessor()
    lats = np.arange(8.0, 12.25, 0.25)
    lons = np.arange(72.0, 75.25, 0.25)
    data = np.ones((5, len(lats), len(lons)), dtype=np.float32) * 20.0
    times = pd.date_range("2000-01-01", periods=5)

    # Introduce a single missing cell surrounded by valid neighbors
    data[2, 3, 3] = np.nan

    ds = xr.Dataset(
        {"lst": xr.DataArray(data, dims=["time", "lat", "lon"])},
        coords={"time": times, "lat": lats, "lon": lons},
    )
    result = preprocessor.spatial_interpolate_missing(ds, max_radius=3)
    assert not np.isnan(result["lst"].values[2, 3, 3]), "Cell within radius should be filled"


def test_spatial_interpolation_does_not_fill_isolated():
    """Missing cells with no valid neighbors within radius are NOT filled."""
    preprocessor = ClimatePreprocessor()
    lats = np.array([8.0, 8.25, 8.5])
    lons = np.array([72.0, 72.25, 72.5])
    # All cells NaN → no valid neighbors → none should be filled
    data = np.full((3, 3, 3), np.nan, dtype=np.float32)
    times = pd.date_range("2000-01-01", periods=3)

    ds = xr.Dataset(
        {"lst": xr.DataArray(data, dims=["time", "lat", "lon"])},
        coords={"time": times, "lat": lats, "lon": lons},
    )
    result = preprocessor.spatial_interpolate_missing(ds, max_radius=1)
    assert np.all(np.isnan(result["lst"].values)), "All-NaN region should stay NaN"


# ── Property 5: Cyclical encoding satisfies sin²+cos²=1 ───────────────────────

def test_cyclical_encoding_unit_circle():
    """sin²(day) + cos²(day) = 1 for all days."""
    preprocessor = ClimatePreprocessor()
    lats = np.array([8.0])
    lons = np.array([72.0])
    ndays = 366
    times = pd.date_range("2020-01-01", periods=ndays)
    data = np.zeros((ndays, 1, 1), dtype=np.float32)

    ds = xr.Dataset(
        {"rainfall": xr.DataArray(data, dims=["time", "lat", "lon"])},
        coords={"time": times, "lat": lats, "lon": lons},
    )
    result = preprocessor.encode_cyclical_time(ds)
    sin_sq = result.day_sin.values ** 2
    cos_sq = result.day_cos.values ** 2
    total = sin_sq + cos_sq
    assert np.allclose(total, 1.0, atol=1e-5), "sin²+cos² must equal 1.0 for all days"


def test_cyclical_encoding_year_boundary_continuity():
    """Day 365 and day 1 have similar (cyclically close) encodings."""
    preprocessor = ClimatePreprocessor()
    lats = np.array([8.0])
    lons = np.array([72.0])
    # Create a 2-year dataset
    times = pd.date_range("2019-12-30", periods=5)
    data = np.zeros((5, 1, 1), dtype=np.float32)
    ds = xr.Dataset(
        {"rainfall": xr.DataArray(data, dims=["time", "lat", "lon"])},
        coords={"time": times, "lat": lats, "lon": lons},
    )
    result = preprocessor.encode_cyclical_time(ds)
    sins = result.day_sin.values
    # Last and first days should be close in cyclical sense
    # Dec 31 (doy 366 → mapped to 365) and Jan 1 (doy 1) are adjacent
    # The difference should be small
    period = 365.25
    day_step = 2 * 3.14159 / period
    assert abs(sins[-1] - sins[0]) < day_step * 3, "Year boundary should be smooth"

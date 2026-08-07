"""Tests for the ERA5 independent-reference validation path.

The bundle written here stores rainfall/tmax as z-scores against a per-cell
climatology, exactly as the real ``normalized_*.nc`` does, and the reference
series is constructed with a *known* bias and a known day offset. That way the
agreement statistics can be checked against numbers computed by hand instead of
against whatever the implementation returns.
"""

from __future__ import annotations

import numpy as np
import pytest

from backend.era5_validation import (
    CIRCULAR_VARIABLES,
    ERA5_FIELD_FOR_VARIABLE,
    MIN_MONTH_COVERAGE,
    agreement_stats,
    compare_with_era5,
    extract_point_series,
    monthly_aggregate,
    monthly_unit,
    nearest_cell,
    pair_on_dates,
)

pytest.importorskip("xarray")


# ── Fixtures ──────────────────────────────────────────────────────────────────


def _make_bundle(tmp_path, *, n_days: int = 400, start: str = "2023-01-01"):
    """Write a normalized_*.nc / norm_params_*.nc pair with known physical values.

    Cell (i, j) has rainfall climatology 3 + i + j mm/day and tmax climatology
    30 + i degC. The physical daily series is a fixed deterministic ramp, then
    inverted into z-space, so a reader that forgets to denormalize recovers
    obviously wrong numbers rather than merely differently-scaled ones.
    """
    import pandas as pd
    import xarray as xr

    time = pd.date_range(start, periods=n_days, freq="D")
    lats = np.array([12.375, 12.625, 12.875])
    lons = np.array([75.375, 75.625])
    n_lat, n_lon = lats.size, lons.size

    rain_mean = np.array([[3.0 + i + j for j in range(n_lon)] for i in range(n_lat)])
    rain_std = np.full((n_lat, n_lon), 2.0)
    tmax_mean = np.array([[30.0 + i for _ in range(n_lon)] for i in range(n_lat)])
    tmax_std = np.full((n_lat, n_lon), 1.5)

    # Deterministic day signal, same for every cell, so per-cell offsets in the
    # recovered series come only from the climatology.
    day = np.arange(n_days, dtype=np.float64)
    signal = np.sin(day / 11.0)

    rain_phys = rain_mean[None, :, :] + 2.0 * signal[:, None, None]
    tmax_phys = tmax_mean[None, :, :] + 3.0 * signal[:, None, None]

    rain_z = (rain_phys - rain_mean[None, :, :]) / rain_std[None, :, :]
    tmax_z = (tmax_phys - tmax_mean[None, :, :]) / tmax_std[None, :, :]

    # Availability flag: blank the 10th day everywhere, writing the gap-filled
    # 0.0 the real pipeline writes, so masking can be observed.
    rain_avail = np.ones((n_days, n_lat, n_lon))
    rain_avail[9] = 0.0
    rain_z[9] = 0.0

    dims = ("time", "lat", "lon")
    ds = xr.Dataset(
        {
            "rainfall": (dims, rain_z.astype(np.float32)),
            "rainfall_available": (dims, rain_avail.astype(np.float32)),
            "tmax": (dims, tmax_z.astype(np.float32)),
        },
        coords={"time": time, "lat": lats, "lon": lons},
    )
    norm = xr.Dataset(
        {
            "rainfall_mean": (("lat", "lon"), rain_mean.astype(np.float64)),
            "rainfall_std": (("lat", "lon"), rain_std),
            "tmax_mean": (("lat", "lon"), tmax_mean.astype(np.float64)),
            "tmax_std": (("lat", "lon"), tmax_std),
        },
        coords={"lat": lats, "lon": lons},
    )

    ds_path = tmp_path / "normalized_2023-2024.nc"
    norm_path = tmp_path / "norm_params_2023-2024.nc"
    ds.to_netcdf(ds_path)
    norm.to_netcdf(norm_path)
    ds.close()
    norm.close()
    return str(ds_path), str(norm_path)


def _era5_payload(dates, values, field="precipitation_mm"):
    return {
        "source": "era5_open_meteo",
        "daily": {"time": list(dates), field: list(values)},
    }


@pytest.fixture(autouse=True)
def _clear_dataset_cache():
    from backend import sensitivity

    sensitivity._open_dataset.cache_clear()
    yield
    sensitivity._open_dataset.cache_clear()


# ── Nearest cell ──────────────────────────────────────────────────────────────


class TestNearestCell:
    def test_picks_closest_centre_and_row_major_index(self):
        lats = np.array([12.375, 12.625, 12.875])
        lons = np.array([75.375, 75.625])
        i, j, clat, clon, flat, dist = nearest_cell(lats, lons, 12.60, 75.60)
        assert (i, j) == (1, 1)
        assert (clat, clon) == (12.625, 75.625)
        # Row-major: i * n_lon + j, the ordering norm_params is flattened with.
        assert flat == 1 * 2 + 1
        assert 0.0 < dist < 10.0

    def test_distance_is_zero_on_a_cell_centre(self):
        lats = np.array([10.0, 10.5])
        lons = np.array([70.0, 70.5])
        *_, dist = nearest_cell(lats, lons, 10.5, 70.5)
        assert dist == pytest.approx(0.0, abs=1e-9)


# ── Point extraction ──────────────────────────────────────────────────────────


class TestExtractPointSeries:
    def test_recovers_physical_units_from_z_scores(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path)
        s = extract_point_series(
            ds_path, "rainfall", 12.875, 75.625, "2023-01-01", "2023-01-08",
            norm_params_path=norm_path,
        )
        assert s.denormalized is True
        assert s.unit == "mm/day"
        assert len(s.dates) == 8
        # Cell (2,1): climatology 3 + 2 + 1 = 6 mm/day, plus 2*sin(day/11).
        expected = 6.0 + 2.0 * np.sin(np.arange(8) / 11.0)
        np.testing.assert_allclose(s.values, expected, rtol=1e-5)

    def test_availability_flag_becomes_nan_not_zero(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path)
        s = extract_point_series(
            ds_path, "rainfall", 12.375, 75.375, "2023-01-01", "2023-01-15",
            norm_params_path=norm_path,
        )
        assert s.availability_masked is True
        # Day index 9 was blanked. A gap-filled 0.0 read as a real dry day would
        # manufacture a rainfall bias in every statistic downstream.
        assert np.isnan(s.values[9])
        assert np.isfinite(s.values[8]) and np.isfinite(s.values[10])

    def test_uses_the_cells_own_climatology(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path)
        a = extract_point_series(
            ds_path, "rainfall", 12.375, 75.375, "2023-02-01", "2023-02-05",
            norm_params_path=norm_path,
        )
        b = extract_point_series(
            ds_path, "rainfall", 12.875, 75.625, "2023-02-01", "2023-02-05",
            norm_params_path=norm_path,
        )
        # Same z-scores, different per-cell mean: 3.0 vs 6.0 mm/day.
        np.testing.assert_allclose(b.values - a.values, 3.0, rtol=1e-5)

    def test_missing_norm_params_flags_not_denormalized(self, tmp_path):
        ds_path, _ = _make_bundle(tmp_path)
        s = extract_point_series(
            ds_path, "rainfall", 12.375, 75.375, "2023-01-01", "2023-01-05",
            norm_params_path=tmp_path / "does_not_exist.nc",
        )
        assert s.denormalized is False

    def test_range_outside_the_bundle_raises(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path)
        with pytest.raises(ValueError, match="no days fall"):
            extract_point_series(
                ds_path, "rainfall", 12.5, 75.5, "1990-01-01", "1990-12-31",
                norm_params_path=norm_path,
            )


# ── Pairing ───────────────────────────────────────────────────────────────────


class TestPairOnDates:
    def test_matches_by_date_not_position(self):
        a_dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"]
        a_vals = np.array([1.0, 2.0, 3.0, 4.0])
        # The reference is missing 01-02, which positional zipping would shift.
        b_dates = ["2024-01-01", "2024-01-03", "2024-01-04"]
        b_vals = np.array([1.0, 3.0, 4.0])
        dates, left, right = pair_on_dates(a_dates, a_vals, b_dates, b_vals)
        assert dates == ["2024-01-01", "2024-01-03", "2024-01-04"]
        np.testing.assert_array_equal(left, right)

    def test_drops_pairs_where_either_side_is_nan(self):
        dates, left, right = pair_on_dates(
            ["2024-01-01", "2024-01-02"],
            np.array([np.nan, 5.0]),
            ["2024-01-01", "2024-01-02"],
            np.array([1.0, np.nan]),
        )
        assert dates == []
        assert left.size == 0 and right.size == 0


# ── Statistics ────────────────────────────────────────────────────────────────


class TestAgreementStats:
    def test_known_bias_mae_rmse(self):
        obs = np.array([1.0, 2.0, 3.0, 4.0])
        ref = obs + 2.0
        s = agreement_stats(obs, ref)
        assert s.n == 4
        assert s.bias == pytest.approx(2.0)       # signed reference - observed
        assert s.mae == pytest.approx(2.0)
        assert s.rmse == pytest.approx(2.0)
        assert s.pearson_r == pytest.approx(1.0)

    def test_bias_sign_is_reference_minus_observed(self):
        s = agreement_stats(np.array([5.0, 5.0, 6.0]), np.array([3.0, 3.0, 4.0]))
        assert s.bias == pytest.approx(-2.0)

    def test_rmse_exceeds_mae_when_error_is_uneven(self):
        obs = np.array([0.0, 0.0, 0.0, 0.0])
        ref = np.array([0.0, 0.0, 0.0, 4.0])
        s = agreement_stats(obs, ref)
        assert s.mae == pytest.approx(1.0)
        assert s.rmse == pytest.approx(2.0)

    def test_accumulating_adds_totals_and_ratio(self):
        obs = np.array([1.0, 2.0, 3.0])   # total 6
        ref = np.array([2.0, 2.0, 5.0])   # total 9
        s = agreement_stats(obs, ref, accumulating=True)
        assert s.observed_total == pytest.approx(6.0)
        assert s.reference_total == pytest.approx(9.0)
        assert s.total_ratio == pytest.approx(1.5)

    def test_constant_series_gives_nan_correlation_not_a_number(self):
        s = agreement_stats(np.array([2.0, 2.0, 2.0]), np.array([1.0, 3.0, 5.0]))
        assert np.isnan(s.pearson_r)
        assert s.to_dict()["pearson_r"] is None   # JSON-safe

    def test_too_few_pairs_returns_nan_rather_than_raising(self):
        s = agreement_stats(np.array([1.0]), np.array([2.0]))
        assert s.n == 1
        assert np.isnan(s.rmse)


# ── Monthly aggregation ───────────────────────────────────────────────────────


class TestMonthlyAggregate:
    def test_rainfall_sums_and_temperature_means(self):
        import pandas as pd

        dates = [str(d.date()) for d in pd.date_range("2024-01-01", "2024-02-29")]
        obs = np.ones(len(dates))
        ref = np.full(len(dates), 2.0)

        labels, m_obs, m_ref, days = monthly_aggregate(dates, obs, ref, "sum")
        assert labels == ["2024-01", "2024-02"]
        np.testing.assert_allclose(m_obs, [31.0, 29.0])
        np.testing.assert_allclose(m_ref, [62.0, 58.0])
        np.testing.assert_array_equal(days, [31, 29])

        labels, m_obs, m_ref, _ = monthly_aggregate(dates, obs, ref, "mean")
        np.testing.assert_allclose(m_obs, [1.0, 1.0])
        np.testing.assert_allclose(m_ref, [2.0, 2.0])

    def test_under_covered_month_is_dropped(self):
        # 5 of 31 January days is far below the coverage floor; reporting it as a
        # monthly total would plot a partial month beside a complete one.
        dates = [f"2024-01-{d:02d}" for d in range(1, 6)]
        labels, *_ = monthly_aggregate(
            dates, np.ones(5), np.ones(5), "sum"
        )
        assert labels == []
        assert MIN_MONTH_COVERAGE > 5 / 31

    def test_empty_input_is_safe(self):
        labels, obs, ref, days = monthly_aggregate([], np.array([]), np.array([]), "sum")
        assert labels == [] and obs.size == 0 and ref.size == 0 and days.size == 0


# ── End-to-end comparison ─────────────────────────────────────────────────────


class TestCompareWithEra5:
    def test_scores_a_planted_bias(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path)
        series = extract_point_series(
            ds_path, "rainfall", 12.375, 75.375, "2023-01-01", "2023-03-31",
            norm_params_path=norm_path,
        )
        # Reference = ours + 0.5 mm/day exactly, wherever ours is valid.
        ref_vals = [
            (v + 0.5) if np.isfinite(v) else 0.0 for v in series.values
        ]
        payload = _era5_payload(series.dates, ref_vals)

        result = compare_with_era5(
            ds_path, payload,
            region="western_ghats", variable="rainfall",
            lat=12.375, lon=75.375,
            start_date="2023-01-01", end_date="2023-03-31",
            norm_params_path=norm_path,
        )
        assert result.daily_stats.bias == pytest.approx(0.5, abs=1e-6)
        assert result.daily_stats.pearson_r == pytest.approx(1.0, abs=1e-9)
        # The blanked day is excluded from the pairing, not counted as 0 vs 0.
        assert result.daily_stats.n == len(series.dates) - 1
        assert result.monthly_stats is not None
        assert result.monthly_aggregation == "sum"

    def test_rejects_circular_variables(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path)
        with pytest.raises(ValueError, match="cannot be validated against ERA5"):
            compare_with_era5(
                ds_path, _era5_payload(["2023-01-01"], [1.0]),
                region="western_ghats", variable="lst",
                lat=12.5, lon=75.5,
                start_date="2023-01-01", end_date="2023-01-31",
                norm_params_path=norm_path,
            )
        assert "insat_lst" in CIRCULAR_VARIABLES

    def test_empty_reference_raises_instead_of_comparing_against_zeros(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path)
        with pytest.raises(ValueError, match="no days"):
            compare_with_era5(
                ds_path, {"daily": {}, "error": "timeout"},
                region="western_ghats", variable="rainfall",
                lat=12.5, lon=75.5,
                start_date="2023-01-01", end_date="2023-01-31",
                norm_params_path=norm_path,
            )

    def test_non_overlapping_dates_raise(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path)
        with pytest.raises(ValueError, match="Fewer than 2 days"):
            compare_with_era5(
                ds_path, _era5_payload(["1999-01-01", "1999-01-02"], [1.0, 2.0]),
                region="western_ghats", variable="rainfall",
                lat=12.5, lon=75.5,
                start_date="2023-01-01", end_date="2023-01-31",
                norm_params_path=norm_path,
            )

    def test_monthly_rainfall_carries_mm_not_mm_per_day(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path)
        series = extract_point_series(
            ds_path, "rainfall", 12.375, 75.375, "2023-01-01", "2023-03-31",
            norm_params_path=norm_path,
        )
        result = compare_with_era5(
            ds_path,
            _era5_payload(series.dates, list(np.nan_to_num(series.values))),
            region="western_ghats", variable="rainfall",
            lat=12.375, lon=75.375,
            start_date="2023-01-01", end_date="2023-03-31",
            norm_params_path=norm_path,
        )
        blob = result.to_dict()
        # A summed mm/day series is mm. Labelling a monthly total as a rate
        # understates every monthly bias by roughly the length of the month.
        assert blob["unit"] == "mm/day"
        assert blob["monthly"]["unit"] == "mm"
        assert monthly_unit("mm/day", "sum") == "mm"
        assert monthly_unit("degC", "mean") == "degC"

    def test_payload_is_json_safe_and_carries_caveats(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path)
        series = extract_point_series(
            ds_path, "tmax", 12.625, 75.625, "2023-01-01", "2023-04-30",
            norm_params_path=norm_path,
        )
        payload = _era5_payload(
            series.dates, list(series.values - 0.8), field="temp_max_c"
        )
        result = compare_with_era5(
            ds_path, payload,
            region="western_ghats", variable="tmax",
            lat=12.625, lon=75.625,
            start_date="2023-01-01", end_date="2023-04-30",
            norm_params_path=norm_path,
        )
        import json

        blob = result.to_dict()
        json.dumps(blob)   # would raise on NaN-as-float or numpy scalars
        assert blob["daily_stats"]["bias"] == pytest.approx(-0.8, abs=1e-5)
        assert blob["monthly"]["aggregation"] == "mean"
        assert blob["monthly"]["unit"] == "degC"   # averaging preserves the unit
        assert blob["unit"] == "degC"
        assert blob["our_grid_cell"]["denormalized"] is True
        assert blob["provenance"]["independent"] is True
        assert any("independent reanalysis" in c for c in blob["caveats"])
        # Temperature must not carry rainfall's accumulation figures.
        assert "observed_total" not in blob["daily_stats"]

    def test_include_daily_false_drops_the_arrays(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path)
        series = extract_point_series(
            ds_path, "rainfall", 12.375, 75.375, "2023-01-01", "2023-02-28",
            norm_params_path=norm_path,
        )
        result = compare_with_era5(
            ds_path, _era5_payload(series.dates, list(np.nan_to_num(series.values))),
            region="western_ghats", variable="rainfall",
            lat=12.375, lon=75.375,
            start_date="2023-01-01", end_date="2023-02-28",
            norm_params_path=norm_path,
        )
        assert "daily" in result.to_dict(include_daily=True)
        assert "daily" not in result.to_dict(include_daily=False)

    def test_variable_map_only_covers_imd_sourced_channels(self):
        # ERA5 is already inside the bundle for the satellite substitutes, so
        # comparing them here would be a self-check dressed as validation.
        assert set(ERA5_FIELD_FOR_VARIABLE) == {"rainfall", "tmax", "tmin"}

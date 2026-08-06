"""Tests for the empirical sensitivity engine.

Uses synthetic NetCDF bundles with a known planted slope so the regression,
the availability masking, and the coverage filter can each be checked against an
answer computed by hand rather than against whatever the code happens to output.
"""

from __future__ import annotations

import numpy as np
import pytest

from backend.sensitivity import (
    MIN_COVERAGE_FRACTION,
    CalendarWindow,
    cell_areas_km2,
    compute_sensitivity,
    fit_ols,
    fit_ols_per_cell,
    project_scenario,
    resolve_variable,
)

pytest.importorskip("xarray")


# ── Fixtures ──────────────────────────────────────────────────────────────────


def _make_bundle(
    tmp_path,
    *,
    slope: float = -0.5,
    n_years: int = 45,
    start_year: int = 1981,
    n_lat: int = 4,
    n_lon: int = 3,
    sst_missing_first_season: bool = False,
    noise: float = 0.0,
    seed: int = 7,
):
    """Write a normalized_*.nc / norm_params_*.nc pair with a planted slope.

    The response is built in physical units and then *inverted* into z-scores
    using the per-cell climatology written to norm_params, so a correct reader
    recovers the planted slope exactly and a reader that skips denormalization
    does not.
    """
    import pandas as pd
    import xarray as xr

    rng = np.random.default_rng(seed)
    time = pd.date_range(f"{start_year}-01-01", f"{start_year + n_years - 1}-12-31", freq="D")
    lats = np.linspace(10.0, 10.0 + 0.25 * (n_lat - 1), n_lat)
    lons = np.linspace(75.0, 75.0 + 0.25 * (n_lon - 1), n_lon)
    n_cells = n_lat * n_lon
    n_time = len(time)

    # Per-cell climatology, deliberately varied so a flat scalar denormalization
    # would give a different answer.
    rain_mean = np.linspace(3.0, 11.0, n_cells).reshape(n_lat, n_lon)
    rain_std = np.linspace(1.5, 4.0, n_cells).reshape(n_lat, n_lon)
    tmax_mean = np.linspace(30.0, 34.0, n_cells).reshape(n_lat, n_lon)
    tmax_std = np.full((n_lat, n_lon), 2.0)

    years = time.year.values
    # One driver anomaly per year, shared across cells.
    unique_years = np.unique(years)
    driver_anom = rng.normal(0.0, 1.0, unique_years.size)
    anom_by_day = np.array([driver_anom[np.searchsorted(unique_years, y)] for y in years])

    # tmax physical = climatology + anomaly; rainfall physical = clim + slope*anomaly
    tmax_phys = tmax_mean[None, :, :] + anom_by_day[:, None, None]
    rain_phys = rain_mean[None, :, :] + slope * anom_by_day[:, None, None]
    if noise:
        rain_phys = rain_phys + rng.normal(0.0, noise, rain_phys.shape)

    # Invert to z-space, which is how the real bundles store these variables.
    tmax_z = (tmax_phys - tmax_mean[None, :, :]) / tmax_std[None, :, :]
    rain_z = (rain_phys - rain_mean[None, :, :]) / rain_std[None, :, :]

    # SST is stored raw with an availability flag, mirroring insat_sst.
    sst = 28.0 + anom_by_day[:, None, None] + np.zeros((1, n_lat, n_lon))
    sst_avail = np.ones((n_time, n_lat, n_lon))
    if sst_missing_first_season:
        # Blank out all but 20 days of the first year's JJAS, and write the
        # gap-filled 0.0 the real pipeline writes.
        first = (years == start_year) & np.isin(time.month, [6, 7, 8, 9])
        idx = np.flatnonzero(first)[20:]
        sst_avail[idx] = 0.0
        sst[idx] = 0.0

    coords = {"time": time, "lat": lats, "lon": lons}
    dims = ("time", "lat", "lon")
    ds = xr.Dataset(
        {
            "rainfall": (dims, rain_z.astype(np.float32)),
            "tmax": (dims, tmax_z.astype(np.float32)),
            "insat_sst": (dims, sst.astype(np.float32)),
            "insat_sst_available": (dims, sst_avail.astype(np.float32)),
        },
        coords=coords,
    )
    norm = xr.Dataset(
        {
            "rainfall_mean": (("lat", "lon"), rain_mean),
            "rainfall_std": (("lat", "lon"), rain_std),
            "tmax_mean": (("lat", "lon"), tmax_mean),
            "tmax_std": (("lat", "lon"), tmax_std),
        },
        coords={"lat": lats, "lon": lons},
    )

    span = f"{start_year}-{start_year + n_years - 1}"
    ds_path = tmp_path / f"normalized_{span}.nc"
    norm_path = tmp_path / f"norm_params_{span}.nc"
    ds.to_netcdf(ds_path)
    norm.to_netcdf(norm_path)
    ds.close()
    norm.close()
    return str(ds_path), str(norm_path)


@pytest.fixture(autouse=True)
def _clear_dataset_cache():
    """Drop the module-level xarray cache so each test reads its own file."""
    from backend import sensitivity

    sensitivity._open_dataset.cache_clear()
    yield
    sensitivity._open_dataset.cache_clear()


# ── Calendar window ───────────────────────────────────────────────────────────


class TestCalendarWindow:
    def test_jjas_preset_selects_122_days(self):
        import pandas as pd

        win = CalendarWindow.from_preset("jjas")
        days = pd.DatetimeIndex(pd.date_range("2001-01-01", "2001-12-31", freq="D"))
        mask, _ = win.mask_and_season_year(days)
        assert mask.sum() == 30 + 31 + 31 + 30

    def test_annual_selects_every_day(self):
        import pandas as pd

        win = CalendarWindow.from_preset("annual")
        days = pd.DatetimeIndex(pd.date_range("2003-01-01", "2003-12-31", freq="D"))
        mask, _ = win.mask_and_season_year(days)
        assert mask.all()

    def test_djf_wraps_and_labels_by_starting_year(self):
        """Dec 1998 and Jan 1999 must land in the same season, labelled 1998."""
        import pandas as pd

        win = CalendarWindow.from_preset("djf")
        assert win.wraps_year
        days = pd.DatetimeIndex(["1998-12-15", "1999-01-15", "1999-02-10", "1999-07-01"])
        mask, season_year = win.mask_and_season_year(days)
        assert list(mask) == [True, True, True, False]
        assert list(season_year[:3]) == [1998, 1998, 1998]

    def test_from_dates_accepts_mm_dd(self):
        win = CalendarWindow.from_dates("07-15", "08-20")
        assert (win.month_start, win.day_start) == (7, 15)
        assert (win.month_end, win.day_end) == (8, 20)
        assert not win.wraps_year

    def test_unknown_preset_rejected(self):
        with pytest.raises(ValueError, match="Unknown season"):
            CalendarWindow.from_preset("harvest")


# ── OLS ───────────────────────────────────────────────────────────────────────


class TestFitOls:
    def test_recovers_exact_slope_and_intercept(self):
        x = np.arange(20, dtype=float)
        y = 3.5 * x - 2.0
        slope, intercept, r2, p, se = fit_ols(x, y)
        assert slope == pytest.approx(3.5)
        assert intercept == pytest.approx(-2.0)
        assert r2 == pytest.approx(1.0)
        assert p < 1e-12
        assert se == pytest.approx(0.0, abs=1e-9)

    def test_too_few_points_returns_nan(self):
        slope, *_ = fit_ols(np.array([1.0, 2.0]), np.array([1.0, 2.0]))
        assert np.isnan(slope)

    def test_ignores_non_finite_pairs(self):
        x = np.array([0.0, 1.0, 2.0, 3.0, np.nan])
        y = np.array([1.0, 3.0, 5.0, 7.0, 100.0])
        slope, intercept, *_ = fit_ols(x, y)
        assert slope == pytest.approx(2.0)
        assert intercept == pytest.approx(1.0)

    def test_per_cell_matches_scalar_fit(self):
        """The vectorized path must agree with scipy cell by cell."""
        rng = np.random.default_rng(3)
        x = rng.normal(size=30)
        true = np.array([-1.5, 0.0, 2.25, 0.75])
        Y = x[:, None] * true[None, :] + rng.normal(0, 0.3, (30, 4))

        slope, se, r2, p = fit_ols_per_cell(x, Y)
        for j in range(4):
            s_ref, _, r2_ref, p_ref, se_ref = fit_ols(x, Y[:, j])
            assert slope[j] == pytest.approx(s_ref, rel=1e-9)
            assert se[j] == pytest.approx(se_ref, rel=1e-9)
            assert r2[j] == pytest.approx(r2_ref, rel=1e-9)
            assert p[j] == pytest.approx(p_ref, rel=1e-9)

    def test_per_cell_handles_all_nan_column(self):
        x = np.arange(10, dtype=float)
        Y = np.column_stack([2 * x, np.full(10, np.nan)])
        slope, se, r2, p = fit_ols_per_cell(x, Y)
        assert slope[0] == pytest.approx(2.0)
        assert np.isnan(slope[1]) and np.isnan(se[1]) and np.isnan(p[1])


# ── Cell areas ────────────────────────────────────────────────────────────────


class TestCellAreas:
    def test_quarter_degree_cell_near_equator(self):
        """A 0.25 deg cell at ~10N is about 765 km^2."""
        areas = cell_areas_km2(np.array([10.0]), np.array([75.0, 75.25]))
        assert areas.shape == (2,)
        assert areas[0] == pytest.approx(762, rel=0.02)

    def test_area_shrinks_toward_the_pole(self):
        areas = cell_areas_km2(np.array([5.0, 35.0]), np.array([75.0]))
        assert areas[0] > areas[1]

    def test_row_major_ordering_repeats_each_latitude(self):
        areas = cell_areas_km2(np.array([10.0, 20.0]), np.array([70.0, 71.0, 72.0]))
        assert areas.shape == (6,)
        assert areas[0] == pytest.approx(areas[1]) == pytest.approx(areas[2])
        assert areas[3] < areas[0]


# ── End-to-end sensitivity ────────────────────────────────────────────────────


class TestComputeSensitivity:
    def test_recovers_planted_slope_in_physical_units(self, tmp_path):
        """A -0.5 mm/day per degC plant must come back as -0.5, not as a z-score."""
        ds_path, norm_path = _make_bundle(tmp_path, slope=-0.5)
        res = compute_sensitivity(
            ds_path, norm_path, region="test", predictor="tmax",
            response="rainfall", season="jjas",
        )
        assert res.fit.slope == pytest.approx(-0.5, abs=1e-6)
        assert res.fit.r_squared == pytest.approx(1.0, abs=1e-6)
        assert res.fit.response_unit == "mm/day"
        assert res.fit.predictor_unit == "degC"
        assert res.fit.slope_unit == "mm/day per degC"
        assert res.fit.n == 45

    def test_response_climatology_is_the_historical_mean(self, tmp_path):
        """The baseline the UI labels "historical mean" must be the area mean."""
        ds_path, norm_path = _make_bundle(tmp_path, slope=0.0, n_lat=4, n_lon=3)
        res = compute_sensitivity(
            ds_path, norm_path, region="test", predictor="tmax", season="annual",
        )
        # Planted climatology is linspace(3, 11) over 12 cells; the cos-weighted
        # mean over a 0.75 deg latitude span is within a hair of the plain mean.
        assert res.fit.response_climatology == pytest.approx(7.0, abs=0.05)

    def test_per_cell_slopes_match_the_regional_slope(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, slope=-0.75)
        res = compute_sensitivity(ds_path, norm_path, region="test", predictor="tmax")
        cells = np.array([c for c in res.cell_slope], dtype=float)
        assert np.allclose(cells[np.isfinite(cells)], -0.75, atol=1e-6)

    def test_availability_flag_masks_gap_filled_zeros(self, tmp_path):
        """Unflagged 0.0 SST days must not drag the 28 degC climatology down."""
        ds_path, norm_path = _make_bundle(
            tmp_path, sst_missing_first_season=True, n_years=10,
        )
        res = compute_sensitivity(
            ds_path, norm_path, region="test", predictor="sst", season="jjas",
        )
        assert res.fit.predictor_climatology == pytest.approx(28.0, abs=0.6)
        assert res.provenance["predictor_masked_by_availability"] is True

    def test_under_covered_first_season_is_excluded(self, tmp_path):
        """JJAS 1981 has 20 of 122 valid days, below the coverage floor."""
        ds_path, norm_path = _make_bundle(
            tmp_path, sst_missing_first_season=True, n_years=10, start_year=1981,
        )
        res = compute_sensitivity(
            ds_path, norm_path, region="test", predictor="sst", season="jjas",
        )
        assert 1981 in res.excluded_years
        assert res.fit.n == 9
        assert all(p.year != 1981 for p in res.points)

    def test_full_coverage_excludes_nothing(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, n_years=12)
        res = compute_sensitivity(ds_path, norm_path, region="test", predictor="tmax")
        assert res.excluded_years == []
        assert res.fit.n == 12

    def test_year_range_filter_narrows_the_fit(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, n_years=45, start_year=1981)
        res = compute_sensitivity(
            ds_path, norm_path, region="test", predictor="tmax",
            year_range=(1990, 2000),
        )
        assert res.fit.n == 11
        assert res.provenance["year_first"] == 1990
        assert res.provenance["year_last"] == 2000

    def test_custom_window_changes_the_baseline(self, tmp_path):
        """A narrower calendar range must be honoured, not silently widened."""
        ds_path, norm_path = _make_bundle(tmp_path, n_years=20)
        res = compute_sensitivity(
            ds_path, norm_path, region="test", predictor="tmax",
            window=CalendarWindow.from_dates("07-01", "07-31"),
        )
        assert res.window.month_start == 7 and res.window.month_end == 7
        assert res.fit.n == 20

    def test_residuals_and_fitted_values_are_consistent(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, slope=-0.4, noise=0.5)
        res = compute_sensitivity(ds_path, norm_path, region="test", predictor="tmax")
        for p in res.points:
            assert p.residual == pytest.approx(p.response_value - p.fitted_value, abs=1e-9)
            assert p.fitted_value == pytest.approx(
                res.fit.intercept + res.fit.slope * p.predictor_anomaly, abs=1e-9
            )

    def test_predictor_anomalies_are_centred(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, n_years=25)
        res = compute_sensitivity(ds_path, norm_path, region="test", predictor="tmax")
        anomalies = np.array([p.predictor_anomaly for p in res.points])
        assert anomalies.mean() == pytest.approx(0.0, abs=1e-9)

    def test_confidence_interval_brackets_the_slope(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, slope=-0.6, noise=0.8)
        fit = compute_sensitivity(ds_path, norm_path, region="test", predictor="tmax").fit
        assert fit.ci95_low < fit.slope < fit.ci95_high
        assert fit.ci95_high - fit.ci95_low == pytest.approx(
            2 * fit.std_err * 2.0181, rel=0.02  # t(0.975, 43)
        )

    def test_too_few_years_raises(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, n_years=2)
        with pytest.raises(ValueError, match="usable year"):
            compute_sensitivity(ds_path, norm_path, region="test", predictor="tmax")

    def test_unknown_variable_raises(self):
        with pytest.raises(ValueError, match="Unknown variable"):
            resolve_variable("windspeed")

    def test_aliases_resolve(self):
        assert resolve_variable("sst") == "insat_sst"
        assert resolve_variable("temp_max") == "tmax"
        assert resolve_variable("RAIN") == "rainfall"


# ── Projection ────────────────────────────────────────────────────────────────


class TestProjectScenario:
    @pytest.fixture
    def result(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, slope=-0.5, n_years=45)
        return compute_sensitivity(
            ds_path, norm_path, region="test", predictor="tmax", season="jjas",
        )

    def test_delta_equals_slope_times_change(self, result):
        proj = project_scenario(result, 2.0)
        assert proj.delta_value == pytest.approx(-1.0, abs=1e-5)
        assert proj.scenario_value == pytest.approx(proj.baseline_value - 1.0, abs=1e-5)

    def test_zero_change_is_a_no_op(self, result):
        proj = project_scenario(result, 0.0)
        assert proj.delta_value == pytest.approx(0.0, abs=1e-9)
        assert proj.baseline_value == pytest.approx(proj.scenario_value, abs=1e-9)

    def test_sign_flips_with_the_driver(self, result):
        warm = project_scenario(result, 1.5)
        cool = project_scenario(result, -1.5)
        assert warm.delta_value < 0 < cool.delta_value
        assert warm.delta_value == pytest.approx(-cool.delta_value, rel=1e-6)

    def test_scenario_minus_baseline_always_holds(self, result):
        """Clamping must not break the identity the UI displays.

        +8 degC against a -0.5 slope drives the driest cells below zero, so this
        exercises the clamp rather than a no-op path.
        """
        proj = project_scenario(result, 8.0)
        base = np.array(proj.cell_baseline, dtype=float)
        scen = np.array(proj.cell_scenario, dtype=float)
        delta = np.array(proj.cell_delta, dtype=float)
        ok = np.isfinite(base) & np.isfinite(scen)
        assert np.allclose(scen[ok] - base[ok], delta[ok], atol=1e-9)

    def test_rainfall_never_goes_negative(self, result):
        # Slope is negative, so *warming* is what pushes rainfall toward zero.
        proj = project_scenario(result, 10.0)
        scen = np.array(proj.cell_scenario, dtype=float)
        assert np.nanmin(scen) >= 0.0
        assert proj.clamped_cells > 0
        assert any("clamped" in c for c in proj.caveats)

    def test_three_epochs_with_only_future_projected(self, result):
        proj = project_scenario(result, 2.0)
        ids = [e.id for e in proj.epochs]
        assert ids == ["past", "current", "future"]
        assert [e.observed for e in proj.epochs] == [True, True, False]
        assert proj.epochs[1].delta_vs_current == 0.0

    def test_epoch_windows_are_explicit_and_respected(self, result):
        proj = project_scenario(
            result, 1.0, past_years=(1981, 1990), current_years=(2016, 2025),
        )
        assert (proj.epochs[0].year_start, proj.epochs[0].year_end) == (1981, 1990)
        assert (proj.epochs[2].year_start, proj.epochs[2].year_end) == (None, None)

    def test_future_epoch_uncertainty_is_regression_based(self, result):
        proj = project_scenario(result, 2.0)
        assert proj.epochs[2].uncertainty_kind == "regression_ci"
        assert proj.epochs[0].uncertainty_kind == "observed_sem"

    def test_uncertainty_scales_with_the_applied_change(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, slope=-0.5, noise=1.0)
        res = compute_sensitivity(ds_path, norm_path, region="test", predictor="tmax")
        small = project_scenario(res, 1.0)
        large = project_scenario(res, 3.0)
        small_width = small.delta_ci95_high - small.delta_ci95_low
        large_width = large.delta_ci95_high - large.delta_ci95_low
        assert large_width == pytest.approx(3 * small_width, rel=1e-6)

    def test_drying_counts_dominate_for_a_negative_slope(self, result):
        proj = project_scenario(result, 2.0)
        assert proj.cells_drier > proj.cells_wetter
        assert proj.cells_drier + proj.cells_wetter <= proj.cells_total

    def test_volume_integral_has_the_delta_sign(self, result):
        proj = project_scenario(result, 2.0)
        assert proj.baseline_volume_km3 > 0
        assert proj.delta_volume_km3 < 0
        assert proj.area_km2 > 0

    def test_volume_integral_scales_linearly(self, result):
        one = project_scenario(result, 1.0).delta_volume_km3
        two = project_scenario(result, 2.0).delta_volume_km3
        assert two == pytest.approx(2 * one, rel=1e-6)

    def test_hotspots_carry_coordinates_within_the_grid(self, result):
        proj = project_scenario(result, 2.0)
        assert proj.hotspots
        for h in proj.hotspots:
            assert min(result.lats) <= h["lat"] <= max(result.lats)
            assert min(result.lons) <= h["lon"] <= max(result.lons)
            assert 0 <= h["node_idx"] < len(result.cell_slope)

    def test_extrapolation_beyond_the_record_is_flagged(self, result):
        proj = project_scenario(result, 9.0)
        assert any("outside the range observed" in c for c in proj.caveats)

    def test_covariability_caveat_always_present(self, result):
        proj = project_scenario(result, 1.0)
        assert any("co-variability" in c for c in proj.caveats)

    def test_serializes_without_nan_literals(self, result):
        """NaN would make the JSON invalid; ocean cells must become null."""
        import json

        proj = project_scenario(result, 2.0)
        text = json.dumps(proj.to_dict(include_cells=True))
        assert "NaN" not in text and "Infinity" not in text

    def test_cells_can_be_omitted_from_the_payload(self, result):
        proj = project_scenario(result, 2.0)
        assert "cell_delta" not in proj.to_dict(include_cells=False)
        assert "cell_delta" in proj.to_dict(include_cells=True)

    def test_missing_annual_field_raises(self, result):
        result.cell_annual = None
        with pytest.raises(ValueError, match="missing the annual field"):
            project_scenario(result, 1.0)


def test_min_coverage_fraction_is_a_sane_threshold():
    assert 0.5 <= MIN_COVERAGE_FRACTION <= 1.0

"""Tests for the climatology, conditional-distribution, and dual-baseline analytics.

These back the mentor-specified dashboard figures:

  * "Historical mean rainfall according to range"  -> compute_climatology
  * P(R = x | T = t) and P(R > x +/- dx | T = t +/- dt) -> conditional_distribution
  * Older baseline vs New baseline, each with its own dR/dT -> compare_baselines

Every assertion is checked against a value derived by hand from the planted
synthetic bundle rather than against whatever the implementation returns, reusing
the same `_make_bundle` helper the sensitivity tests use so the two suites cannot
drift apart.
"""

from __future__ import annotations

import numpy as np
import pytest

from backend.sensitivity import (
    DEFAULT_BASELINE_SPLIT_YEAR,
    CalendarWindow,
    compare_baselines,
    compute_climatology,
    compute_sensitivity,
    conditional_distribution,
)

pytest.importorskip("xarray")

# tests/ has no __init__.py, so pytest's prepend import mode puts it on sys.path.
from test_sensitivity import _make_bundle  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_dataset_cache():
    """Drop the module-level xarray cache so each test reads its own file."""
    from backend import sensitivity

    sensitivity._open_dataset.cache_clear()
    yield
    sensitivity._open_dataset.cache_clear()


# ══════════════════════════════════════════════════════════════════════════════
# Climatology
# ══════════════════════════════════════════════════════════════════════════════


class TestComputeClimatology:

    def test_mean_matches_the_planted_climatology(self, tmp_path):
        """rain_mean spans 3-11 mm/day across cells, so the area mean is ~7."""
        ds_path, norm_path = _make_bundle(tmp_path, slope=0.0, n_lat=4, n_lon=3)

        res = compute_climatology(
            ds_path, norm_path, region="test", variable="rainfall", season="annual",
        )
        assert res.mean == pytest.approx(7.0, abs=0.05)
        assert res.unit == "mm/day"

    def test_mean_equals_the_sensitivity_response_climatology(self, tmp_path):
        """The two endpoints must agree; a What-If baseline that disagrees with the
        historical mean panel is a contradiction the UI cannot explain away."""
        ds_path, norm_path = _make_bundle(tmp_path, slope=-0.5, n_years=45)

        clim = compute_climatology(
            ds_path, norm_path, region="test", variable="rainfall", season="jjas",
        )
        sens = compute_sensitivity(
            ds_path, norm_path, region="test", predictor="tmax",
            response="rainfall", season="jjas",
        )
        assert clim.mean == pytest.approx(sens.fit.response_climatology, rel=1e-9)

    def test_per_year_series_covers_every_year(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, n_years=20, start_year=1981)

        res = compute_climatology(ds_path, norm_path, region="test", variable="rainfall")
        assert res.n_years == 20
        assert len(res.per_year) == 20
        assert res.year_first == 1981
        assert res.year_last == 2000
        assert [p.year for p in res.per_year] == list(range(1981, 2001))

    def test_anomalies_are_centred_on_the_mean(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, n_years=30)

        res = compute_climatology(ds_path, norm_path, region="test", variable="rainfall")
        anomalies = np.array([p.anomaly for p in res.per_year])
        assert anomalies.mean() == pytest.approx(0.0, abs=1e-9)
        # And each anomaly is genuinely value - mean, not a re-derived quantity.
        for p in res.per_year:
            assert p.anomaly == pytest.approx(p.value - res.mean, abs=1e-9)

    def test_min_and_max_years_match_the_series(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, slope=-0.5, noise=0.4, n_years=30)

        res = compute_climatology(ds_path, norm_path, region="test", variable="rainfall")
        values = {p.year: p.value for p in res.per_year}
        assert res.min_year == min(values, key=values.get)
        assert res.max_year == max(values, key=values.get)
        assert res.min_value <= res.mean <= res.max_value

    def test_confidence_interval_brackets_the_mean(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, slope=-0.5, noise=0.6, n_years=40)

        res = compute_climatology(ds_path, norm_path, region="test", variable="rainfall")
        assert res.ci95_low < res.mean < res.ci95_high
        assert res.sem == pytest.approx(res.std / np.sqrt(res.n_years), rel=1e-9)

    def test_trend_is_flat_for_a_trendless_record(self, tmp_path):
        """The planted series has no trend, so the per-decade slope must not be
        reported as significant."""
        ds_path, norm_path = _make_bundle(tmp_path, slope=0.0, n_years=45)

        res = compute_climatology(ds_path, norm_path, region="test", variable="rainfall")
        assert res.trend_per_decade == pytest.approx(0.0, abs=0.05)
        assert res.trend_significant is False

    def test_rainfall_reports_a_volume_but_temperature_does_not(self, tmp_path):
        """A volume integral of degC would be meaningless, so it must be omitted."""
        ds_path, norm_path = _make_bundle(tmp_path, n_years=15)

        rain = compute_climatology(
            ds_path, norm_path, region="test", variable="rainfall", season="jjas",
        )
        temp = compute_climatology(
            ds_path, norm_path, region="test", variable="tmax", season="jjas",
        )
        assert rain.volume_km3 is not None and rain.volume_km3 > 0
        assert temp.volume_km3 is None
        assert temp.unit == "degC"

    def test_custom_calendar_range_is_honoured(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, n_years=20)

        res = compute_climatology(
            ds_path, norm_path, region="test", variable="rainfall",
            window=CalendarWindow.from_dates("07-01", "07-31"),
        )
        assert res.n_years == 20
        # 31 July days, and the planted bundle has no gaps in rainfall.
        assert all(p.valid_days == 31 for p in res.per_year)

    def test_year_range_filter_narrows_the_series(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, n_years=45, start_year=1981)

        res = compute_climatology(
            ds_path, norm_path, region="test", variable="rainfall",
            year_range=(1990, 2000),
        )
        assert res.year_first == 1990
        assert res.year_last == 2000
        assert res.n_years == 11

    def test_under_covered_season_is_excluded(self, tmp_path):
        """The coverage floor must apply here exactly as it does to the fit."""
        ds_path, norm_path = _make_bundle(
            tmp_path, sst_missing_first_season=True, n_years=10, start_year=1981,
        )
        res = compute_climatology(
            ds_path, norm_path, region="test", variable="sst", season="jjas",
        )
        assert 1981 in res.excluded_years
        assert all(p.year != 1981 for p in res.per_year)

    def test_denormalization_is_reported(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, n_years=12)

        res = compute_climatology(ds_path, norm_path, region="test", variable="rainfall")
        assert res.provenance["denormalized"] is True
        assert "observations" in res.provenance["source"]


# ══════════════════════════════════════════════════════════════════════════════
# Conditional distribution
# ══════════════════════════════════════════════════════════════════════════════


class TestConditionalDistribution:

    @pytest.fixture
    def result(self, tmp_path):
        ds_path, norm_path = _make_bundle(
            tmp_path, slope=-0.5, noise=0.5, n_years=45,
        )
        return compute_sensitivity(
            ds_path, norm_path, region="test", predictor="tmax",
            response="rainfall", season="jjas",
        )

    def test_baseline_curve_is_centred_on_the_observed_mean(self, result):
        dist = conditional_distribution(result, delta_predictor=2.0)
        assert dist.baseline.mean == pytest.approx(
            result.fit.response_climatology, rel=1e-6
        )
        assert dist.baseline.predictor_anomaly == 0.0

    def test_scenario_mean_follows_the_regression_line(self, result):
        """This is R_new = R_now + dT * (dR/dT), the mentor's core formula."""
        delta = 2.0
        dist = conditional_distribution(result, delta_predictor=delta)
        expected = result.fit.response_climatology + delta * result.fit.slope
        assert dist.scenario.mean == pytest.approx(expected, rel=1e-6)

    def test_extrapolation_widens_the_distribution(self, result):
        """Leverage must inflate sigma away from the observed mean, otherwise a
        +6 degC projection would look as certain as the climatology."""
        near = conditional_distribution(result, delta_predictor=0.0)
        far = conditional_distribution(result, delta_predictor=6.0)
        assert far.scenario.sigma > near.scenario.sigma
        assert near.baseline.sigma == pytest.approx(far.baseline.sigma, rel=1e-9)

    def test_density_integrates_to_one(self, result):
        dist = conditional_distribution(result, delta_predictor=1.0)
        for curve in (dist.baseline, dist.scenario):
            grid = np.asarray(curve.values, dtype=float)
            pdf = np.asarray(curve.density, dtype=float)
            area = float(np.trapezoid(pdf, grid)) if hasattr(np, "trapezoid") \
                else float(np.trapz(pdf, grid))
            # The grid spans +/-4 sigma, so a little mass falls outside.
            assert area == pytest.approx(1.0, abs=0.02)

    def test_negative_slope_reduces_exceedance_probability(self, result):
        """With dR/dT < 0, warming must make a wet season less likely."""
        assert result.fit.slope < 0
        dist = conditional_distribution(
            result, delta_predictor=2.0, threshold=result.fit.response_climatology,
        )
        assert dist.exceedance is not None
        assert dist.exceedance.scenario_probability < dist.exceedance.baseline_probability
        assert dist.exceedance.probability_change < 0

    def test_baseline_probability_of_the_median_is_about_a_half(self, result):
        """At the climatological threshold the baseline curve is centred, so the
        exceedance probability must sit near 0.5."""
        dist = conditional_distribution(
            result, delta_predictor=0.0, threshold=result.fit.response_climatology,
        )
        assert dist.exceedance.baseline_probability == pytest.approx(0.5, abs=0.02)

    def test_tolerances_widen_the_probability_band(self, result):
        # Threshold sits at the climatology so the probability is mid-range. A
        # threshold far into either tail saturates at 0 or 1, where widening the
        # tolerances cannot move it and the test would prove nothing.
        threshold = result.fit.response_climatology
        tight = conditional_distribution(
            result, delta_predictor=1.0, threshold=threshold,
            threshold_tolerance=0.0, predictor_tolerance=0.0,
        )
        loose = conditional_distribution(
            result, delta_predictor=1.0, threshold=threshold,
            threshold_tolerance=0.5, predictor_tolerance=0.5,
        )
        tight_span = tight.exceedance.probability_high - tight.exceedance.probability_low
        loose_span = loose.exceedance.probability_high - loose.exceedance.probability_low
        assert loose_span > tight_span
        # The band must contain the point estimate it was built around.
        assert (
            loose.exceedance.probability_low
            <= loose.exceedance.scenario_probability
            <= loose.exceedance.probability_high
        )

    def test_impossible_and_certain_thresholds(self, result):
        """Sanity anchors: nothing exceeds +inf, everything exceeds a huge negative."""
        low = conditional_distribution(result, delta_predictor=0.0, threshold=-1e6)
        high = conditional_distribution(result, delta_predictor=0.0, threshold=1e6)
        assert low.exceedance.baseline_probability == pytest.approx(1.0, abs=1e-6)
        assert high.exceedance.baseline_probability == pytest.approx(0.0, abs=1e-6)

    def test_observed_frequency_is_a_real_fraction(self, result):
        dist = conditional_distribution(
            result, delta_predictor=1.0, threshold=result.fit.response_climatology,
        )
        e = dist.exceedance
        assert 0.0 <= e.observed_frequency <= 1.0
        assert e.observed_years == result.fit.n
        assert e.observed_exceedances == pytest.approx(
            e.observed_frequency * e.observed_years, abs=1e-9
        )

    @pytest.mark.parametrize("noise", [0.5, 3.0, 30.0])
    def test_rainfall_density_axis_is_never_negative(self, tmp_path, noise):
        """A density over rainfall must not extend into impossible values.

        The truncation branch itself is defensive rather than routinely hit: the
        fixture's `noise` is per-day, so averaging a 122-day season divides the
        residual sigma by ~sqrt(122), and daily rainfall is already clamped at 0
        by PHYSICAL_CLAMPS. Both push the annual mean comfortably clear of zero.
        This asserts the invariant that actually has to hold at every noise level.
        """
        ds_path, norm_path = _make_bundle(
            tmp_path, slope=-0.5, noise=noise, n_years=45,
        )
        res = compute_sensitivity(
            ds_path, norm_path, region="test", predictor="tmax", season="jjas",
        )
        dist = conditional_distribution(res, delta_predictor=0.0)
        assert min(dist.baseline.values) >= 0.0
        assert min(dist.scenario.values) >= 0.0

    def test_extrapolation_is_disclosed(self, result):
        dist = conditional_distribution(result, delta_predictor=9.0)
        assert any("extrapolat" in c.lower() for c in dist.caveats)

    def test_empirical_histogram_accounts_for_every_year(self, result):
        dist = conditional_distribution(result, delta_predictor=1.0)
        assert sum(dist.histogram_counts) == result.fit.n
        assert len(dist.histogram_edges) == len(dist.histogram_counts) + 1
        assert len(dist.observed_values) == result.fit.n


# ══════════════════════════════════════════════════════════════════════════════
# Dual-baseline comparison
# ══════════════════════════════════════════════════════════════════════════════


class TestCompareBaselines:

    def test_split_boundaries_are_exact(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, n_years=45, start_year=1981)

        res = compare_baselines(
            ds_path, norm_path, region="test", predictor="tmax", split_year=2000,
        )
        assert res.older.year_start == 1981
        assert res.older.year_end == 1999
        assert res.newer.year_start == 2000
        assert res.newer.year_end == 2025
        assert res.older.n_years + res.newer.n_years == 45

    def test_both_halves_recover_a_uniform_planted_slope(self, tmp_path):
        """The bundle plants one slope for the whole record, so neither half may
        invent a different one and the difference must be ~0."""
        ds_path, norm_path = _make_bundle(tmp_path, slope=-0.5, n_years=45)

        res = compare_baselines(
            ds_path, norm_path, region="test", predictor="tmax", split_year=2000,
        )
        assert res.older.fit.slope == pytest.approx(-0.5, abs=1e-6)
        assert res.newer.fit.slope == pytest.approx(-0.5, abs=1e-6)
        assert res.slope_delta == pytest.approx(0.0, abs=1e-6)
        assert res.slope_changed_significantly is False

    def test_full_record_slope_lies_between_the_two_halves(self, tmp_path):
        """A basic consistency anchor: the pooled slope cannot sit outside both
        half-record slopes."""
        ds_path, norm_path = _make_bundle(
            tmp_path, slope=-0.5, noise=0.7, n_years=45,
        )
        full = compute_sensitivity(
            ds_path, norm_path, region="test", predictor="tmax", season="jjas",
        ).fit.slope
        res = compare_baselines(
            ds_path, norm_path, region="test", predictor="tmax", season="jjas",
            split_year=2000,
        )
        lo = min(res.older.fit.slope, res.newer.fit.slope)
        hi = max(res.older.fit.slope, res.newer.fit.slope)
        assert lo - 1e-9 <= full <= hi + 1e-9

    def test_difference_ci_brackets_the_difference(self, tmp_path):
        ds_path, norm_path = _make_bundle(
            tmp_path, slope=-0.4, noise=0.8, n_years=45,
        )
        res = compare_baselines(
            ds_path, norm_path, region="test", predictor="tmax", split_year=2000,
        )
        assert res.slope_delta_ci95_low < res.slope_delta < res.slope_delta_ci95_high
        assert res.slope_delta_se >= 0

    def test_standard_errors_add_in_quadrature(self, tmp_path):
        """The halves share no years, so this is the correct pooling rule."""
        ds_path, norm_path = _make_bundle(
            tmp_path, slope=-0.4, noise=0.5, n_years=45,
        )
        res = compare_baselines(
            ds_path, norm_path, region="test", predictor="tmax", split_year=2000,
        )
        expected = np.sqrt(
            res.newer.fit.std_err ** 2 + res.older.fit.std_err ** 2
        )
        assert res.slope_delta_se == pytest.approx(expected, rel=1e-9)

    def test_mean_shift_is_newer_minus_older(self, tmp_path):
        ds_path, norm_path = _make_bundle(
            tmp_path, slope=-0.5, noise=0.5, n_years=45,
        )
        res = compare_baselines(
            ds_path, norm_path, region="test", predictor="tmax", split_year=2000,
        )
        assert res.response_mean_delta == pytest.approx(
            res.newer.response_mean - res.older.response_mean, rel=1e-9
        )

    def test_non_significant_difference_says_so(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, slope=-0.5, n_years=45)

        res = compare_baselines(
            ds_path, norm_path, region="test", predictor="tmax", split_year=2000,
        )
        assert any("not statistically significant" in c for c in res.caveats)

    def test_short_half_is_flagged(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, n_years=45, start_year=1981)

        res = compare_baselines(
            ds_path, norm_path, region="test", predictor="tmax", split_year=1990,
        )
        assert res.older.n_years == 9
        assert any("usable years" in c for c in res.caveats)

    def test_split_outside_the_range_raises(self, tmp_path):
        ds_path, norm_path = _make_bundle(tmp_path, n_years=45, start_year=1981)

        with pytest.raises(ValueError, match="split_year"):
            compare_baselines(
                ds_path, norm_path, region="test", predictor="tmax",
                split_year=2100, year_range=(1981, 2025),
            )

    def test_default_split_year_is_inside_the_record(self):
        assert 1981 < DEFAULT_BASELINE_SPLIT_YEAR < 2025

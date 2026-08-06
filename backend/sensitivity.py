"""Empirical climate sensitivity (dR/dT) derived from the observed 1981-2025 record.

This module answers the question the What-If simulator needs to be honest:
*how much does rainfall actually change per degree of warming in this region?*

Everything here is regressed out of the normalized NetCDF bundles that the model
was trained on, so the What-If deltas the UI shows are traceable to observations
rather than to literature constants applied blind. The previous What-If path
applied a fixed Clausius-Clapeyron 7 %/degC coefficient to a `torch.randn` base
field; that produced confident-looking numbers with no empirical support.

Method
------
1. Denormalize the response variable per grid cell (``z * std + mean``) using the
   companion ``norm_params_*.nc``. Per-cell stats matter: Western Ghats
   ``rainfall_mean`` alone spans 0.4-11.9 mm/day, so a single scalar is wrong
   almost everywhere.
2. Reduce both predictor and response to one value per year over a recurring
   calendar window (e.g. JJAS, or a user-picked date range).
3. Ordinary least squares of response on predictor *anomaly* (predictor minus its
   own climatology over the fitted years). The slope is the sensitivity, in
   response-units per predictor-unit.
4. Report the full diagnostic set — r-squared, two-sided p, standard error,
   95 % CI, residuals, n — because a slope without them is not a result. The
   Western Ghats JJAS rainfall-vs-SST fit, for instance, is only p=0.023 with
   r-squared=0.12: real but weak, and the UI must be able to say so.

Data gotchas this module handles explicitly
-------------------------------------------
* Satellite-derived channels (``insat_sst``, ``insat_lst``) are stored in raw
  physical units, *not* z-scores, and carry a companion ``<var>_available`` flag.
  Gap-filled days are written as 0.0, which would drag a naive spatial mean of
  SST from ~28 degC down to ~6 degC. Those cells are masked to NaN before
  averaging.
* Coverage starts mid-record for some channels (OISST begins 1981-09-01), so the
  first season can have almost no valid days. Years whose valid-day count falls
  below ``MIN_COVERAGE_FRACTION`` of the best-covered year are dropped from the
  fit and reported in ``excluded_years`` rather than silently averaged in.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import numpy as np

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

#: A year is kept in the fit only if its valid-predictor-day count reaches this
#: fraction of the best-covered year. Guards against the partial first season of
#: a satellite record (JJAS 1981 has 30 valid SST days vs 122 for every other
#: year) being treated as a full observation.
MIN_COVERAGE_FRACTION = 0.8

#: Named calendar windows. JJAS is the Indian summer monsoon and the only window
#: where a rainfall-temperature sensitivity is physically meaningful at scale.
SEASON_PRESETS: dict[str, tuple[int, int, int, int]] = {
    # name:            (month_start, day_start, month_end, day_end)
    "annual": (1, 1, 12, 31),
    "jjas": (6, 1, 9, 30),      # Southwest monsoon
    "mam": (3, 1, 5, 31),       # Pre-monsoon
    "on": (10, 1, 11, 30),      # Post-monsoon / retreating monsoon
    "djf": (12, 1, 2, 28),      # Winter (wraps the year boundary)
}

#: Variables stored in raw physical units rather than z-scores. Everything else
#: is assumed normalized and is denormalized via norm_params.
RAW_UNIT_VARS = frozenset({"insat_sst", "insat_lst", "uwnd_850", "vwnd_850", "shum_850"})

#: Request-facing predictor/response id → NetCDF variable name.
VARIABLE_ALIASES: dict[str, str] = {
    "tmax": "tmax",
    "temp_max": "tmax",
    "tmin": "tmin",
    "temp_min": "tmin",
    "rainfall": "rainfall",
    "rain": "rainfall",
    "chirps_rain": "chirps_rain",
    "sst": "insat_sst",
    "insat_sst": "insat_sst",
    "lst": "insat_lst",
    "insat_lst": "insat_lst",
}

#: Physical units per NetCDF variable, for labelling slopes as "mm/day per degC".
VARIABLE_UNITS: dict[str, str] = {
    "rainfall": "mm/day",
    "chirps_rain": "mm/day",
    "tmax": "degC",
    "tmin": "degC",
    "insat_sst": "degC",
    "insat_lst": "degC",
}

#: Physically plausible clamps applied after denormalization, matching the bounds
#: /api/predict enforces so sensitivity and forecast agree on what is possible.
PHYSICAL_CLAMPS: dict[str, tuple[float, float]] = {
    "rainfall": (0.0, 500.0),
    "chirps_rain": (0.0, 500.0),
    "tmax": (5.0, 55.0),
    "tmin": (-5.0, 45.0),
    "insat_sst": (-2.0, 40.0),
    "insat_lst": (-20.0, 70.0),
}


def resolve_variable(name: str) -> str:
    """Map a request-facing variable id to its NetCDF name."""
    key = (name or "").strip().lower()
    if key not in VARIABLE_ALIASES:
        raise ValueError(
            f"Unknown variable '{name}'. Valid: {sorted(VARIABLE_ALIASES)}"
        )
    return VARIABLE_ALIASES[key]


# ── Calendar window ───────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CalendarWindow:
    """A recurring annual date range, e.g. 1 Jun - 30 Sep of every year.

    Supports windows that wrap the year boundary (DJF). For those, the season is
    labelled with the year the window *starts* in, so Dec 1998 + Jan/Feb 1999 all
    belong to season 1998 and the winter is not split across two fit points.
    """

    month_start: int = 1
    day_start: int = 1
    month_end: int = 12
    day_end: int = 31
    name: str = "annual"

    @classmethod
    def from_preset(cls, season: str) -> "CalendarWindow":
        key = (season or "annual").strip().lower()
        if key not in SEASON_PRESETS:
            raise ValueError(
                f"Unknown season '{season}'. Valid: {sorted(SEASON_PRESETS)}"
            )
        ms, ds, me, de = SEASON_PRESETS[key]
        return cls(ms, ds, me, de, name=key)

    @classmethod
    def from_dates(cls, start: str, end: str) -> "CalendarWindow":
        """Build a window from two ``MM-DD`` or ``YYYY-MM-DD`` strings."""
        import pandas as pd

        s = pd.Timestamp(start if len(start) > 5 else f"2001-{start}")
        e = pd.Timestamp(end if len(end) > 5 else f"2001-{end}")
        return cls(
            int(s.month), int(s.day), int(e.month), int(e.day),
            name=f"{s.strftime('%d %b')} - {e.strftime('%d %b')}",
        )

    @property
    def wraps_year(self) -> bool:
        return (self.month_start * 100 + self.day_start) > (
            self.month_end * 100 + self.day_end
        )

    @property
    def label(self) -> str:
        if self.name in SEASON_PRESETS:
            return {
                "annual": "Annual (all days)",
                "jjas": "Monsoon JJAS (Jun-Sep)",
                "mam": "Pre-monsoon MAM (Mar-May)",
                "on": "Post-monsoon ON (Oct-Nov)",
                "djf": "Winter DJF (Dec-Feb)",
            }[self.name]
        return self.name

    def mask_and_season_year(self, index: Any) -> tuple[np.ndarray, np.ndarray]:
        """Return ``(in_window, season_year)`` for a pandas DatetimeIndex."""
        month_day = index.month.values * 100 + index.day.values
        lo = self.month_start * 100 + self.day_start
        hi = self.month_end * 100 + self.day_end
        years = index.year.values.astype(np.int64)

        if not self.wraps_year:
            return (month_day >= lo) & (month_day <= hi), years

        in_window = (month_day >= lo) | (month_day <= hi)
        # Days in the tail of the window (Jan/Feb) belong to the previous season.
        season_year = np.where(month_day >= lo, years, years - 1)
        return in_window, season_year


# ── Regression results ────────────────────────────────────────────────────────


@dataclass
class RegressionFit:
    """Ordinary-least-squares fit of a response on a predictor anomaly."""

    slope: float
    intercept: float
    r_squared: float
    p_value: float
    std_err: float
    ci95_low: float
    ci95_high: float
    n: int
    predictor: str
    response: str
    predictor_unit: str
    response_unit: str
    predictor_climatology: float
    response_climatology: float
    #: Slope expressed as % of the response climatology per predictor unit —
    #: the form the UI quotes alongside the Clausius-Clapeyron ~7 %/degC
    #: expectation so a reader can judge whether the fit is physical.
    slope_percent_per_unit: float
    significant: bool

    @property
    def slope_unit(self) -> str:
        return f"{self.response_unit} per {self.predictor_unit}"

    def predict(self, predictor_anomaly: float | np.ndarray) -> Any:
        return self.intercept + self.slope * predictor_anomaly

    def to_dict(self) -> dict[str, Any]:
        return {
            "slope": _f(self.slope),
            "intercept": _f(self.intercept),
            "r_squared": _f(self.r_squared),
            "p_value": _f(self.p_value),
            "std_err": _f(self.std_err),
            "ci95_low": _f(self.ci95_low),
            "ci95_high": _f(self.ci95_high),
            "n": int(self.n),
            "predictor": self.predictor,
            "response": self.response,
            "predictor_unit": self.predictor_unit,
            "response_unit": self.response_unit,
            "slope_unit": self.slope_unit,
            "predictor_climatology": _f(self.predictor_climatology),
            "response_climatology": _f(self.response_climatology),
            "slope_percent_per_unit": _f(self.slope_percent_per_unit),
            "significant": bool(self.significant),
        }


@dataclass
class YearPoint:
    """One (predictor, response) observation in the regression scatter."""

    year: int
    predictor_value: float
    predictor_anomaly: float
    response_value: float
    fitted_value: float
    residual: float
    valid_days: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "year": int(self.year),
            "predictor_value": _f(self.predictor_value),
            "predictor_anomaly": _f(self.predictor_anomaly),
            "response_value": _f(self.response_value),
            "fitted_value": _f(self.fitted_value),
            "residual": _f(self.residual),
            "valid_days": int(self.valid_days),
        }


@dataclass
class SensitivityResult:
    """Regional fit plus the per-cell slope field it was aggregated from."""

    region: str
    window: CalendarWindow
    fit: RegressionFit
    points: list[YearPoint]
    lats: list[float]
    lons: list[float]
    #: Per-cell dR/dT, row-major (lat_i * nlon + lon_j) to match
    #: ClimateGraphBuilder's node ordering.
    cell_slope: list[float]
    cell_std_err: list[float]
    cell_r_squared: list[float]
    cell_p_value: list[float]
    cell_baseline: list[float]
    excluded_years: list[int]
    provenance: dict[str, Any] = field(default_factory=dict)
    #: (n_years, n_cells) annual response means, kept in memory for epoch
    #: baselines. Never serialized — a 0.5 deg full-India grid would add ~196k
    #: floats to every response for data the client cannot use directly.
    cell_annual: np.ndarray | None = field(default=None, repr=False)
    #: Fitted years aligned with `cell_annual` rows.
    years: np.ndarray | None = field(default=None, repr=False)

    def to_dict(self, include_cells: bool = True) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "region": self.region,
            "season": self.window.name,
            "season_label": self.window.label,
            "fit": self.fit.to_dict(),
            "points": [p.to_dict() for p in self.points],
            "excluded_years": [int(y) for y in self.excluded_years],
            "provenance": self.provenance,
        }
        if include_cells:
            payload |= {
                "lats": [_f(v) for v in self.lats],
                "lons": [_f(v) for v in self.lons],
                "cell_slope": [_f(v) for v in self.cell_slope],
                "cell_std_err": [_f(v) for v in self.cell_std_err],
                "cell_r_squared": [_f(v) for v in self.cell_r_squared],
                "cell_p_value": [_f(v) for v in self.cell_p_value],
                "cell_baseline": [_f(v) for v in self.cell_baseline],
            }
        return payload


def _f(value: Any) -> float | None:
    """JSON-safe float: NaN/inf become None rather than invalid JSON literals."""
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if np.isfinite(out) else None


# ── Core OLS ──────────────────────────────────────────────────────────────────


def fit_ols(x: np.ndarray, y: np.ndarray) -> tuple[float, float, float, float, float]:
    """Least-squares fit of ``y`` on ``x``.

    Returns ``(slope, intercept, r_squared, p_value, std_err)``. Kept separate
    from :func:`fit_ols_per_cell` because scipy's two-sided t-test is the
    reference implementation for the headline number the UI quotes.
    """
    from scipy import stats

    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    good = np.isfinite(x) & np.isfinite(y)
    if good.sum() < 3:
        return float("nan"), float("nan"), float("nan"), float("nan"), float("nan")

    res = stats.linregress(x[good], y[good])
    return (
        float(res.slope), float(res.intercept),
        float(res.rvalue) ** 2, float(res.pvalue), float(res.stderr),
    )


def fit_ols_per_cell(
    x: np.ndarray, Y: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Regress every column of ``Y`` (n_years, n_cells) on the shared ``x``.

    Vectorized rather than looped: a 0.5 deg full-India grid is 4,352 cells, and
    calling scipy per cell turns a sub-second reduction into ~20 s. The closed
    form is identical to OLS; the p-value uses the same two-sided t statistic
    with n-2 degrees of freedom.

    Returns ``(slope, std_err, r_squared, p_value)``, each shaped (n_cells,).
    Cells with fewer than 3 finite years come back as NaN.
    """
    from scipy import stats

    x = np.asarray(x, dtype=np.float64)
    Y = np.asarray(Y, dtype=np.float64)
    n_years, n_cells = Y.shape

    nan = np.full(n_cells, np.nan)
    if n_years < 3:
        return nan, nan.copy(), nan.copy(), nan.copy()

    finite = np.isfinite(Y) & np.isfinite(x)[:, None]
    counts = finite.sum(axis=0)

    # Zero-fill so the sums below stay finite; `counts` keeps the bookkeeping
    # honest and cells that never had enough data are masked out at the end.
    Yz = np.where(finite, Y, 0.0)
    Xz = np.where(finite, x[:, None], 0.0)

    with np.errstate(invalid="ignore", divide="ignore"):
        n = counts.astype(np.float64)
        sum_x = Xz.sum(axis=0)
        sum_y = Yz.sum(axis=0)
        mean_x = sum_x / n
        mean_y = sum_y / n

        dx = np.where(finite, Xz - mean_x, 0.0)
        dy = np.where(finite, Yz - mean_y, 0.0)
        sxx = (dx * dx).sum(axis=0)
        sxy = (dx * dy).sum(axis=0)
        syy = (dy * dy).sum(axis=0)

        slope = sxy / sxx
        sse = np.maximum(syy - slope * sxy, 0.0)   # residual sum of squares
        dof = n - 2.0
        std_err = np.sqrt((sse / dof) / sxx)
        r_squared = np.where(syy > 0, 1.0 - sse / syy, np.nan)

        t_stat = np.divide(slope, std_err, out=np.full(n_cells, np.nan), where=std_err > 0)
        p_value = 2.0 * stats.t.sf(np.abs(t_stat), np.maximum(dof, 1.0))

    invalid = (counts < 3) | ~np.isfinite(sxx) | (sxx <= 0)
    for arr in (slope, std_err, r_squared, p_value):
        arr[invalid] = np.nan

    return slope, std_err, np.clip(r_squared, 0.0, 1.0), p_value


def t_critical_95(dof: int) -> float:
    """Two-sided 95 % t critical value, falling back to the normal 1.96."""
    if dof < 1:
        return 1.96
    from scipy import stats

    return float(stats.t.ppf(0.975, dof))


# ── Dataset access ────────────────────────────────────────────────────────────


@dataclass
class _FieldSeries:
    """A denormalized daily field reduced to per-year values."""

    years: np.ndarray            # (n_years,)
    regional: np.ndarray         # (n_years,) area mean
    per_cell: np.ndarray         # (n_years, n_cells)
    valid_days: np.ndarray       # (n_years,)
    unit: str


def _load_norm_params(norm_path: Path | None) -> dict[str, np.ndarray]:
    """Load per-cell mean/std arrays, flattened row-major. Empty dict if absent."""
    if not norm_path or not Path(norm_path).exists():
        return {}
    import xarray as xr

    out: dict[str, np.ndarray] = {}
    try:
        with xr.open_dataset(norm_path) as ds:
            for name in ds.data_vars:
                out[str(name)] = ds[name].values.astype(np.float64).reshape(-1)
    except Exception as exc:
        logger.warning("Could not read norm params %s: %s", norm_path, exc)
    return out


def _denormalize(
    var: str, values: np.ndarray, norm_params: dict[str, np.ndarray]
) -> np.ndarray:
    """Convert a (time, n_cells) block to physical units.

    Raw-unit satellite channels pass through. Normalized channels are scaled by
    the per-cell climatology; if it is missing the values are returned as-is and
    the caller reports ``denormalized: False`` in provenance rather than
    inventing scalar constants.
    """
    if var in RAW_UNIT_VARS:
        return values

    mean = norm_params.get(f"{var}_mean")
    std = norm_params.get(f"{var}_std")
    if mean is None or std is None or mean.shape[0] != values.shape[1]:
        logger.warning(
            "No per-cell norm params for '%s' — values stay in z-score units", var
        )
        return values

    std_safe = np.where(np.isfinite(std) & (std > 0), std, np.nan)
    return values * std_safe[None, :] + mean[None, :]


def _extract_series(
    ds: Any,
    var: str,
    window: CalendarWindow,
    norm_params: dict[str, np.ndarray],
    year_range: tuple[int, int] | None,
    weights: np.ndarray,
) -> _FieldSeries:
    """Reduce one NetCDF variable to per-year regional and per-cell means.

    Reads and reduces ONE SEASON AT A TIME rather than materializing the whole
    calendar window.

    The previous implementation pulled every in-window day into a single float64
    block and then produced roughly five more arrays of that same size (the
    availability mask, the denormalized product, the clip, and the `np.where`
    that recombined them). For the 0.5 deg full-India bundle an `annual` window is
    16,436 days x 4,288 cells x 8 bytes = 564 MB per array, and
    :func:`compute_sensitivity` calls this twice (predictor and response), so the
    peak ran to several GB and the process was killed before it could answer.
    Since every day is ultimately collapsed into a per-year mean, none of that
    needs to be resident at once: reducing per season-year bounds the peak to a
    single season (~13 MB at 0.5 deg) and leaves the returned values identical.
    """
    import pandas as pd

    if var not in ds.data_vars:
        raise ValueError(f"Variable '{var}' not present in dataset")

    index = pd.DatetimeIndex(ds.time.values)
    in_window, season_year = window.mask_and_season_year(index)

    if year_range:
        lo, hi = year_range
        in_window &= (season_year >= lo) & (season_year <= hi)

    if not in_window.any():
        raise ValueError(
            f"No days fall inside window '{window.label}' for the requested years"
        )

    time_idx = np.flatnonzero(in_window)
    season_years = season_year[time_idx]
    unique_years = np.unique(season_years)

    # Gap-filled days are stored as 0.0 with a companion availability flag, which
    # would otherwise pull a 28 degC SST mean toward zero.
    flag_name = f"{var}_available"
    has_flag = flag_name in ds.data_vars

    lo_clamp, hi_clamp = PHYSICAL_CLAMPS.get(var, (-np.inf, np.inf))
    should_clamp = var not in RAW_UNIT_VARS or f"{var}_mean" in norm_params

    n_cells = int(np.prod(ds[var].shape[1:]))

    regional = np.full(unique_years.shape[0], np.nan)
    per_cell = np.full((unique_years.shape[0], n_cells), np.nan)
    valid_days = np.zeros(unique_years.shape[0], dtype=np.int64)

    w = weights / np.nansum(weights) if np.nansum(weights) > 0 else weights
    finite_w = np.isfinite(w)

    for i, year in enumerate(unique_years):
        rows = time_idx[season_years == year]
        if rows.size == 0:
            continue

        with NETCDF_LOCK:
            chunk = ds[var].isel(time=rows).values.astype(np.float64).reshape(rows.size, -1)
            if has_flag:
                flag = ds[flag_name].isel(time=rows).values.reshape(rows.size, -1)
            else:
                flag = None

        if flag is not None:
            # In place, so the mask does not cost another array of chunk size.
            chunk[flag <= 0.5] = np.nan
            del flag

        chunk = _denormalize(var, chunk, norm_params)

        if should_clamp:
            # np.clip propagates NaN, so this matches the previous
            # "clip where finite, else NaN" behaviour without a second copy.
            np.clip(chunk, lo_clamp, hi_clamp, out=chunk)

        finite = np.isfinite(chunk)
        if not finite.any():
            continue
        # Any day with at least one valid cell counts toward coverage.
        valid_days[i] = int(finite.any(axis=1).sum())
        del finite

        with np.errstate(invalid="ignore"):
            per_cell[i] = np.nanmean(chunk, axis=0)
            # Cosine-latitude weighted so a 0.5 deg full-India mean is not biased
            # toward the Himalaya, where cells cover less ground.
            cell_means = per_cell[i]
            ok = np.isfinite(cell_means) & finite_w
            regional[i] = float(np.sum(cell_means[ok] * w[ok]) / np.sum(w[ok])) if ok.any() else np.nan

        del chunk

    return _FieldSeries(
        years=unique_years,
        regional=regional,
        per_cell=per_cell,
        valid_days=valid_days,
        unit=VARIABLE_UNITS.get(var, ""),
    )


def _area_weights(lats: np.ndarray, n_lon: int) -> np.ndarray:
    """Row-major cos(lat) weights matching the flattened cell ordering."""
    cos_lat = np.cos(np.deg2rad(np.asarray(lats, dtype=np.float64)))
    cos_lat = np.clip(cos_lat, 1e-6, None)
    return np.repeat(cos_lat, n_lon)


#: Serializes every NetCDF/HDF5 open and read in this process.
#:
#: The libhdf5 that netCDF4 links against is normally built without thread
#: safety, and FastAPI runs these endpoints through `asyncio.to_thread`, so a
#: sensitivity fit and a prediction can touch the library concurrently. That
#: raised "NetCDF: HDF error" mid-request, and because the callers treat a read
#: failure as "no real data" the endpoint then answered with a synthetic grid
#: under HTTP 200 - a wrong answer wearing a correct one's clothes.
#: `backend.main` binds its own `_netcdf_lock` to this object so both modules
#: serialize against the same lock rather than two independent ones.
NETCDF_LOCK = threading.Lock()


#: Bounded deliberately. Every entry is an open handle whose HDF5 chunk cache
#: grows with the variables actually read, and the full-India bundle is a 900 MB
#: file, so a large cache is a slow memory leak rather than a speed-up. Two is
#: enough to keep a predictor/response pair of one region warm.
@lru_cache(maxsize=2)
def _open_dataset(path: str) -> Any:
    import xarray as xr

    with NETCDF_LOCK:
        return xr.open_dataset(path)


# ── Public entry point ────────────────────────────────────────────────────────


def compute_sensitivity(
    dataset_path: str | Path,
    norm_params_path: str | Path | None = None,
    *,
    region: str = "unknown",
    predictor: str = "sst",
    response: str = "rainfall",
    season: str = "jjas",
    window: CalendarWindow | None = None,
    year_range: tuple[int, int] | None = None,
) -> SensitivityResult:
    """Regress ``response`` on ``predictor`` over the observed record.

    Args:
        dataset_path: ``normalized_*.nc`` for the region.
        norm_params_path: companion ``norm_params_*.nc``. Derived from
            ``dataset_path`` when omitted.
        predictor: driver variable id (``sst``, ``tmax``, ``tmin``, ``lst``).
        response: responding variable id (usually ``rainfall``).
        season: preset name; ignored when ``window`` is given.
        window: explicit calendar range, overriding ``season``.
        year_range: inclusive ``(start_year, end_year)`` filter.

    Returns:
        A :class:`SensitivityResult` carrying the regional fit, the yearly
        scatter, and the per-cell slope field.
    """
    dataset_path = str(dataset_path)
    if norm_params_path is None:
        candidate = Path(dataset_path.replace("normalized_", "norm_params_"))
        norm_params_path = candidate if candidate.exists() else None

    pred_var = resolve_variable(predictor)
    resp_var = resolve_variable(response)
    win = window or CalendarWindow.from_preset(season)

    ds = _open_dataset(dataset_path)
    norm_params = _load_norm_params(Path(norm_params_path) if norm_params_path else None)

    lats = np.asarray(ds.lat.values, dtype=np.float64)
    lons = np.asarray(ds.lon.values, dtype=np.float64)
    weights = _area_weights(lats, lons.shape[0])

    pred_series = _extract_series(ds, pred_var, win, norm_params, year_range, weights)
    resp_series = _extract_series(ds, resp_var, win, norm_params, year_range, weights)

    # Align on the intersection of years, then drop under-covered seasons.
    common = np.intersect1d(pred_series.years, resp_series.years)
    p_sel = np.searchsorted(pred_series.years, common)
    r_sel = np.searchsorted(resp_series.years, common)

    pred_regional = pred_series.regional[p_sel]
    resp_regional = resp_series.regional[r_sel]
    resp_cells = resp_series.per_cell[r_sel]
    pred_days = pred_series.valid_days[p_sel]
    resp_days = resp_series.valid_days[r_sel]

    best_coverage = max(int(pred_days.max(initial=0)), int(resp_days.max(initial=0)))
    threshold = MIN_COVERAGE_FRACTION * best_coverage
    keep = (
        (pred_days >= threshold)
        & (resp_days >= threshold)
        & np.isfinite(pred_regional)
        & np.isfinite(resp_regional)
    )
    excluded_years = [int(y) for y in common[~keep]]
    if excluded_years:
        logger.info(
            "Sensitivity %s/%s %s: excluded %d under-covered year(s): %s",
            region, pred_var, win.name, len(excluded_years), excluded_years,
        )

    years = common[keep]
    pred_regional = pred_regional[keep]
    resp_regional = resp_regional[keep]
    resp_cells = resp_cells[keep]
    pred_days = pred_days[keep]

    if years.shape[0] < 3:
        raise ValueError(
            f"Only {years.shape[0]} usable year(s) for {region}/{pred_var}→{resp_var} "
            f"over {win.label}; need at least 3 to regress"
        )

    # Predictor anomaly relative to its own climatology over the fitted years,
    # so the intercept reads as "response at average conditions".
    pred_clim = float(np.nanmean(pred_regional))
    pred_anomaly = pred_regional - pred_clim
    resp_clim = float(np.nanmean(resp_regional))

    slope, intercept, r_squared, p_value, std_err = fit_ols(pred_anomaly, resp_regional)
    dof = int(years.shape[0]) - 2
    t_crit = t_critical_95(dof)
    half_width = t_crit * std_err if np.isfinite(std_err) else float("nan")

    fit = RegressionFit(
        slope=slope,
        intercept=intercept,
        r_squared=r_squared,
        p_value=p_value,
        std_err=std_err,
        ci95_low=slope - half_width,
        ci95_high=slope + half_width,
        n=int(years.shape[0]),
        predictor=pred_var,
        response=resp_var,
        predictor_unit=pred_series.unit,
        response_unit=resp_series.unit,
        predictor_climatology=pred_clim,
        response_climatology=resp_clim,
        slope_percent_per_unit=(100.0 * slope / resp_clim) if resp_clim else float("nan"),
        significant=bool(np.isfinite(p_value) and p_value < 0.05),
    )

    fitted = fit.predict(pred_anomaly)
    points = [
        YearPoint(
            year=int(years[i]),
            predictor_value=float(pred_regional[i]),
            predictor_anomaly=float(pred_anomaly[i]),
            response_value=float(resp_regional[i]),
            fitted_value=float(fitted[i]),
            residual=float(resp_regional[i] - fitted[i]),
            valid_days=int(pred_days[i]),
        )
        for i in range(years.shape[0])
    ]

    cell_slope, cell_std_err, cell_r2, cell_p = fit_ols_per_cell(pred_anomaly, resp_cells)
    with np.errstate(invalid="ignore"):
        cell_baseline = np.nanmean(resp_cells, axis=0)

    return SensitivityResult(
        region=region,
        window=win,
        fit=fit,
        points=points,
        lats=lats.tolist(),
        lons=lons.tolist(),
        cell_slope=cell_slope.tolist(),
        cell_std_err=cell_std_err.tolist(),
        cell_r_squared=cell_r2.tolist(),
        cell_p_value=cell_p.tolist(),
        cell_baseline=cell_baseline.tolist(),
        excluded_years=excluded_years,
        cell_annual=resp_cells,
        years=years,
        provenance={
            "dataset": Path(dataset_path).name,
            "norm_params": Path(norm_params_path).name if norm_params_path else None,
            "denormalized": bool(norm_params) or resp_var in RAW_UNIT_VARS,
            "method": "ordinary least squares on annual means of the calendar window",
            "predictor_masked_by_availability": f"{pred_var}_available" in ds.data_vars,
            "area_weighting": "cos(latitude)",
            "min_coverage_fraction": MIN_COVERAGE_FRACTION,
            "year_first": int(years.min()),
            "year_last": int(years.max()),
            "grid_shape": [int(lats.shape[0]), int(lons.shape[0])],
            "source": "observations (IMD gridded + CHIRPS + NOAA OISST + NCEP), 1981-2025",
        },
    )


# ── Before / after projection ─────────────────────────────────────────────────

#: Mean Earth radius used for cell areas (km).
EARTH_RADIUS_KM = 6371.0088


def cell_areas_km2(lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """Row-major area of every grid cell in km^2.

    Uses the exact spherical-band area rather than a flat cos(lat) approximation
    so the domain-integrated rainfall change is a defensible volume:
    ``A = R^2 * dlon_rad * (sin(lat_north) - sin(lat_south))``.
    """
    lats = np.asarray(lats, dtype=np.float64)
    lons = np.asarray(lons, dtype=np.float64)

    dlat = float(np.abs(np.diff(lats)).mean()) if lats.size > 1 else 0.25
    dlon = float(np.abs(np.diff(lons)).mean()) if lons.size > 1 else 0.25

    north = np.deg2rad(np.clip(lats + dlat / 2.0, -90.0, 90.0))
    south = np.deg2rad(np.clip(lats - dlat / 2.0, -90.0, 90.0))
    band = (EARTH_RADIUS_KM ** 2) * np.deg2rad(dlon) * (np.sin(north) - np.sin(south))
    return np.repeat(np.abs(band), lons.shape[0])


@dataclass
class EpochSummary:
    """Observed or projected state of the region over one time slice."""

    id: Literal["past", "current", "future"] | str
    label: str
    year_start: int | None
    year_end: int | None
    value: float
    #: +/- half-width of the 95 % interval. Observed epochs use the interannual
    #: standard error of the mean; the projected epoch propagates the regression
    #: slope uncertainty, which is a different kind of uncertainty and is
    #: labelled as such by `uncertainty_kind`.
    uncertainty: float
    uncertainty_kind: Literal["observed_sem", "regression_ci", "none"]
    observed: bool
    delta_vs_current: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "year_start": self.year_start,
            "year_end": self.year_end,
            "value": _f(self.value),
            "uncertainty": _f(self.uncertainty),
            "uncertainty_kind": self.uncertainty_kind,
            "observed": bool(self.observed),
            "delta_vs_current": _f(self.delta_vs_current),
        }


@dataclass
class ScenarioProjection:
    """A complete before/after answer for one predictor perturbation."""

    region: str
    window: CalendarWindow
    delta_predictor: float
    fit: RegressionFit

    # Regional aggregates
    baseline_value: float
    scenario_value: float
    delta_value: float
    delta_percent: float
    delta_ci95_low: float
    delta_ci95_high: float

    # Domain integral: the mentor's F_m = integral of (dR/dT * dT) over the area.
    baseline_volume_km3: float
    delta_volume_km3: float
    area_km2: float

    # Per-cell fields, row-major
    cell_baseline: list[float]
    cell_scenario: list[float]
    cell_delta: list[float]
    cell_delta_percent: list[float]
    cell_delta_uncertainty: list[float]
    cell_significant: list[bool]
    lats: list[float]
    lons: list[float]

    # Timeline
    epochs: list[EpochSummary]

    # Distribution / hotspot analytics
    cells_wetter: int
    cells_drier: int
    cells_significant: int
    cells_total: int
    hotspots: list[dict[str, Any]]
    clamped_cells: int
    caveats: list[str]
    provenance: dict[str, Any]

    def to_dict(self, include_cells: bool = True) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "region": self.region,
            "season": self.window.name,
            "season_label": self.window.label,
            "delta_predictor": _f(self.delta_predictor),
            "fit": self.fit.to_dict(),
            "regional": {
                "baseline": _f(self.baseline_value),
                "scenario": _f(self.scenario_value),
                "delta": _f(self.delta_value),
                "delta_percent": _f(self.delta_percent),
                "delta_ci95_low": _f(self.delta_ci95_low),
                "delta_ci95_high": _f(self.delta_ci95_high),
                "unit": self.fit.response_unit,
            },
            "integral": {
                "baseline_volume_km3": _f(self.baseline_volume_km3),
                "delta_volume_km3": _f(self.delta_volume_km3),
                "area_km2": _f(self.area_km2),
                "definition": (
                    "area integral of the per-cell sensitivity times the applied "
                    "predictor change, over the length of the calendar window"
                ),
            },
            "epochs": [e.to_dict() for e in self.epochs],
            "distribution": {
                "cells_wetter": self.cells_wetter,
                "cells_drier": self.cells_drier,
                "cells_significant": self.cells_significant,
                "cells_total": self.cells_total,
                "clamped_cells": self.clamped_cells,
            },
            "hotspots": self.hotspots,
            "caveats": self.caveats,
            "provenance": self.provenance,
        }
        if include_cells:
            payload |= {
                "lats": [_f(v) for v in self.lats],
                "lons": [_f(v) for v in self.lons],
                "cell_baseline": [_f(v) for v in self.cell_baseline],
                "cell_scenario": [_f(v) for v in self.cell_scenario],
                "cell_delta": [_f(v) for v in self.cell_delta],
                "cell_delta_percent": [_f(v) for v in self.cell_delta_percent],
                "cell_delta_uncertainty": [_f(v) for v in self.cell_delta_uncertainty],
                "cell_significant": [bool(v) for v in self.cell_significant],
            }
        return payload


def _epoch_mean(
    years: np.ndarray, values: np.ndarray, lo: int, hi: int
) -> tuple[float, float, int]:
    """Mean, standard error of the mean, and count for years in ``[lo, hi]``."""
    sel = (years >= lo) & (years <= hi) & np.isfinite(values)
    n = int(sel.sum())
    if n == 0:
        return float("nan"), float("nan"), 0
    vals = values[sel]
    mean = float(np.mean(vals))
    if n < 2:
        return mean, float("nan"), n
    sem = float(np.std(vals, ddof=1) / np.sqrt(n))
    return mean, sem * t_critical_95(n - 1), n


def project_scenario(
    result: SensitivityResult,
    delta_predictor: float,
    *,
    past_years: tuple[int, int] | None = None,
    current_years: tuple[int, int] | None = None,
    future_label: str | None = None,
    hotspot_percentile: float = 90.0,
    max_hotspots: int = 20,
) -> ScenarioProjection:
    """Apply a predictor change through the fitted sensitivity field.

    The scenario response is ``baseline + slope_cell * delta_predictor``, clamped
    to the variable's physical range. Uncertainty is propagated from the
    regression standard error (``t95 * se_cell * |delta|``), which is why the
    per-cell standard errors are carried on :class:`SensitivityResult` — a delta
    without an error bar is indistinguishable from a guess, and for most cells
    here the error bar overlaps zero.

    Past / current / future are *not* three model runs. Past and current are
    observed means over two slices of the record; only future applies the
    perturbation. This keeps the timeline honest about which bars are
    measurements and which is an extrapolation.
    """
    if result.years is None or result.cell_annual is None:
        raise ValueError("SensitivityResult is missing the annual field needed to project")

    years = np.asarray(result.years)
    cell_annual = np.asarray(result.cell_annual, dtype=np.float64)
    fit = result.fit
    resp_var = fit.response

    slope = np.asarray(result.cell_slope, dtype=np.float64)
    slope_se = np.asarray(result.cell_std_err, dtype=np.float64)
    cell_p = np.asarray(result.cell_p_value, dtype=np.float64)
    baseline = np.asarray(result.cell_baseline, dtype=np.float64)

    lats = np.asarray(result.lats, dtype=np.float64)
    lons = np.asarray(result.lons, dtype=np.float64)

    # ── Epoch windows ─────────────────────────────────────────────────────────
    y_min, y_max = int(years.min()), int(years.max())
    span = y_max - y_min + 1
    # Default: first and last thirds of the record, so "past" and "current" are
    # comparable-length observed slices rather than arbitrary cut points.
    third = max(5, span // 3)
    past = past_years or (y_min, y_min + third - 1)
    current = current_years or (y_max - third + 1, y_max)

    # ── Per-cell projection ───────────────────────────────────────────────────
    with np.errstate(invalid="ignore"):
        raw_delta = slope * delta_predictor
        scenario = baseline + raw_delta

    lo_clamp, hi_clamp = PHYSICAL_CLAMPS.get(resp_var, (-np.inf, np.inf))
    clamped_scenario = np.clip(scenario, lo_clamp, hi_clamp)
    clamped_cells = int(np.sum(np.isfinite(scenario) & (clamped_scenario != scenario)))
    scenario = clamped_scenario
    # Recompute the delta after clamping so scenario - baseline always holds.
    cell_delta = scenario - baseline

    with np.errstate(invalid="ignore", divide="ignore"):
        cell_delta_pct = np.where(
            np.abs(baseline) > 1e-6, 100.0 * cell_delta / baseline, np.nan
        )

    dof = max(fit.n - 2, 1)
    cell_uncertainty = t_critical_95(dof) * slope_se * abs(delta_predictor)
    cell_significant = np.isfinite(cell_p) & (cell_p < 0.05)

    finite = np.isfinite(cell_delta)
    cells_total = int(finite.sum())
    cells_wetter = int(np.sum(finite & (cell_delta > 0)))
    cells_drier = int(np.sum(finite & (cell_delta < 0)))

    # ── Regional aggregate (area weighted, land cells only) ───────────────────
    areas = cell_areas_km2(lats, lons)
    valid = finite & np.isfinite(baseline) & np.isfinite(areas)
    w = areas[valid]
    total_area = float(w.sum())

    baseline_value = float(np.sum(baseline[valid] * w) / total_area) if total_area else float("nan")
    scenario_value = float(np.sum(scenario[valid] * w) / total_area) if total_area else float("nan")
    delta_value = scenario_value - baseline_value
    delta_percent = (
        100.0 * delta_value / baseline_value if baseline_value not in (0.0,) and np.isfinite(baseline_value) else float("nan")
    )

    # Regional CI comes from the regional fit, not from averaging per-cell CIs:
    # per-cell errors are spatially correlated, so averaging them would
    # understate the true interval.
    t95 = t_critical_95(dof)
    regional_half = t95 * fit.std_err * abs(delta_predictor) if np.isfinite(fit.std_err) else float("nan")
    regional_delta_fit = fit.slope * delta_predictor

    # ── Domain integral (the mentor's F_m term) ───────────────────────────────
    window_days = _window_length_days(result.window)
    # mm/day over km^2 for N days -> km^3:  mm = 1e-6 km, km^2 * 1e-6 km = km^3
    mm_day_km2_to_km3 = 1e-6 * window_days
    delta_volume_km3 = float(np.nansum(cell_delta[valid] * w) * mm_day_km2_to_km3)
    baseline_volume_km3 = float(np.nansum(baseline[valid] * w) * mm_day_km2_to_km3)

    # ── Timeline ──────────────────────────────────────────────────────────────
    regional_annual = _area_weighted_annual(cell_annual, areas)
    past_mean, past_unc, past_n = _epoch_mean(years, regional_annual, *past)
    curr_mean, curr_unc, curr_n = _epoch_mean(years, regional_annual, *current)

    future_value = curr_mean + regional_delta_fit
    if resp_var in PHYSICAL_CLAMPS:
        future_value = float(np.clip(future_value, *PHYSICAL_CLAMPS[resp_var]))

    sign = "+" if delta_predictor >= 0 else ""
    label = future_label or (
        f"Projected at {sign}{delta_predictor:g} {fit.predictor_unit} {fit.predictor.replace('insat_', '').upper()}"
    )

    epochs = [
        EpochSummary(
            id="past", label=f"Past ({past[0]}-{past[1]})",
            year_start=past[0], year_end=past[1],
            value=past_mean, uncertainty=past_unc,
            uncertainty_kind="observed_sem" if past_n >= 2 else "none",
            observed=True, delta_vs_current=past_mean - curr_mean,
        ),
        EpochSummary(
            id="current", label=f"Current ({current[0]}-{current[1]})",
            year_start=current[0], year_end=current[1],
            value=curr_mean, uncertainty=curr_unc,
            uncertainty_kind="observed_sem" if curr_n >= 2 else "none",
            observed=True, delta_vs_current=0.0,
        ),
        EpochSummary(
            id="future", label=label,
            year_start=None, year_end=None,
            value=future_value, uncertainty=regional_half,
            uncertainty_kind="regression_ci" if np.isfinite(regional_half) else "none",
            observed=False, delta_vs_current=future_value - curr_mean,
        ),
    ]

    # ── Hotspots ──────────────────────────────────────────────────────────────
    hotspots = _build_hotspots(
        cell_delta, cell_delta_pct, cell_significant, lats, lons,
        percentile=hotspot_percentile, limit=max_hotspots,
    )

    # ── Caveats: state the limits in the payload, not just the docs ───────────
    caveats: list[str] = []
    if not fit.significant:
        caveats.append(
            f"The regional fit is not statistically significant (p={fit.p_value:.3f}); "
            "treat the projected change as indicative only."
        )
    if np.isfinite(fit.r_squared) and fit.r_squared < 0.3:
        caveats.append(
            f"The predictor explains only {100 * fit.r_squared:.0f}% of interannual "
            f"variance in {resp_var}; unexplained variability dominates."
        )
    caveats.append(
        "The slope is an observed co-variability relationship, not an isolated "
        "causal response: hot and dry monsoon seasons reinforce each other, so the "
        "sensitivity bundles both directions of that feedback."
    )
    if clamped_cells:
        caveats.append(
            f"{clamped_cells} cell(s) were clamped to the physical range "
            f"[{lo_clamp:g}, {hi_clamp:g}] {fit.response_unit}."
        )
    if abs(delta_predictor) > 2.0 * np.nanstd(
        [p.predictor_anomaly for p in result.points] or [1.0]
    ):
        caveats.append(
            f"A {delta_predictor:+g} {fit.predictor_unit} change is outside the range "
            "observed in the record, so the projection extrapolates beyond the fit."
        )

    return ScenarioProjection(
        region=result.region,
        window=result.window,
        delta_predictor=float(delta_predictor),
        fit=fit,
        baseline_value=baseline_value,
        scenario_value=scenario_value,
        delta_value=delta_value,
        delta_percent=delta_percent,
        delta_ci95_low=regional_delta_fit - regional_half,
        delta_ci95_high=regional_delta_fit + regional_half,
        baseline_volume_km3=baseline_volume_km3,
        delta_volume_km3=delta_volume_km3,
        area_km2=total_area,
        cell_baseline=baseline.tolist(),
        cell_scenario=scenario.tolist(),
        cell_delta=cell_delta.tolist(),
        cell_delta_percent=cell_delta_pct.tolist(),
        cell_delta_uncertainty=cell_uncertainty.tolist(),
        cell_significant=cell_significant.tolist(),
        lats=lats.tolist(),
        lons=lons.tolist(),
        epochs=epochs,
        cells_wetter=cells_wetter,
        cells_drier=cells_drier,
        cells_significant=int(np.sum(cell_significant & finite)),
        cells_total=cells_total,
        hotspots=hotspots,
        clamped_cells=clamped_cells,
        caveats=caveats,
        provenance=result.provenance | {
            "projection": "per-cell OLS slope applied to the requested predictor change",
            "window_days": window_days,
            "past_epoch": list(past),
            "current_epoch": list(current),
        },
    )


def _window_length_days(window: CalendarWindow) -> int:
    """Number of calendar days the recurring window covers in a common year."""
    import pandas as pd

    days = pd.date_range("2001-01-01", "2001-12-31", freq="D")
    in_window, _ = window.mask_and_season_year(pd.DatetimeIndex(days))
    return int(in_window.sum())


def _area_weighted_annual(cell_annual: np.ndarray, areas: np.ndarray) -> np.ndarray:
    """Collapse (n_years, n_cells) to (n_years,) with area weighting."""
    out = np.full(cell_annual.shape[0], np.nan)
    for i in range(cell_annual.shape[0]):
        row = cell_annual[i]
        ok = np.isfinite(row) & np.isfinite(areas)
        if ok.any():
            out[i] = float(np.sum(row[ok] * areas[ok]) / np.sum(areas[ok]))
    return out


def _build_hotspots(
    cell_delta: np.ndarray,
    cell_delta_pct: np.ndarray,
    cell_significant: np.ndarray,
    lats: np.ndarray,
    lons: np.ndarray,
    *,
    percentile: float,
    limit: int,
) -> list[dict[str, Any]]:
    """Rank the strongest-response cells, preferring statistically robust ones.

    Only significant cells are eligible when there are enough of them. Ranking
    purely by |delta| would surface the noisiest cells, which is how a hotspot
    map ends up highlighting places the data cannot actually speak to.
    """
    n_lon = lons.shape[0]
    finite = np.isfinite(cell_delta)
    if not finite.any():
        return []

    eligible = finite & cell_significant
    basis = "significant cells (p<0.05)"
    if eligible.sum() < limit:
        eligible = finite
        basis = "all cells with data (too few significant cells to rank)"

    abs_delta = np.where(eligible, np.abs(cell_delta), np.nan)
    threshold = float(np.nanpercentile(abs_delta, percentile))
    candidates = np.flatnonzero(np.nan_to_num(abs_delta, nan=-1.0) >= threshold)
    order = candidates[np.argsort(-abs_delta[candidates])][:limit]

    total_eligible = max(int(eligible.sum()), 1)
    ranks = {int(idx): 100.0 * (1.0 - i / total_eligible) for i, idx in enumerate(order)}

    return [
        {
            "node_idx": int(idx),
            "lat": round(float(lats[idx // n_lon]), 3),
            "lon": round(float(lons[idx % n_lon]), 3),
            "delta_value": _f(cell_delta[idx]),
            "delta_percent": _f(cell_delta_pct[idx]),
            "significant": bool(cell_significant[idx]),
            "percentile_rank": round(ranks.get(int(idx), 90.0), 1),
            "selection_basis": basis,
        }
        for idx in order
    ]


# ══════════════════════════════════════════════════════════════════════════════
# Historical climatology over a calendar range
# ══════════════════════════════════════════════════════════════════════════════
#
# "Historical mean rainfall according to range": the observed mean of one
# variable over a recurring calendar window, per year and as a long-term mean,
# with the interannual spread and a linear trend.
#
# This is deliberately separate from compute_sensitivity. The sensitivity fit
# answers "how does R move with T"; this answers "what is R, actually", which is
# the number a reader needs before any projection means anything. It is also the
# baseline the What-If before/after cards are compared against, so it must come
# from the same denormalized, availability-masked, coverage-filtered pipeline
# rather than a second implementation that could drift from it.


@dataclass
class YearValue:
    """One year's observed mean of a variable over the calendar window."""

    year: int
    value: float
    anomaly: float
    anomaly_percent: float
    valid_days: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "year": int(self.year),
            "value": _f(self.value),
            "anomaly": _f(self.anomaly),
            "anomaly_percent": _f(self.anomaly_percent),
            "valid_days": int(self.valid_days),
        }


@dataclass
class ClimatologyResult:
    """Observed mean of one variable over a recurring calendar window."""

    region: str
    variable: str
    window: CalendarWindow
    unit: str

    #: Long-term mean across the retained years.
    mean: float
    #: Interannual standard deviation (spread between years, not within a year).
    std: float
    #: Standard error of the long-term mean.
    sem: float
    ci95_low: float
    ci95_high: float
    #: Driest and wettest retained year, which is what a reader looks for first.
    min_value: float
    min_year: int | None
    max_value: float
    max_year: int | None
    median: float
    n_years: int
    year_first: int
    year_last: int

    #: Least-squares trend on the annual means, reported per decade because a
    #: per-year slope on rainfall is too small to read.
    trend_per_decade: float
    trend_p_value: float
    trend_r_squared: float
    trend_significant: bool

    per_year: list[YearValue]
    #: Per-cell long-term mean, row-major to match ClimateGraphBuilder ordering.
    cell_mean: list[float]
    lats: list[float]
    lons: list[float]
    excluded_years: list[int]
    #: Area-integrated volume for accumulating variables (rainfall only).
    volume_km3: float | None
    area_km2: float
    provenance: dict[str, Any] = field(default_factory=dict)

    def to_dict(self, include_cells: bool = True) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "region": self.region,
            "variable": self.variable,
            "season": self.window.name,
            "season_label": self.window.label,
            "unit": self.unit,
            "summary": {
                "mean": _f(self.mean),
                "std": _f(self.std),
                "sem": _f(self.sem),
                "ci95_low": _f(self.ci95_low),
                "ci95_high": _f(self.ci95_high),
                "median": _f(self.median),
                "min_value": _f(self.min_value),
                "min_year": self.min_year,
                "max_value": _f(self.max_value),
                "max_year": self.max_year,
                "n_years": int(self.n_years),
                "year_first": int(self.year_first),
                "year_last": int(self.year_last),
            },
            "trend": {
                "per_decade": _f(self.trend_per_decade),
                "unit": f"{self.unit} per decade",
                "p_value": _f(self.trend_p_value),
                "r_squared": _f(self.trend_r_squared),
                "significant": bool(self.trend_significant),
            },
            "integral": {
                "volume_km3": _f(self.volume_km3),
                "area_km2": _f(self.area_km2),
                "definition": (
                    "area integral of the per-cell mean over the length of the "
                    "calendar window"
                ),
            },
            "per_year": [p.to_dict() for p in self.per_year],
            "excluded_years": [int(y) for y in self.excluded_years],
            "provenance": self.provenance,
        }
        if include_cells:
            payload |= {
                "lats": [_f(v) for v in self.lats],
                "lons": [_f(v) for v in self.lons],
                "cell_mean": [_f(v) for v in self.cell_mean],
            }
        return payload


def compute_climatology(
    dataset_path: str | Path,
    norm_params_path: str | Path | None = None,
    *,
    region: str = "unknown",
    variable: str = "rainfall",
    season: str = "jjas",
    window: CalendarWindow | None = None,
    year_range: tuple[int, int] | None = None,
) -> ClimatologyResult:
    """Observed mean of ``variable`` over a recurring calendar window.

    Args:
        dataset_path: ``normalized_*.nc`` for the region.
        norm_params_path: companion ``norm_params_*.nc``; derived when omitted.
        variable: request-facing variable id (``rainfall``, ``tmax``, ...).
        season: preset name; ignored when ``window`` is given.
        window: explicit calendar range, overriding ``season``.
        year_range: inclusive ``(start_year, end_year)`` filter.

    Returns:
        A :class:`ClimatologyResult` with the long-term mean, the per-year
        series, the interannual spread, and a per-decade trend.
    """
    dataset_path = str(dataset_path)
    if norm_params_path is None:
        candidate = Path(dataset_path.replace("normalized_", "norm_params_"))
        norm_params_path = candidate if candidate.exists() else None

    var = resolve_variable(variable)
    win = window or CalendarWindow.from_preset(season)

    ds = _open_dataset(dataset_path)
    norm_params = _load_norm_params(Path(norm_params_path) if norm_params_path else None)

    lats = np.asarray(ds.lat.values, dtype=np.float64)
    lons = np.asarray(ds.lon.values, dtype=np.float64)
    weights = _area_weights(lats, lons.shape[0])

    series = _extract_series(ds, var, win, norm_params, year_range, weights)

    # Drop under-covered seasons on the same rule the sensitivity fit uses, so a
    # partial first satellite season cannot masquerade as a full observation.
    best_coverage = int(series.valid_days.max(initial=0))
    threshold = MIN_COVERAGE_FRACTION * best_coverage
    keep = (series.valid_days >= threshold) & np.isfinite(series.regional)

    excluded_years = [int(y) for y in series.years[~keep]]
    years = series.years[keep]
    values = series.regional[keep]
    valid_days = series.valid_days[keep]
    cells = series.per_cell[keep]

    if years.shape[0] < 1:
        raise ValueError(
            f"No usable year for {region}/{var} over {win.label}: every season "
            f"fell below {MIN_COVERAGE_FRACTION:.0%} of the best-covered year"
        )

    mean = float(np.nanmean(values))
    # ddof=1: these years are a sample of the climate, not the whole population.
    std = float(np.nanstd(values, ddof=1)) if years.shape[0] > 1 else 0.0
    n = int(years.shape[0])
    sem = std / np.sqrt(n) if n > 0 else float("nan")
    half = t_critical_95(n - 1) * sem if n > 1 else float("nan")

    finite_vals = np.isfinite(values)
    min_i = int(np.argmin(np.where(finite_vals, values, np.inf))) if finite_vals.any() else None
    max_i = int(np.argmax(np.where(finite_vals, values, -np.inf))) if finite_vals.any() else None

    # Trend on the annual means. Centred on the mean year so the intercept is
    # interpretable and the fit is numerically stable.
    if n >= 3:
        slope, _, r2, p_val, _ = fit_ols(years.astype(np.float64) - float(np.mean(years)), values)
        trend_decade = slope * 10.0
    else:
        slope, r2, p_val = float("nan"), float("nan"), float("nan")
        trend_decade = float("nan")

    with np.errstate(invalid="ignore"):
        cell_mean = np.nanmean(cells, axis=0)

    areas = cell_areas_km2(lats, lons)
    ok_cells = np.isfinite(cell_mean) & np.isfinite(areas)
    area_km2 = float(np.sum(areas[ok_cells])) if ok_cells.any() else float("nan")

    # Volume only makes sense for an accumulating flux. mm/day over the window
    # length, converted to km depth, times km^2.
    volume_km3: float | None = None
    if var in {"rainfall", "chirps_rain"} and ok_cells.any():
        days = _window_length_days(win)
        depth_km = cell_mean[ok_cells] * days * 1e-6   # mm/day -> km
        volume_km3 = float(np.sum(depth_km * areas[ok_cells]))

    per_year = [
        YearValue(
            year=int(years[i]),
            value=float(values[i]),
            anomaly=float(values[i] - mean),
            anomaly_percent=float(100.0 * (values[i] - mean) / mean) if mean else float("nan"),
            valid_days=int(valid_days[i]),
        )
        for i in range(n)
    ]

    return ClimatologyResult(
        region=region,
        variable=var,
        window=win,
        unit=series.unit,
        mean=mean,
        std=std,
        sem=sem,
        ci95_low=mean - half,
        ci95_high=mean + half,
        min_value=float(values[min_i]) if min_i is not None else float("nan"),
        min_year=int(years[min_i]) if min_i is not None else None,
        max_value=float(values[max_i]) if max_i is not None else float("nan"),
        max_year=int(years[max_i]) if max_i is not None else None,
        median=float(np.nanmedian(values)),
        n_years=n,
        year_first=int(years.min()),
        year_last=int(years.max()),
        trend_per_decade=trend_decade,
        trend_p_value=p_val,
        trend_r_squared=r2,
        trend_significant=bool(np.isfinite(p_val) and p_val < 0.05),
        per_year=per_year,
        cell_mean=cell_mean.tolist(),
        lats=lats.tolist(),
        lons=lons.tolist(),
        excluded_years=excluded_years,
        volume_km3=volume_km3,
        area_km2=area_km2,
        provenance={
            "dataset": Path(dataset_path).name,
            "norm_params": Path(norm_params_path).name if norm_params_path else None,
            "denormalized": bool(norm_params) or var in RAW_UNIT_VARS,
            "masked_by_availability": f"{var}_available" in ds.data_vars,
            "area_weighting": "cos(latitude)",
            "min_coverage_fraction": MIN_COVERAGE_FRACTION,
            "reduction": "mean of daily values within the window, per year",
            "grid_shape": [int(lats.shape[0]), int(lons.shape[0])],
            "source": (
                "observations (IMD gridded + CHIRPS + NOAA OISST + NCEP), 1981-2025"
            ),
        },
    )


# ══════════════════════════════════════════════════════════════════════════════
# Conditional probability of the response given the predictor
# ══════════════════════════════════════════════════════════════════════════════
#
# P(R = x | T = t) and P(R > x +/- dx | T = t +/- dt).
#
# The regression alone gives a single expected value per temperature. That is not
# enough to answer "how likely is a wet season", which needs the spread around
# the line, not just the line. The conditional density here is the OLS
# *prediction* distribution: centred on the fitted value, with a standard
# deviation that combines the residual scatter with the uncertainty in the fitted
# line itself, so a temperature far outside the observed range correctly produces
# a wider distribution rather than a confidently wrong one.
#
# The observed histogram is returned alongside it on purpose. A Gaussian is an
# assumption, and seasonal-mean rainfall is only roughly symmetric; showing the
# empirical distribution next to the parametric one lets a reader see where the
# assumption is doing work.


@dataclass
class DensityCurve:
    """A conditional density of the response at one predictor value."""

    id: str
    label: str
    predictor_value: float
    predictor_anomaly: float
    mean: float
    sigma: float
    values: list[float]
    density: list[float]
    #: Central 95 % interval of this conditional distribution.
    ci95_low: float
    ci95_high: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "predictor_value": _f(self.predictor_value),
            "predictor_anomaly": _f(self.predictor_anomaly),
            "mean": _f(self.mean),
            "sigma": _f(self.sigma),
            "ci95_low": _f(self.ci95_low),
            "ci95_high": _f(self.ci95_high),
            "values": [_f(v) for v in self.values],
            "density": [_f(v) for v in self.density],
        }


@dataclass
class ExceedanceProbability:
    """P(R > threshold | predictor), with the tolerance-induced range."""

    threshold: float
    threshold_tolerance: float
    predictor_tolerance: float
    baseline_probability: float
    scenario_probability: float
    probability_low: float
    probability_high: float
    probability_change: float
    #: Fraction of observed years that actually exceeded the threshold.
    observed_frequency: float
    observed_exceedances: int
    observed_years: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "threshold": _f(self.threshold),
            "threshold_tolerance": _f(self.threshold_tolerance),
            "predictor_tolerance": _f(self.predictor_tolerance),
            "baseline_probability": _f(self.baseline_probability),
            "scenario_probability": _f(self.scenario_probability),
            "probability_low": _f(self.probability_low),
            "probability_high": _f(self.probability_high),
            "probability_change": _f(self.probability_change),
            "observed_frequency": _f(self.observed_frequency),
            "observed_exceedances": int(self.observed_exceedances),
            "observed_years": int(self.observed_years),
            "definition": (
                "P(R > threshold | predictor), from the OLS prediction "
                "distribution; low/high span the supplied threshold and "
                "predictor tolerances"
            ),
        }


@dataclass
class ConditionalDistributionResult:
    """Baseline and shifted conditional densities plus exceedance probability."""

    region: str
    window: CalendarWindow
    predictor: str
    response: str
    predictor_unit: str
    response_unit: str
    delta_predictor: float
    residual_sigma: float
    baseline: DensityCurve
    scenario: DensityCurve
    #: Observed values as a histogram, for comparison with the parametric curve.
    histogram_edges: list[float]
    histogram_counts: list[int]
    observed_values: list[float]
    exceedance: ExceedanceProbability | None
    caveats: list[str]
    provenance: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "region": self.region,
            "season": self.window.name,
            "season_label": self.window.label,
            "predictor": self.predictor,
            "response": self.response,
            "predictor_unit": self.predictor_unit,
            "response_unit": self.response_unit,
            "delta_predictor": _f(self.delta_predictor),
            "residual_sigma": _f(self.residual_sigma),
            "curves": [self.baseline.to_dict(), self.scenario.to_dict()],
            "empirical": {
                "histogram_edges": [_f(v) for v in self.histogram_edges],
                "histogram_counts": [int(v) for v in self.histogram_counts],
                "values": [_f(v) for v in self.observed_values],
                "n": len(self.observed_values),
            },
            "exceedance": self.exceedance.to_dict() if self.exceedance else None,
            "caveats": self.caveats,
            "provenance": self.provenance,
        }


def conditional_distribution(
    result: SensitivityResult,
    *,
    delta_predictor: float = 2.0,
    threshold: float | None = None,
    threshold_tolerance: float = 0.0,
    predictor_tolerance: float = 0.0,
    n_grid: int = 161,
) -> ConditionalDistributionResult:
    """Conditional density of the response at the baseline and shifted predictor.

    Args:
        result: a fitted :class:`SensitivityResult`.
        delta_predictor: predictor change for the shifted curve, in predictor units.
        threshold: response level for the exceedance probability. Defaults to the
            observed climatology, which reads as "chance of a wetter-than-normal
            season".
        threshold_tolerance: +/- tolerance on the threshold (``dx``).
        predictor_tolerance: +/- tolerance on the predictor (``dt``).
        n_grid: number of points in the returned density curves.

    Returns:
        A :class:`ConditionalDistributionResult`.
    """
    from scipy import stats

    fit = result.fit
    x = np.array([p.predictor_anomaly for p in result.points], dtype=np.float64)
    y = np.array([p.response_value for p in result.points], dtype=np.float64)
    residuals = np.array([p.residual for p in result.points], dtype=np.float64)

    n = int(x.shape[0])
    if n < 3:
        raise ValueError("Need at least 3 fitted years to form a conditional distribution")

    dof = n - 2
    # Residual standard deviation of the fit: the scatter of observed seasons
    # around the regression line, which is what makes the conditional spread.
    sigma_resid = float(np.sqrt(np.sum(residuals ** 2) / dof))
    mean_x = float(np.mean(x))
    sxx = float(np.sum((x - mean_x) ** 2))
    t_crit = t_critical_95(dof)

    def _sigma_at(anomaly: float) -> float:
        """Prediction standard deviation at a predictor anomaly.

        The 1/n and (a-xbar)^2/Sxx terms are the uncertainty in the fitted line;
        they grow with distance from the observed mean, so extrapolating to +4 degC
        widens the distribution instead of pretending the line is exact.
        """
        if sxx <= 0:
            return sigma_resid
        leverage = 1.0 + 1.0 / n + ((anomaly - mean_x) ** 2) / sxx
        return sigma_resid * float(np.sqrt(max(leverage, 0.0)))

    baseline_anomaly = 0.0
    scenario_anomaly = float(delta_predictor)

    mu_base = float(fit.predict(baseline_anomaly))
    mu_scen = float(fit.predict(scenario_anomaly))
    sd_base = _sigma_at(baseline_anomaly)
    sd_scen = _sigma_at(scenario_anomaly)

    # Grid spans both curves plus the observed range, so neither is clipped.
    lo_candidates = [mu_base - 4 * sd_base, mu_scen - 4 * sd_scen, float(np.min(y))]
    hi_candidates = [mu_base + 4 * sd_base, mu_scen + 4 * sd_scen, float(np.max(y))]
    grid_lo, grid_hi = min(lo_candidates), max(hi_candidates)
    # Rainfall cannot be negative; clamping the axis avoids drawing a density over
    # impossible values, and the caveat below records that the tail was truncated.
    truncated = False
    if fit.response in {"rainfall", "chirps_rain"} and grid_lo < 0.0:
        grid_lo = 0.0
        truncated = True
    if grid_hi <= grid_lo:
        grid_hi = grid_lo + 1.0
    grid = np.linspace(grid_lo, grid_hi, int(max(n_grid, 11)))

    def _curve(cid: str, label: str, anomaly: float, mu: float, sd: float) -> DensityCurve:
        half = t_crit * sd
        return DensityCurve(
            id=cid,
            label=label,
            predictor_value=fit.predictor_climatology + anomaly,
            predictor_anomaly=anomaly,
            mean=mu,
            sigma=sd,
            values=grid.tolist(),
            density=stats.norm.pdf(grid, loc=mu, scale=sd).tolist() if sd > 0 else [],
            ci95_low=mu - half,
            ci95_high=mu + half,
        )

    unit = fit.predictor_unit or ""
    baseline_curve = _curve(
        "baseline",
        f"Observed baseline ({fit.predictor_climatology:.2f} {unit})".strip(),
        baseline_anomaly, mu_base, sd_base,
    )
    scenario_curve = _curve(
        "scenario",
        f"At {delta_predictor:+.2f} {unit}".strip(),
        scenario_anomaly, mu_scen, sd_scen,
    )

    # Exceedance probability, including the tolerance band the mentor's
    # P(R > x +/- dx | T = t +/- dt) asks for.
    exceedance: ExceedanceProbability | None = None
    thr = fit.response_climatology if threshold is None else float(threshold)
    if np.isfinite(thr) and sd_scen > 0 and sd_base > 0:
        dx = abs(float(threshold_tolerance))
        dt = abs(float(predictor_tolerance))
        # A predictor tolerance moves the mean by |slope| * dt in either
        # direction regardless of the slope's sign.
        mu_spread = abs(fit.slope) * dt
        p_base = float(stats.norm.sf(thr, loc=mu_base, scale=sd_base))
        p_scen = float(stats.norm.sf(thr, loc=mu_scen, scale=sd_scen))
        # Most exceedance-friendly corner: lowest threshold, highest mean.
        p_high = float(stats.norm.sf(thr - dx, loc=mu_scen + mu_spread, scale=sd_scen))
        p_low = float(stats.norm.sf(thr + dx, loc=mu_scen - mu_spread, scale=sd_scen))
        observed_hits = int(np.sum(y > thr))
        exceedance = ExceedanceProbability(
            threshold=thr,
            threshold_tolerance=dx,
            predictor_tolerance=dt,
            baseline_probability=p_base,
            scenario_probability=p_scen,
            probability_low=min(p_low, p_high),
            probability_high=max(p_low, p_high),
            probability_change=p_scen - p_base,
            observed_frequency=observed_hits / n if n else float("nan"),
            observed_exceedances=observed_hits,
            observed_years=n,
        )

    counts, edges = np.histogram(y, bins=min(12, max(4, n // 3)))

    caveats: list[str] = [
        "The conditional spread is the OLS prediction distribution: residual "
        "scatter plus the uncertainty in the fitted line, so it widens away from "
        "the observed predictor range.",
        f"Normality is assumed. The observed histogram (n={n}) is returned "
        "alongside so the assumption can be checked rather than trusted.",
    ]
    if truncated:
        caveats.append(
            f"{fit.response} cannot be negative, so the density axis is clamped at "
            "zero; a Gaussian would otherwise place mass on impossible values."
        )
    if not fit.significant:
        caveats.append(
            f"The underlying slope is not significant (p={fit.p_value:.3g}), so the "
            "shift between the two curves is weakly constrained."
        )
    observed_span = float(np.max(np.abs(x))) if x.size else 0.0
    if abs(delta_predictor) > observed_span:
        caveats.append(
            f"A {delta_predictor:+.2f} {unit} change exceeds the largest observed "
            f"anomaly ({observed_span:.2f} {unit}), so the shifted curve extrapolates."
        )

    return ConditionalDistributionResult(
        region=result.region,
        window=result.window,
        predictor=fit.predictor,
        response=fit.response,
        predictor_unit=fit.predictor_unit,
        response_unit=fit.response_unit,
        delta_predictor=float(delta_predictor),
        residual_sigma=sigma_resid,
        baseline=baseline_curve,
        scenario=scenario_curve,
        histogram_edges=edges.tolist(),
        histogram_counts=counts.tolist(),
        observed_values=y.tolist(),
        exceedance=exceedance,
        caveats=caveats,
        provenance={
            **result.provenance,
            "distribution": "Gaussian OLS prediction distribution",
            "dof": dof,
            "residual_sigma": _f(sigma_resid),
        },
    )


# ══════════════════════════════════════════════════════════════════════════════
# Dual-baseline split: older vs newer record, each fitted independently
# ══════════════════════════════════════════════════════════════════════════════
#
# The single 1981-2025 slope assumes the rainfall-temperature relationship has
# been constant for 45 years. If it has not, that slope is an average of two
# different regimes and a projection built on it is anchored to a baseline that no
# longer exists. Splitting the record and fitting each half separately is what
# makes that testable: if the two slopes differ significantly, the newer one is
# the honest basis for projecting forward and the difference is itself a result.


#: Year that begins the "new" baseline. 2000 splits the 1981-2025 record into a
#: 19-year and a 26-year half, which keeps both fits above the ~15-year minimum
#: where an interannual regression starts to mean anything.
DEFAULT_BASELINE_SPLIT_YEAR = 2000


@dataclass
class BaselineEpochFit:
    """One half of the record, fitted on its own."""

    id: str
    label: str
    year_start: int
    year_end: int
    fit: RegressionFit
    response_mean: float
    predictor_mean: float
    n_years: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "year_start": int(self.year_start),
            "year_end": int(self.year_end),
            "fit": self.fit.to_dict(),
            "response_mean": _f(self.response_mean),
            "predictor_mean": _f(self.predictor_mean),
            "n_years": int(self.n_years),
        }


@dataclass
class BaselineComparisonResult:
    """Older vs newer baseline, with a significance test on the slope change."""

    region: str
    window: CalendarWindow
    predictor: str
    response: str
    split_year: int
    older: BaselineEpochFit
    newer: BaselineEpochFit

    slope_delta: float
    slope_delta_se: float
    slope_delta_ci95_low: float
    slope_delta_ci95_high: float
    slope_delta_p_value: float
    slope_changed_significantly: bool

    response_mean_delta: float
    response_mean_delta_percent: float
    predictor_mean_delta: float

    #: Per-cell slope difference (newer minus older), row-major.
    cell_slope_delta: list[float]
    lats: list[float]
    lons: list[float]

    caveats: list[str]
    provenance: dict[str, Any] = field(default_factory=dict)

    def to_dict(self, include_cells: bool = True) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "region": self.region,
            "season": self.window.name,
            "season_label": self.window.label,
            "predictor": self.predictor,
            "response": self.response,
            "split_year": int(self.split_year),
            "older": self.older.to_dict(),
            "newer": self.newer.to_dict(),
            "difference": {
                "slope_delta": _f(self.slope_delta),
                "slope_delta_se": _f(self.slope_delta_se),
                "slope_delta_ci95_low": _f(self.slope_delta_ci95_low),
                "slope_delta_ci95_high": _f(self.slope_delta_ci95_high),
                "slope_delta_p_value": _f(self.slope_delta_p_value),
                "slope_changed_significantly": bool(self.slope_changed_significantly),
                "slope_unit": self.older.fit.slope_unit,
                "response_mean_delta": _f(self.response_mean_delta),
                "response_mean_delta_percent": _f(self.response_mean_delta_percent),
                "predictor_mean_delta": _f(self.predictor_mean_delta),
                "definition": "newer baseline minus older baseline",
            },
            "caveats": self.caveats,
            "provenance": self.provenance,
        }
        if include_cells:
            payload |= {
                "lats": [_f(v) for v in self.lats],
                "lons": [_f(v) for v in self.lons],
                "cell_slope_delta": [_f(v) for v in self.cell_slope_delta],
            }
        return payload


def compare_baselines(
    dataset_path: str | Path,
    norm_params_path: str | Path | None = None,
    *,
    region: str = "unknown",
    predictor: str = "tmax",
    response: str = "rainfall",
    season: str = "jjas",
    window: CalendarWindow | None = None,
    split_year: int = DEFAULT_BASELINE_SPLIT_YEAR,
    year_range: tuple[int, int] | None = None,
) -> BaselineComparisonResult:
    """Fit ``response`` on ``predictor`` separately either side of ``split_year``.

    Args:
        split_year: first year of the newer baseline. The older baseline ends the
            year before.
        year_range: optional outer bound applied to both halves.

    Returns:
        A :class:`BaselineComparisonResult` carrying both fits and a two-sided
        test on the difference of slopes.
    """
    from scipy import stats

    lo_bound = year_range[0] if year_range else 1800
    hi_bound = year_range[1] if year_range else 2200
    if not (lo_bound < split_year <= hi_bound):
        raise ValueError(
            f"split_year {split_year} must fall inside the requested range "
            f"{lo_bound}-{hi_bound}"
        )

    common = dict(
        norm_params_path=norm_params_path,
        region=region,
        predictor=predictor,
        response=response,
        season=season,
        window=window,
    )
    older_result = compute_sensitivity(
        dataset_path, year_range=(lo_bound, split_year - 1), **common
    )
    newer_result = compute_sensitivity(
        dataset_path, year_range=(split_year, hi_bound), **common
    )

    older = BaselineEpochFit(
        id="older",
        label=f"Older baseline ({older_result.provenance['year_first']}-"
              f"{older_result.provenance['year_last']})",
        year_start=int(older_result.provenance["year_first"]),
        year_end=int(older_result.provenance["year_last"]),
        fit=older_result.fit,
        response_mean=older_result.fit.response_climatology,
        predictor_mean=older_result.fit.predictor_climatology,
        n_years=older_result.fit.n,
    )
    newer = BaselineEpochFit(
        id="newer",
        label=f"New baseline ({newer_result.provenance['year_first']}-"
              f"{newer_result.provenance['year_last']})",
        year_start=int(newer_result.provenance["year_first"]),
        year_end=int(newer_result.provenance["year_last"]),
        fit=newer_result.fit,
        response_mean=newer_result.fit.response_climatology,
        predictor_mean=newer_result.fit.predictor_climatology,
        n_years=newer_result.fit.n,
    )

    # Difference of two independent slopes. The halves share no years, so the
    # standard errors add in quadrature.
    slope_delta = newer.fit.slope - older.fit.slope
    se_delta = float(np.sqrt(newer.fit.std_err ** 2 + older.fit.std_err ** 2))
    dof = max(newer.n_years + older.n_years - 4, 1)
    t_crit = t_critical_95(dof)
    half = t_crit * se_delta if np.isfinite(se_delta) else float("nan")
    if np.isfinite(se_delta) and se_delta > 0:
        t_stat = slope_delta / se_delta
        p_delta = float(2.0 * stats.t.sf(abs(t_stat), dof))
    else:
        p_delta = float("nan")

    mean_delta = newer.response_mean - older.response_mean
    mean_delta_pct = (
        100.0 * mean_delta / older.response_mean if older.response_mean else float("nan")
    )

    older_cells = np.asarray(older_result.cell_slope, dtype=np.float64)
    newer_cells = np.asarray(newer_result.cell_slope, dtype=np.float64)
    if older_cells.shape == newer_cells.shape:
        cell_delta = newer_cells - older_cells
    else:
        cell_delta = np.full(newer_cells.shape, np.nan)

    changed = bool(np.isfinite(p_delta) and p_delta < 0.05)
    caveats: list[str] = []
    if changed:
        caveats.append(
            "The two slopes differ significantly, so the 1981-2025 single-slope "
            "sensitivity averages two regimes; the newer baseline is the better "
            "basis for projecting forward."
        )
    else:
        caveats.append(
            "The slope difference is not statistically significant "
            f"(p={p_delta:.3g}), so the record does not demonstrate a change in "
            "sensitivity; the split is shown for completeness."
        )
    if min(older.n_years, newer.n_years) < 15:
        caveats.append(
            f"One half has only {min(older.n_years, newer.n_years)} usable years. "
            "Interannual regressions on fewer than about 15 years carry wide "
            "confidence intervals."
        )
    caveats.append(
        "Splitting the record halves the sample in each fit, so both slopes are "
        "less precisely estimated than the full-record slope."
    )

    return BaselineComparisonResult(
        region=region,
        window=older_result.window,
        predictor=older.fit.predictor,
        response=older.fit.response,
        split_year=int(split_year),
        older=older,
        newer=newer,
        slope_delta=slope_delta,
        slope_delta_se=se_delta,
        slope_delta_ci95_low=slope_delta - half,
        slope_delta_ci95_high=slope_delta + half,
        slope_delta_p_value=p_delta,
        slope_changed_significantly=changed,
        response_mean_delta=mean_delta,
        response_mean_delta_percent=mean_delta_pct,
        predictor_mean_delta=newer.predictor_mean - older.predictor_mean,
        cell_slope_delta=cell_delta.tolist(),
        lats=newer_result.lats,
        lons=newer_result.lons,
        caveats=caveats,
        provenance={
            **newer_result.provenance,
            "method": (
                "two independent OLS fits either side of the split year; "
                "difference tested with a two-sided t on pooled standard errors"
            ),
            "split_year": int(split_year),
            "older_years": [older.year_start, older.year_end],
            "newer_years": [newer.year_start, newer.year_end],
        },
    )

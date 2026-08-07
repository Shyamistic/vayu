"""Independent-reference validation of our observed bundle against ERA5 reanalysis.

Why this module exists
----------------------
Every empirical number this project quotes — the ``dR/dT`` slope, the JJAS
climatology, the What-If baseline — is read out of one family of inputs: the IMD
gridded products bundled into ``normalized_*.nc``. That is a single point of
failure. If the regridding, the unit handling, or the per-cell z-score
denormalization were wrong, every downstream figure would be wrong *coherently*,
and none of our internal tests would notice, because they all read the same
bundle.

ERA5 is the standard independent check. It is produced by ECMWF from a different
observing system, a different assimilation scheme and a different model, so
agreement between our denormalized bundle and ERA5 is evidence about the pipeline
rather than evidence about itself.

What this compares, precisely
-----------------------------
* **Ours:** the value stored in ``normalized_<years>.nc`` at the grid cell nearest
  the requested point, denormalized with that cell's own mean and standard
  deviation from ``norm_params_<years>.nc``, availability-masked and clamped —
  the identical path :mod:`backend.sensitivity` uses. Nothing is recomputed for
  this comparison, which is the point: a bug in that path must show up here.
* **Reference:** ERA5 daily aggregates from the Open-Meteo archive API.

Three mismatches are real and are reported rather than smoothed over
--------------------------------------------------------------------
1. **Day definition.** IMD's rain-day runs 0830 IST to 0830 IST and is labelled
   with the start date. The archive aggregates 0000-2400 in the requested
   timezone. So a paired *daily* rainfall correlation is depressed by an ~8.5 h
   offset that is an artifact of the convention, not of either dataset. This is
   why :func:`compare_with_era5` also returns **monthly** aggregates: shifting
   the boundary moves rain between adjacent days, but barely moves a monthly
   total. If the daily r is mediocre and the monthly r is high, the day
   convention is the explanation. If both are poor, the pipeline is.
2. **Spatial support.** Ours is a 0.25 deg cell average (1.0 deg for temperature,
   regridded — see ``preprocessor``). ERA5 is sampled at a point on its own grid.
   We report the cell centre actually used and its distance from the requested
   point so the mismatch is visible.
3. **Not fully independent for every channel.** ``insat_lst`` in our bundle *is*
   ERA5-Land skin temperature, so comparing it against ERA5 is a self-check, not
   a validation. This module therefore only accepts the three IMD-sourced
   variables (``rainfall``, ``tmax``, ``tmin``) and rejects the rest with an
   explicit reason instead of producing a meaningless-but-impressive r.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from backend.sensitivity import (
    EARTH_RADIUS_KM,
    PHYSICAL_CLAMPS,
    RAW_UNIT_VARS,
    VARIABLE_UNITS,
    NETCDF_LOCK,
    _f,
    _load_norm_params,
    _open_dataset,
    resolve_variable,
)

logger = logging.getLogger(__name__)

#: Our variable id -> the key Open-Meteo's archive response carries it under
#: (after :meth:`OpenMeteoClient.get_era5_history` normalises the payload).
ERA5_FIELD_FOR_VARIABLE: dict[str, str] = {
    "rainfall": "precipitation_mm",
    "tmax": "temp_max_c",
    "tmin": "temp_min_c",
}

#: How a daily series aggregates to a month. Rainfall accumulates; temperature
#: averages. Getting this backwards would inflate a temperature "bias" by ~30x.
MONTHLY_AGGREGATION: dict[str, str] = {
    "rainfall": "sum",
    "tmax": "mean",
    "tmin": "mean",
}

#: Unit of a monthly aggregate, which is *not* the daily unit when the series
#: accumulates: summing a mm/day series over a month yields mm. Reporting a
#: monthly rainfall bias of -6.6 as "mm/day" would understate it by a factor of
#: thirty, so the monthly block carries its own unit.
_ACCUMULATED_UNIT: dict[str, str] = {"mm/day": "mm"}


def monthly_unit(daily_unit: str, how: str) -> str:
    """Unit of the monthly aggregate given the daily unit and the reduction."""
    if how != "sum":
        return daily_unit
    return _ACCUMULATED_UNIT.get(daily_unit, f"{daily_unit} summed over the month")

#: Channels that are *already* ERA5 in our bundle, so an ERA5 comparison would be
#: circular. Kept explicit so the rejection message can say why.
CIRCULAR_VARIABLES: dict[str, str] = {
    "insat_lst": "insat_lst is itself ERA5-Land skin temperature in our bundle",
    "insat_sst": "insat_sst is NOAA OISST, which ERA5 assimilates as its SST boundary",
}

#: Maximum window length. The archive call is a single HTTP request and the
#: payload is returned to the browser in full, so this is a payload bound rather
#: than a scientific one.
MAX_WINDOW_DAYS = 1096  # 3 years

#: A month needs this fraction of its paired days present before it becomes a
#: monthly point. Without it, a month with 2 surviving days would be plotted
#: beside a month with 31 and weighted identically.
MIN_MONTH_COVERAGE = 0.6


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km between two points."""
    p1, p2 = np.deg2rad(lat1), np.deg2rad(lat2)
    dphi = p2 - p1
    dlam = np.deg2rad(lon2 - lon1)
    a = np.sin(dphi / 2.0) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlam / 2.0) ** 2
    return float(2.0 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0))))


@dataclass
class PointSeries:
    """A daily series read from one grid cell of the observed bundle."""

    dates: list[str]
    values: np.ndarray
    cell_lat: float
    cell_lon: float
    flat_index: int
    distance_km: float
    denormalized: bool
    availability_masked: bool
    unit: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "cell_lat": _f(self.cell_lat),
            "cell_lon": _f(self.cell_lon),
            "flat_index": int(self.flat_index),
            "distance_from_request_km": _f(round(self.distance_km, 2)),
            "denormalized": self.denormalized,
            "availability_masked": self.availability_masked,
            "unit": self.unit,
            "n_days": len(self.dates),
        }


@dataclass
class AgreementStats:
    """Paired-sample agreement between our value and the reference."""

    n: int
    observed_mean: float
    reference_mean: float
    bias: float                 # reference - observed, signed
    mae: float
    rmse: float
    pearson_r: float
    pearson_p: float
    observed_total: float | None = None
    reference_total: float | None = None
    total_ratio: float | None = None

    def to_dict(self) -> dict[str, Any]:
        out = {
            "n": int(self.n),
            "observed_mean": _f(self.observed_mean),
            "reference_mean": _f(self.reference_mean),
            "bias": _f(self.bias),
            "mae": _f(self.mae),
            "rmse": _f(self.rmse),
            "pearson_r": _f(self.pearson_r),
            "pearson_p": _f(self.pearson_p),
            "r_squared": _f(self.pearson_r ** 2) if np.isfinite(self.pearson_r) else None,
        }
        if self.observed_total is not None:
            out["observed_total"] = _f(self.observed_total)
            out["reference_total"] = _f(self.reference_total)
            out["total_ratio"] = _f(self.total_ratio)
        return out


@dataclass
class Era5ComparisonResult:
    """Everything the ERA5 validation panel renders."""

    region: str
    variable: str
    unit: str
    start_date: str
    end_date: str
    requested_lat: float
    requested_lon: float
    series: PointSeries
    dates: list[str]
    observed: np.ndarray
    reference: np.ndarray
    daily_stats: AgreementStats
    monthly_labels: list[str]
    monthly_observed: np.ndarray
    monthly_reference: np.ndarray
    monthly_days: np.ndarray
    monthly_stats: AgreementStats | None
    monthly_aggregation: str
    dataset_path: str
    reference_source: str
    caveats: list[str]

    def to_dict(self, include_daily: bool = True) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "region": self.region,
            "variable": self.variable,
            "unit": self.unit,
            "start_date": self.start_date,
            "end_date": self.end_date,
            "requested_lat": _f(self.requested_lat),
            "requested_lon": _f(self.requested_lon),
            "our_grid_cell": self.series.to_dict(),
            "daily_stats": self.daily_stats.to_dict(),
            "monthly": {
                "aggregation": self.monthly_aggregation,
                # Not self.unit: a summed mm/day series is mm.
                "unit": monthly_unit(self.unit, self.monthly_aggregation),
                "labels": self.monthly_labels,
                "observed": [_f(v) for v in self.monthly_observed],
                "reference": [_f(v) for v in self.monthly_reference],
                "paired_days": [int(v) for v in self.monthly_days],
                "stats": self.monthly_stats.to_dict() if self.monthly_stats else None,
            },
            "provenance": {
                "observed_source": "IMD gridded, via normalized bundle",
                "observed_dataset": self.dataset_path,
                "reference_source": self.reference_source,
                "independent": True,
                "note": (
                    "Our value is read through the same denormalization path the "
                    "sensitivity fit uses; nothing is recomputed for this comparison."
                ),
            },
            "caveats": self.caveats,
        }
        if include_daily:
            payload["daily"] = {
                "dates": self.dates,
                "observed": [_f(v) for v in self.observed],
                "reference": [_f(v) for v in self.reference],
            }
        return payload


def nearest_cell(
    lats: np.ndarray, lons: np.ndarray, lat: float, lon: float
) -> tuple[int, int, float, float, int, float]:
    """Index of the grid cell whose centre is nearest ``(lat, lon)``.

    Returns ``(i_lat, i_lon, cell_lat, cell_lon, flat_index, distance_km)``.
    ``flat_index`` is row-major (``i_lat * n_lon + i_lon``) to match the ordering
    ``norm_params`` and the graph builder both use.
    """
    lats = np.asarray(lats, dtype=np.float64)
    lons = np.asarray(lons, dtype=np.float64)
    i = int(np.argmin(np.abs(lats - float(lat))))
    j = int(np.argmin(np.abs(lons - float(lon))))
    cell_lat, cell_lon = float(lats[i]), float(lons[j])
    return (
        i, j, cell_lat, cell_lon,
        i * lons.shape[0] + j,
        _haversine_km(lat, lon, cell_lat, cell_lon),
    )


def extract_point_series(
    dataset_path: str | Path,
    variable: str,
    lat: float,
    lon: float,
    start_date: str,
    end_date: str,
    norm_params_path: str | Path | None = None,
) -> PointSeries:
    """Read one grid cell's daily series in physical units over a date range.

    Mirrors :func:`backend.sensitivity._extract_series` for a single cell: the
    availability flag is honoured, the per-cell z-score is inverted with that
    cell's own mean and std, and the physical clamp is applied. Days that were
    gap-filled come back as NaN rather than 0.0, which is what makes the paired
    statistics below trustworthy — a run of zeros would otherwise read as a
    genuine dry spell and manufacture a rainfall bias.
    """
    import pandas as pd

    var = resolve_variable(variable)
    dataset_path = str(dataset_path)
    if norm_params_path is None:
        candidate = Path(dataset_path.replace("normalized_", "norm_params_"))
        norm_params_path = candidate if candidate.exists() else None

    ds = _open_dataset(dataset_path)
    if var not in ds.data_vars:
        raise ValueError(f"Variable '{var}' not present in {Path(dataset_path).name}")

    index = pd.DatetimeIndex(ds.time.values)
    lo = pd.Timestamp(start_date)
    hi = pd.Timestamp(end_date)
    in_range = (index >= lo) & (index <= hi)
    if not in_range.any():
        raise ValueError(
            f"The bundle covers {index[0].date()} to {index[-1].date()}; "
            f"no days fall in {lo.date()}..{hi.date()}"
        )

    rows = np.flatnonzero(in_range)
    lats = np.asarray(ds.lat.values, dtype=np.float64)
    lons = np.asarray(ds.lon.values, dtype=np.float64)
    i, j, cell_lat, cell_lon, flat, dist_km = nearest_cell(lats, lons, lat, lon)

    flag_name = f"{var}_available"
    has_flag = flag_name in ds.data_vars

    with NETCDF_LOCK:
        values = (
            ds[var].isel(time=rows, lat=i, lon=j).values.astype(np.float64).reshape(-1)
        )
        flag = (
            ds[flag_name].isel(time=rows, lat=i, lon=j).values.reshape(-1)
            if has_flag else None
        )

    if flag is not None:
        values[flag <= 0.5] = np.nan

    norm_params = _load_norm_params(
        Path(norm_params_path) if norm_params_path else None
    )
    denormalized = False
    if var not in RAW_UNIT_VARS:
        mean = norm_params.get(f"{var}_mean")
        std = norm_params.get(f"{var}_std")
        if mean is not None and std is not None and flat < mean.shape[0]:
            cell_mean = float(mean[flat])
            cell_std = float(std[flat])
            if np.isfinite(cell_mean) and np.isfinite(cell_std) and cell_std > 0:
                values = values * cell_std + cell_mean
                denormalized = True
        if not denormalized:
            logger.warning(
                "No usable per-cell norm params for '%s' at cell %d — values stay "
                "in z-score units and the comparison is not meaningful", var, flat,
            )
    else:
        denormalized = True  # already physical

    if denormalized:
        clamp_lo, clamp_hi = PHYSICAL_CLAMPS.get(var, (-np.inf, np.inf))
        np.clip(values, clamp_lo, clamp_hi, out=values)

    return PointSeries(
        dates=[str(d.date()) for d in index[rows]],
        values=values,
        cell_lat=cell_lat,
        cell_lon=cell_lon,
        flat_index=flat,
        distance_km=dist_km,
        denormalized=denormalized,
        availability_masked=has_flag,
        unit=VARIABLE_UNITS.get(var, ""),
    )


def pair_on_dates(
    a_dates: list[str],
    a_values: np.ndarray,
    b_dates: list[str],
    b_values: np.ndarray,
) -> tuple[list[str], np.ndarray, np.ndarray]:
    """Inner-join two daily series on their date labels.

    Both sides are matched by date string rather than by position. Position
    matching looks equivalent and is not: the archive omits days it has no data
    for, so a single missing day would shift every subsequent pair by one and
    silently destroy the correlation.
    """
    b_lookup = {
        d: float(v) for d, v in zip(b_dates, np.asarray(b_values, dtype=np.float64))
    }
    dates: list[str] = []
    left: list[float] = []
    right: list[float] = []
    for d, v in zip(a_dates, np.asarray(a_values, dtype=np.float64)):
        other = b_lookup.get(d)
        if other is None:
            continue
        if not (np.isfinite(v) and np.isfinite(other)):
            continue
        dates.append(d)
        left.append(v)
        right.append(other)
    return dates, np.asarray(left, dtype=np.float64), np.asarray(right, dtype=np.float64)


def agreement_stats(
    observed: np.ndarray, reference: np.ndarray, *, accumulating: bool = False
) -> AgreementStats:
    """Bias, MAE, RMSE and Pearson r for a paired sample.

    ``bias`` is signed ``reference - observed``, so a positive bias means ERA5
    reads higher than our bundle. ``accumulating`` adds period totals and their
    ratio, which is the figure that matters for rainfall: two datasets can
    correlate well day to day and still disagree by 20 % on the seasonal total.
    """
    from scipy import stats

    observed = np.asarray(observed, dtype=np.float64)
    reference = np.asarray(reference, dtype=np.float64)
    good = np.isfinite(observed) & np.isfinite(reference)
    o, r = observed[good], reference[good]
    n = int(o.size)

    if n < 2:
        nan = float("nan")
        return AgreementStats(n, nan, nan, nan, nan, nan, nan, nan)

    diff = r - o
    # Pearson is undefined when either side is constant; report NaN rather than
    # letting numpy emit a divide warning and a garbage correlation.
    if np.std(o) == 0 or np.std(r) == 0:
        pearson_r, pearson_p = float("nan"), float("nan")
    else:
        res = stats.pearsonr(o, r)
        pearson_r, pearson_p = float(res[0]), float(res[1])

    out = AgreementStats(
        n=n,
        observed_mean=float(np.mean(o)),
        reference_mean=float(np.mean(r)),
        bias=float(np.mean(diff)),
        mae=float(np.mean(np.abs(diff))),
        rmse=float(np.sqrt(np.mean(diff ** 2))),
        pearson_r=pearson_r,
        pearson_p=pearson_p,
    )
    if accumulating:
        o_total = float(np.sum(o))
        r_total = float(np.sum(r))
        out.observed_total = o_total
        out.reference_total = r_total
        out.total_ratio = float(r_total / o_total) if o_total > 0 else float("nan")
    return out


def monthly_aggregate(
    dates: list[str],
    observed: np.ndarray,
    reference: np.ndarray,
    how: str,
) -> tuple[list[str], np.ndarray, np.ndarray, np.ndarray]:
    """Collapse a paired daily series to calendar months.

    Only days present on **both** sides contribute, so the two monthly numbers
    are always built from the identical set of days. Months covering less than
    :data:`MIN_MONTH_COVERAGE` of their calendar length are dropped: for a sum
    that would otherwise report a partial month as a real low total.
    """
    import pandas as pd

    if not dates:
        return [], np.asarray([]), np.asarray([]), np.asarray([], dtype=np.int64)

    idx = pd.DatetimeIndex(dates)
    keys = idx.to_period("M")
    labels: list[str] = []
    obs_out: list[float] = []
    ref_out: list[float] = []
    days_out: list[int] = []

    for key in pd.unique(keys):
        sel = keys == key
        n_days = int(sel.sum())
        if n_days < MIN_MONTH_COVERAGE * key.days_in_month:
            continue
        o_slice = observed[sel]
        r_slice = reference[sel]
        if how == "sum":
            obs_out.append(float(np.sum(o_slice)))
            ref_out.append(float(np.sum(r_slice)))
        else:
            obs_out.append(float(np.mean(o_slice)))
            ref_out.append(float(np.mean(r_slice)))
        labels.append(str(key))
        days_out.append(n_days)

    return (
        labels,
        np.asarray(obs_out, dtype=np.float64),
        np.asarray(ref_out, dtype=np.float64),
        np.asarray(days_out, dtype=np.int64),
    )


def compare_with_era5(
    dataset_path: str | Path,
    era5_payload: dict[str, Any],
    *,
    region: str,
    variable: str,
    lat: float,
    lon: float,
    start_date: str,
    end_date: str,
    norm_params_path: str | Path | None = None,
) -> Era5ComparisonResult:
    """Pair our observed bundle against an ERA5 archive payload and score it.

    Args:
        dataset_path: ``normalized_*.nc`` for the region.
        era5_payload: the dict returned by
            :meth:`OpenMeteoClient.get_era5_history` — already normalised to
            ``{"daily": {"time": [...], "<field>": [...]}}``.
        variable: ``rainfall`` | ``tmax`` | ``tmin``.

    Raises:
        ValueError: if the variable has no independent ERA5 counterpart, the
            archive payload is empty, or fewer than 2 days pair up. Nothing is
            substituted — an empty reference must surface as an error, not as a
            comparison against zeros that would report a perfect-looking bias.
    """
    var = resolve_variable(variable)
    if var in CIRCULAR_VARIABLES:
        raise ValueError(
            f"'{variable}' cannot be validated against ERA5: "
            f"{CIRCULAR_VARIABLES[var]}. Use rainfall, tmax or tmin."
        )
    field = ERA5_FIELD_FOR_VARIABLE.get(var)
    if field is None:
        raise ValueError(
            f"No ERA5 counterpart for '{variable}'. "
            f"Valid: {sorted(ERA5_FIELD_FOR_VARIABLE)}"
        )

    daily = (era5_payload or {}).get("daily") or {}
    ref_dates = [str(d) for d in daily.get("time") or []]
    ref_raw = daily.get(field) or []
    if not ref_dates or not ref_raw:
        raise ValueError(
            "The ERA5 archive returned no days for this window "
            f"({era5_payload.get('error', 'empty response')})."
        )
    ref_values = np.asarray(
        [np.nan if v is None else float(v) for v in ref_raw], dtype=np.float64
    )

    series = extract_point_series(
        dataset_path, var, lat, lon, start_date, end_date,
        norm_params_path=norm_params_path,
    )

    dates, obs, ref = pair_on_dates(
        series.dates, series.values, ref_dates, ref_values
    )
    if obs.size < 2:
        raise ValueError(
            "Fewer than 2 days pair up between the bundle and the ERA5 archive "
            "for this window; there is nothing to score."
        )

    accumulating = MONTHLY_AGGREGATION.get(var) == "sum"
    daily_stats = agreement_stats(obs, ref, accumulating=accumulating)

    how = MONTHLY_AGGREGATION.get(var, "mean")
    m_labels, m_obs, m_ref, m_days = monthly_aggregate(dates, obs, ref, how)
    monthly_stats = (
        agreement_stats(m_obs, m_ref, accumulating=False) if m_obs.size >= 2 else None
    )

    caveats = [
        "ERA5 is an independent reanalysis (ECMWF), not one of our inputs for this "
        "variable, so agreement here is evidence about our pipeline rather than a "
        "self-consistency check.",
        f"Spatial support differs: ours is a grid-cell average centred at "
        f"{series.cell_lat:.3f} N, {series.cell_lon:.3f} E "
        f"({series.distance_km:.1f} km from the requested point); ERA5 is sampled at "
        f"a point on its own grid.",
    ]
    if var == "rainfall":
        caveats.append(
            "Day-boundary mismatch: IMD's rain-day is 0830-0830 IST, the archive "
            "aggregates 0000-2400. That offset moves rain between adjacent days, so "
            "judge the daily correlation with it in mind and read the monthly "
            "totals as the cleaner comparison."
        )
    else:
        caveats.append(
            "IMD gridded temperature is observed at 1.0 deg and regridded to 0.25 deg, "
            "so our value at this cell is an interpolation of a coarser observation."
        )
    if not series.denormalized:
        caveats.append(
            "WARNING: per-cell norm params were unavailable, so our series is still "
            "in z-score units and every statistic below is meaningless."
        )

    return Era5ComparisonResult(
        region=region,
        variable=var,
        unit=series.unit,
        start_date=start_date,
        end_date=end_date,
        requested_lat=float(lat),
        requested_lon=float(lon),
        series=series,
        dates=dates,
        observed=obs,
        reference=ref,
        daily_stats=daily_stats,
        monthly_labels=m_labels,
        monthly_observed=m_obs,
        monthly_reference=m_ref,
        monthly_days=m_days,
        monthly_stats=monthly_stats,
        monthly_aggregation=how,
        dataset_path=str(dataset_path),
        reference_source=str(
            (era5_payload or {}).get("source") or "era5_open_meteo"
        ),
        caveats=caveats,
    )

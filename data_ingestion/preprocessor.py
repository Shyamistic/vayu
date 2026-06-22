"""Climate data preprocessor: regridding, QC, normalization, and feature engineering.

This module handles all data harmonization from raw multi-source inputs to
model-ready, normalized tensors on the 0.25° pilot region grid.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
import xarray as xr
from scipy.interpolate import RegularGridInterpolator
from scipy.ndimage import uniform_filter

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# Pilot region constants
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 8.0, 20.0, 72.0, 78.0
INDIA_LAT_MIN, INDIA_LAT_MAX, INDIA_LON_MIN, INDIA_LON_MAX = 6.0, 38.0, 68.0, 98.0
RESOLUTION = 0.25
CLIMATOLOGY_START, CLIMATOLOGY_END = 1981, 2010
SIGMA_OUTLIER = 3.0
MAX_GAP_DAYS = 5


def _pilot_lats() -> np.ndarray:
    return np.arange(LAT_MIN, LAT_MAX + RESOLUTION / 2, RESOLUTION)


def _pilot_lons() -> np.ndarray:
    return np.arange(LON_MIN, LON_MAX + RESOLUTION / 2, RESOLUTION)


class ClimatePreprocessor:
    """Harmonizes multi-source climate data to the unified 0.25° pilot region grid.

    Pipeline:
        1. ``regrid_to_target``       — bilinear interpolation to 0.25°
        2. ``quality_control``        — flag outliers, fill short gaps
        3. ``normalize``              — z-score using 1981–2010 climatology
        4. ``encode_cyclical_time``   — sin/cos day-of-year
        5. ``spatial_interpolate_missing`` — fill satellite cloud gaps
    """

    PILOT_REGION = {
        "lat_min": LAT_MIN,
        "lat_max": LAT_MAX,
        "lon_min": LON_MIN,
        "lon_max": LON_MAX,
    }
    INDIA_REGION = {
        "lat_min": INDIA_LAT_MIN,
        "lat_max": INDIA_LAT_MAX,
        "lon_min": INDIA_LON_MIN,
        "lon_max": INDIA_LON_MAX,
    }
    RESOLUTION = RESOLUTION
    CLIMATOLOGY_PERIOD = (CLIMATOLOGY_START, CLIMATOLOGY_END)

    def __init__(
        self,
        region: dict[str, float] | None = None,
        resolution: float = RESOLUTION,
    ):
        selected_region = region or self.PILOT_REGION
        self.lat_min = float(selected_region["lat_min"])
        self.lat_max = float(selected_region["lat_max"])
        self.lon_min = float(selected_region["lon_min"])
        self.lon_max = float(selected_region["lon_max"])
        self.resolution = float(resolution)

    # ── 1. Regridding ─────────────────────────────────────────────────────────

    def regrid_to_target(
        self, ds: xr.Dataset, target_resolution: float | None = None
    ) -> xr.Dataset:
        """Regrid dataset to target resolution using bilinear interpolation.

        Clips output to the pilot region (8–20°N, 72–78°E).

        Args:
            ds: Input dataset with 'lat' and 'lon' coordinates.
            target_resolution: Output grid spacing in degrees.

        Returns:
            Dataset on the target grid within the pilot region.
        """
        target_resolution = self.resolution if target_resolution is None else target_resolution
        target_lats = np.arange(self.lat_min, self.lat_max + target_resolution / 2, target_resolution)
        target_lons = np.arange(self.lon_min, self.lon_max + target_resolution / 2, target_resolution)

        # Clip input to slightly wider than pilot region to avoid edge artifacts
        margin = 2.0
        ds_clipped = ds.sel(
            lat=slice(self.lat_min - margin, self.lat_max + margin),
            lon=slice(self.lon_min - margin, self.lon_max + margin),
        )

        src_lats = ds_clipped.lat.values
        src_lons = ds_clipped.lon.values

        regridded_vars: dict[str, xr.DataArray] = {}
        for var in ds_clipped.data_vars:
            arr = ds_clipped[var].values  # shape: (time, lat, lon)
            out = np.full((arr.shape[0], len(target_lats), len(target_lons)), np.nan, dtype=np.float32)

            for t in range(arr.shape[0]):
                slice_2d = arr[t]
                # Replace NaN with nearest-neighbor fill for interpolator
                nan_mask = np.isnan(slice_2d)
                if nan_mask.all():
                    out[t] = np.nan
                    continue
                # Fill NaN with column mean for stable interpolation
                col_means = np.nanmean(slice_2d, axis=0)
                filled = np.where(nan_mask, col_means[np.newaxis, :], slice_2d)

                interp = RegularGridInterpolator(
                    (src_lats, src_lons),
                    filled,
                    method="linear",
                    bounds_error=False,
                    fill_value=np.nan,
                )
                grid_lats, grid_lons = np.meshgrid(target_lats, target_lons, indexing="ij")
                pts = np.stack([grid_lats.ravel(), grid_lons.ravel()], axis=-1)
                out[t] = interp(pts).reshape(len(target_lats), len(target_lons))
                # Re-apply NaN where original was NaN (nearest mapping)
                if nan_mask.any():
                    nan_interp = RegularGridInterpolator(
                        (src_lats, src_lons),
                        nan_mask.astype(float),
                        method="nearest",
                        bounds_error=False,
                        fill_value=1.0,
                    )
                    nan_out = nan_interp(pts).reshape(len(target_lats), len(target_lons))
                    out[t][nan_out > 0.5] = np.nan

            regridded_vars[var] = xr.DataArray(
                out,
                dims=["time", "lat", "lon"],
                coords={
                    "time": ds_clipped.time,
                    "lat": target_lats,
                    "lon": target_lons,
                },
            )

        return xr.Dataset(regridded_vars)

    # ── 2. Quality Control ───────────────────────────────────────────────────

    def quality_control(
        self,
        ds: xr.Dataset,
        variable: str,
        climatology: xr.Dataset | None = None,
    ) -> xr.Dataset:
        """Flag outliers (>3σ from climatology) and fill gaps ≤5 days.

        Outlier detection uses the 1981-2010 daily climatology (mean ± σ per
        day-of-year per grid cell). Identified outliers and short gaps are
        filled by linear temporal interpolation.

        Args:
            ds: Input dataset.
            variable: Name of the variable to QC.
            climatology: Pre-computed climatology dataset. If None, computed
                         from the input data itself (less accurate).

        Returns:
            QC-applied dataset with a '_qc_flag' companion variable.
        """
        arr = ds[variable].values.copy()  # (time, lat, lon)
        ntime, nlat, nlon = arr.shape

        # Build or use climatology
        if climatology is not None and (variable + "_mean") in climatology:
            clim_mean = climatology[variable + "_mean"].values  # (365, lat, lon)
            clim_std = climatology[variable + "_std"].values
        else:
            clim_mean, clim_std = self._compute_climatology(arr, ds.time.values)

        # Get day-of-year indices (0-364)
        doys = [pd.Timestamp(t).dayofyear - 1 for t in ds.time.values]

        qc_flag = np.zeros(arr.shape, dtype=np.int8)  # 0=ok, 1=outlier, 2=gap_filled

        # Fallback temporal baseline helps catch obvious spikes when per-DOY
        # climatology is under-constrained (e.g., single-year test data).
        global_mean = np.nanmean(arr, axis=0)
        global_std = np.nanstd(arr, axis=0)
        global_std = np.where(global_std < 1e-6, 1e-6, global_std)

        for t_idx, doy in enumerate(doys):
            doy_clipped = min(doy, 364)
            mean = clim_mean[doy_clipped]
            std = clim_std[doy_clipped]
            # Avoid division by zero
            std_safe = np.where(std < 1e-6, 1e-6, std)
            z_scores = np.abs(arr[t_idx] - mean) / std_safe
            global_z = np.abs(arr[t_idx] - global_mean) / global_std
            outlier_mask = (z_scores > SIGMA_OUTLIER) | (global_z > SIGMA_OUTLIER)
            arr[t_idx][outlier_mask] = np.nan
            qc_flag[t_idx][outlier_mask] = 1

        # Fill short temporal gaps (≤5 consecutive NaN days) per cell
        arr, gap_flag = self._fill_temporal_gaps(arr, max_gap=MAX_GAP_DAYS)
        # Preserve outlier flags; only mark 2 where cell was otherwise unflagged.
        qc_flag = np.where(gap_flag & (qc_flag == 0), 2, qc_flag)

        ds_out = ds.copy()
        ds_out[variable] = xr.DataArray(arr, dims=["time", "lat", "lon"],
                                        coords=ds[variable].coords)
        ds_out[variable + "_qc_flag"] = xr.DataArray(
            qc_flag, dims=["time", "lat", "lon"], coords=ds[variable].coords
        )
        return ds_out

    def _compute_climatology(
        self, arr: np.ndarray, times: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        """Compute daily mean and std per grid cell over all available years."""
        import pandas as pd

        nlat, nlon = arr.shape[1], arr.shape[2]
        clim_mean = np.zeros((365, nlat, nlon), dtype=np.float32)
        clim_std = np.ones((365, nlat, nlon), dtype=np.float32)

        ts = [pd.Timestamp(t) for t in times]
        for doy in range(365):
            indices = [i for i, t in enumerate(ts) if (t.dayofyear - 1) % 365 == doy]
            if indices:
                subset = arr[indices]
                clim_mean[doy] = np.nanmean(subset, axis=0)
                clim_std[doy] = np.nanstd(subset, axis=0)
        return clim_mean, clim_std

    def _fill_temporal_gaps(
        self, arr: np.ndarray, max_gap: int = 5
    ) -> tuple[np.ndarray, np.ndarray]:
        """Linear interpolation across temporal gaps ≤ max_gap days per cell.

        Returns:
            Tuple of (filled_array, gap_filled_mask).
        """
        filled = arr.copy()
        gap_flag = np.zeros(arr.shape, dtype=bool)
        ntime, nlat, nlon = arr.shape

        for lat_i in range(nlat):
            for lon_j in range(nlon):
                cell = arr[:, lat_i, lon_j]
                nan_idx = np.where(np.isnan(cell))[0]
                if len(nan_idx) == 0:
                    continue
                # Group consecutive NaN indices into gaps
                gaps = np.split(nan_idx, np.where(np.diff(nan_idx) > 1)[0] + 1)
                for gap in gaps:
                    if len(gap) > max_gap:
                        continue  # too long to fill
                    g_start, g_end = gap[0], gap[-1]
                    # Need valid values on both sides
                    left = g_start - 1
                    right = g_end + 1
                    if left < 0 or right >= ntime:
                        continue
                    if np.isnan(cell[left]) or np.isnan(cell[right]):
                        continue
                    # Linear interpolation
                    for k, t_idx in enumerate(gap):
                        alpha = (k + 1) / (len(gap) + 1)
                        filled[t_idx, lat_i, lon_j] = (
                            cell[left] * (1 - alpha) + cell[right] * alpha
                        )
                    gap_flag[gap, lat_i, lon_j] = True

        return filled, gap_flag

    # ── 3. Normalization ──────────────────────────────────────────────────────

    def normalize(
        self,
        ds: xr.Dataset,
        climatology_ds: xr.Dataset | None = None,
    ) -> tuple[xr.Dataset, dict[str, dict]]:
        """Z-score normalize each variable per grid cell over 1981-2010.

        Args:
            ds: Input dataset.
            climatology_ds: Pre-computed per-cell mean/std from 1981-2010.
                            If None, computed from the input data.

        Returns:
            Tuple of (normalized_ds, norm_params_dict).
            norm_params_dict maps variable → {"mean": array, "std": array}.
        """
        norm_params: dict[str, dict] = {}
        normalized_vars: dict[str, xr.DataArray] = {}

        for var in ds.data_vars:
            if var.endswith("_qc_flag"):
                normalized_vars[var] = ds[var]
                continue

            arr = ds[var].values.astype(np.float32)

            if climatology_ds is not None and (var + "_mean") in climatology_ds:
                mean = climatology_ds[var + "_mean"].values
                std = climatology_ds[var + "_std"].values
            else:
                mean = np.nanmean(arr, axis=0)
                std = np.nanstd(arr, axis=0)
                std = np.where(std < 1e-6, 1e-6, std)

            normalized = (arr - mean[np.newaxis]) / std[np.newaxis]
            norm_params[var] = {"mean": mean, "std": std}
            normalized_vars[var] = xr.DataArray(
                normalized, dims=ds[var].dims, coords=ds[var].coords
            )

        return xr.Dataset(normalized_vars), norm_params

    def denormalize(
        self,
        ds: xr.Dataset,
        norm_params: dict[str, dict],
    ) -> xr.Dataset:
        """Reverse z-score normalization.

        |denormalize(normalize(x)) - x| < ε for all valid cells.
        """
        result_vars: dict[str, xr.DataArray] = {}
        for var in ds.data_vars:
            if var not in norm_params:
                result_vars[var] = ds[var]
                continue
            arr = ds[var].values.astype(np.float32)
            mean = norm_params[var]["mean"]
            std = norm_params[var]["std"]
            result_vars[var] = xr.DataArray(
                arr * std[np.newaxis] + mean[np.newaxis],
                dims=ds[var].dims,
                coords=ds[var].coords,
            )
        return xr.Dataset(result_vars)

    # ── 4. Cyclical Time Encoding ─────────────────────────────────────────────

    def encode_cyclical_time(self, ds: xr.Dataset) -> xr.Dataset:
        """Add sin/cos day-of-year features with 365.25-day period.

        Encoded as scalar time features (not spatially varying).
        These are added as 1D coordinate variables over time.
        """
        import pandas as pd

        times = [pd.Timestamp(t) for t in ds.time.values]
        doys = np.array([t.dayofyear for t in times], dtype=np.float32)
        period = 365.25
        # Keep end-of-year transition smooth for short windows around Jan 1.
        doys = np.where(doys >= 364, period, doys)

        day_sin = np.sin(2 * np.pi * doys / period).astype(np.float32)
        day_cos = np.cos(2 * np.pi * doys / period).astype(np.float32)

        ds_out = ds.assign_coords(
            day_sin=("time", day_sin),
            day_cos=("time", day_cos),
        )
        return ds_out

    # ── 5. Spatial Interpolation for INSAT ───────────────────────────────────

    def spatial_interpolate_missing(
        self, ds: xr.Dataset, max_radius: int = 3
    ) -> xr.Dataset:
        """Fill cloud-contaminated INSAT pixels via spatial interpolation.

        For each NaN cell, computes the mean of valid cells within a square
        window of (2*max_radius+1) × (2*max_radius+1) centered on the cell.
        Only fills if at least one valid neighbor exists within the radius.

        Args:
            ds: Dataset with potential NaN values (INSAT cloud gaps).
            max_radius: Maximum search radius in grid cells.

        Returns:
            Dataset with cloud gaps filled where possible.
        """
        result_vars: dict[str, xr.DataArray] = {}
        window = 2 * max_radius + 1

        for var in ds.data_vars:
            if var.endswith("_qc_flag"):
                result_vars[var] = ds[var]
                continue

            arr = ds[var].values.copy().astype(np.float32)  # (time, lat, lon)

            for t in range(arr.shape[0]):
                slice_2d = arr[t]
                nan_mask = np.isnan(slice_2d)
                if not nan_mask.any():
                    continue

                # Compute local mean of valid cells using uniform filter trick
                valid = np.where(nan_mask, 0.0, slice_2d)
                valid_count = (~nan_mask).astype(np.float32)

                sum_valid = uniform_filter(valid, size=window, mode="reflect") * (window ** 2)
                count_valid = uniform_filter(valid_count, size=window, mode="reflect") * (window ** 2)
                count_valid = np.round(count_valid).astype(int)

                # Fill NaN cells where at least one valid neighbor exists
                fillable = nan_mask & (count_valid > 0)
                # Subtract self-contribution (cell is NaN so contributes 0)
                arr[t][fillable] = (sum_valid[fillable] / count_valid[fillable])

            result_vars[var] = xr.DataArray(arr, dims=ds[var].dims, coords=ds[var].coords)

        return xr.Dataset(result_vars)

    # ── Full Pipeline ──────────────────────────────────────────────────────────

    def preprocess_imd(
        self,
        rainfall_ds: xr.Dataset,
        tmax_ds: xr.Dataset,
        tmin_ds: xr.Dataset,
        climatology_ds: xr.Dataset | None = None,
        ncep_dir: str | None = None,
        start_year: int = 2010,
        end_year: int = 2025,
    ) -> tuple[xr.Dataset, dict[str, dict]]:
        """Full IMD preprocessing pipeline.

        1. Regrid temperature (1°→0.25°)
        2. Clip rainfall to pilot region
        3. Quality control each variable
        4. Merge into single dataset
        5. Normalize
        6. Encode cyclical time

        Returns:
            Tuple of (processed_ds, norm_params).
        """
        logger.info("Preprocessing IMD data…")

        # 1. Regrid temperature to 0.25°
        tmax_rg = self.regrid_to_target(tmax_ds)
        tmin_rg = self.regrid_to_target(tmin_ds)

        # 2. Clip rainfall to pilot region
        rain_clipped = rainfall_ds.sel(
            lat=slice(self.lat_min, self.lat_max),
            lon=slice(self.lon_min, self.lon_max),
        )

        # IMD rainfall can arrive as either "rain" or "rainfall" depending on source path.
        if "rainfall" not in rain_clipped.data_vars and "rain" in rain_clipped.data_vars:
            rain_clipped = rain_clipped.rename({"rain": "rainfall"})

        # 3. QC each variable
        rain_qc = self.quality_control(rain_clipped, "rainfall", climatology_ds)
        tmax_qc = self.quality_control(tmax_rg, "tmax", climatology_ds)
        tmin_qc = self.quality_control(tmin_rg, "tmin", climatology_ds)

        # 4. Merge: align times
        merged = xr.merge([
            rain_qc[["rainfall", "rainfall_qc_flag"]],
            tmax_qc[["tmax", "tmax_qc_flag"]],
            tmin_qc[["tmin", "tmin_qc_flag"]],
        ], join="inner")

        # 5. Normalize (dynamic vars only)
        dynamic_vars = xr.Dataset({v: merged[v] for v in ["rainfall", "tmax", "tmin"]})
        normalized, norm_params = self.normalize(dynamic_vars, climatology_ds)

        # Re-attach QC flags
        for flag_var in ["rainfall_qc_flag", "tmax_qc_flag", "tmin_qc_flag"]:
            if flag_var in merged:
                normalized[flag_var] = merged[flag_var]

        # 6. Encode cyclical time
        normalized = self.encode_cyclical_time(normalized)

        # 7. Merge NCEP wind at 850 hPa (optional — graceful fallback if absent)
        if ncep_dir is not None:
            ncep_ds = self.load_ncep_wind_at_850(ncep_dir, start_year, end_year)
            if ncep_ds is not None:
                # Align to the same time axis as the IMD data
                ncep_aligned = ncep_ds.reindex(time=normalized.time, method="nearest", tolerance="1D")
                for var in ncep_ds.data_vars:
                    if var not in normalized:
                        normalized[var] = ncep_aligned[var].fillna(0.0)
                logger.info("Merged NCEP 850 hPa wind into normalized dataset: %s", list(ncep_ds.data_vars))

        return normalized, norm_params

    def load_ncep_wind_at_850(
        self,
        ncep_dir: str,
        start_year: int,
        end_year: int,
    ) -> xr.Dataset | None:
        """Load NCEP-NCAR daily wind + humidity, select 850 hPa, regrid to 0.25°.

        Reads ``uwnd.YYYY.nc``, ``vwnd.YYYY.nc``, ``shum.YYYY.nc`` from *ncep_dir*
        for the given year range, extracts the 850 hPa level, and bilinearly
        regrids from 2.5° → 0.25° onto the preprocessor's pilot region grid.

        Returns None (with a warning) if no files are found so the pipeline
        degrades gracefully when NCEP data is absent.
        """
        import glob as _glob

        ncep_path = Path(ncep_dir)
        var_map = {"uwnd": "uwnd_850", "vwnd": "vwnd_850", "shum": "shum_850"}
        combined: dict[str, list[xr.DataArray]] = {v: [] for v in var_map.values()}

        for short, long in var_map.items():
            for year in range(start_year, end_year + 1):
                pattern = str(ncep_path / f"{short}.{year}.nc")
                files = _glob.glob(pattern)
                if not files:
                    logger.warning("NCEP file not found: %s (skipping year %d)", pattern, year)
                    continue
                ds = xr.open_dataset(files[0])
                # Select 850 hPa level — NCEP uses 'level' coordinate in hPa
                if "level" in ds.dims:
                    ds = ds.sel(level=850, method="nearest")
                arr = ds[[v for v in ds.data_vars if short in v.lower()][0]]
                arr.name = long
                combined[long].append(arr)

        # Check any data was found
        if not any(combined.values()):
            logger.warning("No NCEP wind files found in %s — skipping wind features", ncep_dir)
            return None

        arrays = {}
        for long_name, da_list in combined.items():
            if da_list:
                merged_da = xr.concat(da_list, dim="time").sortby("time")
                # Rename lat/lon if needed (NCEP sometimes uses 'lat'/'lon' already)
                rename_map = {}
                if "latitude" in merged_da.dims:
                    rename_map["latitude"] = "lat"
                if "longitude" in merged_da.dims:
                    rename_map["longitude"] = "lon"
                if rename_map:
                    merged_da = merged_da.rename(rename_map)
                arrays[long_name] = merged_da

        if not arrays:
            return None

        ncep_ds = xr.Dataset(arrays)

        # Regrid 2.5° NCEP → 0.25° target grid
        target_lats = np.arange(self.lat_min, self.lat_max + self.resolution / 2, self.resolution)
        target_lons = np.arange(self.lon_min, self.lon_max + self.resolution / 2, self.resolution)
        margin = 5.0
        ncep_clipped = ncep_ds.sel(
            lat=slice(self.lat_min - margin, self.lat_max + margin),
            lon=slice(self.lon_min - margin, self.lon_max + margin),
        )

        src_lats = ncep_clipped.lat.values.astype(float)
        src_lons = ncep_clipped.lon.values.astype(float)
        regridded: dict[str, xr.DataArray] = {}

        for var in ncep_clipped.data_vars:
            arr = ncep_clipped[var].values.astype(np.float32)  # (time, lat, lon)
            out = np.full((arr.shape[0], len(target_lats), len(target_lons)), np.nan, dtype=np.float32)
            for t in range(arr.shape[0]):
                slab = arr[t]
                nan_mask = np.isnan(slab)
                if nan_mask.all():
                    continue
                if nan_mask.any():
                    from scipy.ndimage import distance_transform_edt
                    idx = distance_transform_edt(nan_mask, return_distances=False, return_indices=True)
                    slab = slab[tuple(idx)]
                interp = RegularGridInterpolator(
                    (src_lats, src_lons), slab,
                    method="linear", bounds_error=False, fill_value=None,
                )
                tlon, tlat = np.meshgrid(target_lons, target_lats)
                out[t] = interp(np.stack([tlat.ravel(), tlon.ravel()], axis=1)).reshape(
                    len(target_lats), len(target_lons)
                )
            regridded[var] = xr.DataArray(
                out,
                coords={"time": ncep_clipped.time, "lat": target_lats, "lon": target_lons},
                dims=["time", "lat", "lon"],
            )

        result = xr.Dataset(regridded)
        logger.info(
            "NCEP wind loaded: %d days, variables=%s",
            len(result.time),
            list(result.data_vars),
        )
        return result


# Need pandas for timestamp operations
import pandas as pd  # noqa: E402 — deferred import for performance

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

# Pilot and strict full-India region constants.
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 8.0, 20.0, 72.0, 78.0
INDIA_LAT_MIN, INDIA_LAT_MAX, INDIA_LON_MIN, INDIA_LON_MAX = 6.0, 38.0, 66.0, 100.0
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
        fit_time_range: tuple[str, str] | None = None,
    ) -> tuple[xr.Dataset, dict[str, dict]]:
        """Z-score normalize each variable with externally supplied or fit-period statistics.

        When ``climatology_ds`` is not supplied, statistics are fit only over
        ``fit_time_range`` when provided. This prevents validation/test leakage.
        """
        fit_ds = ds
        if climatology_ds is None and fit_time_range is not None:
            if "time" not in ds.coords:
                raise ValueError("fit_time_range requires a time coordinate")
            fit_ds = ds.sel(time=slice(fit_time_range[0], fit_time_range[1]))
            if int(fit_ds.sizes.get("time", 0)) == 0:
                raise ValueError(f"No observations in normalization fit range {fit_time_range}")

        norm_params: dict[str, dict] = {}
        normalized_vars: dict[str, xr.DataArray] = {}

        for var in ds.data_vars:
            if var.endswith("_qc_flag") or var.endswith("_available"):
                normalized_vars[var] = ds[var]
                continue

            arr = ds[var].values.astype(np.float32)
            if climatology_ds is not None and (var + "_mean") in climatology_ds:
                mean = climatology_ds[var + "_mean"].values
                std = climatology_ds[var + "_std"].values
            else:
                fit_arr = fit_ds[var].values.astype(np.float32)
                mean = np.nanmean(fit_arr, axis=0)
                std = np.nanstd(fit_arr, axis=0)
                std = np.where(np.isfinite(std) & (std >= 1e-6), std, 1.0)

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
        era5_dir: str | None = None,
        chirps_dir: str | None = None,
        oisst_dir: str | None = None,
        era5_lst_dir: str | None = None,
        start_year: int = 2010,
        end_year: int = 2025,
        normalization_fit_start_year: int | None = None,
        normalization_fit_end_year: int | None = None,
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

        # 2. Clip rainfall to pilot region — optionally blend with CHIRPS
        rain_clipped = rainfall_ds.sel(
            lat=slice(self.lat_min, self.lat_max),
            lon=slice(self.lon_min, self.lon_max),
        )

        # IMD rainfall can arrive as either "rain" or "rainfall" depending on source path.
        if "rainfall" not in rain_clipped.data_vars and "rain" in rain_clipped.data_vars:
            rain_clipped = rain_clipped.rename({"rain": "rainfall"})

        if chirps_dir is not None:
            chirps = self._load_chirps(chirps_dir, start_year, end_year)
            if chirps is not None:
                # CHIRPS is kept as a separate auxiliary input feature (chirps_rain),
                # NOT used to replace IMD rainfall target.
                # Rationale: CHIRPS satellite estimates are systematically biased for
                # Western Ghats due to orographic cloud trapping (clouds form without
                # precipitating). Replacing IMD ground-truth with CHIRPS makes
                # R²_rain permanently negative. Use CHIRPS as an additional predictor.
                chirps_aligned = chirps.reindex_like(rain_clipped, method="nearest", tolerance=1)
                # Preserve missingness until graph construction; a companion
                # availability field distinguishes absent observations from true zeros.
                chirps_rain = chirps_aligned["rainfall"].rename("chirps_rain")
                rain_clipped = rain_clipped.assign(
                    chirps_rain=chirps_rain,
                    chirps_rain_available=xr.where(chirps_rain.notnull(), 1.0, 0.0).astype(np.float32),
                )
                logger.info("CHIRPS added as auxiliary feature 'chirps_rain' (IMD rainfall preserved as target)")

        # 3. QC each variable
        rain_qc = self.quality_control(rain_clipped, "rainfall", climatology_ds)
        tmax_qc = self.quality_control(tmax_rg, "tmax", climatology_ds)
        tmin_qc = self.quality_control(tmin_rg, "tmin", climatology_ds)

        # 4. Merge and preserve auxiliary predictors/availability fields.
        rain_vars = ["rainfall", "rainfall_qc_flag"]
        rain_vars.extend(v for v in ["chirps_rain", "chirps_rain_available"] if v in rain_qc)
        merged = xr.merge([
            rain_qc[rain_vars],
            tmax_qc[["tmax", "tmax_qc_flag"]],
            tmin_qc[["tmin", "tmin_qc_flag"]],
        ], join="inner")

        # 5. Normalize using training-period statistics only when requested.
        dynamic_names = ["rainfall", "tmax", "tmin"]
        if "chirps_rain" in merged:
            dynamic_names.append("chirps_rain")
        dynamic_vars = xr.Dataset({v: merged[v] for v in dynamic_names})
        fit_range = None
        if normalization_fit_start_year is not None or normalization_fit_end_year is not None:
            fit_start = normalization_fit_start_year or start_year
            fit_end = normalization_fit_end_year or end_year
            if fit_start > fit_end:
                raise ValueError("normalization fit start year must not exceed end year")
            fit_range = (f"{fit_start}-01-01", f"{fit_end}-12-31")
        normalized, norm_params = self.normalize(
            dynamic_vars, climatology_ds, fit_time_range=fit_range
        )

        # Re-attach QC and availability fields without normalization.
        for flag_var in [
            "rainfall_qc_flag", "tmax_qc_flag", "tmin_qc_flag",
            "chirps_rain_available",
        ]:
            if flag_var in merged:
                normalized[flag_var] = merged[flag_var]

        # 6. Encode cyclical time
        normalized = self.encode_cyclical_time(normalized)

        # 7. Merge 850 hPa wind/humidity (optional — graceful fallback if absent).
        # ERA5 is preferred over NCEP when both are provided (finer native
        # resolution, no known component-grid-mismatch blocker); NCEP fills in
        # any feature ERA5 doesn't supply (e.g. a year still downloading).
        reanalysis_ds: xr.Dataset | None = None
        reanalysis_source = None
        if era5_dir is not None:
            reanalysis_ds = self.load_era5_at_850(era5_dir, start_year, end_year)
            reanalysis_source = "ERA5"
        if ncep_dir is not None:
            ncep_ds = self.load_ncep_wind_at_850(ncep_dir, start_year, end_year)
            if ncep_ds is not None:
                if reanalysis_ds is None:
                    reanalysis_ds, reanalysis_source = ncep_ds, "NCEP"
                else:
                    # Fill only features ERA5 didn't provide; never overwrite ERA5 values.
                    missing_vars = [v for v in ncep_ds.data_vars if v not in reanalysis_ds.data_vars]
                    if missing_vars:
                        reanalysis_ds = xr.merge([reanalysis_ds, ncep_ds[missing_vars]])
                        reanalysis_source = f"{reanalysis_source}+NCEP({','.join(missing_vars)})"

        if reanalysis_ds is not None:
            # Align to the same time axis as the IMD data
            reanalysis_aligned = reanalysis_ds.reindex(time=normalized.time, method="nearest", tolerance="1D")
            for var in reanalysis_ds.data_vars:
                if var not in normalized:
                    aligned = reanalysis_aligned[var]
                    normalized[f"{var}_available"] = xr.where(
                        aligned.notnull(), 1.0, 0.0
                    ).astype(np.float32)
                    normalized[var] = aligned.fillna(0.0)
            logger.info(
                "Merged 850 hPa reanalysis into normalized dataset (source=%s): %s",
                reanalysis_source, list(reanalysis_ds.data_vars),
            )

        # 8. Merge sea-surface temperature into the insat_sst slot.
        #
        # DISCLOSURE: this is NOAA OISST v2.1 (optimum-interpolation AVHRR + in-situ
        # blend), NOT INSAT-3D SST. MOSDAC access for the real 3RIMG_L3B_SST_DLY
        # product was never approved (see DATA_ACQUISITION_TASKS.md section 2 —
        # still open as of this commit). OISST is used as a stand-in for the
        # `insat_sst` feature slot until/unless MOSDAC access is granted, and this
        # substitution must be stated in any manifest or report that cites this
        # feature — never presented as real INSAT-3D data.
        #
        # insat_lst is filled from ERA5-Land skin temperature when
        # *era5_lst_dir* is supplied (see step 9 below); without it the channel
        # stays zero with `insat_lst_available=0`.
        if oisst_dir is not None:
            oisst = self._load_oisst_sst(oisst_dir, start_year, end_year)
            if oisst is not None:
                oisst_aligned = oisst.reindex(
                    time=normalized.time, method="nearest", tolerance="1D"
                )
                sst = oisst_aligned["sst"]
                normalized["insat_sst_available"] = xr.where(
                    sst.notnull(), 1.0, 0.0
                ).astype(np.float32)
                normalized["insat_sst"] = sst.fillna(0.0).astype(np.float32)
                logger.info(
                    "Merged NOAA OISST v2.1 into 'insat_sst' slot (SUBSTITUTE for "
                    "INSAT-3D SST — MOSDAC access not yet approved): %d days",
                    int(sst.notnull().any(dim=[d for d in sst.dims if d != "time"]).sum()),
                )

        # 9. Merge land-surface temperature into the insat_lst slot.
        #
        # DISCLOSURE: this is ERA5-Land skin temperature (`skt`), NOT INSAT-3D
        # LST. MOSDAC access for the real 3RIMG_L2B_LST product was never
        # approved (see DATA_ACQUISITION_TASKS.md section 2). ERA5-Land skin
        # temperature is a documented, widely-used proxy for land surface
        # temperature, but it is a reanalysis land-model diagnostic rather than
        # a satellite thermal-infrared retrieval, and must be described as such
        # in any manifest or report that cites this feature.
        #
        # ERA5-Land is land-only, so ocean cells arrive as NaN and end up with
        # insat_lst=0 / insat_lst_available=0. That is correct rather than a
        # defect: LST is a land quantity, and ocean is covered by insat_sst.
        if era5_lst_dir is not None:
            lst = self._load_era5_land_lst(era5_lst_dir, start_year, end_year)
            if lst is not None:
                lst_aligned = lst.reindex(
                    time=normalized.time, method="nearest", tolerance="1D"
                )
                skt = lst_aligned["skt"]
                normalized["insat_lst_available"] = xr.where(
                    skt.notnull(), 1.0, 0.0
                ).astype(np.float32)
                normalized["insat_lst"] = skt.fillna(0.0).astype(np.float32)
                logger.info(
                    "Merged ERA5-Land skin temperature into 'insat_lst' slot "
                    "(SUBSTITUTE for INSAT-3D LST — MOSDAC access not "
                    "approved): %d days",
                    int(skt.notnull().any(
                        dim=[d for d in skt.dims if d != "time"]).sum()),
                )

        return normalized, norm_params

    def _load_era5_land_lst(
        self,
        era5_lst_dir: str,
        start_year: int,
        end_year: int,
    ) -> xr.Dataset | None:
        """Load ERA5-Land skin temperature, aggregate to daily, regrid to 0.25°.

        Expects per-year files named ``era5_land_lst_india_YYYY.nc`` (the format
        produced by ``scripts/download_era5_land_lst.py``) holding the ``skt``
        variable on ERA5-Land's native 0.1° grid.

        Two source-specific details are handled here:

        * The files are **12-hourly** (06:00 and 18:00 UTC, roughly 11:30 and
          23:30 IST — a day/night pair). The model consumes daily fields, so
          these are averaged per calendar day. Note this makes the channel a
          daily *mean* skin temperature, not a daytime maximum, so it is not
          directly comparable to MODIS daytime LST.
        * ``skt`` is in **kelvin**; it is converted to °C so the channel is on
          the same scale as the IMD tmax/tmin and OISST insat_sst channels
          before the shared normalization step sees it.

        Coordinates are ``valid_time``/``latitude``/``longitude`` in CDS output
        and are renamed to the ``time``/``lat``/``lon`` convention used
        throughout this preprocessor.

        Returns None (with a warning) if no files are found, matching the
        graceful-degradation behaviour of ``_load_oisst_sst`` and
        ``load_ncep_wind_at_850``.
        """
        import glob as _glob

        lst_path = Path(era5_lst_dir)
        frames: list[xr.DataArray] = []

        for year in range(start_year, end_year + 1):
            files = sorted(_glob.glob(str(lst_path / f"*{year}*.nc")))
            if not files:
                logger.debug("No ERA5-Land LST file for %d in %s", year, lst_path)
                continue
            ds = xr.open_dataset(files[0])
            if "skt" not in ds.data_vars:
                logger.warning(
                    "ERA5-Land file %s has no 'skt' variable (has %s) — skipping",
                    files[0], list(ds.data_vars),
                )
                continue
            da = ds["skt"]
            rename: dict[str, str] = {}
            if "valid_time" in da.dims:
                rename["valid_time"] = "time"
            if "latitude" in da.dims:
                rename["latitude"] = "lat"
            if "longitude" in da.dims:
                rename["longitude"] = "lon"
            if rename:
                da = da.rename(rename)
            # Drop CDS singleton coords that would otherwise block concat.
            for extra in ("number", "expver"):
                if extra in da.coords:
                    da = da.drop_vars(extra)
            # 12-hourly → daily mean.
            da = da.resample(time="1D").mean()
            frames.append(da)

        if not frames:
            logger.warning(
                "No ERA5-Land LST files found in %s — insat_lst stays zero-filled",
                era5_lst_dir,
            )
            return None

        merged = xr.concat(frames, dim="time").sortby("time")
        # Kelvin → Celsius, matching tmax/tmin and insat_sst.
        merged = merged - 273.15
        merged.name = "skt"

        lst_ds = xr.Dataset({"skt": merged}).sortby("lat").sortby("lon")
        result = self._regrid_reanalysis_dataset(lst_ds, margin=5.0)
        logger.info(
            "ERA5-Land LST loaded: %d days, regridded to model grid",
            len(result.time),
        )
        return result

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
                # Try both NCEP-raw format (uwnd.YYYY.nc) and subsetted format (uwnd_YYYY_850hPa_WG.nc)
                candidates = [
                    str(ncep_path / f"{short}.{year}.nc"),
                    str(ncep_path / f"{short}_{year}_850hPa_WG.nc"),
                    str(ncep_path / f"{short}_{year}_*.nc"),
                ]
                files = []
                for pattern in candidates:
                    files = _glob.glob(pattern)
                    if files:
                        break
                pattern = candidates[0]  # for logging only
                if not files:
                    logger.warning("NCEP file not found: %s (skipping year %d)", pattern, year)
                    continue
                ds = xr.open_dataset(files[0])
                # Select 850 hPa level — NCEP uses 'level' coordinate in hPa
                if "level" in ds.dims:
                    ds = ds.sel(level=850, method="nearest")
                matching_vars = [v for v in ds.data_vars if short in v.lower()]
                if not matching_vars:
                    logger.warning(
                        "No variable matching '%s' in %s (data_vars=%s) — skipping",
                        short, files[0], list(ds.data_vars),
                    )
                    continue
                arr = ds[matching_vars[0]]
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

        # Ensure lat/lon are ascending — NCEP subsets may have descending lat.
        # sortby is required both for sel(slice) and RegularGridInterpolator.
        ncep_ds = ncep_ds.sortby("lat").sortby("lon")

        result = self._regrid_reanalysis_dataset(ncep_ds, margin=5.0)
        logger.info(
            "NCEP wind loaded: %d days, variables=%s",
            len(result.time),
            list(result.data_vars),
        )
        return result

    def _regrid_reanalysis_dataset(self, ds: xr.Dataset, margin: float = 5.0) -> xr.Dataset:
        """Bilinearly regrid a coarse reanalysis dataset (lat/lon/time) onto the
        preprocessor's target 0.25° grid. Shared by the NCEP and ERA5 loaders so
        the two sources produce identical downstream grids/behavior.

        Requires *ds* to already have ``lat``/``lon``/``time`` dims with ascending
        lat/lon coordinates (callers must ``sortby`` first).
        """
        target_lats = np.arange(self.lat_min, self.lat_max + self.resolution / 2, self.resolution)
        target_lons = np.arange(self.lon_min, self.lon_max + self.resolution / 2, self.resolution)
        clipped = ds.sel(
            lat=slice(self.lat_min - margin, self.lat_max + margin),
            lon=slice(self.lon_min - margin, self.lon_max + margin),
        )

        src_lats = clipped.lat.values.astype(float)
        src_lons = clipped.lon.values.astype(float)
        regridded: dict[str, xr.DataArray] = {}

        for var in clipped.data_vars:
            arr = clipped[var].values.astype(np.float32)  # (time, lat, lon)
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
                coords={"time": clipped.time, "lat": target_lats, "lon": target_lons},
                dims=["time", "lat", "lon"],
            )

        return xr.Dataset(regridded)

    def load_era5_at_850(
        self,
        era5_dir: str,
        start_year: int,
        end_year: int,
    ) -> xr.Dataset | None:
        """Load Copernicus CDS ERA5 850 hPa wind + specific humidity, regrid to 0.25°.

        Reads ``era5_{uwnd,vwnd,shum}_{YYYY}_850hPa.nc`` from *era5_dir*
        (produced by ``data/download_era5.py``). Unlike NCEP files, ERA5's
        NetCDF variable names do not match its filename convention — CDS
        exports single-letter short names (``u``, ``v``, ``q``) rather than
        ``uwnd``/``vwnd``/``shum`` — and ERA5 uses ``valid_time``/``latitude``/
        ``longitude``/``pressure_level`` coordinate names instead of NCEP's
        ``time``/``lat``/``lon``/``level``. This loader renames both the
        variables and the coordinates so the result is interchangeable with
        ``load_ncep_wind_at_850``'s output (``uwnd_850``/``vwnd_850``/``shum_850``
        on a ``time``/``lat``/``lon`` grid).

        ERA5's ``rhum`` (relative humidity, variable ``r``) is intentionally
        NOT loaded here — the model's declared 17th input feature (``shum_850``,
        config.py) is specific humidity, not relative humidity, so ``rhum``
        would be the wrong physical quantity for that slot. If ``rhum`` is later
        needed as its own auxiliary feature, add it as a separate named channel
        rather than substituting it for ``shum_850``.

        Returns None (with a warning) if no files are found so the pipeline
        degrades gracefully when ERA5 data is absent or download is incomplete
        for a given year — partial year coverage (e.g. only 2010 downloaded so
        far) is merged as-is; missing years are simply absent from the time axis.
        """
        import glob as _glob

        era5_path = Path(era5_dir)
        # short CDS variable name -> (filename component, output feature name)
        var_map = {"u": ("uwnd", "uwnd_850"), "v": ("vwnd", "vwnd_850"), "q": ("shum", "shum_850")}
        combined: dict[str, list[xr.DataArray]] = {long: [] for _, long in var_map.values()}
        years_found: set[int] = set()

        for cds_name, (file_component, long_name) in var_map.items():
            for year in range(start_year, end_year + 1):
                pattern = str(era5_path / f"era5_{file_component}_{year}_850hPa.nc")
                files = _glob.glob(pattern)
                if not files:
                    logger.debug("ERA5 file not found: %s (skipping year %d)", pattern, year)
                    continue
                ds = xr.open_dataset(files[0])
                if "pressure_level" in ds.dims:
                    ds = ds.sel(pressure_level=850, method="nearest")
                if cds_name not in ds.data_vars:
                    logger.warning(
                        "Expected ERA5 variable '%s' not found in %s (data_vars=%s) — skipping",
                        cds_name, files[0], list(ds.data_vars),
                    )
                    continue
                arr = ds[cds_name]
                arr.name = long_name
                combined[long_name].append(arr)
                years_found.add(year)

        if not any(combined.values()):
            logger.warning("No ERA5 850 hPa files found in %s — skipping ERA5 wind/humidity features", era5_dir)
            return None

        arrays = {}
        for long_name, da_list in combined.items():
            if not da_list:
                logger.warning(
                    "ERA5 feature '%s' has no data in %s for any year in %d-%d — it will be absent "
                    "from the merged dataset rather than silently zero-filled.",
                    long_name, era5_dir, start_year, end_year,
                )
                continue
            merged_da = xr.concat(da_list, dim="valid_time").sortby("valid_time")
            rename_map = {"valid_time": "time", "latitude": "lat", "longitude": "lon"}
            rename_map = {k: v for k, v in rename_map.items() if k in merged_da.dims}
            if rename_map:
                merged_da = merged_da.rename(rename_map)
            arrays[long_name] = merged_da

        if not arrays:
            return None

        era5_ds = xr.Dataset(arrays).sortby("lat").sortby("lon")
        result = self._regrid_reanalysis_dataset(era5_ds, margin=5.0)
        logger.info(
            "ERA5 850 hPa loaded: %d days, years_covered=%s (of %d-%d requested), variables=%s",
            len(result.time), sorted(years_found), start_year, end_year, list(result.data_vars),
        )
        return result

    def _load_oisst_sst(
        self,
        oisst_dir: str,
        start_year: int,
        end_year: int,
    ) -> xr.Dataset | None:
        """Load NOAA OISST v2.1 daily SST, clipped and regridded to the target grid.

        Expects per-day files named ``oisst-avhrr-v02r01.YYYYMMDD.nc`` (the format
        produced by ``data/download_oisst_sst.py``), each a global 0.25 deg grid
        with longitude in 0-360 convention. Longitude is converted to -180..180
        before clipping since the preprocessor's region bounds use that convention.

        SST is a scalar field (not a directional/vector quantity like wind), so no
        component-alignment concerns apply here the way they do for uwnd/vwnd —
        unlike wind, no bilinear-regrid-then-recombine step is needed beyond the
        same nearest/linear regrid already used for reanalysis fields.

        Returns None (with a warning) if no files are found, matching the
        graceful-degradation behavior of ``_load_chirps`` / ``load_ncep_wind_at_850``.
        """
        import glob as _glob

        oisst_path = Path(oisst_dir)
        frames: list[xr.DataArray] = []

        for year in range(start_year, end_year + 1):
            files = sorted(_glob.glob(str(oisst_path / f"oisst-avhrr-v02r01.{year}*.nc")))
            if not files:
                logger.debug("No OISST files for %d in %s", year, oisst_path)
                continue
            for f in files:
                ds = xr.open_dataset(f)
                if "sst" not in ds.data_vars:
                    logger.warning("OISST file %s has no 'sst' variable — skipping", f)
                    continue
                da = ds["sst"]
                if "zlev" in da.dims:
                    da = da.isel(zlev=0, drop=True)
                frames.append(da)

        if not frames:
            logger.warning("No OISST files found in %s — insat_sst stays zero-filled", oisst_dir)
            return None

        merged = xr.concat(frames, dim="time").sortby("time")

        # OISST longitude is 0..360; region bounds (this project) use -180..180.
        lon_180 = ((merged.lon.values + 180) % 360) - 180
        merged = merged.assign_coords(lon=lon_180).sortby("lon")

        oisst_ds = xr.Dataset({"sst": merged}).sortby("lat")
        result = self._regrid_reanalysis_dataset(oisst_ds, margin=5.0)
        logger.info("OISST SST loaded: %d days, region clipped to model grid", len(result.time))
        return result

    def _load_chirps(
        self,
        chirps_dir: str,
        start_year: int,
        end_year: int,
    ) -> xr.Dataset | None:
        """Load CHIRPS gauge-satellite merged rainfall, clipped to region.

        Expects files named ``chirps_YYYY_WG.nc`` (subsetted) OR the global
        ``chirps-v2.0.YYYY.days_p25.nc`` files. Subsetted files are preferred
        for speed; global files are automatically clipped on load.

        Returns None with a warning if no files are found.
        """
        import glob as _glob

        chirps_path = Path(chirps_dir)
        yearly: list[xr.Dataset] = []

        for year in range(start_year, end_year + 1):
            # Prefer pre-subsetted file
            subsetted = list(chirps_path.glob(f"chirps_{year}_WG.nc"))
            global_f  = list(chirps_path.glob(f"chirps-v2.0.{year}*.nc"))
            candidates = subsetted or global_f

            if not candidates:
                logger.debug("No CHIRPS file for %d — skipping", year)
                continue

            ds = xr.open_dataset(candidates[0])
            # Normalise coordinate names
            rename = {}
            if "latitude"  in ds.dims: rename["latitude"]  = "lat"
            if "longitude" in ds.dims: rename["longitude"] = "lon"
            if rename: ds = ds.rename(rename)

            # Clip if not already subsetted
            ds = ds.sel(
                lat=slice(self.lat_min, self.lat_max),
                lon=slice(self.lon_min, self.lon_max),
            )

            # Normalise variable name to 'rainfall'
            for v in list(ds.data_vars):
                if v.lower() in ("precip", "precipitation", "prcp", "p", "rr"):
                    ds = ds.rename({v: "rainfall"})
                    break

            if "rainfall" not in ds.data_vars:
                logger.warning("CHIRPS %d: no recognisable rainfall variable, skipping", year)
                continue

            yearly.append(ds[["rainfall"]])

        if not yearly:
            logger.warning("No CHIRPS files found in %s — skipping CHIRPS blend", chirps_dir)
            return None

        chirps_merged = xr.concat(yearly, dim="time").sortby("time")
        logger.info("CHIRPS loaded: %d days, region clipped to model grid", len(chirps_merged.time))
        return chirps_merged


# Need pandas for timestamp operations
import pandas as pd  # noqa: E402 — deferred import for performance

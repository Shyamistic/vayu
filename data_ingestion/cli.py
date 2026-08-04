"""CLI for data ingestion pipeline."""

from __future__ import annotations

import shutil
import json
import logging
import typer
from pathlib import Path

import torch

app = typer.Typer(name="vayu-ingest", help="VAYU Climate Data Ingestion CLI")
logger = logging.getLogger(__name__)


def _resolve_region_bounds(
    region: str,
    lat_min: float | None,
    lat_max: float | None,
    lon_min: float | None,
    lon_max: float | None,
) -> dict[str, float]:
    region = region.lower()
    if region == "pilot":
        bounds = {"lat_min": 8.0, "lat_max": 20.0, "lon_min": 72.0, "lon_max": 78.0}
    elif region == "western_ghats":
        bounds = {"lat_min": 7.5, "lat_max": 21.5, "lon_min": 72.0, "lon_max": 77.5}
    elif region == "north_east_india":
        bounds = {"lat_min": 22.0, "lat_max": 29.5, "lon_min": 88.0, "lon_max": 97.5}
    elif region == "indo_gangetic_plain":
        bounds = {"lat_min": 23.0, "lat_max": 31.5, "lon_min": 74.0, "lon_max": 89.5}
    elif region == "central_india":
        bounds = {"lat_min": 17.0, "lat_max": 25.5, "lon_min": 74.0, "lon_max": 84.5}
    elif region in {"india", "full_india"}:
        bounds = {"lat_min": 6.0, "lat_max": 38.0, "lon_min": 66.0, "lon_max": 100.0}
    elif region == "custom":
        if None in (lat_min, lat_max, lon_min, lon_max):
            raise typer.BadParameter("For region=custom, provide --lat-min --lat-max --lon-min --lon-max")
        bounds = {
            "lat_min": float(lat_min),
            "lat_max": float(lat_max),
            "lon_min": float(lon_min),
            "lon_max": float(lon_max),
        }
    else:
        raise typer.BadParameter(
            "region must be one of: pilot, western_ghats, north_east_india, "
            "indo_gangetic_plain, central_india, full_india, india, custom"
        )

    if bounds["lat_min"] >= bounds["lat_max"] or bounds["lon_min"] >= bounds["lon_max"]:
        raise typer.BadParameter("Invalid bounds: min values must be less than max values")

    return bounds


@app.command("download")
def download(
    variable: str = typer.Option(..., "--variable", "-v",
        help="Variable to download: rainfall | tmax | tmin | lst | sst"),
    start_year: int = typer.Option(2020, "--start-year"),
    end_year: int = typer.Option(2024, "--end-year"),
    output_dir: Path = typer.Option(Path("./data/imd"), "--output-dir"),
):
    """Download and save raw climate data from IMD or MOSDAC."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if variable == "rainfall":
        from .downloader import IMDDownloader
        dl = IMDDownloader(output_dir=output_dir)
        typer.echo(f"Downloading IMD rainfall {start_year}-{end_year}...")
        ds = dl.download_rainfall(start_year, end_year)
        out_path = output_dir / f"rainfall_{start_year}-{end_year}.nc"
        ds.to_netcdf(out_path)
        typer.echo(f"Saved: {out_path}")
        typer.echo(f"Downloaded: {ds.dims}")

    elif variable in ("tmax", "tmin"):
        from .downloader import IMDDownloader
        dl = IMDDownloader(output_dir=output_dir)
        typer.echo(f"Downloading IMD {variable} {start_year}-{end_year}...")
        ds = dl.download_temperature(variable, start_year, end_year)
        out_path = output_dir / f"{variable}_{start_year}-{end_year}.nc"
        ds.to_netcdf(out_path)
        typer.echo(f"Saved: {out_path}")
        typer.echo(f"Downloaded: {ds.dims}")

    elif variable in ("lst", "sst"):
        from .downloader import MOSDACDownloader
        product = "3RIMG_L2B_LST" if variable == "lst" else "3RIMG_L2B_SST"
        dl = MOSDACDownloader(output_dir=output_dir)
        typer.echo(f"Downloading MOSDAC {product}...")
        ds = dl.download_product(product, f"{start_year}-01-01", f"{end_year}-12-31")
        out_path = output_dir / f"{variable}_{start_year}-{end_year}.nc"
        ds.to_netcdf(out_path)
        typer.echo(f"Saved: {out_path}")
        typer.echo(f"Downloaded: {ds.dims}")
    else:
        typer.echo(f"Unknown variable: {variable}", err=True)
        raise typer.Exit(1)


@app.command("preprocess")
def preprocess(
    data_dir: Path = typer.Option(Path("./data/imd"), "--data-dir"),
    output_dir: Path = typer.Option(Path("./data/processed"), "--output-dir"),
    start_year: int = typer.Option(2020),
    end_year: int = typer.Option(2024),
    region: str = typer.Option("pilot", help="Region preset: pilot | western_ghats | india | custom"),
    lat_min: float | None = typer.Option(None, help="Custom region latitude min"),
    lat_max: float | None = typer.Option(None, help="Custom region latitude max"),
    lon_min: float | None = typer.Option(None, help="Custom region longitude min"),
    lon_max: float | None = typer.Option(None, help="Custom region longitude max"),
    resolution: float = typer.Option(0.25, help="Target output grid resolution in degrees"),
    ncep_wind_dir: Path | None = typer.Option(
        None, "--ncep-wind-dir",
        help="Directory containing NCEP-NCAR uwnd/vwnd/shum.YYYY.nc files. "
             "When provided, u-wind, v-wind, and specific humidity at 850 hPa are merged "
             "into the normalized dataset as uwnd_850/vwnd_850/shum_850 node features.",
    ),
    era5_dir: Path | None = typer.Option(
        None, "--era5-dir",
        help="Directory containing Copernicus CDS era5_{uwnd,vwnd,shum}_{YYYY}_850hPa.nc "
             "files (produced by data/download_era5.py). When provided, u-wind, v-wind, "
             "and specific humidity at 850 hPa are merged as uwnd_850/vwnd_850/shum_850. "
             "Preferred over --ncep-wind-dir when both are given; NCEP only fills years/"
             "variables ERA5 does not supply.",
    ),
    chirps_dir: Path | None = typer.Option(
        None, "--chirps-dir",
        help="Directory containing CHIRPS subsetted files (chirps_YYYY_WG.nc) or global "
             "chirps-v2.0.YYYY.days_p25.nc files. CHIRPS is retained as an auxiliary predictor.",
    ),
    oisst_dir: Path | None = typer.Option(
        None, "--oisst-dir",
        help="Directory containing NOAA OISST v2.1 daily files "
             "(oisst-avhrr-v02r01.YYYYMMDD.nc). Fills the insat_sst feature slot as a "
             "DISCLOSED SUBSTITUTE for INSAT-3D SST — MOSDAC access was never approved. "
             "See DATA_ACQUISITION_TASKS.md section 2.",
    ),
    normalization_fit_start_year: int = typer.Option(
        2010, "--normalization-fit-start-year", help="First year used to fit normalization statistics"
    ),
    normalization_fit_end_year: int = typer.Option(
        2021, "--normalization-fit-end-year", help="Last training-only year used to fit normalization statistics"
    ),
):
    """Run full preprocessing pipeline: regrid, QC, normalize, encode."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import xarray as xr
    from .preprocessor import ClimatePreprocessor

    output_dir.mkdir(parents=True, exist_ok=True)
    bounds = _resolve_region_bounds(region, lat_min, lat_max, lon_min, lon_max)
    preprocessor = ClimatePreprocessor(region=bounds, resolution=resolution)

    typer.echo("Loading raw data...")
    rain = xr.open_dataset(data_dir / f"rainfall_{start_year}-{end_year}.nc")
    tmax = xr.open_dataset(data_dir / f"tmax_{start_year}-{end_year}.nc")
    tmin = xr.open_dataset(data_dir / f"tmin_{start_year}-{end_year}.nc")

    typer.echo("Preprocessing...")
    normalized, norm_params = preprocessor.preprocess_imd(
        rain, tmax, tmin,
        ncep_dir=str(ncep_wind_dir) if ncep_wind_dir else None,
        era5_dir=str(era5_dir) if era5_dir else None,
        chirps_dir=str(chirps_dir) if chirps_dir else None,
        oisst_dir=str(oisst_dir) if oisst_dir else None,
        start_year=start_year,
        end_year=end_year,
        normalization_fit_start_year=normalization_fit_start_year,
        normalization_fit_end_year=normalization_fit_end_year,
    )

    out_path = output_dir / f"normalized_{start_year}-{end_year}.nc"
    # zlib-compress: this file is the one that must be uploaded to Kaggle for
    # --all-windows training, and the upload has repeatedly failed on large
    # files. Measured on the real Western Ghats file: 207.0 MB -> 77.0 MB
    # (2.69x smaller) at complevel=4, costing 9s to write. Lossless.
    normalized.to_netcdf(
        out_path,
        encoding={v: {"zlib": True, "complevel": 4} for v in normalized.data_vars},
    )
    typer.echo(f"Saved to {out_path} ({out_path.stat().st_size / 1e6:.0f} MB, zlib complevel=4)")

    # Persist full normalization parameters for denormalized evaluation.
    norm_ds_vars = {}
    for var, stats in norm_params.items():
        norm_ds_vars[f"{var}_mean"] = (("lat", "lon"), stats["mean"].astype("float32"))
        norm_ds_vars[f"{var}_std"] = (("lat", "lon"), stats["std"].astype("float32"))
    norm_ds = xr.Dataset(norm_ds_vars, coords={"lat": normalized.lat.values, "lon": normalized.lon.values})
    norm_path = output_dir / f"norm_params_{start_year}-{end_year}.nc"
    norm_ds.to_netcdf(norm_path)
    typer.echo(f"Saved normalization parameters: {norm_path}")

    # Reproducible preprocessing provenance log (Requirement 13.2)
    # Keep arrays out of the JSON artifact to avoid huge files.
    norm_summary = {
        k: {
            "mean_shape": list(v["mean"].shape),
            "std_shape": list(v["std"].shape),
        }
        for k, v in norm_params.items()
    }
    region_label = "custom" if region == "custom" else region
    pipeline_log = {
        "pipeline": "preprocess_imd",
        "input": {
            "data_dir": str(data_dir),
            "start_year": start_year,
            "end_year": end_year,
            "region": region_label,
        },
        "steps": [
            "regrid_to_target",
            "quality_control",
            "normalize",
            "encode_cyclical_time",
            *([] if era5_dir is None else ["merge_era5_850hpa"]),
            *([] if ncep_wind_dir is None else ["merge_ncep_wind_850hpa"]),
        ],
        "config": {
            "region_bounds": {
                "lat_min": preprocessor.lat_min,
                "lat_max": preprocessor.lat_max,
                "lon_min": preprocessor.lon_min,
                "lon_max": preprocessor.lon_max,
            },
            "resolution": preprocessor.resolution,
            "normalization_fit_period": [
                normalization_fit_start_year,
                normalization_fit_end_year,
            ],
            "normalization_policy": "training_period_only",
            "climatology_period": list(preprocessor.CLIMATOLOGY_PERIOD),
        },
        "outputs": {
            "normalized_dataset": str(out_path),
            "normalization_parameters": str(norm_path),
            "norm_params": norm_summary,
        },
    }
    log_path = output_dir / f"pipeline_log_{start_year}-{end_year}.json"
    log_path.write_text(json.dumps(pipeline_log, indent=2), encoding="utf-8")
    typer.echo(f"Saved pipeline log: {log_path}")


@app.command("build-static-rasters")
def build_static_rasters_command(
    reference_file: Path = typer.Option(..., "--reference-file", exists=True),
    dem_dir: Path = typer.Option(Path("./data/copernicus_dem_90m"), "--dem-dir", exists=True),
    worldcover_dir: Path = typer.Option(Path("./data/esa_worldcover_2021"), "--worldcover-dir", exists=True),
    output_dir: Path = typer.Option(Path("./data/static"), "--output-dir"),
):
    """Warp real Copernicus DEM and ESA WorldCover directly onto a climate grid."""
    from .static_rasters import build_static_rasters

    manifest = build_static_rasters(reference_file, dem_dir, worldcover_dir, output_dir)
    typer.echo(
        f"Saved real static rasters to {output_dir} "
        f"({manifest['coverage']['land_cells']} land cells, "
        f"{manifest['coverage']['land_dem_coverage_fraction']:.1%} land DEM coverage)"
    )


@app.command("build-sequences")
def build_sequences(
    normalized_file: Path = typer.Option(..., "--normalized-file", exists=True),
    output_dir: Path = typer.Option(Path("./data/processed"), "--output-dir"),
    input_window: int = typer.Option(30, help="Historical lookback window"),
    target_window: int = typer.Option(7, help="Forecast horizon"),
    train_start_year: int = typer.Option(2010),
    train_end_year: int = typer.Option(2021),
    val_start_year: int = typer.Option(2022),
    val_end_year: int = typer.Option(2022),
    test_start_year: int = typer.Option(2023),
    test_end_year: int = typer.Option(2025),
    max_train: int = typer.Option(512, help="Cap train sequences; <=0 keeps all"),
    max_val: int = typer.Option(128, help="Cap validation sequences; <=0 keeps all"),
    max_test: int = typer.Option(128, help="Cap held-out test sequences; <=0 keeps all"),
    stride: int = typer.Option(3, help="Sampling stride for sequence starts"),
    fillna_value: float | None = typer.Option(0.0, help="Fill remaining NaNs after availability fields are retained"),
    elevation_file: Path | None = typer.Option(None, "--elevation-file", help="Real grid-aligned DEM NetCDF"),
    lsm_file: Path | None = typer.Option(None, "--lsm-file", help="Real grid-aligned land/sea-mask NetCDF"),
    require_real_static: bool = typer.Option(
        False, "--require-real-static/--allow-synthetic-static",
        help="Reject sequence generation unless both real static files are supplied",
    ),
    include_missingness_indicators: bool = typer.Option(
        False, "--include-missingness-indicators/--legacy-features",
        help="Append six optional-source missingness channels",
    ),
    region: str = typer.Option("auto", help="Region label recorded in the manifest"),
):
    """Build leakage-safe calendar train/validation/test sequence tensors."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import numpy as np
    import pandas as pd
    import xarray as xr
    from .graph_builder import ClimateGraphBuilder

    split_ranges = {
        "train": (train_start_year, train_end_year),
        "validation": (val_start_year, val_end_year),
        "test": (test_start_year, test_end_year),
    }
    ordered = [train_start_year, train_end_year, val_start_year, val_end_year, test_start_year, test_end_year]
    if ordered != sorted(ordered) or train_end_year >= val_start_year or val_end_year >= test_start_year:
        raise typer.BadParameter("Calendar splits must be ordered, disjoint, and non-overlapping")
    if require_real_static and (elevation_file is None or lsm_file is None):
        raise typer.BadParameter("--require-real-static needs --elevation-file and --lsm-file")

    output_dir.mkdir(parents=True, exist_ok=True)
    typer.echo(f"Loading normalized dataset: {normalized_file}")
    ds = xr.open_dataset(normalized_file)
    if fillna_value is not None:
        # Availability variables were captured before this fill, so no provenance is lost.
        ds = ds.fillna(fillna_value)

    builder = ClimateGraphBuilder.from_dataset(
        ds,
        elevation_path=elevation_file,
        land_sea_mask_path=lsm_file,
        include_missingness_indicators=include_missingness_indicators,
    )
    ntime = int(ds.sizes["time"])
    total_len = input_window + target_window
    possible = max(0, ntime - total_len + 1)
    if possible == 0:
        raise typer.BadParameter("Dataset too short for requested windows")

    times = pd.DatetimeIndex(ds.time.values)
    starts_by_split: dict[str, list[int]] = {name: [] for name in split_ranges}
    for start in range(0, possible, max(1, stride)):
        target_dates = times[start + input_window:start + total_len]
        for name, (year_start, year_end) in split_ranges.items():
            if target_dates[0].year >= year_start and target_dates[-1].year <= year_end:
                starts_by_split[name].append(start)
                break

    def _even_cap(values: list[int], cap: int) -> list[int]:
        if cap <= 0 or len(values) <= cap:
            return values
        indices = np.linspace(0, len(values) - 1, cap, dtype=int)
        return [values[int(i)] for i in indices]

    starts_by_split["train"] = _even_cap(starts_by_split["train"], max_train)
    starts_by_split["validation"] = _even_cap(starts_by_split["validation"], max_val)
    starts_by_split["test"] = _even_cap(starts_by_split["test"], max_test)
    if any(not starts for starts in starts_by_split.values()):
        empty = [name for name, starts in starts_by_split.items() if not starts]
        raise typer.BadParameter(f"No sequence windows assigned to split(s): {', '.join(empty)}")

    def _make_pairs(start_indices: list[int]) -> list[tuple]:
        pairs = []
        for s in start_indices:
            input_graph = builder.build_sequence_graph(ds, s, input_window)
            target_frames = []
            for t in range(s + input_window, s + total_len):
                target_frames.append(builder.build_graph(ds, time_idx=t).x[:, :3])
            pairs.append((input_graph, torch.stack(target_frames, dim=0)))
        return pairs

    typer.echo(
        "Building calendar splits: "
        + ", ".join(f"{name}={len(starts)}" for name, starts in starts_by_split.items())
    )
    sequences = {name: _make_pairs(starts) for name, starts in starts_by_split.items()}
    paths = {
        "train": output_dir / "train_sequences.pt",
        "validation": output_dir / "val_sequences.pt",
        "test": output_dir / "test_sequences.pt",
    }
    for name, path in paths.items():
        temporary = path.with_suffix(path.suffix + ".tmp")
        torch.save(sequences[name], temporary)
        temporary.replace(path)

    if region == "auto":
        region = output_dir.name.removeprefix("processed_").removesuffix("_final")
    manifest = {
        "schema_version": "vayu.sequence-manifest/v2",
        "region": region,
        "normalized_file": str(normalized_file),
        "time_steps": ntime,
        "grid": {"lat": int(ds.sizes["lat"]), "lon": int(ds.sizes["lon"]), "nodes": builder.num_nodes},
        "input_window": input_window,
        "target_window": target_window,
        "stride": stride,
        "fillna_value": fillna_value,
        "feature_count": len(builder.feature_names),
        "feature_names": builder.feature_names,
        "missingness_indicators": include_missingness_indicators,
        "static_inputs": {
            "elevation": str(elevation_file.resolve()) if elevation_file else None,
            "land_sea_mask": str(lsm_file.resolve()) if lsm_file else None,
            "real_static_required": require_real_static,
        },
        "splits": {
            name: {
                "start_year": split_ranges[name][0],
                "end_year": split_ranges[name][1],
                "saved_sequences": len(sequences[name]),
                "first_target_date": str(times[starts[0] + input_window].date()),
                "last_target_date": str(times[starts[-1] + total_len - 1].date()),
                "path": str(paths[name]),
            }
            for name, starts in starts_by_split.items()
        },
        "saved_train_sequences": len(sequences["train"]),
        "saved_val_sequences": len(sequences["validation"]),
        "saved_test_sequences": len(sequences["test"]),
    }
    manifest_path = output_dir / "sequence_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    for path in [*paths.values(), manifest_path]:
        typer.echo(f"Saved: {path}")


@app.command("package-dataset")
def package_dataset(
    raw_dir: Path = typer.Option(Path("./data/imd"), "--raw-dir"),
    processed_dir: Path = typer.Option(Path("./data/processed"), "--processed-dir"),
    output_dir: Path = typer.Option(Path("./data/kaggle_bundle"), "--output-dir"),
):
    """Bundle raw, processed, sequence, and metadata artifacts for Kaggle upload."""
    output_dir.mkdir(parents=True, exist_ok=True)

    copied: list[str] = []
    missing: list[str] = []
    optional_present: list[str] = []
    optional_missing: list[str] = []

    def _copy_if_exists(src: Path, dst_name: str | None = None):
        target = output_dir / (dst_name or src.name)
        if src.exists():
            shutil.copy2(src, target)
            copied.append(str(target))
        else:
            missing.append(str(src))

    # Raw merged NetCDFs.
    for f in ["rainfall_2010-2025.nc", "tmax_2010-2025.nc", "tmin_2010-2025.nc"]:
        _copy_if_exists(raw_dir / f)

    # Processed outputs.
    for pattern in [
        "normalized_*.nc", "norm_params_*.nc", "pipeline_log_*.json",
        "sequence_manifest.json", "static_raster_manifest.json",
    ]:
        matches = list(processed_dir.glob(pattern))
        if not matches:
            missing.append(str(processed_dir / pattern))
            continue
        for m in matches:
            _copy_if_exists(m)

    for f in ["train_sequences.pt", "val_sequences.pt", "test_sequences.pt", "elevation.nc", "lsm.nc"]:
        _copy_if_exists(processed_dir / f)

    # Optional future sources.
    for optional in ["lst_2010-2025.nc", "sst_2010-2025.nc", "wind_2010-2025.nc", "humidity_2010-2025.nc", "pressure_2010-2025.nc"]:
        path = raw_dir / optional
        if path.exists():
            _copy_if_exists(path)
            optional_present.append(str(path))
        else:
            optional_missing.append(str(path))

    manifest = {
        "bundle_created_from": {
            "raw_dir": str(raw_dir),
            "processed_dir": str(processed_dir),
        },
        "copied_files": copied,
        "missing_expected_files": missing,
        "optional_sources_present": optional_present,
        "optional_sources_missing": optional_missing,
    }
    manifest_path = output_dir / "bundle_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    typer.echo(f"Saved bundle manifest: {manifest_path}")
    typer.echo(f"Copied files: {len(copied)}")


def ingest():
    """Entry point for pyproject.toml script."""
    app()


if __name__ == "__main__":
    app()

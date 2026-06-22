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
        # Extended Western Ghats + west-coast influence band.
        bounds = {"lat_min": 7.5, "lat_max": 21.5, "lon_min": 72.0, "lon_max": 77.5}
    elif region == "india":
        bounds = {"lat_min": 6.0, "lat_max": 38.0, "lon_min": 68.0, "lon_max": 98.0}
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
        raise typer.BadParameter("region must be one of: pilot, western_ghats, india, custom")

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
        start_year=start_year,
        end_year=end_year,
    )

    out_path = output_dir / f"normalized_{start_year}-{end_year}.nc"
    normalized.to_netcdf(out_path)
    typer.echo(f"Saved to {out_path}")

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


@app.command("build-sequences")
def build_sequences(
    normalized_file: Path = typer.Option(..., "--normalized-file", exists=True),
    output_dir: Path = typer.Option(Path("./data/processed"), "--output-dir"),
    input_window: int = typer.Option(30, help="Historical lookback window"),
    target_window: int = typer.Option(7, help="Forecast horizon"),
    train_ratio: float = typer.Option(0.85, help="Train split ratio"),
    max_train: int = typer.Option(512, help="Cap train sequence count for memory control"),
    max_val: int = typer.Option(128, help="Cap val sequence count for memory control"),
    stride: int = typer.Option(3, help="Sampling stride for sequence starts"),
    fillna_value: float | None = typer.Option(0.0, help="Fill NaNs before sequence creation; set to none to disable"),
    elevation_file: Path | None = typer.Option(None, "--elevation-file",
        help="Path to 0.25\u00b0 DEM NetCDF (var=\"elevation\"). If omitted, synthetic ridge is used."),
    lsm_file: Path | None = typer.Option(None, "--lsm-file",
        help="Path to 0.25\u00b0 land-sea mask NetCDF (var=\"lsm\"). If omitted, geometric mask is used."),
):
    """Build train/val sequence tensors from a normalized dataset."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import xarray as xr
    from .graph_builder import ClimateGraphBuilder

    output_dir.mkdir(parents=True, exist_ok=True)
    typer.echo(f"Loading normalized dataset: {normalized_file}")
    ds = xr.open_dataset(normalized_file)
    if fillna_value is not None:
        ds = ds.fillna(fillna_value)

    builder = ClimateGraphBuilder.from_dataset(
        ds,
        elevation_path=elevation_file,
        land_sea_mask_path=lsm_file,
    )
    ntime = int(ds.sizes["time"])
    total_len = input_window + target_window
    possible = max(0, ntime - total_len + 1)
    if possible == 0:
        raise typer.BadParameter("Dataset too short for requested windows")

    starts = list(range(0, possible, max(1, stride)))
    split_idx = int(len(starts) * train_ratio)
    train_starts = starts[:split_idx]
    val_starts = starts[split_idx:]

    if max_train > 0:
        train_starts = train_starts[:max_train]
    if max_val > 0:
        val_starts = val_starts[:max_val]

    def _make_pairs(start_indices: list[int]) -> list[tuple]:
        pairs = []
        for s in start_indices:
            input_graph = builder.build_sequence_graph(ds, s, input_window)
            target_frames = []
            for t in range(s + input_window, s + total_len):
                g = builder.build_graph(ds, time_idx=t)
                target_frames.append(g.x[:, :3])
            target_tensor = torch.stack(target_frames, dim=0)
            pairs.append((input_graph, target_tensor))
        return pairs

    typer.echo(f"Building {len(train_starts)} train and {len(val_starts)} val sequences...")
    train_sequences = _make_pairs(train_starts)
    val_sequences = _make_pairs(val_starts)

    train_path = output_dir / "train_sequences.pt"
    val_path = output_dir / "val_sequences.pt"
    torch.save(train_sequences, train_path)
    torch.save(val_sequences, val_path)

    manifest = {
        "normalized_file": str(normalized_file),
        "time_steps": ntime,
        "grid": {"lat": int(ds.sizes["lat"]), "lon": int(ds.sizes["lon"]), "nodes": builder.num_nodes},
        "input_window": input_window,
        "target_window": target_window,
        "stride": stride,
        "fillna_value": fillna_value,
        "total_possible_sequences": possible,
        "saved_train_sequences": len(train_sequences),
        "saved_val_sequences": len(val_sequences),
        "train_path": str(train_path),
        "val_path": str(val_path),
    }
    manifest_path = output_dir / "sequence_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    typer.echo(f"Saved: {train_path}")
    typer.echo(f"Saved: {val_path}")
    typer.echo(f"Saved: {manifest_path}")


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
    for pattern in ["normalized_*.nc", "pipeline_log_*.json", "sequence_manifest.json"]:
        matches = list(processed_dir.glob(pattern))
        if not matches:
            missing.append(str(processed_dir / pattern))
            continue
        for m in matches:
            _copy_if_exists(m)

    for f in ["train_sequences.pt", "val_sequences.pt"]:
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

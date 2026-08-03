"""Preprocess raw GPM IMERG rainfall files into per-region daily NetCDF subsets.

Why this script exists
-----------------------
GPM IMERG (https://gpm.nasa.gov/data/imerg) is downloaded as one giant global
archive (~150+ GB for a multi-year daily record at 0.1 deg). VAYU does not need
the whole globe, and does not need it as one archive — it needs four small,
region-clipped, daily-aggregated NetCDF files that match the exact bounding
boxes already used everywhere else in this repo (see ai_engine/regions.py).

This script:
  1. Reads every raw IMERG file in an input directory (NetCDF4/HDF5 daily
     "Final Run" files — filenames like
     `3B-DAY.MS.MRG.3IMERG.20230615-S000000-E235959.V07B.nc4`).
  2. Auto-detects the rainfall variable name (IMERG products differ slightly
     between versions: `precipitationCal`, `precipitation`, `precip`).
  3. Fixes IMERG's non-standard (time, lon, lat) axis order to the standard
     (time, lat, lon) used by every other dataset in this repo.
  4. Clips to each of the 4 model regions + the full-India overview box,
     using the *exact same numbers* as `ai_engine/regions.py::REGION_BOUNDS`
     so there is no risk of a silently different bounding box downstream.
  5. Writes one combined NetCDF per region: `rainfall(time, lat, lon)` in
     mm/day, plus a small JSON sidecar recording date range, cell count,
     source file count, and the exact bounds used (a lightweight provenance
     record — not the full manifest system in ai_engine/data_manifests.py,
     since this is a validation-only dataset, not a training input).

Usage
-----
    pip install xarray netCDF4 h5netcdf numpy

    python preprocess_gpm_imerg.py \
        --input-dir  "D:/gpm_imerg_raw" \
        --output-dir "./data/gpm_imerg_processed"

Each run is safe to re-run: it skips a region's output NetCDF if it already
exists (delete the specific file if you need to regenerate it after adding
more raw input files).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

# ── Region bounds — copied verbatim from ai_engine/regions.py so this script
# never drifts from the model's source of truth. If regions.py changes, update
# this dict to match (a comment there points back here). ──────────────────────
REGION_BOUNDS: dict[str, dict[str, float]] = {
    "pilot": {"lat_min": 8.0, "lat_max": 20.0, "lon_min": 72.0, "lon_max": 78.0},
    "western_ghats": {"lat_min": 7.5, "lat_max": 21.5, "lon_min": 72.0, "lon_max": 77.5},
    "north_east_india": {"lat_min": 22.0, "lat_max": 29.5, "lon_min": 88.0, "lon_max": 97.5},
    "indo_gangetic_plain": {"lat_min": 23.0, "lat_max": 31.5, "lon_min": 74.0, "lon_max": 89.5},
    "central_india": {"lat_min": 17.0, "lat_max": 25.5, "lon_min": 74.0, "lon_max": 84.5},
}
# The "All India" overview box used by the frontend globe (not a model
# coverage claim — see frontend/src/test/fixtures/regionBoundsReview.ts).
FULL_INDIA_BOUNDS = {"lat_min": 6.0, "lat_max": 38.0, "lon_min": 66.0, "lon_max": 100.0}

# Candidate variable names across IMERG product versions/short names.
RAINFALL_VARIABLE_CANDIDATES = ("precipitationCal", "precipitation", "precip", "precipitationUncal")


def _find_rainfall_variable(dataset: Any) -> str:
    for name in RAINFALL_VARIABLE_CANDIDATES:
        if name in dataset.data_vars:
            return name
    raise ValueError(
        f"No known rainfall variable found. Data variables present: {list(dataset.data_vars)}. "
        f"Add the correct name to RAINFALL_VARIABLE_CANDIDATES in this script and re-run."
    )


def _standardize_axes(dataset: Any, variable: str) -> Any:
    """Return the dataset with dims renamed to (time, lat, lon), transposed if needed."""
    rename_map = {}
    for candidate, canonical in (("lat", "lat"), ("latitude", "lat"), ("lon", "lon"), ("longitude", "lon")):
        if candidate in dataset.coords and canonical not in rename_map.values():
            rename_map[candidate] = canonical
    dataset = dataset.rename(rename_map)

    dims = dataset[variable].dims
    if "time" in dims and "lat" in dims and "lon" in dims:
        dataset[variable] = dataset[variable].transpose("time", "lat", "lon")
    elif "lat" in dims and "lon" in dims and "time" not in dims:
        # Single-day file with no time dimension — add one from the filename
        # date (handled by caller before this function runs).
        pass
    return dataset


def _clip_to_bounds(dataset: Any, bounds: dict[str, float]) -> Any:
    lat = dataset["lat"]
    lat_slice = slice(bounds["lat_min"], bounds["lat_max"]) if float(lat[0]) < float(lat[-1]) else slice(bounds["lat_max"], bounds["lat_min"])
    return dataset.sel(lat=lat_slice, lon=slice(bounds["lon_min"], bounds["lon_max"]))


def _date_from_filename(path: Path) -> np.datetime64 | None:
    """Extract YYYYMMDD from a standard IMERG daily filename."""
    import re

    match = re.search(r"(\d{8})", path.stem)
    if not match:
        return None
    return np.datetime64(datetime.strptime(match.group(1), "%Y%m%d").date())


def load_and_clip_all(input_dir: Path) -> dict[str, list[Any]]:
    """Open every raw IMERG file once and return per-region clipped daily slices.

    Opening + clipping is done once per file (not once per file per region) so
    a 158 GB archive is only read from disk a single time.
    """
    import xarray as xr

    raw_files = sorted(
        p for p in input_dir.rglob("*")
        if p.suffix.lower() in {".nc4", ".nc", ".hdf5", ".h5"}
    )
    if not raw_files:
        raise FileNotFoundError(
            f"No .nc4/.nc/.hdf5/.h5 files found under {input_dir}. "
            f"Point --input-dir at the folder containing the raw downloaded IMERG files."
        )

    per_region_slices: dict[str, list[Any]] = {name: [] for name in {**REGION_BOUNDS, "full_india": FULL_INDIA_BOUNDS}}
    all_bounds = {**REGION_BOUNDS, "full_india": FULL_INDIA_BOUNDS}

    print(f"Found {len(raw_files)} raw IMERG file(s) under {input_dir}")
    for index, path in enumerate(raw_files, start=1):
        try:
            with xr.open_dataset(path, engine="netcdf4") as ds:
                variable = _find_rainfall_variable(ds)
                ds = _standardize_axes(ds, variable)
                if "time" not in ds[variable].dims:
                    file_date = _date_from_filename(path)
                    if file_date is None:
                        print(f"  SKIP {path.name}: no time dimension and no parseable date in filename")
                        continue
                    ds = ds.expand_dims(time=[file_date])
                for region, bounds in all_bounds.items():
                    clipped = _clip_to_bounds(ds, bounds)[[variable]]
                    if clipped[variable].size == 0:
                        continue
                    per_region_slices[region].append(clipped.rename({variable: "rainfall"}).load())
        except Exception as exc:  # noqa: BLE001 - report and continue; one bad file shouldn't abort the run
            print(f"  ERROR reading {path.name}: {exc}")
            continue
        if index % 200 == 0:
            print(f"  processed {index}/{len(raw_files)} files…")

    return per_region_slices


def write_region_outputs(per_region_slices: dict[str, list[Any]], output_dir: Path, source_dir: Path) -> None:
    import xarray as xr

    output_dir.mkdir(parents=True, exist_ok=True)
    all_bounds = {**REGION_BOUNDS, "full_india": FULL_INDIA_BOUNDS}

    for region, slices in per_region_slices.items():
        out_path = output_dir / f"gpm_imerg_{region}_daily.nc"
        sidecar_path = output_dir / f"gpm_imerg_{region}_daily.json"
        if out_path.exists():
            print(f"SKIP {region}: {out_path} already exists (delete it to regenerate)")
            continue
        if not slices:
            print(f"SKIP {region}: no data intersected this region's bounds in the input files")
            continue

        combined = xr.concat(slices, dim="time").sortby("time")
        # Deduplicate any overlapping dates from files that cover the same day
        combined = combined.drop_duplicates(dim="time", keep="first")
        combined["rainfall"].attrs["units"] = "mm/day"
        combined["rainfall"].attrs["long_name"] = "GPM IMERG Final Run daily precipitation"
        combined.to_netcdf(out_path)

        bounds = all_bounds[region]
        sidecar = {
            "region": region,
            "bounds": bounds,
            "variable": "rainfall",
            "units": "mm/day",
            "time_range": {
                "start": str(combined.time.values.min())[:10],
                "end": str(combined.time.values.max())[:10],
            },
            "day_count": int(combined.dims.get("time", 0)),
            "grid_shape": {"lat": int(combined.dims.get("lat", 0)), "lon": int(combined.dims.get("lon", 0))},
            "source": {
                "provider": "NASA GPM (Global Precipitation Measurement)",
                "product": "IMERG Final Run Daily",
                "source_url": "https://gpm.nasa.gov/data/imerg",
                "input_directory": str(source_dir),
                "note": "Validation-only third-party rainfall estimate; not one of the model's 17 declared training features.",
            },
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        sidecar_path.write_text(json.dumps(sidecar, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"WROTE {region}: {out_path.name} "
              f"({sidecar['day_count']} days, {sidecar['grid_shape']['lat']}x{sidecar['grid_shape']['lon']} cells)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", required=True, type=Path, help="Folder containing raw downloaded IMERG files")
    parser.add_argument("--output-dir", required=True, type=Path, help="Folder to write per-region processed NetCDF files")
    args = parser.parse_args()

    if not args.input_dir.is_dir():
        print(f"ERROR: --input-dir does not exist or is not a directory: {args.input_dir}", file=sys.stderr)
        return 1

    per_region_slices = load_and_clip_all(args.input_dir)
    write_region_outputs(per_region_slices, args.output_dir, args.input_dir)
    print("\nDone. Upload the contents of --output-dir as a new Kaggle dataset "
          "(one dataset, all 5 region files + their .json sidecars together).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

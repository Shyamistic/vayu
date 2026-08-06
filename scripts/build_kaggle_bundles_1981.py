"""Package the 1981-2025 preprocessed datasets into per-region Kaggle bundles.

Each bundle contains everything the --all-windows training path needs:
    normalized_1981-2025.nc, norm_params_1981-2025.nc, pipeline_log_1981-2025.json,
    elevation.nc, lsm.nc, static_raster_manifest.json (if present)

No *_sequences.pt files are included -- windows are sliced lazily from
normalized_*.nc (see ai_engine/windowed_dataset.py), which is how every
notebook in this project has trained since the v3 rain fixes. Bundling capped
.pt files would only bloat the upload for no benefit.

Usage:
    python scripts/build_kaggle_bundles_1981.py
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

YEAR_RANGE = "1981-2025"

PROCESSED_ROOT = Path("D:/vayu_data")
STATIC_ROOT = Path("D:/")
OUT_ROOT = Path("D:/vayu_data/kaggle_bundles_1981")

#: region -> (processed subdirectory, static subdirectory).
#:
#: full_india does NOT follow the `processed_<region>_1981` / `static_<region>`
#: convention: it is a 0.5 deg product (full India at 0.25 deg is 17,673 nodes ->
#: ~19.8 GB dense, over this machine's RAM and a Kaggle session), built on
#: area-averaged IMD cell centres 6.625/7.125/... rather than the 0.25 deg
#: 6.5/6.75/... ones. Its static rasters must be regenerated on that grid: the
#: 0.25 deg lat coordinates share NOT ONE value with the 0.5 deg ones, so reusing
#: static_full_india would inner-join to an empty grid rather than error.
REGION_DIRS: dict[str, tuple[str, str]] = {
    "western_ghats": ("processed_western_ghats_1981", "static_western_ghats"),
    "north_east_india": ("processed_north_east_india_1981", "static_north_east_india"),
    "indo_gangetic_plain": ("processed_indo_gangetic_plain_1981", "static_indo_gangetic_plain"),
    "central_india": ("processed_central_india_1981", "static_central_india"),
    "full_india": ("processed_full_india_05", "static_full_india_05"),
}

REGIONS = list(REGION_DIRS)


def check_static_grid(normalized: Path, bundle_dir: Path) -> list[str]:
    """Verify elevation.nc / lsm.nc sit on exactly the normalized file's grid.

    The static rasters are warped onto whatever grid the `--reference-file` had at
    build time, and nothing downstream re-checks it. A stale pair is not a loud
    failure: the trainer merges on coordinates, so a shifted grid inner-joins to
    a smaller (or empty) node set instead of raising. full_india hit exactly this
    — static_full_india is 0.25 deg on 6.5/6.75/7.0..., the 0.5 deg bundle is on
    6.625/7.125/..., and the two share no latitude value at all.
    """
    problems: list[str] = []
    if not normalized.exists():
        return [f"{normalized.name} missing, cannot verify static grid"]

    import numpy as np
    import xarray as xr

    with xr.open_dataset(normalized) as ref:
        ref_lat = np.asarray(ref["lat"].values, dtype=float)
        ref_lon = np.asarray(ref["lon"].values, dtype=float)

    for name in ("elevation.nc", "lsm.nc"):
        path = bundle_dir / name
        if not path.exists():
            continue
        with xr.open_dataset(path) as ds:
            lat = np.asarray(ds["lat"].values, dtype=float)
            lon = np.asarray(ds["lon"].values, dtype=float)
        if lat.shape != ref_lat.shape or lon.shape != ref_lon.shape:
            problems.append(
                f"{name} grid {lat.size}x{lon.size} != normalized "
                f"{ref_lat.size}x{ref_lon.size} — rebuild with "
                f"`build-static-rasters --reference-file {normalized.name}`"
            )
        elif not (np.allclose(lat, ref_lat, atol=1e-6)
                  and np.allclose(lon, ref_lon, atol=1e-6)):
            problems.append(
                f"{name} has the right shape but shifted coordinates "
                f"(lat starts {lat[0]:.4f} vs {ref_lat[0]:.4f}) — rebuild it"
            )
    return problems


def build_bundle(region: str) -> dict:
    proc_name, static_name = REGION_DIRS[region]
    proc_dir = PROCESSED_ROOT / proc_name
    static_dir = STATIC_ROOT / static_name
    out_dir = OUT_ROOT / f"kaggle_bundle_{region}_1981"
    out_dir.mkdir(parents=True, exist_ok=True)

    copied, missing = [], []

    def _copy(src: Path):
        if src.exists():
            shutil.copy2(src, out_dir / src.name)
            copied.append(src.name)
        else:
            missing.append(str(src))

    for name in (
        f"normalized_{YEAR_RANGE}.nc",
        f"norm_params_{YEAR_RANGE}.nc",
        f"pipeline_log_{YEAR_RANGE}.json",
    ):
        _copy(proc_dir / name)

    for name in ("elevation.nc", "lsm.nc", "static_raster_manifest.json"):
        _copy(static_dir / name)

    grid_problems = check_static_grid(proc_dir / f"normalized_{YEAR_RANGE}.nc", out_dir)

    total_mb = sum((out_dir / n).stat().st_size for n in copied) / 1e6
    return {
        "region": region,
        "out_dir": str(out_dir),
        "copied": copied,
        "missing": missing,
        "grid_problems": grid_problems,
        "total_mb": round(total_mb, 1),
    }


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("regions", nargs="*", default=REGIONS,
                    help=f"defaults to all: {' '.join(REGIONS)}")
    args = ap.parse_args()

    for region in args.regions:
        if region not in REGION_DIRS:
            print(f"unknown region: {region} (known: {', '.join(REGIONS)})")
            return 1

    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    failed = False
    for region in args.regions:
        result = build_bundle(region)
        print(f"\n{region}: {result['out_dir']}")
        print(f"  copied ({len(result['copied'])}): {result['copied']}")
        if result["missing"]:
            failed = True
            print(f"  MISSING: {result['missing']}")
        for problem in result["grid_problems"]:
            failed = True
            print(f"  GRID MISMATCH: {problem}")
        print(f"  total size: {result['total_mb']} MB")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

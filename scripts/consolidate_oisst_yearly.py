"""Consolidate daily OISST files into one NetCDF per year.

Why: preprocess_imd()._load_oisst_sst() opens every file in --oisst-dir
individually. For the India-subsetted daily archive (16,193 files,
1981-09-01..2025-12-31) that means 16,193 separate xr.open_dataset() calls
before a single xr.concat -- and with no dask installed, xarray builds the
whole concatenation eagerly in memory. Measured: preprocessing Western Ghats
stalled on this step for 12+ minutes with CPU pegged and RAM climbing before
being killed; every other auxiliary source in this pipeline (CHIRPS, NCEP,
IMD) is one file per YEAR, so the OISST loader is the outlier both in file
count and in being the only one without a one-time consolidation step.

This is a one-time cost: consolidating 45 years takes low-single-digit minutes
(measured below), and every future preprocess run across all 4 regions then
reuses the same 45 yearly files instead of re-paying the 16,193-file cost
every single time.

Only the 'sst' variable is kept (drops anom/err/ice, which
preprocessor._load_oisst_sst never reads), which also shrinks the on-disk
footprint.

Usage:
    python scripts/consolidate_oisst_yearly.py --in D:/vayu_data/oisst_sst_india --out D:/vayu_data/oisst_sst_yearly
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import netCDF4
import numpy as np
import xarray as xr


def consolidate_year(year: int, src_dir: Path, out_dir: Path) -> tuple[bool, int]:
    """Merge one year of daily OISST files using raw netCDF4, not xarray.

    Measured: xr.open_dataset() on these files costs ~650ms/file steady-state
    (plus a ~5s one-time warm-up) versus ~20ms/file for netCDF4.Dataset() doing
    the equivalent open + read. That is a ~30x difference that turns a 45-year
    consolidation from roughly 3 hours into a couple of minutes. The per-file
    xarray overhead appears to be inherent to this environment/file
    combination (isolated: it persists after the first call, is only
    partially reduced by decode_cf=False, and h5netcdf is not installed to
    compare) rather than something a read option fixes cheaply -- so this
    step is written to avoid xarray entirely rather than try to tune it.
    """
    out_path = out_dir / f"oisst-avhrr-v02r01.{year}_india.nc"
    if out_path.exists() and out_path.stat().st_size > 1024:
        return True, 0

    files = sorted(src_dir.glob(f"oisst-avhrr-v02r01.{year}*_india.nc"))
    if not files:
        return False, 0

    times, sst_frames, lat = [], [], None
    lon = None
    fill = None
    for f in files:
        ds = netCDF4.Dataset(f)
        try:
            if "sst" not in ds.variables:
                continue
            var = ds.variables["sst"]
            if fill is None:
                fill = getattr(var, "_FillValue", None)
                lat = ds.variables["lat"][:].astype("float32")
                lon = ds.variables["lon"][:].astype("float32")
            raw = var[:]  # applies scale_factor/add_offset automatically
            arr = np.asarray(raw, dtype="float32")
            # netCDF4 returns a masked array when _FillValue is set; convert
            # masked entries to NaN so downstream regridding sees gaps, not 0.
            if np.ma.isMaskedArray(raw):
                arr = np.ma.filled(raw.astype("float32"), np.nan)
            # Collapse (time=1, zlev=1, lat, lon) -> (lat, lon)
            arr = arr.reshape(arr.shape[-2], arr.shape[-1])
            t_raw = ds.variables["time"][:]
            t_units = ds.variables["time"].units
            times.append(netCDF4.num2date(
                t_raw[0], t_units, only_use_cftime_datetimes=False))
            sst_frames.append(arr)
        finally:
            ds.close()

    if not sst_frames:
        return False, 0

    order = np.argsort(times)
    times_sorted = [times[i] for i in order]
    stack = np.stack([sst_frames[i] for i in order], axis=0)

    merged = xr.Dataset(
        {"sst": (("time", "lat", "lon"), stack.astype("float32"))},
        coords={
            "time": [np.datetime64(t) for t in times_sorted],
            "lat": lat,
            "lon": lon,
        },
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".nc.tmp")
    merged.to_netcdf(tmp, encoding={"sst": {"zlib": True, "complevel": 4}})
    tmp.replace(out_path)
    return True, len(files)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_dir", type=Path,
                     default=Path("D:/vayu_data/oisst_sst_india"))
    ap.add_argument("--out", dest="out_dir", type=Path,
                     default=Path("D:/vayu_data/oisst_sst_yearly"))
    ap.add_argument("--start", type=int, default=1981)
    ap.add_argument("--end", type=int, default=2025)
    args = ap.parse_args()

    years = list(range(args.start, args.end + 1))
    t0 = time.time()
    done = skipped = missing = 0

    for i, year in enumerate(years, 1):
        out_path = args.out_dir / f"oisst-avhrr-v02r01.{year}_india.nc"
        if out_path.exists() and out_path.stat().st_size > 1024:
            skipped += 1
            continue
        ok, n = consolidate_year(year, args.in_dir, args.out_dir)
        elapsed = time.time() - t0
        if ok:
            done += 1
            size_mb = out_path.stat().st_size / 1e6
            print(f"[{i}/{len(years)}] {year}: merged {n} daily files -> "
                  f"{size_mb:.1f} MB  (elapsed {elapsed:.0f}s)", flush=True)
        else:
            missing += 1
            print(f"[{i}/{len(years)}] {year}: no daily files found, skipping",
                  flush=True)

    print(f"\nconsolidated={done} already_present={skipped} "
          f"missing={missing}  in {(time.time()-t0)/60:.1f} min -> {args.out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

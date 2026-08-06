"""Coarsen the merged IMD rainfall from 0.25 deg to 0.5 deg by AREA-AVERAGING.

Why this exists, and why it is a separate step rather than a preprocessor flag:

Full India at 0.25 deg is 129 x 137 = 17,673 grid cells. The dense training
tensor for 1981-2025 is then 19.8 GB, which exceeds both this machine's 15.3 GB
of RAM and a Kaggle session's usable memory. Halving the resolution to 0.5 deg
gives 4,485 cells and a ~5.0 GB tensor, which fits comfortably.

The naive way to get there is wrong. preprocess_imd() regrids tmax/tmin with
regrid_to_target() but only *clips* rainfall, then merges with
``xr.merge(..., join="inner")``. Because the 0.5 deg coordinates are a strict
subset of the 0.25 deg ones, that inner join silently keeps every 2nd cell and
discards 75% of the rainfall field. Point decimation is particularly bad for
rainfall: it drops local maxima wholesale and biases extreme-event statistics,
which is the metric this project is judged on.

So rainfall is coarsened here by explicit 2x2 mean over lat/lon, which is the
correct aggregation for a rate field and preserves the regional mean.

tmax/tmin are NOT touched: IMD serves them natively at 1.0 deg (31 x 31), and
regrid_to_target() interpolates them up to whatever --resolution is requested.
Coarsening a 1.0 deg field to reach 0.5 deg would be meaningless.

KNOWN LIMITATION, stated plainly: CHIRPS is loaded separately by
_load_chirps() at its native 0.25 deg and aligned with
``reindex_like(rain, method="nearest")``, so the auxiliary chirps_rain channel
IS nearest-neighbour sampled rather than averaged in the 0.5 deg run. That
affects an auxiliary predictor, not the IMD rainfall target.

Usage:
    python scripts/coarsen_imd_to_half_degree.py \
        --in D:/vayu_data/imd_merged --out D:/vayu_data/imd_merged_05
"""
from __future__ import annotations

import argparse
import io
import shutil
import sys
from pathlib import Path

import numpy as np
import xarray as xr

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

FACTOR = 2  # 0.25 deg -> 0.5 deg


def coarsen_rainfall(src: Path, dst: Path) -> None:
    with xr.open_dataset(src) as ds:
        var = "rainfall" if "rainfall" in ds.data_vars else list(ds.data_vars)[0]
        before = (ds.sizes["lat"], ds.sizes["lon"])
        lat0, lat1 = float(ds.lat.min()), float(ds.lat.max())
        lon0, lon1 = float(ds.lon.min()), float(ds.lon.max())

        # boundary="trim" drops a trailing cell when the count is odd, so the
        # extent shrinks slightly; logged below so it is never a silent change.
        out = ds.coarsen(lat=FACTOR, lon=FACTOR, boundary="trim").mean(skipna=True)

        after = (out.sizes["lat"], out.sizes["lon"])
        a = ds[var].values
        b = out[var].values
        fa = a[np.isfinite(a)]
        fb = b[np.isfinite(b)]

        print(f"  {src.name}")
        print(f"    grid   {before[0]}x{before[1]} -> {after[0]}x{after[1]}")
        print(f"    lat    {lat0:.2f}..{lat1:.2f} -> "
              f"{float(out.lat.min()):.2f}..{float(out.lat.max()):.2f}")
        print(f"    lon    {lon0:.2f}..{lon1:.2f} -> "
              f"{float(out.lon.min()):.2f}..{float(out.lon.max()):.2f}")
        print(f"    mean   {fa.mean():.4f} -> {fb.mean():.4f} mm/day "
              f"(area-average should preserve this)")
        print(f"    max    {fa.max():.2f} -> {fb.max():.2f} mm/day "
              f"(peaks smooth out, as expected for averaging)")
        print(f"    nan%   {np.isnan(a).mean()*100:.1f} -> {np.isnan(b).mean()*100:.1f}")

        out = out.load()

    tmp = dst.with_suffix(".nc.tmp")
    out.to_netcdf(tmp, encoding={v: {"zlib": True, "complevel": 4}
                                  for v in out.data_vars})
    tmp.replace(dst)
    print(f"    wrote  {dst.name} ({dst.stat().st_size/1e6:.0f} MB)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_dir", type=Path,
                     default=Path("D:/vayu_data/imd_merged"))
    ap.add_argument("--out", dest="out_dir", type=Path,
                     default=Path("D:/vayu_data/imd_merged_05"))
    ap.add_argument("--start", type=int, default=1981)
    ap.add_argument("--end", type=int, default=2025)
    args = ap.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    span = f"{args.start}-{args.end}"

    rain_src = args.in_dir / f"rainfall_{span}.nc"
    if not rain_src.exists():
        print(f"missing {rain_src}")
        return 1

    print("Coarsening IMD rainfall 0.25 deg -> 0.5 deg (2x2 area-average):")
    coarsen_rainfall(rain_src, args.out_dir / f"rainfall_{span}.nc")

    # tmax/tmin are native 1.0 deg and get interpolated up by
    # regrid_to_target(); copying them through unchanged keeps the CLI's
    # expected <var>_<span>.nc filenames satisfied in one directory.
    print("\nCopying tmax/tmin unchanged (native 1.0 deg, interpolated later):")
    for v in ("tmax", "tmin"):
        s = args.in_dir / f"{v}_{span}.nc"
        d = args.out_dir / f"{v}_{span}.nc"
        if not s.exists():
            print(f"  missing {s}")
            return 1
        if not d.exists():
            shutil.copy2(s, d)
        print(f"  {d.name} ({d.stat().st_size/1e6:.0f} MB)")

    print(f"\nDone -> {args.out_dir}")
    print("Next: preprocess with --region full_india --resolution 0.5 "
          f"--data-dir {args.out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

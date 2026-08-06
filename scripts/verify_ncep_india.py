"""Validate the NCEP India subset: coverage, shape, physical range, NaN.

Counting files is not enough -- a truncated or wrongly-subsetted file still
counts. This opens every file and checks:
  * every (var, year) in the expected range is present
  * day count matches the calendar year (365, or 366 on leap years)
  * the India bounding box is actually covered
  * values sit in physically plausible ranges for 850 hPa
  * no NaN (NCEP reanalysis is gap-free by construction)

Run after scripts/download_ncep_fill.py, before re-running preprocess.
"""
from __future__ import annotations

import argparse
import calendar
import io
import sys
from pathlib import Path

import numpy as np
import xarray as xr

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# Plausible 850 hPa ranges over the India box. Wind components can be strong
# during the monsoon jet (the Somali/Findlater jet regularly exceeds 25 m/s),
# so bounds are deliberately generous -- the point is to catch unit errors or
# fill values (e.g. -9.97e36), not to police meteorology.
LIMITS = {
    "uwnd": (-60.0, 60.0),      # m/s
    "vwnd": (-60.0, 60.0),      # m/s
    "shum": (0.0, 0.05),        # kg/kg
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", type=Path, default=Path("D:/vayu_data/ncep_india"))
    ap.add_argument("--start", type=int, default=1981)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--vars", nargs="*", default=["uwnd", "vwnd", "shum"])
    args = ap.parse_args()

    problems: list[str] = []
    ok = 0
    lat_lo = lat_hi = lon_lo = lon_hi = None
    total_bytes = 0

    for var in args.vars:
        for year in range(args.start, args.end + 1):
            f = args.dir / f"{var}.{year}.nc"
            if not f.exists():
                problems.append(f"MISSING {f.name}")
                continue
            total_bytes += f.stat().st_size
            try:
                with xr.open_dataset(f) as ds:
                    if var not in ds.data_vars:
                        problems.append(
                            f"{f.name}: no '{var}' (has {list(ds.data_vars)})")
                        continue
                    a = ds[var]

                    ndays = ds.sizes.get("time", 0)
                    expected = 366 if calendar.isleap(year) else 365
                    # 2025 may be partial if the year is still in progress.
                    if year < 2025 and ndays != expected:
                        problems.append(
                            f"{f.name}: {ndays} days, expected {expected}")

                    lats = np.asarray(ds["lat"].values, dtype=float)
                    lons = np.asarray(ds["lon"].values, dtype=float)
                    lat_lo, lat_hi = lats.min(), lats.max()
                    lon_lo, lon_hi = lons.min(), lons.max()
                    # Pilot regions span ~8-31N, 68-95E; the subset must cover
                    # that with room for the preprocessor's 5 deg regrid margin.
                    if lat_lo > 6.0 or lat_hi < 33.0:
                        problems.append(
                            f"{f.name}: lat coverage {lat_lo}..{lat_hi} too narrow")
                    if lon_lo > 66.0 or lon_hi < 97.0:
                        problems.append(
                            f"{f.name}: lon coverage {lon_lo}..{lon_hi} too narrow")

                    nnan = int(a.isnull().sum())
                    if nnan:
                        problems.append(f"{f.name}: {nnan} NaN values")

                    vmin, vmax = float(a.min()), float(a.max())
                    lo, hi = LIMITS[var]
                    if vmin < lo or vmax > hi:
                        problems.append(
                            f"{f.name}: {var} range {vmin:.4g}..{vmax:.4g} "
                            f"outside plausible [{lo}, {hi}]")

                    if float(a.std()) == 0.0:
                        problems.append(f"{f.name}: CONSTANT field (std=0)")

                    ok += 1
            except Exception as exc:
                problems.append(f"{f.name}: {type(exc).__name__}: {exc}")

    n_expected = len(args.vars) * (args.end - args.start + 1)
    print(f"checked {ok}/{n_expected} files  "
          f"({total_bytes/1e6:.1f} MB total)")
    print(f"grid: lat {lat_lo}..{lat_hi}, lon {lon_lo}..{lon_hi}")

    # Per-variable summary over a sample year so the numbers are inspectable.
    print("\nsample year 2000:")
    for var in args.vars:
        f = args.dir / f"{var}.2000.nc"
        if f.exists():
            with xr.open_dataset(f) as ds:
                a = ds[var]
                print(f"  {var}: mean={float(a.mean()):+.5f} "
                      f"std={float(a.std()):.5f} "
                      f"min={float(a.min()):+.4f} max={float(a.max()):+.4f}")

    if problems:
        print(f"\n{len(problems)} PROBLEM(S):")
        for p in problems[:40]:
            print("  -", p)
        if len(problems) > 40:
            print(f"  ... and {len(problems)-40} more")
        return 1
    print("\nNCEP_INDIA_VERIFY_OK — all files present, shaped and in range.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

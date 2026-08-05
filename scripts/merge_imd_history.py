"""Merge downloaded IMD .grd year files into single NetCDFs for preprocessing.

data_ingestion.cli's preprocess command expects one merged file per variable:
    <data_dir>/rainfall_{start}-{end}.nc
    <data_dir>/tmax_{start}-{end}.nc
    <data_dir>/tmin_{start}-{end}.nc

scripts/download_imd_history.py only fetches the per-year .grd files (via
imdlib, fn_format="yearwise"), it does not merge them. Only 'rain' has ever
been downloaded for the 1951-2025 history (D:/vayu_data/imd_history/rain,
75 years); tmax/tmin were never fetched at that range -- only the 2010-2025
copies in data/imd exist. This script:

  1. downloads any missing tmax/tmin years via imdlib (same call the existing
     downloader uses), resumable/skippable like the other scripts here
  2. reads all three variables with imdlib.open_data(..., fn_format="yearwise")
     and converts via IMD.get_xarray(), which is the library's own binary
     parser -- not the hand-rolled one in data_ingestion/downloader.py, which
     uses a different missing-value/shape convention and was written for the
     2010-2025-only path
  3. writes rainfall_{start}-{end}.nc / tmax_.../ tmin_... into --out, matching
     the exact filenames data_ingestion.cli.preprocess reads

Note IMD tmax/tmin are natively 1.0 deg (31x31 over India), NOT 0.25 deg like
rainfall. That is expected: preprocess_imd() already regrids temperature to
0.25 deg as its first step (regrid_to_target), so raw native-resolution files
are the correct input, not a bug to fix here.

Usage:
    python scripts/merge_imd_history.py --start 1981 --end 2025 --grd-dir D:/vayu_data/imd_history --out D:/vayu_data/imd_merged
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import imdlib


def already_have(grd_dir: Path, var: str, year: int) -> bool:
    for name in (f"{year}.grd", f"{year}.GRD"):
        p = grd_dir / var / name
        if p.exists() and p.stat().st_size > 0:
            return True
    return False


def fetch_year(var: str, year: int, grd_dir: Path, attempts: int, backoff: float) -> bool:
    for attempt in range(1, attempts + 1):
        try:
            imdlib.get_data(var, year, year, fn_format="yearwise", file_dir=str(grd_dir))
            return True
        except Exception as exc:
            print(f"    attempt {attempt}/{attempts}: {type(exc).__name__}: {str(exc)[:80]}")
            if attempt < attempts:
                time.sleep(min(backoff * attempt, 30.0))
    return False


def ensure_downloaded(var: str, start: int, end: int, grd_dir: Path,
                       attempts: int, backoff: float) -> list[int]:
    """Download any missing years for *var*; return years that failed."""
    failed = []
    for year in range(start, end + 1):
        if already_have(grd_dir, var, year):
            continue
        print(f"[{var}] downloading {year}...", flush=True)
        if not fetch_year(var, year, grd_dir, attempts, backoff):
            failed.append(year)
            print(f"    GIVING UP on {var} {year}")
    return failed


def merge_and_save(var: str, start: int, end: int, grd_dir: Path, out_dir: Path) -> Path:
    """Read the full year range with imdlib and write one merged NetCDF.

    imdlib.open_data reads year-by-year internally; any year whose .grd file
    is missing raises inside imdlib rather than being silently skipped, so
    ensure_downloaded() must run first.
    """
    out_name = {"rain": "rainfall", "tmax": "tmax", "tmin": "tmin"}[var]
    out_path = out_dir / f"{out_name}_{start}-{end}.nc"

    imd_obj = imdlib.open_data(var, start, end, fn_format="yearwise", file_dir=str(grd_dir))
    ds = imd_obj.get_xarray()

    # imdlib.get_xarray() does NOT convert IMD's -999.0 missing-value sentinel
    # to NaN (verified: a 2020-2022 rain smoke test came back with min=-999.0
    # and 0% NaN). data_ingestion/downloader.py's own hand-rolled .grd parser
    # does this conversion, but imdlib.open_data() bypasses that code path
    # entirely, and nothing downstream in preprocess_imd() expects a -999
    # sentinel. Left unconverted, -999 would corrupt regridding, quality
    # control and normalization statistics.
    for dv in ds.data_vars:
        ds[dv] = ds[dv].where(ds[dv] != -999.0)

    # imdlib names the rainfall variable 'rain'; the rest of this project's
    # pipeline (preprocess_imd, IMDDownloader) expects 'rainfall'/'tmax'/'tmin'.
    if var == "rain" and "rain" in ds.data_vars:
        ds = ds.rename({"rain": "rainfall"})

    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".nc.tmp")
    ds.to_netcdf(tmp)
    tmp.replace(out_path)
    return out_path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=1981)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--grd-dir", type=Path, default=Path("D:/vayu_data/imd_history"))
    ap.add_argument("--out", type=Path, default=Path("D:/vayu_data/imd_merged"))
    ap.add_argument("--vars", nargs="*", default=["rain", "tmax", "tmin"])
    ap.add_argument("--attempts", type=int, default=20)
    ap.add_argument("--backoff", type=float, default=5.0)
    args = ap.parse_args()

    t0 = time.time()
    any_failed = False
    for var in args.vars:
        print(f"=== {var}: checking {args.start}-{args.end} for missing years ===", flush=True)
        failed = ensure_downloaded(var, args.start, args.end, args.grd_dir,
                                    args.attempts, args.backoff)
        if failed:
            any_failed = True
            print(f"[{var}] FAILED years (re-run to retry): {failed}")
            continue
        print(f"[{var}] all years present, merging...", flush=True)
        out_path = merge_and_save(var, args.start, args.end, args.grd_dir, args.out)
        size_mb = out_path.stat().st_size / 1e6
        print(f"[{var}] wrote {out_path} ({size_mb:.0f} MB)", flush=True)

    print(f"\nDone in {(time.time()-t0)/60:.1f} minutes.")
    if any_failed:
        print("Some years failed to download — re-run to retry only those.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

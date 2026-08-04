"""Fill missing NCEP/NCAR Reanalysis 1 fields, subsetted to India server-side.

Why subset at all: NCEP serves 2.5 deg GLOBAL grids (73 lat x 144 lon) at
165 MB per variable-year, but this project only needs India (~4-40N, 64-102E)
at a single pressure level (850 hPa). That is 15x16 cells out of 73x144 --
about 460x less data. Measured: 356 KB and ~4s per variable-year, versus
165 MB and minutes for the full global file.

Why NCSS rather than OPeNDAP: an earlier version used
``xr.open_dataset(<dodsC url>)``, which works but issues 3-4 HTTP round trips
per file (.das, .dds, then .dods). Across 135 variable-years that is ~500
requests, and NOAA's nginx front-end returned::

    429 Too Many Requests

after only ~6 files. The netCDF DAP client then tried to parse the HTML error
page as a dataset descriptor, surfacing as the confusing::

    syntax error, unexpected WORD_WORD, expecting SCAN_ATTR or SCAN_DATASET

THREDDS NetcdfSubset (NCSS) returns the entire subsetted NetCDF in ONE
request, cutting request count ~4x. The catalog at
psl.noaa.gov/thredds/catalog.xml declares it as::

    <service name="ncssGrid" serviceType="NetcdfSubset" base="/thredds/ncss/grid/"/>

Note the ``/grid/`` segment -- this is THREDDS 5.x. A plain ``/thredds/ncss/``
path returns 404.

Requesting over plain HTTP also means real status codes, so a 429 can be
handled properly (honouring ``Retry-After``) instead of being misread as a
corrupt dataset.

Why these variables matter: measured with scripts/feature_informativeness.py,
the Indo-Gangetic and Central India datasets have SIX dead input channels --
including uwnd_850, vwnd_850 and shum_850 -- so their rainfall can only be
predicted from past rainfall, calendar and terrain. shum_850 is also the
strongest real predictor of next-day rainfall found in this project
(corr +0.319 on Western Ghats, second only to rainfall's own autocorrelation).

Output matches what data_ingestion/preprocessor.py's load_ncep_wind_at_850()
already expects: one NetCDF per variable per year named ``{var}.{year}.nc``,
already at 850 hPa and already clipped near India, so the existing regrid step
works unchanged.

NCEP/NCAR R1 production ended 2026-03-17, so any range through then is covered.

Usage:
    python scripts/download_ncep_fill.py --start 1981 --end 2025 --out D:/vayu_data/ncep_india
    python scripts/download_ncep_fill.py --vars shum
"""
from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import xarray as xr

BASE = ("https://psl.noaa.gov/thredds/ncss/grid/Datasets/ncep.reanalysis/"
        "Dailies/pressure")
DEFAULT_DIR = Path("data/ncep_wind")

# India bounding box with a margin so the preprocessor's own regrid step
# (which clips again to exact pilot-region bounds) always has full coverage.
NORTH, SOUTH = 40.0, 4.0
WEST, EAST = 64.0, 102.0
LEVEL_HPA = 850

VARS = ("uwnd", "vwnd", "shum")
UA = {"User-Agent": "vayu-research/1.0 (climate downscaling research)"}


def build_url(var: str, year: int) -> str:
    return (
        f"{BASE}/{var}.{year}.nc?var={var}"
        f"&north={NORTH}&south={SOUTH}&west={WEST}&east={EAST}"
        f"&vertCoord={LEVEL_HPA}&horizStride=1&accept=netcdf"
        f"&time_start={year}-01-01T00:00:00Z"
        f"&time_end={year}-12-31T23:59:59Z"
    )


def target(out_dir: Path, var: str, year: int) -> Path:
    return out_dir / f"{var}.{year}.nc"


def _finalize(raw: bytes, tmp: Path, dst: Path, var: str) -> int:
    """Write *raw*, validate it, drop the singleton level dim, commit to *dst*.

    NCSS returns a ``level`` dimension of size 1. The preprocessor tolerates
    it (``if "level" in ds.dims``), but squeezing it here keeps every file in
    the directory the same shape -- including the handful produced by the
    earlier OPeNDAP code path, which selected the level away. Re-writing also
    doubles as validation: a truncated or HTML response fails to open.
    """
    tmp.write_bytes(raw)
    with xr.open_dataset(tmp) as ds:
        if var not in ds.data_vars:
            raise OSError(f"variable '{var}' absent (got {list(ds.data_vars)})")
        if "level" in ds.dims:
            ds = ds.sel(level=LEVEL_HPA, method="nearest")
        if ds.sizes.get("time", 0) < 360:
            raise OSError(f"only {ds.sizes.get('time', 0)} days returned")
        # '_NCProperties' is a reserved netCDF4 attribute describing the SOURCE
        # file's library version; netCDF4 refuses to write it back out
        # ("String match to name in use") and regenerates it anyway.
        ds.attrs.pop("_NCProperties", None)
        ds = ds.load()
    ds.to_netcdf(tmp)
    size = tmp.stat().st_size
    if size < 1024:
        raise OSError(f"suspiciously small file ({size} bytes)")
    tmp.replace(dst)
    return size


def fetch_year(
    var: str,
    year: int,
    out_dir: Path,
    attempts: int,
    backoff: float,
    cooldown: float,
) -> bool:
    url = build_url(var, year)
    dst = target(out_dir, var, year)
    tmp = dst.with_suffix(".nc.part")

    for attempt in range(1, attempts + 1):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=300) as resp:
                raw = resp.read()
            size = _finalize(raw, tmp, dst, var)
            print(f"    ok  {dst.name}  {size / 1e3:.0f} KB  (India, {LEVEL_HPA} hPa)",
                  flush=True)
            return True
        except urllib.error.HTTPError as exc:
            tmp.unlink(missing_ok=True)
            if exc.code == 429:
                # Rate limited, not broken. Honour Retry-After when present,
                # otherwise cool down long enough for nginx's window to reset
                # (measured: the window clears in well under 90s).
                wait = cooldown
                hdr = exc.headers.get("Retry-After")
                if hdr and hdr.strip().isdigit():
                    wait = max(float(hdr.strip()), 5.0)
                print(f"    attempt {attempt}/{attempts}: HTTP 429 rate limited "
                      f"-- cooling down {wait:.0f}s", flush=True)
                if attempt < attempts:
                    time.sleep(wait)
                continue
            print(f"    attempt {attempt}/{attempts}: HTTP {exc.code} {exc.reason}",
                  flush=True)
            if attempt < attempts:
                time.sleep(min(backoff * attempt, 60.0))
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            print(f"    attempt {attempt}/{attempts}: "
                  f"{type(exc).__name__}: {str(exc)[:110]}", flush=True)
            if attempt < attempts:
                time.sleep(min(backoff * attempt, 60.0))
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vars", nargs="*", default=list(VARS))
    # 1981 is the extension target because CHIRPS and OISST's daily AVHRR
    # record both begin in 1981, so all three auxiliary sources align to the
    # same window. NCEP/NCAR R1 itself starts 1948.
    ap.add_argument("--start", type=int, default=2010)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--out", type=Path, default=DEFAULT_DIR)
    ap.add_argument("--attempts", type=int, default=6)
    ap.add_argument("--backoff", type=float, default=10.0)
    # Throttle. The 429 tripped at roughly 17 requests/min. One NCSS request
    # per file plus a 4s pause is ~7 requests/min, comfortably under.
    ap.add_argument("--delay", type=float, default=4.0,
                    help="Seconds to wait between requests (avoids HTTP 429)")
    ap.add_argument("--cooldown", type=float, default=120.0,
                    help="Seconds to wait after an HTTP 429 with no Retry-After")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    jobs = [(v, y) for v in args.vars for y in range(args.start, args.end + 1)]

    done, skipped, failed = 0, 0, []
    t0 = time.time()

    for i, (var, year) in enumerate(jobs, 1):
        dst = target(args.out, var, year)
        if dst.exists() and dst.stat().st_size > 1024:
            skipped += 1
            continue
        elapsed = (time.time() - t0) / 60
        print(f"[{i}/{len(jobs)}] {var} {year}   (elapsed {elapsed:.1f}m)", flush=True)
        if fetch_year(var, year, args.out, args.attempts, args.backoff, args.cooldown):
            done += 1
        else:
            failed.append(f"{var}.{year}")
        if args.delay > 0:
            time.sleep(args.delay)

    print(f"\ndownloaded={done} already_present={skipped} failed={len(failed)}")
    if failed:
        print("failed:", failed)
        print("Re-run to retry only the missing files (resumable).")
        return 1
    print(f"NCEP India subset complete in {(time.time()-t0)/60:.1f} minutes "
          f"-> {args.out}")
    print("\nNext: re-run preprocess with --ncep-wind-dir pointing here so "
          "uwnd/vwnd/shum reach IGP and Central India, then verify with "
          "scripts/feature_informativeness.py that no atmospheric channel is "
          "still reported CONSTANT.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

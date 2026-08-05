"""Download ERA5-Land skin temperature (the insat_lst substitute) from CDS.

Why this exists: the LST record assembled so far covers 1981-1999 only, as
ERA5-Land ``skt`` (19 yearly files). The 2000-2025 portion arrived as a single
GeoTIFF, ``India_MODIS_LST_Mean_2000_2025.tif`` -- verified to be ONE band
named ``LST_Celsius`` at ~1 km, i.e. a 26-year time-averaged composite, not a
daily time series. So there is currently no daily LST for 2000-2025, which
includes the entire 2023-2025 held-out test period.

Why continue with ERA5-Land rather than fetching daily MODIS LST: splicing a
reanalysis skin-temperature series to a MODIS retrieved-LST series at the year
2000 would inject an artificial step change in the middle of training. They are
different physical quantities measured differently -- MODIS LST is a clear-sky-
only thermal-infrared split-window retrieval, while ERA5-Land skt is an all-sky
land-surface-model diagnostic -- so their means, variances and cloud sampling
differ systematically. A model trained across that boundary can learn the
discontinuity as if it were signal. One consistent source over 1981-2025 avoids
the problem entirely.

DISCLOSURE: ERA5-Land skin temperature is a documented substitute for MOSDAC
INSAT-3D LST, which was never approved for this project. It is NOT INSAT data
and must be described as ERA5-Land skin temperature in any manifest,
data-readiness report or demo narration.

Request geometry matches the existing 1981-1999 files exactly (verified from
those files: latitude 6.70..35.50 / 289 points, longitude 68.10..97.40 / 294
points, timestamps at 06:00 and 18:00 UTC) so the merged series sits on one
grid.

Note the existing 1981-1999 files are each exactly 7 days short (133 days
total, ~1.9%). The missing dates were identified empirically as the 31st of
every 31-day month -- Jan/Mar/May/Jul/Aug/Oct/Dec 31 -- so the original request
ran days 1-30. Requesting 1-31 fixes it, and year_complete() re-fetches any
year that does not hold a full calendar.

CDS delivers ``data_format: netcdf`` requests as a ZIP archive containing a
single ``data_0.nc`` despite the .nc filename, so responses are unwrapped
automatically.

Usage:
    python scripts/download_era5_land_lst.py --start 2000 --end 2025 --out D:/vayu_data/lst_india_nc
"""
from __future__ import annotations

import argparse
import calendar
import sys
import time
import zipfile
from pathlib import Path

# Matches the existing 1981-1999 files. CDS "area" is [North, West, South, East].
AREA = [35.5, 68.1, 6.7, 97.4]
# 06:00 and 18:00 UTC is roughly 11:30 and 23:30 IST, approximating a
# day/night pair comparable to MODIS Terra/Aqua overpass times.
TIMES = ["06:00", "18:00"]
DATASET = "reanalysis-era5-land"
VARIABLE = "skin_temperature"


def months_days(year: int) -> list[tuple[str, list[str]]]:
    """Correct day list per month, so no invalid dates are silently dropped."""
    out = []
    for m in range(1, 13):
        ndays = calendar.monthrange(year, m)[1]
        out.append((f"{m:02d}", [f"{d:02d}" for d in range(1, ndays + 1)]))
    return out


def unwrap(path: Path) -> None:
    """CDS returns a zip containing data_0.nc even for .nc targets."""
    with open(path, "rb") as fh:
        if fh.read(4) != b"PK\x03\x04":
            return
    tmp = path.with_suffix(".zip.tmp")
    path.replace(tmp)
    try:
        with zipfile.ZipFile(tmp) as zf:
            inner = [n for n in zf.namelist() if n.endswith(".nc")]
            if len(inner) != 1:
                raise OSError(f"expected 1 .nc inside, found {inner}")
            with zf.open(inner[0]) as src, open(path, "wb") as dst:
                while chunk := src.read(1 << 20):
                    dst.write(chunk)
    finally:
        tmp.unlink(missing_ok=True)


def year_complete(path: Path, year: int) -> bool:
    """True if the file exists and holds every calendar day of *year*."""
    if not path.exists() or path.stat().st_size < 1_000_000:
        return False
    try:
        import numpy as np
        import xarray as xr
        with xr.open_dataset(path) as ds:
            tname = "valid_time" if "valid_time" in ds.coords else "time"
            days = len(np.unique(ds[tname].values.astype("datetime64[D]")))
        return days >= (366 if calendar.isleap(year) else 365)
    except Exception:
        return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=2000)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--out", type=Path, default=Path("D:/vayu_data/lst_india_nc"))
    ap.add_argument("--attempts", type=int, default=3)
    args = ap.parse_args()

    import cdsapi

    args.out.mkdir(parents=True, exist_ok=True)
    client = cdsapi.Client()

    done, skipped, failed = 0, 0, []
    t0 = time.time()
    years = list(range(args.start, args.end + 1))

    for i, year in enumerate(years, 1):
        target = args.out / f"era5_land_lst_india_{year}.nc"
        if year_complete(target, year):
            print(f"[{i}/{len(years)}] {year} already complete — skip", flush=True)
            skipped += 1
            continue

        print(f"[{i}/{len(years)}] requesting ERA5-Land skt {year} "
              f"(elapsed {(time.time()-t0)/60:.1f}m)", flush=True)
        md = months_days(year)
        request = {
            "variable": [VARIABLE],
            "year": [str(year)],
            "month": [m for m, _ in md],
            # Days 1-31. The existing 1981-1999 files are each missing exactly
            # the 31st of every 31-day month (Jan/Mar/May/Jul/Aug/Oct/Dec 31),
            # which means the original request stopped at day 30. CDS ignores
            # combinations that do not exist (Feb 30 etc.), so sending the full
            # 1-31 range is both correct and complete. year_complete() below
            # confirms the returned file really holds every calendar day.
            "day": [f"{d:02d}" for d in range(1, 32)],
            "time": TIMES,
            "area": AREA,
            "data_format": "netcdf",
            "download_format": "unarchived",
        }
        ok = False
        for attempt in range(1, args.attempts + 1):
            try:
                client.retrieve(DATASET, request, str(target))
                unwrap(target)
                size = target.stat().st_size / 1e6
                print(f"    ok  {target.name}  {size:.0f} MB", flush=True)
                ok = True
                break
            except Exception as exc:
                print(f"    attempt {attempt}/{args.attempts}: "
                      f"{type(exc).__name__}: {str(exc)[:160]}", flush=True)
                target.unlink(missing_ok=True)
                if attempt < args.attempts:
                    time.sleep(30 * attempt)
        if ok:
            done += 1
        else:
            failed.append(str(year))

    print(f"\ndownloaded={done} already_complete={skipped} failed={len(failed)}")
    if failed:
        print("failed years:", failed)
        print("Re-run to retry only the missing years (resumable).")
        return 1
    print(f"ERA5-Land LST complete in {(time.time()-t0)/60:.1f} minutes "
          f"-> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

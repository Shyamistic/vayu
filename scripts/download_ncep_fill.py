"""Fill missing NCEP/NCAR Reanalysis 1 fields so every region has moisture+wind.

Why: measured with scripts/feature_informativeness.py, the Indo-Gangetic and
Central India datasets have SIX dead input channels -- including uwnd_850,
vwnd_850 and shum_850 -- so their rainfall can only be predicted from past
rainfall, calendar and terrain. That is climatology+persistence by construction,
which is exactly the measured ceiling and why IGP rainfall trends negative during
training. Western Ghats has the winds and humidity, and there `shum_850` is the
strongest real predictor of next-day rain (corr +0.319, second only to rainfall's
own autocorrelation at +0.511).

Local state before this script:
    data/ncep_wind/  uwnd.{2010-2014,2016-2020}.nc   <- uwnd only, gaps
    no vwnd, no shum at all

NCEP/NCAR R1 is 2.5 deg -- coarser than the 0.25 deg target grid -- so it supplies
synoptic-scale circulation and moisture rather than local detail. That is the
right scale for monsoon rainfall drivers, and it is the fast option: ERA5 via CDS
takes far longer to queue and retrieve.

Note: NCEP/NCAR R1 production ended 2026-03-17, so 2010-2025 is fully covered.

Usage:
    python scripts/download_ncep_fill.py                    # uwnd+vwnd+shum 2010-2025
    python scripts/download_ncep_fill.py --vars shum
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from urllib.request import urlopen

BASE = "https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis/Dailies/pressure"
DEFAULT_DIR = Path("data/ncep_wind")

# Variables needed for the 17-channel contract's atmospheric slots.
VARS = ("uwnd", "vwnd", "shum")


def target(out_dir: Path, var: str, year: int) -> Path:
    return out_dir / f"{var}.{year}.nc"


def download(var: str, year: int, out_dir: Path, attempts: int, backoff: float) -> bool:
    url = f"{BASE}/{var}.{year}.nc"
    dst = target(out_dir, var, year)
    tmp = dst.with_suffix(".nc.part")

    for attempt in range(1, attempts + 1):
        try:
            with urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            if tmp.stat().st_size < 1024:
                raise OSError(f"suspiciously small file ({tmp.stat().st_size} bytes)")
            tmp.replace(dst)
            print(f"    ok  {dst.name}  {dst.stat().st_size/1e6:.0f} MB")
            return True
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            print(f"    attempt {attempt}/{attempts} failed: "
                  f"{type(exc).__name__}: {str(exc)[:90]}")
            if attempt < attempts:
                time.sleep(backoff * attempt)
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vars", nargs="*", default=list(VARS))
    ap.add_argument("--start", type=int, default=2010)
    ap.add_argument("--end", type=int, default=2025)
    # NCEP/NCAR R1 itself starts 1948; 1981 is used as the default extension
    # target because it's where CHIRPS and OISST also begin, so all three
    # auxiliary sources can be aligned to the same window (see
    # scripts/download_chirps_history.py and data/download_oisst_sst.py).
    ap.add_argument("--out", type=Path, default=DEFAULT_DIR)
    ap.add_argument("--attempts", type=int, default=4)
    ap.add_argument("--backoff", type=float, default=10.0)
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
        print(f"[{i}/{len(jobs)}] {var} {year}")
        if download(var, year, args.out, args.attempts, args.backoff):
            done += 1
        else:
            failed.append(f"{var}.{year}")

    print(f"\ndownloaded={done} already_present={skipped} failed={len(failed)}")
    if failed:
        print("failed:", failed)
        print("Re-run to retry only the missing files (resumable).")
        return 1
    print(f"NCEP fill complete in {(time.time()-t0)/60:.1f} minutes -> {args.out}")
    print("\nNext: re-run the preprocess step so uwnd/vwnd/shum reach IGP and "
          "Central India, then verify with scripts/feature_informativeness.py "
          "that no atmospheric channel is still reported CONSTANT.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

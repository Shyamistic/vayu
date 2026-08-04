"""Download global daily CHIRPS v2.0 (p25, 0.25 deg) yearly NetCDF files.

Why: the project's IMD rainfall/temperature history now spans 1951-2025, but
CHIRPS on disk only covered 2010-2026 (17 years). CHIRPS record starts 1981
(https://www.chc.ucsb.edu/data/chirps), so 1981-2025 is the deepest range where
IMD, NCEP and OISST can all be aligned -- see the NCEP/OISST extension scripts
run alongside this one.

Verified reachable: a byte-range request against the 1981 file returned HTTP 206
with a valid NetCDF/HDF5 magic header, confirming the file and URL pattern.

Usage:
    python scripts/download_chirps_history.py --out D:\\vayu_data\\chirps --start 1981 --end 2025
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from urllib.request import urlopen

BASE = "https://data.chc.ucsb.edu/products/CHIRPS-2.0/global_daily/netcdf/p25"
DEFAULT_DIR = Path("data/chirps_history")
MIN_EXPECTED_BYTES = 50_000_000  # real yearly p25 files are ~60-70 MB


def target(out_dir: Path, year: int) -> Path:
    return out_dir / f"chirps-v2.0.{year}.days_p25.nc"


def download(year: int, out_dir: Path, attempts: int, backoff: float) -> bool:
    url = f"{BASE}/chirps-v2.0.{year}.days_p25.nc"
    dst = target(out_dir, year)
    tmp = dst.with_suffix(".nc.part")

    for attempt in range(1, attempts + 1):
        try:
            with urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            size = tmp.stat().st_size
            if size < MIN_EXPECTED_BYTES:
                raise OSError(f"suspiciously small file ({size} bytes)")
            tmp.replace(dst)
            print(f"    ok  {dst.name}  {size / 1e6:.0f} MB")
            return True
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            print(f"    attempt {attempt}/{attempts}: {type(exc).__name__}: {str(exc)[:80]}")
            if attempt < attempts:
                time.sleep(min(backoff * attempt, 30.0))
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=1981)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--out", type=Path, default=DEFAULT_DIR)
    ap.add_argument("--attempts", type=int, default=5)
    ap.add_argument("--backoff", type=float, default=10.0)
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    years = list(range(args.start, args.end + 1))

    done, skipped, failed = 0, 0, []
    t0 = time.time()

    for i, year in enumerate(years, 1):
        dst = target(args.out, year)
        if dst.exists() and dst.stat().st_size > MIN_EXPECTED_BYTES:
            skipped += 1
            continue
        print(f"[{i}/{len(years)}] chirps {year}")
        if download(year, args.out, args.attempts, args.backoff):
            done += 1
        else:
            failed.append(year)

    print(f"\ndownloaded={done} already_present={skipped} failed={len(failed)}")
    if failed:
        print("failed years:", failed)
        print("Re-run the same command to retry only the missing years.")
        return 1
    print(f"CHIRPS {args.start}-{args.end} complete in {(time.time()-t0)/60:.1f} min -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

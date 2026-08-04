"""Download the full IMD 0.25 deg gridded rainfall history (1901-present).

Why: the closest published benchmark (Narula et al., arXiv:2402.07851) trains on
IMD 1901-2023 -- 123 years. This project currently trains on 2010-2025 (16
years). Measured effect: rainfall cannot beat a seasonal climatology on held-out
test data (WG test R2 = -0.019, skill vs climatology = -0.151), while the same
model beats climatology by +0.49 on temperature. Training data volume is the
largest single gap.

Verified locally: one year of 'rain' downloads in ~28s at 0.25 deg on exactly the
project grid (lat 6.5-38.5, lon 66.5-100, 129x135). ~125 years is therefore
roughly an hour, and this script is resumable so the flaky-connection failures
seen throughout this project do not lose progress.

Usage:
    python scripts/download_imd_history.py                 # rain 1901-2025
    python scripts/download_imd_history.py --start 1951
    python scripts/download_imd_history.py --var tmax --start 1951
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import imdlib

DEFAULT_DIR = Path("data/imd_history")


IMD_HOST = "imdpune.gov.in"


def imd_https_reachable(timeout: float = 20.0) -> tuple[bool, str]:
    """Pre-flight check on the IMD HTTPS endpoint.

    This server is intermittently unavailable: it served 1901 in ~28s, then
    within the hour began refusing TCP 443 while still answering ICMP ping.
    Without this check the script grinds through every year x every retry
    against a dead port, which takes hours and downloads nothing.
    """
    import socket

    try:
        ip = socket.gethostbyname(IMD_HOST)
    except OSError as exc:
        return False, f"DNS lookup failed for {IMD_HOST}: {exc}"

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect((ip, 443))
        return True, f"{IMD_HOST} ({ip}) accepting HTTPS"
    except OSError as exc:
        return False, (
            f"{IMD_HOST} ({ip}) resolves but TCP 443 is not accepting "
            f"connections ({type(exc).__name__}). The IMD server is down or "
            f"rate-limiting; this is not a local network problem. Re-run later "
            f"-- already-downloaded years are skipped."
        )
    finally:
        sock.close()


def already_have(out_dir: Path, var: str, year: int) -> bool:
    """imdlib writes <var>/<year>.grd under file_dir with fn_format='yearwise'."""
    candidates = [
        out_dir / var / f"{year}.grd",
        out_dir / var / f"{year}.GRD",
    ]
    return any(c.exists() and c.stat().st_size > 0 for c in candidates)


def fetch_year(var: str, year: int, out_dir: Path, attempts: int, backoff: float) -> bool:
    for attempt in range(1, attempts + 1):
        try:
            imdlib.get_data(var, year, year, fn_format="yearwise", file_dir=str(out_dir))
            return True
        except Exception as exc:  # network flakiness is expected here
            wait = backoff * attempt
            print(f"    attempt {attempt}/{attempts} failed: "
                  f"{type(exc).__name__}: {str(exc)[:90]}")
            if attempt < attempts:
                print(f"    retrying in {wait:.0f}s")
                time.sleep(wait)
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--var", default="rain", choices=["rain", "tmax", "tmin"])
    ap.add_argument("--start", type=int, default=1901)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--out", type=Path, default=DEFAULT_DIR)
    ap.add_argument("--attempts", type=int, default=4)
    ap.add_argument("--backoff", type=float, default=15.0)
    ap.add_argument("--skip-preflight", action="store_true",
                    help="Attempt downloads even if the IMD host looks unreachable")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    years = list(range(args.start, args.end + 1))

    remaining = [y for y in years if not already_have(args.out, args.var, y)]
    if not remaining:
        print(f"All {len(years)} years of {args.var} already present in {args.out}")
        return 0

    if not args.skip_preflight:
        ok, detail = imd_https_reachable()
        print(f"pre-flight: {detail}")
        if not ok:
            print(f"\nAborting before touching {len(remaining)} remaining years.")
            print("Use --skip-preflight to try anyway.")
            return 2

    done, skipped, failed = 0, 0, []
    t_start = time.time()

    for i, year in enumerate(years, 1):
        if already_have(args.out, args.var, year):
            skipped += 1
            continue
        elapsed = time.time() - t_start
        rate = elapsed / max(done, 1)
        remaining = (len(years) - i) * rate
        print(f"[{i}/{len(years)}] {args.var} {year}"
              f"   (elapsed {elapsed/60:.1f}m, eta ~{remaining/60:.0f}m)")
        if fetch_year(args.var, year, args.out, args.attempts, args.backoff):
            done += 1
        else:
            failed.append(year)
            print(f"    GIVING UP on {year}; re-run to retry (resumable)")

    print(f"\ndownloaded={done} already_present={skipped} failed={len(failed)}")
    if failed:
        print("failed years:", failed)
        print("Re-run the same command to retry only the missing years.")
        return 1
    print(f"IMD {args.var} {args.start}-{args.end} complete in "
          f"{(time.time() - t_start)/60:.1f} minutes -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Stage bulk data acquisition onto an external drive and report the space math.

Context: the system SSD (C:) has ~23 GB free of 475 GB, which is not enough for
the IMD history + NCEP fill. The USB drive (D:, exFAT, ~185 GB free) is. exFAT
handles files >4 GB, so the large NetCDF outputs are fine there.

What stays on the external drive (bulk, never uploaded):
    imd_history/    IMD 0.25 deg grd files, ~25 MB/year
    ncep_wind/      NCEP/NCAR R1 pressure-level dailies, ~95-160 MB/file

What must still reach Kaggle (small, per region):
    normalized_<years>.nc   the only large upload; now zlib-compressed
    elevation.nc, lsm.nc, norm_params, sequence_manifest.json  (all tiny)

Measured compression on the real Western Ghats normalized file:
    207.0 MB -> 77.0 MB at zlib complevel=4 (2.69x, 9s, lossless)

Usage:
    python scripts/setup_external_data_root.py --root D:/vayu_data
    python scripts/setup_external_data_root.py --root D:/vayu_data --years 1951 2025
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

SUBDIRS = ("imd_history", "ncep_wind", "processed", "logs")

# Measured constants, not estimates.
IMD_MB_PER_YEAR = 25.4          # 365 * 129 * 135 * 4 bytes at 0.25 deg
NCEP_MB_PER_FILE = 135.0        # observed: uwnd 157 MB, shum 94 MB
NCEP_VARS = 3                   # uwnd, vwnd, shum
WG_NORM_MB_16Y = 207.0          # measured
WG_NORM_MB_16Y_ZLIB = 77.0      # measured at complevel=4
REGIONS = 4


def free_gb(path: Path) -> float:
    return shutil.disk_usage(path).free / 1e9


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, required=True,
                    help="External data root, e.g. D:/vayu_data")
    ap.add_argument("--years", nargs=2, type=int, default=[1901, 2025],
                    metavar=("START", "END"), help="IMD history range")
    ap.add_argument("--ncep-years", nargs=2, type=int, default=[2010, 2025],
                    metavar=("START", "END"))
    args = ap.parse_args()

    drive = Path(args.root.anchor or args.root)
    if not drive.exists():
        print(f"ERROR: drive {drive} is not reachable. Is the USB drive plugged in?")
        return 1

    n_years = args.years[1] - args.years[0] + 1
    n_ncep = (args.ncep_years[1] - args.ncep_years[0] + 1) * NCEP_VARS

    imd_gb = n_years * IMD_MB_PER_YEAR / 1000
    ncep_gb = n_ncep * NCEP_MB_PER_FILE / 1000
    scale = n_years / 16.0
    norm_raw_gb = WG_NORM_MB_16Y * scale * REGIONS / 1000
    norm_zlib_gb = WG_NORM_MB_16Y_ZLIB * scale * REGIONS / 1000
    total_gb = imd_gb + ncep_gb + norm_zlib_gb

    print(f"External root : {args.root}")
    print(f"Free on {drive} : {free_gb(drive):.1f} GB\n")

    print("Space required (measured rates, not guesses)")
    print(f"  IMD history {args.years[0]}-{args.years[1]} ({n_years} yr)"
          f"          {imd_gb:7.1f} GB   stays local")
    print(f"  NCEP {args.ncep_years[0]}-{args.ncep_years[1]}, {NCEP_VARS} vars"
          f" ({n_ncep} files)   {ncep_gb:7.1f} GB   stays local")
    print(f"  normalized x{REGIONS} regions, zlib          {norm_zlib_gb:7.1f} GB"
          f"   <- uploaded to Kaggle")
    print(f"  {'':46s}{'-' * 9}")
    print(f"  total                                     {total_gb:7.1f} GB")

    if free_gb(drive) < total_gb * 1.25:
        print(f"\nWARNING: only {free_gb(drive):.1f} GB free; want ~{total_gb * 1.25:.1f} GB "
              "for working headroom.")

    print(f"\nKaggle upload per region: {WG_NORM_MB_16Y_ZLIB * scale:.0f} MB compressed "
          f"(vs {WG_NORM_MB_16Y * scale:.0f} MB uncompressed)")
    if WG_NORM_MB_16Y_ZLIB * scale > 500:
        print("  NOTE: uploads have failed repeatedly on this connection at ~800 MB.")
        print(f"  A shorter history keeps this manageable, e.g. --years 1951 2025 "
              f"-> ~{WG_NORM_MB_16Y_ZLIB * (75 / 16):.0f} MB/region.")

    for sub in SUBDIRS:
        d = args.root / sub
        d.mkdir(parents=True, exist_ok=True)
        print(f"ready: {d}")

    print("\nNext:")
    print(f"  python scripts/download_imd_history.py --out {args.root / 'imd_history'} "
          f"--start {args.years[0]} --end {args.years[1]}")
    print(f"  python scripts/download_ncep_fill.py  --out {args.root / 'ncep_wind'} "
          f"--start {args.ncep_years[0]} --end {args.ncep_years[1]}")
    print("\nBoth are resumable; re-run the same command after any dropout.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

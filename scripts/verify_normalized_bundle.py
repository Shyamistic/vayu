#!/usr/bin/env python3
"""Verify a preprocessed `normalized_*.nc` bundle before training or upload.

Checks, in order of how expensive a mistake each one catches:

1. DAY COUNT and calendar continuity. A silently short record means the split
   years passed to the trainer quietly select fewer windows than intended.
2. GRID SHAPE and coordinate spacing. The full-India 0.5 deg run in particular
   depends on the coarsened IMD cell centres (6.625, 7.125, ...) lining up with
   the preprocess bounds; a mismatch produces an inner join that is empty or
   decimated rather than an error.
3. DEAD CHANNELS. A channel that is constant (usually all-zero) across the whole
   record contributes nothing but is indistinguishable from a working one in the
   training logs. Every dead channel in this project so far was a missing loader,
   not a real absence of signal.
4. NaN fraction and physical ranges per channel.
5. shum_850 vs next-day rainfall correlation, the one number that has tracked
   trainable rainfall signal across all four regions.

Usage:
    python scripts/verify_normalized_bundle.py D:\\vayu_data\\processed_full_india_05
    python scripts/verify_normalized_bundle.py <dir> --expect-days 16436 --expect-shape 64x67
"""

from __future__ import annotations

import argparse
import glob
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

#: Channels whose absence or deadness is a hard failure rather than a note.
#: These are the ones that were dead in earlier builds and were explicitly fixed.
CRITICAL_CHANNELS = (
    "rainfall", "tmax", "tmin",
    "uwnd_850", "vwnd_850", "shum_850",
    "insat_sst", "insat_lst",
)

#: The IMD target variables and CHIRPS are z-scored against norm_params_*.nc, so a
#: physical range check is meaningless for them; the reanalysis channels are merged
#: after normalization and stay in physical units. Mixing the two up is the reason
#: this script reported five false failures on its first run.
STANDARDIZED = ("rainfall", "tmax", "tmin", "chirps_rain")

#: Plausible physical ranges, applied only to the channels in physical units.
PLAUSIBLE = {
    "uwnd_850": (-100.0, 100.0),   # m/s
    "vwnd_850": (-100.0, 100.0),   # m/s
    "shum_850": (0.0, 0.05),       # kg/kg
    "insat_sst": (-5.0, 45.0),     # deg C (OISST substitute)
    "insat_lst": (-60.0, 70.0),    # deg C (ERA5-Land skt substitute)
}

#: A z-scored channel should have unit spread. Rainfall is heavily right-skewed so
#: its max z is legitimately large, but a near-zero-variance cell in norm_params
#: shows up as an absurd z rather than as a bad mean/std.
Z_MEAN_TOL = 0.15
Z_STD_RANGE = (0.75, 1.30)
Z_ABS_MAX = 60.0


def find_normalized(directory: Path) -> Path:
    matches = sorted(glob.glob(str(directory / "normalized_*.nc")))
    if not matches:
        raise SystemExit(f"FAIL: no normalized_*.nc in {directory}")
    if len(matches) > 1:
        print(f"note: {len(matches)} candidates, using {Path(matches[-1]).name}")
    return Path(matches[-1])


def check_time(ds: xr.Dataset, expect_days: int | None) -> list[str]:
    problems: list[str] = []
    time = pd.to_datetime(ds["time"].values)
    n = len(time)
    print(f"\nTIME: {n} steps, {time[0].date()} -> {time[-1].date()}")

    expected_span = (time[-1] - time[0]).days + 1
    if n != expected_span:
        problems.append(f"time has {n} steps but spans {expected_span} days — gaps present")
        gaps = pd.date_range(time[0], time[-1], freq="D").difference(time)
        print(f"  missing {len(gaps)} days, first few: {[str(d.date()) for d in gaps[:5]]}")
    else:
        print("  calendar continuous, no missing days")

    if expect_days is not None and n != expect_days:
        problems.append(f"expected {expect_days} days, found {n}")
    return problems


def check_grid(ds: xr.Dataset, expect_shape: str | None) -> list[str]:
    problems: list[str] = []
    lat = np.asarray(ds["lat"].values, dtype=float)
    lon = np.asarray(ds["lon"].values, dtype=float)
    shape = f"{lat.size}x{lon.size}"
    dlat = np.diff(lat)
    dlon = np.diff(lon)
    print(f"\nGRID: {shape} (lat x lon), {lat.size * lon.size} cells")
    print(f"  lat {lat[0]:.4f} -> {lat[-1]:.4f}, step {dlat.min():.4f}..{dlat.max():.4f}")
    print(f"  lon {lon[0]:.4f} -> {lon[-1]:.4f}, step {dlon.min():.4f}..{dlon.max():.4f}")

    if dlat.size and not np.allclose(dlat, dlat[0], atol=1e-6):
        problems.append("lat spacing is irregular")
    if dlon.size and not np.allclose(dlon, dlon[0], atol=1e-6):
        problems.append("lon spacing is irregular")
    if expect_shape and shape != expect_shape:
        problems.append(f"expected grid {expect_shape}, found {shape}")
    return problems


def check_channels(ds: xr.Dataset) -> tuple[list[str], dict[str, np.ndarray]]:
    problems: list[str] = []
    loaded: dict[str, np.ndarray] = {}
    channels = [v for v in ds.data_vars if "time" in ds[v].dims]

    print(f"\nCHANNELS: {len(channels)}")
    header = f"  {'name':<24}{'nan%':>8}{'min':>12}{'max':>12}{'mean':>12}{'std':>12}"
    print(header)
    print("  " + "-" * (len(header) - 2))

    for name in channels:
        arr = np.asarray(ds[name].values, dtype=np.float64)
        loaded[name] = arr
        finite = np.isfinite(arr)
        nan_pct = 100.0 * (1.0 - finite.mean())
        if not finite.any():
            print(f"  {name:<24}{nan_pct:>8.1f}{'ALL NaN':>12}")
            problems.append(f"{name} is entirely NaN")
            continue

        vals = arr[finite]
        vmin, vmax, vmean, vstd = vals.min(), vals.max(), vals.mean(), vals.std()
        print(f"  {name:<24}{nan_pct:>8.1f}{vmin:>12.4f}{vmax:>12.4f}{vmean:>12.4f}{vstd:>12.4f}")

        if vstd == 0.0:
            msg = f"{name} is constant at {vmin:g} — DEAD CHANNEL"
            problems.append(msg) if name in CRITICAL_CHANNELS else print(f"    note: {msg}")

        if name in STANDARDIZED:
            if abs(vmean) > Z_MEAN_TOL:
                problems.append(f"{name} is z-scored but mean is {vmean:+.3f} (expect ~0)")
            if not (Z_STD_RANGE[0] <= vstd <= Z_STD_RANGE[1]):
                problems.append(
                    f"{name} is z-scored but std is {vstd:.3f} "
                    f"(expect {Z_STD_RANGE[0]}..{Z_STD_RANGE[1]})"
                )
            if max(abs(vmin), abs(vmax)) > Z_ABS_MAX:
                problems.append(
                    f"{name} reaches |z|={max(abs(vmin), abs(vmax)):.0f} — likely a "
                    f"near-zero-variance cell in norm_params"
                )
        else:
            lo, hi = PLAUSIBLE.get(name, (None, None))
            if lo is not None and (vmin < lo or vmax > hi):
                problems.append(
                    f"{name} range [{vmin:g}, {vmax:g}] outside plausible [{lo:g}, {hi:g}]"
                )

    for required in CRITICAL_CHANNELS:
        if required not in loaded:
            problems.append(f"required channel '{required}' absent")
    return problems, loaded


def rain_correlations(loaded: dict[str, np.ndarray]) -> None:
    """Correlate each predictor at day t with rainfall at day t+1.

    Pooled over all cells and days, matching how the figure was reported for the
    four trained regions so the numbers are comparable.
    """
    rain = loaded.get("rainfall")
    if rain is None:
        return
    target = rain[1:].ravel()
    print("\nCORRELATION with next-day rainfall (pooled over cells and days):")
    rows: list[tuple[str, float, int]] = []
    for name, arr in loaded.items():
        if arr.shape != rain.shape:
            continue
        src = arr[:-1].ravel()
        mask = np.isfinite(src) & np.isfinite(target)
        n = int(mask.sum())
        if n < 1000 or src[mask].std() == 0 or target[mask].std() == 0:
            continue
        rows.append((name, float(np.corrcoef(src[mask], target[mask])[0, 1]), n))
    for name, r, n in sorted(rows, key=lambda t: -abs(t[1])):
        print(f"  {name:<24}{r:+.4f}   (n={n:,})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("directory", type=Path, help="processed_<region> directory")
    ap.add_argument("--expect-days", type=int, default=None)
    ap.add_argument("--expect-shape", default=None, help="e.g. 64x67 (lat x lon)")
    ap.add_argument("--skip-correlations", action="store_true",
                    help="skip the correlation pass (it loads every channel fully)")
    args = ap.parse_args()

    path = find_normalized(args.directory)
    size_mb = path.stat().st_size / 1e6
    print(f"FILE: {path}  ({size_mb:.1f} MB)")

    problems: list[str] = []
    with xr.open_dataset(path) as ds:
        problems += check_time(ds, args.expect_days)
        problems += check_grid(ds, args.expect_shape)
        channel_problems, loaded = check_channels(ds)
        problems += channel_problems
        if not args.skip_correlations:
            rain_correlations(loaded)

    # Companion files the training path and the Kaggle bundle both require.
    print("\nCOMPANION FILES:")
    stem = path.name.replace("normalized_", "").replace(".nc", "")
    for name in (f"norm_params_{stem}.nc", f"pipeline_log_{stem}.json"):
        companion = args.directory / name
        mark = "ok " if companion.exists() else "MISSING"
        print(f"  [{mark}] {name}")
        if not companion.exists():
            problems.append(f"companion file {name} missing")

    print("\n" + "=" * 70)
    if problems:
        print(f"FAIL: {len(problems)} problem(s)")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("PASS: day count, grid, channels, ranges and companion files all check out.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

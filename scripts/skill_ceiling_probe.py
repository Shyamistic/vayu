"""How much predictable signal exists per region? Establishes honest floors.

Because normalization is per-cell over the whole record (not per day-of-year),
the SEASONAL CYCLE remains inside the z-scored targets. A day-of-year
climatology fitted on training years alone is therefore a legitimate,
leakage-safe predictor — and it is the floor any competent model must beat.

Also reports the best fixed persistence/climatology blend per variable, which
is what PredictionHeads.BASELINE_INIT should be initialized to.

Usage:
    python scripts/skill_ceiling_probe.py                  # all regions
    python scripts/skill_ceiling_probe.py western_ghats    # one region
"""
from __future__ import annotations

import sys

import numpy as np
import xarray as xr

from ai_engine.windowed_dataset import build_dense_region_tensor, window_starts_for_years

IW, TW = 30, 7
VARS = {"rainfall": 0, "tmax": 1, "tmin": 2}
REGIONS = ["western_ghats", "north_east_india", "indo_gangetic_plain", "central_india"]
TRAIN_YEARS = (2010, 2021)
VAL_YEARS = (2022, 2022)


def paths(region: str) -> tuple[str, str, str]:
    return (
        f"data/processed_{region}_v2/normalized_2010-2025.nc",
        f"data/static_{region}/elevation.nc",
        f"data/static_{region}/lsm.nc",
    )


def r2(pred: np.ndarray, true: np.ndarray) -> float:
    m = ~np.isnan(pred) & ~np.isnan(true)
    p, t = pred[m], true[m]
    return float(1.0 - np.sum((t - p) ** 2) / (np.sum((t - t.mean()) ** 2) + 1e-10))


def smooth_circular(a: np.ndarray, window: int) -> np.ndarray:
    k = np.ones(window, dtype=np.float32) / window
    pad = window
    ext = np.concatenate([a[-pad:], a, a[:pad]], axis=0)
    flat = ext.reshape(ext.shape[0], -1)
    out = np.empty_like(flat)
    for j in range(flat.shape[1]):
        out[:, j] = np.convolve(flat[:, j], k, mode="same")
    return out.reshape(ext.shape)[pad:-pad]


def probe(region: str) -> None:
    norm, elev, lsm = paths(region)
    dense = build_dense_region_tensor(norm, elevation_file=elev, lsm_file=lsm)
    x = dense.x.numpy()
    years = xr.DataArray(dense.times).dt.year.values
    doy = xr.DataArray(dense.times).dt.dayofyear.values

    train_mask = (years >= TRAIN_YEARS[0]) & (years <= TRAIN_YEARS[1])
    va_starts = window_starts_for_years(dense, VAL_YEARS[0], VAL_YEARS[1], IW, TW, stride=1)

    print(f"\n{'=' * 78}")
    print(f"{region}   nodes={dense.num_nodes}  train_days={int(train_mask.sum())}  "
          f"val_windows={len(va_starts)}")
    print("=" * 78)
    print(f"{'variable':9s} {'const':>8s} {'persist':>9s} {'clim':>8s} "
          f"{'best blend':>11s} {'w_persist':>10s}")

    for vname, ch in VARS.items():
        series = x[:, :, ch]

        clim = np.zeros((366, series.shape[0]), dtype=np.float32)
        for d in range(1, 367):
            sel = train_mask & (doy == d)
            if sel.any():
                clim[d - 1] = np.nanmean(series[:, sel], axis=1)
        clim = smooth_circular(clim, 15)

        cp, tp, pp = [], [], []
        for s in va_starts:
            t_idx = np.arange(s + IW, s + IW + TW)
            cp.append(clim[doy[t_idx] - 1].T)
            tp.append(series[:, t_idx])
            pp.append(np.repeat(series[:, s + IW - 1:s + IW], TW, axis=1))
        cp = np.concatenate(cp, 1)
        tp = np.concatenate(tp, 1)
        pp = np.concatenate(pp, 1)

        # Scan blend weights to find the best fixed combination
        best_w, best_r2 = 0.0, -9.9
        for w in np.arange(0.0, 1.01, 0.05):
            score = r2(w * pp + (1.0 - w) * cp, tp)
            if score > best_r2:
                best_r2, best_w = score, float(w)

        print(f"{vname:9s} {r2(np.zeros_like(tp), tp):>+8.3f} {r2(pp, tp):>+9.3f} "
              f"{r2(cp, tp):>+8.3f} {best_r2:>+11.3f} {best_w:>10.2f}")


def main() -> None:
    targets = sys.argv[1:] or REGIONS
    for region in targets:
        probe(region)
    print("\nw_persist = weight on persistence in the best fixed blend")
    print("(remainder goes to day-of-year climatology)")


if __name__ == "__main__":
    main()

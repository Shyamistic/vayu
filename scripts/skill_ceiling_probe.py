"""How much predictable signal exists? Establishes honest skill floors/ceilings.

Because normalization is per-cell over the whole record (not per day-of-year),
the SEASONAL CYCLE remains inside the z-scored targets. A day-of-year
climatology fitted on training years alone is therefore a legitimate,
leakage-safe predictor — and it is the floor any competent model must beat.

Reported on the 2022 validation split for each target variable.
"""
from __future__ import annotations

import numpy as np
import xarray as xr

from ai_engine.windowed_dataset import build_dense_region_tensor, window_starts_for_years

NORM = "data/processed_western_ghats_v2/normalized_2010-2025.nc"
ELEV = "data/static_western_ghats/elevation.nc"
LSM = "data/static_western_ghats/lsm.nc"
IW, TW = 30, 7
VARS = {"rainfall": 0, "tmax": 1, "tmin": 2}


def r2(pred: np.ndarray, true: np.ndarray) -> float:
    m = ~np.isnan(pred) & ~np.isnan(true)
    p, t = pred[m], true[m]
    return float(1.0 - np.sum((t - p) ** 2) / (np.sum((t - t.mean()) ** 2) + 1e-10))


def smooth_circular(a: np.ndarray, window: int) -> np.ndarray:
    """Circular moving average along axis 0 (day-of-year)."""
    k = np.ones(window) / window
    pad = window
    ext = np.concatenate([a[-pad:], a, a[:pad]], axis=0)
    out = np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 0, ext)
    return out[pad:-pad]


def main() -> None:
    dense = build_dense_region_tensor(NORM, elevation_file=ELEV, lsm_file=LSM)
    x = dense.x.numpy()                       # (N, T, F)
    times = dense.times
    years = xr.DataArray(times).dt.year.values
    doy = xr.DataArray(times).dt.dayofyear.values

    train_mask = (years >= 2010) & (years <= 2021)
    va_starts = window_starts_for_years(dense, 2022, 2022, IW, TW, stride=1)
    print(f"train days={train_mask.sum()}  val windows={len(va_starts)}\n")

    for vname, ch in VARS.items():
        series = x[:, :, ch]                  # (N, T)

        # ── Leakage-safe day-of-year climatology fitted on TRAIN years only ──
        clim = np.zeros((366, series.shape[0]), dtype=np.float32)
        for d in range(1, 367):
            sel = train_mask & (doy == d)
            if sel.any():
                clim[d - 1] = np.nanmean(series[:, sel], axis=1)
        clim = smooth_circular(clim, 15)      # 15-day smoothing

        # Evaluate on the 2022 validation windows
        preds, trues, persist = [], [], []
        for s in va_starts:
            t_idx = np.arange(s + IW, s + IW + TW)
            preds.append(clim[doy[t_idx] - 1].T)      # (N, TW)
            trues.append(series[:, t_idx])
            persist.append(np.repeat(series[:, s + IW - 1:s + IW], TW, axis=1))
        preds = np.concatenate(preds, 1)
        trues = np.concatenate(trues, 1)
        persist = np.concatenate(persist, 1)

        print(f"=== {vname} (2022 validation, normalized space) ===")
        print(f"  R2 constant-zero            : {r2(np.zeros_like(trues), trues):+.4f}")
        print(f"  R2 persistence              : {r2(persist, trues):+.4f}")
        print(f"  R2 day-of-year climatology  : {r2(preds, trues):+.4f}   <-- leakage-safe floor")
        best = np.maximum(persist, 0) if vname == "rainfall" else persist
        combo = 0.5 * preds + 0.5 * persist
        print(f"  R2 0.5*climatology+0.5*persist: {r2(combo, trues):+.4f}")
        print()


if __name__ == "__main__":
    main()

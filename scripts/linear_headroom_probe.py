"""How much skill is reachable ABOVE the persistence/climatology blend?

scripts/skill_ceiling_probe.py measures the FLOOR: the best fixed blend of
persistence and day-of-year climatology. That floor already meets this
project's stated targets in most regions, so hitting R2_rain=0.20 proves
nothing on its own -- the model has to beat the blend.

This script measures a defensible estimate of the HEADROOM above that floor by
fitting a plain ridge regression from the now-populated input channels to
next-day target, using train years only. It is deliberately the simplest
possible learner:

  * if ridge already beats the blend, real signal exists in the channels and
    the GNN+transformer has something to find;
  * if ridge cannot beat the blend, no amount of architecture work on these
    inputs will produce a large rainfall gain, and the honest move is to say
    so rather than train repeatedly and blame tuning.

Normal equations are accumulated day-by-day so memory stays flat regardless of
region size (IGP is 2205 nodes x 16436 days x 17 channels ~ 2.5 GB dense).

Lead-1 only: it is the headline number and the one the literature reports
most often (e.g. Narula et al., arXiv:2402.07851, report 1-day and 3-day).

Usage:
    python scripts/linear_headroom_probe.py
    python scripts/linear_headroom_probe.py --regions western_ghats
"""
from __future__ import annotations

import argparse
import glob as _glob
import json
from pathlib import Path

import numpy as np
import xarray as xr

from ai_engine.windowed_dataset import build_dense_region_tensor

REGIONS = ["western_ghats", "north_east_india", "indo_gangetic_plain", "central_india"]
PROCESSED = "D:/vayu_data/processed_{region}_1981"
STATIC = "D:/static_{region}"
TRAIN_YEARS = (1981, 2021)
VAL_YEARS = (2022, 2022)

# Target channel indices in BASE_FEATURE_NAMES order.
TARGETS = {"rainfall": 0, "tmax": 1, "tmin": 2}
# Predictor channels fed to the ridge, by name.
PREDICTORS = [
    "rainfall", "tmax", "tmin", "insat_lst", "insat_sst",
    "uwnd_850", "vwnd_850", "shum_850", "chirps_rain",
]
RIDGE_LAMBDA = 1.0


def smooth_circular(a: np.ndarray, window: int) -> np.ndarray:
    k = np.ones(window, dtype=np.float32) / window
    pad = window
    ext = np.concatenate([a[-pad:], a, a[:pad]], axis=0)
    flat = ext.reshape(ext.shape[0], -1)
    out = np.empty_like(flat)
    for j in range(flat.shape[1]):
        out[:, j] = np.convolve(flat[:, j], k, mode="same")
    return out.reshape(ext.shape)[pad:-pad]


def r2(pred: np.ndarray, true: np.ndarray) -> float:
    m = np.isfinite(pred) & np.isfinite(true)
    p, t = pred[m], true[m]
    return float(1.0 - np.sum((t - p) ** 2) / (np.sum((t - t.mean()) ** 2) + 1e-10))


def probe(region: str, processed_template: str = PROCESSED,
          static_template: str = STATIC) -> dict:
    # Templates are overridable because not every bundle follows
    # processed_<region>_1981 / static_<region>: full_india is a 0.5 deg product in
    # processed_full_india_05 with its own static rasters on that grid.
    matches = sorted(_glob.glob(f"{processed_template.format(region=region)}/normalized_*.nc"))
    if not matches:
        raise FileNotFoundError(
            f"No normalized_*.nc in {processed_template.format(region=region)}"
        )
    proc = matches[-1]
    static = static_template.format(region=region)
    dense = build_dense_region_tensor(
        proc, elevation_file=f"{static}/elevation.nc", lsm_file=f"{static}/lsm.nc"
    )
    x = dense.x.numpy()                       # (N, T, F)
    names = dense.feature_names
    years = xr.DataArray(dense.times).dt.year.values
    doy = xr.DataArray(dense.times).dt.dayofyear.values

    pred_idx = [names.index(p) for p in PREDICTORS]
    train_mask = (years >= TRAIN_YEARS[0]) & (years <= TRAIN_YEARS[1])
    val_mask = (years >= VAL_YEARS[0]) & (years <= VAL_YEARS[1])

    print(f"\n{'=' * 84}")
    print(f"{region}   nodes={x.shape[0]}  train_days={int(train_mask.sum())}  "
          f"val_days={int(val_mask.sum())}")
    print("=" * 84)
    print(f"{'variable':9s} {'blend':>8s} {'ridge':>8s} {'gain':>8s}   verdict")

    out: dict[str, dict] = {}

    for vname, tgt_ch in TARGETS.items():
        series = x[:, :, tgt_ch]

        # Day-of-year climatology, TRAIN YEARS ONLY (leakage-safe).
        clim = np.zeros((366, series.shape[0]), dtype=np.float32)
        for d in range(1, 367):
            sel = train_mask & (doy == d)
            if sel.any():
                clim[d - 1] = np.nanmean(series[:, sel], axis=1)
        clim = smooth_circular(clim, 15)

        # Feature matrix per day t predicts target at t+1.
        # cols: predictors at t, climatology at t+1, bias
        n_feat = len(pred_idx) + 2

        def build_day(t: int) -> tuple[np.ndarray, np.ndarray]:
            f = np.empty((series.shape[0], n_feat), dtype=np.float64)
            f[:, :len(pred_idx)] = x[:, t, pred_idx]
            f[:, len(pred_idx)] = clim[doy[t + 1] - 1]
            f[:, -1] = 1.0
            return f, series[:, t + 1].astype(np.float64)

        # Accumulate normal equations over train days.
        xtx = np.zeros((n_feat, n_feat), dtype=np.float64)
        xty = np.zeros(n_feat, dtype=np.float64)
        train_days = np.where(train_mask)[0]
        train_days = train_days[train_days < len(doy) - 1]
        for t in train_days:
            f, y = build_day(int(t))
            good = np.isfinite(y) & np.isfinite(f).all(axis=1)
            if not good.any():
                continue
            fg, yg = f[good], y[good]
            xtx += fg.T @ fg
            xty += fg.T @ yg

        reg = RIDGE_LAMBDA * np.eye(n_feat)
        reg[-1, -1] = 0.0  # never penalise the bias
        beta = np.linalg.solve(xtx + reg, xty)

        # Evaluate on val year: ridge vs the best fixed blend.
        val_days = np.where(val_mask)[0]
        val_days = val_days[val_days < len(doy) - 1]
        rp, cp, pp, tt = [], [], [], []
        for t in val_days:
            f, y = build_day(int(t))
            rp.append(f @ beta)
            cp.append(clim[doy[t + 1] - 1])
            pp.append(series[:, t])
            tt.append(y)
        rp = np.concatenate(rp); cp = np.concatenate(cp)
        pp = np.concatenate(pp); tt = np.concatenate(tt)

        best_blend, best_w = -9.9, 0.0
        for w in np.arange(0.0, 1.01, 0.05):
            s = r2(w * pp + (1.0 - w) * cp, tt)
            if s > best_blend:
                best_blend, best_w = s, float(w)

        r2_ridge = r2(rp, tt)
        gain = r2_ridge - best_blend
        verdict = "headroom" if gain > 0.01 else ("marginal" if gain > 0 else "NO GAIN")
        print(f"{vname:9s} {best_blend:>+8.3f} {r2_ridge:>+8.3f} {gain:>+8.3f}   {verdict}")

        out[vname] = {
            "best_blend": best_blend,
            "blend_w_persist": best_w,
            "ridge": r2_ridge,
            "gain_over_blend": gain,
            "coefficients": {
                name: float(beta[i]) for i, name in enumerate(PREDICTORS)
            } | {"climatology": float(beta[len(pred_idx)]), "bias": float(beta[-1])},
        }

    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", nargs="*", default=REGIONS)
    ap.add_argument("--processed-template", default=PROCESSED)
    ap.add_argument("--static-template", default=STATIC)
    ap.add_argument("--json-out", default=None)
    args = ap.parse_args()

    results = {
        r: probe(r, processed_template=args.processed_template,
                 static_template=args.static_template)
        for r in args.regions
    }

    print("\nridge = plain linear model on the 9 populated input channels + "
          "day-of-year climatology")
    print("gain  = ridge R2 minus the best fixed persistence/climatology blend")
    print("A positive gain means real signal exists beyond the blend that a "
          "stronger model can exploit.")

    if args.json_out:
        Path(args.json_out).write_text(
            json.dumps({"train_years": list(TRAIN_YEARS),
                        "val_years": list(VAL_YEARS),
                        "regions": results}, indent=2),
            encoding="utf-8",
        )
        print(f"\nSaved: {args.json_out}")


if __name__ == "__main__":
    main()

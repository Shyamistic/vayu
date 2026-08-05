"""How much predictable signal exists per region? Establishes honest floors.

Because normalization is per-cell over the whole record (not per day-of-year),
the SEASONAL CYCLE remains inside the z-scored targets. A day-of-year
climatology fitted on training years alone is therefore a legitimate,
leakage-safe predictor — and it is the floor any competent model must beat.

Also reports the best fixed persistence/climatology blend per variable, which
is what PredictionHeads.BASELINE_INIT should be initialized to.

Usage:
    # 1981-2025 rebuild on the external drive (current default)
    python scripts/skill_ceiling_probe.py
    python scripts/skill_ceiling_probe.py --regions western_ghats

    # the older 2010-2025 repo-local bundles, for before/after comparison
    python scripts/skill_ceiling_probe.py \
        --processed-template "data/processed_{region}_v2" \
        --static-template   "data/static_{region}" \
        --train-years 2010 2021 --val-years 2022 2022
"""
from __future__ import annotations

import argparse
import glob as _glob
import sys

import numpy as np
import xarray as xr

from ai_engine.windowed_dataset import build_dense_region_tensor, window_starts_for_years

IW, TW = 30, 7
VARS = {"rainfall": 0, "tmax": 1, "tmin": 2}
REGIONS = ["western_ghats", "north_east_india", "indo_gangetic_plain", "central_india"]

# Defaults target the 1981-2025 rebuild. Every auxiliary channel is populated
# there (insat_lst/insat_sst/uwnd/vwnd/shum were dead or partly dead in the
# 2010-2025 bundles), so the ceilings measured here are the ones that matter
# for the next training run.
DEFAULT_PROCESSED = "D:/vayu_data/processed_{region}_1981"
DEFAULT_STATIC = "D:/static_{region}"
DEFAULT_TRAIN_YEARS = (1981, 2021)
DEFAULT_VAL_YEARS = (2022, 2022)


def paths(region: str, processed_template: str, static_template: str) -> tuple[str, str, str]:
    """Locate the normalized file without hardcoding its year range.

    The filename encodes preprocess --start-year/--end-year, so this globs
    rather than assuming normalized_2010-2025.nc.
    """
    proc_dir = processed_template.format(region=region)
    matches = sorted(_glob.glob(f"{proc_dir}/normalized_*.nc"))
    if not matches:
        raise FileNotFoundError(f"No normalized_*.nc in {proc_dir}")
    static_dir = static_template.format(region=region)
    return matches[-1], f"{static_dir}/elevation.nc", f"{static_dir}/lsm.nc"


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


def probe(
    region: str,
    processed_template: str = DEFAULT_PROCESSED,
    static_template: str = DEFAULT_STATIC,
    train_years: tuple[int, int] = DEFAULT_TRAIN_YEARS,
    val_years: tuple[int, int] = DEFAULT_VAL_YEARS,
) -> dict[str, dict[str, float]]:
    norm, elev, lsm = paths(region, processed_template, static_template)
    dense = build_dense_region_tensor(norm, elevation_file=elev, lsm_file=lsm)
    x = dense.x.numpy()
    years = xr.DataArray(dense.times).dt.year.values
    doy = xr.DataArray(dense.times).dt.dayofyear.values

    train_mask = (years >= train_years[0]) & (years <= train_years[1])
    va_starts = window_starts_for_years(dense, val_years[0], val_years[1], IW, TW, stride=1)
    results: dict[str, dict[str, float]] = {}

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

        r2_const = r2(np.zeros_like(tp), tp)
        r2_persist = r2(pp, tp)
        r2_clim = r2(cp, tp)
        print(f"{vname:9s} {r2_const:>+8.3f} {r2_persist:>+9.3f} "
              f"{r2_clim:>+8.3f} {best_r2:>+11.3f} {best_w:>10.2f}")
        results[vname] = {
            "const": r2_const,
            "persistence": r2_persist,
            "climatology": r2_clim,
            "best_blend": best_r2,
            "w_persist": best_w,
        }

    return results


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", nargs="*", default=REGIONS)
    ap.add_argument("--processed-template", default=DEFAULT_PROCESSED)
    ap.add_argument("--static-template", default=DEFAULT_STATIC)
    ap.add_argument("--train-years", nargs=2, type=int, default=list(DEFAULT_TRAIN_YEARS))
    ap.add_argument("--val-years", nargs=2, type=int, default=list(DEFAULT_VAL_YEARS))
    ap.add_argument("--json-out", default=None,
                    help="Write the measured ceilings to this JSON path")
    args = ap.parse_args()

    all_results: dict[str, dict] = {}
    for region in args.regions:
        all_results[region] = probe(
            region,
            processed_template=args.processed_template,
            static_template=args.static_template,
            train_years=tuple(args.train_years),
            val_years=tuple(args.val_years),
        )

    print("\nw_persist = weight on persistence in the best fixed blend")
    print("(remainder goes to day-of-year climatology)")

    if args.json_out:
        import json
        from pathlib import Path
        payload = {
            "train_years": list(args.train_years),
            "val_years": list(args.val_years),
            "processed_template": args.processed_template,
            "regions": all_results,
        }
        Path(args.json_out).write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"\nSaved: {args.json_out}")


if __name__ == "__main__":
    main()

"""Verify the climatology-anchored heads start at climatology-level skill.

Two parts:
  1. WIRING (2 windows, tiny model): confirm the untrained model's output equals
     the baseline blend exactly, i.e. clim_future really reaches the heads.
  2. SKILL (all val windows, no model): the delta is zero-initialized, so the
     model's output IS the baseline blend. Evaluating the blend arithmetically
     gives the exact R² training now starts from, without paying for hundreds
     of CPU forward passes.
"""
from __future__ import annotations

import numpy as np
import torch

from ai_engine.config import ModelConfig
from ai_engine.climate_model import VayuClimateModel
from ai_engine.prediction_heads import PredictionHeads
from ai_engine.windowed_dataset import build_windowed_splits

NORM = "data/processed_western_ghats_v2/normalized_2010-2025.nc"
ELEV = "data/static_western_ghats/elevation.nc"
LSM = "data/static_western_ghats/lsm.nc"
VARS = ["rainfall", "temp_max", "temp_min"]


def r2(pred: np.ndarray, true: np.ndarray) -> float:
    m = ~np.isnan(pred) & ~np.isnan(true)
    p, t = pred[m], true[m]
    return float(1.0 - np.sum((t - p) ** 2) / (np.sum((t - t.mean()) ** 2) + 1e-10))


def main() -> None:
    _, val, _, dense = build_windowed_splits(
        NORM, elevation_file=ELEV, lsm_file=LSM, eval_stride=1
    )
    print(f"val windows: {len(val)}")

    g0, y0 = val[0]
    assert getattr(g0, "clim_future", None) is not None, "clim_future missing"
    print(f"clim_future shape: {tuple(g0.clim_future.shape)} (nodes, horizon, vars)")
    for var in VARS:
        p, c = PredictionHeads.BASELINE_INIT[var]
        print(f"  {var:9s} init w_persistence={p:.2f} w_climatology={c:.2f}")

    # ── Part 1: wiring check on a small model, 2 windows ──────────────────────
    cfg = ModelConfig(
        gnn_in_features=dense.x.shape[-1],
        gnn_hidden_dim=32, gnn_num_layers=1,
        transformer_d_model=32, transformer_nhead=2,
        transformer_num_layers=1, transformer_dim_feedforward=64,
    )
    model = VayuClimateModel(cfg)
    model.eval()
    print("\n=== wiring check (untrained: output must equal baseline blend) ===")
    with torch.no_grad():
        for i in (0, len(val) // 2):
            g, y = val[i]
            out = model(g)
            for vi, var in enumerate(VARS):
                wp = model.heads.heads[var].w_persistence.item()
                wc = model.heads.heads[var].w_climatology.item()
                persistence = g.x[:, -1, vi:vi + 1].expand(-1, y.shape[0])
                expected = wp * persistence + wc * g.clim_future[..., vi]
                ok = torch.allclose(out[var], expected, atol=1e-5)
                if i == 0:
                    print(f"  window {i} {var:9s}: output == baseline blend -> {ok}")
                assert ok, f"{var} baseline not wired through"
    print("  all variables verified on 2 windows")

    # ── Part 2: exact starting skill of the blend over the full val split ─────
    preds = {v: [] for v in VARS}
    trues = {v: [] for v in VARS}
    persist = {v: [] for v in VARS}
    clim = {v: [] for v in VARS}
    for i in range(len(val)):
        g, y = val[i]
        for vi, var in enumerate(VARS):
            wp, wc = PredictionHeads.BASELINE_INIT[var]
            last = g.x[:, -1, vi:vi + 1].numpy()
            pe = np.repeat(last, y.shape[0], axis=1)
            cf = g.clim_future[..., vi].numpy()
            preds[var].append(wp * pe + wc * cf)
            persist[var].append(pe)
            clim[var].append(cf)
            trues[var].append(y[..., vi].numpy().T)

    print("\n=== starting skill at step 0 (2022 validation, 365 windows) ===")
    print(f"{'variable':10s} {'OLD start':>11s} {'NEW start':>11s} {'climatology':>12s}")
    for var in VARS:
        t = np.concatenate(trues[var], 1)
        print(f"{var:10s} "
              f"{r2(np.concatenate(persist[var], 1), t):>+11.4f} "
              f"{r2(np.concatenate(preds[var], 1), t):>+11.4f} "
              f"{r2(np.concatenate(clim[var], 1), t):>+12.4f}")
    print("\nOLD start = pure persistence skip (what v2 shipped)")
    print("NEW start = learned blend, initialized per PredictionHeads.BASELINE_INIT")


if __name__ == "__main__":
    main()

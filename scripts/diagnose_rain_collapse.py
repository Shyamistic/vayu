"""Diagnostic: quantify why R2_rain collapses to ~0 and R2_tmax plateaus at ~0.75.

Loads real validation sequences and evaluates trivial predictors to establish
the achievable ceiling under the current target representation.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch


def r2(pred: np.ndarray, true: np.ndarray) -> float:
    m = ~np.isnan(pred) & ~np.isnan(true)
    p, t = pred[m], true[m]
    return float(1.0 - np.sum((t - p) ** 2) / (np.sum((t - t.mean()) ** 2) + 1e-10))


def main(seq_path: str) -> None:
    seqs = torch.load(seq_path, map_location="cpu", weights_only=False)
    print(f"loaded {len(seqs)} sequences from {seq_path}")

    # graph.x: (nodes, seq_len, features); target: (horizon, nodes, 3)
    x_last, y = [], []
    for g, t in seqs:
        x_last.append(g.x[:, -1, :3].numpy())          # last-day rain/tmax/tmin
        y.append(t.numpy().transpose(1, 0, 2))          # (nodes, horizon, 3)
    x_last = np.stack(x_last)                           # (S, N, 3)
    y = np.stack(y)                                     # (S, N, H, 3)
    H = y.shape[2]
    print(f"shapes: x_last={x_last.shape} y={y.shape}")

    names = ["rainfall", "temp_max", "temp_min"]
    for vi, vname in enumerate(names):
        t = y[..., vi]                                  # (S, N, H)
        persist = np.repeat(x_last[:, :, None, vi], H, axis=2)

        print(f"\n=== {vname} (normalized z-score space) ===")
        print(f"  target  min={np.nanmin(t):+.3f} max={np.nanmax(t):+.3f} "
              f"mean={np.nanmean(t):+.3f} std={np.nanstd(t):.3f}")
        frac_neg = float(np.nanmean(t < 0))
        print(f"  fraction of targets < 0 : {frac_neg:.1%}")
        print(f"  fraction of targets < -0.1 : {float(np.nanmean(t < -0.1)):.1%}")

        # Trivial predictors
        print(f"  R2 constant-zero (= dataset mean) : {r2(np.zeros_like(t), t):+.4f}")
        print(f"  R2 persistence                    : {r2(persist, t):+.4f}")
        print(f"  R2 relu(persistence)              : {r2(np.maximum(persist, 0), t):+.4f}")

        # Per-node optimal constant (climatology of this split)
        node_mean = np.nanmean(t, axis=(0, 2), keepdims=True)
        print(f"  R2 per-node mean                  : "
              f"{r2(np.broadcast_to(node_mean, t.shape), t):+.4f}")

        if vname == "rainfall":
            # Ceiling for any predictor forced non-negative: best is clamp at 0
            best_nonneg = np.maximum(t, 0.0)  # oracle, but clamped like ReLU output
            print(f"  R2 ORACLE clamped to >=0 (ReLU ceiling): {r2(best_nonneg, t):+.4f}")
            print("    ^ even a PERFECT model whose output passes through ReLU")
            print("      cannot exceed this, because dry days need negative z-scores.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else
         "data/processed_western_ghats_v2/val_sequences.pt")

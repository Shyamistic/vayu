"""A/B test the two v3 rainfall changes on real Western Ghats data.

Isolates the output head so this runs in seconds on CPU instead of hours:
inputs are the last observed day plus the input-window mean (the same
information the persistence-residual head receives), targets are the real
7-day rainfall z-scores.

Variant A (v2, as shipped): ReLU on the rainfall output + weighted MAE
                            ("CRPS") with heavy_threshold=20 on z-scores.
Variant B (v3, this change): no ReLU + weighted MSE with heavy_threshold=2.

Both variants use identical architecture, seed, optimizer and step count, so
the only difference is the output constraint and the loss.
"""
from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn

from ai_engine.windowed_dataset import build_dense_region_tensor, window_starts_for_years

NORM = "data/processed_western_ghats_v2/normalized_2010-2025.nc"
ELEV = "data/static_western_ghats/elevation.nc"
LSM = "data/static_western_ghats/lsm.nc"
IW, TW = 30, 7


def r2(pred: np.ndarray, true: np.ndarray) -> float:
    m = ~np.isnan(pred) & ~np.isnan(true)
    p, t = pred[m], true[m]
    return float(1.0 - np.sum((t - p) ** 2) / (np.sum((t - t.mean()) ** 2) + 1e-10))


def make_xy(dense, starts):
    """X = [last-day features, window-mean features]; Y = 7-day rainfall targets."""
    xs, ys = [], []
    for s in starts:
        win = dense.x[:, s : s + IW, :]                       # (N, IW, F)
        feat = torch.cat([win[:, -1, :], win.mean(dim=1)], dim=-1)   # (N, 2F)
        tgt = dense.x[:, s + IW : s + IW + TW, 0]             # (N, TW) rainfall
        xs.append(feat)
        ys.append(tgt)
    return torch.cat(xs, 0), torch.cat(ys, 0)


class Head(nn.Module):
    def __init__(self, in_dim: int, hidden: int = 128, horizon: int = TW):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden), nn.GELU(),
            nn.Linear(hidden, hidden), nn.GELU(),
            nn.Linear(hidden, horizon),
        )
        nn.init.zeros_(self.net[-1].weight)
        nn.init.zeros_(self.net[-1].bias)

    def forward(self, x, last_rain):
        # persistence-residual, exactly like SingleVariableHead
        return last_rain.unsqueeze(-1) + self.net(x)


def weighted_mae(p, y, alpha=3.0, thr=20.0):
    w = 1.0 + alpha * torch.clamp(y / thr, 0, 1).pow(2)
    return (w * (p - y).abs()).mean()


def weighted_mse(p, y, alpha=3.0, thr=2.0):
    w = 1.0 + alpha * torch.clamp(y / thr, 0, 1).pow(2)
    return (w * (p - y) ** 2).mean()


def run(variant: str, xtr, ytr, xva, yva, ltr, lva, steps=400, seed=0):
    torch.manual_seed(seed)
    model = Head(xtr.shape[-1])
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    n = xtr.shape[0]
    bs = 8192
    for i in range(steps):
        idx = torch.randint(0, n, (bs,))
        p = model(xtr[idx], ltr[idx])
        if variant == "A":
            p = torch.relu(p)                     # v2 clamp
            loss = weighted_mae(p, ytr[idx])      # v2 objective
        else:
            loss = weighted_mse(p, ytr[idx])      # v3 objective, no clamp
        opt.zero_grad()
        loss.backward()
        opt.step()

    model.eval()
    with torch.no_grad():
        pv = model(xva, lva)
        if variant == "A":
            pv = torch.relu(pv)
    return r2(pv.numpy(), yva.numpy()), pv


def main() -> None:
    dense = build_dense_region_tensor(NORM, elevation_file=ELEV, lsm_file=LSM)
    tr_starts = window_starts_for_years(dense, 2010, 2021, IW, TW, stride=6)
    va_starts = window_starts_for_years(dense, 2022, 2022, IW, TW, stride=3)
    print(f"windows: train={len(tr_starts)} val={len(va_starts)}")

    xtr, ytr = make_xy(dense, tr_starts)
    xva, yva = make_xy(dense, va_starts)
    ltr, lva = xtr[:, 0], xva[:, 0]   # last-day rainfall = channel 0 of last day
    print(f"rows: train={xtr.shape[0]:,} val={xva.shape[0]:,} feat={xtr.shape[1]}")

    print("\n--- reference points on the validation split ---")
    print(f"R2 constant-zero (dataset mean) : {r2(np.zeros_like(yva.numpy()), yva.numpy()):+.4f}")
    print(f"R2 persistence                  : "
          f"{r2(np.repeat(lva.numpy()[:, None], TW, 1), yva.numpy()):+.4f}")

    r2a, pa = run("A", xtr, ytr, xva, yva, ltr, lva)
    r2b, pb = run("B", xtr, ytr, xva, yva, ltr, lva)

    print("\n--- ablation (identical net/seed/steps, only clamp+loss differ) ---")
    print(f"A  v2: ReLU + weighted MAE(thr=20)  ->  R2_rain = {r2a:+.4f}")
    print(f"B  v3: no ReLU + weighted MSE(thr=2) -> R2_rain = {r2b:+.4f}")

    print("\n--- prediction spread (why A collapses) ---")
    for lbl, p in (("A", pa), ("B", pb)):
        pn = p.numpy()
        print(f"  {lbl}: std={pn.std():.4f} min={pn.min():+.4f} "
              f"max={pn.max():+.4f} frac_exactly_0={float((pn == 0).mean()):.1%}")
    tn = yva.numpy()
    print(f"  target: std={tn.std():.4f} min={tn.min():+.4f} max={tn.max():+.4f}")


if __name__ == "__main__":
    main()

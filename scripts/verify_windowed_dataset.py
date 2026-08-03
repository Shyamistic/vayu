"""Verify the lazy windowed dataset matches pre-built sequences and unlocks more windows."""
from __future__ import annotations

import torch

from ai_engine.windowed_dataset import build_windowed_splits

NORM = "data/processed_western_ghats_v2/normalized_2010-2025.nc"
ELEV = "data/static_western_ghats/elevation.nc"
LSM = "data/static_western_ghats/lsm.nc"


def main() -> None:
    train, val, test, dense = build_windowed_splits(
        NORM, elevation_file=ELEV, lsm_file=LSM, train_stride=1, eval_stride=1
    )
    print(f"feature_names ({len(dense.feature_names)}): {dense.feature_names}")
    print(f"windows: train={len(train)} val={len(val)} test={len(test)}")
    print("pre-built for comparison: train=512 val=120 test=128")

    g, y = train[0]
    print(f"\nsample shapes: x={tuple(g.x.shape)} target={tuple(y.shape)}")
    print(f"edge_index={tuple(g.edge_index.shape)} pos={tuple(g.pos.shape)}")

    # Cross-check against a pre-built sequence: stride-3 window k of the
    # pre-built train set must equal a lazily sliced window.
    prebuilt = torch.load(
        "data/processed_western_ghats_v2/train_sequences.pt",
        map_location="cpu", weights_only=False,
    )
    pg, py = prebuilt[0]
    # Find the lazy window whose input matches pre-built window 0
    match = None
    for i in range(min(40, len(train))):
        gi, yi = train[i]
        if torch.allclose(gi.x, pg.x, atol=1e-6, equal_nan=True):
            match = i
            break
    if match is None:
        print("\nNO exact match found in first 40 lazy windows")
    else:
        gi, yi = train[match]
        print(f"\npre-built train[0] == lazy train[{match}]")
        print(f"  inputs identical : {torch.allclose(gi.x, pg.x, atol=1e-6, equal_nan=True)}")
        print(f"  targets identical: {torch.allclose(yi, py, atol=1e-6, equal_nan=True)}")

    mb = dense.x.numel() * dense.x.element_size() / 1e6
    print(f"\ndense tensor memory: {mb:.0f} MB (vs ~11,600 MB to materialize all windows)")


if __name__ == "__main__":
    main()

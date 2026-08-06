"""End-to-end smoke test: evaluate_test_set() populates the new verification
fields (per-lead, JJAS, accumulation, categorical) on real WG test data.

Uses an untrained model — the point is to verify plumbing (shapes, no crashes,
JSON-serializable output), not to draw any conclusion about model skill from
this run. See scripts/rescale_kaggle_checkpoint.py or the Kaggle notebook for
scoring an actual trained checkpoint.
"""
from __future__ import annotations

import json

import torch

from ai_engine.config import ModelConfig
from ai_engine.climate_model import VayuClimateModel
from ai_engine.loss_functions import PhysicsInformedLoss
from ai_engine.trainer import VayuTrainer, _load_norm_params_file
from ai_engine.windowed_dataset import build_windowed_splits

REGION = "western_ghats"
DATA_DIR = f"data/processed_{REGION}_v2"


def main() -> None:
    # Pre-built test_sequences.pt predates target_doy (it comes from the old
    # build-sequences pipeline). --all-windows training uses the lazy dataset,
    # which does attach it, so evaluation must use the same source.
    _, _, test_sequences, _ = build_windowed_splits(
        f"{DATA_DIR}/normalized_2010-2025.nc",
        elevation_file=f"data/static_{REGION}/elevation.nc",
        lsm_file=f"data/static_{REGION}/lsm.nc",
        eval_stride=3,
    )
    print(f"loaded {len(test_sequences)} test windows (lazy, stride=3)")

    in_features = test_sequences[0][0].x.shape[-1]
    cfg = ModelConfig(gnn_in_features=in_features, gnn_hidden_dim=32, gnn_num_layers=1,
                       transformer_d_model=32, transformer_nhead=2,
                       transformer_num_layers=1, transformer_dim_feedforward=64)
    model = VayuClimateModel(cfg)
    loss_fn = PhysicsInformedLoss()
    norm_params = _load_norm_params_file(f"{DATA_DIR}/norm_params_2010-2025.nc")

    trainer = VayuTrainer(model, loss_fn, "checkpoints/_verification_smoke",
                           device="cpu", norm_params=norm_params)

    results = trainer.evaluate_test_set(test_sequences)  # full held-out set

    print("\n=== top-level keys per variable ===")
    for var, r in results.items():
        print(f"  {var}: {sorted(r.keys())}")

    print("\n=== rainfall day1 (all-year) ===")
    print(json.dumps(results["rainfall"].get("by_lead_all_year", {}).get("day1", {}), indent=2))

    print("\n=== rainfall day1 (JJAS) ===")
    print(json.dumps(results["rainfall"].get("by_lead_jjas", {}).get("day1", {}), indent=2))

    print("\n=== rainfall accumulation ===")
    print("3-day:", results["rainfall"].get("accum_3day"))
    print("5-day:", results["rainfall"].get("accum_5day"))

    print("\n=== rainfall categorical (light threshold) ===")
    print(json.dumps(results["rainfall"].get("categorical", {}).get("light", {}), indent=2))

    # The real check: everything must survive round-tripping through JSON,
    # since this dict is written straight to test_report.json.
    from ai_engine.trainer import _json_safe
    json.dumps(_json_safe(results))
    print("\nJSON round-trip: OK")


if __name__ == "__main__":
    main()

"""Integration test: evaluate_test_set() populates the literature-comparable
verification fields (per-lead-time, JJAS season, multi-day accumulation,
categorical scores) end-to-end, using the lazy windowed dataset that
--all-windows training actually uses.

This guards the specific bug found while wiring this in: the PRE-BUILT
test_sequences.pt bundles predate `target_doy` and silently produced an empty
by_lead_jjas (no crash, easy to miss). WindowedSequenceDataset must be the
source under test, not the pre-built .pt files.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import torch

from ai_engine.climate_model import VayuClimateModel
from ai_engine.config import ModelConfig
from ai_engine.loss_functions import PhysicsInformedLoss
from ai_engine.trainer import VayuTrainer, _json_safe
from ai_engine.windowed_dataset import DenseRegionTensor, WindowedSequenceDataset

NODES, IW, TW = 8, 12, 5


def _dense_multi_year() -> DenseRegionTensor:
    """Spans Jan-Dec across two years so JJAS masking has real coverage."""
    times = pd.date_range("2022-01-01", "2023-12-31", freq="D")
    t = len(times)
    rng = np.random.default_rng(0)
    x = rng.normal(0, 1, size=(NODES, t, 4)).astype(np.float32)
    edge_index = torch.stack([torch.arange(NODES - 1), torch.arange(1, NODES)])
    return DenseRegionTensor(
        x=torch.from_numpy(x), edge_index=edge_index,
        edge_attr=torch.ones(edge_index.shape[1], 3),  # [dist, elev_diff, wind_dot]
        pos=torch.zeros(NODES, 2), static_features=None,
        times=times.values, feature_names=["rainfall", "tmax", "tmin", "other"],
    )


def test_evaluate_test_set_has_all_verification_fields():
    dense = _dense_multi_year()
    starts = list(range(0, dense.num_time - IW - TW, 5))
    ds = WindowedSequenceDataset(dense, starts, IW, TW)
    g0, _ = ds[0]
    assert hasattr(g0, "target_doy"), "lazy dataset must attach target_doy"

    cfg = ModelConfig(gnn_in_features=4, gnn_hidden_dim=8, gnn_num_layers=1,
                       transformer_d_model=8, transformer_nhead=2,
                       transformer_num_layers=1, transformer_dim_feedforward=16,
                       forecast_horizon=TW)
    model = VayuClimateModel(cfg)
    trainer = VayuTrainer(model, PhysicsInformedLoss(), "checkpoints/_test_verif",
                           device="cpu")

    sequences = [ds[i] for i in range(len(ds))]
    results = trainer.evaluate_test_set(sequences)

    for var in ("rainfall", "temp_max", "temp_min"):
        assert "by_lead_all_year" in results[var]
        assert "day1" in results[var]["by_lead_all_year"]
        assert "r2" in results[var]["by_lead_all_year"]["day1"]

    # JJAS must actually populate given June-Sept coverage in the fixture --
    # this is the exact bug caught with the stale pre-built test_sequences.pt.
    assert "by_lead_jjas" in results["rainfall"]
    assert results["rainfall"]["by_lead_jjas"] != {}
    assert "day1" in results["rainfall"]["by_lead_jjas"]

    assert "accum_3day" in results["rainfall"]
    assert "r2" in results["rainfall"]["accum_3day"]
    # accumulation is rainfall-only
    assert "accum_3day" not in results["temp_max"]


def test_evaluate_test_set_json_serializable():
    """The verification block is written straight to test_report.json."""
    dense = _dense_multi_year()
    starts = list(range(0, dense.num_time - IW - TW, 8))
    ds = WindowedSequenceDataset(dense, starts, IW, TW)

    cfg = ModelConfig(gnn_in_features=4, gnn_hidden_dim=8, gnn_num_layers=1,
                       transformer_d_model=8, transformer_nhead=2,
                       transformer_num_layers=1, transformer_dim_feedforward=16,
                       forecast_horizon=TW)
    model = VayuClimateModel(cfg)
    trainer = VayuTrainer(model, PhysicsInformedLoss(), "checkpoints/_test_verif2",
                           device="cpu")

    sequences = [ds[i] for i in range(len(ds))]
    results = trainer.evaluate_test_set(sequences)
    json.dumps(_json_safe(results))  # must not raise


def test_categorical_requires_norm_params():
    """Categorical (mm/day threshold) scores need denormalization; without
    norm_params they should be absent rather than silently wrong."""
    dense = _dense_multi_year()
    starts = list(range(0, dense.num_time - IW - TW, 10))
    ds = WindowedSequenceDataset(dense, starts, IW, TW)

    cfg = ModelConfig(gnn_in_features=4, gnn_hidden_dim=8, gnn_num_layers=1,
                       transformer_d_model=8, transformer_nhead=2,
                       transformer_num_layers=1, transformer_dim_feedforward=16,
                       forecast_horizon=TW)
    model = VayuClimateModel(cfg)
    trainer = VayuTrainer(model, PhysicsInformedLoss(), "checkpoints/_test_verif3",
                           device="cpu", norm_params=None)

    sequences = [ds[i] for i in range(len(ds))]
    results = trainer.evaluate_test_set(sequences)
    assert "categorical" not in results["rainfall"]

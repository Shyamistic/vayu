"""Tests for baseline benchmark suite."""

from __future__ import annotations

import torch
from torch_geometric.data import Data as GraphData

from ai_engine.baselines import (
    climatology_baseline,
    persistence_baseline,
    run_baseline_suite,
)


def _make_sequences(n_samples: int = 2, n_nodes: int = 10, seq_len: int = 30, horizon: int = 7):
    seqs = []
    edge_index = torch.tensor([[0, 1], [1, 0]], dtype=torch.long)
    edge_attr = torch.randn(2, 3)
    for _ in range(n_samples):
        x = torch.randn(n_nodes, seq_len, 11)
        graph = GraphData(x=x, edge_index=edge_index, edge_attr=edge_attr)
        target = torch.randn(horizon, n_nodes, 3)
        seqs.append((graph, target))
    return seqs


def test_persistence_baseline_shapes():
    val = _make_sequences()
    out = persistence_baseline(val)
    assert out.predictions.shape == out.targets.shape
    assert out.predictions.shape[-1] == 3


def test_climatology_baseline_shapes():
    val = _make_sequences()
    out = climatology_baseline(val)
    assert out.predictions.shape == out.targets.shape


def test_baseline_suite_reports_core_models():
    train = _make_sequences()
    val = _make_sequences()
    report = run_baseline_suite(train, val)
    assert "persistence" in report
    assert "climatology" in report
    assert "random_forest" in report
    assert "xgboost" in report


def test_baseline_suite_includes_regional_keys():
    train = _make_sequences()
    val = _make_sequences()
    # Attach mock node positions so regional key generation is enabled.
    n_nodes = val[0][0].x.shape[0]
    lat = torch.linspace(8.0, 28.0, n_nodes)
    lon = torch.linspace(72.0, 92.0, n_nodes)
    pos = torch.stack([lat, lon], dim=1)
    for g, _ in train:
        g.pos = pos
    for g, _ in val:
        g.pos = pos

    report = run_baseline_suite(train, val)
    # Region-aware suffix keys are emitted when node positions are present.
    keys = report["persistence"].keys() if isinstance(report["persistence"], dict) else []
    assert any(k.endswith("_western_ghats") for k in keys)

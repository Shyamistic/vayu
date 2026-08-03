"""Tests for benchmark-enforced training metrics."""

from __future__ import annotations

import torch
from torch_geometric.data import Data as GraphData

from ai_engine.climate_model import VayuClimateModel
from ai_engine.config import ModelConfig
from ai_engine.loss_functions import PhysicsInformedLoss
from ai_engine.trainer import (
    _baseline_from_input,
    _collate_sequences,
    ClimateSequenceDataset,
    VayuTrainer,
)


def test_baseline_builder_shapes():
    num_nodes = 12
    seq_len = 30
    features = 11
    horizon = 7

    graph = GraphData(
        x=torch.randn(num_nodes, seq_len, features),
        edge_index=torch.tensor([[0, 1], [1, 0]], dtype=torch.long),
        edge_attr=torch.randn(2, 3),
    )

    baselines = _baseline_from_input(graph, horizon=horizon)
    assert baselines["persistence_rainfall"].shape == (num_nodes, horizon)
    assert baselines["climatology_temp_max"].shape == (num_nodes, horizon)


def test_eval_reports_benchmark_skills(tmp_path):
    cfg = ModelConfig(
        gnn_hidden_dim=16,
        gnn_num_layers=1,
        transformer_d_model=32,
        transformer_nhead=2,
        transformer_num_layers=1,
        transformer_dim_feedforward=64,
        batch_size=1,
        max_epochs=1,
    )
    model = VayuClimateModel(cfg)
    loss_fn = PhysicsInformedLoss()
    trainer = VayuTrainer(model, loss_fn, checkpoint_dir=str(tmp_path), device="cpu")

    num_nodes = cfg.num_nodes
    x = torch.randn(num_nodes, cfg.input_window, cfg.gnn_in_features)
    edge_index = torch.randint(0, num_nodes, (2, min(4000, num_nodes * 3)))
    edge_attr = torch.randn(edge_index.shape[1], 3)
    graph = GraphData(x=x, edge_index=edge_index, edge_attr=edge_attr)
    target = torch.randn(cfg.forecast_horizon, num_nodes, 3)

    dataset = ClimateSequenceDataset([(graph, target)])
    loader = torch.utils.data.DataLoader(dataset, batch_size=1, collate_fn=_collate_sequences)
    loss, metrics = trainer._eval_epoch(loader)

    assert "skill_vs_persistence_rain" in metrics
    assert "skill_vs_climatology_tmax" in metrics


def test_eval_epoch_emits_full_india_regional_metrics_when_pos_present(tmp_path):
    """Full India validation should surface per-subregion keys, not just global ones."""
    cfg = ModelConfig(
        gnn_hidden_dim=16, gnn_num_layers=1, transformer_d_model=32,
        transformer_nhead=2, transformer_num_layers=1, transformer_dim_feedforward=64,
        batch_size=1, max_epochs=1,
    )
    model = VayuClimateModel(cfg)
    loss_fn = PhysicsInformedLoss()
    trainer = VayuTrainer(model, loss_fn, checkpoint_dir=str(tmp_path), device="cpu")

    num_nodes = cfg.num_nodes
    x = torch.randn(num_nodes, cfg.input_window, cfg.gnn_in_features)
    edge_index = torch.randint(0, num_nodes, (2, min(4000, num_nodes * 3)))
    edge_attr = torch.randn(edge_index.shape[1], 3)
    # Node positions sweep the full national bounding box so every specialist
    # region (WG, NE, IGP, Central) and full_india overlap at least one node.
    lat = torch.linspace(7.0, 30.0, num_nodes)
    lon = torch.linspace(72.0, 96.0, num_nodes)
    pos = torch.stack([lat, lon], dim=1)
    graph = GraphData(x=x, edge_index=edge_index, edge_attr=edge_attr)
    graph.pos = pos
    target = torch.randn(cfg.forecast_horizon, num_nodes, 3)

    dataset = ClimateSequenceDataset([(graph, target)])
    loader = torch.utils.data.DataLoader(dataset, batch_size=1, collate_fn=_collate_sequences)
    _, metrics = trainer._eval_epoch(loader)

    assert "r2_rain_western_ghats" in metrics
    assert "r2_rain_full_india" in metrics


def test_evaluate_test_set_emits_regional_metrics(tmp_path):
    """Held-out test evaluation must also report per-region breakdowns when pos is present."""
    cfg = ModelConfig(
        gnn_hidden_dim=16, gnn_num_layers=1, transformer_d_model=32,
        transformer_nhead=2, transformer_num_layers=1, transformer_dim_feedforward=64,
        batch_size=1, max_epochs=1,
    )
    model = VayuClimateModel(cfg)
    loss_fn = PhysicsInformedLoss()
    trainer = VayuTrainer(model, loss_fn, checkpoint_dir=str(tmp_path), device="cpu")

    num_nodes = cfg.num_nodes
    x = torch.randn(num_nodes, cfg.input_window, cfg.gnn_in_features)
    edge_index = torch.randint(0, num_nodes, (2, min(4000, num_nodes * 3)))
    edge_attr = torch.randn(edge_index.shape[1], 3)
    lat = torch.linspace(7.0, 30.0, num_nodes)
    lon = torch.linspace(72.0, 96.0, num_nodes)
    pos = torch.stack([lat, lon], dim=1)
    graph = GraphData(x=x, edge_index=edge_index, edge_attr=edge_attr)
    graph.pos = pos
    target = torch.randn(cfg.forecast_horizon, num_nodes, 3)

    results = trainer.evaluate_test_set([(graph, target)])
    assert "r2_western_ghats" in results["rainfall"]
    assert "r2_full_india" in results["rainfall"]

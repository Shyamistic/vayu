"""Unit and property tests for VayuClimateModel components.

Property 9:  Model output has correct shape and variables
Property 10: Physics-informed loss decomposes correctly
"""

from __future__ import annotations

import pytest
import torch
from torch_geometric.data import Data as GraphData

from ai_engine.climate_model import VayuClimateModel
from ai_engine.config import ModelConfig
from ai_engine.graph_encoder import GraphEncoder
from ai_engine.loss_functions import PhysicsInformedLoss
from ai_engine.prediction_heads import PredictionHeads
from ai_engine.temporal_transformer import TemporalTransformer


@pytest.fixture
def small_config():
    """Smaller model config for fast unit tests."""
    cfg = ModelConfig()
    cfg.gnn_hidden_dim = 32
    cfg.gnn_num_layers = 2
    cfg.transformer_d_model = 64
    cfg.transformer_nhead = 4
    cfg.transformer_num_layers = 2
    cfg.transformer_dim_feedforward = 128
    return cfg


@pytest.fixture
def small_graph(small_config):
    """Minimal graph batch for model testing."""
    from data_ingestion.graph_builder import ClimateGraphBuilder
    builder = ClimateGraphBuilder()
    num_nodes = builder.num_nodes  # ~1225
    seq_len = small_config.input_window

    x = torch.randn(num_nodes, seq_len, small_config.gnn_in_features)
    return GraphData(
        x=x,
        edge_index=builder.edge_index,
        edge_attr=builder.edge_attr,
    )


@pytest.fixture
def model(small_config):
    m = VayuClimateModel(config=small_config)
    m.eval()
    return m


# ── GraphEncoder tests ──────────────────────────────────────────────────────────

def test_graph_encoder_output_shape():
    """GraphEncoder outputs [num_nodes, hidden_dim]."""
    num_nodes, in_features, hidden_dim = 100, 11, 64
    enc = GraphEncoder(in_features=in_features, hidden_dim=hidden_dim, num_layers=2)
    x = torch.randn(num_nodes, in_features)
    edge_index = torch.randint(0, num_nodes, (2, 300))
    edge_attr = torch.randn(300, 3)
    out = enc(x, edge_index, edge_attr)
    assert out.shape == (num_nodes, hidden_dim)


def test_graph_encoder_sequence_input():
    """GraphEncoder handles (num_nodes, seq_len, features) input."""
    num_nodes, seq_len, in_features, hidden_dim = 50, 10, 11, 32
    enc = GraphEncoder(in_features=in_features, hidden_dim=hidden_dim, num_layers=2)
    x = torch.randn(num_nodes, seq_len, in_features)
    edge_index = torch.randint(0, num_nodes, (2, 150))
    edge_attr = torch.randn(150, 3)
    out = enc(x, edge_index, edge_attr)
    assert out.shape == (num_nodes, hidden_dim)


# ── TemporalTransformer tests ──────────────────────────────────────────────────

def test_temporal_transformer_output_shape():
    """TemporalTransformer outputs [num_nodes, d_model]."""
    num_nodes, seq_len, input_dim, d_model = 100, 30, 64, 128
    transformer = TemporalTransformer(input_dim=input_dim, d_model=d_model, nhead=4, num_layers=2)
    x = torch.randn(num_nodes, seq_len, input_dim)
    out = transformer(x)
    assert out.shape == (num_nodes, d_model)


# ── PredictionHeads tests ───────────────────────────────────────────────────────

def test_prediction_heads_output_keys():
    """PredictionHeads returns dict with 3 variable keys."""
    heads = PredictionHeads(d_model=64, forecast_horizon=7)
    ctx = torch.randn(100, 64)
    out = heads(ctx)
    assert set(out.keys()) == {"rainfall", "temp_max", "temp_min"}


def test_prediction_heads_output_shape():
    """Each head output is [num_nodes, forecast_horizon]."""
    num_nodes, d_model, horizon = 100, 64, 7
    heads = PredictionHeads(d_model=d_model, forecast_horizon=horizon)
    ctx = torch.randn(num_nodes, d_model)
    out = heads(ctx)
    for var, tensor in out.items():
        assert tensor.shape == (num_nodes, horizon), (
            f"Head '{var}' shape mismatch: {tensor.shape}"
        )


# ── Property 9: Full model output ─────────────────────────────────────────────

def test_model_output_keys(model, small_graph):
    """Model returns predictions for all 3 variables."""
    with torch.no_grad():
        preds = model(small_graph)
    assert set(preds.keys()) == {"rainfall", "temp_max", "temp_min"}


def test_model_output_shape(model, small_graph, small_config):
    """Each prediction has shape [num_nodes, forecast_horizon]."""
    num_nodes = small_graph.x.shape[0]
    with torch.no_grad():
        preds = model(small_graph)
    for var, tensor in preds.items():
        assert tensor.shape == (num_nodes, small_config.forecast_horizon), (
            f"Prediction shape mismatch for '{var}': {tensor.shape}"
        )


def test_model_mc_dropout_returns_uncertainty(model, small_graph, small_config):
    """predict_with_uncertainty returns mean and std tensors."""
    with torch.no_grad():
        result = model.predict_with_uncertainty(small_graph, n_passes=3)
    num_nodes = small_graph.x.shape[0]
    for var in ["rainfall", "temp_max", "temp_min"]:
        assert var in result
        assert "mean" in result[var]
        assert "std" in result[var]
        assert result[var]["mean"].shape == (num_nodes, small_config.forecast_horizon)
        assert result[var]["std"].shape == (num_nodes, small_config.forecast_horizon)
        # Std should be non-negative
        assert (result[var]["std"] >= 0).all()


def test_model_parameter_count_within_limit(small_config):
    """Total parameters ≤ 25M."""
    model = VayuClimateModel(config=small_config)
    total = sum(p.numel() for p in model.parameters())
    assert total <= 25_000_000, f"Model has {total / 1e6:.1f}M params, exceeds 25M limit"


# ── Property 10: Physics-informed loss ─────────────────────────────────────────

@pytest.fixture
def loss_fn():
    return PhysicsInformedLoss(lambda_conservation=0.1, lambda_smoothness=0.05)


def test_loss_decomposes_correctly(loss_fn):
    """Total loss = pred + 0.1*cons + 0.05*smooth."""
    num_nodes, horizon = 50, 7
    edge_index = torch.randint(0, num_nodes, (2, 200))

    preds = {
        "rainfall": torch.randn(num_nodes, horizon),
        "temp_max": torch.randn(num_nodes, horizon),
        "temp_min": torch.randn(num_nodes, horizon),
    }
    targets = torch.randn(horizon, num_nodes, 3)

    result = loss_fn(preds, targets, edge_index)
    assert "total_loss" in result
    assert "prediction_loss" in result
    assert "conservation_loss" in result
    assert "smoothness_loss" in result

    # Verify decomposition (within floating point tolerance)
    expected_total = (
        result["prediction_loss"]
        + 0.1 * result["conservation_loss"]
        + 0.05 * result["smoothness_loss"]
    )
    assert torch.allclose(result["total_loss"], expected_total, atol=1e-5)


def test_smoothness_loss_zero_for_uniform_field(loss_fn):
    """Smoothness loss is 0 when all adjacent nodes have identical values."""
    num_nodes, horizon = 50, 7
    edge_index = torch.randint(0, num_nodes, (2, 200))

    # All predictions identical → no gradient → smoothness = 0
    uniform_val = 2.5
    preds = {
        "rainfall": torch.full((num_nodes, horizon), uniform_val),
        "temp_max": torch.full((num_nodes, horizon), uniform_val),
        "temp_min": torch.full((num_nodes, horizon), uniform_val),
    }
    targets = preds.copy()

    result = loss_fn(preds, targets, edge_index)
    assert result["smoothness_loss"].item() < 1e-6, (
        f"Smoothness should be 0 for uniform field, got {result['smoothness_loss'].item()}"
    )


def test_ghats_exemption_reduces_smoothness():
    """Masking ridge nodes exempts their edges; masked loss ≤ unmasked for same preds."""
    num_nodes, horizon = 50, 7
    edge_index = torch.randint(0, num_nodes, (2, 200))

    # Deterministic preds so edge variance is controlled
    torch.manual_seed(0)
    base = torch.ones(num_nodes, horizon)
    preds = {
        "rainfall": base.clone(),
        "temp_max": base.clone(),
        "temp_min": base.clone(),
    }
    # Add big gradient at node 0 only
    for v in preds:
        preds[v][0] = 100.0
    targets = torch.zeros(horizon, num_nodes, 3)

    # Without mask: edges incident to node 0 contribute high smoothness loss
    loss_no_mask = PhysicsInformedLoss(lambda_smoothness=1.0)
    r1 = loss_no_mask(preds, targets, edge_index)

    # With mask: node 0 is on the ridge → its edges are exempt → lower smoothness
    ghats_mask = torch.zeros(num_nodes, dtype=torch.bool)
    ghats_mask[0] = True  # only node 0 is on the ridge
    loss_with_mask = PhysicsInformedLoss(lambda_smoothness=1.0, ghats_ridge_mask=ghats_mask)
    r2 = loss_with_mask(preds, targets, edge_index)

    assert r2["smoothness_loss"].item() <= r1["smoothness_loss"].item() + 1e-6


def test_ghats_exemption_mask_excludes_nodes():
    """Smoothness loss is zero when ALL nodes are on the Ghats ridge (all edges exempt)."""
    num_nodes, horizon = 50, 7
    edge_index = torch.randint(0, num_nodes, (2, 200))
    preds = {"rainfall": torch.randn(num_nodes, horizon),
             "temp_max": torch.randn(num_nodes, horizon),
             "temp_min": torch.randn(num_nodes, horizon)}
    targets = torch.randn(horizon, num_nodes, 3)

    # All nodes marked as ridge → all edges exempt → smoothness must be 0
    full_mask = torch.ones(num_nodes, dtype=torch.bool)
    loss_full_mask = PhysicsInformedLoss(lambda_smoothness=1.0, ghats_ridge_mask=full_mask)
    r = loss_full_mask(preds, targets, edge_index)
    assert r["smoothness_loss"].item() < 1e-6, (
        f"Full ridge mask should give smoothness=0, got {r['smoothness_loss'].item()}"
    )

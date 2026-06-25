"""Property tests for ScenarioEngine.

Property 11: Perturbation is correctly applied and physically clamped
Property 12: Scenario delta is algebraically correct
Property 13: Hotspot identification filters at 90th percentile
"""

from __future__ import annotations

import numpy as np
import pytest
import torch
from torch_geometric.data import Data as GraphData

from scenario_engine.engine import ScenarioConfig, ScenarioEngine, ScenarioType


@pytest.fixture
def dummy_model():
    """Minimal mock model that returns deterministic predictions."""
    from ai_engine.climate_model import VayuClimateModel
    from ai_engine.config import ModelConfig

    cfg = ModelConfig()
    cfg.gnn_hidden_dim = 16
    cfg.gnn_num_layers = 1
    cfg.transformer_d_model = 32
    cfg.transformer_nhead = 2
    cfg.transformer_num_layers = 1
    cfg.transformer_dim_feedforward = 64

    model = VayuClimateModel(config=cfg)
    model.eval()
    return model


@pytest.fixture
def base_graph():
    """Minimal input graph for testing."""
    from data_ingestion.graph_builder import ClimateGraphBuilder
    builder = ClimateGraphBuilder()
    num_nodes = builder.num_nodes
    seq_len = 30
    x = torch.randn(num_nodes, seq_len, 17)
    return GraphData(
        x=x,
        edge_index=builder.edge_index,
        edge_attr=builder.edge_attr,
    )


@pytest.fixture
def engine(dummy_model):
    return ScenarioEngine(dummy_model)


# ── Property 11: Perturbation application ─────────────────────────────────────

def test_temperature_offset_modifies_correct_channels(engine, base_graph):
    """Temperature offset only modifies tmax (ch1) and tmin (ch2) channels."""
    config = ScenarioConfig(scenario_type=ScenarioType.TEMPERATURE_OFFSET, magnitude=2.0)
    perturbed, _, _ = engine.apply_perturbation(base_graph, config)

    original = base_graph.x
    changed = perturbed.x

    # Channels 1 (tmax) and 2 (tmin) should change
    assert not torch.allclose(changed[:, :, 1], original[:, :, 1]), "Tmax should change"
    assert not torch.allclose(changed[:, :, 2], original[:, :, 2]), "Tmin should change"

    # Other channels should be unchanged
    for ch in [0, 3, 4, 5, 6]:
        assert torch.allclose(changed[:, :, ch], original[:, :, ch]), (
            f"Channel {ch} should be unchanged"
        )


def test_rainfall_scaling_modifies_only_rainfall(engine, base_graph):
    """Rainfall scaling only modifies channel 0 (rainfall)."""
    config = ScenarioConfig(scenario_type=ScenarioType.RAINFALL_SCALING, magnitude=0.8)
    perturbed, _, _ = engine.apply_perturbation(base_graph, config)

    original = base_graph.x
    changed = perturbed.x

    assert not torch.allclose(changed[:, :, 0], original[:, :, 0]), "Rainfall should change"
    for ch in [1, 2, 3, 4]:
        assert torch.allclose(changed[:, :, ch], original[:, :, ch]), (
            f"Channel {ch} should be unchanged"
        )


def test_rainfall_physical_bound_non_negative(engine, base_graph):
    """After rainfall scaling, no rainfall channel values are < lower bound."""
    # Force extreme negative scaling to trigger clamping
    config = ScenarioConfig(scenario_type=ScenarioType.RAINFALL_SCALING, magnitude=-10.0)
    from scenario_engine.engine import PHYS_BOUNDS_NORMALIZED
    perturbed, clamped, msg = engine.apply_perturbation(base_graph, config)
    lo, hi = PHYS_BOUNDS_NORMALIZED["rainfall"]
    assert (perturbed.x[:, :, 0] >= lo).all(), "Rainfall below physical bound"


def test_clamped_flag_set_when_bounds_exceeded(engine, base_graph):
    """clamped flag is True when temperature exceeds physical bounds."""
    # Very large offset should trigger clamping
    config = ScenarioConfig(scenario_type=ScenarioType.TEMPERATURE_OFFSET, magnitude=100.0)
    _, clamped, msg = engine.apply_perturbation(base_graph, config)
    assert clamped, "Should be clamped with extreme temperature offset"
    assert msg is not None, "Clamp message should be set"


# ── Property 12: Delta algebraic correctness ──────────────────────────────────

def test_delta_algebraic_identity(engine, base_graph):
    """baseline + delta = scenario for all nodes and variables."""
    config = ScenarioConfig(scenario_type=ScenarioType.TEMPERATURE_OFFSET, magnitude=1.0)
    result = engine.run_scenario(base_graph, config)

    for var in ["rainfall", "temp_max", "temp_min"]:
        bl = np.array(result.baseline[var])
        sc = np.array(result.scenario[var])
        delta = np.array(result.delta[var])

        reconstructed = bl + delta
        max_err = np.max(np.abs(reconstructed - sc))
        assert max_err < 1e-5, (
            f"Delta identity violated for '{var}': max_err={max_err}"
        )


# ── Property 13: Hotspot identification ───────────────────────────────────────

def test_hotspots_at_90th_percentile():
    """All hotspot cells have |delta| ≥ 90th percentile of all cells."""
    engine = ScenarioEngine.__new__(ScenarioEngine)  # bypass __init__
    engine.norm_params = {}
    engine.land_sea_mask = None

    rng = np.random.default_rng(42)
    delta = torch.tensor(rng.normal(0, 1, 1225).astype(np.float32))
    hotspots = engine.identify_hotspots(delta, percentile=90.0)

    abs_delta = delta.abs().numpy()
    threshold = float(np.percentile(abs_delta, 90.0))

    for h in hotspots:
        assert abs_delta[h["node_idx"]] >= threshold - 1e-6, (
            f"Hotspot node {h['node_idx']} below p90 threshold"
        )


def test_hotspots_approximately_10_percent():
    """Approximately 10% of cells are identified as hotspots at p90."""
    engine = ScenarioEngine.__new__(ScenarioEngine)
    engine.norm_params = {}
    engine.land_sea_mask = None

    rng = np.random.default_rng(0)
    delta = torch.tensor(rng.uniform(0, 1, 1225).astype(np.float32))
    hotspots = engine.identify_hotspots(delta, percentile=90.0)

    # Should be ~10% of 1225 ≈ 122-123 cells (with possible tie-breaking)
    pct = len(hotspots) / 1225.0
    assert 0.08 <= pct <= 0.15, (
        f"Expected ~10% hotspots, got {pct:.1%} ({len(hotspots)} cells)"
    )


def test_non_hotspot_cells_below_threshold():
    """All non-hotspot cells have |delta| < 90th percentile."""
    engine = ScenarioEngine.__new__(ScenarioEngine)
    engine.norm_params = {}
    engine.land_sea_mask = None

    rng = np.random.default_rng(7)
    delta = torch.tensor(rng.normal(0, 2, 200).astype(np.float32))
    hotspots = engine.identify_hotspots(delta, percentile=90.0)
    hotspot_indices = {h["node_idx"] for h in hotspots}

    abs_delta = delta.abs().numpy()
    threshold = float(np.percentile(abs_delta, 90.0))

    for i in range(200):
        if i not in hotspot_indices:
            assert abs_delta[i] <= threshold + 1e-6, (
                f"Non-hotspot cell {i} is above threshold"
            )

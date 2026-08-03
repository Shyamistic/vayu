"""Regression tests for the v3 fixes to the R²_rain ≈ 0 collapse.

Each test pins one of the four root causes found on the 2026-08-03 Western
Ghats / North-East runs (R²_rain plateaued at 0.001, R²_tmax ≈ persistence).
"""
from __future__ import annotations

import numpy as np
import torch

from ai_engine.config import ModelConfig
from ai_engine.loss_functions import (
    RAIN_HEAVY_Z_THRESHOLD,
    PhysicsInformedLoss,
    WeightedCRPSLoss,
    WeightedMSELoss,
)
from ai_engine.prediction_heads import PredictionHeads, SingleVariableHead


# ── Cause 1: ReLU clamp made dry days unrepresentable ─────────────────────────

def test_rainfall_head_can_emit_negative_values_by_default():
    """Dry days are NEGATIVE z-scores (45.4% of real WG targets), so the head
    must be able to output below zero."""
    heads = PredictionHeads(d_model=16, forecast_horizon=7)
    assert heads.clamp_rain_nonnegative is False

    ctx = torch.zeros(20, 16)
    # last-day rainfall strongly negative → persistence baseline is negative
    last_input = torch.full((20, 5), -0.6)
    clim = torch.full((20, 7, 3), -0.5)

    out = heads(ctx, last_input, clim_future=clim)
    assert out["rainfall"].min() < 0.0, "rainfall head cannot represent dry days"


def test_rainfall_clamp_still_available_for_physical_units():
    """Non-negativity is correct in mm/day, so the option must remain."""
    heads = PredictionHeads(d_model=16, forecast_horizon=7, clamp_rain_nonnegative=True)
    ctx = torch.zeros(20, 16)
    last_input = torch.full((20, 5), -0.6)
    clim = torch.full((20, 7, 3), -0.5)

    out = heads(ctx, last_input, clim_future=clim)
    assert out["rainfall"].min() >= 0.0


# ── Cause 2: MAE targets the median, R² rewards the mean ──────────────────────

def test_squared_error_recovers_mean_absolute_error_recovers_median():
    """On a zero-inflated, right-skewed sample the median sits at the dry value
    while the mean does not. Optimizing MAE therefore collapses the prediction
    toward dry; MSE tracks the mean that R² scores."""
    # 70% dry (-0.3), 30% wet with a heavy tail
    y = torch.cat([
        torch.full((700,), -0.3),
        torch.tensor([0.5, 1.0, 2.0, 4.0, 8.0]).repeat(60),
    ])
    true_mean = y.mean().item()
    true_median = y.median().item()
    assert abs(true_mean - true_median) > 0.3, "fixture must separate mean/median"

    def best_constant(loss_fn) -> float:
        c = torch.zeros(1, requires_grad=True)
        opt = torch.optim.Adam([c], lr=0.05)
        for _ in range(2000):
            opt.zero_grad()
            loss_fn(c.expand_as(y), y).backward()
            opt.step()
        return float(c.item())

    # Unweighted forms isolate the mean-vs-median property.
    mse_opt = best_constant(lambda p, t: ((p - t) ** 2).mean())
    mae_opt = best_constant(lambda p, t: (p - t).abs().mean())

    assert abs(mse_opt - true_mean) < 0.05, f"MSE should find the mean, got {mse_opt}"
    assert abs(mae_opt - true_median) < 0.05, f"MAE should find the median, got {mae_opt}"
    # And the MAE optimum is the dry value — the observed collapse.
    assert mae_opt < -0.25


def test_physics_loss_uses_squared_error_for_rainfall():
    """The rainfall term must scale quadratically with the residual."""
    loss_fn = PhysicsInformedLoss(lambda_conservation=0.0, lambda_smoothness=0.0)
    n, h = 8, 7
    edge_index = torch.stack([torch.arange(n - 1), torch.arange(1, n)])
    targets = torch.zeros(h, n, 3)

    def rain_loss(err: float) -> float:
        preds = {
            "rainfall": torch.full((n, h), err),
            "temp_max": torch.zeros(n, h),
            "temp_min": torch.zeros(n, h),
        }
        return float(loss_fn(preds, targets, edge_index)["prediction_loss"])

    # Quadratic: doubling the error quadruples the loss (linear would double it).
    assert np.isclose(rain_loss(0.2) * 4.0, rain_loss(0.4), rtol=1e-4)


# ── Cause 3: heavy-rain threshold was on the wrong scale ──────────────────────

def test_heavy_rain_threshold_is_on_zscore_scale():
    """Real WG rainfall z-scores top out near +8.6. A threshold of 20 (mm/day)
    made the emphasis weight ~1.00 and therefore inert."""
    assert RAIN_HEAVY_Z_THRESHOLD == 2.0

    y = torch.tensor([4.0])          # genuinely heavy in z-space
    pred = torch.zeros(1)
    fixed = WeightedMSELoss(alpha=3.0, heavy_threshold=2.0)(pred, y)
    inert = WeightedMSELoss(alpha=3.0, heavy_threshold=20.0)(pred, y)
    # Emphasis active: 1 + 3*1 = 4x vs 1 + 3*(0.2)^2 = 1.12x
    assert float(fixed / inert) > 3.0


def test_weighted_crps_retained_for_ablation():
    """Kept importable so the v2 objective can still be reproduced."""
    out = WeightedCRPSLoss()(torch.zeros(4), torch.ones(4))
    assert float(out) > 0.0


# ── Cause 4: persistence-anchored baseline; climatology is far better for rain ─

def test_head_blends_persistence_and_climatology():
    head = SingleVariableHead(
        d_model=8, forecast_horizon=3, persistence_init=0.25, climatology_init=0.75
    )
    ctx = torch.zeros(5, 8)
    last = torch.full((5, 1), 2.0)
    clim = torch.full((5, 3), -1.0)

    with torch.no_grad():
        out = head(ctx, last, clim_future=clim)
    # delta is zero-init → output is exactly the blend
    expected = 0.25 * 2.0 + 0.75 * -1.0
    assert torch.allclose(out, torch.full((5, 3), expected), atol=1e-6)


def test_head_falls_back_to_persistence_without_climatology():
    """Pre-built .pt bundles carry no clim_future; that path must still work."""
    head = SingleVariableHead(d_model=8, forecast_horizon=3)
    ctx = torch.zeros(5, 8)
    last = torch.full((5, 1), 1.5)
    with torch.no_grad():
        out = head(ctx, last, clim_future=None)
    assert torch.allclose(out, torch.full((5, 3), 1.5), atol=1e-6)


def test_rainfall_baseline_is_climatology_not_persistence():
    """Persistence scores R² = -0.30 for rainfall on real data, climatology
    +0.215, so rainfall must not start anchored on persistence."""
    wp, wc = PredictionHeads.BASELINE_INIT["rainfall"]
    assert wp == 0.0 and wc == 1.0
    for var in ("temp_max", "temp_min"):
        wp, wc = PredictionHeads.BASELINE_INIT[var]
        assert wp > 0.0 and wc > 0.0, f"{var} should blend both baselines"


def test_baseline_weights_are_learnable():
    """The blend must be able to re-balance per region during training."""
    head = SingleVariableHead(d_model=8, forecast_horizon=3)
    assert head.w_persistence.requires_grad
    assert head.w_climatology.requires_grad


# ── Physics penalties default off ─────────────────────────────────────────────

def test_physics_penalties_default_to_zero():
    """Conservation is minimized by predicting the mean (it rewarded the
    collapse); smoothness suppresses real terrain-driven temperature gradients."""
    cfg = ModelConfig()
    assert cfg.lambda_conservation == 0.0
    assert cfg.lambda_smoothness == 0.0

    loss_fn = PhysicsInformedLoss()
    assert loss_fn.lambda_conservation == 0.0
    assert loss_fn.lambda_smoothness == 0.0
    assert loss_fn.rain_occurrence_weight == 0.0

"""Physics-informed loss function for climate prediction.

L_total = L_prediction + λ1 * L_conservation + λ2 * L_smoothness

- L_prediction:   Weighted loss per variable.
                  Rainfall: weighted MSE (heavy-tail emphasis, z-score scale)
                  Temperature: MSE
- L_conservation: Water balance penalty (regional mean predicted ≈ observed).
                  DEFAULT OFF — see "v3" note below.
- L_smoothness:   Spatial smoothness on temperature only (NOT rainfall).
                  DEFAULT OFF — see "v3" note below.

v3 key changes vs v2 — all four fix a measured R²_rain ≈ 0.000 collapse
(WG/NE runs 2026-08-03 plateaued at R²_rain 0.001, R²_tmax ≈ persistence):

  1. Rainfall loss: weighted MAE ("CRPS") → weighted **MSE**.
     Absolute error is minimized by the conditional MEDIAN. Rainfall is
     zero-inflated and right-skewed, so its conditional median sits at/near
     the dry value; minimizing MAE therefore drives the rain field to a
     near-constant dry value. R² is a squared-error score, which rewards the
     conditional MEAN, so MAE training and R² reporting were pulling in
     opposite directions. Measured on real WG validation data: a constant
     prediction scores R² = -0.003, which is exactly where training landed.
     Ref: L1 → conditional median, L2 → conditional mean (Hastie et al.,
     Elements of Statistical Learning, eq. 2.11).

  2. heavy_threshold 20.0 → 2.0. Targets are z-scores, not mm/day. With a
     threshold of 20 the emphasis weight was 1 + 3·(y/20)² ≈ 1.002 for a
     typical y, i.e. the heavy-rain weighting was inert. Measured rainfall
     z-range on real WG data: [-0.65, +8.61], std 0.84 → 2.0 marks genuine
     heavy rain.

  3. BCE occurrence term default OFF. It derived its logits from the
     regression output as (pred - 0.1)·10, conflating the regression scale
     with a classification decision, and 0.1 in z-space is not the wet/dry
     boundary (that boundary is per-cell and mostly negative).

  4. Conservation and smoothness default λ = 0.0. Conservation was
     |mean(pred) - mean(true)| over the whole batch, which is minimized by
     predicting the mean — it actively rewarded the collapse in (1).
     Smoothness penalizes adjacent-node temperature differences, but real
     temperature gradients over the Ghats/NE terrain are large and physical,
     so it suppressed the spatial variance that R²_tmax measures.

NOTE on Tweedie: kept but unused. It requires y≥0 but normalized rainfall has
  negative z-scores for dry days. Clamping to 0 makes dry=average which
  produces wrong gradients. Evidence: val_loss spike 0.55→202 in v2 Session 1.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


# Per-variable loss weights — V2 rebalanced.
# Rainfall weight raised from 0.3 → 1.8 (6× increase) to fix gradient starvation.
# This is the single most impactful change for R²_rain.
VARIABLE_WEIGHTS = {
    "rainfall": 1.8,   # v1: 0.3 — was getting only 7.9% of gradient
    "temp_max": 1.6,   # v1: 2.0
    "temp_min": 1.2,   # v1: 1.5
}

# Focal regression gamma for rainfall.
# 1.0 = standard weighted MSE (no focal amplification).
# Higher gamma was causing gradient explosions under AMP; keeping at 1.0 for stability.
RAIN_FOCAL_GAMMA = 1.0

# Normalized threshold separating "dry" vs "wet" days.
# NOTE: only used by the optional (default-off) occurrence term. In z-score
# space the true wet/dry boundary is per-cell and typically negative, so this
# is a coarse approximation — see v3 note (3) in the module docstring.
RAIN_WET_THRESHOLD = 0.1

# Heavy-rain emphasis threshold, in normalized z-score units (NOT mm/day).
# Real WG rainfall z-scores span [-0.65, +8.61] with std 0.84, so z ≥ 2
# corresponds to genuinely heavy rain.
RAIN_HEAVY_Z_THRESHOLD = 2.0

# Variable order in the target tensor (dim=2)
VARIABLE_ORDER = ["rainfall", "temp_max", "temp_min"]


class PhysicsInformedLoss(nn.Module):
    """Combined prediction + conservation + smoothness loss.

    L_total = L_pred + lambda_conservation * L_cons + lambda_smoothness * L_smooth

    L_pred: Weighted MSE summed over variables, averaged over nodes and time.
    L_cons: |mean_predicted_rainfall - mean_true_rainfall| for the pilot region,
            penalizing violations of the water balance.
    L_smooth: Mean squared difference between adjacent node predictions,
              excluding Western Ghats ridge nodes (sharp orographic gradients expected).
    """

    def __init__(
        self,
        lambda_conservation: float = 0.0,
        lambda_smoothness: float = 0.0,
        ghats_ridge_mask: torch.Tensor | None = None,
        variable_weights: dict[str, float] | None = None,
        rain_occurrence_weight: float = 0.0,
        rain_heavy_alpha: float = 3.0,
        rain_heavy_threshold: float = RAIN_HEAVY_Z_THRESHOLD,
    ):
        super().__init__()
        self.lambda_conservation = lambda_conservation
        self.lambda_smoothness = lambda_smoothness
        # Weight of the optional wet/dry occurrence (BCE) term. Default 0.0 —
        # see v3 note (3) in the module docstring.
        self.rain_occurrence_weight = float(rain_occurrence_weight)
        # Per-region variable-priority override. Defaults to the global v2
        # rebalanced weights; callers (e.g. trainer.py's --rain-weight /
        # --tmax-weight / --tmin-weight CLI flags) may override per region
        # based on that region's dominant hazard (rainfall/flood vs. heat
        # extremes) per the literature cited in loss_functions.py's module
        # docstring and research/VAYU_STATE_OF_ART_IMPROVEMENTS.md.
        self.variable_weights = dict(variable_weights) if variable_weights else dict(VARIABLE_WEIGHTS)
        # v3: weighted MSE for rainfall. Squared error targets the conditional
        # mean, which is what R² rewards; the previous weighted-MAE objective
        # targeted the conditional median and collapsed to a constant field.
        self._rain_loss = WeightedMSELoss(
            alpha=rain_heavy_alpha, heavy_threshold=rain_heavy_threshold
        )
        # Retained for backward compatibility / ablation only.
        self._crps = WeightedCRPSLoss(alpha=rain_heavy_alpha, heavy_threshold=rain_heavy_threshold)

        # ghats_ridge_mask: [num_nodes] bool tensor, True = on ridge → exempt from smoothness
        if ghats_ridge_mask is not None:
            self.register_buffer("ghats_ridge_mask", ghats_ridge_mask)
        else:
            self.ghats_ridge_mask = None

    def forward(
        self,
        predictions: dict[str, torch.Tensor],
        targets: torch.Tensor | dict[str, torch.Tensor],
        edge_index: torch.Tensor,
    ) -> dict[str, torch.Tensor]:
        """Compute total physics-informed loss.

        Args:
            predictions: Dict with 'rainfall', 'temp_max', 'temp_min'.
                         Each: [num_nodes, forecast_horizon]
                        targets: Either:
                                         - [forecast_horizon, num_nodes, 3] ground truth tensor
                                             (last dim = [rainfall(0), temp_max(1), temp_min(2)])
                                         - dict with keys rainfall/temp_max/temp_min and shape
                                             [num_nodes, forecast_horizon] per value.
            edge_index: [2, num_edges] for smoothness computation.

        Returns:
            Dict with 'total_loss', 'prediction_loss', 'conservation_loss', 'smoothness_loss'.
        """
        # Rearrange predictions to [forecast_horizon, num_nodes, 3]
        pred_stacked = torch.stack([
            predictions["rainfall"].T,  # (horizon, num_nodes)
            predictions["temp_max"].T,
            predictions["temp_min"].T,
        ], dim=-1)  # (horizon, num_nodes, 3)

        if isinstance(targets, dict):
            targets = torch.stack([
                targets["rainfall"].T,
                targets["temp_max"].T,
                targets["temp_min"].T,
            ], dim=-1)

        # ── Prediction Loss (weighted MSE / focal) ──────────────────────────────
        pred_loss = torch.tensor(0.0, device=pred_stacked.device)
        for v_idx, var_name in enumerate(VARIABLE_ORDER):
            weight = self.variable_weights[var_name]
            var_pred = pred_stacked[..., v_idx]  # (horizon, num_nodes)
            var_true = targets[..., v_idx]
            valid = ~torch.isnan(var_true)
            if valid.sum() == 0:
                continue
            if var_name == "rainfall":
                # ── Rainfall loss: weighted MSE with heavy-tail emphasis ───────
                # Squared error (not absolute error) so the head estimates the
                # conditional MEAN — the quantity R² scores. See v3 note (1).
                mse = self._rain_loss(var_pred[valid], var_true[valid])

                if self.rain_occurrence_weight > 0.0:
                    # Optional wet/dry occurrence term (default off).
                    occ_logits = (var_pred[valid] - RAIN_WET_THRESHOLD) * 10.0
                    occ_true = (var_true[valid] > RAIN_WET_THRESHOLD).float()
                    occ_loss = F.binary_cross_entropy_with_logits(
                        occ_logits, occ_true, reduction="mean"
                    )
                    w_occ = self.rain_occurrence_weight
                    mse = (1.0 - w_occ) * mse + w_occ * occ_loss
            else:
                mse = F.mse_loss(var_pred[valid], var_true[valid], reduction="mean")
            pred_loss = pred_loss + weight * mse
        pred_loss = pred_loss / len(VARIABLE_ORDER)

        # ── Conservation Loss (water balance) ────────────────────────────────
        # Regional mean predicted rainfall vs observed
        rain_pred_mean = pred_stacked[..., 0].mean()  # scalar
        rain_true_mean = targets[..., 0]
        valid_rain = ~torch.isnan(rain_true_mean)
        if valid_rain.sum() > 0:
            rain_true_mean_val = rain_true_mean[valid_rain].mean()
            cons_loss = F.l1_loss(rain_pred_mean, rain_true_mean_val)
        else:
            cons_loss = torch.tensor(0.0, device=pred_stacked.device)

        # ── Smoothness Loss (temperature only — rainfall orographic gradients are physically real) ─
        smooth_loss = self._compute_smoothness_temp_only(pred_stacked, edge_index)

        # ── Total Loss ────────────────────────────────────────────────────────
        total = (
            pred_loss
            + self.lambda_conservation * cons_loss
            + self.lambda_smoothness * smooth_loss
        )

        return {
            "total_loss": total,
            "prediction_loss": pred_loss,
            "conservation_loss": cons_loss,
            "smoothness_loss": smooth_loss,
        }

    def _compute_smoothness_temp_only(
        self,
        pred_stacked: torch.Tensor,
        edge_index: torch.Tensor,
    ) -> torch.Tensor:
        """Smoothness on temperature ONLY. Rainfall is intentionally excluded —
        the Western Ghats orographic rain shadow creates exactly the sharp spatial
        gradients that the smoothness loss would incorrectly penalize."""
        src, dst = edge_index[0], edge_index[1]
        pred_mean = pred_stacked.mean(dim=0)  # [N, 3]

        # Only variables 1 (tmax) and 2 (tmin) — NOT 0 (rainfall)
        temp_src = pred_mean[src, 1:]   # [E, 2]
        temp_dst = pred_mean[dst, 1:]

        diff_sq = (temp_src - temp_dst) ** 2

        if self.ghats_ridge_mask is not None:
            ghats = self.ghats_ridge_mask.to(src.device)
            non_ridge = ~(ghats[src] | ghats[dst])
            if non_ridge.sum() > 0:
                return diff_sq[non_ridge].mean()
            return torch.tensor(0.0, device=pred_stacked.device)

        return diff_sq.mean()

    def _compute_smoothness(
        self,
        pred_stacked: torch.Tensor,
        edge_index: torch.Tensor,
    ) -> torch.Tensor:
        """Legacy: smoothness on all variables (kept for backward compatibility)."""
        return self._compute_smoothness_temp_only(pred_stacked, edge_index)


# ── V2 Loss Components ─────────────────────────────────────────────────────────

class TweedieLoss(nn.Module):
    """Tweedie deviance for zero-inflated rainfall (compound Poisson-gamma).

    Power p=1.5 is empirically optimal for daily precipitation.
    Automatically handles dry days (y=0) without clipping or special-casing.

    Reference: Jørgensen (1987), Pregibon (1984), Scheuerer & Hamill (2015 MWR).
    """

    def __init__(self, power: float = 1.5, epsilon: float = 1e-8):
        super().__init__()
        self.p = power
        self.eps = epsilon

    def forward(self, pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        p = self.p
        mu = torch.clamp(pred, min=self.eps)
        y  = torch.clamp(target, min=0.0)
        t1 = torch.where(y < self.eps, torch.zeros_like(y), y.pow(2.0 - p) / ((1.0 - p) * (2.0 - p)))
        t2 = y * mu.pow(1.0 - p) / (1.0 - p)
        t3 = mu.pow(2.0 - p) / (2.0 - p)
        deviance = 2.0 * (t1 - t2 + t3)
        valid = ~torch.isnan(target)
        return deviance[valid].mean() if valid.sum() > 0 else torch.tensor(0.0, device=pred.device)


class WeightedMSELoss(nn.Module):
    """Weighted squared error with heavy-rain emphasis, on z-score targets.

        w(y) = 1 + alpha * clamp(y / heavy_threshold, 0, 1)^2
        loss = mean( w(y) * (pred - y)^2 )

    Squared error is used deliberately: it is minimized by the conditional
    mean, which is the quantity R² scores. The previous weighted-MAE objective
    is minimized by the conditional median, which for zero-inflated rainfall
    sits at the dry value and collapses predictions to a constant field
    (measured R² ≈ 0.000 on real Western Ghats / North-East runs).

    ``heavy_threshold`` is in normalized z-score units, not mm/day.

    Reference: L1 → conditional median vs L2 → conditional mean, Hastie,
    Tibshirani & Friedman, Elements of Statistical Learning, eq. 2.11.
    """

    def __init__(self, alpha: float = 3.0, heavy_threshold: float = RAIN_HEAVY_Z_THRESHOLD):
        super().__init__()
        self.alpha = alpha
        self.heavy_threshold = heavy_threshold

    def forward(self, pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        valid = ~torch.isnan(target)
        if valid.sum() == 0:
            return torch.tensor(0.0, device=pred.device)
        p, y = pred[valid], target[valid]
        weight = 1.0 + self.alpha * torch.clamp(y / self.heavy_threshold, 0, 1).pow(2)
        return (weight * (p - y) ** 2).mean()


class WeightedCRPSLoss(nn.Module):
    """Weighted CRPS (deterministic = weighted MAE) with heavy-rain emphasis.

    RETAINED FOR ABLATION ONLY — not used by PhysicsInformedLoss by default.
    Minimizing absolute error estimates the conditional median, which collapses
    zero-inflated rainfall to a near-constant dry field. Use WeightedMSELoss.

    w(y) = 1 + alpha * clamp(y/threshold, 0, 1)^2
    Proper scoring rule → encourages calibrated probabilistic forecasts.

    Reference: Gneiting & Raftery (2007), Taillardat et al. (2016).
    """

    def __init__(self, alpha: float = 3.0, heavy_threshold: float = 20.0):
        super().__init__()
        self.alpha = alpha
        self.heavy_threshold = heavy_threshold

    def forward(self, pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        valid = ~torch.isnan(target)
        if valid.sum() == 0:
            return torch.tensor(0.0, device=pred.device)
        p, y = pred[valid], target[valid]
        weight = 1.0 + self.alpha * torch.clamp(y / self.heavy_threshold, 0, 1).pow(2)
        return (weight * torch.abs(p - y)).mean()

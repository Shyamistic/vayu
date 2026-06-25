"""Physics-informed loss function for climate prediction.

L_total = L_prediction + λ1 * L_conservation + λ2 * L_smoothness

- L_prediction:   Weighted loss per variable.
                  Rainfall: soft two-stage loss (occurrence BCE + asymmetric focal amount)
                  Temperature: MSE
- L_conservation: Water balance penalty (regional mean predicted ≈ observed)
- L_smoothness:   Spatial smoothness; Western Ghats ridge cells exempt.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


# Per-variable loss weights.
# Rainfall is 1.5× temperature because:
#   - It is the primary competition target for Western Ghats
#   - It has 5-10× harder prediction variance (zero-inflated, heavy-tailed)
#   - Higher weights destabilize training; 1.5 balances emphasis without explosion
VARIABLE_WEIGHTS = {
    "rainfall": 1.5,
    "temp_max": 1.0,
    "temp_min": 1.0,
}

# Focal regression gamma for rainfall.
# 1.0 = standard weighted MSE (no focal amplification).
# Higher gamma was causing gradient explosions under AMP; keeping at 1.0 for stability.
RAIN_FOCAL_GAMMA = 1.0

# Normalized threshold separating "dry" vs "wet" days (≈1 mm/day after z-score).
RAIN_WET_THRESHOLD = 0.1

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
        lambda_conservation: float = 0.1,
        lambda_smoothness: float = 0.05,
        ghats_ridge_mask: torch.Tensor | None = None,
    ):
        super().__init__()
        self.lambda_conservation = lambda_conservation
        self.lambda_smoothness = lambda_smoothness

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
            weight = VARIABLE_WEIGHTS[var_name]
            var_pred = pred_stacked[..., v_idx]  # (horizon, num_nodes)
            var_true = targets[..., v_idx]
            valid = ~torch.isnan(var_true)
            if valid.sum() == 0:
                continue
            if var_name == "rainfall":
                # ── Soft two-stage rainfall loss ─────────────────────────────
                # Stage 1: Occurrence (will it rain?)
                #   Use logits (pre-sigmoid) with BCE_with_logits for AMP compatibility.
                #   This is numerically more stable than sigmoid + BCE.
                occ_logits = (var_pred[valid] - RAIN_WET_THRESHOLD) * 10.0
                occ_true = (var_true[valid] > RAIN_WET_THRESHOLD).float()
                occ_loss = F.binary_cross_entropy_with_logits(occ_logits, occ_true, reduction="mean")

                # Stage 2: Amount (conditional on rain, focal)
                #   Focal weight emphasises heavy-rain events (gamma=1.0 = no amplification).
                #   Asymmetric penalty removed — it caused gradient instability.
                rain_pos = torch.clamp(var_true[valid], min=0.0)
                focal_w = (1.0 + rain_pos).pow(RAIN_FOCAL_GAMMA)
                focal_w = focal_w / (focal_w.mean() + 1e-8)
                residual = var_pred[valid] - var_true[valid]
                amt_loss = (focal_w * residual.pow(2)).mean()

                # Combine: equal weight on occurrence and amount
                mse = 0.5 * occ_loss + 0.5 * amt_loss
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

        # ── Smoothness Loss (spatial gradient penalty) ────────────────────────
        smooth_loss = self._compute_smoothness(pred_stacked, edge_index)

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

    def _compute_smoothness(
        self,
        pred_stacked: torch.Tensor,
        edge_index: torch.Tensor,
    ) -> torch.Tensor:
        """Mean squared difference between adjacent node predictions.

        Western Ghats ridge nodes are exempt from the penalty since large
        temperature/rainfall gradients there are physically expected.

        Args:
            pred_stacked: [horizon, num_nodes, 3]
            edge_index: [2, num_edges]

        Returns:
            Scalar smoothness loss.
        """
        src, dst = edge_index[0], edge_index[1]  # (num_edges,)

        # pred_stacked: (horizon, num_nodes, 3) → mean over horizon → (num_nodes, 3)
        pred_mean = pred_stacked.mean(dim=0)  # (num_nodes, 3)

        src_vals = pred_mean[src]  # (num_edges, 3)
        dst_vals = pred_mean[dst]

        diff_sq = (src_vals - dst_vals) ** 2  # (num_edges, 3)

        # Apply Ghats mask: exclude edges where source OR destination is on ridge
        if self.ghats_ridge_mask is not None:
            ghats = self.ghats_ridge_mask.to(src.device)
            ridge_edges = ghats[src] | ghats[dst]  # (num_edges,)
            non_ridge = ~ridge_edges
            if non_ridge.sum() > 0:
                return diff_sq[non_ridge].mean()
            return torch.tensor(0.0, device=pred_stacked.device)

        return diff_sq.mean()

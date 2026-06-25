"""Prediction heads: per-variable multi-step forecast outputs.

Three separate MLP heads produce 7-day forecasts for rainfall, tmax, tmin.
Using separate heads allows each variable to learn its own output distribution
(e.g., rainfall is non-negative, temperature is unbounded).

Key design: **Persistence skip connection** — each head receives the last-day
observed value and learns a DELTA (residual) on top of it. This gives the model
a free persistence baseline and only needs to learn the innovation/change.
This is equivalent to ResNet for climate: the model starts at persistence R²
(0.91 for tmax!) and can only improve from there.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class SingleVariableHead(nn.Module):
    """MLP output head for a single climate variable with persistence residual.

    Architecture:
        - Concat(temporal_context, last_day_value) → hidden → GELU → delta
        - output = last_day_value (broadcast to horizon) + learned_delta

    The head learns a CORRECTION on top of persistence, not the absolute value.
    """

    def __init__(self, d_model: int = 256, forecast_horizon: int = 7, dropout: float = 0.1):
        super().__init__()
        hidden = d_model // 2
        # Input: d_model (transformer context) + 1 (last observed value)
        self.net = nn.Sequential(
            nn.Linear(d_model + 1, hidden),
            nn.GELU(),
            nn.Dropout(p=dropout),
            nn.Linear(hidden, forecast_horizon),
        )
        # Initialize last layer near zero so initial predictions ≈ persistence
        nn.init.zeros_(self.net[-1].weight)
        nn.init.zeros_(self.net[-1].bias)

    def forward(self, ctx: torch.Tensor, last_value: torch.Tensor) -> torch.Tensor:
        """
        Args:
            ctx: [num_nodes, d_model] — temporal context from transformer
            last_value: [num_nodes, 1] — last observed value of this variable
        Returns:
            [num_nodes, forecast_horizon]
        """
        x = torch.cat([ctx, last_value], dim=-1)  # (num_nodes, d_model+1)
        delta = self.net(x)  # (num_nodes, horizon)
        # Persistence baseline: repeat last value across horizon
        persistence = last_value.expand(-1, delta.shape[-1])  # (num_nodes, horizon)
        return persistence + delta


class PredictionHeads(nn.Module):
    """Three output heads for rainfall, tmax, tmin multi-step prediction.

    Each head uses a persistence skip connection — the model learns
    corrections on top of the last observed value, not absolute predictions.
    Rainfall output is clamped to non-negative (physical constraint).
    """

    VARIABLES = ["rainfall", "temp_max", "temp_min"]
    # Channel indices in the input feature tensor for each target variable
    VARIABLE_CHANNELS = {"rainfall": 0, "temp_max": 1, "temp_min": 2}

    def __init__(
        self,
        d_model: int = 256,
        forecast_horizon: int = 7,
        dropout: float = 0.1,
    ):
        super().__init__()
        self.forecast_horizon = forecast_horizon
        self.heads = nn.ModuleDict({
            var: SingleVariableHead(d_model, forecast_horizon, dropout)
            for var in self.VARIABLES
        })

    def forward(
        self,
        temporal_context: torch.Tensor,
        last_input: torch.Tensor | None = None,
    ) -> dict[str, torch.Tensor]:
        """Produce multi-step forecasts for all variables.

        Args:
            temporal_context: [num_nodes, d_model]
            last_input: [num_nodes, in_features] — last timestep features.
                        If None, uses zero (no persistence shortcut).

        Returns:
            Dict with keys 'rainfall', 'temp_max', 'temp_min'.
            Each value: [num_nodes, forecast_horizon]
        """
        results = {}
        for var in self.VARIABLES:
            ch = self.VARIABLE_CHANNELS[var]
            if last_input is not None:
                last_val = last_input[:, ch:ch+1]  # (num_nodes, 1)
            else:
                last_val = torch.zeros(
                    temporal_context.shape[0], 1,
                    device=temporal_context.device, dtype=temporal_context.dtype,
                )
            pred = self.heads[var](temporal_context, last_val)
            # Physical constraint: rainfall cannot be negative
            if var == "rainfall":
                pred = F.relu(pred)
            results[var] = pred
        return results

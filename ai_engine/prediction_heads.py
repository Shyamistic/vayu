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
    """Deep MLP output head for a single climate variable with persistence residual.

    Architecture:
        - Concat(temporal_context, last_day_value, trend_feature) → hidden layers → delta
        - output = last_day_value (broadcast to horizon) + learned_delta

    The head learns a CORRECTION on top of persistence, not the absolute value.
    Three-layer MLP with residual connection allows learning complex non-linear
    corrections while the zero-initialization ensures safe start from persistence.
    """

    def __init__(self, d_model: int = 256, forecast_horizon: int = 7, dropout: float = 0.1):
        super().__init__()
        hidden = d_model // 2
        # Input: d_model (transformer context) + 1 (last observed value) + 1 (trend)
        self.proj = nn.Linear(d_model + 2, hidden)
        self.act1 = nn.GELU()
        self.drop1 = nn.Dropout(p=dropout)

        # Second hidden layer with residual
        self.fc2 = nn.Linear(hidden, hidden)
        self.act2 = nn.GELU()
        self.drop2 = nn.Dropout(p=dropout)
        self.norm = nn.LayerNorm(hidden)

        # Output projection
        self.out = nn.Linear(hidden, forecast_horizon)
        # Initialize last layer near zero so initial predictions ≈ persistence
        nn.init.zeros_(self.out.weight)
        nn.init.zeros_(self.out.bias)

    def forward(self, ctx: torch.Tensor, last_value: torch.Tensor, trend: torch.Tensor | None = None) -> torch.Tensor:
        """
        Args:
            ctx: [num_nodes, d_model] — temporal context from transformer
            last_value: [num_nodes, 1] — last observed value of this variable
            trend: [num_nodes, 1] — linear trend over input window (optional)
        Returns:
            [num_nodes, forecast_horizon]
        """
        if trend is None:
            trend = torch.zeros_like(last_value)
        x = torch.cat([ctx, last_value, trend], dim=-1)  # (num_nodes, d_model+2)

        # Three-layer MLP with residual
        h = self.proj(x)
        h = self.act1(h)
        h = self.drop1(h)

        residual = h
        h = self.fc2(h)
        h = self.act2(h)
        h = self.drop2(h)
        h = self.norm(h + residual)  # residual connection + LayerNorm

        delta = self.out(h)  # (num_nodes, horizon)
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
        full_input: torch.Tensor | None = None,
    ) -> dict[str, torch.Tensor]:
        """Produce multi-step forecasts for all variables.

        Args:
            temporal_context: [num_nodes, d_model]
            last_input: [num_nodes, in_features] — last timestep features.
                        If None, uses zero (no persistence shortcut).
            full_input: [num_nodes, seq_len, in_features] — full input sequence
                        for computing trend features. If None, no trend passed.

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
            # Compute linear trend over the input window for this variable
            trend = None
            if full_input is not None and full_input.dim() == 3:
                # full_input: (num_nodes, seq_len, features)
                seq = full_input[:, :, ch]  # (num_nodes, seq_len)
                # Simple trend: (last - first) / seq_len  (normalized slope)
                trend = (seq[:, -1:] - seq[:, 0:1]) / max(seq.shape[1], 1)

            pred = self.heads[var](temporal_context, last_val, trend)
            # Physical constraint: rainfall cannot be negative
            if var == "rainfall":
                pred = F.relu(pred)
            results[var] = pred
        return results

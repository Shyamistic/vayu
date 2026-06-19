"""Prediction heads: per-variable multi-step forecast outputs.

Three separate MLP heads produce 7-day forecasts for rainfall, tmax, tmin.
Using separate heads allows each variable to learn its own output distribution
(e.g., rainfall is non-negative, temperature is unbounded).
"""

from __future__ import annotations

import torch
import torch.nn as nn


class SingleVariableHead(nn.Module):
    """MLP output head for a single climate variable.

    Architecture: Linear(d_model → d_model//2) + GELU + Linear(→ forecast_horizon)
    """

    def __init__(self, d_model: int = 256, forecast_horizon: int = 7, dropout: float = 0.1):
        super().__init__()
        hidden = d_model // 2
        self.net = nn.Sequential(
            nn.Linear(d_model, hidden),
            nn.GELU(),
            nn.Dropout(p=dropout),
            nn.Linear(hidden, forecast_horizon),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: [num_nodes, d_model]
        Returns:
            [num_nodes, forecast_horizon]
        """
        return self.net(x)


class PredictionHeads(nn.Module):
    """Three output heads for rainfall, tmax, tmin multi-step prediction.

    Each head is a small MLP that maps temporal context → 7-day forecast.
    Separate heads ensure variable-specific calibration.
    """

    VARIABLES = ["rainfall", "temp_max", "temp_min"]

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
        self, temporal_context: torch.Tensor
    ) -> dict[str, torch.Tensor]:
        """Produce multi-step forecasts for all variables.

        Args:
            temporal_context: [num_nodes, d_model]

        Returns:
            Dict with keys 'rainfall', 'temp_max', 'temp_min'.
            Each value: [num_nodes, forecast_horizon]
        """
        return {var: head(temporal_context) for var, head in self.heads.items()}

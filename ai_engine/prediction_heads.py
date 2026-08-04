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

    def __init__(
        self,
        d_model: int = 256,
        forecast_horizon: int = 7,
        dropout: float = 0.1,
        persistence_init: float = 1.0,
        climatology_init: float = 0.0,
    ):
        super().__init__()
        hidden = d_model // 2
        # Learned baseline blend: baseline = w_p * persistence + w_c * climatology.
        # Measured on real WG 2022 validation data (normalized space):
        #   variable | persistence | day-of-year climatology | 50/50 blend
        #   rainfall |      -0.303 |                  +0.215 |      +0.153
        #   tmax     |      +0.722 |                  +0.739 |      +0.796
        #   tmin     |      +0.721 |                  +0.776 |      +0.804
        # Anchoring rainfall to persistence alone starts the head at R² = -0.30
        # and forces it to learn to cancel its own skip connection; anchoring on
        # climatology starts it above the 0.20 target instead. Both weights are
        # learnable so the model can re-balance per region.
        self.w_persistence = nn.Parameter(torch.tensor(float(persistence_init)))
        self.w_climatology = nn.Parameter(torch.tensor(float(climatology_init)))
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

    def forward(
        self,
        ctx: torch.Tensor,
        last_value: torch.Tensor,
        trend: torch.Tensor | None = None,
        clim_future: torch.Tensor | None = None,
    ) -> torch.Tensor:
        """
        Args:
            ctx: [num_nodes, d_model] — temporal context from transformer
            last_value: [num_nodes, 1] — last observed value of this variable
            trend: [num_nodes, 1] — linear trend over input window (optional)
            clim_future: [num_nodes, forecast_horizon] — day-of-year climatology
                for the target days, fitted on TRAINING YEARS ONLY. Known ahead
                of time (it is a function of calendar date), so using it is not
                leakage. When None the head falls back to pure persistence.
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

        if clim_future is None:
            baseline = persistence
        else:
            baseline = (
                self.w_persistence * persistence
                + self.w_climatology * clim_future.to(delta.dtype)
            )
        return baseline + delta


class PredictionHeads(nn.Module):
    """Three output heads for rainfall, tmax, tmin multi-step prediction.

    Each head uses a persistence skip connection — the model learns
    corrections on top of the last observed value, not absolute predictions.

    v3: the rainfall ReLU clamp is OFF by default (``clamp_rain_nonnegative``).
    Targets are per-cell z-scores, in which dry days are NEGATIVE (measured on
    real Western Ghats data: 45.4% of rainfall targets are < 0, range
    [-0.65, +8.61]). Forcing the output to be non-negative therefore made the
    dry half of the distribution unrepresentable and pinned predictions at
    exactly 0 — the normalized mean — which scores R² ≈ 0. An oracle whose
    output passes through ReLU caps at R² = 0.905 on that same data, so the
    clamp is a real ceiling, and combined with the old median-seeking loss it
    produced the observed R²_rain ≈ 0.000.

    Set ``clamp_rain_nonnegative=True`` only when the head emits rainfall in
    PHYSICAL units (mm/day), where non-negativity is the correct constraint.
    """

    VARIABLES = ["rainfall", "temp_max", "temp_min"]
    # Channel indices in the input feature tensor for each target variable
    VARIABLE_CHANNELS = {"rainfall": 0, "temp_max": 1, "temp_min": 2}

    # Initial baseline blend (w_persistence, w_climatology) per variable.
    # Chosen from a weight scan on 2022 validation data for ALL FOUR regions
    # (scripts/skill_ceiling_probe.py). The optimum is remarkably stable across
    # regions, which is why one shared initialization is used rather than
    # per-region values — and the weights are learnable, so each region refines
    # them during training.
    #
    #   region          | best w_persist rain | tmax | tmin
    #   western_ghats   |                0.15 | 0.45 | 0.40
    #   north_east      |                0.15 | 0.50 | 0.55
    #   indo_gangetic   |                0.10 | 0.45 | 0.40
    #   central_india   |                0.10 | 0.40 | 0.40
    #
    # Rainfall leans almost entirely on climatology because persistence is
    # actively harmful for it (R² between -0.30 and -0.49 across regions).
    BASELINE_INIT = {
        "rainfall": (0.12, 0.88),
        "temp_max": (0.45, 0.55),
        "temp_min": (0.45, 0.55),
    }

    def __init__(
        self,
        d_model: int = 256,
        forecast_horizon: int = 7,
        dropout: float = 0.1,
        clamp_rain_nonnegative: bool = False,
    ):
        super().__init__()
        self.forecast_horizon = forecast_horizon
        self.clamp_rain_nonnegative = bool(clamp_rain_nonnegative)
        self.heads = nn.ModuleDict({
            var: SingleVariableHead(
                d_model,
                forecast_horizon,
                dropout,
                persistence_init=self.BASELINE_INIT[var][0],
                climatology_init=self.BASELINE_INIT[var][1],
            )
            for var in self.VARIABLES
        })

    def forward(
        self,
        temporal_context: torch.Tensor,
        last_input: torch.Tensor | None = None,
        full_input: torch.Tensor | None = None,
        clim_future: torch.Tensor | None = None,
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

            # clim_future: (num_nodes, horizon, 3) → this variable's slice
            var_clim = None
            if clim_future is not None:
                var_clim = clim_future[..., ch] if clim_future.dim() == 3 else clim_future

            pred = self.heads[var](temporal_context, last_val, trend, clim_future=var_clim)
            # Non-negativity applies to PHYSICAL rainfall only. On normalized
            # z-score targets dry days are negative, so clamping here destroys
            # 45% of the distribution — see class docstring.
            if var == "rainfall" and self.clamp_rain_nonnegative:
                pred = F.relu(pred)
            results[var] = pred
        return results

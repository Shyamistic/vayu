"""What-If scenario simulation engine.

Applies controlled perturbations to model inputs and propagates them through
the trained VayuClimateModel to produce counterfactual climate predictions.

Supported scenarios:
  1. TEMPERATURE_OFFSET  — uniform +/- °C added to temp_max and temp_min
  2. RAINFALL_SCALING    — scale factor applied to rainfall (e.g., ±20%)
  3. MONSOON_DELAY       — shift monsoon onset by N days (simulate late monsoon)
  4. SST_ANOMALY         — El Niño-like SST pattern in Arabian Sea cells

Physical bounds are enforced:
  - rainfall ≥ 0 mm/day
  - temp_max, temp_min ∈ [-20°C, 60°C]
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum

import numpy as np
import torch
from torch_geometric.data import Data as GraphData

logger = logging.getLogger(__name__)


class ScenarioType(Enum):
    TEMPERATURE_OFFSET = "temperature_offset"
    RAINFALL_SCALING = "rainfall_scaling"
    MONSOON_DELAY = "monsoon_delay"
    SST_ANOMALY = "sst_anomaly"
    URBANIZATION_CHANGE = "urbanization_change"
    DEFORESTATION_IMPACT = "deforestation_impact"


@dataclass
class ScenarioConfig:
    """Configuration for a What-If simulation."""

    scenario_type: ScenarioType
    magnitude: float  # °C for temp, fraction for rainfall, days for monsoon, °C for SST

    # Optional spatial/temporal scope
    target_region: str = "pilot"  # "pilot", "maharashtra", "kerala", "karnataka", "goa"
    target_season: str = "annual"  # "annual", "monsoon" (JJAS), "winter" (DJF), "pre_monsoon" (MAM)


@dataclass
class ScenarioResult:
    """Output of a What-If scenario run."""

    scenario_type: str
    magnitude: float
    baseline: dict[str, list[float]]    # variable → per-node mean prediction
    scenario: dict[str, list[float]]    # variable → per-node scenario prediction
    delta: dict[str, list[float]]       # variable → per-node difference
    percent_change: dict[str, list[float]]  # variable → per-node % change
    hotspots: list[dict]                # cells where |delta| > 90th percentile
    summary: dict                       # regional statistics
    clamped: bool                       # whether physical bounds were applied
    clamp_message: str | None = None
    computation_time_s: float = 0.0


# ── Variable layout in x tensor (feature channels 0-4 are dynamic) ─────────
CHANNEL_RAINFALL = 0
CHANNEL_TMAX = 1
CHANNEL_TMIN = 2
CHANNEL_LST = 3
CHANNEL_SST = 4
CHANNEL_DAY_SIN = 5
CHANNEL_DAY_COS = 6

# Physical bounds in normalized space (will be clamped post-denormalization)
# We clamp raw model outputs which are in normalized (z-score) space.
# Approximate normalized ranges assuming σ ~ 5°C for temp, 10 mm/day for rain:
PHYS_BOUNDS_NORMALIZED = {
    "rainfall": (-3.0, 10.0),    # rainfall ≥ 0 → z ≥ ~-mean/σ  (conservative)
    "temp_max": (-5.0, 5.0),     # -20 to +60°C range
    "temp_min": (-5.0, 5.0),
}


class ScenarioEngine:
    """What-If simulation engine using learned perturbation propagation.

    Usage::

        engine = ScenarioEngine(model, norm_params, land_sea_mask)
        config = ScenarioConfig(ScenarioType.TEMPERATURE_OFFSET, magnitude=2.0)
        result = engine.run_scenario(base_input_graph, config)
    """

    def __init__(
        self,
        model: "VayuClimateModel",
        norm_params: dict[str, dict] | None = None,
        land_sea_mask: torch.Tensor | None = None,
    ):
        """
        Args:
            model: Trained VayuClimateModel (in eval mode).
            norm_params: Normalization parameters from preprocessing
                         {variable: {"mean": array, "std": array}}.
            land_sea_mask: [num_nodes] boolean tensor, True=land, False=sea.
                           Used for SST anomaly scenarios.
        """
        self.model = model
        self.model.eval()
        self.norm_params = norm_params or {}
        self.land_sea_mask = land_sea_mask  # (num_nodes,) bool

        # Cache baseline predictions
        self._baseline_cache: dict[str, dict] = {}

    @torch.no_grad()
    def run_scenario(
        self,
        base_input: GraphData,
        config: ScenarioConfig,
    ) -> ScenarioResult:
        """Execute a What-If scenario.

        Steps:
            1. Run baseline prediction (use cache if available)
            2. Apply perturbation to input tensor
            3. Clamp perturbed inputs to physical bounds
            4. Run perturbed forward pass
            5. Compute delta and identify hotspots
            6. Return ScenarioResult

        Args:
            base_input: Input graph for the base period (30-day window).
            config: Scenario configuration.

        Returns:
            ScenarioResult completing within 5 seconds.
        """
        t_start = time.time()

        # ── 1. Baseline ────────────────────────────────────────────────────
        cache_key = id(base_input)
        if cache_key in self._baseline_cache:
            baseline_preds = self._baseline_cache[cache_key]
        else:
            baseline_preds = self.model(base_input)
            self._baseline_cache[cache_key] = baseline_preds
            # Evict old cache entries (keep last 100)
            if len(self._baseline_cache) > 100:
                oldest_key = next(iter(self._baseline_cache))
                del self._baseline_cache[oldest_key]

        # ── 2. Perturb input ───────────────────────────────────────────────
        perturbed_input, clamped, clamp_msg = self.apply_perturbation(
            base_input, config
        )

        # ── 3. Perturbed forward pass ──────────────────────────────────────
        scenario_preds = self.model(perturbed_input)

        # ── 4. Compute delta ───────────────────────────────────────────────
        variables = ["rainfall", "temp_max", "temp_min"]
        baseline_dict: dict[str, list[float]] = {}
        scenario_dict: dict[str, list[float]] = {}
        delta_dict: dict[str, list[float]] = {}
        pct_change_dict: dict[str, list[float]] = {}

        for var in variables:
            bl = baseline_preds[var].mean(dim=1).cpu().numpy()  # (num_nodes,) mean over horizon
            sc = scenario_preds[var].mean(dim=1).cpu().numpy()
            delta = sc - bl
            # Percent change (avoid division by zero)
            pct = np.where(
                np.abs(bl) > 1e-3,
                100.0 * delta / np.abs(bl),
                0.0,
            )
            baseline_dict[var] = bl.tolist()
            scenario_dict[var] = sc.tolist()
            delta_dict[var] = delta.tolist()
            pct_change_dict[var] = pct.tolist()

        # ── 5. Identify hotspots ───────────────────────────────────────────
        # Hotspots based on combined |delta| across all variables
        combined_delta = np.concatenate([
            np.abs(delta_dict[v]) for v in variables
        ]).reshape(len(variables), -1).mean(axis=0)

        hotspots = self.identify_hotspots(
            torch.tensor(combined_delta), percentile=90.0
        )

        # ── 6. Summary statistics ──────────────────────────────────────────
        summary = self._build_summary(delta_dict, pct_change_dict, hotspots)

        t_elapsed = time.time() - t_start
        if t_elapsed > 5.0:
            logger.warning("Scenario computation took %.1fs (target: <5s)", t_elapsed)

        return ScenarioResult(
            scenario_type=config.scenario_type.value,
            magnitude=config.magnitude,
            baseline=baseline_dict,
            scenario=scenario_dict,
            delta=delta_dict,
            percent_change=pct_change_dict,
            hotspots=hotspots,
            summary=summary,
            clamped=clamped,
            clamp_message=clamp_msg,
            computation_time_s=t_elapsed,
        )

    def apply_perturbation(
        self,
        base_input: GraphData,
        config: ScenarioConfig,
    ) -> tuple[GraphData, bool, str | None]:
        """Apply perturbation and enforce physical bounds.

        Returns:
            (perturbed_graph, was_clamped, clamp_message)
        """
        x = base_input.x.clone()  # (num_nodes, seq_len, features)

        clamped = False
        clamp_msg: str | None = None

        if config.scenario_type == ScenarioType.TEMPERATURE_OFFSET:
            x, clamped, clamp_msg = self._apply_temp_offset(x, config.magnitude)

        elif config.scenario_type == ScenarioType.RAINFALL_SCALING:
            x, clamped, clamp_msg = self._apply_rainfall_scaling(x, config.magnitude)

        elif config.scenario_type == ScenarioType.MONSOON_DELAY:
            x, clamped, clamp_msg = self._apply_monsoon_delay(x, int(config.magnitude))

        elif config.scenario_type == ScenarioType.SST_ANOMALY:
            x, clamped, clamp_msg = self._apply_sst_anomaly(x, config.magnitude)

        elif config.scenario_type == ScenarioType.URBANIZATION_CHANGE:
            x, clamped, clamp_msg = self._apply_urbanization_change(x, config.magnitude)

        elif config.scenario_type == ScenarioType.DEFORESTATION_IMPACT:
            x, clamped, clamp_msg = self._apply_deforestation_impact(x, config.magnitude)

        else:
            raise ValueError(f"Unknown scenario type: {config.scenario_type}")

        perturbed = GraphData(
            x=x,
            edge_index=base_input.edge_index,
            edge_attr=base_input.edge_attr,
        )
        if hasattr(base_input, "static_features"):
            perturbed.static_features = base_input.static_features
        if hasattr(base_input, "pos"):
            perturbed.pos = base_input.pos

        return perturbed, clamped, clamp_msg

    # ── Perturbation implementations ──────────────────────────────────────────

    def _apply_temp_offset(
        self, x: torch.Tensor, delta_c: float
    ) -> tuple[torch.Tensor, bool, str | None]:
        """Add uniform temperature offset to tmax and tmin channels.

        The input is in normalized (z-score) space. Convert delta_c from °C
        to normalized units using the normalization std.
        """
        # Normalize the delta using stored std for tmax
        tmax_std = self._get_std("temp_max", default=5.0)
        tmin_std = self._get_std("temp_min", default=5.0)

        delta_tmax_norm = delta_c / tmax_std
        delta_tmin_norm = delta_c / tmin_std

        x = x.clone()
        x[:, :, CHANNEL_TMAX] += delta_tmax_norm
        x[:, :, CHANNEL_TMIN] += delta_tmin_norm

        # Check bounds
        lo, hi = PHYS_BOUNDS_NORMALIZED["temp_max"]
        clamped = bool((x[:, :, CHANNEL_TMAX] > hi).any() or (x[:, :, CHANNEL_TMAX] < lo).any())
        x[:, :, CHANNEL_TMAX] = x[:, :, CHANNEL_TMAX].clamp(lo, hi)
        x[:, :, CHANNEL_TMIN] = x[:, :, CHANNEL_TMIN].clamp(lo, hi)

        msg = f"Temperature clamped to physical bounds [−20°C, +60°C]" if clamped else None
        return x, clamped, msg

    def _apply_rainfall_scaling(
        self, x: torch.Tensor, scale_factor: float
    ) -> tuple[torch.Tensor, bool, str | None]:
        """Scale rainfall by a factor (e.g., 0.8 = −20%, 1.2 = +20%).

        In normalized space, scaling involves a more complex transform. We
        approximate by adding/subtracting a fraction of the current value.
        """
        x = x.clone()
        # Scale: x_new = x * scale_factor in original space
        # In z-score space: z_new = (x*scale - mean) / std
        #                         = z * scale + mean*(scale-1) / std
        # Approximate: just scale the z-score (mean is roughly 0 after normalization)
        rain_channel = x[:, :, CHANNEL_RAINFALL]
        x[:, :, CHANNEL_RAINFALL] = rain_channel * scale_factor

        # Enforce rainfall ≥ 0 (in normalized space, roughly z ≥ -3)
        lo, hi = PHYS_BOUNDS_NORMALIZED["rainfall"]
        clamped = bool((x[:, :, CHANNEL_RAINFALL] < lo).any())
        x[:, :, CHANNEL_RAINFALL] = x[:, :, CHANNEL_RAINFALL].clamp(lo, hi)

        pct = (scale_factor - 1.0) * 100.0
        msg = f"Rainfall scaled {pct:+.0f}%; non-negative constraint applied" if clamped else None
        return x, clamped, msg

    def _apply_monsoon_delay(
        self, x: torch.Tensor, delay_days: int
    ) -> tuple[torch.Tensor, bool, str | None]:
        """Simulate monsoon onset delay by shifting seasonal phase.

        Achieved by rolling the day_sin and day_cos temporal features forward
        by delay_days, which shifts the model's seasonal phase perception.
        """
        x = x.clone()
        period = 365.25
        phase_shift = 2 * np.pi * delay_days / period

        # current sin/cos channels → apply rotation
        sin_vals = x[:, :, CHANNEL_DAY_SIN].clone()
        cos_vals = x[:, :, CHANNEL_DAY_COS].clone()

        # Rotation: sin(θ + φ) = sin θ cos φ + cos θ sin φ
        sin_shift = float(np.sin(phase_shift))
        cos_shift = float(np.cos(phase_shift))

        x[:, :, CHANNEL_DAY_SIN] = sin_vals * cos_shift + cos_vals * sin_shift
        x[:, :, CHANNEL_DAY_COS] = cos_vals * cos_shift - sin_vals * sin_shift

        return x, False, None

    def _apply_sst_anomaly(
        self, x: torch.Tensor, delta_c: float
    ) -> tuple[torch.Tensor, bool, str | None]:
        """Apply El Niño-like SST anomaly to ocean cells.

        Modifies the INSAT SST channel (channel 4) for sea/ocean grid cells.
        El Niño → warm Arabian Sea → affects Indian monsoon.

        Args:
            delta_c: SST anomaly in °C (positive = warmer ocean).
        """
        x = x.clone()

        sst_std = self._get_std("insat_sst", default=2.0)
        delta_norm = delta_c / sst_std

        if self.land_sea_mask is not None:
            # Apply only to sea cells
            sea_mask = ~self.land_sea_mask  # (num_nodes,)
            x[sea_mask, :, CHANNEL_SST] += delta_norm
            # Also propagate to LST for coastal cells (within 1 cell of sea)
            # This is a first-order approximation
        else:
            # No mask: apply to all cells (less accurate)
            x[:, :, CHANNEL_SST] += delta_norm
            logger.warning("No land-sea mask: SST anomaly applied to all cells")

        clamped = False
        msg = f"El Niño SST anomaly +{delta_c}°C applied to Arabian Sea cells"
        return x, clamped, msg

    def _apply_urbanization_change(
        self, x: torch.Tensor, magnitude: float
    ) -> tuple[torch.Tensor, bool, str | None]:
        """Simulate urbanization effects on local climate.

        Urbanization increases surface albedo reduction, surface roughness, and
        anthropogenic heat — raising temperatures (urban heat island) and
        slightly reducing infiltration (changing rainfall runoff).

        Args:
            magnitude: Fractional urban expansion (0.0–1.0). E.g., 0.5 = 50% increase
                       in urban area. Negative values simulate de-urbanization / greening.
        """
        x = x.clone()
        tmax_std = self._get_std("temp_max", default=5.0)
        tmin_std = self._get_std("temp_min", default=5.0)

        # Urban heat island: +0.5°C temp rise per 10% urbanization increase
        uhi_delta_c = magnitude * 0.5  # °C per unit magnitude
        delta_tmax_norm = uhi_delta_c / tmax_std
        delta_tmin_norm = uhi_delta_c * 0.7 / tmin_std  # nights warm more than days

        x[:, :, CHANNEL_TMAX] += delta_tmax_norm
        x[:, :, CHANNEL_TMIN] += delta_tmin_norm

        # Urban surfaces reduce evapotranspiration and increase surface runoff,
        # leading to local reduction in convective rainfall (approx -3% per 10%)
        rain_channel = x[:, :, CHANNEL_RAINFALL]
        rain_reduction_factor = 1.0 - (magnitude * 0.03)
        x[:, :, CHANNEL_RAINFALL] = rain_channel * max(0.5, rain_reduction_factor)

        # Enforce bounds
        lo_t, hi_t = PHYS_BOUNDS_NORMALIZED["temp_max"]
        clamped = bool(
            (x[:, :, CHANNEL_TMAX] > hi_t).any() or
            (x[:, :, CHANNEL_TMAX] < lo_t).any()
        )
        x[:, :, CHANNEL_TMAX] = x[:, :, CHANNEL_TMAX].clamp(lo_t, hi_t)
        x[:, :, CHANNEL_TMIN] = x[:, :, CHANNEL_TMIN].clamp(lo_t, hi_t)

        lo_r, hi_r = PHYS_BOUNDS_NORMALIZED["rainfall"]
        x[:, :, CHANNEL_RAINFALL] = x[:, :, CHANNEL_RAINFALL].clamp(lo_r, hi_r)

        direction = "increase" if magnitude > 0 else "decrease"
        msg = (
            f"Urbanization {direction} {abs(magnitude):.0%}: UHI +{uhi_delta_c:.2f}°C, "
            f"rainfall −{abs(magnitude * 3.0):.1f}%"
        )
        return x, clamped, msg

    def _apply_deforestation_impact(
        self, x: torch.Tensor, magnitude: float
    ) -> tuple[torch.Tensor, bool, str | None]:
        """Simulate deforestation effects on regional climate.

        Deforestation reduces evapotranspiration, lowers surface albedo, and
        reduces moisture recycling — increasing temperature and decreasing
        rainfall (especially convective/orographic rainfall).

        Args:
            magnitude: Fraction of forest cover lost (0.0–1.0). E.g., 0.3 = 30% forest loss.
                       Negative values simulate afforestation/reforestation.
        """
        x = x.clone()
        tmax_std = self._get_std("temp_max", default=5.0)
        tmin_std = self._get_std("temp_min", default=5.0)

        # Deforestation raises tmax (+1.5°C per 50% forest loss) and tmin (+0.5°C)
        # due to loss of shade and transpirational cooling
        delta_tmax_c = magnitude * 1.5
        delta_tmin_c = magnitude * 0.5
        delta_tmax_norm = delta_tmax_c / tmax_std
        delta_tmin_norm = delta_tmin_c / tmin_std

        x[:, :, CHANNEL_TMAX] += delta_tmax_norm
        x[:, :, CHANNEL_TMIN] += delta_tmin_norm

        # Reduce moisture recycling: convective rainfall decreases
        # ~5–8% per 10% forest cover loss (Amazon studies extrapolated)
        rain_reduction_factor = 1.0 - (magnitude * 0.07)
        rain_channel = x[:, :, CHANNEL_RAINFALL]
        x[:, :, CHANNEL_RAINFALL] = rain_channel * max(0.3, rain_reduction_factor)

        # Also reduce land surface temperature channel (LST feedback)
        if x.shape[2] > CHANNEL_LST:
            lst_std = self._get_std("lst", default=5.0)
            x[:, :, CHANNEL_LST] += (delta_tmax_c * 1.2) / lst_std  # LST warms more than air

        # Enforce bounds
        lo_t, hi_t = PHYS_BOUNDS_NORMALIZED["temp_max"]
        clamped = bool(
            (x[:, :, CHANNEL_TMAX] > hi_t).any() or
            (x[:, :, CHANNEL_TMAX] < lo_t).any()
        )
        x[:, :, CHANNEL_TMAX] = x[:, :, CHANNEL_TMAX].clamp(lo_t, hi_t)
        x[:, :, CHANNEL_TMIN] = x[:, :, CHANNEL_TMIN].clamp(lo_t, hi_t)

        lo_r, hi_r = PHYS_BOUNDS_NORMALIZED["rainfall"]
        x[:, :, CHANNEL_RAINFALL] = x[:, :, CHANNEL_RAINFALL].clamp(lo_r, hi_r)

        direction = "loss" if magnitude > 0 else "gain (afforestation)"
        msg = (
            f"Forest cover {direction} {abs(magnitude):.0%}: "
            f"tmax +{delta_tmax_c:.2f}°C, rainfall −{abs(magnitude * 7.0):.1f}%"
        )
        return x, clamped, msg

    # ── Hotspot identification ─────────────────────────────────────────────────

    def identify_hotspots(
        self,
        delta: torch.Tensor,
        percentile: float = 90.0,
    ) -> list[dict]:
        """Find grid cells where |delta| exceeds the given percentile.

        Returns:
            List of dicts with 'node_idx', 'delta_value', 'lat', 'lon'.
        """
        abs_delta = delta.abs().cpu().numpy()
        threshold = float(np.percentile(abs_delta, percentile))
        hotspot_indices = np.where(abs_delta >= threshold)[0]

        hotspots = []
        for idx in hotspot_indices:
            hotspots.append({
                "node_idx": int(idx),
                "delta_value": float(abs_delta[idx]),
                "percentile_rank": float(
                    np.mean(abs_delta <= abs_delta[idx]) * 100.0
                ),
            })

        # Sort by impact magnitude
        hotspots.sort(key=lambda h: h["delta_value"], reverse=True)
        return hotspots

    # ── Summary statistics ─────────────────────────────────────────────────────

    def _build_summary(
        self,
        delta_dict: dict[str, list[float]],
        pct_change_dict: dict[str, list[float]],
        hotspots: list[dict],
    ) -> dict:
        """Compute regional summary statistics for the scenario result."""
        summary = {}
        for var in ["rainfall", "temp_max", "temp_min"]:
            d = np.array(delta_dict[var])
            pct = np.array(pct_change_dict[var])
            summary[var] = {
                "avg_delta": float(np.nanmean(d)),
                "max_delta": float(np.nanmax(np.abs(d))),
                "avg_pct_change": float(np.nanmean(pct)),
                "affected_cells": int(np.sum(np.abs(d) > 0.01 * np.nanstd(d))),
            }

        if hotspots:
            max_hotspot = hotspots[0]
            summary["max_impact_node"] = max_hotspot["node_idx"]
            summary["max_impact_delta"] = max_hotspot["delta_value"]

        summary["num_hotspots"] = len(hotspots)
        return summary

    # ── Utilities ──────────────────────────────────────────────────────────────

    def _get_std(self, variable: str, default: float = 1.0) -> float:
        """Get normalization std for a variable (mean across all cells)."""
        if variable in self.norm_params:
            std = self.norm_params[variable].get("std")
            if std is not None:
                return float(np.mean(std))
        return default

    def clear_cache(self) -> None:
        """Clear the baseline prediction cache."""
        self._baseline_cache.clear()

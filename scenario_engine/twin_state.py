"""Digital Twin state representation and update logic.

This module defines the state layer that differentiates the project from a
plain forecasting pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

import numpy as np


@dataclass
class ClimateState:
    """Compact representation of the current regional climate state."""

    timestamp: str
    region: str
    temperature: float
    rainfall: float
    soil_moisture_proxy: float
    vegetation_proxy: float
    enso_state: float
    metadata: dict[str, float | str] = field(default_factory=dict)


class StateUpdater:
    """Builds ClimateState objects from observations and predictions."""

    @staticmethod
    def from_field_means(
        region: str,
        temperature_field: np.ndarray,
        rainfall_field: np.ndarray,
        enso_state: float = 0.0,
        timestamp: str | None = None,
    ) -> ClimateState:
        """Create a state from gridded fields.

        Proxies are intentionally simple for hackathon transparency:
        - soil_moisture_proxy: normalized rainfall response (0..1)
        - vegetation_proxy: coupled to moisture and bounded by heat stress
        """
        ts = timestamp or datetime.now(UTC).isoformat()
        t_mean = float(np.nanmean(temperature_field))
        r_mean = float(np.nanmean(rainfall_field))

        soil_proxy = float(np.clip(r_mean / 20.0, 0.0, 1.0))
        heat_penalty = float(np.clip((t_mean - 25.0) / 20.0, 0.0, 1.0))
        vegetation_proxy = float(np.clip(0.7 * soil_proxy + 0.3 * (1.0 - heat_penalty), 0.0, 1.0))

        return ClimateState(
            timestamp=ts,
            region=region,
            temperature=t_mean,
            rainfall=r_mean,
            soil_moisture_proxy=soil_proxy,
            vegetation_proxy=vegetation_proxy,
            enso_state=float(enso_state),
            metadata={
                "soil_proxy_method": "rainfall_normalized",
                "vegetation_proxy_method": "moisture_heat_blend",
            },
        )


class TwinEngine:
    """Maintains state history and scenario impact projections."""

    def __init__(self) -> None:
        self.current_state: ClimateState | None = None
        self.history: list[ClimateState] = []

    def update_state(self, state: ClimateState) -> ClimateState:
        self.current_state = state
        self.history.append(state)
        if len(self.history) > 3650:
            self.history = self.history[-3650:]
        return state

    def get_state(self) -> ClimateState | None:
        return self.current_state

    def project_with_delta(
        self,
        temp_delta: float = 0.0,
        rainfall_delta: float = 0.0,
        enso_delta: float = 0.0,
        label: str = "scenario_projection",
    ) -> ClimateState:
        if self.current_state is None:
            raise ValueError("Twin state is not initialized")

        base = self.current_state
        projected = ClimateState(
            timestamp=datetime.now(UTC).isoformat(),
            region=base.region,
            temperature=base.temperature + temp_delta,
            rainfall=max(0.0, base.rainfall + rainfall_delta),
            soil_moisture_proxy=float(np.clip(base.soil_moisture_proxy + rainfall_delta / 40.0, 0.0, 1.0)),
            vegetation_proxy=float(np.clip(base.vegetation_proxy + rainfall_delta / 80.0 - temp_delta / 20.0, 0.0, 1.0)),
            enso_state=base.enso_state + enso_delta,
            metadata={
                **base.metadata,
                "projection_label": label,
            },
        )
        return projected

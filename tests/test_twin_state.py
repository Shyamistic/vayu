"""Unit tests for Digital Twin state engine."""

from __future__ import annotations

import numpy as np

from scenario_engine.twin_state import StateUpdater, TwinEngine


def test_state_updater_builds_valid_proxies():
    temp = np.array([28.0, 30.0, 32.0], dtype=np.float32)
    rain = np.array([2.0, 6.0, 10.0], dtype=np.float32)

    state = StateUpdater.from_field_means(
        region="pilot",
        temperature_field=temp,
        rainfall_field=rain,
        enso_state=1.2,
    )

    assert state.region == "pilot"
    assert 0.0 <= state.soil_moisture_proxy <= 1.0
    assert 0.0 <= state.vegetation_proxy <= 1.0
    assert state.enso_state == 1.2


def test_twin_engine_update_and_project():
    engine = TwinEngine()
    base = StateUpdater.from_field_means(
        region="pilot",
        temperature_field=np.array([30.0], dtype=np.float32),
        rainfall_field=np.array([5.0], dtype=np.float32),
    )
    engine.update_state(base)

    projected = engine.project_with_delta(temp_delta=1.5, rainfall_delta=-1.0, label="el_nino")
    assert projected.temperature > base.temperature
    assert projected.rainfall <= base.rainfall
    assert projected.metadata.get("projection_label") == "el_nino"

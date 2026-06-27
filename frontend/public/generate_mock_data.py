"""Generate realistic mock prediction data for VAYU frontend demo.

Run this script to create mock_prediction.json with 1311 grid cells
matching the Western Ghats pilot region (8-20°N, 72-78°E at 0.25°).

Usage:
    python generate_mock_data.py
"""
import json
import numpy as np

# Pilot region grid (matches model config)
LAT_MIN, LAT_MAX = 8.0, 22.0  # 57 points at 0.25°
LON_MIN, LON_MAX = 72.0, 77.5  # 23 points at 0.25°
RESOLUTION = 0.25

lats = np.arange(LAT_MIN + RESOLUTION/2, LAT_MAX, RESOLUTION)
lons = np.arange(LON_MIN + RESOLUTION/2, LON_MAX, RESOLUTION)

rng = np.random.default_rng(42)

# Generate realistic monsoon-season climate data (June)
grid_cells = []
idx = 0
for lat in lats:
    for lon in lons:
        # Rainfall: heavier on western coast (lon < 74), lighter inland
        # Western Ghats orographic rainfall gradient
        coast_factor = max(0, (74.5 - lon) / 2.5)  # 0 at 74.5°E, 1 at 72°E
        lat_monsoon = max(0, min(1, (lat - 8) / 12))  # stronger at 10-18°N
        base_rain = 8.0 + coast_factor * 25.0 + lat_monsoon * 5.0
        rainfall = max(0, rng.normal(base_rain, base_rain * 0.3))
        
        # Temperature: cooler at coast, warmer inland; cooler at higher latitudes
        base_tmax = 35.0 - coast_factor * 4.0 - (lat - 15) * 0.2
        temp_max = rng.normal(base_tmax, 1.5)
        temp_min = temp_max - rng.uniform(5, 9)
        
        grid_cells.append({
            "lat": round(float(lat), 3),
            "lon": round(float(lon), 3),
            "node_idx": idx,
            "rainfall": round(float(rainfall), 2),
            "temp_max": round(float(temp_max), 2),
            "temp_min": round(float(temp_min), 2),
            "rainfall_uncertainty": round(float(rng.uniform(1.5, 6.0)), 2),
            "temp_max_uncertainty": round(float(rng.uniform(0.3, 1.2)), 2),
            "temp_min_uncertainty": round(float(rng.uniform(0.3, 1.0)), 2),
        })
        idx += 1

# Prediction response
prediction = {
    "request_date": "2024-06-15",
    "lead_times": [1, 2, 3, 4, 5, 6, 7],
    "grid_cells": grid_cells,
    "model_version": "2.0.0",
    "input_data_timestamp": "2024-06-14T12:00:00Z",
    "cached": False,
}

with open("mock_prediction.json", "w") as f:
    json.dump(prediction, f)
print(f"Generated mock_prediction.json with {len(grid_cells)} grid cells")

# Generate temperature +2°C scenario
scenario_cells_baseline = {}
scenario_cells_delta = {}
for var in ["rainfall", "temp_max", "temp_min"]:
    baseline_vals = [c[var] for c in grid_cells]
    scenario_cells_baseline[var] = baseline_vals
    if var == "temp_max":
        scenario_cells_delta[var] = [2.0 + rng.normal(0, 0.3) for _ in grid_cells]
    elif var == "temp_min":
        scenario_cells_delta[var] = [1.8 + rng.normal(0, 0.25) for _ in grid_cells]
    elif var == "rainfall":
        # Warmer → more evaporation → more rain on coast, less inland
        scenario_cells_delta[var] = [
            float((0.08 * c["rainfall"] if c["lon"] < 74.5 else -0.05 * c["rainfall"])
                  + rng.normal(0, 1.0))
            for c in grid_cells
        ]

scenario_result = {
    "scenario_type": "temperature_offset",
    "magnitude": 2.0,
    "baseline": scenario_cells_baseline,
    "scenario": {
        var: [b + d for b, d in zip(scenario_cells_baseline[var], scenario_cells_delta[var])]
        for var in ["rainfall", "temp_max", "temp_min"]
    },
    "delta": scenario_cells_delta,
    "hotspots": [
        {"node_idx": i, "delta_value": round(d, 3), "percentile_rank": 95.0}
        for i, d in enumerate(scenario_cells_delta["temp_max"])
        if abs(d) > np.percentile(np.abs(scenario_cells_delta["temp_max"]), 90)
    ][:20],
    "summary": {
        "temp_max": {
            "avg_delta": round(float(np.mean(scenario_cells_delta["temp_max"])), 3),
            "max_delta": round(float(np.max(scenario_cells_delta["temp_max"])), 3),
            "avg_pct_change": 6.2,
            "affected_cells": int(len(grid_cells) * 0.95),
        },
        "temp_min": {
            "avg_delta": round(float(np.mean(scenario_cells_delta["temp_min"])), 3),
            "max_delta": round(float(np.max(scenario_cells_delta["temp_min"])), 3),
            "avg_pct_change": 7.1,
            "affected_cells": int(len(grid_cells) * 0.92),
        },
        "rainfall": {
            "avg_delta": round(float(np.mean(scenario_cells_delta["rainfall"])), 3),
            "max_delta": round(float(np.max(scenario_cells_delta["rainfall"])), 3),
            "avg_pct_change": 3.8,
            "affected_cells": int(len(grid_cells) * 0.6),
        },
    },
    "clamped": False,
    "clamp_message": None,
    "computation_time_s": 2.3,
}

import os
os.makedirs("mock_scenarios", exist_ok=True)
with open("mock_scenarios/temperature_offset.json", "w") as f:
    json.dump(scenario_result, f)
print("Generated mock_scenarios/temperature_offset.json")

# Generate rainfall -20% scenario
rain_delta = [-0.2 * c["rainfall"] + rng.normal(0, 0.5) for c in grid_cells]
rain_scenario = {
    "scenario_type": "rainfall_scaling",
    "magnitude": 0.8,
    "baseline": scenario_cells_baseline,
    "scenario": {
        "rainfall": [b + d for b, d in zip(scenario_cells_baseline["rainfall"], rain_delta)],
        "temp_max": [t + rng.normal(0.5, 0.2) for t in scenario_cells_baseline["temp_max"]],
        "temp_min": [t + rng.normal(0.3, 0.15) for t in scenario_cells_baseline["temp_min"]],
    },
    "delta": {
        "rainfall": [round(d, 3) for d in rain_delta],
        "temp_max": [round(rng.normal(0.5, 0.2), 3) for _ in grid_cells],
        "temp_min": [round(rng.normal(0.3, 0.15), 3) for _ in grid_cells],
    },
    "hotspots": [
        {"node_idx": i, "delta_value": round(d, 3), "percentile_rank": 92.0}
        for i, d in enumerate(rain_delta)
        if abs(d) > np.percentile(np.abs(rain_delta), 90)
    ][:20],
    "summary": {
        "rainfall": {
            "avg_delta": round(float(np.mean(rain_delta)), 3),
            "max_delta": round(float(np.min(rain_delta)), 3),
            "avg_pct_change": -20.0,
            "affected_cells": int(len(grid_cells) * 0.85),
        },
        "temp_max": {
            "avg_delta": 0.5,
            "max_delta": 1.2,
            "avg_pct_change": 1.5,
            "affected_cells": int(len(grid_cells) * 0.7),
        },
    },
    "clamped": True,
    "clamp_message": "Rainfall clamped to ≥0 mm/day for 12 grid cells",
    "computation_time_s": 1.8,
}

with open("mock_scenarios/rainfall_scaling.json", "w") as f:
    json.dump(rain_scenario, f)
print("Generated mock_scenarios/rainfall_scaling.json")

# Generate wind field data for cesium-wind-layer
# Simulate SW monsoon flow (strong westerly at 850hPa over Arabian Sea → Western Ghats)
nlat, nlon = len(lats), len(lons)
u_wind = np.zeros((nlat, nlon), dtype=np.float32)
v_wind = np.zeros((nlat, nlon), dtype=np.float32)

for i, lat in enumerate(lats):
    for j, lon in enumerate(lons):
        # SW monsoon: strong westerly (u > 0) at 10-15°N, weakening northward
        monsoon_strength = np.exp(-((lat - 12) ** 2) / 20)  # peak at 12°N
        u_wind[i, j] = 12.0 * monsoon_strength + rng.normal(0, 2)  # westerly
        v_wind[i, j] = 3.0 * monsoon_strength + rng.normal(0, 1.5)  # slight southerly component
        
        # Orographic deflection near Western Ghats (lon 73-74°E)
        if 73.0 < lon < 74.5 and lat > 10:
            u_wind[i, j] *= 0.3  # wind blocked by Ghats
            v_wind[i, j] += 4.0  # deflected northward

wind_field = {
    "width": nlon,
    "height": nlat,
    "uMin": float(u_wind.min()),
    "uMax": float(u_wind.max()),
    "vMin": float(v_wind.min()),
    "vMax": float(v_wind.max()),
    "u": u_wind.flatten().tolist(),
    "v": v_wind.flatten().tolist(),
    "bounds": {
        "west": LON_MIN,
        "south": LAT_MIN,
        "east": LON_MAX,
        "north": LAT_MAX,
    },
}

with open("wind_field.json", "w") as f:
    json.dump(wind_field, f)
print(f"Generated wind_field.json ({nlat}×{nlon} grid)")

# Generate mock metrics
metrics = {
    "rainfall": {
        "variable": "rainfall", "region": "western_ghats",
        "eval_period": "2021-2023", "r2_score": 0.125,
        "rmse": 8.3, "mae": 5.1, "skill_score": 0.15,
    },
    "temp_max": {
        "variable": "temp_max", "region": "western_ghats",
        "eval_period": "2021-2023", "r2_score": 0.823,
        "rmse": 1.4, "mae": 1.0, "skill_score": 0.82,
    },
    "temp_min": {
        "variable": "temp_min", "region": "western_ghats",
        "eval_period": "2021-2023", "r2_score": 0.79,
        "rmse": 1.3, "mae": 0.9, "skill_score": 0.78,
    },
}

with open("mock_metrics.json", "w") as f:
    json.dump(metrics, f, indent=2)
print("Generated mock_metrics.json")

print("\n✓ All mock data generated successfully!")
print(f"  Total grid cells: {len(grid_cells)}")
print(f"  Region: {LAT_MIN}-{LAT_MAX}°N, {LON_MIN}-{LON_MAX}°E")
print(f"  Resolution: {RESOLUTION}°")

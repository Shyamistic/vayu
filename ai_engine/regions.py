"""Regional definitions and node mask helpers for climate evaluation."""

from __future__ import annotations

import numpy as np

REGION_BOUNDS: dict[str, dict[str, float]] = {
    "pilot": {"lat_min": 8.0, "lat_max": 20.0, "lon_min": 72.0, "lon_max": 78.0},
    "western_ghats": {"lat_min": 7.5, "lat_max": 21.5, "lon_min": 72.0, "lon_max": 77.5},
    "north_east_india": {"lat_min": 22.0, "lat_max": 29.5, "lon_min": 88.0, "lon_max": 97.5},
    "indo_gangetic_plain": {"lat_min": 23.0, "lat_max": 31.5, "lon_min": 74.0, "lon_max": 89.5},
    "central_india": {"lat_min": 17.0, "lat_max": 25.5, "lon_min": 74.0, "lon_max": 84.5},
}


def available_regions() -> list[str]:
    return list(REGION_BOUNDS.keys())


def region_mask(latlon: np.ndarray, region: str) -> np.ndarray:
    """Build a node mask from an Nx2 [lat, lon] array for the given region."""
    if region not in REGION_BOUNDS:
        raise ValueError(f"Unknown region: {region}")
    b = REGION_BOUNDS[region]
    lats = latlon[:, 0]
    lons = latlon[:, 1]
    return (
        (lats >= b["lat_min"]) & (lats <= b["lat_max"]) &
        (lons >= b["lon_min"]) & (lons <= b["lon_max"])
    )

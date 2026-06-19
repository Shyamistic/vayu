"""Raster tile renderer for climate data overlays (XYZ TMS format).

Generates 256×256 PNG tiles from gridded climate data using matplotlib colormaps.
Compatible with Leaflet, MapboxGL, and CesiumJS imagery providers.
"""

from __future__ import annotations

import io
import math

import numpy as np
from PIL import Image


# Pilot region bounds
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 8.0, 20.0, 72.0, 78.0

# Colormaps: variable → (colormap_name, vmin, vmax)
VARIABLE_CMAPS = {
    "rainfall": ("Blues", 0.0, 50.0),     # mm/day
    "temp_max": ("YlOrRd", 20.0, 45.0),  # °C
    "temp_min": ("RdYlBu_r", 10.0, 35.0),  # °C
}


def _tile_bbox(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """Compute lat/lon bounding box for an XYZ tile."""
    n = 2 ** z
    lon_min = x / n * 360.0 - 180.0
    lon_max = (x + 1) / n * 360.0 - 180.0
    lat_max_rad = math.atan(math.sinh(math.pi * (1 - 2 * y / n)))
    lat_min_rad = math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n)))
    return (
        math.degrees(lat_min_rad),
        math.degrees(lat_max_rad),
        lon_min,
        lon_max,
    )


def render_climate_tile(
    z: int,
    x: int,
    y: int,
    variable: str = "rainfall",
    date_str: str | None = None,
) -> bytes:
    """Render a 256×256 RGBA PNG tile for the given XYZ coordinate.

    Uses a synthetic climate field when real data is unavailable.
    Transparent (alpha=0) for areas outside the pilot region.

    Args:
        z, x, y: XYZ tile coordinates.
        variable: Climate variable to render.
        date_str: Date string for data lookup (unused in demo mode).

    Returns:
        PNG bytes ready to serve as image/png.
    """
    tile_lat_min, tile_lat_max, tile_lon_min, tile_lon_max = _tile_bbox(z, x, y)

    # Check if tile intersects pilot region
    if (tile_lat_max < LAT_MIN or tile_lat_min > LAT_MAX
            or tile_lon_max < LON_MIN or tile_lon_min > LON_MAX):
        return _transparent_tile()

    # Generate synthetic data for demo
    tile_size = 256
    lats = np.linspace(tile_lat_max, tile_lat_min, tile_size)
    lons = np.linspace(tile_lon_min, tile_lon_max, tile_size)

    grid_lon, grid_lat = np.meshgrid(lons, lats)
    data = _synthetic_climate_field(variable, grid_lat, grid_lon)

    # Create pilot region mask
    pilot_mask = (
        (grid_lat >= LAT_MIN) & (grid_lat <= LAT_MAX)
        & (grid_lon >= LON_MIN) & (grid_lon <= LON_MAX)
    )

    cmap_name, vmin, vmax = VARIABLE_CMAPS.get(variable, ("viridis", 0, 1))

    # Normalize data to [0, 1]
    norm_data = np.clip((data - vmin) / (vmax - vmin), 0.0, 1.0)

    # Apply colormap
    import matplotlib.pyplot as plt
    cmap = plt.get_cmap(cmap_name)
    rgba = (cmap(norm_data) * 255).astype(np.uint8)

    # Set alpha=0 outside pilot region
    rgba[:, :, 3] = np.where(pilot_mask, 180, 0).astype(np.uint8)

    img = Image.fromarray(rgba, mode="RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _synthetic_climate_field(
    variable: str, grid_lat: np.ndarray, grid_lon: np.ndarray
) -> np.ndarray:
    """Generate a plausible synthetic climate field for demo purposes."""
    # Base gradient + Western Ghats enhancement
    rng = np.random.default_rng(hash(variable) % (2 ** 32))

    if variable == "rainfall":
        # Rainfall peaks on western slopes of Ghats (lon ~73-74°E)
        base = 15.0 * np.exp(-((grid_lon - 73.5) ** 2) / 2.0)
        noise = rng.normal(0, 2, grid_lat.shape).astype(np.float32)
        return np.clip(base + noise, 0, None)

    elif variable == "temp_max":
        # Temperature decreases with latitude, increases inland
        base = 38.0 - 0.4 * (grid_lat - 8.0) + 0.5 * (grid_lon - 72.0)
        noise = rng.normal(0, 1, grid_lat.shape).astype(np.float32)
        return base + noise

    elif variable == "temp_min":
        base = 26.0 - 0.3 * (grid_lat - 8.0) + 0.3 * (grid_lon - 72.0)
        noise = rng.normal(0, 0.8, grid_lat.shape).astype(np.float32)
        return base + noise

    return np.zeros_like(grid_lat)


def _transparent_tile() -> bytes:
    """Return a fully transparent 256×256 PNG."""
    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

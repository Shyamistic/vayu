"""Raster tile renderer for climate data overlays (XYZ TMS format).

Generates 256×256 PNG tiles from gridded climate data using matplotlib colormaps.
Compatible with Leaflet, MapboxGL, and CesiumJS imagery providers.

Zoom level support: 4–12 (as required by Req 76.4)
Performance targets (Req 76.5):
  - Cached: <200ms (handled by Redis TTL in main.py)
  - Fresh:  <800ms
"""

from __future__ import annotations

import io
import math
from typing import Any

import numpy as np
from PIL import Image


# Pilot region bounds
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 8.0, 20.0, 72.0, 78.0

# Supported zoom range (Req 76.4)
ZOOM_MIN, ZOOM_MAX = 4, 12

# Tile pixel size (Req 76.1)
TILE_SIZE = 256

# Colormaps: variable → (colormap_name, vmin, vmax)
VARIABLE_CMAPS = {
    "rainfall": ("Blues", 0.0, 50.0),      # mm/day
    "temp_max": ("YlOrRd", 20.0, 45.0),   # °C
    "temp_min": ("RdYlBu_r", 10.0, 35.0), # °C
}


def _tile_bbox(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """Compute lat/lon bounding box for an XYZ tile.

    Returns (lat_min, lat_max, lon_min, lon_max).
    """
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
    grid_cells: list[dict[str, Any]] | None = None,
) -> bytes:
    """Render a 256×256 RGBA PNG tile for the given XYZ coordinate.

    Renders from real prediction grid_cells when provided, falls back to
    a synthetic climate field when no data is available.

    Transparent (alpha=0) pixels are produced for areas outside the
    prediction grid (Req 76.2).

    Args:
        z, x, y:     XYZ tile coordinates.
        variable:    Climate variable to render (rainfall, temp_max, temp_min).
        date_str:    Date string for data lookup context (informational).
        grid_cells:  Optional list of dicts with keys: lat, lon, rainfall,
                     temp_max, temp_min.  When supplied, these are bilinearly
                     interpolated onto the tile pixel grid.

    Returns:
        PNG bytes ready to serve as image/png.
    """
    tile_lat_min, tile_lat_max, tile_lon_min, tile_lon_max = _tile_bbox(z, x, y)

    # Transparent tile for areas that don't intersect the pilot region (Req 76.2)
    if (tile_lat_max < LAT_MIN or tile_lat_min > LAT_MAX
            or tile_lon_max < LON_MIN or tile_lon_min > LON_MAX):
        return _transparent_tile()

    lats = np.linspace(tile_lat_max, tile_lat_min, TILE_SIZE)
    lons = np.linspace(tile_lon_min, tile_lon_max, TILE_SIZE)
    grid_lon, grid_lat = np.meshgrid(lons, lats)

    # Pilot region mask — transparent outside prediction grid (Req 76.2)
    pilot_mask = (
        (grid_lat >= LAT_MIN) & (grid_lat <= LAT_MAX)
        & (grid_lon >= LON_MIN) & (grid_lon <= LON_MAX)
    )

    # Resolve data field: real grid cells → bilinear interp; else synthetic
    if grid_cells and len(grid_cells) > 0:
        data = _interpolate_grid_cells(grid_cells, variable, grid_lat, grid_lon)
    else:
        data = _synthetic_climate_field(variable, grid_lat, grid_lon)

    cmap_name, vmin, vmax = VARIABLE_CMAPS.get(variable, ("viridis", 0, 1))

    # Normalise data to [0, 1]
    norm_data = np.clip((data - vmin) / (vmax - vmin), 0.0, 1.0)

    # Apply matplotlib colormap
    import matplotlib.pyplot as plt
    cmap = plt.get_cmap(cmap_name)
    rgba = (cmap(norm_data) * 255).astype(np.uint8)

    # Set alpha=0 outside pilot region (Req 76.2)
    rgba[:, :, 3] = np.where(pilot_mask, 180, 0).astype(np.uint8)

    img = Image.fromarray(rgba, mode="RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# ── Internal helpers ───────────────────────────────────────────────────────────

def _interpolate_grid_cells(
    grid_cells: list[dict[str, Any]],
    variable: str,
    grid_lat: np.ndarray,
    grid_lon: np.ndarray,
) -> np.ndarray:
    """Bilinearly interpolate scattered grid cell values onto a pixel grid.

    Falls back to nearest-neighbour when the grid is too sparse for scipy.
    """
    pts_lat = np.array([c["lat"] for c in grid_cells], dtype=np.float64)
    pts_lon = np.array([c["lon"] for c in grid_cells], dtype=np.float64)
    pts_val = np.array([float(c.get(variable, 0.0)) for c in grid_cells], dtype=np.float64)

    # Replace NaN / inf with variable mean
    finite_mask = np.isfinite(pts_val)
    if not np.any(finite_mask):
        return np.zeros_like(grid_lat, dtype=np.float32)
    mean_val = float(np.mean(pts_val[finite_mask]))
    pts_val = np.where(finite_mask, pts_val, mean_val)

    try:
        from scipy.interpolate import griddata
        query_pts = np.column_stack([grid_lat.ravel(), grid_lon.ravel()])
        source_pts = np.column_stack([pts_lat, pts_lon])
        interp = griddata(source_pts, pts_val, query_pts, method="linear", fill_value=mean_val)
        return interp.reshape(grid_lat.shape).astype(np.float32)
    except Exception:
        # Nearest-neighbour fallback
        return _nearest_neighbour(pts_lat, pts_lon, pts_val, grid_lat, grid_lon)


def _nearest_neighbour(
    pts_lat: np.ndarray,
    pts_lon: np.ndarray,
    pts_val: np.ndarray,
    grid_lat: np.ndarray,
    grid_lon: np.ndarray,
) -> np.ndarray:
    """Vectorised nearest-neighbour lookup using broadcasting."""
    flat_lat = grid_lat.ravel()
    flat_lon = grid_lon.ravel()

    # Euclidean distance in degrees (sufficient for small regions)
    dlat = flat_lat[:, None] - pts_lat[None, :]
    dlon = flat_lon[:, None] - pts_lon[None, :]
    dist2 = dlat ** 2 + dlon ** 2
    nearest = np.argmin(dist2, axis=1)
    return pts_val[nearest].reshape(grid_lat.shape).astype(np.float32)


def _synthetic_climate_field(
    variable: str, grid_lat: np.ndarray, grid_lon: np.ndarray
) -> np.ndarray:
    """Generate a plausible synthetic climate field for demo / fallback purposes."""
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
    """Return a fully transparent 256×256 PNG (Req 76.2)."""
    img = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

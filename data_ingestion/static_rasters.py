"""Build real static rasters directly on a normalized climate grid.

The builder deliberately reprojects each source tile into small target-grid
stripes.  It never constructs a full-resolution DEM or WorldCover mosaic.
"""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, bounds as window_bounds, transform as window_transform
import xarray as xr

_TARGET_CRS = CRS.from_epsg(4326)
_WORLDCOVER_CLASSES = np.array(
    [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100], dtype=np.uint16
)
_STRIPE_ROWS = 256


def _raster_files(directory: str | Path, label: str) -> tuple[Path, list[Path]]:
    root = Path(directory)
    if not root.is_dir():
        raise FileNotFoundError(f"{label} directory does not exist: {root}")
    paths = sorted(
        path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in {".tif", ".tiff"}
    )
    if not paths:
        raise FileNotFoundError(f"No GeoTIFF files found in {label} directory: {root}")
    return root, paths


def _coordinate(ds: xr.Dataset, short: str, long: str) -> np.ndarray:
    name = short if short in ds.variables else long if long in ds.variables else None
    if name is None:
        raise ValueError(f"Reference NetCDF has no {short!r} or {long!r} coordinate")
    values = np.asarray(ds[name].values, dtype=np.float64).squeeze()
    if values.ndim != 1 or values.size < 2:
        raise ValueError(f"Reference coordinate {name!r} must be one-dimensional with at least 2 cells")
    if not np.all(np.isfinite(values)) or np.unique(values).size != values.size:
        raise ValueError(f"Reference coordinate {name!r} must contain unique finite values")
    return np.sort(values)

def _regular_step(values: np.ndarray, name: str) -> float:
    differences = np.diff(values)
    step = float(differences[0])
    tolerance = max(1e-10, abs(step) * 1e-6)
    if step <= 0 or not np.allclose(differences, step, rtol=1e-6, atol=tolerance):
        raise ValueError(f"Reference {name} coordinates must form a regular grid")
    return step


def _target_grid(reference_file: str | Path) -> tuple[np.ndarray, np.ndarray, Any, tuple[float, ...]]:
    reference = Path(reference_file)
    if not reference.is_file():
        raise FileNotFoundError(f"Reference NetCDF does not exist: {reference}")
    with xr.open_dataset(reference) as ds:
        lat = _coordinate(ds, "lat", "latitude")
        lon = _coordinate(ds, "lon", "longitude")
    if lat[0] < -90 or lat[-1] > 90 or lon[0] < -180 or lon[-1] > 180:
        raise ValueError("Reference coordinates are outside EPSG:4326 latitude/longitude limits")
    dy = _regular_step(lat, "latitude")
    dx = _regular_step(lon, "longitude")
    west, east = float(lon[0] - dx / 2), float(lon[-1] + dx / 2)
    south, north = float(lat[0] - dy / 2), float(lat[-1] + dy / 2)
    # Rasterio rows run north-to-south. Arrays are flipped before NetCDF output.
    transform = from_origin(west, north, dx, dy)
    return lat, lon, transform, (west, south, east, north)


def _intersects(first: tuple[float, ...], second: tuple[float, ...]) -> bool:
    return not (
        first[2] <= second[0]
        or first[0] >= second[2]
        or first[3] <= second[1]
        or first[1] >= second[3]
    )


def _provenance(path: Path, root: Path, dataset: rasterio.io.DatasetReader, bounds_4326: tuple[float, ...]) -> dict[str, Any]:
    stat = path.stat()
    nodata = dataset.nodata
    if nodata is not None and not np.isfinite(nodata):
        nodata = str(nodata)
    return {
        "path": path.relative_to(root).as_posix(),
        "size_bytes": stat.st_size,
        "modified_ns": stat.st_mtime_ns,
        "crs": dataset.crs.to_string(),
        "bounds_epsg4326": [float(value) for value in bounds_4326],
        "nodata": nodata,
    }


def _source_bounds(dataset: rasterio.io.DatasetReader, path: Path) -> tuple[float, ...]:
    if dataset.crs is None:
        raise ValueError(f"Source raster has no CRS: {path}")
    return tuple(
        float(value)
        for value in transform_bounds(dataset.crs, _TARGET_CRS, *dataset.bounds, densify_pts=21)
    )


def _stripe_range(height: int):
    for row_start in range(0, height, _STRIPE_ROWS):
        yield row_start, min(height, row_start + _STRIPE_ROWS)


def _warp_dem(
    paths: list[Path], root: Path, shape: tuple[int, int], transform: Any, target_bounds: tuple[float, ...]
) -> tuple[np.ndarray, np.ndarray, list[dict[str, Any]]]:
    height, width = shape
    values = np.full(shape, np.nan, dtype=np.float32)
    covered = np.zeros(shape, dtype=bool)
    provenance: list[dict[str, Any]] = []
    for path in paths:
        with rasterio.open(path) as source:
            source_bounds = _source_bounds(source, path)
            provenance.append(_provenance(path, root, source, source_bounds))
            if not _intersects(source_bounds, target_bounds):
                continue
            for row_start, row_stop in _stripe_range(height):
                window = Window(0, row_start, width, row_stop - row_start)
                block_bounds = tuple(float(value) for value in window_bounds(window, transform))
                if not _intersects(source_bounds, block_bounds):
                    continue
                temporary = np.full((row_stop - row_start, width), np.nan, dtype=np.float32)
                reproject(
                    source=rasterio.band(source, 1), destination=temporary,
                    src_transform=source.transform, src_crs=source.crs, src_nodata=source.nodata,
                    dst_transform=window_transform(window, transform), dst_crs=_TARGET_CRS,
                    dst_nodata=np.nan, resampling=Resampling.bilinear, init_dest_nodata=True,
                )
                block = values[row_start:row_stop]
                block_covered = covered[row_start:row_stop]
                valid = np.isfinite(temporary) & ~block_covered
                block[valid] = temporary[valid]
                block_covered[valid] = True
    return values, covered, provenance

def _warp_worldcover(
    paths: list[Path], root: Path, shape: tuple[int, int], transform: Any, target_bounds: tuple[float, ...]
) -> tuple[np.ndarray, np.ndarray, list[dict[str, Any]]]:
    height, width = shape
    classes = np.zeros(shape, dtype=np.uint16)
    covered = np.zeros(shape, dtype=bool)
    provenance: list[dict[str, Any]] = []
    for path in paths:
        with rasterio.open(path) as source:
            source_bounds = _source_bounds(source, path)
            provenance.append(_provenance(path, root, source, source_bounds))
            if not _intersects(source_bounds, target_bounds):
                continue
            for row_start, row_stop in _stripe_range(height):
                window = Window(0, row_start, width, row_stop - row_start)
                block_bounds = tuple(float(value) for value in window_bounds(window, transform))
                if not _intersects(source_bounds, block_bounds):
                    continue
                temporary = np.zeros((row_stop - row_start, width), dtype=np.uint16)
                # WorldCover's valid codes are nonzero. Treat zero as nodata when
                # a tile omitted explicit nodata metadata.
                source_nodata = source.nodata if source.nodata is not None else 0
                reproject(
                    source=rasterio.band(source, 1), destination=temporary,
                    src_transform=source.transform, src_crs=source.crs, src_nodata=source_nodata,
                    dst_transform=window_transform(window, transform), dst_crs=_TARGET_CRS,
                    dst_nodata=0, resampling=Resampling.nearest, init_dest_nodata=True,
                )
                block = classes[row_start:row_stop]
                block_covered = covered[row_start:row_stop]
                valid = np.isin(temporary, _WORLDCOVER_CLASSES) & ~block_covered
                block[valid] = temporary[valid]
                block_covered[valid] = True
    return classes, covered, provenance


def _atomic_netcdf(dataset: xr.Dataset, path: Path, variable: str, dtype: str) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    try:
        dataset.to_netcdf(temporary, encoding={variable: {"dtype": dtype, "_FillValue": None}})
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _fraction(numerator: int, denominator: int) -> float:
    return float(numerator / denominator) if denominator else 0.0


def build_static_rasters(
    reference_file: str | Path,
    dem_dir: str | Path,
    worldcover_dir: str | Path,
    output_dir: str | Path,
) -> dict[str, Any]:
    """Warp DEM and ESA WorldCover tiles onto a reference NetCDF grid.

    Output coordinates are exact sorted copies of the reference coordinates.
    WorldCover class 80 maps to water (0); every other valid WorldCover class
    maps to land (1). Missing DEM values are zero only after confirming that no
    WorldCover land cell lacks finite DEM coverage.
    """
    lat, lon, transform, bounds = _target_grid(reference_file)
    dem_root, dem_paths = _raster_files(dem_dir, "DEM")
    cover_root, cover_paths = _raster_files(worldcover_dir, "WorldCover")
    shape = (lat.size, lon.size)

    dem_north, dem_covered_north, dem_sources = _warp_dem(
        dem_paths, dem_root, shape, transform, bounds
    )
    classes_north, cover_covered_north, cover_sources = _warp_worldcover(
        cover_paths, cover_root, shape, transform, bounds
    )
    land_north = cover_covered_north & (classes_north != 80)
    missing_land_dem = land_north & ~dem_covered_north
    if np.any(missing_land_dem):
        count = int(np.count_nonzero(missing_land_dem))
        raise ValueError(f"WorldCover land has no finite DEM coverage at {count} target cell(s)")

    elevation = np.where(dem_covered_north, dem_north, 0.0)[::-1].astype(np.float32)
    lsm = land_north[::-1].astype(np.uint8)
    dem_covered = dem_covered_north[::-1]
    cover_covered = cover_covered_north[::-1]

    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    elevation_path, lsm_path = output / "elevation.nc", output / "lsm.nc"
    elevation_ds = xr.Dataset(
        {"elevation": (("lat", "lon"), elevation, {"units": "m", "crs": "EPSG:4326"})},
        coords={"lat": lat, "lon": lon}, attrs={"crs": "EPSG:4326"},
    )
    lsm_ds = xr.Dataset(
        {"lsm": (("lat", "lon"), lsm, {"flag_values": np.array([0, 1], dtype=np.uint8),
                                          "flag_meanings": "water land", "crs": "EPSG:4326"})},
        coords={"lat": lat, "lon": lon}, attrs={"crs": "EPSG:4326"},
    )
    _atomic_netcdf(elevation_ds, elevation_path, "elevation", "float32")
    _atomic_netcdf(lsm_ds, lsm_path, "lsm", "uint8")

    total = int(lat.size * lon.size)
    land_cells = int(lsm.sum())
    dem_cells = int(np.count_nonzero(dem_covered))
    cover_cells = int(np.count_nonzero(cover_covered))
    manifest: dict[str, Any] = {
        "schema_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "reference_file": str(Path(reference_file).resolve()),
        "target_crs": "EPSG:4326",
        "source_counts": {"dem": len(dem_paths), "worldcover": len(cover_paths)},
        "grid": {
            "shape": {"lat": int(lat.size), "lon": int(lon.size)},
            "latitude": {"minimum": float(lat[0]), "maximum": float(lat[-1]),
                         "resolution_degrees": float(lat[1] - lat[0]), "ascending": True},
            "longitude": {"minimum": float(lon[0]), "maximum": float(lon[-1]),
                          "resolution_degrees": float(lon[1] - lon[0]), "ascending": True},
            "bounds_cell_edges": {"west": bounds[0], "south": bounds[1],
                                  "east": bounds[2], "north": bounds[3]},
        },
        "sources": {
            "dem": {"directory": str(dem_root.resolve()), "files": dem_sources},
            "worldcover": {"directory": str(cover_root.resolve()), "files": cover_sources},
        },
        "coverage": {
            "total_cells": total,
            "worldcover_valid_cells": cover_cells,
            "worldcover_coverage_fraction": _fraction(cover_cells, total),
            "land_cells": land_cells,
            "land_fraction": _fraction(land_cells, total),
            "dem_covered_cells": dem_cells,
            "dem_coverage_fraction": _fraction(dem_cells, total),
            "land_dem_covered_cells": land_cells,
            "land_dem_coverage_fraction": 1.0 if land_cells else 0.0,
        },
        "outputs": {
            "elevation": {"path": elevation_path.name, "dtype": "float32",
                          "sha256": _file_sha256(elevation_path)},
            "lsm": {"path": lsm_path.name, "dtype": "uint8",
                    "sha256": _file_sha256(lsm_path)},
        },
    }
    manifest_path = output / "static_raster_manifest.json"
    temporary_manifest = manifest_path.with_name(f".{manifest_path.name}.tmp")
    try:
        temporary_manifest.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(temporary_manifest, manifest_path)
    finally:
        if temporary_manifest.exists():
            temporary_manifest.unlink()
    return manifest

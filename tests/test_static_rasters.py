"""Focused tests for direct-to-grid real static raster construction."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
import xarray as xr

from data_ingestion.static_rasters import build_static_rasters


def _write_tiff(
    path: Path,
    values: np.ndarray,
    *,
    west: float,
    north: float,
    nodata: float | int,
) -> None:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=values.shape[1],
        height=values.shape[0],
        count=1,
        dtype=values.dtype,
        crs="EPSG:4326",
        transform=from_origin(west, north, 1.0, 1.0),
        nodata=nodata,
    ) as dataset:
        dataset.write(values, 1)


def _write_reference(path: Path, lat: np.ndarray, lon: np.ndarray, *, long_names: bool = False) -> None:
    lat_name, lon_name = ("latitude", "longitude") if long_names else ("lat", "lon")
    xr.Dataset(
        {"normalized": ((lat_name, lon_name), np.zeros((lat.size, lon.size), dtype=np.float32))},
        coords={lat_name: lat, lon_name: lon},
    ).to_netcdf(path)

def test_build_static_rasters_aligns_real_tiles_and_maps_land_water(tmp_path: Path) -> None:
    dem_dir, cover_dir, output_dir = tmp_path / "dem", tmp_path / "cover", tmp_path / "out"
    dem_dir.mkdir()
    cover_dir.mkdir()
    reference = tmp_path / "normalized.nc"
    # Deliberately descending and unsorted names: output must be canonical lat/lon, ascending.
    _write_reference(
        reference,
        np.array([2.5, 1.5, 0.5]),
        np.array([10.5, 11.5, 12.5]),
        long_names=True,
    )

    missing = np.float32(-9999.0)
    # Two adjacent DEM tiles prove collection merge without a source-resolution mosaic.
    _write_tiff(
        dem_dir / "west.tif",
        np.array([[missing], [210.0], [110.0]], dtype=np.float32),
        west=10.0,
        north=3.0,
        nodata=missing,
    )
    _write_tiff(
        dem_dir / "east.tif",
        np.array([[320.0, 330.0], [missing, 230.0], [120.0, missing]], dtype=np.float32),
        west=11.0,
        north=3.0,
        nodata=missing,
    )
    worldcover_north_to_south = np.array(
        [[80, 10, 10], [10, 80, 40], [10, 10, 80]], dtype=np.uint8
    )
    _write_tiff(
        cover_dir / "worldcover.tif",
        worldcover_north_to_south,
        west=10.0,
        north=3.0,
        nodata=0,
    )

    returned_manifest = build_static_rasters(reference, dem_dir, cover_dir, output_dir)

    with xr.open_dataset(output_dir / "elevation.nc") as elevation_ds:
        np.testing.assert_array_equal(elevation_ds.lat.values, [0.5, 1.5, 2.5])
        np.testing.assert_array_equal(elevation_ds.lon.values, [10.5, 11.5, 12.5])
        assert elevation_ds.elevation.dtype == np.dtype("float32")
        np.testing.assert_allclose(
            elevation_ds.elevation.values,
            [[110.0, 120.0, 0.0], [210.0, 0.0, 230.0], [0.0, 320.0, 330.0]],
        )
        assert np.count_nonzero(elevation_ds.elevation.values) == 6

    with xr.open_dataset(output_dir / "lsm.nc") as lsm_ds:
        assert lsm_ds.lsm.dtype == np.dtype("uint8")
        np.testing.assert_array_equal(
            lsm_ds.lsm.values,
            [[1, 1, 0], [1, 0, 1], [0, 1, 1]],
        )

    manifest = json.loads((output_dir / "static_raster_manifest.json").read_text(encoding="utf-8"))
    assert returned_manifest == manifest
    assert manifest["target_crs"] == "EPSG:4326"
    assert manifest["source_counts"] == {"dem": 2, "worldcover": 1}
    assert manifest["grid"]["shape"] == {"lat": 3, "lon": 3}
    assert manifest["grid"]["latitude"]["ascending"] is True
    assert manifest["coverage"]["land_fraction"] == pytest.approx(6 / 9)
    assert manifest["coverage"]["dem_coverage_fraction"] == pytest.approx(6 / 9)
    assert manifest["coverage"]["land_dem_coverage_fraction"] == 1.0
    assert {item["path"] for item in manifest["sources"]["dem"]["files"]} == {
        "east.tif",
        "west.tif",
    }
    assert all(len(item["sha256"]) == 64 for item in manifest["outputs"].values())


def test_build_static_rasters_rejects_land_without_dem(tmp_path: Path) -> None:
    dem_dir, cover_dir, output_dir = tmp_path / "dem", tmp_path / "cover", tmp_path / "out"
    dem_dir.mkdir()
    cover_dir.mkdir()
    reference = tmp_path / "normalized.nc"
    _write_reference(reference, np.array([0.5, 1.5]), np.array([10.5, 11.5]))

    missing = np.float32(-9999.0)
    _write_tiff(
        dem_dir / "dem.tif",
        np.array([[100.0, missing], [100.0, missing]], dtype=np.float32),
        west=10.0,
        north=2.0,
        nodata=missing,
    )
    # North-east is water (an allowed DEM gap), south-east is land (a hard error).
    _write_tiff(
        cover_dir / "worldcover.tif",
        np.array([[10, 80], [10, 40]], dtype=np.uint8),
        west=10.0,
        north=2.0,
        nodata=0,
    )

    with pytest.raises(ValueError, match=r"WorldCover land has no finite DEM coverage at 1 target cell"):
        build_static_rasters(reference, dem_dir, cover_dir, output_dir)

    assert not (output_dir / "elevation.nc").exists()
    assert not (output_dir / "lsm.nc").exists()
    assert not (output_dir / "static_raster_manifest.json").exists()

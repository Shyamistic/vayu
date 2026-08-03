"""Focused tests for canonical portable dataset manifests."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import xarray as xr
from typer.testing import CliRunner

from ai_engine.cli import app
from ai_engine.data_inventory import build_inventory
from ai_engine.data_manifests import (
    CATALOG_SCHEMA_VERSION,
    MANIFEST_SCHEMA_VERSION,
    build_manifest_catalog,
    validate_manifest,
)


def _dataset(path: Path, variable: str, date: str = "2020-01-01") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    xr.Dataset(
        {variable: (("time", "lat", "lon"), np.ones((1, 2, 2)), {"units": "1"})},
        coords={
            "time": np.array([date], dtype="datetime64[ns]"),
            "lat": np.array([6.0, 6.25]),
            "lon": np.array([68.0, 68.25]),
        },
    ).to_netcdf(path)


def _write_fixture(root: Path) -> None:
    for variable in ("rainfall", "tmax", "tmin"):
        _dataset(root / "imd" / f"{variable}_2010-2025.nc", variable)
        _dataset(root / "kaggle_bundle_full_india" / f"{variable}_2010-2025.nc", variable)
    _dataset(root / "processed_full_india" / "normalized_2010-2025.nc", "rainfall")
    (root / "processed_full_india" / "train_sequences.pt").write_bytes(b"train")
    (root / "processed_full_india" / "val_sequences.pt").write_bytes(b"validation")
    (root / "processed_full_india" / "sequence_manifest.json").write_text(
        json.dumps({"normalized_file": "data\\processed_full_india\\normalized_2010-2025.nc"}), encoding="utf-8"
    )
    (root / "processed_full_india" / "pipeline_log_2010-2025.json").write_text(
        json.dumps({"input": {"region": "india"}, "config": {"region_bounds": {"lat_min": 6.0, "lat_max": 38.0, "lon_min": 68.0, "lon_max": 98.0}}}), encoding="utf-8"
    )
    (root / "kaggle_bundle_full_india" / "bundle_manifest.json").write_text(
        json.dumps({"copied_files": ["data\\kaggle_bundle_full_india\\rainfall_2010-2025.nc"]}), encoding="utf-8"
    )
    _dataset(root / "ncep_wind" / "uwnd.2010.nc", "uwnd", "2020-01-01")
    for variable in ("uwnd", "vwnd", "shum"):
        _dataset(root / "ncep_wind_subset" / f"{variable}_2010_850hPa_WG.nc", variable, "2021-01-01")


def test_catalog_is_portable_immutable_and_preserves_real_data_blockers(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    _write_fixture(data_root)

    catalog = build_manifest_catalog(data_root, inventory=build_inventory(data_root))

    assert catalog["schema_version"] == CATALOG_SCHEMA_VERSION
    full_india = next(item for item in catalog["manifests"] if item["dataset_id"] == "full-india-training-bundle")
    imd = next(item for item in catalog["manifests"] if item["dataset_id"] == "imd-observations")
    assert full_india["schema_version"] == MANIFEST_SCHEMA_VERSION
    assert full_india["lineage"]["source_manifest_ids"] == [imd["manifest_id"]]
    assert full_india["coverage"]["spatial"]["longitude"] == {"minimum": 68.0, "maximum": 68.25}
    assert full_india["validation"]["status"] == "blocked"
    codes = {item["code"] for item in full_india["validation"]["blockers"]}
    assert {"TEST_SEQUENCE_ARTIFACT_MISSING", "FULL_INDIA_BOUNDS_MISMATCH", "BUNDLE_SOURCE_FAMILIES_MISSING"} <= codes
    legacy_codes = {item["code"] for item in full_india["validation"]["checks"]}
    assert {"LEGACY_MANIFEST_WINDOWS_PATHS", "LEGACY_MANIFEST_PROVENANCE_INCOMPLETE"} <= legacy_codes
    subset = next(item for item in catalog["manifests"] if item["dataset_id"] == "ncep-western-ghats-subset")
    assert {item["code"] for item in subset["validation"]["warnings"]} == {"NCEP_WG_SUBSET_COVERAGE_DIFFERS"}
    serialized = json.dumps(catalog)
    assert "\\\\" not in serialized
    assert str(data_root) not in serialized
    assert all(item["source"] and item["license"] for item in catalog["manifests"])


def test_manifest_id_detects_content_tampering(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    _write_fixture(data_root)
    manifest = build_manifest_catalog(data_root)["manifests"][0]
    tampered = json.loads(json.dumps(manifest))
    tampered["license"]["name"] = "altered"

    with pytest.raises(ValueError, match="Manifest ID"):
        validate_manifest(tampered)


def test_manifests_command_writes_catalog_without_touching_data(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    _write_fixture(data_root)
    result = CliRunner().invoke(app, ["manifests", "--root", str(data_root)])

    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["schema_version"] == CATALOG_SCHEMA_VERSION


def test_unverified_source_provenance_blocks_manifest_admission(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    _write_fixture(data_root)

    catalog = build_manifest_catalog(data_root)

    imd = next(item for item in catalog["manifests"] if item["dataset_id"] == "imd-observations")
    assert "SOURCE_PROVENANCE_UNVERIFIED" in {item["code"] for item in imd["validation"]["blockers"]}

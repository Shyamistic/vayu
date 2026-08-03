"""Tests for portable AI-engine dataset discovery and inventory."""

from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path

import numpy as np
import xarray as xr
from typer.testing import CliRunner

from ai_engine.cli import app
from ai_engine.data_inventory import build_inventory, resolve_data_root


def _write_dataset(path: Path, variable: str = "rainfall") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    values = np.array([[[1.0, np.nan], [3.0, 4.0]], [[5.0, 6.0], [7.0, 8.0]]])
    dataset = xr.Dataset(
        {variable: (("time", "lat", "lon"), values, {"units": "mm day-1"})},
        coords={
            "time": np.array(["2020-01-01", "2020-01-02"], dtype="datetime64[ns]"),
            "lat": np.array([6.0, 6.25]),
            "lon": np.array([66.0, 66.25]),
        },
    )
    dataset.to_netcdf(path)


def test_resolve_data_root_uses_cli_then_environment_then_repository(tmp_path: Path) -> None:
    cli_root = tmp_path / "cli-data"
    env_root = tmp_path / "env-data"
    repository_root = tmp_path / "repository"
    for directory in (cli_root, env_root, repository_root / "data"):
        directory.mkdir(parents=True)

    assert resolve_data_root(cli_root, environment={"VAYU_DATA_ROOT": str(env_root)}, repository_root=repository_root).source == "cli"
    assert resolve_data_root(environment={"VAYU_DATA_ROOT": str(env_root)}, repository_root=repository_root).path == env_root.resolve()
    repository_resolution = resolve_data_root(environment={}, repository_root=repository_root)
    assert repository_resolution.source == "repository"
    assert repository_resolution.path == (repository_root / "data").resolve()


def test_discover_command_accepts_explicit_portable_root(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    data_root.mkdir()
    result = CliRunner().invoke(app, ["discover", "--root", str(data_root)])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["source"] == "cli"


def test_inventory_collects_portable_metadata_and_known_validation_blockers(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    raw_path = data_root / "imd" / "rainfall_2010-2025.nc"
    normalized_path = data_root / "processed_full_india" / "normalized_2010-2025.nc"
    _write_dataset(raw_path)
    _write_dataset(normalized_path)
    for name in ("tmax_2010-2025.nc", "tmin_2010-2025.nc"):
        _write_dataset(data_root / "kaggle_bundle_full_india" / name, variable=name.split("_")[0])
    _write_dataset(data_root / "kaggle_bundle_full_india" / "rainfall_2010-2025.nc")
    (data_root / "processed_full_india" / "train_sequences.pt").write_bytes(b"train")
    (data_root / "processed_full_india" / "val_sequences.pt").write_bytes(b"validation")
    (data_root / "processed_full_india" / "sequence_manifest.json").write_text(
        json.dumps({
            "normalized_file": "data\\processed_full_india\\normalized_2010-2025.nc",
            "train_path": "data\\processed_full_india\\train_sequences.pt",
            "val_path": "data\\processed_full_india\\val_sequences.pt",
            "grid": {"lat": 2, "lon": 2, "nodes": 4},
        }),
        encoding="utf-8",
    )
    (data_root / "processed_full_india" / "pipeline_log_2010-2025.json").write_text(
        json.dumps({
            "input": {"region": "india"},
            "config": {"region_bounds": {"lat_min": 6.0, "lat_max": 38.0, "lon_min": 68.0, "lon_max": 98.0}},
        }),
        encoding="utf-8",
    )
    (data_root / "kaggle_bundle_full_india" / "bundle_manifest.json").write_text(
        json.dumps({
            "copied_files": [
                "data\\kaggle_bundle_full_india\\rainfall_2010-2025.nc",
                "data\\kaggle_bundle_full_india\\tmax_2010-2025.nc",
                "data\\kaggle_bundle_full_india\\tmin_2010-2025.nc",
            ],
            "missing_expected_files": [],
        }),
        encoding="utf-8",
    )
    _write_dataset(data_root / "ncep_wind" / "uwnd.2010.nc", variable="uwnd")

    report = build_inventory(data_root, root_source="repository", large_file_threshold_mb=0.001)

    raw_record = next(record for record in report["files"] if record["relative_path"] == "imd/rainfall_2010-2025.nc")
    assert raw_record["sha256"] == sha256(raw_path.read_bytes()).hexdigest()
    assert raw_record["netcdf"]["coordinates"]["latitude"]["resolution_degrees"] == 0.25
    assert raw_record["netcdf"]["variables"][0]["units"] == "mm day-1"
    assert raw_record["netcdf"]["variables"][0]["missingness"]["missing_count"] == 1
    assert report["ssd_relocation_candidates"]

    codes = {blocker["code"] for blocker in report["validation"]["blockers"]}
    assert {"TEST_SEQUENCE_ARTIFACT_MISSING", "FULL_INDIA_BOUNDS_MISMATCH", "BUNDLE_SOURCE_FAMILIES_MISSING", "NCEP_COVERAGE_INCOMPLETE"} <= codes
    serialized = json.dumps(report)
    assert "\\\\" not in serialized
    assert str(data_root) not in serialized


def test_inventory_rejects_ncep_components_with_different_grids(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    _write_dataset(data_root / "ncep_wind_subset" / "uwnd_2010_850hPa_WG.nc", variable="uwnd")
    _write_dataset(data_root / "ncep_wind_subset" / "vwnd_2010_850hPa_WG.nc", variable="vwnd")
    mismatched = xr.Dataset(
        {"shum": (("time", "lat", "lon"), np.ones((1, 2, 2)), {"units": "kg/kg"})},
        coords={"time": np.array(["2020-01-01"], dtype="datetime64[ns]"), "lat": np.array([7.0, 7.5]), "lon": np.array([72.0, 72.5])},
    )
    target = data_root / "ncep_wind_subset" / "shum_2010_850hPa_WG.nc"
    target.parent.mkdir(parents=True, exist_ok=True)
    mismatched.to_netcdf(target)

    report = build_inventory(data_root)

    codes = {blocker["code"] for blocker in report["validation"]["blockers"]}
    assert "NCEP_COMPONENT_GRID_INCOMPATIBLE" in codes

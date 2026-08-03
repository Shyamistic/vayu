"""Focused tests for leakage-safe manifest-driven split metadata."""

from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path

import numpy as np
import pytest
import xarray as xr
from typer.testing import CliRunner

from ai_engine.cli import app
from ai_engine.data_manifests import immutable_manifest_id
from ai_engine.data_splits import (
    SplitContractError,
    _spatial_masks,
    default_split_config,
    generate_split_metadata,
    validate_split_config,
)


def _write_source(path: Path, values: np.ndarray | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    values = values if values is not None else np.array([[[1.0, 2.0], [3.0, 4.0]], [[100.0, 100.0], [100.0, 100.0]], [[200.0, 200.0], [200.0, 200.0]]])
    xr.Dataset(
        {"rainfall": (("time", "lat", "lon"), values, {"units": "mm day-1"})},
        coords={
            "time": np.array(["2021-12-31", "2022-06-01", "2023-06-01"], dtype="datetime64[ns]"),
            "lat": np.array([8.0, 8.25]),
            "lon": np.array([72.5, 72.75]),
        },
    ).to_netcdf(path)


def _manifest(root: Path, source: Path) -> dict[str, object]:
    relative_uri = source.relative_to(root).as_posix()
    artifact = {"relative_uri": relative_uri, "file_type": "netcdf", "size_bytes": source.stat().st_size, "sha256": sha256(source.read_bytes()).hexdigest()}
    artifact_set = sha256(json.dumps([{"relative_uri": relative_uri, "sha256": artifact["sha256"]}], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    manifest: dict[str, object] = {
        "schema_version": "vayu.dataset-manifest/v1", "dataset_id": "synthetic-western-ghats",
        "source": {"provider": "test", "dataset": "synthetic"}, "license": {"name": "test", "status": "declared"},
        "lineage": {"source_manifest_ids": [], "source_dataset_ids": []}, "artifacts": [artifact],
        "artifact_set_sha256": artifact_set,
        "coverage": {"temporal": {"start": "2021-12-31", "end": "2023-06-01"}, "spatial": {"latitude": {"minimum": 8.0, "maximum": 8.25}, "longitude": {"minimum": 72.5, "maximum": 72.75}}},
        "preprocessing": [], "validation": {"status": "passed", "checks": [], "warnings": [], "blockers": []},
    }
    manifest["manifest_id"] = immutable_manifest_id(manifest)
    return manifest


def test_split_metadata_is_deterministic_strictly_ordered_and_training_only(tmp_path: Path) -> None:
    root = tmp_path / "data"
    source = root / "source" / "rainfall.nc"
    _write_source(source)
    config = default_split_config()
    config["spatial"]["region_order"] = ["western_ghats"]
    metadata = generate_split_metadata(_manifest(root, source), root, config=config)

    assert metadata["validation"]["status"] == "passed"
    assert metadata == generate_split_metadata(_manifest(root, source), root, config=config)
    assert metadata["assignment_counts"] == {"train": 1, "validation": 1, "test": 1}
    assert [item["split"] for item in metadata["assignments"]] == ["train", "validation", "test"]
    statistics = metadata["normalization"]["variables"]["rainfall"]
    assert statistics["fit_split"] == "train"
    assert statistics["count"] == 4
    assert statistics["mean"] == pytest.approx(2.5)
    assert statistics["mean"] != pytest.approx(100.0)
    assert metadata["split_id"].startswith("sha256:")
    assert metadata["assignments"][0]["assignment_id"].startswith("sha256:")


def test_spatial_buffers_create_disjoint_regional_and_composition_masks() -> None:
    config = default_split_config()
    config["spatial"]["region_order"] = ["western_ghats", "central_india"]
    masks = _spatial_masks(np.array([20.0, 20.25, 21.25]), np.array([74.0, 75.0, 84.0]), config)

    regional_masks = [masks[name] for name in config["spatial"]["region_order"]]
    assert not np.any(regional_masks[0] & regional_masks[1])
    assert not np.any(masks["full_india"] & regional_masks[0])
    assert not np.any(masks["full_india"] & regional_masks[1])


def test_checksum_mismatch_rejects_records_without_normalization(tmp_path: Path) -> None:
    root = tmp_path / "data"
    source = root / "source" / "rainfall.nc"
    _write_source(source)
    manifest = _manifest(root, source)
    source.write_bytes(source.read_bytes() + b"tampered")

    metadata = generate_split_metadata(manifest, root)
    assert metadata["validation"]["status"] == "rejected"
    assert metadata["assignments"] == []
    assert metadata["normalization"]["status"] == "not_fitted"
    assert {item["code"] for item in metadata["validation"]["blockers"]} == {"MANIFEST_ARTIFACT_CHECKSUM_MISMATCH"}


def test_ratio_configuration_is_rejected() -> None:
    config = default_split_config()
    config["temporal"]["train"] = {"ratio": 0.8}
    with pytest.raises(SplitContractError, match="ratio splits"):
        validate_split_config(config)


def test_splits_cli_requires_new_output_and_preserves_source(tmp_path: Path) -> None:
    root = tmp_path / "data"
    source = root / "source" / "rainfall.nc"
    _write_source(source)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(_manifest(root, source)), encoding="utf-8")
    output = tmp_path / "metadata" / "splits.json"
    before = sha256(source.read_bytes()).hexdigest()

    result = CliRunner().invoke(app, ["splits", "--root", str(root), "--manifest", str(manifest_path), "--output", str(output)])

    assert result.exit_code == 0, result.output
    assert "(passed)" in result.output
    assert sha256(source.read_bytes()).hexdigest() == before
    assert json.loads(output.read_text(encoding="utf-8"))["normalization"]["status"] == "fitted"

"""Tests for the calendar-based train/validation/test sequence CLI command."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import torch
import xarray as xr
from typer.testing import CliRunner

from data_ingestion.cli import app


def _write_normalized_dataset(path: Path, *, start: str, ndays: int) -> None:
    lats = np.arange(8.0, 9.25, 0.25)  # 5 points
    lons = np.arange(72.0, 73.25, 0.25)  # 5 points
    times = pd.date_range(start, periods=ndays)
    rng = np.random.default_rng(0)
    shape = (ndays, len(lats), len(lons))

    ds = xr.Dataset(
        {
            "rainfall": (("time", "lat", "lon"), rng.normal(0, 1, shape).astype(np.float32)),
            "tmax": (("time", "lat", "lon"), rng.normal(0, 1, shape).astype(np.float32)),
            "tmin": (("time", "lat", "lon"), rng.normal(0, 1, shape).astype(np.float32)),
        },
        coords={
            "time": times,
            "lat": lats,
            "lon": lons,
            "day_sin": ("time", np.sin(np.linspace(0, 2 * np.pi, ndays)).astype(np.float32)),
            "day_cos": ("time", np.cos(np.linspace(0, 2 * np.pi, ndays)).astype(np.float32)),
        },
    )
    ds.to_netcdf(path)


@pytest.fixture
def runner() -> CliRunner:
    return CliRunner()


def test_build_sequences_assigns_disjoint_calendar_splits(tmp_path: Path, runner: CliRunner) -> None:
    normalized = tmp_path / "normalized_2010-2013.nc"
    # 4 full years so each of train/validation/test has usable windows.
    _write_normalized_dataset(normalized, start="2010-01-01", ndays=365 * 4)
    output_dir = tmp_path / "processed"

    result = runner.invoke(app, [
        "build-sequences",
        "--normalized-file", str(normalized),
        "--output-dir", str(output_dir),
        "--input-window", "10",
        "--target-window", "5",
        "--train-start-year", "2010",
        "--train-end-year", "2011",
        "--val-start-year", "2012",
        "--val-end-year", "2012",
        "--test-start-year", "2013",
        "--test-end-year", "2013",
        "--stride", "5",
        "--max-train", "20",
        "--max-val", "10",
        "--max-test", "10",
    ])

    assert result.exit_code == 0, result.output
    for name in ["train_sequences.pt", "val_sequences.pt", "test_sequences.pt", "sequence_manifest.json"]:
        assert (output_dir / name).exists(), f"missing {name}"

    manifest = json.loads((output_dir / "sequence_manifest.json").read_text(encoding="utf-8"))
    assert manifest["schema_version"] == "vayu.sequence-manifest/v2"
    assert manifest["feature_count"] == 17
    for split_name, bounds in [("train", (2010, 2011)), ("validation", (2012, 2012)), ("test", (2013, 2013))]:
        split = manifest["splits"][split_name]
        assert split["start_year"] == bounds[0]
        assert split["end_year"] == bounds[1]
        first_year = pd.Timestamp(split["first_target_date"]).year
        last_year = pd.Timestamp(split["last_target_date"]).year
        assert bounds[0] <= first_year <= bounds[1]
        assert bounds[0] <= last_year <= bounds[1]

    # No target date leaks into an adjacent split.
    train_last = pd.Timestamp(manifest["splits"]["train"]["last_target_date"])
    val_first = pd.Timestamp(manifest["splits"]["validation"]["first_target_date"])
    val_last = pd.Timestamp(manifest["splits"]["validation"]["last_target_date"])
    test_first = pd.Timestamp(manifest["splits"]["test"]["first_target_date"])
    assert train_last < val_first
    assert val_last < test_first


def test_build_sequences_rejects_overlapping_calendar_ranges(tmp_path: Path, runner: CliRunner) -> None:
    normalized = tmp_path / "normalized.nc"
    _write_normalized_dataset(normalized, start="2010-01-01", ndays=100)
    output_dir = tmp_path / "processed"

    result = runner.invoke(app, [
        "build-sequences",
        "--normalized-file", str(normalized),
        "--output-dir", str(output_dir),
        "--train-start-year", "2010",
        "--train-end-year", "2011",
        "--val-start-year", "2011",  # overlaps train_end_year
        "--val-end-year", "2012",
        "--test-start-year", "2013",
        "--test-end-year", "2014",
    ])

    assert result.exit_code != 0
    assert not (output_dir / "train_sequences.pt").exists()


def test_build_sequences_requires_real_static_when_flagged(tmp_path: Path, runner: CliRunner) -> None:
    normalized = tmp_path / "normalized.nc"
    _write_normalized_dataset(normalized, start="2010-01-01", ndays=365 * 4)
    output_dir = tmp_path / "processed"

    result = runner.invoke(app, [
        "build-sequences",
        "--normalized-file", str(normalized),
        "--output-dir", str(output_dir),
        "--require-real-static",
        "--train-start-year", "2010",
        "--train-end-year", "2011",
        "--val-start-year", "2012",
        "--val-end-year", "2012",
        "--test-start-year", "2013",
        "--test-end-year", "2013",
    ])

    assert result.exit_code != 0
    assert "--require-real-static" in result.output


def test_build_sequences_missingness_indicators_extend_schema(tmp_path: Path, runner: CliRunner) -> None:
    normalized = tmp_path / "normalized.nc"
    _write_normalized_dataset(normalized, start="2010-01-01", ndays=365 * 4)
    output_dir = tmp_path / "processed"

    result = runner.invoke(app, [
        "build-sequences",
        "--normalized-file", str(normalized),
        "--output-dir", str(output_dir),
        "--include-missingness-indicators",
        "--train-start-year", "2010",
        "--train-end-year", "2011",
        "--val-start-year", "2012",
        "--val-end-year", "2012",
        "--test-start-year", "2013",
        "--test-end-year", "2013",
        "--stride", "10",
        "--max-train", "5",
        "--max-val", "5",
        "--max-test", "5",
    ])

    assert result.exit_code == 0, result.output
    manifest = json.loads((output_dir / "sequence_manifest.json").read_text(encoding="utf-8"))
    assert manifest["feature_count"] == 23
    assert manifest["missingness_indicators"] is True

    train_sequences = torch.load(output_dir / "train_sequences.pt", map_location="cpu", weights_only=False)
    graph, target = train_sequences[0]
    assert graph.x.shape[-1] == 23
    assert target.shape[-1] == 3

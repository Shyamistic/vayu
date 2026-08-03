"""Tests for read-only regional five-job readiness reporting."""

from __future__ import annotations

from pathlib import Path

from ai_engine.data_readiness import build_data_readiness_report, regional_job_contract, write_data_readiness_report


def test_regional_contract_has_exact_five_job_bounds_and_temporal_splits() -> None:
    contract = regional_job_contract()

    assert contract["regions"]["western_ghats"]["bounds"] == {"lat_min": 7.5, "lat_max": 21.5, "lon_min": 72.0, "lon_max": 77.5}
    assert contract["regions"]["north_east_india"]["bounds"] == {"lat_min": 22.0, "lat_max": 29.5, "lon_min": 88.0, "lon_max": 97.5}
    assert contract["regions"]["indo_gangetic_plain"]["bounds"] == {"lat_min": 23.0, "lat_max": 31.5, "lon_min": 74.0, "lon_max": 89.5}
    assert contract["regions"]["central_india"]["bounds"] == {"lat_min": 17.0, "lat_max": 25.5, "lon_min": 74.0, "lon_max": 84.5}
    assert contract["regions"]["full_india"]["bounds"] == {"lat_min": 6.0, "lat_max": 38.0, "lon_min": 66.0, "lon_max": 100.0}
    assert contract["temporal_split"] == {"train": {"start_year": 2010, "end_year": 2021}, "validation": {"start_year": 2022, "end_year": 2022}, "test": {"start_year": 2023, "end_year": 2025}}


def test_readiness_report_keeps_external_assets_pending_and_refuses_overwrite(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    data_root.mkdir()
    for name in ("chirps", "checkpoints", "HydroRIVERS_v10_as.gdb"):
        (tmp_path / name).mkdir()

    report = build_data_readiness_report(data_root, repository_root=tmp_path)
    output = tmp_path / "generated" / "readiness-v1"
    json_path, markdown_path = write_data_readiness_report(report, output)

    assert report["overall_status"] == "blocked"
    assert report["families"]["chirps"]["status"] == "pending_provenance"
    assert "WG_WIND_CANDIDATE_ONLY" in {item["code"] for item in report["blockers"]}
    assert json_path.is_file() and markdown_path.is_file()
    try:
        write_data_readiness_report(report, output)
    except FileExistsError:
        pass
    else:  # pragma: no cover - makes overwrite protection explicit.
        raise AssertionError("expected existing generated report directory to be refused")

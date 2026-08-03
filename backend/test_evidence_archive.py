"""Tests for Task 30.1 provenance-preserving evidence persistence."""
from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from backend.database import DatabaseClient, EvidenceValidationError, canonical_payload_checksum


class _Connection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetchrow(self, query: str, *args: object) -> dict[str, int]:
        self.calls.append((query, args))
        return {"id": 41}


class _Acquire:
    def __init__(self, connection: _Connection) -> None:
        self._connection = connection

    async def __aenter__(self) -> _Connection:
        return self._connection

    async def __aexit__(self, *_: object) -> None:
        return None


class _Pool:
    def __init__(self, connection: _Connection) -> None:
        self._connection = connection

    def acquire(self) -> _Acquire:
        return _Acquire(self._connection)


def _prediction_kwargs() -> dict[str, object]:
    issue_time = datetime(2025, 7, 15, 12, tzinfo=UTC)
    return {
        "cycle_id": "c2e23117-5b10-4cc2-a57e-2f6edb7891bb",
        "prediction_date": date(2025, 7, 15),
        "target_date": date(2025, 7, 16),
        "lead_day": 1,
        "region": "north_east_india",
        "grid_cells": [{"lat": 26.98, "lon": 94.94, "rainfall": 13.2}],
        "source_identifier": "vayu-model-inference",
        "retrieved_at": issue_time,
        "freshness_at": issue_time,
        "forecast_issue_time": issue_time,
        "forecast_target_time": datetime(2025, 7, 16, tzinfo=UTC),
        "model_version": "vayu-2025.07",
        "run_version": "run-2025-07-15T12",
        "manifest_version": "manifest-2025.07",
        "calibration_version": "calibration-3",
        "quality_flags": ["qc_invalid_values_removed:0"],
    }


def test_checksum_is_order_independent_and_sha256_shaped() -> None:
    assert canonical_payload_checksum({"b": 2, "a": [1]}) == canonical_payload_checksum({"a": [1], "b": 2})
    assert len(canonical_payload_checksum({"a": 1})) == 64


@pytest.mark.asyncio
async def test_prediction_archive_persists_complete_provenance_and_checksum() -> None:
    connection = _Connection()
    db = DatabaseClient("postgresql://unused")
    db._pool = _Pool(connection)

    archived_id = await db.archive_prediction(**_prediction_kwargs())

    assert archived_id == 41
    query, args = connection.calls[0]
    assert "evidence_complete" in query
    assert args[6] == "vayu-model-inference"
    assert args[16] == canonical_payload_checksum(_prediction_kwargs()["grid_cells"])


@pytest.mark.asyncio
async def test_prediction_archive_rejects_simulated_source_before_database_access() -> None:
    db = DatabaseClient("postgresql://unused")
    invalid = _prediction_kwargs()
    invalid["source_identifier"] = "mock-grid-generator"

    with pytest.raises(EvidenceValidationError, match="cannot be archived"):
        await db.archive_prediction(**invalid)


@pytest.mark.asyncio
async def test_prediction_archive_requires_reproducible_version_provenance() -> None:
    db = DatabaseClient("postgresql://unused")
    incomplete = _prediction_kwargs()
    incomplete["manifest_version"] = None

    with pytest.raises(EvidenceValidationError, match="manifest_version is required"):
        await db.archive_prediction(**incomplete)


@pytest.mark.asyncio
async def test_observation_archive_computes_and_persists_immutable_payload_checksum() -> None:
    connection = _Connection()
    db = DatabaseClient("postgresql://unused")
    db._pool = _Pool(connection)
    retrieved_at = datetime(2025, 7, 15, 12, tzinfo=UTC)
    payload = {"hourly": {"temperature_2m": [30.0]}, "region": "north_east_india"}

    archived_id = await db.archive_observation(
        source_identifier="open-meteo-forecast",
        region="north_east_india",
        payload=payload,
        retrieved_at=retrieved_at,
        freshness_at=retrieved_at,
    )

    assert archived_id == 41
    assert connection.calls[0][1][-1] == canonical_payload_checksum(payload)


def test_migration_enforces_append_only_complete_evidence() -> None:
    migration = Path(__file__).with_name("migrations").joinpath(
        "004_provenance_evidence_archive.sql"
    ).read_text(encoding="utf-8")

    for field in (
        "source_identifier", "retrieved_at", "freshness_at", "forecast_issue_time",
        "forecast_target_time", "run_version", "manifest_version", "calibration_version", "quality_flags",
        "payload_checksum", "evidence_complete",
    ):
        assert field in migration
    assert "completed prediction evidence is append-only" in migration
    assert "observation evidence is append-only" in migration

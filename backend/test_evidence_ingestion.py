"""Focused tests for Task 30.2 live and replay evidence adapters."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from backend.evidence_ingestion import (
    IngestionState,
    LiveReplayIngestionAdapter,
    UPPER_ASSAM_SIVASAGAR_REGION,
    UpperAssamSivasagarReplayAdapter,
)


class RecordingArchiver:
    def __init__(self, archive_id: int | None = 17) -> None:
        self.archive_id = archive_id
        self.calls: list[dict] = []

    async def archive_observation(self, **kwargs: object) -> int | None:
        self.calls.append(kwargs)
        return self.archive_id


def weather_payload(observed_at: datetime, **overrides: object) -> dict:
    payload = {
        "region": UPPER_ASSAM_SIVASAGAR_REGION,
        "observed_at": observed_at.isoformat(),
        "freshness_at": observed_at.isoformat(),
        "hourly": {"temperature_2m": [28.5], "precipitation": [12.0]},
    }
    payload.update(overrides)
    return payload


@pytest.mark.asyncio
async def test_configured_live_weather_append_archives_complete_provenance() -> None:
    archiver = RecordingArchiver()
    adapter = LiveReplayIngestionAdapter(archiver)
    now = datetime(2025, 7, 15, 12, tzinfo=UTC)

    result = await adapter.append_live("open-meteo-forecast", weather_payload(now), retrieved_at=now)

    assert result.state is IngestionState.FRESH
    assert result.archive_id == 17
    assert archiver.calls[0]["source_identifier"] == "open-meteo-forecast"
    assert archiver.calls[0]["observed_at"] == now
    assert "ingestion_mode:configured-live-append" in archiver.calls[0]["quality_flags"]


@pytest.mark.asyncio
async def test_stale_or_simulated_inputs_are_never_archived_as_observation_evidence() -> None:
    archiver = RecordingArchiver()
    adapter = LiveReplayIngestionAdapter(archiver)
    now = datetime(2025, 7, 15, 12, tzinfo=UTC)

    stale = await adapter.append_live(
        "open-meteo-forecast", weather_payload(now - timedelta(minutes=31)), retrieved_at=now
    )
    simulated = await adapter.append_live(
        "open-meteo-forecast", weather_payload(now, provenance_note="synthetic test sequence"), retrieved_at=now
    )

    assert stale.state is IngestionState.STALE
    assert stale.reason == "freshness_sla_exceeded"
    assert simulated.state is IngestionState.INSUFFICIENT_EVIDENCE
    assert archiver.calls == []


def test_replay_is_deterministically_ordered_and_labeled_without_demo_values() -> None:
    adapter = LiveReplayIngestionAdapter(RecordingArchiver())
    replay = UpperAssamSivasagarReplayAdapter(adapter)
    first = datetime(2024, 6, 20, 0, tzinfo=UTC)
    second = first + timedelta(hours=6)
    records = [
        {"source_name": "open-meteo-forecast", "payload": weather_payload(second), "retrieved_at": second},
        {"source_name": "open-meteo-forecast", "payload": weather_payload(first), "retrieved_at": first},
    ]

    result, frames = replay.prepare(records)

    assert result.state is IngestionState.FRESH
    assert [frame.evidence.observed_at for frame in frames] == [first, second]
    assert [frame.sequence for frame in frames] == [0, 1]
    assert all("deterministic-replay:upper-assam-sivasagar-v1" == frame.evidence.ingestion_label for frame in frames)


def test_replay_fails_closed_when_a_record_is_outside_upper_assam_sivasagar() -> None:
    adapter = LiveReplayIngestionAdapter(RecordingArchiver())
    replay = UpperAssamSivasagarReplayAdapter(adapter)
    now = datetime(2024, 6, 20, tzinfo=UTC)

    result, frames = replay.prepare([
        {"source_name": "open-meteo-forecast", "payload": weather_payload(now, region="pilot"), "retrieved_at": now}
    ])

    assert result.state is IngestionState.INSUFFICIENT_EVIDENCE
    assert result.reason == "replay_region_invalid"
    assert frames == ()

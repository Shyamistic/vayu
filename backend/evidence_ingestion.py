"""Fail-closed live and deterministic replay evidence ingestion (Task 30.2)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any, Iterable, Mapping, Protocol

from backend.database import EvidenceValidationError, canonical_payload_checksum

LIVE_FRESHNESS_LIMIT = timedelta(minutes=30)
UPPER_ASSAM_SIVASAGAR_REGION = "upper_assam_sivasagar"
UPPER_ASSAM_SIVASAGAR_REPLAY_ID = "upper-assam-sivasagar-v1"
_PROHIBITED_EVIDENCE_MARKERS = ("mock", "simulat", "synthetic", "climatolog")


class IngestionState(StrEnum):
    FRESH = "fresh"
    STALE = "stale"
    FAILED = "failed"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"


class EvidenceSourceKind(StrEnum):
    WEATHER = "weather"
    SATELLITE = "satellite"
    STATION = "station"
    FLOOD_OBSERVATION = "flood_observation"


@dataclass(frozen=True)
class EvidenceSourceConfig:
    """An approved evidence source; enabled modes are explicit deployment config."""

    name: str
    kind: EvidenceSourceKind
    source_identifier: str
    default_region: str | None = None
    live_enabled: bool = True
    replay_enabled: bool = True


DEFAULT_EVIDENCE_SOURCES = (
    EvidenceSourceConfig("open-meteo-forecast", EvidenceSourceKind.WEATHER, "open-meteo-forecast"),
    EvidenceSourceConfig("mosdac-insat-3d", EvidenceSourceKind.SATELLITE, "mosdac-insat-3d"),
    EvidenceSourceConfig("aws-iot-core-stations", EvidenceSourceKind.STATION, "aws-iot-core:mausam/stations/+/data"),
    EvidenceSourceConfig("imd-cwc-flood-observations", EvidenceSourceKind.FLOOD_OBSERVATION, "imd-cwc-flood-observations"),
)


class ObservationArchiver(Protocol):
    async def archive_observation(self, **kwargs: Any) -> int | None: ...


@dataclass(frozen=True)
class NormalizedEvidence:
    source_kind: EvidenceSourceKind
    source_identifier: str
    region: str | None
    payload: dict[str, Any]
    observed_at: datetime
    retrieved_at: datetime
    freshness_at: datetime
    quality_flags: tuple[str, ...]
    ingestion_label: str


@dataclass(frozen=True)
class IngestionResult:
    state: IngestionState
    reason: str | None = None
    evidence: NormalizedEvidence | None = None
    archive_id: int | None = None


@dataclass(frozen=True)
class ReplayFrame:
    sequence: int
    evidence: NormalizedEvidence


def configured_evidence_sources() -> dict[str, EvidenceSourceConfig]:
    """Return the deployment-approved source registry used by default."""
    return {source.name: source for source in DEFAULT_EVIDENCE_SOURCES}


def _as_utc(value: Any, field: str) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError(f"{field} is not a valid ISO-8601 timestamp") from exc
    else:
        raise ValueError(f"{field} is required")
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field} must include a timezone")
    return parsed.astimezone(UTC)


def _contains_prohibited_marker(value: Any) -> bool:
    try:
        text = json.dumps(value, sort_keys=True, default=str).lower()
    except (TypeError, ValueError):
        return True
    return any(marker in text for marker in _PROHIBITED_EVIDENCE_MARKERS)


class LiveReplayIngestionAdapter:
    """Normalise only configured primary-source observations before archival.

    A status is returned for every rejected input.  In particular, cached,
    stale, simulated, or provenance-incomplete input never reaches the archive.
    """

    def __init__(
        self,
        archiver: ObservationArchiver,
        *,
        sources: Mapping[str, EvidenceSourceConfig] | None = None,
        live_freshness_limit: timedelta = LIVE_FRESHNESS_LIMIT,
    ) -> None:
        self._archiver = archiver
        self._sources = dict(sources or configured_evidence_sources())
        self._live_freshness_limit = live_freshness_limit

    def normalize(
        self,
        source_name: str,
        payload: Mapping[str, Any],
        *,
        retrieved_at: datetime,
        mode: str,
        quality_flags: Iterable[str] = (),
    ) -> IngestionResult:
        if mode not in {"live", "replay"}:
            return IngestionResult(IngestionState.FAILED, "ingestion_mode_invalid")
        source = self._sources.get(source_name)
        if source is None:
            return IngestionResult(IngestionState.INSUFFICIENT_EVIDENCE, "source_not_approved")
        if mode == "live" and not source.live_enabled:
            return IngestionResult(IngestionState.FAILED, "live_source_not_configured")
        if mode == "replay" and not source.replay_enabled:
            return IngestionResult(IngestionState.FAILED, "replay_source_not_configured")
        if not isinstance(payload, Mapping) or not payload:
            return IngestionResult(IngestionState.INSUFFICIENT_EVIDENCE, "payload_missing")
        if payload.get("stale") is True:
            return IngestionResult(IngestionState.STALE, str(payload.get("stale_reason", "source_marked_stale")))
        if payload.get("failed") is True or payload.get("error"):
            return IngestionResult(IngestionState.FAILED, "source_reported_failure")
        supplied_source = payload.get("source_identifier")
        if supplied_source is not None and supplied_source != source.source_identifier:
            return IngestionResult(IngestionState.INSUFFICIENT_EVIDENCE, "source_identifier_mismatch")
        if _contains_prohibited_marker(source.source_identifier) or _contains_prohibited_marker(payload):
            return IngestionResult(IngestionState.INSUFFICIENT_EVIDENCE, "non_observation_evidence_rejected")

        try:
            retrieved = _as_utc(retrieved_at, "retrieved_at")
            observed = _as_utc(
                payload.get("observed_at", payload.get("timestamp", payload.get("acquisition_time"))),
                "observed_at",
            )
            freshness = _as_utc(payload.get("freshness_at", observed), "freshness_at")
        except ValueError as exc:
            return IngestionResult(IngestionState.INSUFFICIENT_EVIDENCE, str(exc))

        if mode == "live" and retrieved - freshness > self._live_freshness_limit:
            return IngestionResult(IngestionState.STALE, "freshness_sla_exceeded")
        region = payload.get("region", source.default_region)
        if region is not None and (not isinstance(region, str) or not region.strip()):
            return IngestionResult(IngestionState.INSUFFICIENT_EVIDENCE, "region_invalid")
        raw_flags = payload.get("quality_flags", ())
        if not isinstance(raw_flags, (list, tuple)):
            return IngestionResult(IngestionState.INSUFFICIENT_EVIDENCE, "quality_flags_invalid")
        all_flags = tuple(quality_flags) + tuple(raw_flags)
        if not all(isinstance(flag, str) and flag.strip() for flag in all_flags):
            return IngestionResult(IngestionState.INSUFFICIENT_EVIDENCE, "quality_flags_invalid")

        label = "configured-live-append" if mode == "live" else "deterministic-replay"
        return IngestionResult(
            IngestionState.FRESH,
            evidence=NormalizedEvidence(
                source_kind=source.kind,
                source_identifier=source.source_identifier,
                region=region.strip() if isinstance(region, str) else None,
                payload=dict(payload),
                observed_at=observed,
                retrieved_at=retrieved,
                freshness_at=freshness,
                quality_flags=all_flags,
                ingestion_label=label,
            ),
        )

    async def append_live(
        self,
        source_name: str,
        payload: Mapping[str, Any],
        *,
        retrieved_at: datetime,
        quality_flags: Iterable[str] = (),
    ) -> IngestionResult:
        """Append a configured live record, or return an explicit non-evidence state."""
        result = self.normalize(
            source_name, payload, retrieved_at=retrieved_at, mode="live", quality_flags=quality_flags
        )
        if result.evidence is None:
            return result
        return await self._archive(result.evidence)

    async def _archive(self, evidence: NormalizedEvidence) -> IngestionResult:
        flags = [*evidence.quality_flags, f"ingestion_mode:{evidence.ingestion_label}"]
        try:
            archive_id = await self._archiver.archive_observation(
                source_identifier=evidence.source_identifier,
                region=evidence.region,
                payload=evidence.payload,
                observed_at=evidence.observed_at,
                retrieved_at=evidence.retrieved_at,
                freshness_at=evidence.freshness_at,
                quality_flags=flags,
            )
        except (EvidenceValidationError, Exception) as exc:
            return IngestionResult(IngestionState.FAILED, f"archive_failed:{exc}")
        if archive_id is None:
            return IngestionResult(IngestionState.FAILED, "archive_not_confirmed")
        return IngestionResult(IngestionState.FRESH, evidence=evidence, archive_id=archive_id)


class UpperAssamSivasagarReplayAdapter:
    """Create stable historical replay frames from already-provenanced observations.

    This adapter intentionally ships no hard-coded rainfall, satellite, station,
    or flood values.  A replay can only be built from supplied source evidence,
    preventing demo fixtures from being represented as observed conditions.
    """

    def __init__(self, ingestion: LiveReplayIngestionAdapter) -> None:
        self._ingestion = ingestion

    def prepare(
        self,
        records: Iterable[Mapping[str, Any]],
        *,
        replay_id: str = UPPER_ASSAM_SIVASAGAR_REPLAY_ID,
    ) -> tuple[IngestionResult, tuple[ReplayFrame, ...]]:
        if replay_id != UPPER_ASSAM_SIVASAGAR_REPLAY_ID:
            return IngestionResult(IngestionState.FAILED, "replay_not_configured"), ()

        frames: list[NormalizedEvidence] = []
        for entry in records:
            source_name = entry.get("source_name") if isinstance(entry, Mapping) else None
            payload = entry.get("payload") if isinstance(entry, Mapping) else None
            retrieved_at = entry.get("retrieved_at") if isinstance(entry, Mapping) else None
            if not isinstance(source_name, str) or not isinstance(payload, Mapping):
                return IngestionResult(IngestionState.INSUFFICIENT_EVIDENCE, "replay_record_invalid"), ()
            result = self._ingestion.normalize(
                source_name, payload, retrieved_at=retrieved_at, mode="replay"
            )
            evidence = result.evidence
            if evidence is None:
                return result, ()
            if evidence.region != UPPER_ASSAM_SIVASAGAR_REGION:
                return IngestionResult(IngestionState.INSUFFICIENT_EVIDENCE, "replay_region_invalid"), ()
            frames.append(evidence)

        ordered = sorted(
            frames,
            key=lambda evidence: (
                evidence.observed_at,
                evidence.source_identifier,
                canonical_payload_checksum(evidence.payload),
            ),
        )
        labelled = tuple(
            ReplayFrame(
                sequence=index,
                evidence=NormalizedEvidence(
                    **{**evidence.__dict__, "ingestion_label": f"deterministic-replay:{replay_id}"}
                ),
            )
            for index, evidence in enumerate(ordered)
        )
        return IngestionResult(IngestionState.FRESH), labelled

    async def append(self, frames: Iterable[ReplayFrame]) -> IngestionResult:
        """Archive prepared replay frames using the same immutable evidence contract."""
        for frame in frames:
            result = await self._ingestion._archive(frame.evidence)
            if result.state is not IngestionState.FRESH:
                return result
        return IngestionResult(IngestionState.FRESH)

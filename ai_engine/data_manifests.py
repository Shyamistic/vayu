"""Canonical, portable dataset manifests derived from the data inventory."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
from typing import Any, Mapping, Sequence

from .data_inventory import build_inventory


MANIFEST_SCHEMA_VERSION = "vayu.dataset-manifest/v1"
CATALOG_SCHEMA_VERSION = "vayu.dataset-manifest-catalog/v1"

# Dependency-free JSON-schema descriptors; validate_* enforces them at runtime.
MANIFEST_SCHEMA: dict[str, Any] = {
    "$id": MANIFEST_SCHEMA_VERSION,
    "type": "object",
    "required": [
        "schema_version", "dataset_id", "source", "license", "lineage", "artifacts",
        "artifact_set_sha256", "coverage", "preprocessing", "validation", "manifest_id",
    ],
    "properties": {
        "schema_version": {"const": MANIFEST_SCHEMA_VERSION},
        "artifacts": {"type": "array"},
        "manifest_id": {"pattern": "^sha256:[0-9a-f]{64}$"},
    },
}
CATALOG_SCHEMA: dict[str, Any] = {
    "$id": CATALOG_SCHEMA_VERSION,
    "type": "object",
    "required": ["schema_version", "data_root", "manifests"],
    "properties": {"schema_version": {"const": CATALOG_SCHEMA_VERSION}, "manifests": {"type": "array"}},
}


@dataclass(frozen=True)
class DatasetAdapter:
    """Declarative description of a research dataset family below a data root."""

    identifier: str
    relative_roots: tuple[str, ...]
    source: Mapping[str, str]
    license: Mapping[str, str]
    preprocessing: tuple[str, ...]
    derived_from: tuple[str, ...] = ()


# These entries intentionally describe dataset families rather than host-specific paths.
RESEARCH_DATASET_ADAPTERS: tuple[DatasetAdapter, ...] = (
    DatasetAdapter(
        identifier="imd-observations",
        relative_roots=("imd",),
        source={"provider": "India Meteorological Department", "dataset": "Daily gridded rainfall and temperature"},
        license={"name": "not_declared", "status": "unverified"},
        preprocessing=("source observations retained without manifest-side modification",),
    ),
    DatasetAdapter(
        identifier="chirps-western-ghats",
        relative_roots=("chirps_subset",),
        source={"provider": "Climate Hazards Center", "dataset": "CHIRPS western-ghats subset"},
        license={"name": "not_declared", "status": "unverified"},
        preprocessing=("regional subset supplied as existing NetCDF artifacts",),
    ),
    DatasetAdapter(
        identifier="ncep-broad-reanalysis",
        relative_roots=("ncep_wind",),
        source={"provider": "NOAA/NCEP", "dataset": "Wind reanalysis"},
        license={"name": "public-data terms require source verification", "status": "unverified"},
        preprocessing=("existing annual NetCDF artifacts; no manifest-side reprocessing",),
    ),
    DatasetAdapter(
        identifier="ncep-western-ghats-subset",
        relative_roots=("ncep_wind_subset",),
        source={"provider": "NOAA/NCEP", "dataset": "Western Ghats wind, humidity, and pressure subset"},
        license={"name": "public-data terms require source verification", "status": "unverified"},
        preprocessing=("existing regional and pressure-level subset; no manifest-side reprocessing",),
    ),
    DatasetAdapter(
        identifier="full-india-training-bundle",
        relative_roots=("kaggle_bundle_full_india", "processed_full_india"),
        source={"provider": "VAYU research bundle", "dataset": "Full India training artifacts 2010-2025"},
        license={"name": "CC-BY-4.0", "status": "declared in dataset-metadata.json"},
        preprocessing=("regrid_to_target", "quality_control", "normalize", "encode_cyclical_time", "sequence generation"),
        derived_from=("imd-observations",),
    ),
    DatasetAdapter(
        identifier="western-ghats-training-bundle",
        relative_roots=("kaggle_bundle_western_ghats", "processed_western_ghats"),
        source={"provider": "VAYU research bundle", "dataset": "Western Ghats training artifacts 2010-2025"},
        license={"name": "not_declared", "status": "unverified"},
        preprocessing=("regrid_to_target", "quality_control", "normalize", "encode_cyclical_time", "sequence generation"),
        derived_from=("imd-observations", "chirps-western-ghats", "ncep-western-ghats-subset"),
    ),
    # ── Static feature adapters (elevation, land cover, population) ──────────
    # Files are already downloaded (see DATA_ACQUISITION_TASKS.md §1), but this
    # repository has never recorded them as accepted provenance. Each remains
    # "unverified" — and therefore blocked — until a human records the exact
    # source URL/version, license terms, CRS/datum, resampling policy, and
    # retrieval date per the manual_acquisition_checklist in data_readiness.py,
    # then flips `license.status` to "verified".
    DatasetAdapter(
        identifier="copernicus-dem-90m",
        relative_roots=("copernicus_dem_90m",),
        source={
            "provider": "European Space Agency (ESA) / Copernicus",
            "dataset": "Copernicus DEM GLO-90 90m elevation, India tiles",
            "known_distribution": "s3://copernicus-dem-90m (AWS Open Data, --no-sign-request)",
        },
        license={
            "name": "Copernicus DEM Terms of Use",
            "status": "unverified",
            "note": "License name is publicly documented; retrieval date, exact terms text, and checksum ledger are not yet recorded here.",
        },
        preprocessing=("existing per-tile GeoTIFF artifacts; no manifest-side reprocessing",),
    ),
    DatasetAdapter(
        identifier="esa-worldcover-2021",
        relative_roots=("esa_worldcover_2021",),
        source={
            "provider": "ESA WorldCover Consortium",
            "dataset": "ESA WorldCover 10m 2021 v200 land cover, India tiles",
            "known_distribution": "s3://esa-worldcover/v200/2021/map (AWS Open Data, --no-sign-request)",
        },
        license={
            "name": "CC-BY-4.0",
            "status": "unverified",
            "note": "License name is publicly documented for WorldCover; retrieval date and checksum ledger are not yet recorded here.",
        },
        preprocessing=("existing per-tile GeoTIFF artifacts; no manifest-side reprocessing",),
    ),
    DatasetAdapter(
        identifier="worldpop-india-population",
        relative_roots=("worldpop",),
        source={
            "provider": "WorldPop, University of Southampton",
            "dataset": "WorldPop India population count/density",
        },
        license={
            "name": "CC-BY-4.0",
            "status": "unverified",
            "note": "License name is publicly documented for WorldPop; exact product version, retrieval date, and checksum ledger are not yet recorded here.",
        },
        preprocessing=("existing raster artifacts; no manifest-side reprocessing",),
    ),
    # ── Reanalysis atmosphere adapter ─────────────────────────────────────────
    DatasetAdapter(
        identifier="era5-850hpa-reanalysis",
        relative_roots=("era5", "era5_pressure_levels"),
        source={
            "provider": "Copernicus Climate Change Service (C3S) / ECMWF",
            "dataset": "ERA5 850 hPa wind, humidity, and single-level daily statistics, 2010-2025",
            "cds_datasets": [
                "derived-era5-pressure-levels-daily-statistics",
                "derived-era5-single-levels-daily-statistics",
            ],
        },
        license={
            "name": "Licence to Use Copernicus Products",
            "status": "unverified",
            "note": "Terms were accepted manually in the CDS UI per download_era5.py; the acceptance date, CDS request parameters, and checksum ledger are not yet recorded here.",
        },
        preprocessing=("existing per-year per-variable NetCDF artifacts; no manifest-side reprocessing",),
    ),
    # ── Independent rainfall verification adapter (not a training feature) ───
    # IMERG is explicitly a third-party verification source for the rainfall
    # target (see DATA_ACQUISITION_TASKS.md §3), not one of the 17 declared
    # model input features. It remains blocked until the actual GES DISC
    # product/retrieval URL and retrieval date replace the teammate's local
    # `source.input_directory` path, and the files are placed under
    # `data/gpm_imerg/`.
    DatasetAdapter(
        identifier="gpm-imerg-rainfall-verification",
        relative_roots=("gpm_imerg",),
        source={
            "provider": "NASA Global Precipitation Measurement (GPM) mission",
            "dataset": "GPM IMERG Final Run Daily rainfall, regional NetCDF/JSON subsets",
            "role": "independent_rainfall_verification_source",
            "not_a_declared_training_feature": True,
        },
        license={
            "name": "CC0: Public Domain",
            "status": "unverified",
            "note": "Kaggle listing declares CC0, but the manifest still needs the actual GES DISC product page URL and retrieval date rather than a local Windows path.",
        },
        preprocessing=("clip_to_region_bounds", "regrid_to_target_grid", "aggregate_to_daily"),
    ),
)


def build_manifest_catalog(
    data_root: str | Path,
    *,
    inventory: Mapping[str, Any] | None = None,
    root_source: str = "cli",
) -> dict[str, Any]:
    """Build a deterministic catalog from inventory evidence without editing data files."""
    if inventory is None:
        inventory = build_inventory(data_root, root_source=root_source)
    records = inventory.get("files", [])
    validation = inventory.get("validation", {})
    manifests: list[dict[str, Any]] = []
    manifest_ids: dict[str, str] = {}

    for adapter in RESEARCH_DATASET_ADAPTERS:
        dataset_records = _records_for_adapter(adapter, records)
        artifacts = _artifacts_for(adapter, dataset_records)
        outcome = _validation_for(adapter, validation, records)
        lineage = {
            "source_manifest_ids": [manifest_ids[parent] for parent in adapter.derived_from],
            "source_dataset_ids": list(adapter.derived_from),
        }
        manifest = {
            "schema_version": MANIFEST_SCHEMA_VERSION,
            "dataset_id": adapter.identifier,
            "source": dict(adapter.source),
            "license": dict(adapter.license),
            "lineage": lineage,
            "artifacts": artifacts,
            "artifact_set_sha256": _artifact_set_checksum(artifacts),
            "coverage": _coverage(dataset_records),
            "preprocessing": [{"step": step} for step in adapter.preprocessing],
            "validation": outcome,
        }
        manifest["manifest_id"] = immutable_manifest_id(manifest)
        validate_manifest(manifest)
        manifest_ids[adapter.identifier] = manifest["manifest_id"]
        manifests.append(manifest)

    catalog = {
        "schema_version": CATALOG_SCHEMA_VERSION,
        "data_root": {"relative_uri": "data/", "resolution_source": inventory.get("data_root", {}).get("resolution_source", root_source)},
        "manifests": manifests,
    }
    validate_manifest_catalog(catalog)
    return catalog


def immutable_manifest_id(manifest: Mapping[str, Any]) -> str:
    """Return the content-addressed ID for a manifest, excluding its own ID field."""
    canonical = {key: value for key, value in manifest.items() if key != "manifest_id"}
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return f"sha256:{sha256(encoded.encode('utf-8')).hexdigest()}"


def validate_manifest(manifest: Mapping[str, Any]) -> None:
    """Reject incomplete, host-specific, or tampered canonical manifests."""
    required = {"schema_version", "dataset_id", "source", "license", "lineage", "artifacts", "artifact_set_sha256", "coverage", "preprocessing", "validation", "manifest_id"}
    missing = required - set(manifest)
    if missing:
        raise ValueError(f"Manifest is missing required fields: {', '.join(sorted(missing))}")
    if manifest["schema_version"] != MANIFEST_SCHEMA_VERSION:
        raise ValueError("Unsupported manifest schema version")
    if not isinstance(manifest["source"], Mapping) or not manifest["source"].get("provider"):
        raise ValueError("Manifest source metadata must identify a provider")
    if not isinstance(manifest["license"], Mapping) or not manifest["license"].get("name"):
        raise ValueError("Manifest license metadata must include a name")
    for artifact in manifest["artifacts"]:
        relative_uri = artifact.get("relative_uri")
        if not _is_portable_relative_uri(relative_uri):
            raise ValueError(f"Artifact URI is not portable and relative: {relative_uri!r}")
        checksum = artifact.get("sha256")
        if not isinstance(checksum, str) or len(checksum) != 64:
            raise ValueError("Each artifact must include a SHA-256 checksum")
    if manifest["artifact_set_sha256"] != _artifact_set_checksum(manifest["artifacts"]):
        raise ValueError("Artifact set checksum does not match listed artifacts")
    if manifest["manifest_id"] != immutable_manifest_id(manifest):
        raise ValueError("Manifest ID does not match immutable manifest content")


def validate_manifest_catalog(catalog: Mapping[str, Any]) -> None:
    """Validate catalog shape and ensure all stored paths stay portable."""
    if catalog.get("schema_version") != CATALOG_SCHEMA_VERSION:
        raise ValueError("Unsupported manifest catalog schema version")
    if catalog.get("data_root", {}).get("relative_uri") != "data/":
        raise ValueError("Catalog data root must be the portable data/ URI")
    manifests = catalog.get("manifests")
    if not isinstance(manifests, list) or not manifests:
        raise ValueError("Manifest catalog must contain at least one manifest")
    identifiers = [manifest.get("dataset_id") for manifest in manifests]
    if len(set(identifiers)) != len(identifiers):
        raise ValueError("Manifest dataset IDs must be unique")
    for manifest in manifests:
        validate_manifest(manifest)


def _artifacts_for(adapter: DatasetAdapter, records: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    artifacts = []
    for record in records:
        relative_path = record.get("relative_path")
        if not isinstance(relative_path, str) or not any(_belongs_to(relative_path, root) for root in adapter.relative_roots):
            continue
        artifacts.append({
            "relative_uri": relative_path,
            "file_type": record.get("file_type"),
            "size_bytes": record.get("size_bytes"),
            "sha256": record.get("sha256"),
        })
    return sorted(artifacts, key=lambda item: item["relative_uri"])


def _validation_for(
    adapter: DatasetAdapter,
    validation: Mapping[str, Any],
    records: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    checks = [item for item in validation.get("checks", []) if _belongs_to_adapter(item.get("relative_path"), adapter)]
    blockers = [item for item in validation.get("blockers", []) if _belongs_to_adapter(item.get("relative_path"), adapter)]
    warnings: list[dict[str, Any]] = []
    if adapter.license.get("status") != "verified":
        blockers.append({
            "code": "SOURCE_PROVENANCE_UNVERIFIED",
            "message": "A present local file is not accepted for training until provider, license/terms, retrieval record, checksums, and lineage are verified.",
            "relative_path": f"{adapter.relative_roots[0]}/",
            "details": {"license_status": adapter.license.get("status")},
        })
    if not _artifacts_for(adapter, records):
        blockers.append({
            "code": "DATASET_ARTIFACTS_MISSING",
            "message": "No artifacts matching this declarative dataset adapter exist below the selected data root.",
            "relative_path": f"{adapter.relative_roots[0]}/",
            "details": {},
        })
    if adapter.identifier == "ncep-western-ghats-subset":
        broad = _time_coverage(_records_for_root(records, "ncep_wind"))
        subset = _time_coverage(_records_for_root(records, "ncep_wind_subset"))
        if broad != subset:
            warnings.append({
                "code": "NCEP_WG_SUBSET_COVERAGE_DIFFERS",
                "message": "Western Ghats NCEP subset coverage differs from broad NCEP coverage.",
                "relative_path": "ncep_wind_subset/",
                "details": {"broad": broad, "western_ghats_subset": subset},
            })
    status = "blocked" if blockers else "warning" if warnings else "passed"
    return {"status": status, "checks": checks, "warnings": warnings, "blockers": blockers}


def _coverage(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Summarize observed NetCDF coverage while retaining absent coverage as null."""
    latitude: list[float] = []
    longitude: list[float] = []
    timestamps: list[str] = []
    for record in records:
        coordinates = record.get("netcdf", {}).get("coordinates", {})
        for values, name in ((latitude, "latitude"), (longitude, "longitude")):
            coordinate = coordinates.get(name)
            if isinstance(coordinate, Mapping):
                values.extend(float(coordinate[key]) for key in ("minimum", "maximum") if coordinate.get(key) is not None)
        coordinate = coordinates.get("time")
        if isinstance(coordinate, Mapping):
            timestamps.extend(str(coordinate[key]) for key in ("minimum", "maximum") if coordinate.get(key) is not None)
    return {
        "temporal": {"start": min(timestamps) if timestamps else None, "end": max(timestamps) if timestamps else None},
        "spatial": {
            "latitude": {"minimum": min(latitude), "maximum": max(latitude)} if latitude else None,
            "longitude": {"minimum": min(longitude), "maximum": max(longitude)} if longitude else None,
        },
    }


def _records_for_root(records: Sequence[Mapping[str, Any]], root: str) -> list[Mapping[str, Any]]:
    return [record for record in records if _belongs_to(record.get("relative_path"), root)]


def _time_coverage(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    values: list[str] = []
    for record in records:
        coordinate = record.get("netcdf", {}).get("coordinates", {}).get("time")
        if isinstance(coordinate, Mapping):
            values.extend(str(coordinate[key]) for key in ("minimum", "maximum") if coordinate.get(key) is not None)
    return {"start": min(values) if values else None, "end": max(values) if values else None}


def _artifact_set_checksum(artifacts: Sequence[Mapping[str, Any]]) -> str:
    payload = [{"relative_uri": artifact.get("relative_uri"), "sha256": artifact.get("sha256")} for artifact in artifacts]
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return sha256(encoded.encode("utf-8")).hexdigest()


def _belongs_to_adapter(relative_path: Any, adapter: DatasetAdapter) -> bool:
    return isinstance(relative_path, str) and any(_belongs_to(relative_path, root) for root in adapter.relative_roots)


def _belongs_to(relative_path: Any, root: str) -> bool:
    return isinstance(relative_path, str) and (relative_path == root or relative_path.startswith(f"{root}/"))


def _is_portable_relative_uri(value: Any) -> bool:
    if not isinstance(value, str) or not value or "\\" in value:
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and ".." not in path.parts and not value.startswith("data/")


def _records_for_adapter(
    adapter: DatasetAdapter, records: Sequence[Mapping[str, Any]]
) -> list[Mapping[str, Any]]:
    return [record for record in records if _belongs_to_adapter(record.get("relative_path"), adapter)]

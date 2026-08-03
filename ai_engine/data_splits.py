"""Deterministic leakage-safe temporal and spatial split metadata."""

from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Mapping

import numpy as np

from .data_manifests import validate_manifest
from .regions import REGION_BOUNDS


SPLIT_CONFIG_SCHEMA_VERSION = "vayu.leakage-safe-split-config/v1"
SPLIT_METADATA_SCHEMA_VERSION = "vayu.leakage-safe-split-metadata/v1"
FULL_INDIA_REGION = "full_india"
FULL_INDIA_BOUNDS = {"lat_min": 6.0, "lat_max": 38.0, "lon_min": 66.0, "lon_max": 100.0}
REGIONAL_DATASETS = (
    "western_ghats", "north_east_india", "indo_gangetic_plain", "central_india",
)


class SplitContractError(ValueError):
    """Raised when a manifest, split configuration, or source record is unsafe."""


def default_split_config() -> dict[str, Any]:
    """Return the versioned, non-ratio 2010–2025 evaluation configuration."""
    return {
        "schema_version": SPLIT_CONFIG_SCHEMA_VERSION,
        "temporal": {
            "train": {"start_year": 2010, "end_year": 2021},
            "validation": {"start_year": 2022, "end_year": 2022},
            "test": {"start_year": 2023, "end_year": 2025},
        },
        "spatial": {
            "region_order": list(REGIONAL_DATASETS),
            "regional_buffer_degrees": 0.25,
            "boundary_buffer_degrees": 0.25,
            "composition_region": FULL_INDIA_REGION,
            "full_india_bounds": dict(FULL_INDIA_BOUNDS),
            "ownership": "priority_non_overlapping",
        },
    }


def canonical_id(value: Mapping[str, Any], *, prefix: str = "sha256:") -> str:
    """Return a stable identifier from JSON-compatible content."""
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return f"{prefix}{sha256(encoded.encode('utf-8')).hexdigest()}"


def validate_split_config(config: Mapping[str, Any]) -> None:
    """Reject ratio splits and configurations that can violate temporal isolation."""
    if config.get("schema_version") != SPLIT_CONFIG_SCHEMA_VERSION:
        raise SplitContractError("Unsupported or missing split configuration schema version")
    temporal = config.get("temporal")
    spatial = config.get("spatial")
    if not isinstance(temporal, Mapping) or not isinstance(spatial, Mapping):
        raise SplitContractError("Split configuration requires temporal and spatial mappings")
    years: list[tuple[int, int]] = []
    for name in ("train", "validation", "test"):
        window = temporal.get(name)
        if not isinstance(window, Mapping) or set(window) != {"start_year", "end_year"}:
            raise SplitContractError(f"Temporal {name} must declare only start_year and end_year; ratio splits are unsupported")
        start, end = window["start_year"], window["end_year"]
        if not isinstance(start, int) or not isinstance(end, int) or start > end:
            raise SplitContractError(f"Temporal {name} years are invalid")
        years.append((start, end))
    if not (years[0][1] < years[1][0] <= years[1][1] < years[2][0]):
        raise SplitContractError("Temporal windows must be strictly ordered train < validation < test")
    order = spatial.get("region_order")
    if not isinstance(order, list) or not order or any(name not in REGIONAL_DATASETS for name in order):
        raise SplitContractError("Spatial region_order must contain only the four regional dataset identifiers")
    if len(set(order)) != len(order):
        raise SplitContractError("Spatial region_order cannot contain duplicate regions")
    for key in ("regional_buffer_degrees", "boundary_buffer_degrees"):
        value = spatial.get(key)
        if not isinstance(value, (int, float)) or value < 0:
            raise SplitContractError(f"Spatial {key} must be a non-negative number")
    if spatial.get("composition_region") != FULL_INDIA_REGION:
        raise SplitContractError("The composition region must be full_india")
    if spatial.get("ownership") != "priority_non_overlapping":
        raise SplitContractError("Only priority_non_overlapping spatial ownership is supported")
    bounds = spatial.get("full_india_bounds")
    if not _valid_bounds(bounds):
        raise SplitContractError("Spatial full_india_bounds are invalid")
    if dict(bounds) != FULL_INDIA_BOUNDS:
        raise SplitContractError("Spatial full_india_bounds must be exactly 6–38°N and 66–100°E for the composition target")


def _valid_bounds(bounds: Any) -> bool:
    return (
        isinstance(bounds, Mapping)
        and all(isinstance(bounds.get(key), (int, float)) for key in FULL_INDIA_BOUNDS)
        and bounds["lat_min"] < bounds["lat_max"]
        and bounds["lon_min"] < bounds["lon_max"]
    )


def split_name(timestamp: np.datetime64, config: Mapping[str, Any]) -> str | None:
    """Classify a timestamp by the explicit calendar windows, never by a ratio."""
    year = int(np.datetime_as_string(timestamp, unit="D")[:4])
    for name in ("train", "validation", "test"):
        window = config["temporal"][name]
        if window["start_year"] <= year <= window["end_year"]:
            return name
    return None


def split_config_id(config: Mapping[str, Any]) -> str:
    validate_split_config(config)
    return canonical_id(config)


def load_manifest(path: Path, dataset_id: str | None = None) -> dict[str, Any]:
    """Load one canonical manifest or select one from a canonical catalog."""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SplitContractError(f"Cannot read manifest document: {error}") from error
    if isinstance(document, Mapping) and isinstance(document.get("manifests"), list):
        if not dataset_id:
            raise SplitContractError("--dataset-id is required when --manifest names a catalog")
        matches = [item for item in document["manifests"] if item.get("dataset_id") == dataset_id]
        if len(matches) != 1:
            raise SplitContractError(f"Catalog does not contain exactly one dataset_id={dataset_id!r}")
        manifest = dict(matches[0])
    elif isinstance(document, Mapping):
        manifest = dict(document)
        if dataset_id and manifest.get("dataset_id") != dataset_id:
            raise SplitContractError("Requested dataset_id does not match the manifest")
    else:
        raise SplitContractError("Manifest document must be an object or a catalog")
    try:
        validate_manifest(manifest)
    except ValueError as error:
        raise SplitContractError(str(error)) from error
    return manifest


def load_split_config(path: Path | None) -> dict[str, Any]:
    """Load an explicitly versioned configuration or the versioned default."""
    if path is None:
        return default_split_config()
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SplitContractError(f"Cannot read split configuration: {error}") from error
    if not isinstance(config, Mapping):
        raise SplitContractError("Split configuration must be a JSON object")
    config = dict(config)
    validate_split_config(config)
    return config


def _safe_artifact_path(data_root: Path, relative_uri: Any) -> Path:
    if not isinstance(relative_uri, str) or not relative_uri or "\\" in relative_uri:
        raise SplitContractError(f"Manifest artifact URI is not a portable relative URI: {relative_uri!r}")
    relative = PurePosixPath(relative_uri)
    if relative.is_absolute() or ".." in relative.parts:
        raise SplitContractError(f"Manifest artifact URI escapes the data root: {relative_uri!r}")
    candidate = (data_root / relative).resolve()
    if candidate != data_root.resolve() and data_root.resolve() not in candidate.parents:
        raise SplitContractError(f"Manifest artifact URI escapes the data root: {relative_uri!r}")
    return candidate


def _file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _blocker(code: str, message: str, *, details: Mapping[str, Any] | None = None) -> dict[str, Any]:
    return {"code": code, "message": message, "details": dict(details or {})}


def _manifest_blockers(manifest: Mapping[str, Any]) -> list[dict[str, Any]]:
    blockers = []
    validation = manifest.get("validation", {})
    for item in validation.get("blockers", []) if isinstance(validation, Mapping) else []:
        blockers.append({"code": item.get("code", "MANIFEST_VALIDATION_BLOCKER"), "message": item.get("message", "Active manifest validation failed."), "details": item.get("details", {}), "origin": "manifest"})
    return blockers


def _verify_artifacts(manifest: Mapping[str, Any], data_root: Path) -> tuple[list[tuple[Mapping[str, Any], Path]], list[dict[str, Any]]]:
    verified: list[tuple[Mapping[str, Any], Path]] = []
    blockers: list[dict[str, Any]] = []
    for artifact in manifest.get("artifacts", []):
        relative_uri = artifact.get("relative_uri")
        try:
            path = _safe_artifact_path(data_root, relative_uri)
        except SplitContractError as error:
            blockers.append(_blocker("ARTIFACT_URI_INVALID", str(error)))
            continue
        if not path.is_file():
            blockers.append(_blocker("MANIFEST_ARTIFACT_MISSING", "Manifest artifact is absent from the selected data root.", details={"relative_uri": relative_uri}))
            continue
        expected = artifact.get("sha256")
        observed = _file_sha256(path)
        if expected != observed:
            blockers.append(_blocker("MANIFEST_ARTIFACT_CHECKSUM_MISMATCH", "Artifact checksum differs from the active manifest.", details={"relative_uri": relative_uri, "expected": expected, "observed": observed}))
            continue
        verified.append((artifact, path))
    return verified, blockers


def _legacy_normalization_blockers(verified: Iterable[tuple[Mapping[str, Any], Path]]) -> list[dict[str, Any]]:
    blockers: list[dict[str, Any]] = []
    for artifact, path in verified:
        if not str(artifact.get("relative_uri", "")).split("/")[-1].startswith("pipeline_log_"):
            continue
        try:
            pipeline = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        config = pipeline.get("config", {}) if isinstance(pipeline, Mapping) else {}
        period = config.get("climatology_period") if isinstance(config, Mapping) else None
        if period:
            blockers.append(_blocker(
                "LEGACY_NORMALIZATION_PROVENANCE_UNTRUSTED",
                "Legacy normalization is not evidence that statistics were fit from this active 2010–2025 manifest and its training assignment.",
                details={"relative_uri": artifact.get("relative_uri"), "claimed_climatology_period": period},
            ))
    return blockers


def _coordinate_name(dataset: Any, candidates: tuple[str, ...]) -> str | None:
    return next((name for name in candidates if name in dataset.coords), None)


def _is_raw_source(artifact: Mapping[str, Any]) -> bool:
    uri = str(artifact.get("relative_uri", "")).lower()
    return artifact.get("file_type") == "netcdf" and "normalized" not in uri and "norm_param" not in uri


def _spatial_masks(latitudes: np.ndarray, longitudes: np.ndarray, config: Mapping[str, Any]) -> dict[str, np.ndarray]:
    """Create disjoint regional cores plus a buffered full-India complement."""
    spatial = config["spatial"]
    lat_grid, lon_grid = np.meshgrid(latitudes.astype(float), longitudes.astype(float), indexing="ij")
    regional_buffer = float(spatial["regional_buffer_degrees"])
    boundary_buffer = float(spatial["boundary_buffer_degrees"])
    masks: dict[str, np.ndarray] = {}
    claimed = np.zeros(lat_grid.shape, dtype=bool)
    boundary_ring = np.zeros(lat_grid.shape, dtype=bool)
    for region in spatial["region_order"]:
        bounds = REGION_BOUNDS[region]
        core = _inside_bounds(lat_grid, lon_grid, bounds, regional_buffer)
        masks[region] = core & ~claimed
        claimed |= masks[region]
        boundary_ring |= _boundary_ring(lat_grid, lon_grid, bounds, boundary_buffer)
    full_bounds = spatial["full_india_bounds"]
    masks[FULL_INDIA_REGION] = _inside_bounds(lat_grid, lon_grid, full_bounds, regional_buffer) & ~claimed & ~boundary_ring
    return masks


def _inside_bounds(lat: np.ndarray, lon: np.ndarray, bounds: Mapping[str, Any], buffer_degrees: float) -> np.ndarray:
    return ((lat >= float(bounds["lat_min"]) + buffer_degrees) & (lat <= float(bounds["lat_max"]) - buffer_degrees) & (lon >= float(bounds["lon_min"]) + buffer_degrees) & (lon <= float(bounds["lon_max"]) - buffer_degrees))


def _boundary_ring(lat: np.ndarray, lon: np.ndarray, bounds: Mapping[str, Any], buffer_degrees: float) -> np.ndarray:
    if buffer_degrees == 0:
        return np.zeros(lat.shape, dtype=bool)
    expanded = _inside_bounds(lat, lon, bounds, -buffer_degrees)
    core = _inside_bounds(lat, lon, bounds, buffer_degrees)
    return expanded & ~core


def _coverage_blockers(manifest: Mapping[str, Any], config: Mapping[str, Any]) -> list[dict[str, Any]]:
    if manifest.get("dataset_id") != "full-india-training-bundle":
        return []
    spatial = manifest.get("coverage", {}).get("spatial", {})
    latitude, longitude = spatial.get("latitude"), spatial.get("longitude")
    target = config["spatial"]["full_india_bounds"]
    if not isinstance(latitude, Mapping) or not isinstance(longitude, Mapping):
        return [_blocker("FULL_INDIA_COVERAGE_UNAVAILABLE", "Full-India manifest has no usable spatial coverage evidence.")]
    observed = {"lat_min": latitude.get("minimum"), "lat_max": latitude.get("maximum"), "lon_min": longitude.get("minimum"), "lon_max": longitude.get("maximum")}
    compatible = (observed["lat_min"] <= target["lat_min"] and observed["lat_max"] >= target["lat_max"] and observed["lon_min"] <= target["lon_min"] and observed["lon_max"] >= target["lon_max"])
    if not compatible:
        return [_blocker("FULL_INDIA_SPATIAL_COVERAGE_INCOMPATIBLE", "Full-India coverage does not satisfy the active composition bounds.", details={"observed": observed, "required": target})]
    return []


def _raw_assignments(
    manifest: Mapping[str, Any],
    config: Mapping[str, Any],
    verified: Iterable[tuple[Mapping[str, Any], Path]],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, float]], list[dict[str, Any]]]:
    """Read only manifest-listed raw sources and fit statistics from train rows alone."""
    try:
        import xarray as xr
    except ImportError as error:  # pragma: no cover - project runtime supplies xarray.
        raise SplitContractError("xarray is required to construct split metadata") from error
    assignments: list[dict[str, Any]] = []
    accumulators: dict[str, dict[str, float]] = {}
    blockers: list[dict[str, Any]] = []
    config_id = split_config_id(config)
    behavior = {
        "ownership": config["spatial"]["ownership"],
        "region_order": config["spatial"]["region_order"],
        "regional_buffer_degrees": config["spatial"]["regional_buffer_degrees"],
        "boundary_buffer_degrees": config["spatial"]["boundary_buffer_degrees"],
        "composition_region": FULL_INDIA_REGION,
    }
    raw_artifacts = sorted((item for item in verified if _is_raw_source(item[0])), key=lambda item: str(item[0]["relative_uri"]))
    if not raw_artifacts:
        return assignments, accumulators, [_blocker("RAW_SOURCE_ARTIFACTS_MISSING", "No manifest-listed raw NetCDF artifacts are available for split construction.")]
    for artifact, path in raw_artifacts:
        try:
            with xr.open_dataset(path, decode_times=True) as dataset:
                lat_name = _coordinate_name(dataset, ("lat", "latitude", "y"))
                lon_name = _coordinate_name(dataset, ("lon", "longitude", "x"))
                time_name = _coordinate_name(dataset, ("time", "timestamp", "date"))
                if not lat_name or not lon_name or not time_name:
                    blockers.append(_blocker("SOURCE_COORDINATES_INCOMPATIBLE", "Raw source lacks latitude, longitude, or time coordinates.", details={"relative_uri": artifact["relative_uri"]}))
                    continue
                lats, lons = np.asarray(dataset[lat_name].values), np.asarray(dataset[lon_name].values)
                if lats.ndim != 1 or lons.ndim != 1 or not np.issubdtype(lats.dtype, np.number) or not np.issubdtype(lons.dtype, np.number):
                    blockers.append(_blocker("SOURCE_GRID_INCOMPATIBLE", "Raw source must have one-dimensional numeric latitude and longitude coordinates.", details={"relative_uri": artifact["relative_uri"]}))
                    continue
                masks = _spatial_masks(lats, lons, config)
                times = np.asarray(dataset[time_name].values).reshape(-1)
                for variable_name in sorted(dataset.data_vars):
                    variable = dataset[variable_name]
                    if not {time_name, lat_name, lon_name}.issubset(variable.dims) or set(variable.dims) != {time_name, lat_name, lon_name}:
                        blockers.append(_blocker("SOURCE_VARIABLE_DIMENSIONS_INCOMPATIBLE", "Raw variables must be exactly time × latitude × longitude for deterministic split assignment.", details={"relative_uri": artifact["relative_uri"], "variable": variable_name, "dimensions": list(variable.dims)}))
                        continue
                    for index, raw_timestamp in enumerate(times):
                        try:
                            timestamp = np.datetime64(raw_timestamp, "D")
                            timestamp_text = np.datetime_as_string(timestamp, unit="D")
                        except (TypeError, ValueError):
                            blockers.append(_blocker("SOURCE_TIMESTAMP_INCOMPATIBLE", "Raw source timestamp cannot be assigned to a calendar split.", details={"relative_uri": artifact["relative_uri"], "value": str(raw_timestamp)}))
                            continue
                        partition = split_name(timestamp, config)
                        if partition is None:
                            continue
                        values = np.asarray(variable.isel({time_name: index}).transpose(lat_name, lon_name).values, dtype=float)
                        for region, mask in masks.items():
                            selected = values[mask]
                            finite = selected[np.isfinite(selected)]
                            if not finite.size:
                                continue
                            sample = {
                                "artifact": artifact["relative_uri"], "variable": variable_name,
                                "timestamp": timestamp_text, "region": region, "split": partition,
                                "grid_cell_count": int(mask.sum()), "finite_value_count": int(finite.size),
                            }
                            sample["assignment_id"] = canonical_id({"manifest_id": manifest["manifest_id"], "split_config_id": config_id, "spatial_buffer_behavior": behavior, **sample})
                            assignments.append(sample)
                            if partition == "train":
                                state = accumulators.setdefault(variable_name, {"count": 0.0, "sum": 0.0, "sum_of_squares": 0.0})
                                state["count"] += float(finite.size)
                                state["sum"] += float(finite.sum(dtype=np.float64))
                                state["sum_of_squares"] += float(np.square(finite, dtype=np.float64).sum(dtype=np.float64))
        except OSError as error:
            blockers.append(_blocker("SOURCE_NETCDF_UNREADABLE", "Manifest-listed raw NetCDF source cannot be opened.", details={"relative_uri": artifact["relative_uri"], "error": f"{type(error).__name__}: {error}"}))
    return sorted(assignments, key=lambda item: (item["timestamp"], item["artifact"], item["variable"], item["region"])), accumulators, blockers


def _normalization_statistics(accumulators: Mapping[str, Mapping[str, float]], split_id: str) -> dict[str, Any]:
    variables: dict[str, Any] = {}
    for name, state in sorted(accumulators.items()):
        count = int(state["count"])
        if count == 0:
            continue
        mean = state["sum"] / count
        variance = max(0.0, state["sum_of_squares"] / count - mean * mean)
        variables[name] = {"count": count, "mean": mean, "std": float(np.sqrt(variance)), "fit_split": "train"}
    payload = {"split_id": split_id, "fit_split": "train", "variables": variables}
    payload["normalization_id"] = canonical_id(payload)
    return payload


def _assignment_count(assignments: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    result = {"train": 0, "validation": 0, "test": 0}
    for assignment in assignments:
        result[str(assignment["split"])] += 1
    return result


def generate_split_metadata(
    manifest: Mapping[str, Any],
    data_root: Path,
    *,
    config: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Generate reproducible split and training-only normalization metadata.

    A rejected report deliberately contains no assignments or normalization values.  This
    makes manifest/source incompatibilities visible without falling back to ratios,
    legacy tensors, or any validation/test observations.
    """
    try:
        validate_manifest(manifest)
    except ValueError as error:
        raise SplitContractError(str(error)) from error
    active_config = deepcopy(default_split_config() if config is None else dict(config))
    validate_split_config(active_config)
    data_root = data_root.resolve()
    if not data_root.is_dir():
        raise SplitContractError(f"Data root is not an existing directory: {data_root}")
    config_id = split_config_id(active_config)
    spatial_behavior = active_config["spatial"]
    split_id = canonical_id({"manifest_id": manifest["manifest_id"], "split_config_id": config_id, "spatial_buffer_behavior": spatial_behavior})
    verified, artifact_blockers = _verify_artifacts(manifest, data_root)
    blockers = _manifest_blockers(manifest) + artifact_blockers + _coverage_blockers(manifest, active_config)
    blockers += _legacy_normalization_blockers(verified)
    assignments: list[dict[str, Any]] = []
    normalization: dict[str, Any] = {"status": "not_fitted", "reason": "active manifest or artifact validation failed"}
    if not blockers:
        assignments, accumulators, source_blockers = _raw_assignments(manifest, active_config, verified)
        blockers.extend(source_blockers)
        counts = _assignment_count(assignments)
        for partition, count in counts.items():
            if count == 0:
                blockers.append(_blocker("SPLIT_NO_ASSIGNMENTS", "No compatible records were assigned to a required temporal partition.", details={"split": partition}))
        if not blockers:
            normalization = {"status": "fitted", **_normalization_statistics(accumulators, split_id)}
    validation = {"status": "rejected" if blockers else "passed", "blockers": blockers}
    return {
        "schema_version": SPLIT_METADATA_SCHEMA_VERSION,
        "manifest_id": manifest["manifest_id"],
        "dataset_id": manifest["dataset_id"],
        "split_config": active_config,
        "split_config_id": config_id,
        "spatial_buffer_behavior": spatial_behavior,
        "split_id": split_id,
        "assignments": assignments if not blockers else [],
        "assignment_counts": _assignment_count(assignments) if not blockers else {"train": 0, "validation": 0, "test": 0},
        "normalization": normalization if not blockers else {"status": "not_fitted", "reason": "split validation rejected the active manifest, sources, or assignments"},
        "validation": validation,
    }


def write_split_metadata(metadata: Mapping[str, Any], output: Path) -> None:
    """Atomically persist new metadata only; raw and processed inputs remain untouched."""
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.tmp")
    temporary.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(output)

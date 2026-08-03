"""Portable climate-data discovery, inventory, and validation utilities."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
import re
from typing import Any, Mapping

import numpy as np


_NETCDF_SUFFIXES = {".nc", ".nc4", ".cdf"}
_LATITUDE_NAMES = ("lat", "latitude", "y")
_LONGITUDE_NAMES = ("lon", "longitude", "x")
_TIME_NAMES = ("time", "timestamp", "date")
_EXPECTED_NCEP_YEARS = set(range(2010, 2026))


class DataRootResolutionError(ValueError):
    """Raised when no usable, portable data root can be found."""


@dataclass(frozen=True)
class ResolvedDataRoot:
    """A validated data root and the portable discovery mechanism used."""

    path: Path
    source: str


def resolve_data_root(
    root: Path | str | None = None,
    *,
    environment: Mapping[str, str] | None = None,
    repository_root: Path | None = None,
) -> ResolvedDataRoot:
    """Resolve a data root in CLI, environment, then repository-relative order."""
    environment = os.environ if environment is None else environment
    repository_root = repository_root or Path(__file__).resolve().parents[1]

    if root is not None:
        return _validated_root(Path(root), "cli")
    if environment.get("VAYU_DATA_ROOT"):
        return _validated_root(Path(environment["VAYU_DATA_ROOT"]), "environment")
    return _validated_root(repository_root / "data", "repository")


def _validated_root(candidate: Path, source: str) -> ResolvedDataRoot:
    path = candidate.expanduser().resolve()
    if not path.is_dir():
        raise DataRootResolutionError(
            f"The {source} data root is not an existing directory: {candidate}"
        )
    return ResolvedDataRoot(path=path, source=source)


def portable_path(path: Path, data_root: Path) -> str:
    """Represent a path relative to the selected root using POSIX separators."""
    return path.resolve().relative_to(data_root.resolve()).as_posix()


def portable_manifest_reference(value: str) -> str:
    """Normalize an existing manifest reference without retaining host-specific paths."""
    normalized = value.replace("\\", "/")
    parts = [part for part in PurePosixPath(normalized).parts if part not in (".", "/")]
    if parts and parts[0].lower() == "data":
        parts = parts[1:]
    return PurePosixPath(*parts).as_posix()


def build_inventory(
    data_root: Path,
    *,
    root_source: str = "cli",
    large_file_threshold_mb: float = 512,
) -> dict[str, Any]:
    """Create a JSON-serializable inventory without changing any dataset files."""
    data_root = data_root.resolve()
    if not data_root.is_dir():
        raise DataRootResolutionError(f"Data root is not an existing directory: {data_root}")
    if large_file_threshold_mb <= 0:
        raise ValueError("large_file_threshold_mb must be greater than zero")

    files = [path for path in sorted(data_root.rglob("*")) if path.is_file()]
    report: dict[str, Any] = {
        "report_version": "1.0",
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "data_root": {"relative_uri": "data/", "resolution_source": root_source},
        "files": [],
        "families": {},
        "ssd_relocation_candidates": [],
        "validation": {"checks": [], "blockers": [], "status": "passed"},
    }
    file_index: dict[str, dict[str, Any]] = {}
    family_totals: dict[str, int] = {}

    for path in files:
        relative_path = portable_path(path, data_root)
        family = relative_path.split("/", 1)[0] if "/" in relative_path else "root"
        size_bytes = path.stat().st_size
        record: dict[str, Any] = {
            "relative_path": relative_path,
            "family": family,
            "file_type": _file_type(path),
            "size_bytes": size_bytes,
            "sha256": _checksum(path),
        }
        if path.suffix.lower() in _NETCDF_SUFFIXES:
            record["netcdf"] = _netcdf_inventory(path)
        elif path.suffix.lower() == ".json":
            record["json"] = _json_inventory(path)
        report["files"].append(record)
        file_index[relative_path] = record
        family_totals[family] = family_totals.get(family, 0) + size_bytes

    threshold_bytes = int(large_file_threshold_mb * 1024 * 1024)
    report["families"] = {
        family: {"size_bytes": size, "file_count": sum(item["family"] == family for item in report["files"])}
        for family, size in sorted(family_totals.items())
    }
    report["ssd_relocation_candidates"] = _relocation_candidates(
        report["files"], report["families"], threshold_bytes
    )

    _validate_netcdf_schemas(report)
    _validate_sequence_manifests(report, data_root, file_index)
    _validate_pipeline_logs(report, data_root)
    _validate_bundle_manifests(report, data_root)
    _validate_legacy_manifest_provenance(report, data_root)
    _validate_ncep_coverage(report, data_root)
    _validate_ncep_component_grids(report)
    report["validation"]["status"] = "failed" if report["validation"]["blockers"] else "passed"
    return report


def _file_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in _NETCDF_SUFFIXES:
        return "netcdf"
    if suffix == ".json":
        return "json"
    if suffix in {".pt", ".pth", ".ckpt"}:
        return "model_tensor"
    return suffix.lstrip(".") or "unknown"


def _checksum(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _netcdf_inventory(path: Path) -> dict[str, Any]:
    try:
        import xarray as xr

        with xr.open_dataset(path, decode_times=True) as dataset:
            coordinates = {
                "latitude": _coordinate_summary(dataset, _LATITUDE_NAMES),
                "longitude": _coordinate_summary(dataset, _LONGITUDE_NAMES),
                "time": _coordinate_summary(dataset, _TIME_NAMES, is_time=True),
                "level": _coordinate_summary(dataset, ("level", "plev", "isobaricInhPa")),
            }
            variables = [_variable_summary(dataset[name]) for name in sorted(dataset.data_vars)]
            missing_coordinates = [
                name for name in ("latitude", "longitude", "time")
                if coordinates[name] is None
            ]
            unit_warnings = [
                variable["name"] for variable in variables if variable["units"] is None
            ]
            return {
                "coordinates": coordinates,
                "variables": variables,
                "global_attributes": _global_attribute_summary(dataset),
                "schema_compatibility": {
                    "status": "incompatible" if missing_coordinates else "compatible",
                    "missing_coordinates": missing_coordinates,
                    "warnings": (
                        [f"Variables without units: {', '.join(unit_warnings)}"]
                        if unit_warnings else []
                    ),
                },
            }
    except Exception as error:  # Inventory should preserve evidence even for malformed files.
        return {
            "schema_compatibility": {
                "status": "unreadable",
                "missing_coordinates": [],
                "warnings": [],
                "error": f"{type(error).__name__}: {error}",
            }
        }


def _coordinate_summary(dataset: Any, names: tuple[str, ...], *, is_time: bool = False) -> dict[str, Any] | None:
    name = next((candidate for candidate in names if candidate in dataset.coords), None)
    if name is None:
        return None
    values = np.asarray(dataset.coords[name].values).reshape(-1)
    summary: dict[str, Any] = {"name": name, "count": int(values.size)}
    if values.size:
        summary["minimum"] = _json_scalar(values.min(), is_time=is_time)
        summary["maximum"] = _json_scalar(values.max(), is_time=is_time)
    if not is_time and values.size > 1 and np.issubdtype(values.dtype, np.number):
        spacing = np.diff(np.sort(np.unique(values.astype(float))))
        if spacing.size and np.allclose(spacing, spacing[0]):
            summary["resolution_degrees"] = float(spacing[0])
    return summary


def _json_scalar(value: Any, *, is_time: bool = False) -> Any:
    if is_time and isinstance(value, np.datetime64):
        return np.datetime_as_string(value, unit="s")
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, np.generic):
        return value.item()
    return value


def _global_attribute_summary(dataset: Any) -> dict[str, str]:
    """Preserve limited source evidence without treating attributes as provenance."""
    names = ("title", "source", "references", "institution", "Conventions", "history")
    return {name: str(dataset.attrs[name]) for name in names if dataset.attrs.get(name) is not None}


def _variable_summary(variable: Any) -> dict[str, Any]:
    total_count = int(variable.size)
    try:
        missing_count = int(variable.isnull().sum().values)
        missingness: dict[str, Any] = {
            "missing_count": missing_count,
            "total_count": total_count,
            "fraction": (missing_count / total_count) if total_count else None,
        }
    except Exception as error:
        missingness = {"error": f"{type(error).__name__}: {error}"}
    units = variable.attrs.get("units")
    return {
        "name": variable.name,
        "dimensions": list(variable.dims),
        "dtype": str(variable.dtype),
        "units": str(units) if units is not None else None,
        "missingness": missingness,
    }


def _json_inventory(path: Path) -> dict[str, Any]:
    try:
        content = _load_json(path)
        return {"status": "readable", "top_level_type": type(content).__name__}
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return {"status": "unreadable", "error": f"{type(error).__name__}: {error}"}


def _relocation_candidates(
    files: list[dict[str, Any]], families: dict[str, dict[str, int]], threshold_bytes: int
) -> list[dict[str, Any]]:
    candidates = [
        {"kind": "file", "relative_path": item["relative_path"], "size_bytes": item["size_bytes"]}
        for item in files if item["size_bytes"] >= threshold_bytes
    ]
    candidates.extend(
        {"kind": "family", "relative_path": f"{family}/", "size_bytes": details["size_bytes"]}
        for family, details in families.items() if details["size_bytes"] >= threshold_bytes
    )
    return sorted(candidates, key=lambda candidate: (-candidate["size_bytes"], candidate["relative_path"]))


def _validate_netcdf_schemas(report: dict[str, Any]) -> None:
    for record in report["files"]:
        metadata = record.get("netcdf")
        if not metadata:
            continue
        schema = metadata["schema_compatibility"]
        if schema["status"] != "compatible":
            _blocker(
                report,
                "NETCDF_SCHEMA_INCOMPATIBLE",
                "NetCDF file is missing required spatial or temporal coordinates, or is unreadable.",
                record["relative_path"],
                {"schema_compatibility": schema},
            )
        elif schema["warnings"]:
            _check(
                report,
                "NETCDF_UNITS_INCOMPLETE",
                "Some variables do not declare units.",
                record["relative_path"],
                {"warnings": schema["warnings"]},
            )


def _validate_sequence_manifests(
    report: dict[str, Any], data_root: Path, file_index: Mapping[str, dict[str, Any]]
) -> None:
    for manifest_path in sorted(data_root.rglob("sequence_manifest.json")):
        relative_manifest = portable_path(manifest_path, data_root)
        try:
            manifest = _load_json(manifest_path)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            _blocker(report, "SEQUENCE_MANIFEST_UNREADABLE", str(error), relative_manifest, {})
            continue
        if not isinstance(manifest, dict):
            _blocker(report, "SEQUENCE_MANIFEST_INVALID", "Sequence manifest must be a JSON object.", relative_manifest, {})
            continue

        references = _manifest_references(manifest, data_root)
        _check(report, "SEQUENCE_MANIFEST_REFERENCES", "Manifest references were normalized to portable paths.", relative_manifest, {"references": references})
        for reference in references:
            if reference["field"] in {"normalized_file", "train_path", "val_path", "test_path"} and not reference["exists"]:
                _blocker(
                    report,
                    "SEQUENCE_ARTIFACT_MISSING",
                    "A declared sequence-manifest artifact is absent from the selected data root.",
                    relative_manifest,
                    {"reference": reference},
                )

        grid = manifest.get("grid")
        normalized_reference = next((item for item in references if item["field"] == "normalized_file"), None)
        if isinstance(grid, dict) and normalized_reference and normalized_reference["exists"]:
            normalized = file_index.get(normalized_reference["relative_path"], {}).get("netcdf", {})
            coordinates = normalized.get("coordinates", {})
            latitude = coordinates.get("latitude")
            longitude = coordinates.get("longitude")
            expected_nodes = grid.get("nodes")
            if latitude and longitude:
                observed_grid = {"lat": latitude["count"], "lon": longitude["count"]}
                observed_nodes = observed_grid["lat"] * observed_grid["lon"]
                compatible = (
                    grid.get("lat") == observed_grid["lat"]
                    and grid.get("lon") == observed_grid["lon"]
                    and expected_nodes == observed_nodes
                )
                _check(
                    report,
                    "SEQUENCE_GRID_COMPATIBILITY",
                    "Sequence grid dimensions were compared with normalized NetCDF coordinates.",
                    relative_manifest,
                    {"compatible": compatible, "declared": grid, "observed": {**observed_grid, "nodes": observed_nodes}},
                )
                if not compatible:
                    _blocker(
                        report,
                        "SEQUENCE_GRID_MISMATCH",
                        "Sequence manifest grid dimensions do not match normalized NetCDF coordinates.",
                        relative_manifest,
                        {"declared": grid, "observed": {**observed_grid, "nodes": observed_nodes}},
                    )

        test_reference = next((item for item in references if item["field"] == "test_path"), None)
        default_test_path = manifest_path.parent / "test_sequences.pt"
        if test_reference is None or not default_test_path.exists():
            _blocker(
                report,
                "TEST_SEQUENCE_ARTIFACT_MISSING",
                "No test sequence artifact is declared and available for this processed dataset.",
                relative_manifest,
                {"expected_relative_path": portable_path(default_test_path, data_root)},
            )


def _validate_pipeline_logs(report: dict[str, Any], data_root: Path) -> None:
    target_bounds = {"lat_min": 6.0, "lat_max": 38.0, "lon_min": 66.0, "lon_max": 100.0}
    for pipeline_path in sorted(data_root.rglob("pipeline_log_*.json")):
        relative_log = portable_path(pipeline_path, data_root)
        try:
            pipeline = _load_json(pipeline_path)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            _blocker(report, "PIPELINE_LOG_UNREADABLE", str(error), relative_log, {})
            continue
        if not isinstance(pipeline, dict):
            _blocker(report, "PIPELINE_LOG_INVALID", "Pipeline log must be a JSON object.", relative_log, {})
            continue
        references = _manifest_references(pipeline, data_root)
        if references:
            _check(report, "PIPELINE_LOG_REFERENCES", "Pipeline references were normalized to portable paths.", relative_log, {"references": references})
        if pipeline.get("input", {}).get("region") != "india":
            continue
        observed = pipeline.get("config", {}).get("region_bounds")
        compatible = observed == target_bounds
        _check(
            report,
            "FULL_INDIA_BOUNDS",
            "Full-India pipeline bounds were checked against the 6–38°N, 66–100°E target.",
            relative_log,
            {"compatible": compatible, "declared": observed, "required": target_bounds},
        )
        if not compatible:
            _blocker(
                report,
                "FULL_INDIA_BOUNDS_MISMATCH",
                "Full-India pipeline bounds do not meet the required 6–38°N, 66–100°E extent.",
                relative_log,
                {"declared": observed, "required": target_bounds},
            )


def _validate_bundle_manifests(report: dict[str, Any], data_root: Path) -> None:
    expected_families = {
        "satellite": ("lst", "sst", "satellite"),
        "wind": ("wind", "uwnd", "vwnd"),
        "humidity": ("humidity", "shum"),
        "pressure": ("pressure", "pr_wtr"),
    }
    for manifest_path in sorted(data_root.rglob("bundle_manifest.json")):
        relative_manifest = portable_path(manifest_path, data_root)
        try:
            manifest = _load_json(manifest_path)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            _blocker(report, "BUNDLE_MANIFEST_UNREADABLE", str(error), relative_manifest, {})
            continue
        if not isinstance(manifest, dict):
            _blocker(report, "BUNDLE_MANIFEST_INVALID", "Bundle manifest must be a JSON object.", relative_manifest, {})
            continue
        declared = [Path(item.replace("\\", "/")).name.lower() for item in manifest.get("copied_files", []) if isinstance(item, str)]
        present_families = {
            family: any(any(token in filename for token in tokens) for filename in declared)
            for family, tokens in expected_families.items()
        }
        missing = [family for family, present in present_families.items() if not present]
        _check(
            report,
            "BUNDLE_SOURCE_FAMILIES",
            "Bundle source-family declarations were inspected.",
            relative_manifest,
            {"declared_source_families": present_families, "missing_source_families": missing},
        )
        if missing:
            _blocker(
                report,
                "BUNDLE_SOURCE_FAMILIES_MISSING",
                "Bundle does not declare satellite, wind, humidity, or pressure source entries.",
                relative_manifest,
                {"missing_source_families": missing},
            )
        missing_expected = manifest.get("missing_expected_files", [])
        if missing_expected:
            _blocker(
                report,
                "BUNDLE_DECLARED_ARTIFACTS_MISSING",
                "Bundle manifest declares expected artifacts as missing.",
                relative_manifest,
                {"missing_count": len(missing_expected)},
            )


def _validate_ncep_coverage(report: dict[str, Any], data_root: Path) -> None:
    for directory_name in ("ncep_wind", "ncep_wind_subset"):
        directory = data_root / directory_name
        if not directory.is_dir():
            continue
        coverage: dict[str, set[int]] = {}
        for path in directory.glob("*.nc"):
            match = re.search(r"(uwnd|vwnd|shum|pr_wtr).*?(20\d{2})", path.name, re.IGNORECASE)
            if match:
                coverage.setdefault(match.group(1).lower(), set()).add(int(match.group(2)))
        required = ("uwnd", "vwnd", "shum")
        details = {
            component: {"missing_years": sorted(_EXPECTED_NCEP_YEARS - coverage.get(component, set()))}
            for component in required
        }
        compatible = all(not value["missing_years"] for value in details.values())
        relative_directory = f"{directory_name}/"
        _check(
            report,
            "NCEP_2010_2025_COVERAGE",
            "NCEP wind and humidity components were checked for 2010–2025 coverage.",
            relative_directory,
            {"compatible": compatible, "components": details},
        )
        if not compatible:
            _blocker(
                report,
                "NCEP_COVERAGE_INCOMPLETE",
                "NCEP directory lacks one or more required 2010–2025 wind/humidity components.",
                relative_directory,
                {"components": details},
            )


def _manifest_references(manifest: Mapping[str, Any], data_root: Path) -> list[dict[str, Any]]:
    references = []
    for field in ("normalized_file", "normalization_parameters", "train_path", "val_path", "test_path"):
        value = manifest.get(field)
        if not isinstance(value, str):
            continue
        relative_path = portable_manifest_reference(value)
        candidate = (data_root / relative_path).resolve()
        within_root = candidate == data_root or data_root in candidate.parents
        references.append({
            "field": field,
            "relative_path": relative_path,
            "exists": within_root and candidate.exists(),
            "escapes_data_root": not within_root,
        })
    return references


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _check(report: dict[str, Any], code: str, message: str, location: str, details: dict[str, Any]) -> None:
    report["validation"]["checks"].append({
        "code": code,
        "message": message,
        "relative_path": location,
        "details": details,
    })


def _blocker(report: dict[str, Any], code: str, message: str, location: str, details: dict[str, Any]) -> None:
    report["validation"]["blockers"].append({
        "code": code,
        "message": message,
        "relative_path": location,
        "details": details,
    })


def _validate_legacy_manifest_provenance(report: dict[str, Any], data_root: Path) -> None:
    """Record legacy manifest portability and lineage gaps without rewriting them."""
    for filename in ("bundle_manifest.json", "sequence_manifest.json"):
        for manifest_path in sorted(data_root.rglob(filename)):
            relative_manifest = portable_path(manifest_path, data_root)
            try:
                content = manifest_path.read_text(encoding="utf-8")
                manifest = json.loads(content)
            except (OSError, ValueError, json.JSONDecodeError) as error:
                _check(report, "LEGACY_MANIFEST_PROVENANCE_UNREADABLE", str(error), relative_manifest, {})
                continue
            if "\\" in content:
                _check(
                    report,
                    "LEGACY_MANIFEST_WINDOWS_PATHS",
                    "Legacy manifest uses Windows path separators; canonical manifests use relative POSIX URIs.",
                    relative_manifest,
                    {},
                )
            if isinstance(manifest, dict):
                missing = [field for field in ("source", "license", "lineage", "manifest_id") if field not in manifest]
                if missing:
                    _check(
                        report,
                        "LEGACY_MANIFEST_PROVENANCE_INCOMPLETE",
                        "Legacy manifest lacks canonical source-lineage fields.",
                        relative_manifest,
                        {"missing_fields": missing},
                    )


def _ncep_grid_signature(record: Mapping[str, Any]) -> dict[str, Any] | None:
    metadata = record.get("netcdf")
    if not isinstance(metadata, Mapping):
        return None
    coordinates = metadata.get("coordinates")
    if not isinstance(coordinates, Mapping):
        return None
    signature = {
        name: coordinates.get(name)
        for name in ("latitude", "longitude", "level")
    }
    return signature if signature["latitude"] and signature["longitude"] else None


def _validate_ncep_component_grids(report: dict[str, Any]) -> None:
    """Reject wind components whose lat/lon/level grids are not interoperable."""
    for directory_name in ("ncep_wind", "ncep_wind_subset"):
        components: dict[str, list[dict[str, Any]]] = {name: [] for name in ("uwnd", "vwnd", "shum")}
        for record in report["files"]:
            path = record["relative_path"]
            if not path.startswith(f"{directory_name}/"):
                continue
            name = next((candidate for candidate in components if candidate in Path(path).name.lower()), None)
            if name is None:
                continue
            signature = _ncep_grid_signature(record)
            if signature is not None:
                components[name].append(signature)
        encoded = {
            name: sorted({json.dumps(value, sort_keys=True) for value in values})
            for name, values in components.items()
        }
        compatible = all(len(encoded[name]) == 1 for name in components)
        if compatible:
            compatible = len({encoded[name][0] for name in components}) == 1
        details = {
            "compatible": compatible,
            "component_grid_signatures": {
                name: [json.loads(value) for value in values]
                for name, values in encoded.items()
            },
        }
        _check(
            report,
            "NCEP_COMPONENT_GRID_COMPATIBILITY",
            "NCEP u/v/specific-humidity latitude, longitude, and level grids were compared.",
            f"{directory_name}/",
            details,
        )
        if not compatible:
            _blocker(
                report,
                "NCEP_COMPONENT_GRID_INCOMPATIBLE",
                "NCEP u/v/specific-humidity components cannot be merged without an explicit validated regridding and lineage step.",
                f"{directory_name}/",
                details,
            )

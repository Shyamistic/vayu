"""Read-only regional training-data readiness reports.

The report deliberately distinguishes file presence from accepted provenance.  It
is designed for local audit and does not download, transform, or package assets.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Mapping, Sequence

from .data_inventory import build_inventory
from .data_manifests import build_manifest_catalog
from .data_splits import FULL_INDIA_BOUNDS, FULL_INDIA_REGION, REGIONAL_DATASETS, default_split_config
from .regions import REGION_BOUNDS

REPORT_SCHEMA_VERSION = "vayu.data-readiness-report/v1"


def regional_job_contract() -> dict[str, Any]:
    """Return the immutable five-job input contract used for readiness gates."""
    config = default_split_config()
    regions = {
        name: {"bounds": dict(REGION_BOUNDS[name]), "role": "specialist_training"}
        for name in REGIONAL_DATASETS
    }
    regions[FULL_INDIA_REGION] = {
        "bounds": dict(FULL_INDIA_BOUNDS),
        "role": "composition_and_calibration_only",
        "requires_accepted_specialist_artifacts": True,
        "monolithic_graph_first": False,
    }
    return {
        "regions": regions,
        "temporal_split": config["temporal"],
        "spatial_buffer_degrees": {
            "regional": config["spatial"]["regional_buffer_degrees"],
            "boundary": config["spatial"]["boundary_buffer_degrees"],
        },
        "normalization": {"fit_split": "train", "record_feature_schema_version": True, "record_feature_schema_checksum": True},
        "required_roles": {
            "targets": {"variables": ["rainfall", "tmax", "tmin"], "units": ["mm/day", "degC"]},
            "atmosphere_850hpa": {"variables": ["uwnd", "vwnd", "shum"], "units": {"uwnd": "m/s", "vwnd": "m/s", "shum": "kg/kg"}},
            "pressure_related": {"acceptable": ["surface_pressure", "geopotential", "pressure_level"], "not_satisfied_by": ["pr_wtr"]},
            "static": ["elevation", "land_sea_mask", "land_cover"],
        },
        "kaggle": {"maximum_upload_bytes": 20 * 1024 ** 3, "partition_by": "region", "required_metadata": ["owner_region", "input_checksums", "canonical_manifest_id", "split_id", "feature_schema_version", "feature_schema_checksum", "seed", "code_revision", "checkpoint_parent_id"]},
    }


def _manifest_by_id(catalog: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    return {str(item["dataset_id"]): item for item in catalog.get("manifests", [])}


def _record_paths(records: Sequence[Mapping[str, Any]], prefix: str) -> list[str]:
    return [str(item["relative_path"]) for item in records if str(item.get("relative_path", "")).startswith(prefix)]


def _component_grid_validation(inventory: Mapping[str, Any], family: str) -> dict[str, Any]:
    """Compare NCEP u/v/q grids rather than assuming filename compatibility."""
    components: dict[str, list[dict[str, Any]]] = {name: [] for name in ("uwnd", "vwnd", "shum")}
    for record in inventory.get("files", []):
        path = str(record.get("relative_path", ""))
        if not path.startswith(f"{family}/"):
            continue
        component = next((name for name in components if name in Path(path).name.lower()), None)
        if component is None:
            continue
        netcdf = record.get("netcdf", {})
        coordinates = netcdf.get("coordinates", {})
        signature = {
            key: coordinates.get(key)
            for key in ("latitude", "longitude", "time", "level")
        }
        variables = netcdf.get("variables", [])
        components[component].append({"path": path, "grid": signature, "variables": variables})

    signatures: dict[str, list[dict[str, Any]]] = {}
    for name, values in components.items():
        unique: dict[str, dict[str, Any]] = {}
        for value in values:
            grid = {key: value["grid"].get(key) for key in ("latitude", "longitude", "level")}
            unique[json.dumps(grid, sort_keys=True)] = grid
        signatures[name] = list(unique.values())
    present = all(components[name] for name in components)
    one_grid_each = present and all(len(values) == 1 for values in signatures.values())
    grids_match = one_grid_each and len({json.dumps(values[0], sort_keys=True) for values in signatures.values()}) == 1
    return {
        "family": family,
        "components": components,
        "grid_signatures": signatures,
        "status": "compatible" if grids_match else "incompatible",
        "reason": "u/v/shum coordinate signatures match" if grids_match else "u/v/shum are absent or have different/variable latitude, longitude, or pressure-level grids",
    }


def _external_family(path: Path, name: str) -> dict[str, Any]:
    """Inventory a sibling data family without treating it as production input."""
    if not path.is_dir():
        return {"status": "missing", "path": name, "file_count": 0, "files": []}
    inventory = build_inventory(path, root_source="repository_sibling")
    return {
        "status": "pending_provenance",
        "path": name,
        "file_count": len(inventory["files"]),
        "size_bytes": sum(int(item["size_bytes"]) for item in inventory["files"]),
        "files": [item["relative_path"] for item in inventory["files"]],
        "coverage": _coverage_from_records(inventory["files"]),
        "reason": "File presence does not establish source URL, license, retrieval record, checksum ledger, or accepted manifest.",
    }


def _coverage_from_records(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    values: dict[str, list[Any]] = {"latitude": [], "longitude": [], "time": []}
    for record in records:
        coordinates = record.get("netcdf", {}).get("coordinates", {})
        for name in values:
            coordinate = coordinates.get(name)
            if isinstance(coordinate, Mapping):
                values[name].extend(coordinate.get(key) for key in ("minimum", "maximum") if coordinate.get(key) is not None)
    return {
        "latitude": {"minimum": min(values["latitude"]), "maximum": max(values["latitude"])} if values["latitude"] else None,
        "longitude": {"minimum": min(values["longitude"]), "maximum": max(values["longitude"])} if values["longitude"] else None,
        "time": {"start": min(values["time"]), "end": max(values["time"])} if values["time"] else None,
    }


def _unmapped_data_families(inventory: Mapping[str, Any], catalog: Mapping[str, Any]) -> dict[str, list[str]]:
    mapped_roots: set[str] = set()
    for manifest in catalog.get("manifests", []):
        for artifact in manifest.get("artifacts", []):
            mapped_roots.add(str(artifact["relative_uri"]).split("/", 1)[0])
    result: dict[str, list[str]] = {}
    for record in inventory.get("files", []):
        path = str(record["relative_path"])
        root = path.split("/", 1)[0]
        if root not in mapped_roots:
            result.setdefault(root, []).append(path)
    return {key: sorted(value) for key, value in sorted(result.items())}


def _wind_layer_contract() -> dict[str, Any]:
    return {
        "required_fields": {
            "u_component": {"units": "m/s"},
            "v_component": {"units": "m/s"},
            "pressure_level_hpa": 850,
            "valid_time": "ISO-8601 UTC or CF-decodable timestamp",
            "grid": ["latitude", "longitude", "coordinate_reference_system", "coverage_bounds"],
            "provenance": ["provider", "product", "product_version", "source_url", "retrieved_at", "license_or_terms", "source_checksum", "processing_lineage"],
            "freshness": ["observed_or_model_time", "retrieved_at", "expires_at_or_latency"],
        },
        "acceptance": "Render only when u/v have compatible valid-time and spatial grids, declared units, an accepted manifest, and coverage for the requested view.",
        "insufficient_evidence_behavior": "Do not synthesize or interpolate a wind field. Return/render insufficient-evidence with missing requirements and source freshness.",
    }


def build_data_readiness_report(
    data_root: Path | str,
    *,
    repository_root: Path | str | None = None,
    inventory: Mapping[str, Any] | None = None,
    catalog: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a portable, read-only readiness report for the five-job contract."""
    data_root = Path(data_root).resolve()
    repository_root = Path(repository_root).resolve() if repository_root else data_root.parent
    active_inventory = inventory or build_inventory(data_root)
    active_catalog = catalog or build_manifest_catalog(data_root, inventory=active_inventory)
    manifests = _manifest_by_id(active_catalog)
    manifest_statuses = {
        dataset_id: {
            "status": manifest["validation"]["status"],
            "manifest_id": manifest["manifest_id"],
            "source": manifest["source"],
            "license": manifest["license"],
            "coverage": manifest["coverage"],
            "blocker_codes": [item["code"] for item in manifest["validation"].get("blockers", [])],
        }
        for dataset_id, manifest in manifests.items()
    }
    wg_wind = _component_grid_validation(active_inventory, "ncep_wind_subset")
    broad_wind = _component_grid_validation(active_inventory, "ncep_wind")
    blockers = list(active_inventory.get("validation", {}).get("blockers", []))
    for dataset_id, details in manifest_statuses.items():
        if details["status"] == "blocked":
            blockers.append({"code": "MANIFEST_BLOCKED", "dataset_id": dataset_id})
    blockers.extend([
        {"code": "WG_WIND_CANDIDATE_ONLY", "message": "Western-Ghats-only NCEP coverage cannot serve North-East, Indo-Gangetic, Central India, or the national composition target."},
        {"code": "NO_ACCEPTED_STATIC_FEATURE_SET", "message": "Elevation, land/sea mask, and land cover lack accepted source manifests."},
    ])
    return {
        "schema_version": REPORT_SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "data_root": "data/",
        "overall_status": "blocked" if blockers else "ready",
        "regional_job_contract": regional_job_contract(),
        "inventory_status": active_inventory.get("validation", {}).get("status"),
        "catalog_schema_version": active_catalog["schema_version"],
        "manifest_statuses": manifest_statuses,
        "data_files": active_inventory.get("files", []),
        "unmapped_data_families": _unmapped_data_families(active_inventory, active_catalog),
        "families": {
            "data": {"status": "pending_manifest_gate", "file_count": len(active_inventory.get("files", [])), "reason": "See canonical-manifest statuses and inventory blockers; copied/package files are not accepted provenance."},
            "chirps": _external_family(repository_root / "chirps", "chirps/"),
            "checkpoints": _external_family(repository_root / "checkpoints", "checkpoints/"),
            "hydrorivers": _external_family(repository_root / "HydroRIVERS_v10_as.gdb", "HydroRIVERS_v10_as.gdb/"),
            "data_ingestion": {"status": "tooling_present_not_data", "path": "data_ingestion/", "reason": "Existing ingestion code is not a source manifest and must not bypass the acceptance gate."},
        },
        "ncep_candidates": {"broad": broad_wind, "western_ghats": wg_wind, "decision": "pending_rejected_for_training", "reason": "All current NCEP assets remain candidate-only until provenance, license, component-grid compatibility, pressure-level, units, calendar, and regional coverage are accepted."},
        "wind_layer_contract": _wind_layer_contract(),
        "manual_acquisition": manual_acquisition_checklist(),
        "blockers": blockers,
    }


def manual_acquisition_checklist() -> list[dict[str, Any]]:
    """Return source-specific manual requirements; no credentials or downloads occur."""
    return [
        {"source": "IMD", "manual_selection": "Daily gridded rainfall 0.25° and Tmax/Tmin 1.0°, 2010-01-01 to 2025-12-31, retain native grids before documented regridding.", "required_evidence": ["written authorization/license or terms", "provider product/version", "source URL", "retrieval timestamp", "source checksums", "calendar/QC/units/coverage report"]},
        {"source": "Copernicus CDS ERA5", "manual_selection": "Pressure levels: u, v, specific humidity and geopotential at 850 hPa; single levels: surface pressure if selected; 2010-2025; each regional bounds plus buffer or 6-38N/66-100E. Complete access manually before requesting files.", "required_evidence": ["CDS product/version", "request parameters", "license acceptance record", "retrieval timestamps", "checksums", "native grid/calendar/units"]},
        {"source": "MOSDAC/INSAT", "manual_selection": "Only an approved product with documented product ID, level, cadence, units, geolocation, and daily aggregation rule.", "required_evidence": ["authorized access/terms", "product/version", "source checksums", "coverage and missing-data policy"]},
        {"source": "Static features", "manual_selection": "Acquire an India-bounded elevation, land/sea mask, and land-cover set individually. Do not download global WorldCover as a shortcut.", "required_evidence": ["stable documented source URL", "license/version", "CRS/datum", "resampling and nodata policy", "checksums"]},
        {"source": "HydroRIVERS", "manual_selection": "Treat local HydroRIVERS_v10_as.gdb as ancillary river/evidence geometry only; manually record the upstream HydroSHEDS release, license, retrieval date, and whole-database checksum before use.", "required_evidence": ["release/version", "license", "retrieval provenance", "checksum", "CRS and feature-layer inspection"]},
    ]


def render_data_readiness_markdown(report: Mapping[str, Any]) -> str:
    """Render a concise human-readable companion without changing raw inputs."""
    contract = report["regional_job_contract"]
    lines = [
        "# Task 23.1 local data-readiness report",
        "",
        f"Generated: {report['generated_at']}",
        f"Overall status: **{report['overall_status']}**. File presence is not accepted provenance.",
        "",
        "## Five-job contract",
        "| Job | Bounds | Role |",
        "|---|---|---|",
    ]
    for name, value in contract["regions"].items():
        bounds = value["bounds"]
        lines.append(f"| {name} | {bounds['lat_min']}–{bounds['lat_max']}°N, {bounds['lon_min']}–{bounds['lon_max']}°E | {value['role']} |")
    temporal = contract["temporal_split"]
    lines.extend([
        "",
        f"Calendar: train {temporal['train']['start_year']}–{temporal['train']['end_year']}; validation {temporal['validation']['start_year']}; test {temporal['test']['start_year']}–{temporal['test']['end_year']}. Regional/boundary buffers are {contract['spatial_buffer_degrees']['regional']}°/{contract['spatial_buffer_degrees']['boundary']}°. Normalization must fit train only.",
        "",
        "## Family and manifest gate",
        "| Dataset/family | Status | Evidence and decision |",
        "|---|---|---|",
    ])
    for name, details in report["manifest_statuses"].items():
        lines.append(f"| {name} | {details['status']} | manifest {details['manifest_id']}; license={details['license'].get('status')}; blockers={', '.join(details['blocker_codes']) or 'none'} |")
    for name, details in report["families"].items():
        lines.append(f"| {name} | {details['status']} | {details.get('reason', details.get('path', ''))} |")
    wind = report["ncep_candidates"]
    lines.extend([
        "",
        "## Wind/NCEP candidate decision",
        f"Broad NCEP component-grid status: **{wind['broad']['status']}**. Western-Ghats subset component-grid status: **{wind['western_ghats']['status']}**.",
        "The supplied Western-Ghats candidate is never coverage evidence for North-East, Indo-Gangetic, Central India, or 6–38°N/66–100°E national composition. `pr_wtr` is precipitable water, not the required pressure/geopotential field. No fabricated wind field is permitted.",
        "",
        "## Frontend wind-layer contract",
        "Use observed/modelled u/v only when pressure level, valid time, compatible grid/coverage, m/s units, provenance, and freshness are accepted. Otherwise return **insufficient-evidence** rather than render wind.",
        "",
        "## Acquisition decision",
        "No network download was performed. A small anonymous India-bounded static candidate was not established with verified terms and a stable documented URL; global products are intentionally not downloaded. Use the manual checklist in `data-readiness.json`.",
        "",
        "## Exact blockers",
    ])
    for blocker in report["blockers"]:
        lines.append(f"- `{blocker.get('code')}`: {blocker.get('message', blocker.get('dataset_id', 'see JSON details'))}")
    return "\n".join(lines) + "\n"


def write_data_readiness_report(report: Mapping[str, Any], output_dir: Path) -> tuple[Path, Path]:
    """Write new generated reports and reject overwriting prior audit output."""
    output_dir = output_dir.resolve()
    if output_dir.exists():
        raise FileExistsError(f"Refusing to overwrite existing generated report directory: {output_dir}")
    output_dir.mkdir(parents=True)
    json_path = output_dir / "data-readiness.json"
    markdown_path = output_dir / "data-readiness.md"
    json_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    markdown_path.write_text(render_data_readiness_markdown(report), encoding="utf-8")
    return json_path, markdown_path

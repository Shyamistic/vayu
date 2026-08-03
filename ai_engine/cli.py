"""Command-line entry points for portable AI-engine data discovery."""

from __future__ import annotations

import json
from pathlib import Path

import typer

from .data_inventory import (
    DataRootResolutionError,
    build_inventory,
    resolve_data_root,
)
from .data_manifests import build_manifest_catalog
from .data_readiness import (
    build_data_readiness_report,
    write_data_readiness_report,
)
from .data_splits import (
    SplitContractError,
    generate_split_metadata,
    load_manifest,
    load_split_config,
    write_split_metadata,
)

app = typer.Typer(
    name="vayu-ai",
    help="Portable VAYU AI-engine data discovery and inventory commands.",
    no_args_is_help=True,
)


def _resolve_or_exit(root: Path | None):
    try:
        return resolve_data_root(root)
    except DataRootResolutionError as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(code=2) from error


@app.command("discover")
def discover(
    root: Path | None = typer.Option(
        None,
        "--root",
        "--data-root",
        help="Data directory. Takes precedence over VAYU_DATA_ROOT and repository data/.",
    ),
    output: Path | None = typer.Option(None, "--output", "-o", help="Write discovery JSON here; stdout when omitted."),
) -> None:
    """Resolve a data root from CLI, environment, or repository-relative data/."""
    resolved = _resolve_or_exit(root)
    serialized = json.dumps({"data_root": str(resolved.path), "source": resolved.source}, indent=2)
    if output is None:
        typer.echo(serialized)
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(serialized + "\n", encoding="utf-8")
        typer.echo(f"Discovery report written: {output}")


@app.command("inventory")
def inventory(
    root: Path | None = typer.Option(None, "--root", "--data-root", help="Data directory to inspect."),
    output: Path | None = typer.Option(None, "--output", "-o", help="Write JSON report here; stdout when omitted."),
    large_file_threshold_mb: float = typer.Option(
        512,
        "--large-file-threshold-mb",
        min=0.001,
        help="Report files and families at or above this size as SSD relocation candidates.",
    ),
    strict: bool = typer.Option(False, "--strict", help="Exit 1 if validation blockers are detected."),
) -> None:
    """Inventory data without moving, copying, deleting, or modifying datasets."""
    resolved = _resolve_or_exit(root)
    report = build_inventory(
        resolved.path,
        root_source=resolved.source,
        large_file_threshold_mb=large_file_threshold_mb,
    )
    serialized = json.dumps(report, indent=2, sort_keys=True)
    if output is None:
        typer.echo(serialized)
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(serialized + "\n", encoding="utf-8")
        typer.echo(f"Inventory report written: {output}")
    if strict and report["validation"]["blockers"]:
        raise typer.Exit(code=1)


@app.command("manifests")
def manifests(
    root: Path | None = typer.Option(None, "--root", "--data-root", help="Data directory to describe."),
    output: Path | None = typer.Option(None, "--output", "-o", help="Write catalog JSON here; stdout when omitted."),
    strict: bool = typer.Option(False, "--strict", help="Exit 1 if any manifest has validation blockers."),
) -> None:
    """Build canonical, portable manifests without changing scientific datasets."""
    resolved = _resolve_or_exit(root)
    report = build_inventory(resolved.path, root_source=resolved.source)
    catalog = build_manifest_catalog(resolved.path, inventory=report, root_source=resolved.source)
    serialized = json.dumps(catalog, indent=2, sort_keys=True)
    if output is None:
        typer.echo(serialized)
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(serialized + "\n", encoding="utf-8")
        typer.echo(f"Manifest catalog written: {output}")
    if strict and any(manifest["validation"]["blockers"] for manifest in catalog["manifests"]):
        raise typer.Exit(code=1)


@app.command("readiness")
def readiness(
    output_dir: Path = typer.Option(..., "--output-dir", help="New directory for data-readiness.json and .md."),
    root: Path | None = typer.Option(None, "--root", "--data-root", help="Data directory to audit."),
    repository_root: Path | None = typer.Option(None, "--repository-root", help="Repository root containing chirps/, checkpoints/, and HydroRIVERS assets."),
    strict: bool = typer.Option(False, "--strict", help="Exit 1 unless all readiness gates pass."),
) -> None:
    """Write a new read-only five-job readiness report; never modify data assets."""
    resolved = _resolve_or_exit(root)
    try:
        report = build_data_readiness_report(
            resolved.path,
            repository_root=repository_root or resolved.path.parent,
        )
        json_path, markdown_path = write_data_readiness_report(report, output_dir)
    except FileExistsError as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(code=2) from error
    typer.echo(f"Data-readiness reports written: {json_path}, {markdown_path} ({report['overall_status']})")
    if strict and report["overall_status"] != "ready":
        raise typer.Exit(code=1)


@app.command("splits")
def splits(
    manifest: Path = typer.Option(..., "--manifest", help="Canonical manifest JSON or manifest catalog JSON."),
    output: Path = typer.Option(..., "--output", "-o", help="Required path for newly generated split and normalization metadata."),
    root: Path | None = typer.Option(None, "--root", "--data-root", help="Data directory containing manifest-relative artifacts."),
    dataset_id: str | None = typer.Option(None, "--dataset-id", help="Dataset ID when --manifest names a catalog."),
    split_config: Path | None = typer.Option(None, "--split-config", help="Explicit versioned split configuration JSON."),
    strict: bool = typer.Option(False, "--strict", help="Exit 1 when the generated validation report is rejected."),
) -> None:
    """Write deterministic, leakage-safe split metadata without modifying source data."""
    resolved = _resolve_or_exit(root)
    try:
        active_manifest = load_manifest(manifest, dataset_id)
        config = load_split_config(split_config)
        output_path = output.resolve()
        artifact_paths = {(resolved.path / item["relative_uri"]).resolve() for item in active_manifest["artifacts"]}
        if output_path in artifact_paths:
            raise SplitContractError("Output path must not overwrite a manifest-listed source artifact")
        metadata = generate_split_metadata(active_manifest, resolved.path, config=config)
        write_split_metadata(metadata, output_path)
    except SplitContractError as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(code=2) from error
    typer.echo(f"Split metadata written: {output_path} ({metadata['validation']['status']})")
    if strict and metadata["validation"]["status"] != "passed":
        raise typer.Exit(code=1)


def main() -> None:
    """Run the ai_engine command group."""
    app()

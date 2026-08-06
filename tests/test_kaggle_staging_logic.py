"""Simulate the notebook staging logic against the real Kaggle folder layouts.

Reproduces the exact directory shapes reported for each region so the split-
folder and `-001` suffix handling is verified without spending a Kaggle run.
"""
from __future__ import annotations

from pathlib import Path

import pytest

REQUIRED_FILES = [
    "sequence_manifest.json",
    "norm_params_2010-2025.nc",
    "normalized_2010-2025.nc",
    "elevation.nc",
    "lsm.nc",
]
OPTIONAL_FILES = ["train_sequences.pt", "val_sequences.pt", "test_sequences.pt"]


def locate(root: Path, name: str, region: str):
    """Mirror of the notebook's _locate()."""
    matches = sorted(root.rglob(name))
    if not matches:
        stem, dot, ext = name.rpartition(".")
        if dot:
            matches = sorted(root.rglob(f"{stem}-[0-9][0-9][0-9].{ext}"))
    if not matches:
        return None
    preferred = [m for m in matches if f"kaggle_bundle_{region}" in str(m)]
    return (preferred or matches)[0]


def stage(root: Path, region: str) -> tuple[dict[str, str], list[str]]:
    resolved, missing = {}, []
    for f in REQUIRED_FILES + OPTIONAL_FILES:
        src = locate(root, f, region)
        if src is None:
            if f in REQUIRED_FILES:
                missing.append(f)
            continue
        resolved[f] = src.name
    return resolved, missing


def build(root: Path, region: str, layout: dict[str, list[str]]) -> None:
    for folder, names in layout.items():
        d = root / folder / f"kaggle_bundle_{region}_v2"
        d.mkdir(parents=True, exist_ok=True)
        for n in names:
            (d / n).write_bytes(b"x")


# Exact layouts reported from the Kaggle dataset pages.
IGP = {
    "kaggle_bundle_indo_gangetic_plain_v2-20260803T144254Z-1-002": [
        "bundle_manifest.json", "elevation.nc", "lsm.nc",
        "norm_params_2010-2025.nc", "pipeline_log_2010-2025.json",
        "rainfall_2010-2025.nc", "sequence_manifest.json",
        "static_raster_manifest.json", "test_sequences.pt",
        "tmax_2010-2025.nc", "tmin_2010-2025.nc", "val_sequences.pt",
    ],
    "kaggle_bundle_indo_gangetic_plain_v2-20260803T144254Z-1-003": [
        "normalized_2010-2025.nc", "train_sequences-001.pt",
    ],
}

CENTRAL = {
    "kaggle_bundle_central_india_v2-20260803T143812Z-1-001": [
        "bundle_manifest.json", "norm_params_2010-2025.nc",
        "pipeline_log_2010-2025.json", "static_raster_manifest.json",
        "tmin_2010-2025.nc", "train_sequences.pt", "val_sequences.pt",
    ],
    "kaggle_bundle_central_india_v2-20260803T143812Z-1-002": [
        "elevation.nc", "lsm.nc", "normalized_2010-2025.nc",
        "rainfall_2010-2025.nc", "sequence_manifest.json",
        "test_sequences.pt", "tmax_2010-2025.nc",
    ],
}

WG = {
    "kaggle_bundle_western_ghats_v2-20260803T130940Z-1-001": [
        "elevation.nc", "norm_params_2010-2025.nc", "pipeline_log_2010-2025.json",
        "sequence_manifest.json", "tmin_2010-2025.nc", "train_sequences.pt",
        "val_sequences.pt",
    ],
    "kaggle_bundle_western_ghats_v2-20260803T130940Z-1-002": [
        "bundle_manifest.json", "lsm.nc", "normalized_2010-2025.nc",
        "rainfall_2010-2025.nc", "static_raster_manifest.json",
        "test_sequences.pt", "tmax_2010-2025.nc",
    ],
}

NE = {
    "kaggle_bundle_north_east_india_v2-single": [
        "bundle_manifest.json", "elevation.nc", "lsm.nc",
        "norm_params_2010-2025.nc", "normalized_2010-2025.nc",
        "pipeline_log_2010-2025.json", "rainfall_2010-2025.nc",
        "sequence_manifest.json", "static_raster_manifest.json",
        "test_sequences.pt", "tmax_2010-2025.nc", "tmin_2010-2025.nc",
        "train_sequences.pt", "val_sequences.pt",
    ],
}


@pytest.mark.parametrize(
    "region,layout",
    [
        ("indo_gangetic_plain", IGP),
        ("central_india", CENTRAL),
        ("western_ghats", WG),
        ("north_east_india", NE),
    ],
)
def test_all_regions_resolve_required_files(tmp_path, region, layout):
    build(tmp_path, region, layout)
    resolved, missing = stage(tmp_path, region)
    assert missing == [], f"{region} still missing {missing}"
    # Everything needed for --all-windows must resolve.
    for f in REQUIRED_FILES:
        assert f in resolved


def test_indo_gangetic_suffixed_train_sequences_resolves(tmp_path):
    """Kaggle stored it as train_sequences-001.pt; staging must still find it
    and copy it to the canonical name the trainer expects."""
    build(tmp_path, "indo_gangetic_plain", IGP)
    src = locate(tmp_path, "train_sequences.pt", "indo_gangetic_plain")
    assert src is not None
    assert src.name == "train_sequences-001.pt"


def test_cross_folder_resolution(tmp_path):
    """normalized/lsm live in a different folder than the sequences — the old
    single-DATASET_DIR copy silently skipped them."""
    build(tmp_path, "indo_gangetic_plain", IGP)
    norm = locate(tmp_path, "normalized_2010-2025.nc", "indo_gangetic_plain")
    lsm = locate(tmp_path, "lsm.nc", "indo_gangetic_plain")
    assert norm.parent != lsm.parent, "fixture should span two folders"
    assert norm is not None and lsm is not None


def test_genuinely_missing_file_is_reported(tmp_path):
    layout = {k: [f for f in v if f != "normalized_2010-2025.nc"]
              for k, v in IGP.items()}
    build(tmp_path, "indo_gangetic_plain", layout)
    _, missing = stage(tmp_path, "indo_gangetic_plain")
    assert missing == ["normalized_2010-2025.nc"]


def test_prefers_matching_region_bundle(tmp_path):
    """With two regions attached, files must come from this region's bundle."""
    build(tmp_path, "central_india", CENTRAL)
    build(tmp_path, "north_east_india", NE)
    src = locate(tmp_path, "normalized_2010-2025.nc", "central_india")
    assert "kaggle_bundle_central_india" in str(src)

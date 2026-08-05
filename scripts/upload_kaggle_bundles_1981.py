"""Create/version Kaggle datasets for the four 1981-2025 regional bundles.

Creates NEW dataset slugs (vayu-<region>-1981-2025) rather than pushing new
versions of the existing 2010-2025 bundles, so the old datasets stay
available for direct before/after comparison.

Usage:
    python scripts/upload_kaggle_bundles_1981.py              # create/update all 4
    python scripts/upload_kaggle_bundles_1981.py western_ghats  # just one
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

BUNDLE_ROOT = Path("D:/vayu_data/kaggle_bundles_1981")
USERNAME = "shyam31415"

REGIONS = {
    "western_ghats": "VAYU Western Ghats 1981-2025",
    "north_east_india": "VAYU North East India 1981-2025",
    "indo_gangetic_plain": "VAYU Indo-Gangetic Plain 1981-2025",
    "central_india": "VAYU Central India 1981-2025",
}


def slug(region: str) -> str:
    return f"vayu-{region.replace('_', '-')}-1981-2025"


def ensure_metadata(bundle_dir: Path, region: str) -> None:
    meta = {
        "title": REGIONS[region],
        "id": f"{USERNAME}/{slug(region)}",
        "licenses": [{"name": "CC0-1.0"}],
    }
    (bundle_dir / "dataset-metadata.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )


def dataset_exists(region: str) -> bool:
    result = subprocess.run(
        [sys.executable, "-m", "kaggle", "datasets", "status", f"{USERNAME}/{slug(region)}"],
        capture_output=True, text=True,
    )
    return result.returncode == 0


def main() -> int:
    targets = sys.argv[1:] or list(REGIONS)
    for region in targets:
        if region not in REGIONS:
            print(f"unknown region: {region}")
            return 1
        bundle_dir = BUNDLE_ROOT / f"kaggle_bundle_{region}_1981"
        if not bundle_dir.exists():
            print(f"bundle not found: {bundle_dir}")
            return 1

        ensure_metadata(bundle_dir, region)
        exists = dataset_exists(region)
        print(f"\n=== {region} -> {USERNAME}/{slug(region)} "
              f"({'update' if exists else 'create'}) ===")

        if exists:
            cmd = [sys.executable, "-m", "kaggle", "datasets", "version",
                   "-p", str(bundle_dir), "-m", "1981-2025 full-history rebuild",
                   "-r", "zip"]
        else:
            cmd = [sys.executable, "-m", "kaggle", "datasets", "create",
                   "-p", str(bundle_dir), "-r", "zip"]

        result = subprocess.run(cmd, capture_output=True, text=True)
        print(result.stdout[-2000:])
        if result.returncode != 0:
            print("STDERR:", result.stderr[-2000:])
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

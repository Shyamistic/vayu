"""Package the 1981-2025 preprocessed datasets into per-region Kaggle bundles.

Each bundle contains everything the --all-windows training path needs:
    normalized_1981-2025.nc, norm_params_1981-2025.nc, pipeline_log_1981-2025.json,
    elevation.nc, lsm.nc, static_raster_manifest.json (if present)

No *_sequences.pt files are included -- windows are sliced lazily from
normalized_*.nc (see ai_engine/windowed_dataset.py), which is how every
notebook in this project has trained since the v3 rain fixes. Bundling capped
.pt files would only bloat the upload for no benefit.

Usage:
    python scripts/build_kaggle_bundles_1981.py
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

REGIONS = ["western_ghats", "north_east_india", "indo_gangetic_plain", "central_india"]
YEAR_RANGE = "1981-2025"

PROCESSED_ROOT = Path("D:/vayu_data")
STATIC_ROOT = Path("D:/")
OUT_ROOT = Path("D:/vayu_data/kaggle_bundles_1981")


def build_bundle(region: str) -> dict:
    proc_dir = PROCESSED_ROOT / f"processed_{region}_1981"
    static_dir = STATIC_ROOT / f"static_{region}"
    out_dir = OUT_ROOT / f"kaggle_bundle_{region}_1981"
    out_dir.mkdir(parents=True, exist_ok=True)

    copied, missing = [], []

    def _copy(src: Path):
        if src.exists():
            shutil.copy2(src, out_dir / src.name)
            copied.append(src.name)
        else:
            missing.append(str(src))

    for name in (
        f"normalized_{YEAR_RANGE}.nc",
        f"norm_params_{YEAR_RANGE}.nc",
        f"pipeline_log_{YEAR_RANGE}.json",
    ):
        _copy(proc_dir / name)

    for name in ("elevation.nc", "lsm.nc", "static_raster_manifest.json"):
        _copy(static_dir / name)

    total_mb = sum((out_dir / n).stat().st_size for n in copied) / 1e6
    return {
        "region": region,
        "out_dir": str(out_dir),
        "copied": copied,
        "missing": missing,
        "total_mb": round(total_mb, 1),
    }


def main() -> int:
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    any_missing = False
    for region in REGIONS:
        result = build_bundle(region)
        print(f"\n{region}: {result['out_dir']}")
        print(f"  copied ({len(result['copied'])}): {result['copied']}")
        if result["missing"]:
            any_missing = True
            print(f"  MISSING: {result['missing']}")
        print(f"  total size: {result['total_mb']} MB")
    return 1 if any_missing else 0


if __name__ == "__main__":
    sys.exit(main())

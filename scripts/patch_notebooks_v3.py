"""Patch the 4 regional Kaggle notebooks for the v3 training fixes.

Changes per notebook:
  1. Copy cell also stages normalized_*.nc / elevation.nc / lsm.nc, which every
     v2 bundle already contains — so no Kaggle re-upload is needed.
  2. Training cell switches to lazy sliding windows (--all-windows) and turns
     off the two physics penalties that were rewarding mean-collapse.
"""
from __future__ import annotations

import json
from pathlib import Path

NB = Path("notebooks")

# region -> (notebook file, rain_weight, tmax_weight or None)
REGIONS = {
    "western_ghats": ("vayu_kaggle_training.ipynb", "2.2", None),
    "north_east_india": ("vayu_kaggle_training_north_east_india.ipynb", "2.4", None),
    "indo_gangetic_plain": ("vayu_kaggle_training_indo_gangetic_plain.ipynb", "1.8", "2.0"),
    "central_india": ("vayu_kaggle_training_central_india.ipynb", "2.0", None),
}

NEW_COPY_FILES = (
    "for f in ['train_sequences.pt', 'val_sequences.pt', 'test_sequences.pt',\n"
    "          'norm_params_2010-2025.nc', 'sequence_manifest.json',\n"
    "          'normalized_2010-2025.nc', 'elevation.nc', 'lsm.nc']:\n"
)


def patch_copy_cell(src_lines: list[str]) -> list[str] | None:
    """Extend the staged-file list to include the lazy-window inputs."""
    joined = "".join(src_lines)
    old_a = (
        "for f in ['train_sequences.pt', 'val_sequences.pt', 'test_sequences.pt',\n"
        "          'norm_params_2010-2025.nc', 'sequence_manifest.json']:\n"
    )
    if old_a not in joined:
        return None
    return (joined.replace(old_a, NEW_COPY_FILES)).splitlines(keepends=True)


def patch_train_cell(src_lines: list[str], region: str) -> list[str] | None:
    """Rewrite the final training invocation's argument list."""
    joined = "".join(src_lines)
    if "'--run-baselines'," not in joined or "'--epochs',".replace(" ", "") not in joined.replace(" ", ""):
        return None
    if "--all-windows" in joined:
        return None  # already patched

    # Physics penalties: conservation rewarded predicting the mean; smoothness
    # suppressed the real terrain-driven temperature gradients R2_tmax scores.
    joined = joined.replace("'--lambda-conservation',    '0.02',", "'--lambda-conservation',    '0.0',")
    joined = joined.replace("'--lambda-smoothness',      '0.02',", "'--lambda-smoothness',      '0.0',")

    # 100 epochs over 8.5x more windows would exceed a Kaggle session; the model
    # now starts near target skill so it needs far fewer.
    joined = joined.replace("'--epochs',                 '100',", "'--epochs',                 '40',")
    joined = joined.replace("'--early-stopping-patience','20',", "'--early-stopping-patience','8',")

    extra = (
        "    '--normalized-file',        f'{PROCESSED_DIR}/normalized_2010-2025.nc',\n"
        "    '--elevation-file',         f'{PROCESSED_DIR}/elevation.nc',\n"
        "    '--lsm-file',               f'{PROCESSED_DIR}/lsm.nc',\n"
        "    '--all-windows',\n"
        "    '--train-stride',           '3',\n"
        "    '--eval-stride',            '3',\n"
        "    '--run-baselines',\n"
    )
    joined = joined.replace("    '--run-baselines',\n", extra)
    return joined.splitlines(keepends=True)


def main() -> None:
    for region, (fname, rain_w, tmax_w) in REGIONS.items():
        path = NB / fname
        nb = json.loads(path.read_text(encoding="utf-8"))
        copied = trained = False

        for cell in nb["cells"]:
            if cell.get("cell_type") != "code":
                continue
            src = cell["source"]
            if not copied:
                new = patch_copy_cell(src)
                if new is not None:
                    cell["source"] = new
                    copied = True
                    continue
            if not trained:
                new = patch_train_cell(src, region)
                if new is not None:
                    cell["source"] = new
                    trained = True

        path.write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{fname}: copy_cell={'ok' if copied else 'SKIP'} train_cell={'ok' if trained else 'SKIP'}")


if __name__ == "__main__":
    main()

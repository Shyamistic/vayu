"""Make the notebook staging step resilient to files split across Kaggle folders.

Kaggle (and Google Drive exports) often split one bundle into sibling folders
like `...-1-001/` and `...-1-002/`. The previous cell picked a SINGLE
`DATASET_DIR` (the folder containing most sequence files) and copied from it, so
anything living in the other folder was silently skipped:

    skip (not in bundle): normalized_2010-2025.nc
    skip (not in bundle): lsm.nc
    skip (not in bundle): test_sequences.pt

That left --normalized-file pointing at a nonexistent path (opaque xarray
KeyError) and silently disabled held-out test evaluation.

Fix: locate every required file independently anywhere under /kaggle/input,
preferring paths that belong to this region's bundle, and fail loudly with the
list of what is genuinely absent.
"""
from __future__ import annotations

import json
from pathlib import Path

FILES = {
    "western_ghats": "vayu_kaggle_training.ipynb",
    "north_east_india": "vayu_kaggle_training_north_east_india.ipynb",
    "indo_gangetic_plain": "vayu_kaggle_training_indo_gangetic_plain.ipynb",
    "central_india": "vayu_kaggle_training_central_india.ipynb",
}

NEW_CELL = '''# ── Stage bundle files (resilient to multi-folder Kaggle datasets) ──────────
# Files are located individually rather than from one DATASET_DIR, because a
# bundle is often split across sibling folders (…-1-001 / …-1-002). Copying from
# a single folder silently skipped normalized_*.nc / lsm.nc / test_sequences.pt.
import shutil
from pathlib import Path as _P

_ROOT = _P('/kaggle/input')

# Needed for lazy sliding windows (--all-windows) and for metrics.
REQUIRED_FILES = [
    'sequence_manifest.json',
    'norm_params_2010-2025.nc',
    'normalized_2010-2025.nc',
    'elevation.nc',
    'lsm.nc',
]
# train/val are only needed for the pre-built path and the smoke check;
# test_sequences enables held-out evaluation when not using --all-windows.
OPTIONAL_FILES = ['train_sequences.pt', 'val_sequences.pt', 'test_sequences.pt']


def _locate(name):
    """Find `name` anywhere under /kaggle/input, preferring this region's bundle.

    Falls back to a suffixed variant, because Kaggle renames a file to
    `train_sequences-001.pt` when a name collides with an earlier version.
    """
    matches = sorted(_ROOT.rglob(name))
    if not matches:
        stem, dot, ext = name.rpartition('.')
        if dot:
            matches = sorted(_ROOT.rglob(f'{stem}-[0-9][0-9][0-9].{ext}'))
        if matches:
            print(f'note: {name} not found; using suffixed variant {matches[0].name}')
    if not matches:
        return None
    preferred = [m for m in matches if f'kaggle_bundle_{REGION}' in str(m)]
    return (preferred or matches)[0]


_missing = []
for _f in REQUIRED_FILES + OPTIONAL_FILES:
    _src = _locate(_f)
    if _src is None:
        if _f in REQUIRED_FILES:
            _missing.append(_f)
        else:
            print(f'optional, not found: {_f}')
        continue
    # Copy to the CANONICAL name so a Kaggle-suffixed source (…-001.pt) still
    # lands as the filename the trainer expects.
    shutil.copy(_src, _P(PROCESSED_DIR) / _f)
    print(f'staged {_f:28s} <- {_src.parent.name}/{_src.name}')

if _missing:
    raise RuntimeError(
        'Missing required files: ' + ', '.join(_missing) +
        '. Attach the complete v2 bundle (all sibling folders) via "Add Input".'
    )

os.system(f'ls -lah {PROCESSED_DIR}')
'''


def main() -> None:
    for region, fname in FILES.items():
        path = Path("notebooks") / fname
        nb = json.loads(path.read_text(encoding="utf-8"))
        patched = False
        for cell in nb["cells"]:
            if cell.get("cell_type") != "code":
                continue
            src = "".join(cell["source"])
            # The staging cell is the one that shutil.copy's into PROCESSED_DIR.
            # Matches both the original and an already-patched cell so this
            # script is idempotent and safe to re-run.
            if "shutil.copy" in src and "PROCESSED_DIR" in src:
                cell["source"] = NEW_CELL.splitlines(keepends=True)
                patched = True
                break
        path.write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{fname}: {'patched' if patched else 'NO STAGING CELL FOUND'}")


if __name__ == "__main__":
    main()

"""Remove the over-strict exact-filename gate from the clone cell.

The clone cell hard-failed with:

    RuntimeError: Missing dataset files: train_sequences.pt

because it required exact names via rglob, but Kaggle had stored Indo-Gangetic's
file as `train_sequences-001.pt` (it suffixes a name that collides with an
earlier dataset version). The gate also demanded train/val/test sequences that
are no longer needed at all under `--all-windows`, where windows are sliced from
normalized_*.nc instead.

Validation now lives solely in the staging cell, which locates each file
individually, tolerates the -NNN suffix, and raises with the genuinely missing
list. This cell just prints what is visible, which makes any future mismatch
obvious at a glance.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

FILES = [
    "vayu_kaggle_training.ipynb",
    "vayu_kaggle_training_north_east_india.ipynb",
    "vayu_kaggle_training_indo_gangetic_plain.ipynb",
    "vayu_kaggle_training_central_india.ipynb",
]

REPLACEMENT = '''# Validation lives in the staging cell below, which locates every file
# individually. That matters because a bundle is often split across sibling
# folders (…-1-001 / …-1-002) and Kaggle may store a colliding name as
# `train_sequences-001.pt`. Requiring exact names here caused a false failure.
# Under --all-windows the *_sequences.pt files are not needed at all, since
# windows are sliced from normalized_*.nc.
root = Path('/kaggle/input')
_seen = sorted({p.name for p in root.rglob('*') if p.is_file()})
print(f'{len(_seen)} file(s) visible under /kaggle/input:')
for _n in _seen:
    print('   ', _n)
'''


def main() -> None:
    for fname in FILES:
        path = Path("notebooks") / fname
        nb = json.loads(path.read_text(encoding="utf-8"))
        patched = False

        for cell in nb["cells"]:
            if cell.get("cell_type") != "code":
                continue
            src = "".join(cell["source"])
            if "required = [" not in src or "DATASET_DIR" not in src:
                continue
            # Strip from the `required = [...]` line through the DATASET_DIR print.
            new_src = re.sub(
                r"required = \[.*?print\('Dataset dir:', DATASET_DIR\)\n?",
                REPLACEMENT,
                src,
                flags=re.DOTALL,
            )
            if new_src != src:
                cell["source"] = new_src.splitlines(keepends=True)
                patched = True
                break

        path.write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{fname}: {'patched' if patched else 'no gate block found'}")


if __name__ == "__main__":
    main()

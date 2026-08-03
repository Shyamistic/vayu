"""Confirm the v3 notebook patches landed and the notebooks are valid JSON."""
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

STAGED = ("normalized_2010-2025.nc", "elevation.nc", "lsm.nc")


def find(pattern: str, src: str) -> str:
    m = re.search(pattern, src)
    return m.group(1) if m else "?"


for fname in FILES:
    nb = json.loads((Path("notebooks") / fname).read_text(encoding="utf-8"))
    src = "".join("".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code")

    epochs = find(r"'--epochs',\s*'(\d+)'", src)
    stride = find(r"'--train-stride',\s*'(\d+)'", src)
    rain = find(r"'--rain-weight',\s*'([\d.]+)'", src)
    cons = find(r"'--lambda-conservation',\s*'([\d.]+)'", src)
    smooth = find(r"'--lambda-smoothness',\s*'([\d.]+)'", src)

    print(fname)
    print(f"   all_windows={'--all-windows' in src}  train_stride={stride}  epochs={epochs}")
    print(f"   rain_weight={rain}  lambda_conservation={cons}  lambda_smoothness={smooth}")
    print(f"   stages lazy-window inputs={all(k in src for k in STAGED)}")

print("\nall notebooks parsed as valid JSON")

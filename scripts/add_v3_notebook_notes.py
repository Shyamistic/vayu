"""Insert a v3 explainer markdown cell into each regional Kaggle notebook."""
from __future__ import annotations

import json
from pathlib import Path

FILES = [
    "vayu_kaggle_training.ipynb",
    "vayu_kaggle_training_north_east_india.ipynb",
    "vayu_kaggle_training_indo_gangetic_plain.ipynb",
    "vayu_kaggle_training_central_india.ipynb",
]

NOTE_ID = "v3-fix-notes"

NOTE = """## v3 — why the previous run stalled, and what changed

The 2026-08-03 Western Ghats and North-East runs plateaued at **R2_rain ~ 0.001**
with **R2_tmax ~ 0.75** (barely above persistence). Four root causes were found
by measuring trivial predictors on the real validation data:

| Predictor (2022 val, WG, normalized space) | R2_rain | R2_tmax | R2_tmin |
|---|---|---|---|
| constant / dataset mean | -0.002 | -0.083 | -0.079 |
| persistence (the old skip connection) | **-0.303** | 0.722 | 0.721 |
| day-of-year climatology (train-years fit) | **+0.215** | 0.739 | 0.776 |
| 50/50 climatology + persistence | +0.153 | **+0.796** | **+0.804** |

A seasonal lookup table was beating the 6.6M-parameter model. Fixes:

1. **Rainfall loss: weighted MAE -> weighted MSE.** Absolute error is minimized
   by the conditional *median*, which for zero-inflated rain sits at the dry
   value. R2 scores the conditional *mean*. Measured: the old objective put
   98.6% of rainfall predictions at exactly 0.
2. **Removed the ReLU on rainfall.** Targets are per-cell z-scores in which
   45.4% of rainfall values are negative, so the clamp made the dry half of the
   distribution unrepresentable and pinned output at the mean (R2 = 0).
3. **Heads now blend persistence + day-of-year climatology** (learnable weights,
   climatology fitted on training years only, so no leakage). Rainfall starts on
   climatology because persistence scores -0.30 for it.
4. **Physics penalties off by default.** The conservation term was
   `|mean(pred) - mean(true)|`, which is minimized by predicting the mean, and
   the smoothness term suppressed the real terrain-driven temperature gradients
   that R2_tmax measures.
5. **8.5x more training data via `--all-windows`.** The pre-built bundles cap
   training at 512 windows; 2010-2021 offers ~4,350 at stride 1. Windows are now
   sliced lazily from `normalized_*.nc` (already inside this dataset), so no
   re-upload is needed. This notebook uses stride 3 to fit a Kaggle session.

**Starting point after these changes (before any training):**
R2_rain +0.215, R2_tmax +0.796, R2_tmin +0.804 — i.e. training now begins at
roughly the target instead of below it. Targets: R2_tmax >= 0.80, R2_rain >= 0.20.
"""


def main() -> None:
    for fname in FILES:
        path = Path("notebooks") / fname
        nb = json.loads(path.read_text(encoding="utf-8"))
        if any(c.get("id") == NOTE_ID for c in nb["cells"]):
            print(f"{fname}: note already present")
            continue
        cell = {
            "cell_type": "markdown",
            "id": NOTE_ID,
            "metadata": {},
            "source": NOTE.splitlines(keepends=True),
        }
        # Insert right after the existing title/intro markdown cell.
        nb["cells"].insert(1, cell)
        path.write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{fname}: v3 note inserted")


if __name__ == "__main__":
    main()

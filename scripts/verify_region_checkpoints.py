"""Prove which checkpoint each region actually predicts with.

`_get_region_model` falls back to the global checkpoint whenever a region's own
file is missing or fails to load, and the fallback is logged at INFO — invisible
under the `--log-level warning` the API is normally started with. Since the global
checkpoint is a *stale* one whose prediction heads do not exist in the current
architecture, a silent fallback would degrade that region to the
persistence/climatology blend while still answering HTTP 200.

This checks the claim directly rather than trusting the logs: it resolves each
region through the same function the request path uses and compares the loaded
model's identity and parameter count against the global model's.

Usage:
    .venv\\Scripts\\python.exe scripts/verify_region_checkpoints.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("CLIMATE_DATA_ROOT", "D:/vayu_data")
os.environ.setdefault("STATIC_RASTER_ROOT", "D:/")
os.environ.setdefault("REDIS_URL", "redis://disabled.invalid:6379")

import torch  # noqa: E402

from ai_engine.climate_model import VayuClimateModel  # noqa: E402
from backend import main as backend_main  # noqa: E402


def head_is_trained(model: VayuClimateModel) -> tuple[bool, float]:
    """Is the residual layer non-zero?

    The learned-baseline-blend head is deliberately zero-initialised on `out`, so
    an untrained head produces a residual of exactly 0 and the model degenerates
    to `w_persist * persistence + w_clim * climatology`. A trained head has a
    non-zero `out.weight`. This is the difference between "our model" and "the
    floor our model is supposed to beat", so it is worth asserting rather than
    assuming.
    """
    norms = []
    sd = model.state_dict()
    for key in sd:
        if key.endswith(".out.weight"):
            norms.append(float(torch.linalg.vector_norm(sd[key].float())))
    total = sum(norms)
    return (total > 0.0), total


def main() -> None:
    model_path = next(
        (p for p in (os.getenv("MODEL_PATH", ""), "./checkpoints/vayu_best.pt")
         if p and Path(p).exists()),
        None,
    )
    print(f"global checkpoint : {model_path}")
    global_model = VayuClimateModel.load(model_path, device="cpu") if model_path else None
    backend_main._model = global_model

    if global_model is not None:
        g_params = sum(p.numel() for p in global_model.parameters())
        g_trained, g_norm = head_is_trained(global_model)
        print(f"  params          : {g_params:,}")
        print(f"  residual head   : {'TRAINED' if g_trained else 'ZERO (degenerates to the baseline blend)'}"
              f"  |out.weight| sum={g_norm:.6f}")

    print()
    print(f"{'region':22s} {'params':>12s}  {'residual head':>14s}  {'is global?':>10s}  checkpoint")
    print("-" * 110)

    failures: list[str] = []
    for region, path in backend_main._REGION_CHECKPOINT_DIRS.items():
        model = backend_main._get_region_model(region)
        if model is None:
            print(f"{region:22s} {'-':>12s}  {'NONE':>14s}  {'n/a':>10s}  (no model)")
            failures.append(f"{region}: no model")
            continue
        params = sum(p.numel() for p in model.parameters())
        trained, norm = head_is_trained(model)
        is_global = model is global_model
        exists = Path(path).exists()
        print(f"{region:22s} {params:>12,}  "
              f"{('TRAINED' if trained else 'ZERO'):>14s}  "
              f"{('YES' if is_global else 'no'):>10s}  {path}"
              f"{'' if exists else '  <-- FILE MISSING'}")
        if is_global:
            failures.append(f"{region}: silently fell back to the global checkpoint")
        if not trained:
            failures.append(f"{region}: residual head is zero — serving the baseline blend")

    print()
    if failures:
        print("PROBLEMS:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("OK - every region resolves to its own checkpoint with a trained residual head.")


if __name__ == "__main__":
    main()

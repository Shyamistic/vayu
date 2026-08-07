"""Report exactly which tensors a checkpoint fails to fill, and how much it matters.

`VayuClimateModel.from_checkpoint` loads with `strict=False` and logs only a
*count* of missing keys. A count cannot distinguish the two cases that matter:

  * benign  - the missing tensors belong to layers that are deterministic or
              zero-initialised, so a random init is the same as the trained value
              (or there is nothing to train).
  * serious - the missing tensors carry learned weights, which means those layers
              are running on their random initialisation and the forecast is
              partly noise while /health still reports healthy.

This prints the names, shapes, parameter counts and the initialised values so the
distinction is made from evidence.

Usage:
    .venv\\Scripts\\python.exe scripts/diagnose_checkpoint.py [path-to-ckpt ...]
"""

from __future__ import annotations

import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ai_engine.climate_model import VayuClimateModel  # noqa: E402
from ai_engine.config import ModelConfig  # noqa: E402


def describe(path: Path) -> None:
    print("=" * 78)
    print(path)
    if not path.exists():
        print("  MISSING FILE")
        return

    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    sd = ckpt.get("model_state_dict", {})
    stored_cfg = ckpt.get("config", None)
    print(f"  checkpoint tensors : {len(sd)}")
    print(f"  stored config      : {type(stored_cfg).__name__ if stored_cfg else 'None (shapes auto-detected)'}")
    for key in ("epoch", "val_loss", "best_val_loss", "region", "notes"):
        if key in ckpt:
            print(f"  {key:19s}: {ckpt[key]}")

    # Rebuild exactly the way the API does.
    model = VayuClimateModel.load(str(path), device="cpu")
    model_sd = model.state_dict()

    missing = [k for k in model_sd if k not in sd]
    unexpected = [k for k in sd if k not in model_sd]
    shape_mismatch = [
        k for k in model_sd if k in sd and tuple(model_sd[k].shape) != tuple(sd[k].shape)
    ]

    total_params = sum(p.numel() for p in model.parameters())
    missing_params = sum(int(model_sd[k].numel()) for k in missing)

    print(f"  model tensors      : {len(model_sd)}")
    print(f"  MISSING            : {len(missing)}  ({missing_params:,} params "
          f"= {100.0 * missing_params / max(total_params, 1):.3f}% of {total_params:,})")
    print(f"  UNEXPECTED         : {len(unexpected)}")
    print(f"  SHAPE MISMATCH     : {len(shape_mismatch)}")

    if shape_mismatch:
        print("  -- shape mismatches (these silently keep the random init) --")
        for k in shape_mismatch:
            print(f"     {k}: model {tuple(model_sd[k].shape)} vs ckpt {tuple(sd[k].shape)}")

    if missing:
        print("  -- missing tensors --")
        for k in missing:
            t = model_sd[k]
            flat = t.detach().float().reshape(-1)
            allzero = bool(torch.all(flat == 0))
            allone = bool(torch.all(flat == 1))
            kind = "ALL ZERO" if allzero else "ALL ONE" if allone else (
                f"min={flat.min():.4f} max={flat.max():.4f} std={flat.std():.4f}"
                if flat.numel() > 1 else f"value={flat.item():.4f}"
            )
            trainable = model_sd[k].requires_grad if hasattr(model_sd[k], "requires_grad") else None
            print(f"     {k:58s} {str(tuple(t.shape)):16s} n={t.numel():<9,} {kind}"
                  + (f"  requires_grad={trainable}" if trainable is not None else ""))

    if unexpected:
        print("  -- unexpected tensors (in ckpt, not in model) --")
        for k in unexpected[:40]:
            print(f"     {k}  {tuple(sd[k].shape)}")

    # Which of the missing names are buffers rather than parameters? Buffers are
    # not trained, so a "missing" buffer is usually a non-issue.
    param_names = {n for n, _ in model.named_parameters()}
    buffer_names = {n for n, _ in model.named_buffers()}
    miss_params = [k for k in missing if k in param_names]
    miss_buffers = [k for k in missing if k in buffer_names]
    print(f"  missing that are PARAMETERS: {len(miss_params)}")
    print(f"  missing that are BUFFERS   : {len(miss_buffers)}")


def main() -> None:
    if len(sys.argv) > 1:
        paths = [Path(p) for p in sys.argv[1:]]
    else:
        root = Path(__file__).resolve().parents[1]
        paths = [root / "checkpoints" / "vayu_best.pt"]
        regions = root / "checkpoints" / "regions"
        if regions.is_dir():
            paths += sorted(regions.glob("*/vayu_best.pt"))
    for p in paths:
        describe(p)


if __name__ == "__main__":
    main()

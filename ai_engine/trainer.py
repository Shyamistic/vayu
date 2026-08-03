"""Training pipeline for VayuClimateModel.

Temporal split: train 1951-2020, val 2021-2023, test 2024-2025.
Optimizer: Adam, lr=1e-4, weight_decay=1e-5.
Scheduler: ReduceLROnPlateau on validation loss.
Early stopping: 10 epochs patience.
Metrics: R², RMSE, MAE, skill score vs climatology persistence baseline.
"""

from __future__ import annotations

import json
import logging
import os
import platform
import time
from contextlib import nullcontext
from pathlib import Path
from typing import Generator

import numpy as np
import torch
import torch.optim as optim
import xarray as xr
from torch.utils.data import DataLoader, Dataset
from torch_geometric.data import Data as GraphData

from .climate_model import VayuClimateModel
from .grid_climate_model import VayuGridClimateModel
from .config import DataSplit, ModelConfig
from .loss_functions import PhysicsInformedLoss
from .baselines import run_baseline_suite
from .regions import available_regions, region_mask
from data_ingestion.graph_builder import ClimateGraphBuilder

logger = logging.getLogger(__name__)


def _json_safe(value):
    """Recursively convert numpy/torch scalar types to JSON-serializable values."""
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, torch.Tensor) and value.numel() == 1:
        return value.item()
    return value


def _build_synthetic_sequences(config: ModelConfig) -> tuple[list, list]:
    """Build a tiny synthetic dataset so CLI training can run end-to-end.

    This keeps local smoke tests unblocked when processed artifacts are missing.
    """
    import pandas as pd

    builder = ClimateGraphBuilder()
    ntime = config.input_window + config.forecast_horizon + 12
    times = pd.date_range("2023-01-01", periods=ntime, freq="D")

    nlat, nlon = builder.nlat, builder.nlon
    rng = np.random.default_rng(42)

    rainfall = np.abs(rng.normal(4.5, 2.0, (ntime, nlat, nlon))).astype(np.float32)
    tmax = rng.normal(32.0, 3.0, (ntime, nlat, nlon)).astype(np.float32)
    tmin = rng.normal(24.0, 2.5, (ntime, nlat, nlon)).astype(np.float32)
    insat_lst = (tmax + rng.normal(0.0, 0.6, (ntime, nlat, nlon))).astype(np.float32)
    insat_sst = rng.normal(28.0, 1.0, (ntime, nlat, nlon)).astype(np.float32)

    day_of_year = np.arange(ntime) % 365
    day_sin = np.sin(2 * np.pi * day_of_year / 365.0).astype(np.float32)
    day_cos = np.cos(2 * np.pi * day_of_year / 365.0).astype(np.float32)

    ds = xr.Dataset(
        {
            "rainfall": (("time", "lat", "lon"), rainfall),
            "tmax": (("time", "lat", "lon"), tmax),
            "tmin": (("time", "lat", "lon"), tmin),
            "insat_lst": (("time", "lat", "lon"), insat_lst),
            "insat_sst": (("time", "lat", "lon"), insat_sst),
        },
        coords={
            "time": times,
            "lat": builder.lats,
            "lon": builder.lons,
            "day_sin": ("time", day_sin),
            "day_cos": ("time", day_cos),
        },
    )

    sequences = builder.create_training_sequences(
        ds,
        input_window=config.input_window,
        target_window=config.forecast_horizon,
    )

    split_idx = max(1, int(0.8 * len(sequences)))
    train_sequences = sequences[:split_idx]
    val_sequences = sequences[split_idx:] or sequences[-1:]
    return train_sequences, val_sequences


def _load_or_build_sequences(data_dir: str, config: ModelConfig) -> tuple[list, list, str]:
    """Load sequence tensors from disk; fallback to synthetic generation."""
    data_path = Path(data_dir)
    train_path = data_path / "train_sequences.pt"
    val_path = data_path / "val_sequences.pt"

    if train_path.exists() and val_path.exists():
        train_sequences = torch.load(train_path, map_location="cpu", weights_only=False)
        val_sequences = torch.load(val_path, map_location="cpu", weights_only=False)
        return train_sequences, val_sequences, "disk"

    train_sequences, val_sequences = _build_synthetic_sequences(config)
    return train_sequences, val_sequences, "synthetic"


@torch.no_grad()
def _run_smoke_forward(
    model: VayuClimateModel,
    loss_fn: PhysicsInformedLoss,
    sequences: list,
    device: str,
    checkpoint_dir: str,
) -> None:
    """Run a forward-only validation pass and write smoke metadata.

    This avoids native backprop crashes while still validating graph/model/loss wiring.
    """
    if not sequences:
        raise RuntimeError("No sequences available for smoke validation")

    graph, target = sequences[0]
    g = GraphData(
        x=graph.x.to(device),
        edge_index=graph.edge_index.to(device),
        edge_attr=graph.edge_attr.to(device),
    )
    t = target.to(device)

    model.eval()
    preds = model(g)
    losses = loss_fn(preds, t, g.edge_index)

    summary = {
        "status": "smoke_ok",
        "device": device,
        "num_nodes": int(g.x.shape[0]),
        "input_window": int(g.x.shape[1]),
        "forecast_horizon": int(t.shape[0]),
        "loss_total": float(losses["total_loss"].detach().cpu().item()),
        "rainfall_shape": list(preds["rainfall"].shape),
        "temp_max_shape": list(preds["temp_max"].shape),
        "temp_min_shape": list(preds["temp_min"].shape),
    }

    out_dir = Path(checkpoint_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "smoke_summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    logger.info("Smoke validation complete: %s", summary)


class ClimateSequenceDataset(Dataset):
    """PyTorch Dataset wrapping pre-built (input_graph, target_tensor) pairs."""

    def __init__(self, sequences: list[tuple[GraphData, torch.Tensor]]):
        self.sequences = sequences

    def __len__(self) -> int:
        return len(self.sequences)

    def __getitem__(self, idx: int) -> tuple[GraphData, torch.Tensor]:
        return self.sequences[idx]


def _collate_sequences(
    batch: list[tuple[GraphData, torch.Tensor]],
) -> tuple[GraphData, torch.Tensor]:
    """Simple collate: stack graphs and targets.

    Since all graphs share the same topology, we batch by stacking
    node feature tensors along a new batch dimension.
    """
    graphs, targets = zip(*batch)
    # Stack x: (batch, num_nodes, seq_len, features)
    x_batch = torch.stack([g.x for g in graphs], dim=0)
    # Targets: (batch, horizon, num_nodes, 3)
    t_batch = torch.stack(targets, dim=0)

    # Use topology from first graph (all identical)
    batched_graph = GraphData(
        x=x_batch,
        edge_index=graphs[0].edge_index,
        edge_attr=graphs[0].edge_attr,
    )
    if hasattr(graphs[0], "pos"):
        batched_graph.pos = graphs[0].pos
    if hasattr(graphs[0], "static_features"):
        batched_graph.static_features = graphs[0].static_features
    return batched_graph, t_batch


def _r2_score(pred: np.ndarray, true: np.ndarray) -> float:
    """Coefficient of determination R²."""
    mask = ~np.isnan(true) & ~np.isnan(pred)
    if mask.sum() == 0:
        return float("nan")
    p, t = pred[mask], true[mask]
    ss_res = np.sum((t - p) ** 2)
    ss_tot = np.sum((t - t.mean()) ** 2)
    return 1.0 - ss_res / (ss_tot + 1e-10)


def _skill_score(pred: np.ndarray, true: np.ndarray, clim: np.ndarray) -> float:
    """Skill score relative to climatology persistence baseline.

    SS = 1 - MSE(pred, true) / MSE(clim, true)
    SS > 0 means the model beats climatology.
    """
    mask = ~np.isnan(true) & ~np.isnan(pred)
    if mask.sum() == 0:
        return float("nan")
    mse_model = np.mean((pred[mask] - true[mask]) ** 2)
    mse_clim = np.mean((clim[mask] - true[mask]) ** 2) + 1e-10
    return 1.0 - mse_model / mse_clim


def _norm_key_for_model_var(model_var: str) -> str:
    mapping = {
        "rainfall": "rainfall",
        "temp_max": "tmax",
        "temp_min": "tmin",
    }
    return mapping.get(model_var, model_var)


def _load_norm_params_file(norm_params_file: str | None) -> dict[str, dict[str, np.ndarray]] | None:
    """Load normalization statistics from NetCDF produced by preprocess CLI."""
    if not norm_params_file:
        return None

    path = Path(norm_params_file)
    if not path.exists():
        raise FileNotFoundError(f"Normalization parameter file not found: {norm_params_file}")

    ds = xr.open_dataset(path)
    loaded: dict[str, dict[str, np.ndarray]] = {}
    for model_var in ["rainfall", "temp_max", "temp_min"]:
        key = _norm_key_for_model_var(model_var)
        mean_name = f"{key}_mean"
        std_name = f"{key}_std"
        if mean_name in ds and std_name in ds:
            loaded[model_var] = {
                "mean": ds[mean_name].values.astype(np.float32),
                "std": ds[std_name].values.astype(np.float32),
            }
    return loaded or None


def _denormalize_grid(
    arr: np.ndarray,
    mean_grid: np.ndarray,
    std_grid: np.ndarray,
) -> np.ndarray:
    """Denormalize node x horizon tensors using per-node stats."""
    mean_flat = mean_grid.reshape(-1)
    std_flat = std_grid.reshape(-1)
    std_flat = np.where(std_flat < 1e-6, 1e-6, std_flat)
    return arr * std_flat[:, None] + mean_flat[:, None]


def _baseline_from_input(
    graph: GraphData,
    horizon: int,
) -> dict[str, np.ndarray]:
    """Build persistence and climatology baselines from model input window.

    Returns:
        Dict with keys:
            - persistence_<var>
            - climatology_<var>
        Each array has shape (num_nodes, horizon).
    """
    # graph.x shape: (num_nodes, seq_len, features)
    x = graph.x.detach().cpu().numpy()
    # Dynamic channels: rainfall=0, temp_max=1, temp_min=2
    last_step = x[:, -1, :3]
    mean_step = x[:, :, :3].mean(axis=1)

    baselines = {}
    for idx, var in enumerate(["rainfall", "temp_max", "temp_min"]):
        pers = np.repeat(last_step[:, idx:idx + 1], horizon, axis=1)
        clim = np.repeat(mean_step[:, idx:idx + 1], horizon, axis=1)
        baselines[f"persistence_{var}"] = pers
        baselines[f"climatology_{var}"] = clim
    return baselines


class VayuTrainer:
    """Training and evaluation harness for VayuClimateModel."""

    def __init__(
        self,
        model: VayuClimateModel,
        loss_fn: PhysicsInformedLoss,
        checkpoint_dir: str = "./checkpoints",
        device: str | None = None,
        norm_params: dict[str, dict[str, np.ndarray]] | None = None,
        use_amp: bool = True,
        grad_accum_steps: int = 1,
        feature_noise_std: float = 0.02,
    ):
        self.model = model
        self.loss_fn = loss_fn
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)

        if device is None:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            self.device = device

        self.model = self.model.to(self.device)
        self.loss_fn = self.loss_fn.to(self.device)
        self.norm_params = norm_params
        self.use_amp = bool(use_amp and self.device == "cuda")
        self.grad_accum_steps = max(1, grad_accum_steps)
        self.feature_noise_std = feature_noise_std
        self.scaler = torch.amp.GradScaler("cuda", enabled=self.use_amp)
        logger.info("Trainer using device: %s", self.device)
        if self.use_amp:
            logger.info("AMP mixed precision enabled (fp16)")
        if self.grad_accum_steps > 1:
            logger.info("Gradient accumulation: %d steps (effective batch ×%d)", self.grad_accum_steps, self.grad_accum_steps)

    def _autocast_ctx(self):
        if self.use_amp:
            return torch.autocast(device_type="cuda", dtype=torch.float16)
        return nullcontext()

    def train(
        self,
        train_sequences: list,
        val_sequences: list,
        config: ModelConfig | None = None,
        early_stopping_patience: int = 10,
        require_benchmark_comparison: bool = True,
        use_cosine_lr: bool = True,
    ) -> dict:
        """Full training loop.

        Returns:
            Training history dict with per-epoch metrics.
        """
        cfg = config or self.model.config
        optimizer = optim.Adam(
            self.model.parameters(),
            lr=cfg.learning_rate,
            weight_decay=cfg.weight_decay,
        )
        # Cosine annealing decays LR smoothly to eta_min over all epochs,
        # finding sharper minima than reactive ReduceLROnPlateau.
        # ReduceLROnPlateau is kept as fallback when use_cosine_lr=False.
        if use_cosine_lr:
            # Warmup for 5 epochs then cosine decay — protects zero-init heads
            warmup_epochs = min(5, cfg.max_epochs // 10)
            scheduler = optim.lr_scheduler.SequentialLR(
                optimizer,
                schedulers=[
                    optim.lr_scheduler.LinearLR(optimizer, start_factor=0.1, total_iters=warmup_epochs),
                    optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=cfg.max_epochs - warmup_epochs, eta_min=1e-6),
                ],
                milestones=[warmup_epochs],
            )
        else:
            scheduler = optim.lr_scheduler.ReduceLROnPlateau(
                optimizer, mode="min", factor=0.5, patience=5, min_lr=1e-6
            )

        train_dataset = ClimateSequenceDataset(train_sequences)
        val_dataset = ClimateSequenceDataset(val_sequences)

        train_loader = DataLoader(
            train_dataset,
            batch_size=cfg.batch_size,
            shuffle=True,
            collate_fn=_collate_sequences,
            num_workers=0,
            pin_memory=self.device == "cuda",
        )
        val_loader = DataLoader(
            val_dataset,
            batch_size=cfg.batch_size,
            shuffle=False,
            collate_fn=_collate_sequences,
            num_workers=0,
        )

        history = {
            "train_loss": [],
            "val_loss": [],
            "val_r2": [],
            "epochs": [],
            "benchmark_metrics": [],
        }
        best_val_loss = float("inf")
        patience_counter = 0
        best_checkpoint = self.checkpoint_dir / "vayu_best.pt"

        for epoch in range(1, cfg.max_epochs + 1):
            t0 = time.time()
            train_loss = self._train_epoch(train_loader, optimizer)
            val_loss, val_metrics = self._eval_epoch(val_loader)

            if require_benchmark_comparison:
                benchmark_keys = {
                    "skill_vs_persistence_rain",
                    "skill_vs_persistence_tmax",
                    "skill_vs_persistence_tmin",
                    "skill_vs_climatology_rain",
                    "skill_vs_climatology_tmax",
                    "skill_vs_climatology_tmin",
                }
                missing = sorted(k for k in benchmark_keys if k not in val_metrics)
                if missing:
                    raise RuntimeError(
                        "Benchmark comparison is mandatory; missing metrics: "
                        + ", ".join(missing)
                    )

            if use_cosine_lr:
                scheduler.step()
            else:
                scheduler.step(val_loss)
            elapsed = time.time() - t0

            history["train_loss"].append(train_loss)
            history["val_loss"].append(val_loss)
            history["val_r2"].append(val_metrics.get("r2_tmax", float("nan")))
            history["epochs"].append(epoch)
            history["benchmark_metrics"].append(val_metrics)

            logger.info(
                "Epoch %3d/%d | train_loss=%.4f | val_loss=%.4f | "
                "R²_tmax=%.3f | R²_rain=%.3f | %.1fs",
                epoch, cfg.max_epochs, train_loss, val_loss,
                val_metrics.get("r2_tmax", 0), val_metrics.get("r2_rain", 0), elapsed,
            )

            # Checkpoint best model
            if val_loss < best_val_loss:
                best_val_loss = val_loss
                patience_counter = 0
                self.model.save(str(best_checkpoint), extra={"epoch": epoch, "val_loss": val_loss})
                logger.info("  ✓ New best checkpoint saved (val_loss=%.4f)", val_loss)

                # Resilience: also copy to /kaggle/working/ root so output survives cancellation.
                # On Kaggle, files at the root of /kaggle/working/ are preserved even if
                # the notebook run is cancelled mid-way. Go to Versions → Output tab.
                kaggle_root = Path("/kaggle/working")
                if kaggle_root.exists():
                    import shutil as _shutil
                    _dst = kaggle_root / "vayu_best.pt"
                    _shutil.copy2(str(best_checkpoint), str(_dst))
                    logger.debug("  Resilience copy → %s", _dst)
            else:
                patience_counter += 1

            # Early stopping
            if patience_counter >= early_stopping_patience:
                logger.info("Early stopping after %d epochs without improvement", epoch)
                break

        # Save history
        history_path = self.checkpoint_dir / "training_history.json"
        with open(history_path, "w") as f:
            json.dump(_json_safe(history), f, indent=2)

        # Every experiment writes benchmark comparison report.
        benchmark_report = {
            "best_val_loss": best_val_loss,
            "latest_validation_metrics": history["benchmark_metrics"][-1] if history["benchmark_metrics"] else {},
            "num_epochs": len(history["epochs"]),
        }
        report_path = self.checkpoint_dir / "benchmark_report.json"
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(_json_safe(benchmark_report), f, indent=2)

        logger.info("Training complete. Best val_loss=%.4f", best_val_loss)
        return history

    def _train_epoch(self, loader: DataLoader, optimizer: optim.Optimizer) -> float:
        """Single training epoch with optional gradient accumulation.

        Gradients are accumulated over ``self.grad_accum_steps`` data-loader
        steps before the optimiser is stepped, giving an effective batch size
        of ``batch_size × grad_accum_steps`` without extra VRAM cost.
        """
        self.model.train()
        total_loss = 0.0
        n_batches = 0
        optimizer.zero_grad(set_to_none=True)
        n_loader = len(loader)

        for step, (graph_batch, targets) in enumerate(loader):
            # Process each sequence in the DataLoader batch independently
            batch_loss: torch.Tensor | None = None
            batch_size = targets.shape[0]

            for b in range(batch_size):
                g_x = graph_batch.x[b].to(self.device)
                # Feature noise augmentation: small Gaussian noise on every input
                # feature during training. Acts like input-level dropout, preventing
                # the model from memorising specific sequence patterns.
                if self.feature_noise_std > 0.0:
                    g_x = g_x + torch.randn_like(g_x) * self.feature_noise_std
                g = GraphData(
                    x=g_x,
                    edge_index=graph_batch.edge_index.to(self.device),
                    edge_attr=graph_batch.edge_attr.to(self.device),
                )
                target = targets[b].to(self.device)  # (horizon, num_nodes, 3)

                with self._autocast_ctx():
                    preds = self.model(g, mc_dropout=False)
                # Loss computed in fp32 to prevent overflow in focal/power terms
                preds_fp32 = {k: v.float() for k, v in preds.items()}
                loss_dict = self.loss_fn(preds_fp32, target.float(), g.edge_index)
                loss_val = loss_dict["total_loss"]

                batch_loss = (batch_loss + loss_val) if batch_loss is not None else loss_val

            assert batch_loss is not None
            # Normalise by both batch size and accumulation window so that the
            # effective learning signal is independent of grad_accum_steps.
            batch_loss = batch_loss / (batch_size * self.grad_accum_steps)

            if self.use_amp:
                self.scaler.scale(batch_loss).backward()
            else:
                batch_loss.backward()

            # Track loss as if accumulation hadn't happened (consistent scale)
            total_loss += batch_loss.item() * self.grad_accum_steps
            n_batches += 1

            is_last = (step + 1) == n_loader
            if (step + 1) % self.grad_accum_steps == 0 or is_last:
                if self.use_amp:
                    self.scaler.unscale_(optimizer)
                    torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
                    self.scaler.step(optimizer)
                    self.scaler.update()
                else:
                    torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
                    optimizer.step()
                optimizer.zero_grad(set_to_none=True)

        return total_loss / max(n_batches, 1)

    @torch.no_grad()
    def _eval_epoch(self, loader: DataLoader) -> tuple[float, dict]:
        """Evaluation epoch. Returns (mean_loss, metrics_dict)."""
        self.model.eval()
        total_loss = 0.0
        n_batches = 0
        all_preds: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}
        all_targets: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}
        all_persistence: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}
        all_climatology: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}
        all_preds_denorm: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}
        all_targets_denorm: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}
        all_persistence_denorm: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}
        all_climatology_denorm: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}

        reg_names = [r for r in available_regions() if r != "pilot"]
        reg_preds = {r: {"rainfall": [], "temp_max": [], "temp_min": []} for r in reg_names}
        reg_targets = {r: {"rainfall": [], "temp_max": [], "temp_min": []} for r in reg_names}

        for graph_batch, targets in loader:
            batch_size = targets.shape[0]
            for b in range(batch_size):
                g = GraphData(
                    x=graph_batch.x[b].to(self.device),
                    edge_index=graph_batch.edge_index.to(self.device),
                    edge_attr=graph_batch.edge_attr.to(self.device),
                )
                if hasattr(graph_batch, "pos") and graph_batch.pos is not None:
                    g.pos = graph_batch.pos
                target = targets[b].to(self.device)
                with self._autocast_ctx():
                    preds = self.model(g)
                # Loss in fp32 (same as training) to avoid BCE autocast error
                preds_fp32 = {k: v.float() for k, v in preds.items()}
                loss_dict = self.loss_fn(preds_fp32, target.float(), g.edge_index)
                total_loss += loss_dict["total_loss"].item()
                n_batches += 1

                baselines = _baseline_from_input(g, horizon=target.shape[0])
                pos = getattr(g, "pos", None)
                node_latlon = pos.detach().cpu().numpy() if pos is not None else None
                region_masks: dict[str, np.ndarray] = {}
                if node_latlon is not None:
                    for reg in reg_names:
                        region_masks[reg] = region_mask(node_latlon, reg)

                # Collect predictions for metric computation
                for v_idx, var in enumerate(["rainfall", "temp_max", "temp_min"]):
                    p_2d = preds[var].cpu().numpy()  # (num_nodes, horizon)
                    t_2d = target[..., v_idx].cpu().numpy().transpose(1, 0)  # (num_nodes, horizon)
                    p = p_2d.ravel()
                    t = t_2d.ravel()
                    all_preds[var].append(p)
                    all_targets[var].append(t)
                    all_persistence[var].append(baselines[f"persistence_{var}"].ravel())
                    all_climatology[var].append(baselines[f"climatology_{var}"].ravel())

                    for reg, mask in region_masks.items():
                        if mask.any():
                            reg_preds[reg][var].append(p_2d[mask, :].ravel())
                            reg_targets[reg][var].append(t_2d[mask, :].ravel())

                    if self.norm_params and var in self.norm_params:
                        mean_grid = self.norm_params[var]["mean"]
                        std_grid = self.norm_params[var]["std"]
                        p_denorm = _denormalize_grid(p_2d, mean_grid, std_grid)
                        t_denorm = _denormalize_grid(t_2d, mean_grid, std_grid)
                        persist_denorm = _denormalize_grid(
                            baselines[f"persistence_{var}"], mean_grid, std_grid
                        )
                        clim_denorm = _denormalize_grid(
                            baselines[f"climatology_{var}"], mean_grid, std_grid
                        )
                        all_preds_denorm[var].append(p_denorm.ravel())
                        all_targets_denorm[var].append(t_denorm.ravel())
                        all_persistence_denorm[var].append(persist_denorm.ravel())
                        all_climatology_denorm[var].append(clim_denorm.ravel())

        # Compute R² per variable
        metrics = {}
        var_short = {"rainfall": "rain", "temp_max": "tmax", "temp_min": "tmin"}
        for var, short in var_short.items():
            p = np.concatenate(all_preds[var])
            t = np.concatenate(all_targets[var])
            p_persist = np.concatenate(all_persistence[var])
            p_clim = np.concatenate(all_climatology[var])
            metrics[f"r2_{short}"] = _r2_score(p, t)
            metrics[f"rmse_{short}"] = float(np.sqrt(np.nanmean((p - t) ** 2)))
            metrics[f"mae_{short}"] = float(np.nanmean(np.abs(p - t)))
            metrics[f"skill_vs_persistence_{short}"] = _skill_score(p, t, p_persist)
            metrics[f"skill_vs_climatology_{short}"] = _skill_score(p, t, p_clim)

            if all_preds_denorm[var]:
                pdn = np.concatenate(all_preds_denorm[var])
                tdn = np.concatenate(all_targets_denorm[var])
                pdn_persist = np.concatenate(all_persistence_denorm[var])
                pdn_clim = np.concatenate(all_climatology_denorm[var])
                metrics[f"r2_denorm_{short}"] = _r2_score(pdn, tdn)
                metrics[f"rmse_denorm_{short}"] = float(np.sqrt(np.nanmean((pdn - tdn) ** 2)))
                metrics[f"mae_denorm_{short}"] = float(np.nanmean(np.abs(pdn - tdn)))
                metrics[f"skill_vs_persistence_denorm_{short}"] = _skill_score(pdn, tdn, pdn_persist)
                metrics[f"skill_vs_climatology_denorm_{short}"] = _skill_score(pdn, tdn, pdn_clim)

            for reg in reg_names:
                if reg_preds[reg][var]:
                    rp = np.concatenate(reg_preds[reg][var])
                    rt = np.concatenate(reg_targets[reg][var])
                    metrics[f"r2_{short}_{reg}"] = _r2_score(rp, rt)
                    metrics[f"rmse_{short}_{reg}"] = float(np.sqrt(np.nanmean((rp - rt) ** 2)))
                    metrics[f"mae_{short}_{reg}"] = float(np.nanmean(np.abs(rp - rt)))

        return total_loss / max(n_batches, 1), metrics

    @torch.no_grad()
    def evaluate_test_set(
        self,
        test_sequences: list,
        climatology_sequences: list | None = None,
    ) -> dict:
        """Full evaluation on the test set with all metrics.

        Returns:
            Dict with R², RMSE, MAE, and skill score per variable.
        """
        test_dataset = ClimateSequenceDataset(test_sequences)
        test_loader = DataLoader(
            test_dataset, batch_size=1, collate_fn=_collate_sequences
        )
        self.model.eval()

        all_preds: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}
        all_targets: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}
        all_persistence: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}
        all_climatology: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}
        all_preds_denorm: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}
        all_targets_denorm: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}
        all_persistence_denorm: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}
        all_climatology_denorm: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}

        reg_names = [r for r in available_regions() if r != "pilot"]
        reg_preds = {r: {"rainfall": [], "temp_max": [], "temp_min": []} for r in reg_names}
        reg_targets = {r: {"rainfall": [], "temp_max": [], "temp_min": []} for r in reg_names}

        for graph_batch, targets in test_loader:
            g = GraphData(
                x=graph_batch.x[0].to(self.device),
                edge_index=graph_batch.edge_index.to(self.device),
                edge_attr=graph_batch.edge_attr.to(self.device),
            )
            if hasattr(graph_batch, "pos") and graph_batch.pos is not None:
                g.pos = graph_batch.pos
            target = targets[0].to(self.device)
            with self._autocast_ctx():
                preds = self.model(g)
            baselines = _baseline_from_input(g, horizon=target.shape[0])
            pos = getattr(g, "pos", None)
            node_latlon = pos.detach().cpu().numpy() if pos is not None else None
            region_masks: dict[str, np.ndarray] = {}
            if node_latlon is not None:
                for reg in reg_names:
                    region_masks[reg] = region_mask(node_latlon, reg)
            for v_idx, var in enumerate(["rainfall", "temp_max", "temp_min"]):
                p_2d = preds[var].cpu().numpy()
                t_2d = target[..., v_idx].cpu().numpy().transpose(1, 0)
                all_preds[var].append(p_2d.ravel())
                all_targets[var].append(t_2d.ravel())
                all_persistence[var].append(baselines[f"persistence_{var}"].ravel())
                all_climatology[var].append(baselines[f"climatology_{var}"].ravel())

                for reg, mask in region_masks.items():
                    if mask.any():
                        reg_preds[reg][var].append(p_2d[mask, :].ravel())
                        reg_targets[reg][var].append(t_2d[mask, :].ravel())

                if self.norm_params and var in self.norm_params:
                    mean_grid = self.norm_params[var]["mean"]
                    std_grid = self.norm_params[var]["std"]
                    all_preds_denorm[var].append(_denormalize_grid(p_2d, mean_grid, std_grid).ravel())
                    all_targets_denorm[var].append(_denormalize_grid(t_2d, mean_grid, std_grid).ravel())
                    all_persistence_denorm[var].append(
                        _denormalize_grid(baselines[f"persistence_{var}"], mean_grid, std_grid).ravel()
                    )
                    all_climatology_denorm[var].append(
                        _denormalize_grid(baselines[f"climatology_{var}"], mean_grid, std_grid).ravel()
                    )

        results = {}
        for var in ["rainfall", "temp_max", "temp_min"]:
            p = np.concatenate(all_preds[var])
            t = np.concatenate(all_targets[var])
            p_persist = np.concatenate(all_persistence[var])
            p_clim = np.concatenate(all_climatology[var])
            results[var] = {
                "r2": _r2_score(p, t),
                "rmse": float(np.sqrt(np.nanmean((p - t) ** 2))),
                "mae": float(np.nanmean(np.abs(p - t))),
                "skill_vs_persistence": _skill_score(p, t, p_persist),
                "skill_vs_climatology": _skill_score(p, t, p_clim),
            }
            for reg in reg_names:
                if reg_preds[reg][var]:
                    rp = np.concatenate(reg_preds[reg][var])
                    rt = np.concatenate(reg_targets[reg][var])
                    results[var][f"r2_{reg}"] = _r2_score(rp, rt)
                    results[var][f"rmse_{reg}"] = float(np.sqrt(np.nanmean((rp - rt) ** 2)))
                    results[var][f"mae_{reg}"] = float(np.nanmean(np.abs(rp - rt)))

            if all_preds_denorm[var]:
                pdn = np.concatenate(all_preds_denorm[var])
                tdn = np.concatenate(all_targets_denorm[var])
                pdn_persist = np.concatenate(all_persistence_denorm[var])
                pdn_clim = np.concatenate(all_climatology_denorm[var])
                results[var]["r2_denorm"] = _r2_score(pdn, tdn)
                results[var]["rmse_denorm"] = float(np.sqrt(np.nanmean((pdn - tdn) ** 2)))
                results[var]["mae_denorm"] = float(np.nanmean(np.abs(pdn - tdn)))
                results[var]["skill_vs_persistence_denorm"] = _skill_score(pdn, tdn, pdn_persist)
                results[var]["skill_vs_climatology_denorm"] = _skill_score(pdn, tdn, pdn_clim)
            logger.info(
                "Test %s: R²=%.3f, RMSE=%.3f, MAE=%.3f, Skill(persist)=%.3f, Skill(clim)=%.3f",
                var, results[var]["r2"], results[var]["rmse"],
                results[var]["mae"],
                results[var]["skill_vs_persistence"],
                results[var]["skill_vs_climatology"],
            )

        return results


def train_cli() -> None:
    """CLI entry point: vayu-train."""
    import typer
    app = typer.Typer()

    @app.command()
    def main(
        data_dir: str = typer.Option("./data/processed", help="Processed data directory"),
        checkpoint_dir: str = typer.Option("./checkpoints", help="Checkpoint output directory"),
        epochs: int = typer.Option(100, help="Max training epochs"),
        device: str = typer.Option("auto", help="Device: cuda/cpu/auto"),
        batch_size: int = typer.Option(16, help="Batch size"),
        kaggle_lite: bool = typer.Option(
            False,
            help="Use a lower-memory model preset suitable for Kaggle T4 full-India runs",
        ),
        kaggle_medium: bool = typer.Option(
            False,
            help="Balanced preset for T4 with 128+ sequences: larger than lite, fits VRAM",
        ),
        gnn_hidden_dim: int | None = typer.Option(None, help="Override GNN hidden dimension"),
        gnn_num_layers: int | None = typer.Option(None, help="Override GNN layer count"),
        transformer_d_model: int | None = typer.Option(None, help="Override transformer model dimension"),
        transformer_nhead: int | None = typer.Option(None, help="Override transformer attention heads"),
        transformer_num_layers: int | None = typer.Option(None, help="Override transformer layer count"),
        transformer_dim_feedforward: int | None = typer.Option(None, help="Override transformer feed-forward dimension"),
        lambda_smoothness: float | None = typer.Option(None, help="Override smoothness loss weight"),
        lambda_conservation: float | None = typer.Option(None, help="Override mass-conservation loss weight"),
        weight_decay: float | None = typer.Option(None, help="Override Adam weight decay (default 1e-5; try 1e-4 for more regularization)"),
        gnn_dropout: float | None = typer.Option(None, help="Override GNN dropout rate (default 0.1)"),
        early_stopping_patience: int = typer.Option(10, help="Epochs without val_loss improvement before stopping"),
        cosine_lr: bool = typer.Option(True, "--cosine-lr/--no-cosine-lr",
            help="Use cosine annealing LR schedule (recommended). Disable for ReduceLROnPlateau."),
        norm_params_file: str | None = typer.Option(
            None,
            help="Path to norm_params_YYYY-YYYY.nc for denormalized physical metrics",
        ),
        smoke_only: bool = typer.Option(
            False,
            help="Run forward-only smoke validation without backprop",
        ),
        force_backprop: bool = typer.Option(
            False,
            help="Force full training even on known unstable local runtimes",
        ),
        require_benchmarks: bool = typer.Option(
            True,
            help="Require persistence and climatology benchmark comparisons for every experiment",
        ),
        run_baselines: bool = typer.Option(
            False,
            help="Run classical baseline suite (persistence, climatology, RF, XGBoost)",
        ),
        baseline_report_file: str = typer.Option(
            "baseline_benchmark_report.json",
            help="Output filename for baseline suite report inside checkpoint directory",
        ),
        amp: bool = typer.Option(
            True,
            "--amp/--no-amp",
            help="Enable mixed precision on CUDA to reduce VRAM usage",
        ),
        grad_accum_steps: int = typer.Option(
            1,
            help="Accumulate gradients over N batches before stepping the optimiser "
                 "(effective batch = batch_size × N, no extra VRAM cost).",
        ),
        rain_weight: float | None = typer.Option(
            None,
            help="Override rainfall loss weight (default 1.8). Raise for flood/monsoon "
                 "priority regions (Western Ghats, North-East India, Central India); "
                 "literature: arXiv:2509.23267, arXiv:2605.30122, arXiv:2402.01295.",
        ),
        tmax_weight: float | None = typer.Option(
            None,
            help="Override temp_max loss weight (default 1.6). Raise for heat-extreme "
                 "priority regions (Indo-Gangetic Plain); literature: arXiv:2205.10972.",
        ),
        tmin_weight: float | None = typer.Option(
            None,
            help="Override temp_min loss weight (default 1.2).",
        ),
        grid_unet: bool = typer.Option(
            False,
            help="Use VayuGridClimateModel (compact U-Net spatial encoder over the "
                 "regular lat/lon grid) instead of the default GraphSAGE encoder. "
                 "See research/ARCHITECTURE_VALIDATION.md. Requires nlat/nlon to be "
                 "auto-detected from the normalized dataset's grid shape.",
        ),
    ):
        """Train VayuClimateModel on preprocessed IMD data."""
        import logging
        logging.basicConfig(level=logging.INFO)

        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"

        if device == "cpu":
            # Conservative runtime defaults reduce native threading instability on Windows.
            torch.set_num_threads(1)
            try:
                torch.set_num_interop_threads(1)
            except RuntimeError:
                pass

        py_version = tuple(int(v) for v in platform.python_version_tuple()[:2])
        known_unstable_cpu = (
            platform.system() == "Windows"
            and py_version >= (3, 13)
            and device == "cpu"
        )
        known_unstable_cuda = (
            platform.system() == "Windows"
            and py_version >= (3, 13)
            and device == "cuda"
        )

        if known_unstable_cpu and not force_backprop and not smoke_only:
            logger.warning(
                "Detected Windows + Python %s + CPU runtime; defaulting to smoke-only "
                "to avoid known native backward crashes. Use --force-backprop to override.",
                platform.python_version(),
            )
            smoke_only = True

        if known_unstable_cuda and not force_backprop and not smoke_only:
            logger.warning(
                "Detected Windows + Python %s + CUDA runtime. Native backward crashes are "
                "known on this platform (access violation in CUDA stream sync). "
                "Training may silently exit after the first epoch. "
                "Use Kaggle/Colab for reliable GPU training, or --force-backprop to skip this warning.",
                platform.python_version(),
            )

        logger.info("Loading training sequences from %s…", data_dir)
        # In production: load from disk
        # sequences = torch.load(f"{data_dir}/train_sequences.pt")

        if device == "cuda":
            # Reduces allocator fragmentation spikes on long attention runs.
            os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

        config_kwargs: dict = {
            "max_epochs": epochs,
            "batch_size": batch_size,
        }

        # Auto-detect feature count from sequences to handle legacy 11-feat datasets
        train_sequences_pre, _, source_pre = _load_or_build_sequences(data_dir, ModelConfig(**config_kwargs))
        if train_sequences_pre:
            actual_features = train_sequences_pre[0][0].x.shape[-1]
            config_kwargs["gnn_in_features"] = actual_features
            logger.info("Auto-detected %d input features from sequences", actual_features)
            del train_sequences_pre  # free memory

        if kaggle_lite:
            # Smallest architecture preset: fits T4 with any sequence count.
            # Physics constraints are kept ON — they cost no VRAM.
            config_kwargs.update(
                {
                    "gnn_hidden_dim": 64,
                    "gnn_num_layers": 2,
                    "transformer_d_model": 96,
                    "transformer_nhead": 4,
                    "transformer_num_layers": 2,
                    "transformer_dim_feedforward": 192,
                    "batch_size": min(batch_size, 1),
                }
            )

        if kaggle_medium:
            # Balanced architecture preset: ~475K params, fits T4 with bs=1+AMP.
            # Physics constraints are kept ON — they cost no VRAM.
            config_kwargs.update(
                {
                    "gnn_hidden_dim": 96,
                    "gnn_num_layers": 2,
                    "transformer_d_model": 128,
                    "transformer_nhead": 4,
                    "transformer_num_layers": 3,
                    "transformer_dim_feedforward": 256,
                    "batch_size": min(batch_size, 1),
                }
            )

        if config_kwargs.get("batch_size") == 0:
            config_kwargs["batch_size"] = 1

        if gnn_hidden_dim is not None:
            config_kwargs["gnn_hidden_dim"] = gnn_hidden_dim
        if gnn_num_layers is not None:
            config_kwargs["gnn_num_layers"] = gnn_num_layers
        if transformer_d_model is not None:
            config_kwargs["transformer_d_model"] = transformer_d_model
        if transformer_nhead is not None:
            config_kwargs["transformer_nhead"] = transformer_nhead
        if transformer_num_layers is not None:
            config_kwargs["transformer_num_layers"] = transformer_num_layers
        if transformer_dim_feedforward is not None:
            config_kwargs["transformer_dim_feedforward"] = transformer_dim_feedforward
        if lambda_smoothness is not None:
            config_kwargs["lambda_smoothness"] = lambda_smoothness
        if lambda_conservation is not None:
            config_kwargs["lambda_conservation"] = lambda_conservation
        if weight_decay is not None:
            config_kwargs["weight_decay"] = weight_decay
        if gnn_dropout is not None:
            config_kwargs["gnn_dropout"] = gnn_dropout

        config = ModelConfig(**config_kwargs)

        if grid_unet:
            manifest_path = Path(data_dir) / "sequence_manifest.json"
            if not manifest_path.exists():
                raise FileNotFoundError(
                    f"--grid-unet requires {manifest_path} to auto-detect nlat/nlon "
                    "(written by data_ingestion.cli build-sequences)."
                )
            grid_info = json.loads(manifest_path.read_text(encoding="utf-8"))["grid"]
            nlat, nlon = grid_info["lat"], grid_info["lon"]
            logger.info("Grid-UNet mode: auto-detected grid %dx%d from %s", nlat, nlon, manifest_path)
            model = VayuGridClimateModel(config, nlat=nlat, nlon=nlon)
        else:
            model = VayuClimateModel(config)

        variable_weights = None
        if rain_weight is not None or tmax_weight is not None or tmin_weight is not None:
            from .loss_functions import VARIABLE_WEIGHTS as _DEFAULT_WEIGHTS
            variable_weights = dict(_DEFAULT_WEIGHTS)
            if rain_weight is not None:
                variable_weights["rainfall"] = rain_weight
            if tmax_weight is not None:
                variable_weights["temp_max"] = tmax_weight
            if tmin_weight is not None:
                variable_weights["temp_min"] = tmin_weight
            logger.info("Per-region variable weight override: %s", variable_weights)

        loss_fn = PhysicsInformedLoss(
            lambda_conservation=config.lambda_conservation,
            lambda_smoothness=config.lambda_smoothness,
            variable_weights=variable_weights,
        )
        norm_params = _load_norm_params_file(norm_params_file)
        trainer = VayuTrainer(
            model,
            loss_fn,
            checkpoint_dir,
            device=device,
            norm_params=norm_params,
            use_amp=amp,
            grad_accum_steps=grad_accum_steps,
        )

        train_sequences, val_sequences, source = _load_or_build_sequences(data_dir, config)
        logger.info(
            "Loaded %d train and %d val sequences (%s)",
            len(train_sequences),
            len(val_sequences),
            source,
        )

        # Derive the Western Ghats ridge mask from real node lat/lon so it is
        # geographically WG-only and automatically empty for other regions.
        if train_sequences:
            probe_graph = train_sequences[0][0]
            probe_pos = getattr(probe_graph, "pos", None)
            if probe_pos is not None:
                from ai_engine.regions import region_mask as _region_mask
                node_latlon = probe_pos.detach().cpu().numpy()
                wg_mask_np = _region_mask(node_latlon, "western_ghats") & (
                    (node_latlon[:, 1] >= 73.0) & (node_latlon[:, 1] <= 74.5)
                )
                if wg_mask_np.any():
                    mask_tensor = torch.tensor(wg_mask_np, dtype=torch.bool, device=trainer.device)
                    if "ghats_ridge_mask" in dict(loss_fn.named_buffers()):
                        loss_fn.ghats_ridge_mask = mask_tensor
                    else:
                        # Plain-attribute None set in __init__ must be cleared before
                        # register_buffer, which rejects names already bound as attributes.
                        del loss_fn.ghats_ridge_mask
                        loss_fn.register_buffer("ghats_ridge_mask", mask_tensor)
                    logger.info(
                        "Ghats ridge smoothness exemption active: %d/%d nodes (WG-only)",
                        int(wg_mask_np.sum()), len(wg_mask_np),
                    )

        if run_baselines:
            logger.info("Running classical baseline suite...")
            baseline_report = run_baseline_suite(train_sequences, val_sequences)
            out_path = Path(checkpoint_dir) / baseline_report_file
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(json.dumps(_json_safe(baseline_report), indent=2), encoding="utf-8")
            logger.info("Saved baseline benchmark report: %s", out_path)

        if smoke_only:
            logger.info("Starting smoke-only validation (device=%s)…", device)
            _run_smoke_forward(model, loss_fn, train_sequences, device, checkpoint_dir)
            return

        logger.info("Starting training (device=%s)…", device)
        trainer.train(
            train_sequences,
            val_sequences,
            config,
            early_stopping_patience=early_stopping_patience,
            require_benchmark_comparison=require_benchmarks,
            use_cosine_lr=cosine_lr,
        )

        test_path = Path(data_dir) / "test_sequences.pt"
        if test_path.exists():
            logger.info("Evaluating held-out test set: %s", test_path)
            test_sequences = torch.load(test_path, map_location="cpu", weights_only=False)
            best_checkpoint = Path(checkpoint_dir) / "vayu_best.pt"
            if best_checkpoint.exists():
                trainer.model = VayuClimateModel.load(str(best_checkpoint), device=trainer.device)
                trainer.model = trainer.model.to(trainer.device)
            test_results = trainer.evaluate_test_set(test_sequences)
            test_report_path = Path(checkpoint_dir) / "test_report.json"
            test_report_path.write_text(json.dumps(_json_safe(test_results), indent=2), encoding="utf-8")
            logger.info("Saved held-out test report: %s", test_report_path)
        else:
            logger.warning(
                "No test_sequences.pt found in %s; skipping held-out test evaluation.", data_dir
            )

    app()


if __name__ == "__main__":
    train_cli()

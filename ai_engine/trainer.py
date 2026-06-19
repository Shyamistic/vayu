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
from pathlib import Path
from typing import Generator

import numpy as np
import torch
import torch.optim as optim
import xarray as xr
from torch.utils.data import DataLoader, Dataset
from torch_geometric.data import Data as GraphData

from .climate_model import VayuClimateModel
from .config import DataSplit, ModelConfig
from .loss_functions import PhysicsInformedLoss
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


class VayuTrainer:
    """Training and evaluation harness for VayuClimateModel."""

    def __init__(
        self,
        model: VayuClimateModel,
        loss_fn: PhysicsInformedLoss,
        checkpoint_dir: str = "./checkpoints",
        device: str | None = None,
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
        logger.info("Trainer using device: %s", self.device)

    def train(
        self,
        train_sequences: list,
        val_sequences: list,
        config: ModelConfig | None = None,
        early_stopping_patience: int = 10,
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

        history = {"train_loss": [], "val_loss": [], "val_r2": [], "epochs": []}
        best_val_loss = float("inf")
        patience_counter = 0
        best_checkpoint = self.checkpoint_dir / "vayu_best.pt"

        for epoch in range(1, cfg.max_epochs + 1):
            t0 = time.time()
            train_loss = self._train_epoch(train_loader, optimizer)
            val_loss, val_metrics = self._eval_epoch(val_loader)

            scheduler.step(val_loss)
            elapsed = time.time() - t0

            history["train_loss"].append(train_loss)
            history["val_loss"].append(val_loss)
            history["val_r2"].append(val_metrics.get("r2_tmax", float("nan")))
            history["epochs"].append(epoch)

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

        logger.info("Training complete. Best val_loss=%.4f", best_val_loss)
        return history

    def _train_epoch(self, loader: DataLoader, optimizer: optim.Optimizer) -> float:
        """Single training epoch. Returns mean total loss."""
        self.model.train()
        total_loss = 0.0
        n_batches = 0

        for graph_batch, targets in loader:
            # Handle batched x: (batch, num_nodes, seq_len, features)
            # For simplicity, process each sample in the batch independently
            batch_loss = torch.tensor(0.0, device=self.device)
            batch_size = targets.shape[0]

            for b in range(batch_size):
                g = GraphData(
                    x=graph_batch.x[b].to(self.device),
                    edge_index=graph_batch.edge_index.to(self.device),
                    edge_attr=graph_batch.edge_attr.to(self.device),
                )
                target = targets[b].to(self.device)  # (horizon, num_nodes, 3)

                preds = self.model(g, mc_dropout=False)
                loss_dict = self.loss_fn(preds, target, g.edge_index)
                batch_loss = batch_loss + loss_dict["total_loss"]

            batch_loss = batch_loss / batch_size
            optimizer.zero_grad(set_to_none=True)
            batch_loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
            optimizer.step()

            total_loss += batch_loss.item()
            n_batches += 1

        return total_loss / max(n_batches, 1)

    @torch.no_grad()
    def _eval_epoch(self, loader: DataLoader) -> tuple[float, dict]:
        """Evaluation epoch. Returns (mean_loss, metrics_dict)."""
        self.model.eval()
        total_loss = 0.0
        n_batches = 0
        all_preds: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}
        all_targets: dict[str, list] = {"rainfall": [], "temp_max": [], "temp_min": []}

        for graph_batch, targets in loader:
            batch_size = targets.shape[0]
            for b in range(batch_size):
                g = GraphData(
                    x=graph_batch.x[b].to(self.device),
                    edge_index=graph_batch.edge_index.to(self.device),
                    edge_attr=graph_batch.edge_attr.to(self.device),
                )
                target = targets[b].to(self.device)
                preds = self.model(g)
                loss_dict = self.loss_fn(preds, target, g.edge_index)
                total_loss += loss_dict["total_loss"].item()
                n_batches += 1

                # Collect predictions for metric computation
                for v_idx, var in enumerate(["rainfall", "temp_max", "temp_min"]):
                    p = preds[var].cpu().numpy().ravel()  # (num_nodes * horizon,)
                    t = target[..., v_idx].cpu().numpy().ravel()
                    all_preds[var].append(p)
                    all_targets[var].append(t)

        # Compute R² per variable
        metrics = {}
        var_short = {"rainfall": "rain", "temp_max": "tmax", "temp_min": "tmin"}
        for var, short in var_short.items():
            p = np.concatenate(all_preds[var])
            t = np.concatenate(all_targets[var])
            metrics[f"r2_{short}"] = _r2_score(p, t)
            metrics[f"rmse_{short}"] = float(np.sqrt(np.nanmean((p - t) ** 2)))
            metrics[f"mae_{short}"] = float(np.nanmean(np.abs(p - t)))

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

        for graph_batch, targets in test_loader:
            g = GraphData(
                x=graph_batch.x[0].to(self.device),
                edge_index=graph_batch.edge_index.to(self.device),
                edge_attr=graph_batch.edge_attr.to(self.device),
            )
            target = targets[0].to(self.device)
            preds = self.model(g)
            for v_idx, var in enumerate(["rainfall", "temp_max", "temp_min"]):
                all_preds[var].append(preds[var].cpu().numpy().ravel())
                all_targets[var].append(target[..., v_idx].cpu().numpy().ravel())

        results = {}
        for var in ["rainfall", "temp_max", "temp_min"]:
            p = np.concatenate(all_preds[var])
            t = np.concatenate(all_targets[var])
            # Use mean as a simple climatology baseline
            clim = np.full_like(t, np.nanmean(t))
            results[var] = {
                "r2": _r2_score(p, t),
                "rmse": float(np.sqrt(np.nanmean((p - t) ** 2))),
                "mae": float(np.nanmean(np.abs(p - t))),
                "skill_score": _skill_score(p, t, clim),
            }
            logger.info(
                "Test %s: R²=%.3f, RMSE=%.3f, MAE=%.3f, Skill=%.3f",
                var, results[var]["r2"], results[var]["rmse"],
                results[var]["mae"], results[var]["skill_score"],
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
        gnn_hidden_dim: int | None = typer.Option(None, help="Override GNN hidden dimension"),
        gnn_num_layers: int | None = typer.Option(None, help="Override GNN layer count"),
        transformer_d_model: int | None = typer.Option(None, help="Override transformer model dimension"),
        transformer_nhead: int | None = typer.Option(None, help="Override transformer attention heads"),
        transformer_num_layers: int | None = typer.Option(None, help="Override transformer layer count"),
        transformer_dim_feedforward: int | None = typer.Option(None, help="Override transformer feed-forward dimension"),
        lambda_smoothness: float | None = typer.Option(None, help="Override smoothness loss weight"),
        smoke_only: bool = typer.Option(
            False,
            help="Run forward-only smoke validation without backprop",
        ),
        force_backprop: bool = typer.Option(
            False,
            help="Force full training even on known unstable local runtimes",
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

        if known_unstable_cpu and not force_backprop and not smoke_only:
            logger.warning(
                "Detected Windows + Python %s + CPU runtime; defaulting to smoke-only "
                "to avoid known native backward crashes. Use --force-backprop to override.",
                platform.python_version(),
            )
            smoke_only = True

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

        if kaggle_lite:
            # Memory-safe preset for large-node graphs (full-India) on T4.
            config_kwargs.update(
                {
                    "gnn_hidden_dim": 64,
                    "gnn_num_layers": 2,
                    "transformer_d_model": 96,
                    "transformer_nhead": 4,
                    "transformer_num_layers": 2,
                    "transformer_dim_feedforward": 192,
                    "lambda_smoothness": 0.0,
                    "batch_size": min(batch_size, 1),
                }
            )

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

        config = ModelConfig(**config_kwargs)
        model = VayuClimateModel(config)
        loss_fn = PhysicsInformedLoss(
            lambda_conservation=config.lambda_conservation,
            lambda_smoothness=config.lambda_smoothness,
        )
        trainer = VayuTrainer(model, loss_fn, checkpoint_dir, device=device)

        train_sequences, val_sequences, source = _load_or_build_sequences(data_dir, config)
        logger.info(
            "Loaded %d train and %d val sequences (%s)",
            len(train_sequences),
            len(val_sequences),
            source,
        )

        if smoke_only:
            logger.info("Starting smoke-only validation (device=%s)…", device)
            _run_smoke_forward(model, loss_fn, train_sequences, device, checkpoint_dir)
            return

        logger.info("Starting training (device=%s)…", device)
        trainer.train(train_sequences, val_sequences, config)

    app()


if __name__ == "__main__":
    train_cli()

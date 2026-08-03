"""VayuGridClimateModel: U-Net encode-process-decode climate prediction model.

Drop-in alternative to VayuClimateModel that swaps the GraphSAGE spatial
encoder (GraphEncoder) for a compact 2D-convolutional U-Net (GridEncoder),
while reusing TemporalTransformer and PredictionHeads UNCHANGED.

Why this is a safe, bounded migration (see research/ARCHITECTURE_VALIDATION.md):
  - VAYU's climate "graph" is a regular lat/lon grid flattened in row-major
    node order (data_ingestion/graph_builder.py), not an irregular mesh —
    the pole-distortion motivation for GraphCast's mesh design does not apply
    to VAYU's small regional boxes.
  - PhysicsInformedLoss's conservation/smoothness terms operate on per-node
    predictions and edge_index; they require NO changes, since edge_index
    (built from the same 8-connectivity grid) is unaffected by which encoder
    produced the predictions.
  - TemporalTransformer and PredictionHeads are encoder-agnostic — they only
    require per-node embeddings of shape (num_nodes, seq_len, hidden_dim) /
    (num_nodes, in_features), which GridEncoder produces with the same
    contract as GraphEncoder.

Only the spatial encoder changes. Loss function, training loop, evaluation
metrics, and checkpoint format (model_state_dict + config) are all identical
to VayuClimateModel.
"""

from __future__ import annotations

import torch
import torch.nn as nn
from torch_geometric.data import Data as GraphData

from .config import ModelConfig
from .grid_encoder import GridEncoder
from .prediction_heads import PredictionHeads
from .temporal_transformer import TemporalTransformer


class VayuGridClimateModel(nn.Module):
    """U-Net encode + Transformer process + MLP decode climate prediction model.

    Forward pass:
        1. GridEncoder processes the sequence of spatial grids (regular lat/lon,
           reshaped from flattened node order) to produce per-node spatial
           embeddings for each timestep, via a compact 2-level U-Net.
        2. TemporalTransformer attends over the input-window sequence of
           embeddings per node to produce a fixed temporal context vector.
           (UNCHANGED from VayuClimateModel.)
        3. PredictionHeads map temporal context -> multi-day forecasts per
           variable, with a persistence-skip connection. (UNCHANGED.)

    Input:
        graph_batch.x: [num_nodes, seq_len, in_features]
        graph_batch.edge_index: [2, num_edges] — used only by the loss
            function's smoothness/conservation terms, NOT by this model's
            forward pass (GridEncoder uses grid convolutions instead).
        nlat, nlon: grid dimensions; num_nodes must equal nlat * nlon.

    Output:
        dict[str, Tensor] with keys 'rainfall', 'temp_max', 'temp_min'
        each of shape [num_nodes, forecast_horizon] — IDENTICAL contract to
        VayuClimateModel, so PhysicsInformedLoss and all trainer/evaluation
        code work unchanged.
    """

    def __init__(self, config: ModelConfig | None = None, nlat: int | None = None, nlon: int | None = None):
        super().__init__()
        self.config = config or ModelConfig()
        cfg = self.config

        if nlat is None or nlon is None:
            nlat = cfg.num_lat
            nlon = cfg.num_lon
        self.nlat = nlat
        self.nlon = nlon

        self.encoder = GridEncoder(
            in_features=cfg.gnn_in_features,
            hidden_dim=cfg.gnn_hidden_dim,
            dropout=cfg.gnn_dropout,
        )

        self.transformer = TemporalTransformer(
            input_dim=cfg.gnn_hidden_dim,
            d_model=cfg.transformer_d_model,
            nhead=cfg.transformer_nhead,
            num_layers=cfg.transformer_num_layers,
            dim_feedforward=cfg.transformer_dim_feedforward,
            dropout=cfg.transformer_dropout,
            max_seq_len=cfg.input_window,
        )

        self.heads = PredictionHeads(
            d_model=cfg.transformer_d_model,
            forecast_horizon=cfg.forecast_horizon,
            dropout=cfg.transformer_dropout,
        )

        self._log_param_count()

    def forward(
        self,
        graph_batch: GraphData,
        mc_dropout: bool = False,
    ) -> dict[str, torch.Tensor]:
        """Full forward pass. Same signature/contract as VayuClimateModel.forward.

        Args:
            graph_batch: PyTorch Geometric Data with x: [num_nodes, seq_len, in_features].
                edge_index/edge_attr are ignored here (used only by the loss fn).
            mc_dropout: If True, keep dropout active at inference for MC estimation.

        Returns:
            Predictions dict, each value [num_nodes, forecast_horizon].
        """
        if mc_dropout:
            self.train()
        else:
            self.eval()

        x = graph_batch.x  # (num_nodes, seq_len, features)

        # ── Step 1: Spatial encoding via U-Net over the reshaped grid ────────
        spatial_seq = self.encoder(x, self.nlat, self.nlon)  # (num_nodes, seq_len, hidden_dim)

        # ── Step 2: Temporal attention (unchanged) ────────────────────────────
        temporal_ctx = self.transformer(spatial_seq)  # (num_nodes, d_model)

        # ── Step 3: Prediction heads with persistence skip connection (unchanged) ──
        last_input = x[:, -1, :]
        predictions = self.heads(temporal_ctx, last_input, full_input=x)

        return predictions

    @torch.no_grad()
    def predict_with_uncertainty(
        self,
        graph_batch: GraphData,
        n_passes: int = 10,
    ) -> dict[str, dict[str, torch.Tensor]]:
        """Monte Carlo dropout uncertainty estimation. Identical to VayuClimateModel."""
        all_samples: dict[str, list[torch.Tensor]] = {
            "rainfall": [], "temp_max": [], "temp_min": []
        }
        for _ in range(n_passes):
            preds = self.forward(graph_batch, mc_dropout=True)
            for var in all_samples:
                all_samples[var].append(preds[var].detach())

        results = {}
        for var, samples in all_samples.items():
            stacked = torch.stack(samples, dim=0)
            results[var] = {
                "mean": stacked.mean(dim=0),
                "std": stacked.std(dim=0),
                "samples": stacked,
            }
        self.eval()
        return results

    def _log_param_count(self) -> None:
        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        import logging
        logger = logging.getLogger(__name__)
        logger.info(
            "VayuGridClimateModel: %d total params (%.1fM), %d trainable, grid=%dx%d",
            total, total / 1e6, trainable, self.nlat, self.nlon,
        )
        if total > 25_000_000:
            logger.warning(
                "Model has %.1fM params — exceeds 25M RTX 4050 target!", total / 1e6
            )

    @classmethod
    def load(cls, checkpoint_path: str, device: str = "cpu", nlat: int | None = None, nlon: int | None = None) -> "VayuGridClimateModel":
        """Load model from checkpoint file. Requires nlat/nlon (not auto-detectable
        from grid-encoder weight shapes the way graph configs are), unless stored
        in the checkpoint's extra fields under 'nlat'/'nlon'."""
        checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)
        config = checkpoint.get("config", None) or ModelConfig()
        ckpt_nlat = nlat or checkpoint.get("nlat")
        ckpt_nlon = nlon or checkpoint.get("nlon")
        if ckpt_nlat is None or ckpt_nlon is None:
            raise ValueError(
                "VayuGridClimateModel.load requires nlat/nlon (not stored in this "
                "checkpoint) — pass them explicitly."
            )
        model = cls(config=config, nlat=ckpt_nlat, nlon=ckpt_nlon)
        missing, unexpected = model.load_state_dict(checkpoint["model_state_dict"], strict=False)
        if missing:
            import logging
            logging.getLogger(__name__).warning(
                "Loaded checkpoint with %d missing keys (architecture mismatch or new layers)",
                len(missing),
            )
        model.eval()
        return model

    def save(self, path: str, extra: dict | None = None) -> None:
        """Save model checkpoint, including nlat/nlon for reload."""
        import os
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        payload = {
            "model_state_dict": self.state_dict(),
            "config": self.config,
            "nlat": self.nlat,
            "nlon": self.nlon,
            "architecture": "grid_unet",
        }
        if extra:
            payload.update(extra)
        torch.save(payload, path)

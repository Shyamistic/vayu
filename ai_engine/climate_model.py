"""VayuClimateModel: Full encode-process-decode climate prediction model.

Combines:
  GraphEncoder (spatial) → TemporalTransformer (temporal) → PredictionHeads (output)

Supports Monte Carlo dropout for uncertainty quantification.
Total parameters ≤ 25M to fit on RTX 4050 6GB VRAM.
"""

from __future__ import annotations

import torch
import torch.nn as nn
from torch_geometric.data import Data as GraphData

from .config import ModelConfig
from .graph_encoder import GraphEncoder
from .prediction_heads import PredictionHeads
from .temporal_transformer import TemporalTransformer


class VayuClimateModel(nn.Module):
    """Full encode-process-decode climate prediction model.

    Forward pass:
        1. GraphEncoder processes the sequence of spatial graphs to produce
           per-node spatial embeddings for each timestep.
        2. TemporalTransformer attends over the 30-day sequence of embeddings
           per node to produce a fixed temporal context vector.
        3. PredictionHeads map temporal context → 7-day forecasts per variable.

    Input:
        graph_batch.x: [num_nodes, seq_len, in_features] (from build_sequence_graph)
        graph_batch.edge_index: [2, num_edges]
        graph_batch.edge_attr: [num_edges, edge_features]

    Output:
        dict[str, Tensor] with keys 'rainfall', 'temp_max', 'temp_min'
        each of shape [num_nodes, forecast_horizon]

    Parameter count estimate at default config:
        GraphEncoder:  ~2M  (input_proj + 3×SAGEConv)
        Transformer:   ~8M  (4 layers × 2×(d_model×ff) + attention)
        Heads:         ~0.3M
        Total:         ~10M  (well under 25M limit)
    """

    def __init__(self, config: ModelConfig | None = None):
        super().__init__()
        self.config = config or ModelConfig()
        cfg = self.config

        self.encoder = GraphEncoder(
            in_features=cfg.gnn_in_features,
            hidden_dim=cfg.gnn_hidden_dim,
            num_layers=cfg.gnn_num_layers,
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
        """Full forward pass.

        Args:
            graph_batch: PyTorch Geometric Data with:
                - x: [num_nodes, seq_len, in_features]
                - edge_index: [2, num_edges]
                - edge_attr: [num_edges, edge_features]
            mc_dropout: If True, keep dropout active at inference for MC estimation.

        Returns:
            Predictions dict. If mc_dropout=False (standard inference), each value
            is [num_nodes, forecast_horizon].
        """
        if mc_dropout:
            self.train()  # Activate dropout for MC sampling
        else:
            self.eval()

        x = graph_batch.x           # (num_nodes, seq_len, features)
        edge_index = graph_batch.edge_index
        edge_attr = graph_batch.edge_attr

        num_nodes, seq_len, _ = x.shape

        # ── Step 1: Spatial encoding — batched across all timesteps ──────────
        # Instead of 30 sequential GNN passes, batch all timesteps together.
        # Replicate edge_index for each timestep with node offset.
        x_flat = x.reshape(num_nodes * seq_len, -1)  # (N*T, features)

        # Build batched edge_index: each timestep gets its own graph with offset
        offsets = torch.arange(seq_len, device=edge_index.device) * num_nodes
        # edge_index: (2, E) → replicate T times with offsets
        edge_index_batched = torch.cat([
            edge_index + off for off in offsets
        ], dim=1)  # (2, E*T)

        # Replicate edge_attr for each timestep
        edge_attr_batched = edge_attr.repeat(seq_len, 1)  # (E*T, edge_dim)

        # Single batched GNN pass
        h_flat = self.encoder(x_flat, edge_index_batched, edge_attr_batched)  # (N*T, hidden_dim)

        # Reshape back to sequence: (num_nodes, seq_len, hidden_dim)
        spatial_seq = h_flat.reshape(num_nodes, seq_len, -1)

        # ── Step 2: Temporal attention ───────────────────────────────────────
        temporal_ctx = self.transformer(spatial_seq)  # (num_nodes, d_model)

        # ── Step 3: Prediction heads with persistence skip connection ────────
        # Pass last timestep's raw features so heads can learn residuals
        # Also pass full input sequence for trend computation
        last_input = x[:, -1, :]  # (num_nodes, in_features) — last day's features
        predictions = self.heads(temporal_ctx, last_input, full_input=x)  # dict[var → (num_nodes, horizon)]

        return predictions

    @torch.no_grad()
    def predict_with_uncertainty(
        self,
        graph_batch: GraphData,
        n_passes: int = 10,
    ) -> dict[str, dict[str, torch.Tensor]]:
        """Monte Carlo dropout uncertainty estimation.

        Runs n_passes forward passes with dropout active, then computes
        mean ± std across passes.

        Args:
            graph_batch: Input graph.
            n_passes: Number of MC dropout passes (default 10).

        Returns:
            Dict with keys 'rainfall', 'temp_max', 'temp_min'.
            Each value is a dict: {'mean': Tensor, 'std': Tensor, 'samples': Tensor}
            where mean/std have shape [num_nodes, forecast_horizon] and
            samples has shape [n_passes, num_nodes, forecast_horizon].
        """
        all_samples: dict[str, list[torch.Tensor]] = {
            "rainfall": [], "temp_max": [], "temp_min": []
        }

        for _ in range(n_passes):
            preds = self.forward(graph_batch, mc_dropout=True)
            for var in all_samples:
                all_samples[var].append(preds[var].detach())

        results = {}
        for var, samples in all_samples.items():
            stacked = torch.stack(samples, dim=0)  # (n_passes, num_nodes, horizon)
            results[var] = {
                "mean": stacked.mean(dim=0),
                "std": stacked.std(dim=0),
                "samples": stacked,
            }

        # Restore eval mode
        self.eval()
        return results

    def _log_param_count(self) -> None:
        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        import logging
        logger = logging.getLogger(__name__)
        logger.info(
            "VayuClimateModel: %d total params (%.1fM), %d trainable",
            total, total / 1e6, trainable,
        )
        if total > 25_000_000:
            logger.warning(
                "Model has %.1fM params — exceeds 25M RTX 4050 target!", total / 1e6
            )

    @classmethod
    def load(cls, checkpoint_path: str, device: str = "cpu") -> "VayuClimateModel":
        """Load model from checkpoint file."""
        checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)
        config = checkpoint.get("config", ModelConfig())
        model = cls(config=config)
        # Use strict=False to handle architecture changes between checkpoint versions
        # (e.g., old 2-layer heads vs new 3-layer heads)
        missing, unexpected = model.load_state_dict(checkpoint["model_state_dict"], strict=False)
        if missing:
            import logging
            logging.getLogger(__name__).warning(
                "Loaded checkpoint with %d missing keys (new architecture layers initialized randomly)",
                len(missing),
            )
        model.eval()
        return model

    def save(self, path: str, extra: dict | None = None) -> None:
        """Save model checkpoint."""
        import os
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        payload = {
            "model_state_dict": self.state_dict(),
            "config": self.config,
        }
        if extra:
            payload.update(extra)
        torch.save(payload, path)

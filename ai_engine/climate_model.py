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
        """Load model from checkpoint file.

        Auto-detects the model configuration from weight tensor shapes so that
        older checkpoints (e.g. vayu_best (3).pt — 2.3M params, hidden=128)
        load correctly even when no 'config' key is stored.
        """
        import logging
        _log = logging.getLogger(__name__)

        checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)

        # ── Try stored config first ────────────────────────────────────────────
        config = checkpoint.get("config", None)

        # ── Auto-detect config from weight shapes when not stored ──────────────
        if config is None:
            sd = checkpoint.get("model_state_dict", {})
            cfg = ModelConfig()

            # Detect gnn_hidden_dim from encoder input projection
            enc_w = sd.get("encoder.input_proj.0.weight")
            if enc_w is not None:
                cfg.gnn_hidden_dim = enc_w.shape[0]          # rows = output dim
                cfg.gnn_in_features = enc_w.shape[1]         # cols = input features
                _log.info("Auto-detected gnn_hidden_dim=%d, gnn_in_features=%d",
                          cfg.gnn_hidden_dim, cfg.gnn_in_features)

            # Detect transformer d_model from input projection
            tf_proj = sd.get("transformer.input_proj.weight")
            if tf_proj is not None:
                cfg.transformer_d_model = tf_proj.shape[0]
                _log.info("Auto-detected transformer_d_model=%d", cfg.transformer_d_model)

            # Detect feedforward dim
            ff_w = sd.get("transformer.transformer.layers.0.linear1.weight")
            if ff_w is not None:
                cfg.transformer_dim_feedforward = ff_w.shape[0]

            # Detect num transformer layers
            num_layers = sum(
                1 for k in sd
                if k.startswith("transformer.transformer.layers.") and k.endswith(".norm1.weight")
            )
            if num_layers > 0:
                cfg.transformer_num_layers = num_layers
                _log.info("Auto-detected transformer_num_layers=%d", num_layers)

            # Detect num GNN layers
            num_gnn = sum(1 for k in sd if k.startswith("encoder.convs.") and k.endswith(".lin_l.weight"))
            if num_gnn > 0:
                cfg.gnn_num_layers = num_gnn

            config = cfg
            _log.info("Auto-configured model: hidden=%d d_model=%d layers=%d params≈%.1fM",
                      cfg.gnn_hidden_dim, cfg.transformer_d_model, cfg.transformer_num_layers,
                      (cfg.gnn_hidden_dim**2 * 3 + cfg.transformer_d_model**2 * 4 * cfg.transformer_num_layers) / 1e6)

        model = cls(config=config)
        missing, unexpected = model.load_state_dict(checkpoint["model_state_dict"], strict=False)
        if missing:
            _log = logging.getLogger(__name__)
            _log.warning("Loaded checkpoint with %d missing keys (architecture mismatch or new layers)", len(missing))
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

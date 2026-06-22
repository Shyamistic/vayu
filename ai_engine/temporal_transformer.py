"""Temporal Transformer: 4-layer multi-head attention over 30-day sequences.

Captures seasonal patterns, long-term trends, and multi-scale temporal
dependencies across the input window. Operates on per-node spatial embeddings
produced by the GraphEncoder.
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn


class SinusoidalPositionalEncoding(nn.Module):
    """Standard sinusoidal positional encoding for the 30-day sequence."""

    def __init__(self, d_model: int, max_seq_len: int = 30, dropout: float = 0.1):
        super().__init__()
        self.dropout = nn.Dropout(p=dropout)

        pe = torch.zeros(max_seq_len, d_model)
        position = torch.arange(0, max_seq_len).unsqueeze(1).float()
        div_term = torch.exp(
            torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model)
        )
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term[: d_model // 2])
        self.register_buffer("pe", pe)  # (max_seq_len, d_model)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Add positional encoding to sequence.

        Args:
            x: [seq_len, batch, d_model] or [batch, seq_len, d_model]
        """
        if x.dim() == 3 and x.size(0) != self.pe.size(0):
            # Assume (batch, seq_len, d_model)
            x = x + self.pe[: x.size(1)].unsqueeze(0)
        else:
            x = x + self.pe[: x.size(0)].unsqueeze(1)
        return self.dropout(x)


class TemporalTransformer(nn.Module):
    """4-layer Transformer for temporal sequence processing.

    Processes per-node sequences of spatial embeddings (from GraphEncoder)
    across the 30-day input window using multi-head self-attention.

    Architecture:
        - Project spatial embeddings (hidden_dim → d_model)
        - Add sinusoidal positional encoding
        - 4× TransformerEncoderLayer (8 heads, ff=512, dropout=0.1)
        - Take [CLS] token (first position) as temporal context
        - Project back to d_model output

    The [CLS] approach lets the model aggregate all 30 days into a single
    fixed-length vector per node, which is then passed to PredictionHeads.
    """

    def __init__(
        self,
        input_dim: int = 128,
        d_model: int = 256,
        nhead: int = 8,
        num_layers: int = 4,
        dim_feedforward: int = 512,
        dropout: float = 0.1,
        max_seq_len: int = 30,
    ):
        super().__init__()
        self.d_model = d_model
        self.max_seq_len = max_seq_len

        # Project from graph encoder hidden_dim to transformer d_model
        self.input_proj = nn.Linear(input_dim, d_model)

        # Learnable [CLS] token prepended to the sequence
        self.cls_token = nn.Parameter(torch.zeros(1, 1, d_model))
        nn.init.trunc_normal_(self.cls_token, std=0.02)

        # Positional encoding (for the sequence + CLS slot)
        self.pos_enc = SinusoidalPositionalEncoding(
            d_model, max_seq_len=max_seq_len + 1, dropout=dropout
        )

        # Transformer encoder
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=dim_feedforward,
            dropout=dropout,
            activation="gelu",
            batch_first=True,  # (batch, seq, d_model)
            norm_first=True,   # Pre-norm for training stability
        )
        self.transformer = nn.TransformerEncoder(
            encoder_layer,
            num_layers=num_layers,
            enable_nested_tensor=False,
        )
        self.norm = nn.LayerNorm(d_model)

        # Stochastic depth: linearly increase drop probability across layers.
        # Layer 0 is never dropped (drop_prob=0); final layer has the highest.
        # This regularises the deeper layers most, as in ClimaX / DeiT.
        max_drop = 0.2
        self.stochastic_depth_probs = [
            max_drop * i / max(num_layers - 1, 1) for i in range(num_layers)
        ]

    def forward(
        self,
        spatial_embeddings: torch.Tensor,
        src_key_padding_mask: torch.Tensor | None = None,
    ) -> torch.Tensor:
        """Process temporal sequence of spatial embeddings.

        Args:
            spatial_embeddings: [num_nodes, seq_len, input_dim]
                                 (seq_len is the 30-day input window)
            src_key_padding_mask: Optional [num_nodes, seq_len+1] mask for padding.

        Returns:
            Temporal context: [num_nodes, d_model]
            (CLS token output aggregating all 30 days)
        """
        num_nodes, seq_len, _ = spatial_embeddings.shape

        # Project to d_model
        x = self.input_proj(spatial_embeddings)  # (num_nodes, seq_len, d_model)

        # Prepend CLS token
        cls = self.cls_token.expand(num_nodes, -1, -1)  # (N, 1, d_model)
        x = torch.cat([cls, x], dim=1)  # (N, seq_len+1, d_model)

        # Positional encoding
        x = self.pos_enc(x)

        # Stochastic depth: randomly skip transformer layers during training.
        # Each layer has an independent Bernoulli trial; the skip probability
        # increases linearly from 0 (layer 0) to max_drop (final layer).
        for layer, drop_prob in zip(self.transformer.layers, self.stochastic_depth_probs):
            if self.training and drop_prob > 0.0 and torch.rand(1, device=x.device).item() < drop_prob:
                continue  # skip this layer; its residual stream passes through unchanged
            x = layer(x, src_key_padding_mask=src_key_padding_mask)

        x = self.norm(x)

        # Extract CLS token as the temporal summary
        temporal_context = x[:, 0, :]  # (num_nodes, d_model)

        return temporal_context

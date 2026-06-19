"""Graph Encoder: 3-layer GraphSAGE with residual connections.

Captures spatial relationships between 0.25° grid cells: orographic
effects, adjacency patterns, and wind-driven climate correlations.
"""

from __future__ import annotations

import torch
import torch.nn as nn
from torch_geometric.nn import SAGEConv


class GraphEncoder(nn.Module):
    """3-layer GraphSAGE encoder with residual connections and dropout.

    Architecture:
        Linear(in_features → hidden_dim) + BN + ReLU
        SAGEConv(hidden_dim → hidden_dim) + BN + ReLU + Dropout
        SAGEConv(hidden_dim → hidden_dim) + BN + ReLU + Dropout
        SAGEConv(hidden_dim → hidden_dim) + BN + ReLU
        → output: [num_nodes, hidden_dim] spatial embeddings

    Residual connections skip each SAGEConv pair to preserve input signal.
    Edge attributes are projected and added to node features before each layer.
    """

    def __init__(
        self,
        in_features: int = 11,
        hidden_dim: int = 128,
        num_layers: int = 3,
        dropout: float = 0.1,
        edge_dim: int = 3,
    ):
        super().__init__()
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers

        # Input projection: in_features → hidden_dim
        self.input_proj = nn.Sequential(
            nn.Linear(in_features, hidden_dim),
            nn.BatchNorm1d(hidden_dim),
            nn.ReLU(),
        )

        # Edge attribute projection (used to modulate node features)
        # Edge is [distance_norm, elev_diff, wind_dot] → hidden_dim
        self.edge_proj = nn.Linear(edge_dim, hidden_dim)

        # GraphSAGE layers
        self.convs = nn.ModuleList()
        self.norms = nn.ModuleList()
        for _ in range(num_layers):
            self.convs.append(SAGEConv(hidden_dim, hidden_dim, aggr="mean"))
            self.norms.append(nn.BatchNorm1d(hidden_dim))

        self.dropout = nn.Dropout(p=dropout)
        self.act = nn.ReLU()

    def forward(
        self,
        x: torch.Tensor,
        edge_index: torch.Tensor,
        edge_attr: torch.Tensor,
    ) -> torch.Tensor:
        """Encode spatial graph.

        Args:
            x: Node features — one of:
               - [num_nodes, in_features] for single-timestep input
               - [num_nodes, seq_len, in_features] for multi-timestep (mean-pooled)
            edge_index: [2, num_edges]
            edge_attr: [num_edges, edge_dim]

        Returns:
            Spatial embeddings [num_nodes, hidden_dim]
        """
        # Handle sequence input: aggregate temporal dimension
        if x.dim() == 3:
            # x: (num_nodes, seq_len, features) → mean pool over time
            x = x.mean(dim=1)  # (num_nodes, features)

        # Project edge attributes to node-level influence
        # Aggregate edge attributes per destination node (mean)
        num_nodes = x.size(0)
        edge_embed = self.edge_proj(edge_attr)  # (num_edges, hidden_dim)

        # Scatter-add edge embeddings to destination nodes
        dst = edge_index[1]  # destination nodes
        edge_agg = torch.zeros(num_nodes, self.hidden_dim, device=x.device)
        edge_agg.scatter_add_(0, dst.unsqueeze(1).expand_as(edge_embed), edge_embed)

        # Input projection
        h = self.input_proj(x)  # (num_nodes, hidden_dim)
        h = h + edge_agg  # Inject edge context

        # Message passing with residual connections
        for i, (conv, norm) in enumerate(zip(self.convs, self.norms)):
            residual = h
            h = conv(h, edge_index)  # (num_nodes, hidden_dim)
            h = norm(h)
            h = self.act(h)
            if i < self.num_layers - 1:
                h = self.dropout(h)
            # Residual connection
            h = h + residual

        return h  # (num_nodes, hidden_dim)

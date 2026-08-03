"""Grid Encoder: compact U-Net spatial encoder for regular lat/lon climate grids.

Alternative to GraphEncoder (GraphSAGE). Exploits the fact that VAYU's climate
"graph" is actually a regular lat/lon grid flattened in row-major node order
(see data_ingestion/graph_builder.py — node index = lat_idx * nlon + lon_idx),
not an irregular/geodesic mesh. This lets a standard 2D convolutional U-Net
operate directly on the grid, following the SmaAt-UNet precedent for efficient
regional weather nowcasting (Trebing, Stanczyk & Mehrkanoon, 2021) and the
broader limited-area/regional CNN weather-model literature (arXiv:2504.09340,
arXiv:2507.18378) rather than the global-sphere GNN motivation (pole distortion
avoidance, arXiv:2403.17016) that does not apply to VAYU's small regional boxes.

Depthwise-separable convolutions are used throughout to keep the parameter
budget comparable to GraphEncoder at equivalent hidden width, matching the
efficiency goal that motivated the SmaAt-UNet design.

See research/ARCHITECTURE_VALIDATION.md for the literature validation behind
this migration.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class DepthwiseSeparableConv2d(nn.Module):
    """Depthwise 3x3 conv + pointwise 1x1 conv — fewer params than a standard Conv2d."""

    def __init__(self, in_ch: int, out_ch: int, padding_mode: str = "reflect"):
        super().__init__()
        self.depthwise = nn.Conv2d(
            in_ch, in_ch, kernel_size=3, padding=1, groups=in_ch,
            padding_mode=padding_mode, bias=False,
        )
        self.pointwise = nn.Conv2d(in_ch, out_ch, kernel_size=1, bias=False)
        self.bn = nn.BatchNorm2d(out_ch)
        self.act = nn.ReLU(inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.depthwise(x)
        x = self.pointwise(x)
        x = self.bn(x)
        return self.act(x)


class DownBlock(nn.Module):
    """Depthwise-separable conv block followed by stride-2 downsampling."""

    def __init__(self, in_ch: int, out_ch: int):
        super().__init__()
        self.conv = DepthwiseSeparableConv2d(in_ch, out_ch)
        self.pool = nn.Conv2d(out_ch, out_ch, kernel_size=2, stride=2, bias=False)
        self.pool_bn = nn.BatchNorm2d(out_ch)
        self.pool_act = nn.ReLU(inplace=True)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        skip = self.conv(x)
        down = self.pool_act(self.pool_bn(self.pool(skip)))
        return down, skip


class UpBlock(nn.Module):
    """Bilinear upsample + concat skip connection + depthwise-separable conv."""

    def __init__(self, in_ch: int, skip_ch: int, out_ch: int):
        super().__init__()
        self.conv = DepthwiseSeparableConv2d(in_ch + skip_ch, out_ch)

    def forward(self, x: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        x = F.interpolate(x, size=skip.shape[-2:], mode="bilinear", align_corners=False)
        x = torch.cat([x, skip], dim=1)
        return self.conv(x)


class GridEncoder(nn.Module):
    """Compact 2-level U-Net spatial encoder for a regular lat/lon climate grid.

    Drop-in replacement for GraphEncoder with a matching output contract:
    given per-node features for a sequence of timesteps, returns per-node
    hidden embeddings of the same (num_nodes, seq_len, hidden_dim) shape that
    TemporalTransformer already expects — no changes needed downstream.

    Handles odd/small grid dimensions (e.g. 23x57 for Western Ghats) by
    reflect-padding to the nearest multiple of 4 before pooling, then cropping
    back to the original (nlat, nlon) after the decoder.
    """

    def __init__(
        self,
        in_features: int = 17,
        hidden_dim: int = 192,
        base_channels: int | None = None,
        dropout: float = 0.1,
    ):
        super().__init__()
        self.hidden_dim = hidden_dim
        base = base_channels or max(32, hidden_dim // 4)

        # down1: skip1 has base*2 channels; down2: skip2 has base*4 channels.
        self.stem = DepthwiseSeparableConv2d(in_features, base)
        self.down1 = DownBlock(base, base * 2)
        self.down2 = DownBlock(base * 2, base * 4)
        self.bottleneck = DepthwiseSeparableConv2d(base * 4, base * 4)
        self.up1 = UpBlock(in_ch=base * 4, skip_ch=base * 4, out_ch=base * 2)
        self.up2 = UpBlock(in_ch=base * 2, skip_ch=base * 2, out_ch=base)
        self.out_proj = nn.Conv2d(base, hidden_dim, kernel_size=1)
        self.dropout = nn.Dropout2d(p=dropout)

    def _pad_to_multiple(self, x: torch.Tensor, multiple: int = 4) -> tuple[torch.Tensor, tuple[int, int]]:
        """Reflect-pad H, W to the nearest multiple of `multiple`. Returns (padded, (h, w)) original size."""
        h, w = x.shape[-2], x.shape[-1]
        pad_h = (multiple - h % multiple) % multiple
        pad_w = (multiple - w % multiple) % multiple
        if pad_h or pad_w:
            x = F.pad(x, (0, pad_w, 0, pad_h), mode="reflect")
        return x, (h, w)

    def forward(self, x: torch.Tensor, nlat: int, nlon: int) -> torch.Tensor:
        """Encode a sequence of spatial grids.

        Args:
            x: [num_nodes, seq_len, in_features] node features, where
               num_nodes == nlat * nlon and node order is row-major
               (node index = lat_idx * nlon + lon_idx), matching
               data_ingestion/graph_builder.py's flatten convention.
            nlat: Number of latitude rows in the grid.
            nlon: Number of longitude columns in the grid.

        Returns:
            [num_nodes, seq_len, hidden_dim] per-node hidden embeddings.
        """
        num_nodes, seq_len, in_features = x.shape
        if num_nodes != nlat * nlon:
            raise ValueError(
                f"GridEncoder expects num_nodes == nlat*nlon ({nlat}*{nlon}="
                f"{nlat * nlon}), got {num_nodes}. Grid shape mismatch."
            )

        # (num_nodes, seq_len, C) -> (nlat, nlon, seq_len, C) -> (seq_len, C, nlat, nlon)
        x_grid = x.reshape(nlat, nlon, seq_len, in_features).permute(2, 3, 0, 1).contiguous()

        x_padded, (orig_h, orig_w) = self._pad_to_multiple(x_grid, multiple=4)

        stem = self.stem(x_padded)
        d1, skip1 = self.down1(stem)
        d2, skip2 = self.down2(d1)
        bottleneck = self.bottleneck(d2)
        u1 = self.up1(bottleneck, skip2)
        u2 = self.up2(u1, skip1)
        u2 = self.dropout(u2)
        out = self.out_proj(u2)  # (seq_len, hidden_dim, padded_h, padded_w)

        # Crop back to original grid size
        out = out[:, :, :orig_h, :orig_w]

        # (seq_len, hidden_dim, nlat, nlon) -> (nlat, nlon, seq_len, hidden_dim) -> (num_nodes, seq_len, hidden_dim)
        out = out.permute(2, 3, 0, 1).reshape(num_nodes, seq_len, self.hidden_dim)
        return out

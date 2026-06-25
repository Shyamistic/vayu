"""Shared data models and configuration for VAYU Climate Digital Twin."""

from __future__ import annotations
from dataclasses import dataclass, field


@dataclass
class ModelConfig:
    """Configuration for the VayuClimateModel."""

    # ── Graph Encoder ────────────────────────────────────────────────────────
    # Input features per node:
    # Dynamic (5): rainfall, temp_max, temp_min, insat_lst, insat_sst
    # Temporal (2): day_sin, day_cos
    # Monsoon (2): jjas_flag, monsoon_progress
    # Wind    (3): uwnd_850, vwnd_850, shum_850  ← NCEP 850 hPa (0 when absent)
    # CHIRPS  (1): chirps_rain ← auxiliary satellite precip feature (not target)
    # Static  (4): elevation, land_sea_mask, lat_enc, lon_enc
    gnn_in_features: int = 17
    gnn_hidden_dim: int = 128
    gnn_num_layers: int = 3
    gnn_dropout: float = 0.1

    # ── Temporal Transformer ─────────────────────────────────────────────────
    transformer_d_model: int = 256
    transformer_nhead: int = 8
    transformer_num_layers: int = 4
    transformer_dim_feedforward: int = 512
    transformer_dropout: float = 0.1

    # ── Prediction ───────────────────────────────────────────────────────────
    input_window: int = 30          # days of input history
    forecast_horizon: int = 7       # days to predict
    num_output_variables: int = 3   # rainfall, tmax, tmin

    # ── Training ─────────────────────────────────────────────────────────────
    learning_rate: float = 1e-4
    batch_size: int = 16
    max_epochs: int = 100
    lambda_conservation: float = 0.1
    lambda_smoothness: float = 0.05
    mc_dropout_passes: int = 10
    weight_decay: float = 1e-5

    # ── Pilot Region Graph Dimensions ────────────────────────────────────────
    # lat 8–20°N at 0.25° = 49 grid points; lon 72–78°E at 0.25° = 25 grid points
    # Interior nodes: 8 neighbors; boundary/corner nodes: fewer
    num_lat: int = 49
    num_lon: int = 25

    @property
    def num_nodes(self) -> int:
        return self.num_lat * self.num_lon  # 1225


@dataclass
class NormalizationParams:
    """Per-variable per-cell normalization statistics computed over 1981-2010."""

    mean: dict[str, "np.ndarray"]   # variable -> [num_lat, num_lon] array
    std: dict[str, "np.ndarray"]    # variable -> [num_lat, num_lon] array
    reference_period: tuple[int, int] = (1981, 2010)


@dataclass
class DataSplit:
    """Temporal train/val/test split boundaries."""

    train_start: int = 1951
    train_end: int = 2020
    val_start: int = 2021
    val_end: int = 2023
    test_start: int = 2024
    test_end: int = 2025


@dataclass
class PilotRegion:
    """Geographic extent of the pilot region: Western India."""

    lat_min: float = 8.0
    lat_max: float = 20.0
    lon_min: float = 72.0
    lon_max: float = 78.0
    resolution: float = 0.25


# Singleton default instances
DEFAULT_CONFIG = ModelConfig()
DEFAULT_SPLIT = DataSplit()
PILOT_REGION = PilotRegion()

# Variable channel indices in the dynamic feature tensor
VARIABLE_CHANNELS = {
    "rainfall": 0,
    "temp_max": 1,
    "temp_min": 2,
    "insat_lst": 3,
    "insat_sst": 4,
}

# INSAT product IDs
MOSDAC_PRODUCTS = {
    "lst": "3RIMG_L2B_LST",
    "sst": "3RIMG_L2B_SST",
    "rainfall": "3RIMG_L2B_IMC",
}

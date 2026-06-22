"""Climate graph builder — converts preprocessed xarray data to PyTorch Geometric graphs.

Constructs a spatial graph where:
- Nodes = 0.25° grid cells in the pilot region
- Edges = 8-connectivity (N, NE, E, SE, S, SW, W, NW)
- Node features = static (elevation, land-sea, lat, lon) + dynamic (climate vars) + temporal
- Edge features = distance (km), elevation difference (m), monsoon wind direction (rad)
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import torch
import xarray as xr
from torch_geometric.data import Data as GraphData

logger = logging.getLogger(__name__)

# Pilot region grid
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 8.0, 20.0, 72.0, 78.0
RESOLUTION = 0.25

# 8-connectivity offsets (row_offset, col_offset)
EIGHT_CONNECTIVITY = [
    (-1, 0), (-1, 1), (0, 1), (1, 1),  # N, NE, E, SE
    (1, 0), (1, -1), (0, -1), (-1, -1),  # S, SW, W, NW
]

# Mean SW monsoon wind direction (radians from East, anticlockwise)
# Roughly 225° (SW→NE flow) → converted to bearing from E: ~45° → π/4
MONSOON_WIND_DIR = np.pi / 4.0


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km between two lat/lon points."""
    R = 6371.0
    dlat = np.radians(lat2 - lat1)
    dlon = np.radians(lon2 - lon1)
    a = np.sin(dlat / 2) ** 2 + np.cos(np.radians(lat1)) * np.cos(np.radians(lat2)) * np.sin(dlon / 2) ** 2
    return 2 * R * np.arcsin(np.sqrt(a))


class ClimateGraphBuilder:
    """Constructs the spatial Climate Graph for the pilot region.

    The graph has one node per 0.25° grid cell (≈1225 nodes for the pilot
    region) connected via 8-connectivity edges with geographic edge features.

    Static node features (per cell, time-invariant):
        elevation (m), land_sea_mask (0/1), lat_enc (sin), lon_enc (sin)

    Dynamic node features (per cell, per timestep):
        rainfall (normalized), tmax (normalized), tmin (normalized),
        insat_lst (normalized), insat_sst (normalized),
        day_sin, day_cos

    Edge features (per edge, time-invariant):
        distance_km (normalized), elevation_difference_m, wind_direction_rad
    """

    def __init__(
        self,
        elevation_path: str | Path | None = None,
        land_sea_mask_path: str | Path | None = None,
        lat_min: float = LAT_MIN,
        lat_max: float = LAT_MAX,
        lon_min: float = LON_MIN,
        lon_max: float = LON_MAX,
        resolution: float = RESOLUTION,
    ):
        """
        Args:
            elevation_path: Path to 0.25° DEM NetCDF file (var='elevation').
            land_sea_mask_path: Path to 0.25° land-sea mask NetCDF (var='lsm').
        """
        self.lat_min = float(lat_min)
        self.lat_max = float(lat_max)
        self.lon_min = float(lon_min)
        self.lon_max = float(lon_max)
        self.resolution = float(resolution)

        self.lats = np.arange(self.lat_min, self.lat_max + self.resolution / 2, self.resolution)
        self.lons = np.arange(self.lon_min, self.lon_max + self.resolution / 2, self.resolution)
        self.nlat = len(self.lats)
        self.nlon = len(self.lons)
        self.num_nodes = self.nlat * self.nlon

        # Load or generate static features
        self.elevation = self._load_or_generate_elevation(elevation_path)
        self.land_sea_mask = self._load_or_generate_lsm(land_sea_mask_path)

        # Pre-compute static graph topology (edges are time-invariant)
        self._edge_index, self._edge_attr = self._build_edges()
        logger.info(
            "ClimateGraphBuilder: %d nodes, %d edges (8-connectivity)",
            self.num_nodes,
            self._edge_index.shape[1],
        )

    @classmethod
    def from_dataset(
        cls,
        ds: xr.Dataset,
        elevation_path: str | Path | None = None,
        land_sea_mask_path: str | Path | None = None,
    ) -> "ClimateGraphBuilder":
        """Instantiate a builder aligned to the given dataset's spatial grid."""
        lats = ds.lat.values
        lons = ds.lon.values
        lat_min = float(np.min(lats))
        lat_max = float(np.max(lats))
        lon_min = float(np.min(lons))
        lon_max = float(np.max(lons))
        if len(lats) > 1:
            lat_step = float(np.median(np.diff(lats)))
        else:
            lat_step = RESOLUTION
        if len(lons) > 1:
            lon_step = float(np.median(np.diff(lons)))
        else:
            lon_step = RESOLUTION
        resolution = float((abs(lat_step) + abs(lon_step)) / 2.0)

        return cls(
            elevation_path=elevation_path,
            land_sea_mask_path=land_sea_mask_path,
            lat_min=lat_min,
            lat_max=lat_max,
            lon_min=lon_min,
            lon_max=lon_max,
            resolution=resolution,
        )

    # ── Node index helpers ────────────────────────────────────────────────────

    def _node_idx(self, lat_i: int, lon_j: int) -> int:
        """Flat index from (lat_i, lon_j) in row-major order."""
        return lat_i * self.nlon + lon_j

    # ── Static feature generation ──────────────────────────────────────────────

    def _load_or_generate_elevation(self, path: str | Path | None) -> np.ndarray:
        """Load DEM or generate synthetic elevation (Western Ghats ridge)."""
        if path is not None and Path(path).exists():
            import xarray as xr
            dem = xr.open_dataset(path)["elevation"]
            return (
                dem.sel(lat=slice(self.lat_min, self.lat_max), lon=slice(self.lon_min, self.lon_max))
                .values.astype(np.float32)
                .reshape(self.nlat, self.nlon)
            )

        # Synthetic elevation: Western Ghats ridge ~73-74°E
        elevation = np.zeros((self.nlat, self.nlon), dtype=np.float32)
        for j, lon in enumerate(self.lons):
            if 73.0 <= lon <= 74.5:
                elevation[:, j] = 1200.0 + 300.0 * np.random.default_rng(42).random(self.nlat)
        # Kerala and Goa coastal (lat < 12°N) slightly elevated inland
        for i, lat in enumerate(self.lats):
            if lat < 12.0:
                elevation[i] = np.clip(elevation[i], 0, 800)
        logger.warning("Using synthetic elevation — download SRTM DEM for production")
        return elevation

    def _load_or_generate_lsm(self, path: str | Path | None) -> np.ndarray:
        """Load land-sea mask or generate based on geometry."""
        if path is not None and Path(path).exists():
            import xarray as xr
            lsm = xr.open_dataset(path)["lsm"]
            return (
                lsm.sel(lat=slice(self.lat_min, self.lat_max), lon=slice(self.lon_min, self.lon_max))
                .values.astype(np.float32)
                .reshape(self.nlat, self.nlon)
            )

        # Simple geometric land-sea mask for Western India
        # Longitudes < 73.5°E and latitude > 14°N → Goa coast/sea
        lsm = np.ones((self.nlat, self.nlon), dtype=np.float32)
        for j, lon in enumerate(self.lons):
            for i, lat in enumerate(self.lats):
                # Arabian Sea cells (approximately)
                if lon < 73.0 and lat < 18.0:
                    lsm[i, j] = 0.0  # sea
                elif lon < 72.5:
                    lsm[i, j] = 0.0
        logger.warning("Using synthetic land-sea mask — download ERA5/IMD LSM for production")
        return lsm

    # ── Edge construction ──────────────────────────────────────────────────────

    def _build_edges(self) -> tuple[torch.Tensor, torch.Tensor]:
        """Build 8-connectivity edge list with geographic edge features.

        Returns:
            edge_index: [2, num_edges] tensor
            edge_attr:  [num_edges, 3] tensor (distance_km, elev_diff, wind_dir)
        """
        src_list, dst_list = [], []
        attr_list = []

        # Normalizer for distance (max distance in pilot region ≈ 1900 km)
        max_dist = _haversine_km(self.lat_min, self.lon_min, self.lat_max, self.lon_max)

        for lat_i in range(self.nlat):
            for lon_j in range(self.nlon):
                src = self._node_idx(lat_i, lon_j)
                src_lat = self.lats[lat_i]
                src_lon = self.lons[lon_j]
                src_elev = self.elevation[lat_i, lon_j]

                for dlat, dlon in EIGHT_CONNECTIVITY:
                    ni, nj = lat_i + dlat, lon_j + dlon
                    if 0 <= ni < self.nlat and 0 <= nj < self.nlon:
                        dst = self._node_idx(ni, nj)
                        dst_lat = self.lats[ni]
                        dst_lon = self.lons[nj]
                        dst_elev = self.elevation[ni, nj]

                        dist = _haversine_km(src_lat, src_lon, dst_lat, dst_lon)
                        elev_diff = float(dst_elev - src_elev)

                        # Wind direction feature: dot product of edge direction
                        # with prevailing monsoon wind direction
                        edge_angle = np.arctan2(
                            dst_lat - src_lat, dst_lon - src_lon
                        )
                        wind_dot = float(np.cos(edge_angle - MONSOON_WIND_DIR))

                        src_list.append(src)
                        dst_list.append(dst)
                        attr_list.append([
                            dist / max_dist,  # normalized distance
                            elev_diff / 1000.0,  # km scale
                            wind_dot,  # [-1, 1]
                        ])

        edge_index = torch.tensor([src_list, dst_list], dtype=torch.long)
        edge_attr = torch.tensor(attr_list, dtype=torch.float32)
        return edge_index, edge_attr

    # ── Graph construction ─────────────────────────────────────────────────────

    def build_graph(
        self,
        ds: xr.Dataset,
        time_idx: int | None = None,
    ) -> GraphData:
        """Build a single-timestep Climate Graph.

        Args:
            ds: Normalized dataset with dynamic features and day_sin/day_cos coords.
            time_idx: Index of the timestep to use. If None, uses time_idx=0.

        Returns:
            PyTorch Geometric Data object with x, edge_index, edge_attr,
            static_features, and pos (lat/lon).
        """
        t = time_idx if time_idx is not None else 0

        # ── Dynamic node features ──────────────────────────────────────────
        def _get_var(name: str, default: float = 0.0) -> np.ndarray:
            if name in ds.data_vars:
                arr = ds[name].values
                return arr[t].reshape(-1).astype(np.float32)
            return np.full(self.num_nodes, default, dtype=np.float32)

        rainfall = _get_var("rainfall")
        tmax = _get_var("tmax")
        tmin = _get_var("tmin")
        lst = _get_var("insat_lst")
        sst = _get_var("insat_sst")

        # ── Temporal features ─────────────────────────────────────────────
        if "day_sin" in ds.coords:
            day_sin_val = float(ds.day_sin.values[t])
            day_cos_val = float(ds.day_cos.values[t])
        else:
            day_sin_val, day_cos_val = 0.0, 1.0
        day_sin = np.full(self.num_nodes, day_sin_val, dtype=np.float32)
        day_cos = np.full(self.num_nodes, day_cos_val, dtype=np.float32)

        # ── Monsoon features ──────────────────────────────────────────────
        # JJAS (June-July-August-September) = Indian summer monsoon season.
        # These two features let the model explicitly learn the wet/dry regime
        # shift and progress through the monsoon, which is the dominant signal
        # for Western Ghats rainfall.
        try:
            import pandas as _pd
            _ts = _pd.Timestamp(ds.time.values[t])
            _month = _ts.month
            _day_of_year = _ts.day_of_year
        except Exception:
            _month = 7  # assume mid-monsoon if parsing fails
            _day_of_year = 180
        jjas_flag = 1.0 if _month in {6, 7, 8, 9} else 0.0
        # Monsoon progress: 0 at Jun-1, 1 at Sep-30 (122-day season); 0 outside
        if jjas_flag:
            _monsoon_start_doy = 152  # ~Jun 1
            monsoon_prog = min((_day_of_year - _monsoon_start_doy) / 122.0, 1.0)
        else:
            monsoon_prog = 0.0
        jjas = np.full(self.num_nodes, jjas_flag, dtype=np.float32)
        monsoon_progress = np.full(self.num_nodes, float(monsoon_prog), dtype=np.float32)

        # ── Static features ───────────────────────────────────────────────
        elev = self.elevation.reshape(-1)
        lsm = self.land_sea_mask.reshape(-1)
        lat_grid = np.repeat(self.lats, self.nlon).astype(np.float32)
        lon_grid = np.tile(self.lons, self.nlat).astype(np.float32)
        # Normalize static features
        lat_center = (self.lat_min + self.lat_max) / 2.0
        lon_center = (self.lon_min + self.lon_max) / 2.0
        lat_scale = max((self.lat_max - self.lat_min) / 2.0, 1e-6)
        lon_scale = max((self.lon_max - self.lon_min) / 2.0, 1e-6)
        lat_norm = (lat_grid - lat_center) / lat_scale
        lon_norm = (lon_grid - lon_center) / lon_scale
        elev_norm = elev / 2000.0  # rough max elevation in region

        # ── Concatenate to node feature matrix ────────────────────────────
        # Order: rainfall, tmax, tmin, lst, sst,
        #        day_sin, day_cos, jjas_flag, monsoon_progress,
        #        elev, lsm, lat_norm, lon_norm
        # Total: 13 features (was 11; +jjas_flag, +monsoon_progress)
        x = np.stack([
            rainfall, tmax, tmin, lst, sst,
            day_sin, day_cos,
            jjas, monsoon_progress,
            elev_norm, lsm, lat_norm, lon_norm,
        ], axis=1)  # (num_nodes, 13)

        # ── Static features tensor (for graph-level ops) ──────────────────
        static = np.stack([elev, lsm, lat_grid, lon_grid], axis=1)  # (N, 4)

        return GraphData(
            x=torch.tensor(x, dtype=torch.float32),
            edge_index=self._edge_index,
            edge_attr=self._edge_attr,
            static_features=torch.tensor(static, dtype=torch.float32),
            pos=torch.tensor(
                np.stack([lat_grid, lon_grid], axis=1), dtype=torch.float32
            ),
        )

    def build_sequence_graph(
        self,
        ds: xr.Dataset,
        start_idx: int,
        length: int,
    ) -> GraphData:
        """Build a multi-timestep sequence graph for the transformer.

        The node feature tensor x has shape [num_nodes, seq_len, num_features].
        Each element x[node, t, :] contains the features for that node at that timestep.

        Args:
            ds: Normalized dataset.
            start_idx: Index of the first timestep.
            length: Number of timesteps.

        Returns:
            GraphData where x is [num_nodes, length, 11].
        """
        frames = []
        first_graph = None
        last_graph = None
        for t in range(start_idx, start_idx + length):
            g = self.build_graph(ds, time_idx=t)
            if first_graph is None:
                first_graph = g
            last_graph = g
            frames.append(g.x)  # (num_nodes, 11)

        x_seq = torch.stack(frames, dim=1)  # (num_nodes, length, 11)

        return GraphData(
            x=x_seq,
            edge_index=self._edge_index,
            edge_attr=self._edge_attr,
            static_features=first_graph.static_features if first_graph is not None else None,
            pos=last_graph.pos if last_graph is not None else None,
        )

    # ── Training sequence generation ──────────────────────────────────────────

    def create_training_sequences(
        self,
        ds: xr.Dataset,
        input_window: int = 30,
        target_window: int = 7,
    ) -> list[tuple[GraphData, torch.Tensor]]:
        """Generate (input_30days_graph, target_7days_tensor) pairs.

        Target tensor shape: [target_window, num_nodes, 3]
        where the last dim is [rainfall, tmax, tmin] (indices 0,1,2 of x).

        Returns:
            List of (input_graph, target_tensor) tuples.
            Length = T - input_window - target_window + 1.
        """
        ntime = ds.sizes["time"]
        total_len = input_window + target_window
        pairs = []

        for start in range(ntime - total_len + 1):
            # Input graph (30 days)
            input_graph = self.build_sequence_graph(ds, start, input_window)

            # Target: next 7 days, dynamic variables only (rainfall, tmax, tmin)
            target_frames = []
            for t in range(start + input_window, start + total_len):
                g = self.build_graph(ds, time_idx=t)
                # Extract rainfall(0), tmax(1), tmin(2) channels
                target_frames.append(g.x[:, :3])  # (num_nodes, 3)
            target_tensor = torch.stack(target_frames, dim=0)  # (7, num_nodes, 3)

            pairs.append((input_graph, target_tensor))

        logger.info(
            "Generated %d training sequences (window=%d+%d) from %d timesteps",
            len(pairs),
            input_window,
            target_window,
            ntime,
        )
        return pairs

    # ── Accessors ─────────────────────────────────────────────────────────────

    @property
    def edge_index(self) -> torch.Tensor:
        return self._edge_index

    @property
    def edge_attr(self) -> torch.Tensor:
        return self._edge_attr

    def get_ghats_ridge_mask(self) -> torch.Tensor:
        """Boolean mask of nodes on the Western Ghats ridge (lon ≈ 73-74.5°E).

        Used to exempt orographic barriers from spatial smoothness loss.
        """
        mask = np.zeros(self.num_nodes, dtype=bool)
        for lat_i in range(self.nlat):
            for lon_j in range(self.nlon):
                lon = self.lons[lon_j]
                if 73.0 <= lon <= 74.5:
                    mask[self._node_idx(lat_i, lon_j)] = True
        return torch.tensor(mask, dtype=torch.bool)

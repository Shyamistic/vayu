"""Lazy sliding-window sequence dataset built directly from a normalized NetCDF.

Why this exists
---------------
The pre-built ``train_sequences.pt`` bundles materialize every window as its own
tensor, so they are capped for size: the v2 regional bundles hold **512** train
windows even though 2010-2021 offers ~4,347 at stride 1. Measured effect: the
Western Ghats / North-East runs plateaued with R²_tmax barely above the
persistence baseline (0.75 vs 0.72), the classic signature of too little data
for a 6.6M-parameter model.

Materializing all windows is not an option — 4,347 windows x 1,311 nodes x 30
days x 17 features x 4 bytes is ~11.6 GB, more RAM than a Kaggle T4 session has.

Instead this module holds ONE dense ``(nodes, time, features)`` array (~520 MB
for a region: 5,844 x 1,311 x 17 x 4 bytes) and slices windows on demand. Every
window at stride 1 becomes available at a fraction of the memory, and no
re-upload of the Kaggle datasets is needed because ``normalized_*.nc`` is
already inside each bundle.

Window/target construction is identical to
``ClimateGraphBuilder.create_training_sequences``: input is ``input_window``
days of all features, target is the following ``target_window`` days of
channels 0:3 (rainfall, tmax, tmin), shaped ``(target_window, nodes, 3)``.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import torch
import xarray as xr
from torch.utils.data import Dataset
from torch_geometric.data import Data as GraphData

logger = logging.getLogger(__name__)


class DenseRegionTensor:
    """Dense per-region feature tensor plus static graph topology.

    Attributes:
        x: (num_nodes, num_time, num_features) float32
        edge_index / edge_attr: shared graph topology
        pos: (num_nodes, 2) lat/lon
        times: pandas DatetimeIndex of length num_time
    """

    def __init__(
        self,
        x: torch.Tensor,
        edge_index: torch.Tensor,
        edge_attr: torch.Tensor | None,
        pos: torch.Tensor | None,
        static_features: torch.Tensor | None,
        times: np.ndarray,
        feature_names: list[str],
    ):
        self.x = x
        self.edge_index = edge_index
        self.edge_attr = edge_attr
        self.pos = pos
        self.static_features = static_features
        self.times = times
        self.feature_names = feature_names

    @property
    def num_time(self) -> int:
        return int(self.x.shape[1])

    @property
    def num_nodes(self) -> int:
        return int(self.x.shape[0])


def rescale_unstandardized_channels(
    x: torch.Tensor,
    feature_names: list[str],
    times: np.ndarray,
    fit_years: tuple[int, int],
    lo: float = 0.05,
    hi: float = 3.0,
) -> list[str]:
    """Z-score any channel that was never standardized, in place.

    Measured on the real v2 datasets, the atmospheric channels reach the model in
    RAW physical units while everything else is a per-cell z-score:

        channel      std      corr with next-day rainfall
        uwnd_850    6.3791    +0.2417
        vwnd_850    2.6458    -0.0579
        shum_850    0.0027    +0.3189   <-- strongest real predictor
        rainfall    0.7629    +0.5106
        tmax        0.9800    -0.2208

    So inputs span a ~2400x dynamic range and specific humidity — the single most
    informative atmospheric field — is numerically invisible next to the winds.
    Statistics are computed over ``fit_years`` only, so this adds no leakage.

    Channels legitimately living on a bounded scale (day_sin/cos, land/sea mask,
    lat/lon, elevation) fall inside [lo, hi] and are left untouched.

    Returns the list of channel names that were rescaled.
    """
    years = xr.DataArray(times).dt.year.values
    fit_mask = (years >= fit_years[0]) & (years <= fit_years[1])
    rescaled: list[str] = []

    for c in range(x.shape[2]):
        ch = x[:, fit_mask, c]
        std = float(ch.std())
        if std < 1e-8:
            continue  # dead channel; rescaling would divide by ~0
        if lo <= std <= hi:
            continue  # already on a sane scale
        mean = float(ch.mean())
        x[:, :, c] = (x[:, :, c] - mean) / std
        rescaled.append(f"{feature_names[c]} (std {std:.4g} -> 1.0)")

    if rescaled:
        logger.info("Rescaled unstandardized channels: %s", ", ".join(rescaled))
    return rescaled


def report_dead_channels(x: torch.Tensor, feature_names: list[str]) -> list[str]:
    """Log channels carrying no information so they are visible, not silent.

    Measured: insat_lst / insat_sst / chirps_rain are 100% zeros in every region,
    and uwnd/vwnd/shum are additionally all-zero for Indo-Gangetic and Central
    India — i.e. those regions have no moisture or circulation predictor at all,
    which bounds their achievable rainfall skill at climatology.
    """
    dead = [
        feature_names[c]
        for c in range(x.shape[2])
        if float(x[:, :, c].std()) < 1e-8
    ]
    if dead:
        logger.warning(
            "%d/%d input channels are CONSTANT and carry no signal: %s",
            len(dead), x.shape[2], ", ".join(dead),
        )
    return dead


def build_dense_region_tensor(
    normalized_file: str | Path,
    elevation_file: str | Path | None = None,
    lsm_file: str | Path | None = None,
    resolution: float = 0.25,
    include_missingness_indicators: bool = False,
    fillna_value: float | None = 0.0,
) -> DenseRegionTensor:
    """Build the dense (nodes, time, features) tensor once from a normalized file."""
    from data_ingestion.graph_builder import ClimateGraphBuilder

    ds = xr.open_dataset(normalized_file)
    if fillna_value is not None:
        ds = ds.fillna(fillna_value)

    # NOTE: from_dataset infers grid resolution from the dataset's own lat/lon
    # spacing, so `resolution` is accepted for API symmetry but not forwarded.
    builder = ClimateGraphBuilder.from_dataset(
        ds,
        elevation_path=elevation_file,
        land_sea_mask_path=lsm_file,
        include_missingness_indicators=include_missingness_indicators,
    )

    ntime = int(ds.sizes["time"])
    # One call builds the whole time axis as a single sequence graph:
    # x has shape (num_nodes, ntime, num_features).
    graph = builder.build_sequence_graph(ds, 0, ntime)
    x = graph.x.to(torch.float32).contiguous()

    times = ds["time"].values
    logger.info(
        "Dense region tensor: nodes=%d time=%d features=%d (%.0f MB)",
        x.shape[0], x.shape[1], x.shape[2],
        x.numel() * x.element_size() / 1e6,
    )
    ds.close()

    return DenseRegionTensor(
        x=x,
        edge_index=graph.edge_index,
        edge_attr=getattr(graph, "edge_attr", None),
        pos=getattr(graph, "pos", None),
        static_features=getattr(graph, "static_features", None),
        times=times,
        feature_names=list(builder.feature_names),
    )


def build_doy_climatology(
    dense: DenseRegionTensor,
    fit_years: tuple[int, int],
    smooth_days: int = 15,
    num_target_vars: int = 3,
) -> torch.Tensor:
    """Per-cell day-of-year climatology for the target variables.

    Fitted on ``fit_years`` ONLY (the training period) so it introduces no
    validation/test leakage; it is a function of calendar date, which is known
    in advance for any forecast target day.

    Measured value of this baseline on real WG 2022 validation data
    (normalized space, pooled over 7 lead times):
        rainfall R² = +0.215   (persistence: -0.303)
        tmax     R² = +0.739   (persistence: +0.722)
        tmin     R² = +0.776   (persistence: +0.721)

    Returns:
        (366, num_nodes, num_target_vars) float32
    """
    years = xr.DataArray(dense.times).dt.year.values
    doy = xr.DataArray(dense.times).dt.dayofyear.values
    fit_mask = (years >= fit_years[0]) & (years <= fit_years[1])
    if not fit_mask.any():
        raise ValueError(f"No timesteps inside climatology fit range {fit_years}")

    x = dense.x[:, :, :num_target_vars].numpy()   # (N, T, V)
    n_nodes = x.shape[0]
    clim = np.zeros((366, n_nodes, num_target_vars), dtype=np.float32)

    for d in range(1, 367):
        sel = fit_mask & (doy == d)
        if sel.any():
            clim[d - 1] = np.nanmean(x[:, sel, :], axis=1)
        else:
            clim[d - 1] = np.nan

    # Fill any empty day (e.g. Feb 29 in a fit range without leap years)
    for d in range(366):
        if np.isnan(clim[d]).all():
            clim[d] = clim[d - 1]
    clim = np.nan_to_num(clim, nan=0.0)

    # Circular smoothing over day-of-year to suppress sampling noise
    if smooth_days and smooth_days > 1:
        k = np.ones(smooth_days, dtype=np.float32) / smooth_days
        pad = smooth_days
        ext = np.concatenate([clim[-pad:], clim, clim[:pad]], axis=0)
        sm = np.empty_like(ext)
        flat = ext.reshape(ext.shape[0], -1)
        out = np.empty_like(flat)
        for j in range(flat.shape[1]):
            out[:, j] = np.convolve(flat[:, j], k, mode="same")
        sm = out.reshape(ext.shape)
        clim = sm[pad:-pad]

    logger.info(
        "Day-of-year climatology fitted on %d-%d (%d days, %d-day smoothing)",
        fit_years[0], fit_years[1], int(fit_mask.sum()), smooth_days,
    )
    return torch.from_numpy(np.ascontiguousarray(clim))


def window_starts_for_years(
    dense: DenseRegionTensor,
    start_year: int,
    end_year: int,
    input_window: int = 30,
    target_window: int = 7,
    stride: int = 1,
) -> list[int]:
    """Window start indices whose FIRST target day falls in [start_year, end_year].

    Matches the calendar-split convention used by ``build-sequences``
    (``first_target_date`` in sequence_manifest.json), so a lazily generated
    split covers exactly the same period as the pre-built one — just densely.
    """
    years = xr.DataArray(dense.times).dt.year.values
    total = input_window + target_window
    starts: list[int] = []
    for s in range(0, dense.num_time - total + 1, stride):
        first_target_year = int(years[s + input_window])
        if start_year <= first_target_year <= end_year:
            starts.append(s)
    return starts


class WindowedSequenceDataset(Dataset):
    """Slices (input_graph, target_tensor) pairs out of a DenseRegionTensor.

    Drop-in compatible with ``_collate_sequences``: yields the same
    ``(GraphData, target)`` structure as the pre-built ``.pt`` sequences.
    """

    def __init__(
        self,
        dense: DenseRegionTensor,
        starts: list[int],
        input_window: int = 30,
        target_window: int = 7,
        climatology: torch.Tensor | None = None,
    ):
        self.dense = dense
        self.starts = list(starts)
        self.input_window = int(input_window)
        self.target_window = int(target_window)
        self.climatology = climatology
        # Always available so evaluation can mask to a season (e.g. JJAS)
        # regardless of whether the climatology baseline is in use.
        self._doy = xr.DataArray(dense.times).dt.dayofyear.values

    def __len__(self) -> int:
        return len(self.starts)

    def __getitem__(self, idx: int) -> tuple[GraphData, torch.Tensor]:
        s = self.starts[idx]
        iw, tw = self.input_window, self.target_window

        x_win = self.dense.x[:, s : s + iw, :]                    # (N, iw, F)
        # Targets: channels 0:3 over the following tw days → (tw, N, 3)
        y = self.dense.x[:, s + iw : s + iw + tw, :3].permute(1, 0, 2).contiguous()

        graph = GraphData(
            x=x_win,
            edge_index=self.dense.edge_index,
            edge_attr=self.dense.edge_attr,
        )
        if self.dense.pos is not None:
            graph.pos = self.dense.pos
        if self.dense.static_features is not None:
            graph.static_features = self.dense.static_features
        if self.climatology is not None:
            # Climatology for the TARGET days → (N, tw, 3)
            doy_idx = self._doy[s + iw : s + iw + tw] - 1
            graph.clim_future = self.climatology[doy_idx].permute(1, 0, 2).contiguous()

        # Day-of-year for each target day, independent of the climatology
        # baseline. Lets evaluation mask to the monsoon season (JJAS) without
        # needing full calendar dates on every downstream consumer.
        doy_full = xr.DataArray(self.dense.times).dt.dayofyear.values
        graph.target_doy = torch.from_numpy(
            doy_full[s + iw : s + iw + tw].astype(np.int64)
        )
        return graph, y


def build_windowed_splits(
    normalized_file: str | Path,
    elevation_file: str | Path | None = None,
    lsm_file: str | Path | None = None,
    train_years: tuple[int, int] = (2010, 2021),
    val_years: tuple[int, int] = (2022, 2022),
    test_years: tuple[int, int] = (2023, 2025),
    input_window: int = 30,
    target_window: int = 7,
    train_stride: int = 1,
    eval_stride: int = 1,
    resolution: float = 0.25,
    include_missingness_indicators: bool = False,
    use_climatology_baseline: bool = True,
    climatology_smooth_days: int = 15,
    rescale_channels: bool = True,
) -> tuple[WindowedSequenceDataset, WindowedSequenceDataset, WindowedSequenceDataset, DenseRegionTensor]:
    """Build leakage-safe calendar-split lazy datasets from one normalized file."""
    dense = build_dense_region_tensor(
        normalized_file,
        elevation_file=elevation_file,
        lsm_file=lsm_file,
        resolution=resolution,
        include_missingness_indicators=include_missingness_indicators,
    )

    report_dead_channels(dense.x, dense.feature_names)
    if rescale_channels:
        rescale_unstandardized_channels(
            dense.x, dense.feature_names, dense.times, fit_years=train_years
        )

    climatology = None
    if use_climatology_baseline:
        # Fitted on TRAIN YEARS ONLY — same period as the normalization stats.
        climatology = build_doy_climatology(
            dense, fit_years=train_years, smooth_days=climatology_smooth_days
        )

    def make(years: tuple[int, int], stride: int) -> WindowedSequenceDataset:
        starts = window_starts_for_years(
            dense, years[0], years[1], input_window, target_window, stride
        )
        return WindowedSequenceDataset(
            dense, starts, input_window, target_window, climatology=climatology
        )

    train = make(train_years, train_stride)
    val = make(val_years, eval_stride)
    test = make(test_years, eval_stride)

    logger.info(
        "Windowed splits (stride train=%d eval=%d): train=%d val=%d test=%d windows",
        train_stride, eval_stride, len(train), len(val), len(test),
    )
    return train, val, test, dense

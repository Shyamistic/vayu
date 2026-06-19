"""Pytest fixtures shared across all test modules."""

from __future__ import annotations

import numpy as np
import pytest
import torch
import xarray as xr


@pytest.fixture
def pilot_rainfall_ds():
    """Small synthetic rainfall dataset on the pilot region grid."""
    lats = np.arange(8.0, 20.25, 0.25)  # 49 points
    lons = np.arange(72.0, 78.25, 0.25)  # 25 points
    rng = np.random.default_rng(0)
    ndays = 40

    import pandas as pd
    times = pd.date_range("2023-01-01", periods=ndays)

    data = np.abs(rng.normal(5, 8, (ndays, len(lats), len(lons)))).astype(np.float32)
    return xr.Dataset(
        {"rainfall": xr.DataArray(data, dims=["time", "lat", "lon"])},
        coords={"time": times, "lat": lats, "lon": lons},
    )


@pytest.fixture
def pilot_tmax_ds():
    """Synthetic Tmax dataset at 1° resolution."""
    lats = np.arange(7.5, 38.0, 1.0)
    lons = np.arange(67.5, 100.0, 1.0)
    rng = np.random.default_rng(1)
    ndays = 40

    import pandas as pd
    times = pd.date_range("2023-01-01", periods=ndays)
    data = rng.normal(32, 5, (ndays, len(lats), len(lons))).astype(np.float32)
    return xr.Dataset(
        {"tmax": xr.DataArray(data, dims=["time", "lat", "lon"])},
        coords={"time": times, "lat": lats, "lon": lons},
    )


@pytest.fixture
def small_graph_batch():
    """Minimal graph batch for model tests (10 nodes, 30-day sequence)."""
    from data_ingestion.graph_builder import ClimateGraphBuilder
    builder = ClimateGraphBuilder()  # uses synthetic elevation/lsm
    num_nodes = builder.num_nodes
    seq_len = 30

    x = torch.randn(num_nodes, seq_len, 11)
    return type("GraphBatch", (), {
        "x": x,
        "edge_index": builder.edge_index,
        "edge_attr": builder.edge_attr,
    })()

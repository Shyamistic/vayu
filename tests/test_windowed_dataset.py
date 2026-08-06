"""Tests for the lazy sliding-window dataset and its train-only climatology."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
import torch
import xarray as xr

from ai_engine.windowed_dataset import (
    DenseRegionTensor,
    WindowedSequenceDataset,
    build_doy_climatology,
    window_starts_for_years,
)

IW, TW = 5, 3
NODES = 6


def _dense(years: tuple[int, int] = (2010, 2013)) -> DenseRegionTensor:
    times = pd.date_range(f"{years[0]}-01-01", f"{years[1]}-12-31", freq="D")
    t = len(times)
    rng = np.random.default_rng(0)
    # Channel 0 carries a strong seasonal cycle so climatology is meaningful.
    doy = times.dayofyear.values.astype(np.float32)
    seasonal = np.sin(2 * np.pi * doy / 365.0)
    x = rng.normal(0, 0.1, size=(NODES, t, 4)).astype(np.float32)
    x[:, :, 0] += seasonal
    edge_index = torch.stack([
        torch.arange(NODES - 1), torch.arange(1, NODES)
    ])
    return DenseRegionTensor(
        x=torch.from_numpy(x),
        edge_index=edge_index,
        edge_attr=torch.ones(edge_index.shape[1], 1),
        pos=torch.zeros(NODES, 2),
        static_features=None,
        times=times.values,
        feature_names=["rainfall", "tmax", "tmin", "other"],
    )


def test_window_starts_respect_calendar_split():
    dense = _dense()
    train = window_starts_for_years(dense, 2010, 2011, IW, TW, stride=1)
    val = window_starts_for_years(dense, 2012, 2012, IW, TW, stride=1)
    assert train and val
    assert not set(train) & set(val), "splits must be disjoint"

    years = xr.DataArray(dense.times).dt.year.values
    # Assignment is by FIRST TARGET day, matching build-sequences' manifest.
    for s in val:
        assert years[s + IW] == 2012


def test_stride_one_yields_far_more_windows_than_stride_twelve():
    dense = _dense()
    dense_starts = window_starts_for_years(dense, 2010, 2013, IW, TW, stride=1)
    sparse_starts = window_starts_for_years(dense, 2010, 2013, IW, TW, stride=12)
    assert len(dense_starts) > 10 * len(sparse_starts)


def test_dataset_shapes_and_target_alignment():
    dense = _dense()
    starts = window_starts_for_years(dense, 2011, 2011, IW, TW, stride=1)
    ds = WindowedSequenceDataset(dense, starts, IW, TW)
    g, y = ds[0]

    assert g.x.shape == (NODES, IW, 4)
    assert y.shape == (TW, NODES, 3)

    s = starts[0]
    # Input window is the IW days ending just before the target window.
    assert torch.allclose(g.x, dense.x[:, s : s + IW, :])
    # Targets are the NEXT TW days, channels 0:3, transposed to (TW, N, 3).
    assert torch.allclose(y, dense.x[:, s + IW : s + IW + TW, :3].permute(1, 0, 2))


def test_climatology_is_fitted_on_train_years_only():
    """Leakage guard: a climatology fitted on 2010-2011 must not change when
    2012-2013 data is altered."""
    dense = _dense()
    clim_a = build_doy_climatology(dense, fit_years=(2010, 2011), smooth_days=1)

    years = xr.DataArray(dense.times).dt.year.values
    perturbed = dense.x.clone()
    perturbed[:, years >= 2012, :] += 50.0
    dense_b = DenseRegionTensor(
        x=perturbed, edge_index=dense.edge_index, edge_attr=dense.edge_attr,
        pos=dense.pos, static_features=None, times=dense.times,
        feature_names=dense.feature_names,
    )
    clim_b = build_doy_climatology(dense_b, fit_years=(2010, 2011), smooth_days=1)

    assert torch.allclose(clim_a, clim_b), "climatology leaked out-of-sample data"


def test_climatology_shape_and_seasonal_signal():
    dense = _dense()
    clim = build_doy_climatology(dense, fit_years=(2010, 2013), smooth_days=1)
    assert clim.shape == (366, NODES, 3)
    # Channel 0 was built with a sine cycle → climatology must vary by day.
    assert clim[:, :, 0].std() > 0.3


def test_clim_future_matches_target_day_of_year():
    dense = _dense()
    clim = build_doy_climatology(dense, fit_years=(2010, 2011), smooth_days=1)
    starts = window_starts_for_years(dense, 2012, 2012, IW, TW, stride=1)
    ds = WindowedSequenceDataset(dense, starts, IW, TW, climatology=clim)

    g, y = ds[0]
    assert g.clim_future.shape == (NODES, TW, 3)

    s = starts[0]
    doy = xr.DataArray(dense.times).dt.dayofyear.values
    expected = clim[doy[s + IW : s + IW + TW] - 1].permute(1, 0, 2)
    assert torch.allclose(g.clim_future, expected)


def test_no_climatology_means_no_clim_future_attribute():
    dense = _dense()
    starts = window_starts_for_years(dense, 2011, 2011, IW, TW, stride=1)
    ds = WindowedSequenceDataset(dense, starts, IW, TW, climatology=None)
    g, _ = ds[0]
    assert getattr(g, "clim_future", None) is None


def test_climatology_rejects_empty_fit_range():
    dense = _dense()
    with pytest.raises(ValueError, match="No timesteps"):
        build_doy_climatology(dense, fit_years=(1990, 1991))


# ── Channel scaling / dead-channel detection ──────────────────────────────────

def test_rescales_only_unstandardized_channels():
    """Atmospheric channels reach the model in raw units (measured: uwnd std 6.38,
    shum std 0.0027) while the rest are z-scores, a ~2400x range. Rescale those
    two kinds of channel and leave bounded ones (day_sin, lat, lsm) alone."""
    from ai_engine.windowed_dataset import rescale_unstandardized_channels

    dense = _dense()
    x = dense.x.clone()
    # ch0 huge (raw wind-like), ch1 tiny (raw humidity-like), ch2/3 already sane
    x[:, :, 0] *= 6.5
    x[:, :, 1] *= 0.0027
    before_ok = x[:, :, 2].clone()

    names = ["wind_like", "humid_like", "already_z", "bounded"]
    rescaled = rescale_unstandardized_channels(
        x, names, dense.times, fit_years=(2010, 2013)
    )

    assert any("wind_like" in r for r in rescaled)
    assert any("humid_like" in r for r in rescaled)
    assert not any("already_z" in r for r in rescaled)

    for c in (0, 1):
        assert abs(float(x[:, :, c].std()) - 1.0) < 0.05
    assert torch.allclose(x[:, :, 2], before_ok), "sane channel must be untouched"


def test_rescaling_uses_train_years_only():
    """Leakage guard: rescaling stats must ignore out-of-sample years."""
    from ai_engine.windowed_dataset import rescale_unstandardized_channels

    years = xr.DataArray(_dense().times).dt.year.values

    def run(perturb: bool) -> torch.Tensor:
        d = _dense()
        x = d.x.clone()
        x[:, :, 0] *= 6.5
        if perturb:
            x[:, years >= 2012, 0] += 500.0
        rescale_unstandardized_channels(
            x, ["a", "b", "c", "d"], d.times, fit_years=(2010, 2011)
        )
        return x[:, years < 2012, 0]

    # Train-period values must be scaled identically regardless of later years.
    assert torch.allclose(run(False), run(True), atol=1e-4)


def test_dead_channels_are_reported():
    """insat_lst / insat_sst / chirps_rain are 100% zeros in every real region,
    and IGP/Central additionally have no wind or humidity at all."""
    from ai_engine.windowed_dataset import report_dead_channels

    dense = _dense()
    x = dense.x.clone()
    x[:, :, 3] = 0.0
    dead = report_dead_channels(x, ["a", "b", "c", "dead_one"])
    assert dead == ["dead_one"]


def test_dead_channel_is_not_rescaled():
    """Rescaling a constant channel would divide by ~zero."""
    from ai_engine.windowed_dataset import rescale_unstandardized_channels

    dense = _dense()
    x = dense.x.clone()
    x[:, :, 3] = 0.0
    rescaled = rescale_unstandardized_channels(
        x, ["a", "b", "c", "dead_one"], dense.times, fit_years=(2010, 2013)
    )
    assert not any("dead_one" in r for r in rescaled)
    assert float(x[:, :, 3].std()) == 0.0

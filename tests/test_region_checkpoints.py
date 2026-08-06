"""Per-region checkpoint loading and per-cell denormalization.

Backs the WhatsApp handoff (Siddharth wiring backend, Srishti building a
frontend mock): the API previously loaded one global checkpoint regardless of
`region`, and denormalized every region's output with Western Ghats-derived
flat constants. Both are real correctness bugs for the other three trained
regions, not just missing features.
"""

from __future__ import annotations

import numpy as np
import pytest

from backend import main as backend_main


@pytest.fixture(autouse=True)
def _clear_caches():
    """Each test should see a clean lazy-load cache, not a previous test's model."""
    backend_main._region_models.clear()
    backend_main._norm_params_cache.clear()
    backend_main._resolved_dataset_paths.clear()
    yield
    backend_main._region_models.clear()
    backend_main._norm_params_cache.clear()
    backend_main._resolved_dataset_paths.clear()


def test_region_checkpoint_dirs_cover_every_trained_region():
    """Every region with a dedicated notebook must have an explicit checkpoint
    path — a silently-missing entry would fall back to the global model without
    any signal that the "region" selector did nothing."""
    trained_regions = {
        "western_ghats", "north_east_india", "indo_gangetic_plain", "central_india",
    }
    assert trained_regions <= set(backend_main._REGION_CHECKPOINT_DIRS)


def test_get_region_model_falls_back_when_checkpoint_absent(monkeypatch, tmp_path):
    """A region with no checkpoint on disk must reuse the global model rather
    than silently returning None (which would drop the request to mock data)."""
    monkeypatch.setitem(
        backend_main._REGION_CHECKPOINT_DIRS, "central_india",
        str(tmp_path / "does_not_exist.pt"),
    )
    sentinel = object()
    monkeypatch.setattr(backend_main, "_model", sentinel)
    assert backend_main._get_region_model("central_india") is sentinel


def test_get_region_model_unknown_region_uses_global(monkeypatch):
    """A region with no entry in the map keeps working exactly as it did before
    per-region loading existed, rather than returning None and dropping to mock.

    Deliberately uses a region that is NOT in _REGION_CHECKPOINT_DIRS. This test
    previously used full_india as its example, which silently stopped testing the
    fallback once full_india got its own trained checkpoint — the assertion then
    failed for the right reason, but the coverage had already been lost.
    """
    unmapped = "some_future_region"
    assert unmapped not in backend_main._REGION_CHECKPOINT_DIRS
    sentinel = object()
    monkeypatch.setattr(backend_main, "_model", sentinel)
    assert backend_main._get_region_model(unmapped) is sentinel


def test_full_india_has_its_own_checkpoint_entry():
    """full_india was trained separately (0.5 deg, 4,288 nodes) and must not
    silently reuse the global model.

    The fallback in _get_region_model is intentionally silent, so a missing entry
    here produces plausible predictions from the wrong weights with no warning.
    That is exactly how this went unnoticed until the served values were compared
    before and after adding the entry (rain_mean 7.88 -> 8.194).
    """
    assert "full_india" in backend_main._REGION_CHECKPOINT_DIRS
    assert backend_main._REGION_CHECKPOINT_DIRS["full_india"] != backend_main._REGION_CHECKPOINT_DIRS["western_ghats"]


def test_get_region_model_loads_and_caches_distinct_checkpoints():
    """western_ghats and central_india must resolve to two different loaded
    model objects, proving the region argument actually changes what's used."""
    import torch
    from pathlib import Path

    wg_path = Path(backend_main._REGION_CHECKPOINT_DIRS["western_ghats"])
    ci_path = Path(backend_main._REGION_CHECKPOINT_DIRS["central_india"])
    if not (wg_path.exists() and ci_path.exists()):
        pytest.skip("region checkpoints not present on this machine")

    wg_model = backend_main._get_region_model("western_ghats")
    ci_model = backend_main._get_region_model("central_india")

    assert wg_model is not None and ci_model is not None
    assert wg_model is not ci_model
    # Second call must hit the cache, not reload from disk.
    assert backend_main._get_region_model("western_ghats") is wg_model

    wg_w = next(iter(wg_model.state_dict().values()))
    ci_w = next(iter(ci_model.state_dict().values()))
    assert not torch.equal(wg_w, ci_w), "distinct checkpoints loaded identical weights"


def test_resolve_norm_params_returns_per_cell_arrays_not_scalars():
    """The bug being fixed: denormalization must vary by grid cell, not use one
    Western Ghats-derived number for the whole country."""
    params = backend_main._resolve_norm_params("western_ghats")
    if params is None:
        pytest.skip("no normalized dataset present on this machine")

    rain_mean = params["rainfall_mean"]
    assert rain_mean.ndim == 1
    assert rain_mean.size > 1
    # Real climatology varies across the grid; a flat scalar would fail this.
    assert np.nanstd(rain_mean) > 0.01


def test_resolve_norm_params_differs_between_regions():
    """Central India and Western Ghats have different rainfall climatology —
    if this fails, the two regions are silently sharing one file."""
    wg = backend_main._resolve_norm_params("western_ghats")
    ci = backend_main._resolve_norm_params("central_india")
    if wg is None or ci is None:
        pytest.skip("normalized datasets not present on this machine")

    assert not np.array_equal(
        np.sort(wg["rainfall_mean"])[: min(wg["rainfall_mean"].size, ci["rainfall_mean"].size)],
        np.sort(ci["rainfall_mean"])[: min(wg["rainfall_mean"].size, ci["rainfall_mean"].size)],
    )


# ── Real static rasters reach the model input ────────────────────────────────


def test_every_region_maps_to_a_static_raster_dir():
    """Each region serving real data needs real terrain, not the synthetic ridge."""
    for region in backend_main._REGION_DATA_DIRS:
        assert region in backend_main._REGION_STATIC_DIRS, (
            f"{region} has a dataset but no static raster directory, so inference "
            f"would fall back to synthetic elevation/land-sea mask"
        )


def test_full_india_static_dir_is_the_half_degree_build():
    """full_india must NOT reuse the 0.25 deg static_full_india rasters.

    The 0.25 deg grid is 6.5/6.75/7.0..., the 0.5 deg grid is 6.625/7.125/... —
    they share no latitude value, so an inner join on coordinates yields an empty
    set rather than raising.
    """
    assert backend_main._REGION_STATIC_DIRS["full_india"] == "static_full_india_05"


def test_elevation_and_land_sea_mask_are_model_input_channels():
    """Pins WHY passing the rasters matters: they are input features, not metadata.

    Measured on the full-India grid, synthetic elevation topped out at 1,491 m
    against a real 6,737 m, and the land_sea_mask channel differed by up to 1.0 —
    i.e. cells were on the wrong side of the coastline. Serving those to a model
    trained on the real rasters is a train/serve mismatch that leaves predictions
    looking plausible.
    """
    from data_ingestion.graph_builder import ClimateGraphBuilder

    builder = ClimateGraphBuilder()
    names = builder.feature_names
    assert "elevation" in names, "elevation must be a model input feature"
    assert "land_sea_mask" in names, "land_sea_mask must be a model input feature"
    # Guard the slice in _get_real_predictions: it truncates x to
    # model.config.gnn_in_features, so these must sit inside that width.
    assert names.index("elevation") < 17
    assert names.index("land_sea_mask") < 17


def test_resolve_static_rasters_returns_none_pair_for_unmapped_region():
    """An unmapped region must degrade to synthetic rather than raise."""
    elevation, lsm = backend_main._resolve_static_rasters("some_future_region")
    assert elevation is None and lsm is None

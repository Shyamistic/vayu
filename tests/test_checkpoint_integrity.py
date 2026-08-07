"""Tests for checkpoint-load reporting.

The failure this guards against is specific and was live in the repo: a
checkpoint saved before the learned-baseline-blend head refactor still loads
under ``strict=False``, and because
:class:`~ai_engine.prediction_heads.SingleVariableHead` zero-initialises
``out.weight``/``out.bias`` by design, an unfilled head emits ``delta = 0``
*exactly*. The model then returns
``w_persistence * persistence + w_climatology * climatology`` — the floor it
exists to beat — while raising nothing and reporting healthy.

So these tests assert the reporting is loud and specific rather than a count, and
they assert the degenerate output equality directly rather than trusting the
argument above.
"""

from __future__ import annotations

import logging

import pytest

torch = pytest.importorskip("torch")

from ai_engine.climate_model import describe_load  # noqa: E402
from ai_engine.prediction_heads import SingleVariableHead  # noqa: E402


# ── The physical claim: an unfilled head IS the baseline blend ────────────────


class TestZeroInitHeadDegeneratesToBaseline:
    def test_untrained_head_returns_exactly_the_blend(self):
        head = SingleVariableHead(
            d_model=32, forecast_horizon=7,
            persistence_init=0.14, climatology_init=0.86,
        )
        head.eval()

        n = 5
        ctx = torch.randn(n, 32)
        last = torch.randn(n, 1)
        trend = torch.randn(n, 1)
        clim = torch.randn(n, 7)

        with torch.no_grad():
            out = head(ctx, last, trend, clim)
            expected = 0.14 * last.expand(-1, 7) + 0.86 * clim

        # Exact, not approximate: out.weight is zeros, so delta is identically 0
        # regardless of what the random proj/fc2 weights contain. This is why a
        # missing head does not look like noise.
        torch.testing.assert_close(out, expected, rtol=0, atol=1e-6)

    def test_a_nonzero_residual_layer_moves_the_output(self):
        head = SingleVariableHead(d_model=32, forecast_horizon=7)
        head.eval()
        n = 5
        ctx, last, trend = torch.randn(n, 32), torch.randn(n, 1), torch.randn(n, 1)
        clim = torch.randn(n, 7)

        with torch.no_grad():
            before = head(ctx, last, trend, clim)
            torch.nn.init.normal_(head.out.weight, std=0.5)
            after = head(ctx, last, trend, clim)

        assert not torch.allclose(before, after), (
            "if training the residual layer cannot change the output, the "
            "degenerate-head check below would be meaningless"
        )


# ── The report ───────────────────────────────────────────────────────────────


class _Tiny(torch.nn.Module):
    """Smallest model with the shape that matters: a named head ending in `out`."""

    def __init__(self):
        super().__init__()
        self.encoder = torch.nn.Linear(4, 4)
        self.heads = torch.nn.ModuleDict({"rainfall": SingleVariableHead(d_model=8)})


class TestDescribeLoad:
    def test_clean_load_is_reported_as_fully_loaded(self, caplog):
        model = _Tiny()
        with caplog.at_level(logging.INFO):
            report = describe_load(model, [], [], source="clean.pt")

        assert report["fully_loaded"] is True
        assert report["heads_untrained"] is False
        assert report["missing_count"] == 0
        assert report["missing_params"] == 0
        assert not any(r.levelno >= logging.WARNING for r in caplog.records)

    def test_missing_head_output_layer_logs_error_and_flags_degenerate(self, caplog):
        model = _Tiny()
        missing = [
            "heads.rainfall.out.weight",
            "heads.rainfall.out.bias",
            "heads.rainfall.proj.weight",
        ]
        with caplog.at_level(logging.INFO):
            report = describe_load(model, missing, [], source="stale.pt")

        assert report["heads_untrained"] is True
        assert report["degenerate_heads"] == ["heads.rainfall"]
        # ERROR, not WARNING: this one silently substitutes the baseline for the
        # model, which is a wrong answer rather than a degraded one.
        errors = [r for r in caplog.records if r.levelno >= logging.ERROR]
        assert errors, "a degenerate head must be logged at ERROR"
        text = errors[0].getMessage()
        assert "persistence/climatology baseline blend" in text
        assert "stale.pt" in text

    def test_missing_non_head_tensors_warn_but_do_not_flag_degenerate(self, caplog):
        model = _Tiny()
        with caplog.at_level(logging.INFO):
            report = describe_load(model, ["encoder.weight"], [], source="partial.pt")

        assert report["heads_untrained"] is False
        assert report["fully_loaded"] is False
        assert [r for r in caplog.records if r.levelno == logging.WARNING]
        assert not [r for r in caplog.records if r.levelno >= logging.ERROR]

    def test_groups_missing_tensors_by_module(self):
        model = _Tiny()
        report = describe_load(
            model,
            ["heads.rainfall.proj.weight", "heads.rainfall.proj.bias",
             "heads.rainfall.fc2.weight"],
            [],
        )
        # 30 individual tensor names must read as a handful of modules.
        assert report["missing_modules"] == {
            "heads.rainfall.proj": 2,
            "heads.rainfall.fc2": 1,
        }

    def test_counts_missing_parameters_and_fraction(self):
        model = _Tiny()
        state = model.state_dict()
        key = "heads.rainfall.proj.weight"
        report = describe_load(model, [key], [])

        assert report["missing_params"] == state[key].numel()
        assert 0.0 < report["missing_param_fraction"] < 1.0
        assert report["total_params"] == sum(p.numel() for p in model.parameters())

    def test_unexpected_keys_are_reported_as_a_version_mismatch(self, caplog):
        model = _Tiny()
        with caplog.at_level(logging.WARNING):
            report = describe_load(
                model, [], ["heads.rainfall.net.0.weight", "heads.rainfall.net.3.weight"],
                source="old_format.pt",
            )

        assert report["unexpected_count"] == 2
        assert report["fully_loaded"] is False
        # The unexpected names are the evidence of which architecture saved it.
        assert any("net.0.weight" in r.getMessage() for r in caplog.records)

    def test_report_is_json_serialisable(self):
        import json

        model = _Tiny()
        report = describe_load(
            model, ["heads.rainfall.out.weight"], ["heads.rainfall.net.0.weight"],
            source="x.pt",
        )
        json.dumps(report)   # /health returns this, so it must survive encoding


# ── The loader attaches the report ───────────────────────────────────────────


class TestLoadAttachesReport:
    def test_load_sets_load_report_on_the_model(self, tmp_path):
        pytest.importorskip("torch_geometric")
        from ai_engine.climate_model import VayuClimateModel
        from ai_engine.config import ModelConfig

        cfg = ModelConfig()
        model = VayuClimateModel(config=cfg)
        path = tmp_path / "round_trip.pt"
        torch.save({"model_state_dict": model.state_dict(), "config": cfg}, path)

        loaded = VayuClimateModel.load(str(path), device="cpu")
        assert loaded.load_report["fully_loaded"] is True
        assert loaded.load_report["heads_untrained"] is False
        assert loaded.load_report["source"] == str(path)

    def test_load_flags_a_checkpoint_with_stripped_heads(self, tmp_path):
        pytest.importorskip("torch_geometric")
        from ai_engine.climate_model import VayuClimateModel
        from ai_engine.config import ModelConfig

        cfg = ModelConfig()
        model = VayuClimateModel(config=cfg)
        sd = {k: v for k, v in model.state_dict().items() if ".out." not in k}
        path = tmp_path / "stripped.pt"
        torch.save({"model_state_dict": sd, "config": cfg}, path)

        loaded = VayuClimateModel.load(str(path), device="cpu")
        assert loaded.load_report["heads_untrained"] is True
        assert loaded.load_report["degenerate_heads"]

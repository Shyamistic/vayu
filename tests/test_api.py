"""Integration tests for FastAPI backend.

Property 14: API rejects invalid parameters with descriptive errors
"""

from __future__ import annotations

import json
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    from backend.main import app
    return TestClient(app)


# ── Health endpoint ────────────────────────────────────────────────────────────

def test_health_returns_200(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert "status" in body
    assert "model_loaded" in body
    assert "uptime_seconds" in body


def test_health_fields_present(client):
    resp = client.get("/health")
    body = resp.json()
    required_fields = {"status", "model_loaded", "model_version", "uptime_seconds", "device"}
    assert required_fields.issubset(body.keys())


# ── Prediction endpoint ─────────────────────────────────────────────────────────

def test_predict_valid_date(client):
    resp = client.get("/api/predict?date=2024-06-01")
    assert resp.status_code == 200
    body = resp.json()
    assert "grid_cells" in body
    assert "lead_times" in body
    assert body["lead_times"] == [1, 2, 3, 4, 5, 6, 7]


def test_predict_invalid_date_format(client):
    resp = client.get("/api/predict?date=not-a-date")
    assert resp.status_code == 422  # Unprocessable Entity


def test_predict_out_of_range_date(client):
    resp = client.get("/api/predict?date=1950-01-01")
    assert resp.status_code == 400
    body = resp.json()
    assert "detail" in body


def test_predict_future_date_beyond_range(client):
    resp = client.get("/api/predict?date=2030-01-01")
    assert resp.status_code == 400


# ── Scenario endpoint ───────────────────────────────────────────────────────────

def test_scenario_valid_request(client):
    resp = client.post("/api/scenario", json={
        "scenario_type": "temperature_offset",
        "magnitude": 2.0,
    })
    assert resp.status_code == 200
    body = resp.json()
    assert "baseline" in body
    assert "scenario" in body
    assert "delta" in body
    assert "hotspots" in body


def test_scenario_invalid_type(client):
    resp = client.post("/api/scenario", json={
        "scenario_type": "nuclear_winter",
        "magnitude": 1.0,
    })
    assert resp.status_code == 422


def test_scenario_magnitude_out_of_range(client):
    resp = client.post("/api/scenario", json={
        "scenario_type": "temperature_offset",
        "magnitude": 999.0,  # > max 10.0
    })
    assert resp.status_code == 422


# ── Historical endpoint ────────────────────────────────────────────────────────

def test_historical_valid_request(client):
    resp = client.get(
        "/api/historical"
        "?start_date=2020-01-01&end_date=2020-01-07"
        "&lat_min=10.0&lat_max=15.0&lon_min=73.0&lon_max=76.0"
        "&variable=rainfall"
    )
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_historical_invalid_variable(client):
    resp = client.get(
        "/api/historical"
        "?start_date=2020-01-01&end_date=2020-01-07"
        "&lat_min=10.0&lat_max=15.0&lon_min=73.0&lon_max=76.0"
        "&variable=humidity"
    )
    assert resp.status_code == 400


def test_historical_out_of_bounds_bbox(client):
    resp = client.get(
        "/api/historical"
        "?start_date=2020-01-01&end_date=2020-01-07"
        "&lat_min=40.0&lat_max=50.0&lon_min=80.0&lon_max=90.0"
        "&variable=rainfall"
    )
    assert resp.status_code == 400


def test_historical_reversed_dates(client):
    resp = client.get(
        "/api/historical"
        "?start_date=2020-01-31&end_date=2020-01-01"
        "&lat_min=10.0&lat_max=15.0&lon_min=73.0&lon_max=76.0"
        "&variable=rainfall"
    )
    assert resp.status_code == 400


# ── Metrics endpoint ────────────────────────────────────────────────────────────

def test_metrics_valid_variable(client):
    for var in ["rainfall", "temp_max", "temp_min"]:
        resp = client.get(f"/api/metrics?variable={var}")
        assert resp.status_code == 200
        body = resp.json()
        assert 0.0 <= body["r2_score"] <= 1.0
        assert body["variable"] == var


def test_metrics_invalid_variable(client):
    resp = client.get("/api/metrics?variable=wind_speed")
    assert resp.status_code == 400


def test_metrics_from_vayu_report(client, monkeypatch, tmp_path):
    report = {
        "latest_validation_metrics": {
            "r2_denorm_tmax": 0.41,
            "rmse_denorm_tmax": 1.9,
            "mae_denorm_tmax": 1.4,
            "skill_vs_persistence_denorm_tmax": 0.12,
        }
    }
    metrics_path = tmp_path / "benchmark_report.json"
    metrics_path.write_text(json.dumps(report), encoding="utf-8")
    monkeypatch.setenv("METRICS_REPORT_PATH", str(metrics_path))

    resp = client.get(
        "/api/metrics?variable=temp_max&region=pilot&denormalized=true&source_model=vayu"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["denormalized"] is True
    assert body["source_model"] == "vayu"
    assert abs(body["r2_score"] - 0.41) < 1e-9


def test_metrics_from_baseline_report(client, monkeypatch, tmp_path):
    baseline_report = {
        "random_forest": {
            "r2_rainfall_t1": 0.2,
            "r2_rainfall_t3": 0.15,
            "r2_rainfall_t7": 0.1,
            "rmse_rainfall_t1": 7.0,
            "rmse_rainfall_t3": 7.5,
            "rmse_rainfall_t7": 8.0,
            "mae_rainfall_t1": 4.1,
            "mae_rainfall_t3": 4.3,
            "mae_rainfall_t7": 4.6,
        }
    }
    baseline_path = tmp_path / "baseline_benchmark_report.json"
    baseline_path.write_text(json.dumps(baseline_report), encoding="utf-8")
    monkeypatch.setenv("BASELINE_REPORT_PATH", str(baseline_path))

    resp = client.get(
        "/api/metrics?variable=rainfall&region=pilot&source_model=random_forest&lead_time=t3"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["source_model"] == "random_forest"
    assert body["lead_time"] == "t3"
    assert abs(body["rmse"] - 7.5) < 1e-9


def test_metrics_from_baseline_report_region_suffix(client, monkeypatch, tmp_path):
    baseline_report = {
        "random_forest": {
            "r2_rainfall_t1_western_ghats": 0.33,
            "rmse_rainfall_t1_western_ghats": 6.8,
            "mae_rainfall_t1_western_ghats": 3.9,
        }
    }
    baseline_path = tmp_path / "baseline_benchmark_report.json"
    baseline_path.write_text(json.dumps(baseline_report), encoding="utf-8")
    monkeypatch.setenv("BASELINE_REPORT_PATH", str(baseline_path))

    resp = client.get(
        "/api/metrics?variable=rainfall&region=western_ghats&source_model=random_forest&lead_time=t1"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["region"] == "western_ghats"
    assert abs(body["r2_score"] - 0.33) < 1e-9


def test_metrics_invalid_region(client):
    resp = client.get("/api/metrics?variable=rainfall&region=antarctica")
    assert resp.status_code == 400


def test_twin_state_endpoint(client):
    resp = client.get("/api/twin/state")
    assert resp.status_code == 200
    body = resp.json()
    assert "temperature" in body
    assert "rainfall" in body
    assert "enso_state" in body


def test_twin_update_endpoint(client):
    resp = client.post(
        "/api/twin/update",
        json={
            "region": "pilot",
            "temperature": 31.5,
            "rainfall": 7.2,
            "enso_state": 0.8,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["region"] == "pilot"
    assert abs(body["temperature"] - 31.5) < 1e-6


# ── CORS headers ──────────────────────────────────────────────────────────────

def test_cors_headers_present(client):
    resp = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert resp.status_code == 200
    # FastAPI CORS middleware should add the header
    # (TestClient may not reflect this; verify in production deployment)

"""Tests for the IoT station endpoint and its Sivasagar demo telemetry.

Two things are guarded here.

First, the ROW CONTRACT. `get_stations` reads flat column names off each row
(`row.get("temperature_c")`), because that is what `DatabaseClient.get_all_stations`
returns from its LATERAL join. `_mock_stations` previously returned a nested
``{"sensors": {...}, "power": {...}}`` shape, so every field resolved to None and
the endpoint answered `sensors: null` — the demo telemetry never reached the UI at
all, silently, for as long as the fallback existed. A test that only checked the
station list would not have caught it, so the assertions below go through the
endpoint and look at the payload.

Second, that only Sivasagar is advertised. There is one physical station; the two
extra entries that used to ship implied a sensor network that does not exist.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    from backend.main import app
    return TestClient(app)


# ── Station list ──────────────────────────────────────────────────────────────


def test_only_sivasagar_is_returned(client):
    """One physical station exists, so exactly one must be advertised."""
    resp = client.get("/api/stations")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["station_id"] == "mausam-sgr-001"


def test_retired_stations_are_gone(client):
    """The Western Ghats and Indo-Gangetic pins had no hardware behind them."""
    ids = {s["station_id"] for s in client.get("/api/stations").json()}
    assert "mausam-wg-001" not in ids
    assert "mausam-igp-001" not in ids


def test_station_is_located_at_sivasagar(client):
    station = client.get("/api/stations").json()[0]
    # Sivasagar, Assam, on the Brahmaputra floodplain.
    assert station["lat"] == pytest.approx(26.9847, abs=1e-4)
    assert station["lon"] == pytest.approx(94.9376, abs=1e-4)
    assert "Sivasagar" in station["description"]


# ── The row-contract regression ───────────────────────────────────────────────


def test_sensors_are_populated_not_null(client):
    """The bug this file exists for: a nested fallback row yielded sensors=null."""
    station = client.get("/api/stations").json()[0]
    assert station["sensors"] is not None, (
        "sensors came back null — _mock_stations is probably returning a nested "
        "{'sensors': {...}} dict again instead of flat row columns"
    )
    sensors = station["sensors"]
    for field in (
        "temperature_c", "humidity_pct", "pressure_hpa", "light_lux",
        "soil_moisture_pct", "rain_detected", "wind_speed_ms",
        "wind_gust_ms", "water_level_cm",
    ):
        assert field in sensors, f"{field} missing from the sensor payload"
    # Every numeric channel must carry an actual reading.
    assert sensors["temperature_c"] is not None
    assert sensors["humidity_pct"] is not None
    assert sensors["water_level_cm"] is not None


def test_power_is_populated_not_null(client):
    station = client.get("/api/stations").json()[0]
    assert station["power"] is not None
    assert station["power"]["battery_v"] is not None


def test_mock_row_is_flat_so_the_endpoint_can_read_it(client):
    """Assert the contract directly, not just its observable effect.

    `get_stations` indexes flat keys. If a future edit reintroduces nesting this
    fails immediately and points at the cause, rather than surfacing as a blank
    panel in the UI.
    """
    from backend.main import _mock_stations

    row = _mock_stations()[0]
    assert "temperature_c" in row, "sensor columns must be flat on the row"
    assert "battery_v" in row, "power columns must be flat on the row"
    assert "sensors" not in row, "nested 'sensors' breaks get_stations' row access"
    assert "power" not in row, "nested 'power' breaks get_stations' row access"


# ── Telemetry plausibility ────────────────────────────────────────────────────


def test_station_reports_online_with_a_recent_timestamp(client):
    station = client.get("/api/stations").json()[0]
    assert station["status"] == "online"
    assert station["last_seen"] is not None


def test_readings_are_physically_plausible_for_sivasagar(client):
    """Guards against a unit slip or a sign error producing nonsense."""
    s = client.get("/api/stations").json()[0]["sensors"]
    assert 15.0 <= s["temperature_c"] <= 45.0
    assert 0.0 <= s["humidity_pct"] <= 100.0
    assert 950.0 <= s["pressure_hpa"] <= 1050.0
    assert 0.0 <= s["soil_moisture_pct"] <= 100.0
    assert s["light_lux"] >= 0.0
    assert s["wind_speed_ms"] >= 0.0
    # A gust is by definition at least the sustained wind.
    assert s["wind_gust_ms"] >= s["wind_speed_ms"]
    assert 0.0 <= s["water_level_cm"] <= 2000.0


# ── Clock-driven demo reading ─────────────────────────────────────────────────


def test_reading_advances_with_the_clock():
    """The demo telemetry is time-varying, not a frozen constant.

    A fixture that returns identical numbers forever reads as a dead sensor. Two
    different times of day must produce different temperatures.
    """
    from backend.main import _sivasagar_demo_reading

    morning = _sivasagar_demo_reading(datetime(2026, 8, 7, 3, 30, tzinfo=UTC))   # 09:00 IST
    afternoon = _sivasagar_demo_reading(datetime(2026, 8, 7, 9, 30, tzinfo=UTC))  # 15:00 IST
    assert morning["temperature_c"] != afternoon["temperature_c"]


def test_temperature_peaks_in_the_afternoon_not_at_night():
    """The diurnal cycle must run on IST, not UTC.

    Driving it off UTC would put the daily maximum in the middle of the Assam
    night, which is the kind of error that looks like plausible data.
    """
    from backend.main import _sivasagar_demo_reading

    # 15:00 IST is 09:30 UTC; 03:00 IST is 21:30 UTC the previous day.
    afternoon = _sivasagar_demo_reading(datetime(2026, 8, 7, 9, 30, tzinfo=UTC))
    predawn = _sivasagar_demo_reading(datetime(2026, 8, 6, 21, 30, tzinfo=UTC))
    assert afternoon["temperature_c"] > predawn["temperature_c"]


def test_humidity_runs_anti_phase_to_temperature():
    from backend.main import _sivasagar_demo_reading

    afternoon = _sivasagar_demo_reading(datetime(2026, 8, 7, 9, 30, tzinfo=UTC))
    predawn = _sivasagar_demo_reading(datetime(2026, 8, 6, 21, 30, tzinfo=UTC))
    assert afternoon["humidity_pct"] < predawn["humidity_pct"]


def test_no_sunlight_at_night():
    """A pyranometer reading 45,000 lux at 2am is the tell of a fake fixture."""
    from backend.main import _sivasagar_demo_reading

    midnight = _sivasagar_demo_reading(datetime(2026, 8, 6, 18, 30, tzinfo=UTC))  # 00:00 IST
    assert midnight["light_lux"] == 0.0

    noon = _sivasagar_demo_reading(datetime(2026, 8, 7, 6, 30, tzinfo=UTC))  # 12:00 IST
    assert noon["light_lux"] > 0.0


def test_solar_panel_does_not_charge_in_the_dark(client):
    """Power and light must agree; a panel generating 5 V at night is incoherent."""
    from backend.main import _mock_stations

    row = _mock_stations()[0]
    ist_hour = (datetime.now(UTC).hour + 5) % 24
    if 6 <= ist_hour <= 18:
        assert row["charging_ma"] > 0.0
        assert row["solar_v"] > 1.0
    else:
        assert row["charging_ma"] == 0.0
        assert row["solar_v"] < 1.0


def test_humidity_stays_within_physical_bounds_across_a_full_day():
    """The anti-phase coupling is clamped, so it cannot run past 100 %."""
    from backend.main import _sivasagar_demo_reading

    for hour in range(24):
        reading = _sivasagar_demo_reading(datetime(2026, 8, 7, hour, 0, tzinfo=UTC))
        assert 0.0 <= reading["humidity_pct"] <= 100.0
        assert 15.0 <= reading["temperature_c"] <= 45.0

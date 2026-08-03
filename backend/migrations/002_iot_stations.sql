-- VAYU Climate Digital Twin — IoT Station Tables
-- Migration 002: IoT station readings and station registry
-- Run with: psql -U vayu -d vayu_climate -f 002_iot_stations.sql

-- ── IoT station registry ──────────────────────────────────────────────────────
-- Stores registered ESP32 weather stations
CREATE TABLE IF NOT EXISTS iot_stations (
    station_id      VARCHAR(50) PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    lat             DOUBLE PRECISION NOT NULL,
    lon             DOUBLE PRECISION NOT NULL,
    alt             REAL DEFAULT 0.0,
    description     TEXT,
    installed_at    TIMESTAMPTZ DEFAULT NOW(),
    is_active       BOOLEAN DEFAULT TRUE,
    metadata        JSONB DEFAULT '{}'::jsonb
);

-- Insert a seed station for development/testing
INSERT INTO iot_stations (station_id, name, lat, lon, alt, description)
VALUES
    ('mausam-sgr-001', 'Sivasagar Station 1', 26.9847, 94.9376, 96.5, 'Sivasagar flood monitoring station'),
    ('mausam-wg-001', 'Western Ghats Station 1', 12.5, 75.5, 245.0, 'Western Ghats climate monitoring'),
    ('mausam-igp-001', 'Indo-Gangetic Plain Station 1', 25.5, 82.0, 88.0, 'IGP agricultural monitoring')
ON CONFLICT (station_id) DO NOTHING;

-- ── IoT station readings ──────────────────────────────────────────────────────
-- Stores time-series telemetry from ESP32 weather stations
CREATE TABLE IF NOT EXISTS station_readings (
    id              BIGSERIAL PRIMARY KEY,
    station_id      VARCHAR(50) NOT NULL REFERENCES iot_stations(station_id) ON DELETE CASCADE,
    timestamp       TIMESTAMPTZ NOT NULL,
    -- Environmental sensors
    temperature_c   REAL,
    humidity_pct    REAL,
    pressure_hpa    REAL,
    light_lux       REAL,
    soil_moisture_pct REAL,
    rain_detected   BOOLEAN,
    wind_speed_ms   REAL,
    wind_gust_ms    REAL,
    water_level_cm  REAL,
    -- Power monitoring
    battery_v       REAL,
    solar_v         REAL,
    charging_ma     REAL,
    -- GPS fix (may differ from registered position if mobile)
    lat             DOUBLE PRECISION,
    lon             DOUBLE PRECISION,
    -- Raw payload for debugging
    raw_payload     JSONB
);

-- Primary index for time-series queries: station + time descending
CREATE INDEX IF NOT EXISTS idx_station_time
    ON station_readings(station_id, timestamp DESC);

-- General time index for cross-station queries
CREATE INDEX IF NOT EXISTS idx_station_readings_time
    ON station_readings(timestamp DESC);

-- ── Prediction archive for verification ──────────────────────────────────────
-- Stores model predictions archived for later skill scoring vs observations
CREATE TABLE IF NOT EXISTS prediction_archive (
    id              BIGSERIAL PRIMARY KEY,
    prediction_date DATE NOT NULL,
    target_date     DATE NOT NULL,
    lead_day        SMALLINT NOT NULL,
    region          VARCHAR(30) NOT NULL,
    grid_cells      JSONB NOT NULL,
    model_version   VARCHAR(20),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pred_archive_region_date
    ON prediction_archive(region, target_date, lead_day);

-- ── Annotations ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS annotations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     VARCHAR(100),
    type        VARCHAR(20) NOT NULL,  -- pin | polygon | line | text
    coordinates JSONB NOT NULL,
    content     TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Historical flood events ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flood_events (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(100) NOT NULL,
    region              VARCHAR(50),
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    max_rainfall_mm     REAL,
    affected_population INT,
    description         TEXT,
    observation_data    JSONB,
    prediction_data     JSONB
);

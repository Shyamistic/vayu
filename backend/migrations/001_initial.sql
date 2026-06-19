-- VAYU Climate Digital Twin — PostgreSQL Schema
-- Run with: psql -U vayu -d vayu_climate -f 001_initial.sql

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- ── Climate observations table ───────────────────────────────────────────────
-- Stores raw IMD gridded observations after ingestion
CREATE TABLE IF NOT EXISTS climate_observations (
    id           BIGSERIAL PRIMARY KEY,
    obs_date     DATE NOT NULL,
    variable     VARCHAR(20) NOT NULL,  -- rainfall, temp_max, temp_min
    value        REAL NOT NULL,
    source       VARCHAR(20) NOT NULL DEFAULT 'IMD',  -- IMD, MOSDAC, IMDAA
    geom         GEOGRAPHY(POINT, 4326) NOT NULL,
    qc_flag      SMALLINT DEFAULT 0,   -- 0=ok, 1=outlier, 2=gap_filled
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial + temporal index
CREATE INDEX IF NOT EXISTS idx_obs_geom_gist
    ON climate_observations USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_obs_date_var
    ON climate_observations (obs_date, variable);
CREATE INDEX IF NOT EXISTS idx_obs_source
    ON climate_observations (source, obs_date);

-- ── Prediction cache table ────────────────────────────────────────────────────
-- Stores model predictions for quick retrieval without re-inference
CREATE TABLE IF NOT EXISTS prediction_cache (
    id               BIGSERIAL PRIMARY KEY,
    request_date     DATE NOT NULL,
    region           VARCHAR(50) NOT NULL DEFAULT 'pilot',
    model_version    VARCHAR(20) NOT NULL,
    predictions_json JSONB NOT NULL,  -- full prediction response
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    expires_at       TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pred_cache_key
    ON prediction_cache (request_date, region, model_version);
CREATE INDEX IF NOT EXISTS idx_pred_cache_expires
    ON prediction_cache (expires_at);

-- ── Pipeline log table ────────────────────────────────────────────────────────
-- Tracks data ingestion runs for provenance
CREATE TABLE IF NOT EXISTS pipeline_log (
    id           BIGSERIAL PRIMARY KEY,
    pipeline_id  UUID NOT NULL DEFAULT gen_random_uuid(),
    run_date     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source       VARCHAR(20) NOT NULL,  -- IMD_RAINFALL, IMD_TMAX, MOSDAC_LST, etc.
    start_year   INT,
    end_year     INT,
    status       VARCHAR(20) NOT NULL DEFAULT 'running',  -- running, success, failed
    records_loaded INT DEFAULT 0,
    error_message TEXT,
    config_json  JSONB,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pipeline_log_run
    ON pipeline_log (run_date DESC);

-- ── Normalization parameters table ───────────────────────────────────────────
-- Per-variable per-cell mean/std from 1981-2010
CREATE TABLE IF NOT EXISTS normalization_params (
    id           BIGSERIAL PRIMARY KEY,
    variable     VARCHAR(20) NOT NULL,
    reference_period VARCHAR(20) NOT NULL DEFAULT '1981-2010',
    lat          REAL NOT NULL,
    lon          REAL NOT NULL,
    mean_value   REAL NOT NULL,
    std_value    REAL NOT NULL,
    UNIQUE (variable, lat, lon, reference_period)
);

CREATE INDEX IF NOT EXISTS idx_norm_params_var
    ON normalization_params (variable, lat, lon);

-- ── Cleanup expired predictions ───────────────────────────────────────────────
-- Run periodically to avoid table bloat
CREATE OR REPLACE FUNCTION cleanup_expired_predictions()
RETURNS VOID LANGUAGE SQL AS $$
    DELETE FROM prediction_cache WHERE expires_at < NOW();
$$;

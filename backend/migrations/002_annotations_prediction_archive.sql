-- VAYU Climate Digital Twin — Migration 002
-- Adds: annotations table, prediction_archive table
-- Run with: psql -U vayu -d vayu_climate -f 002_annotations_prediction_archive.sql

-- Enable pgcrypto for gen_random_uuid() if not already available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Annotations ──────────────────────────────────────────────────────────────
-- Collaborative annotations: pins, polygons, lines, text notes placed on the
-- globe by users. Persisted here for multi-user sharing (Requirement 45.2).
CREATE TABLE IF NOT EXISTS annotations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      VARCHAR(100),
    type         VARCHAR(20) NOT NULL CHECK (type IN ('pin', 'polygon', 'line', 'text')),
    coordinates  JSONB NOT NULL,           -- GeoJSON coordinate array
    content      TEXT,                     -- annotation text / label
    color        VARCHAR(20) DEFAULT '#00d4ff',
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annotations_user
    ON annotations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_annotations_created
    ON annotations (created_at DESC);

-- Trigger: keep updated_at in sync
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_annotations_updated_at ON annotations;
CREATE TRIGGER trg_annotations_updated_at
    BEFORE UPDATE ON annotations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Prediction archive ────────────────────────────────────────────────────────
-- Archives every model prediction run for post-hoc verification scoring and
-- the historical replay feature. Stores grid_cells as JSONB for flexibility
-- without requiring a per-cell row (Requirement 44.3 / design schema).
CREATE TABLE IF NOT EXISTS prediction_archive (
    id               BIGSERIAL PRIMARY KEY,
    prediction_date  DATE NOT NULL,        -- date on which prediction was made
    target_date      DATE NOT NULL,        -- date being predicted
    lead_day         SMALLINT NOT NULL,    -- 1–7
    region           VARCHAR(30) NOT NULL,
    grid_cells       JSONB NOT NULL,       -- serialised list[GridCell]
    model_version    VARCHAR(20),
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pred_archive_key
    ON prediction_archive (prediction_date, target_date, lead_day, region);
CREATE INDEX IF NOT EXISTS idx_pred_archive_date
    ON prediction_archive (target_date DESC, region);
CREATE INDEX IF NOT EXISTS idx_pred_archive_region
    ON prediction_archive (region, prediction_date DESC);

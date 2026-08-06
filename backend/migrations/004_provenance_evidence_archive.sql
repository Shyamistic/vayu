-- VAYU Climate Digital Twin — Provenance-preserving evidence archives
-- Task 30.1: append-only observation and prediction evidence. New evidence must
-- have complete provenance; legacy prediction rows remain readable but are not
-- marked evidence_complete.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS observation_archive (
    id                BIGSERIAL PRIMARY KEY,
    source_identifier TEXT NOT NULL CHECK (btrim(source_identifier) <> ''),
    region            VARCHAR(50),
    observed_at       TIMESTAMPTZ,
    retrieved_at      TIMESTAMPTZ NOT NULL,
    freshness_at      TIMESTAMPTZ NOT NULL,
    quality_flags     JSONB NOT NULL DEFAULT '[]'::jsonb,
    payload           JSONB NOT NULL,
    payload_checksum  CHAR(64) NOT NULL CHECK (payload_checksum ~ '^[0-9a-f]{64}$'),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (source_identifier !~* '(mock|simulat|synthetic|climatolog)')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_observation_archive_identity
    ON observation_archive (source_identifier, region, freshness_at, payload_checksum);
CREATE INDEX IF NOT EXISTS idx_observation_archive_region_freshness
    ON observation_archive (region, freshness_at DESC);

ALTER TABLE prediction_archive
    ADD COLUMN IF NOT EXISTS cycle_id UUID,
    ADD COLUMN IF NOT EXISTS source_identifier TEXT,
    ADD COLUMN IF NOT EXISTS retrieved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS freshness_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS forecast_issue_time TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS forecast_target_time TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS run_version TEXT,
    ADD COLUMN IF NOT EXISTS manifest_version TEXT,
    ADD COLUMN IF NOT EXISTS calibration_version TEXT,
    ADD COLUMN IF NOT EXISTS quality_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS payload_checksum CHAR(64),
    ADD COLUMN IF NOT EXISTS evidence_complete BOOLEAN NOT NULL DEFAULT FALSE;

-- Widened separately: a semicolon after ALTER COLUMN previously terminated the
-- statement above mid-list, which turned the five ADD COLUMNs that followed it
-- into a syntax error. Postgres runs docker-entrypoint-initdb.d with
-- ON_ERROR_STOP=1, so database initialisation aborted here and the evidence
-- columns were never created. ALTER COLUMN ... TYPE takes no IF NOT EXISTS but
-- is safe to re-run: widening TEXT to TEXT is a no-op.
ALTER TABLE prediction_archive
    ALTER COLUMN model_version TYPE TEXT;

DROP INDEX IF EXISTS idx_pred_archive_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_prediction_archive_evidence_identity
    ON prediction_archive (forecast_issue_time, target_date, lead_day, region, payload_checksum)
    WHERE evidence_complete;
CREATE INDEX IF NOT EXISTS idx_prediction_archive_issue_time
    ON prediction_archive (forecast_issue_time DESC, region);

ALTER TABLE prediction_archive
    DROP CONSTRAINT IF EXISTS prediction_archive_complete_provenance;
ALTER TABLE prediction_archive
    ADD CONSTRAINT prediction_archive_complete_provenance CHECK (
        NOT evidence_complete OR (
            source_identifier IS NOT NULL
            AND btrim(source_identifier) <> ''
            AND source_identifier !~* '(mock|simulat|synthetic|climatolog)'
            AND retrieved_at IS NOT NULL
            AND freshness_at IS NOT NULL
            AND forecast_issue_time IS NOT NULL
            AND forecast_target_time IS NOT NULL
            AND model_version IS NOT NULL AND btrim(model_version) <> ''
            AND run_version IS NOT NULL AND btrim(run_version) <> ''
            AND manifest_version IS NOT NULL AND btrim(manifest_version) <> ''
            AND calibration_version IS NOT NULL AND btrim(calibration_version) <> ''
            AND payload_checksum ~ '^[0-9a-f]{64}$'
        )
    ) NOT VALID;

-- A completed prediction is an evidence record, not a mutable cache entry.
CREATE OR REPLACE FUNCTION prevent_completed_prediction_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.evidence_complete THEN
        RAISE EXCEPTION 'completed prediction evidence is append-only';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prediction_archive_append_only ON prediction_archive;
CREATE TRIGGER trg_prediction_archive_append_only
    BEFORE UPDATE OR DELETE ON prediction_archive
    FOR EACH ROW EXECUTE FUNCTION prevent_completed_prediction_mutation();

CREATE OR REPLACE FUNCTION prevent_observation_archive_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'observation evidence is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_observation_archive_append_only ON observation_archive;
CREATE TRIGGER trg_observation_archive_append_only
    BEFORE UPDATE OR DELETE ON observation_archive
    FOR EACH ROW EXECUTE FUNCTION prevent_observation_archive_mutation();

CREATE TABLE IF NOT EXISTS operational_cycle_runs (
    cycle_id               UUID PRIMARY KEY,
    started_at             TIMESTAMPTZ NOT NULL,
    completed_at           TIMESTAMPTZ,
    status                 VARCHAR(20) NOT NULL,
    model_version          TEXT NOT NULL,
    regions_processed      JSONB NOT NULL DEFAULT '[]'::jsonb,
    predictions_archived   INTEGER NOT NULL DEFAULT 0,
    data_latency_seconds   DOUBLE PRECISION,
    quality_control_flags  INTEGER NOT NULL DEFAULT 0,
    error                  TEXT,
    stages                 JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_operational_cycle_runs_started
    ON operational_cycle_runs (started_at DESC);

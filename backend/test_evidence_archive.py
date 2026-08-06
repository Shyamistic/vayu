"""Tests for Task 30.1 provenance-preserving evidence persistence."""
from __future__ import annotations

import re
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from backend.database import DatabaseClient, EvidenceValidationError, canonical_payload_checksum


class _Connection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetchrow(self, query: str, *args: object) -> dict[str, int]:
        self.calls.append((query, args))
        return {"id": 41}


class _Acquire:
    def __init__(self, connection: _Connection) -> None:
        self._connection = connection

    async def __aenter__(self) -> _Connection:
        return self._connection

    async def __aexit__(self, *_: object) -> None:
        return None


class _Pool:
    def __init__(self, connection: _Connection) -> None:
        self._connection = connection

    def acquire(self) -> _Acquire:
        return _Acquire(self._connection)


def _prediction_kwargs() -> dict[str, object]:
    issue_time = datetime(2025, 7, 15, 12, tzinfo=UTC)
    return {
        "cycle_id": "c2e23117-5b10-4cc2-a57e-2f6edb7891bb",
        "prediction_date": date(2025, 7, 15),
        "target_date": date(2025, 7, 16),
        "lead_day": 1,
        "region": "north_east_india",
        "grid_cells": [{"lat": 26.98, "lon": 94.94, "rainfall": 13.2}],
        "source_identifier": "vayu-model-inference",
        "retrieved_at": issue_time,
        "freshness_at": issue_time,
        "forecast_issue_time": issue_time,
        "forecast_target_time": datetime(2025, 7, 16, tzinfo=UTC),
        "model_version": "vayu-2025.07",
        "run_version": "run-2025-07-15T12",
        "manifest_version": "manifest-2025.07",
        "calibration_version": "calibration-3",
        "quality_flags": ["qc_invalid_values_removed:0"],
    }


def test_checksum_is_order_independent_and_sha256_shaped() -> None:
    assert canonical_payload_checksum({"b": 2, "a": [1]}) == canonical_payload_checksum({"a": [1], "b": 2})
    assert len(canonical_payload_checksum({"a": 1})) == 64


@pytest.mark.asyncio
async def test_prediction_archive_persists_complete_provenance_and_checksum() -> None:
    connection = _Connection()
    db = DatabaseClient("postgresql://unused")
    db._pool = _Pool(connection)

    archived_id = await db.archive_prediction(**_prediction_kwargs())

    assert archived_id == 41
    query, args = connection.calls[0]
    assert "evidence_complete" in query
    assert args[6] == "vayu-model-inference"
    assert args[16] == canonical_payload_checksum(_prediction_kwargs()["grid_cells"])


@pytest.mark.asyncio
async def test_prediction_archive_rejects_simulated_source_before_database_access() -> None:
    db = DatabaseClient("postgresql://unused")
    invalid = _prediction_kwargs()
    invalid["source_identifier"] = "mock-grid-generator"

    with pytest.raises(EvidenceValidationError, match="cannot be archived"):
        await db.archive_prediction(**invalid)


@pytest.mark.asyncio
async def test_prediction_archive_requires_reproducible_version_provenance() -> None:
    db = DatabaseClient("postgresql://unused")
    incomplete = _prediction_kwargs()
    incomplete["manifest_version"] = None

    with pytest.raises(EvidenceValidationError, match="manifest_version is required"):
        await db.archive_prediction(**incomplete)


@pytest.mark.asyncio
async def test_observation_archive_computes_and_persists_immutable_payload_checksum() -> None:
    connection = _Connection()
    db = DatabaseClient("postgresql://unused")
    db._pool = _Pool(connection)
    retrieved_at = datetime(2025, 7, 15, 12, tzinfo=UTC)
    payload = {"hourly": {"temperature_2m": [30.0]}, "region": "north_east_india"}

    archived_id = await db.archive_observation(
        source_identifier="open-meteo-forecast",
        region="north_east_india",
        payload=payload,
        retrieved_at=retrieved_at,
        freshness_at=retrieved_at,
    )

    assert archived_id == 41
    assert connection.calls[0][1][-1] == canonical_payload_checksum(payload)


MIGRATIONS_DIR = Path(__file__).with_name("migrations")

#: Keywords a top-level statement in these migrations may begin with. A fragment
#: starting with anything else (notably ``ADD COLUMN``) means a statement was
#: terminated early and the remainder is orphaned.
_SQL_STATEMENT_STARTS = (
    "CREATE", "ALTER", "DROP", "INSERT", "UPDATE", "DELETE", "COMMENT",
    "GRANT", "REVOKE", "SELECT", "WITH", "DO", "SET", "TRUNCATE",
)


#: A dollar-quote opener is ``$$`` or ``$tag$`` where tag is an identifier. Without
#: this, the ``$`` inside a regex literal such as '^[0-9a-f]{64}$' is mistaken for
#: the start of a dollar-quoted block and swallows the rest of the file.
_DOLLAR_TAG = re.compile(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$")


def split_sql_statements(sql: str) -> list[str]:
    """Split on top-level semicolons.

    Skips line comments, single-quoted string literals (with '' escapes) and
    dollar-quoted PL/pgSQL bodies, any of which can legally contain a semicolon.
    """
    statements: list[str] = []
    current: list[str] = []
    i = 0
    n = len(sql)
    while i < n:
        if sql.startswith("--", i):
            end = sql.find("\n", i)
            i = n if end == -1 else end + 1
            current.append(" ")
            continue
        if sql[i] == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            current.append(sql[i:j + 1])
            i = j + 1
            continue
        match = _DOLLAR_TAG.match(sql, i)
        if match:
            tag = match.group(0)
            close = sql.find(tag, match.end())
            end = n if close == -1 else close + len(tag)
            current.append(sql[i:end])
            i = end
            continue
        if sql[i] == ";":
            statements.append("".join(current).strip())
            current = []
            i += 1
            continue
        current.append(sql[i])
        i += 1
    if "".join(current).strip():
        statements.append("".join(current).strip())
    return [s for s in statements if s]


@pytest.mark.parametrize(
    "migration_name",
    sorted(p.name for p in MIGRATIONS_DIR.glob("*.sql")),
)
def test_migration_statements_are_not_truncated(migration_name: str) -> None:
    """Every top-level statement must begin with a DDL/DML keyword.

    Regression guard: ``004`` previously read

        ALTER TABLE prediction_archive
            ADD COLUMN IF NOT EXISTS run_version TEXT,
            ALTER COLUMN model_version TYPE TEXT;
            ADD COLUMN IF NOT EXISTS manifest_version TEXT,
            ...

    The semicolon ended the ALTER TABLE mid-list, so the five ADD COLUMNs after it
    became a standalone ``ADD COLUMN ...`` fragment — invalid SQL that aborted
    database initialisation under ON_ERROR_STOP=1. The previous version of this
    test only asserted that the column NAMES appeared somewhere in the file, so it
    passed on the broken migration. Checking statement starts catches the whole
    class of early-termination mistakes without needing a live server.
    """
    sql = (MIGRATIONS_DIR / migration_name).read_text(encoding="utf-8")
    for statement in split_sql_statements(sql):
        first_word = statement.split(None, 1)[0].upper()
        assert first_word in _SQL_STATEMENT_STARTS, (
            f"{migration_name}: statement starts with {first_word!r}, which is not a "
            f"valid statement keyword — a previous statement was likely terminated "
            f"early, orphaning this fragment:\n{statement[:200]}"
        )


def test_statement_splitter_detects_the_historical_004_defect() -> None:
    """The guard above must actually fail on the shape of SQL that shipped broken.

    Without this, `test_migration_statements_are_not_truncated` could pass simply
    because the splitter never produces the offending fragment.
    """
    broken = """
    ALTER TABLE prediction_archive
        ADD COLUMN IF NOT EXISTS run_version TEXT,
        ALTER COLUMN model_version TYPE TEXT;
        ADD COLUMN IF NOT EXISTS manifest_version TEXT,
        ADD COLUMN IF NOT EXISTS evidence_complete BOOLEAN NOT NULL DEFAULT FALSE;
    """
    starts = [s.split(None, 1)[0].upper() for s in split_sql_statements(broken)]
    assert "ADD" in starts, "splitter failed to surface the orphaned ADD COLUMN"
    assert any(w not in _SQL_STATEMENT_STARTS for w in starts)

    fixed = """
    ALTER TABLE prediction_archive
        ADD COLUMN IF NOT EXISTS run_version TEXT,
        ADD COLUMN IF NOT EXISTS manifest_version TEXT;
    ALTER TABLE prediction_archive
        ALTER COLUMN model_version TYPE TEXT;
    """
    fixed_starts = [s.split(None, 1)[0].upper() for s in split_sql_statements(fixed)]
    assert all(w in _SQL_STATEMENT_STARTS for w in fixed_starts)


def test_statement_splitter_ignores_semicolons_in_quotes_and_bodies() -> None:
    """Semicolons inside literals and PL/pgSQL bodies must not split statements."""
    sql = """
    CREATE TABLE t (c TEXT CHECK (c ~ '^[0-9a-f]{64}$' AND c <> 'a;b'));
    CREATE FUNCTION f() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
        RAISE EXCEPTION 'no; really';
        RETURN NEW;
    END;
    $$;
    """
    statements = split_sql_statements(sql)
    assert len(statements) == 2, [s[:60] for s in statements]
    assert all(
        s.split(None, 1)[0].upper() in _SQL_STATEMENT_STARTS for s in statements
    )


def test_migration_enforces_append_only_complete_evidence() -> None:
    migration = (MIGRATIONS_DIR / "004_provenance_evidence_archive.sql").read_text(
        encoding="utf-8"
    )

    # Assert the evidence columns are added by a statement that survives parsing,
    # not merely that the identifiers appear somewhere in the text.
    add_column_statements = [
        s for s in split_sql_statements(migration)
        if s.upper().startswith("ALTER TABLE") and "ADD COLUMN" in s.upper()
    ]
    added = " ".join(add_column_statements)
    for field in (
        "source_identifier", "retrieved_at", "freshness_at", "forecast_issue_time",
        "forecast_target_time", "run_version", "manifest_version",
        "calibration_version", "quality_flags", "payload_checksum",
        "evidence_complete",
    ):
        assert field in added, f"{field} is not added by a parseable ALTER TABLE"

    assert "completed prediction evidence is append-only" in migration
    assert "observation evidence is append-only" in migration

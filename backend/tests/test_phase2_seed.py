"""Phase 2.1 seed and migration invariants that can be checked without a database.

The live equivalents run in tests/test_rls_db.py when a database is configured.
These tests fail fast in CI if the SQL and the Python catalogue drift apart.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.auth import permissions as perms
from app.services.intake import DEMO_CHANNELS, SIMULATION_NOTICE_VERSION

ROOT = Path(__file__).resolve().parents[2]
MIGRATION_PATH = ROOT / "supabase" / "migrations" / "0003_phase2_intake.sql"
SEED_PATH = ROOT / "supabase" / "seed" / "phase2_intake_seed.sql"


def _sql(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _block(sql: str, start: str, end: str) -> str:
    start_index = sql.index(start)
    end_index = sql.index(end, start_index)
    return sql[start_index:end_index]


def test_phase2_seed_declares_the_phase2_catalogue_only() -> None:
    block = _block(
        _sql(SEED_PATH), "insert into public.permissions", "on conflict (code) do update"
    )
    codes = {code.lower() for code in re.findall(r"'([A-Z0-9.]+)'", block)}
    assert codes == set(perms.PHASE2_PERMISSIONS)


def test_phase2_seed_roles_match_the_python_grants() -> None:
    sql = _sql(SEED_PATH)
    expected = {
        (role_code, permission_code.lower())
        for role_code, roles in perms.PHASE2_ROLE_GRANTS.items()
        for permission_code in roles
    }
    for role_code, permission_code in expected:
        assert f"'{role_code}'" in sql
        assert f"'{permission_code.upper()}'" in sql


def test_phase2_seed_matches_the_demo_channel_catalogue() -> None:
    sql = _sql(SEED_PATH)
    for channel in DEMO_CHANNELS:
        assert f"'{channel['code']}'" in sql
        assert f"'{channel['name']}'" in sql
        assert f"'{channel['channel_type']}'" in sql


def test_demo_channels_are_flagged_as_simulated() -> None:
    # The portal list is safe to publish because both channels are simulated.
    assert {channel["code"] for channel in DEMO_CHANNELS} == {"AICTE_SIM", "CPGRAMS_SIM"}
    assert all(channel["portal"] in {"aicte", "cpgrams"} for channel in DEMO_CHANNELS)


def test_seed_and_migration_mark_the_simulation_clearly() -> None:
    seed = _sql(SEED_PATH)
    assert "SIMULATION ONLY" in seed
    assert "Not connected to AICTE" in seed
    assert "Not connected to CPGRAMS" in seed
    # No real portal identifiers or endpoints are embedded in the demo seed.
    assert "nic.in" not in seed
    assert "https://" not in seed


def test_migration_restricts_execute_to_the_intake_role() -> None:
    sql = _sql(MIGRATION_PATH)
    assert "revoke all on function public.create_demo_submission" in sql
    assert "from anon, authenticated, service_role" in sql
    assert "grant execute on function public.create_demo_submission" in sql
    assert "to one_desk_intake" in sql


def test_migration_uses_an_explicit_caller_allowlist() -> None:
    sql = _sql(MIGRATION_PATH)
    assert "current_setting('role', true)" in sql
    assert "is distinct from 'one_desk_intake'" in sql
    # A denylist was explicitly rejected during review; make sure it never
    # silently comes back.
    assert "not in ('anon', 'authenticated')" not in sql


def test_migration_pins_the_definer_search_path_and_timeout() -> None:
    sql = _sql(MIGRATION_PATH)
    assert "security definer" in sql.lower()
    assert "set search_path = ''" in sql
    assert "set statement_timeout" in sql
    assert "owner to postgres" in sql


def test_migration_removes_data_api_writes_on_intake_tables() -> None:
    sql = _sql(MIGRATION_PATH)
    assert (
        "revoke insert, update, delete, truncate, references, trigger, maintain\n"
        "    on table public.submissions, public.intake_channels\n"
        "    from authenticated;"
    ) in sql


def test_migration_hash_payload_includes_the_source_timestamp() -> None:
    sql = _sql(MIGRATION_PATH)
    payload = _block(sql, "v_payload := pg_catalog.jsonb_build_object(", ");")
    assert "'source_submitted_at'," in payload
    # Same normalisation is hashed and stored.
    assert "to_char(" in sql
    assert 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"' in sql


def test_migration_creates_no_table_or_column() -> None:
    sql = _sql(MIGRATION_PATH).lower()
    assert "create table" not in sql
    assert "alter table" not in sql
    assert "add column" not in sql
    assert "drop table" not in sql


def test_simulation_notice_version_is_consistent() -> None:
    assert SIMULATION_NOTICE_VERSION == "SIM-NOTICE-2026-10-29-v1"
    assert SIMULATION_NOTICE_VERSION in _sql(MIGRATION_PATH)

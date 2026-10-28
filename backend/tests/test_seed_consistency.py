"""The SQL seed and the Python catalogue must not drift apart.

`backend/app/auth/permissions.py` drives API checks; the seed drives PostgreSQL
RLS and /me. If they disagree, a capability could work in one layer only.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.auth import permissions as perms

SEED_PATH = (
    Path(__file__).resolve().parents[2] / "supabase" / "seed" / "phase1_identity_seed.sql"
)

pytestmark = pytest.mark.skipif(
    not SEED_PATH.exists(), reason="Phase 1 seed file is not present."
)


def _seed_sql() -> str:
    return SEED_PATH.read_text(encoding="utf-8")


def _between(sql: str, start: str, end: str) -> str:
    start_index = sql.index(start)
    end_index = sql.index(end, start_index)
    return sql[start_index:end_index]


def test_seed_declares_every_permission_code() -> None:
    block = _between(_seed_sql(), "insert into public.permissions", "on conflict (code) do update")
    codes = {code.lower() for code in re.findall(r"'([A-Z0-9.]+)'", block)}
    assert codes == set(perms.PHASE1_PERMISSIONS)


def test_seed_declares_every_role_with_matching_scope() -> None:
    sql = _seed_sql()
    block = _between(sql, "insert into public.roles", "on conflict (code) do update")
    for role_code, definition in perms.ROLE_DEFINITIONS.items():
        assert f"'{role_code}'" in block, f"{role_code} missing from seed"
        assert f"'{definition['scope_type']}'" in block


def test_seed_role_permission_pairs_match_the_catalogue() -> None:
    block = _between(
        _seed_sql(), "insert into public.role_permissions", "on conflict (role_id, permission_id)"
    )
    pairs = {
        (role_code, permission_code.lower())
        for role_code, permission_code in re.findall(
            r"\('([A-Z_]+)',\s*'([A-Z0-9.]+)'\)", block
        )
    }
    expected = {
        (role_code, permission_code.lower())
        for role_code, definition in perms.ROLE_DEFINITIONS.items()
        for permission_code in definition["permissions"]  # type: ignore[union-attr]
    }
    assert pairs == expected


def test_seed_marks_demo_records_as_illustrative() -> None:
    sql = _seed_sql()
    assert "ILLUSTRATIVE DATA ONLY" in sql
    assert "DEMO-AICTE-" in sql
    # Official AICTE approvals must never be invented by a demo seed.
    assert "not an official AICTE approval" in sql

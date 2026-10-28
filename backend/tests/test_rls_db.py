"""Live RLS tests against PostgreSQL.

These tests only run when a database is configured (DATABASE_URL or
TEST_DATABASE_URL). They assume:

* the Phase 1 migration has been applied, and
* the connecting role may ``SET LOCAL ROLE authenticated`` / ``anon``
  (the Supabase ``postgres`` role can; a limited app role cannot).

Every test runs inside a transaction that is always rolled back, so no data is
created or modified.
"""

from __future__ import annotations

import json
import os
from typing import Any
from uuid import UUID

import psycopg
import pytest
from psycopg import errors as pg_errors
from psycopg.rows import dict_row

DATABASE_URL = os.getenv("TEST_DATABASE_URL") or os.getenv("DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason="No DATABASE_URL/TEST_DATABASE_URL configured; live RLS checks are skipped.",
)


def _act_as(conn: psycopg.Connection, user_id: UUID | None, role: str = "authenticated") -> None:
    claims: dict[str, Any] = {"role": role, "aud": "authenticated"}
    if user_id is not None:
        claims["sub"] = str(user_id)
    conn.execute(
        "select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),)
    )
    conn.execute(f"set local role {role}")


@pytest.fixture()
def conn():
    assert DATABASE_URL
    with psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=False) as connection:
        yield connection


@pytest.fixture(scope="session")
def accounts():
    """Discover two ordinary active accounts and one active Super Admin."""
    assert DATABASE_URL
    with psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=True) as owner:
        rows = owner.execute(
            """
            select u.id,
                   u.official_email,
                   exists (
                       select 1
                         from public.user_role_assignments ura
                         join public.roles r on r.id = ura.role_id
                        where ura.user_id = u.id
                          and r.code = 'SUPER_ADMIN'
                          and ura.assignment_status = 'active'
                   ) as is_super_admin
              from public.users u
             where u.account_status = 'active'
             order by u.created_at asc, u.id asc
            """
        ).fetchall()
    ordinary = [row for row in rows if not row["is_super_admin"]]
    supers = [row for row in rows if row["is_super_admin"]]
    if len(ordinary) < 2:
        pytest.skip("RLS tests need at least two ordinary active accounts (run the Phase 1 seed).")
    return {
        "me": ordinary[0],
        "other": ordinary[1],
        "super": supers[0] if supers else None,
        "ordinary": ordinary,
        "all": rows,
    }


def test_anon_cannot_read_identity_tables(conn) -> None:
    with conn.transaction(force_rollback=True):
        _act_as(conn, None, role="anon")
        with pytest.raises(pg_errors.InsufficientPrivilege):
            conn.execute("select id from public.users limit 1").fetchall()


def test_anon_cannot_call_the_permission_helper(conn) -> None:
    with conn.transaction(force_rollback=True):
        _act_as(conn, None, role="anon")
        with pytest.raises(pg_errors.InsufficientPrivilege):
            conn.execute("select public.has_permission('REGION.VIEW')").fetchone()


def test_user_sees_only_their_own_profile(conn, accounts) -> None:
    me = accounts["me"]
    other = accounts["other"]
    with conn.transaction(force_rollback=True):
        _act_as(conn, me["id"])
        visible = {row["id"] for row in conn.execute("select id from public.users").fetchall()}
    assert me["id"] in visible
    assert other["id"] not in visible


def test_user_sees_only_their_own_role_assignments(conn, accounts) -> None:
    me = accounts["me"]
    other = accounts["other"]
    with conn.transaction(force_rollback=True):
        _act_as(conn, me["id"])
        visible = {
            row["user_id"]
            for row in conn.execute("select user_id from public.user_role_assignments").fetchall()
        }
    assert other["id"] not in visible
    assert visible <= {me["id"]}


def test_missing_subject_claim_yields_no_identity_rows(conn) -> None:
    with conn.transaction(force_rollback=True):
        _act_as(conn, None)
        assert conn.execute("select id from public.users").fetchall() == []
        assert conn.execute("select id from public.bureau_memberships").fetchall() == []


def test_permission_helper_matches_the_callers_own_grants(conn, accounts) -> None:
    me = accounts["me"]
    with conn.transaction(force_rollback=True):
        _act_as(conn, me["id"])
        row = conn.execute(
            """
            select public.has_permission('REGION.VIEW') as allowed,
                   exists (
                       select 1
                         from public.user_role_assignments ura
                         join public.role_permissions rp on rp.role_id = ura.role_id
                         join public.permissions p on p.id = rp.permission_id
                        where ura.user_id = auth.uid()
                          and ura.assignment_status = 'active'
                          and p.code = 'REGION.VIEW'
                          and p.is_active
                   ) as expected
            """
        ).fetchone()
    assert row["allowed"] == row["expected"]


def test_ordinary_user_cannot_write_reference_data(conn, accounts) -> None:
    me = accounts["me"]
    with conn.transaction(force_rollback=True):
        _act_as(conn, me["id"])
        with pytest.raises(pg_errors.InsufficientPrivilege):
            conn.execute(
                "insert into public.regions (code, name) values ('RLSTEST', 'RLS test region')"
            )


def test_ordinary_user_cannot_grant_roles(conn, accounts) -> None:
    me = accounts["me"]
    with conn.transaction(force_rollback=True):
        _act_as(conn, me["id"])
        with pytest.raises(pg_errors.InsufficientPrivilege):
            conn.execute(
                """
                insert into public.user_role_assignments (user_id, role_id)
                select %s, id from public.roles where code = 'SUPER_ADMIN'
                """,
                (str(me["id"]),),
            )


def test_super_admin_can_manage_reference_data(conn, accounts) -> None:
    super_admin = accounts["super"]
    if super_admin is None:
        pytest.skip("No active Super Admin account found.")
    with conn.transaction(force_rollback=True):
        _act_as(conn, super_admin["id"])
        conn.execute(
            "insert into public.regions (code, name) values ('RLSTEST', 'RLS test region')"
        )
        found = conn.execute(
            "select code from public.regions where code = 'RLSTEST'"
        ).fetchone()
        assert found is not None
        assert conn.execute("select count(*) as total from public.users").fetchone()["total"] >= 3


def test_super_admin_can_read_every_profile(conn, accounts) -> None:
    super_admin = accounts["super"]
    if super_admin is None:
        pytest.skip("No active Super Admin account found.")
    expected = len(accounts["all"])
    with conn.transaction(force_rollback=True):
        _act_as(conn, super_admin["id"])
        actual = conn.execute("select count(*) as total from public.users").fetchone()["total"]
    assert actual == expected

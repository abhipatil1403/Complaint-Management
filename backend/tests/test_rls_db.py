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


def _act_as(
    conn: psycopg.Connection,
    user_id: UUID | None,
    role: str = "authenticated",
    active_bureau_id: UUID | None = None,
) -> None:
    claims: dict[str, Any] = {"role": role, "aud": "authenticated"}
    if user_id is not None:
        claims["sub"] = str(user_id)
    if active_bureau_id is not None:
        claims["active_bureau_id"] = str(active_bureau_id)
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
                         join public.roles r
                           on r.id = ura.role_id
                          and r.is_active
                          and r.scope_type = 'global'
                        where ura.user_id = u.id
                          and ura.bureau_id is null
                          and r.code = 'SUPER_ADMIN'
                          and ura.assignment_status = 'active'
                          and (ura.expires_at is null or ura.expires_at > now())
                   ) as is_super_admin,
                   exists (
                       select 1
                         from public.user_role_assignments ura
                         join public.roles r
                           on r.id = ura.role_id
                          and r.is_active
                          and r.scope_type = 'global'
                         join public.role_permissions rp on rp.role_id = r.id
                         join public.permissions p
                           on p.id = rp.permission_id
                          and p.is_active
                        where ura.user_id = u.id
                          and ura.bureau_id is null
                          and p.code = 'USER.VIEW'
                          and ura.assignment_status = 'active'
                          and (ura.expires_at is null or ura.expires_at > now())
                   ) as can_view_users,
                   exists (
                       select 1
                         from public.user_role_assignments ura
                         join public.roles r
                           on r.id = ura.role_id
                          and r.is_active
                          and r.scope_type = 'global'
                         join public.role_permissions rp on rp.role_id = r.id
                         join public.permissions p
                           on p.id = rp.permission_id
                          and p.is_active
                        where ura.user_id = u.id
                          and ura.bureau_id is null
                          and p.code = 'USER.MANAGE'
                          and ura.assignment_status = 'active'
                          and (ura.expires_at is null or ura.expires_at > now())
                   ) as can_manage_users
              from public.users u
             where u.account_status = 'active'
             order by u.created_at asc, u.id asc
            """
        ).fetchall()
    ordinary = [
        row
        for row in rows
        if not row["is_super_admin"]
        and not row["can_view_users"]
        and not row["can_manage_users"]
    ]
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


@pytest.fixture(scope="session")
def bureau_actor():
    """Find a user with a bureau-scoped grant that is not also global.

    The permission chosen must not be available to the same user through a
    global grant, otherwise the negative context assertions would be ambiguous.
    """
    assert DATABASE_URL
    with psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=True) as owner:
        row = owner.execute(
            """
            select ura.user_id,
                   ura.bureau_id,
                   p.code as permission_code
              from public.user_role_assignments ura
              join public.roles r
                on r.id = ura.role_id
               and r.is_active
               and r.scope_type = 'bureau'
              join public.role_permissions rp
                on rp.role_id = r.id
              join public.permissions p
                on p.id = rp.permission_id
               and p.is_active
              join public.bureau_memberships bm
                on bm.user_id = ura.user_id
               and bm.bureau_id = ura.bureau_id
               and bm.membership_status = 'active'
               and (bm.ended_at is null or bm.ended_at > now())
              join public.bureaus b
                on b.id = ura.bureau_id
               and b.is_active
              join public.users u
                on u.id = ura.user_id
               and u.account_status = 'active'
             where ura.assignment_status = 'active'
               and (ura.expires_at is null or ura.expires_at > now())
               and not exists (
                   select 1
                     from public.user_role_assignments gura
                     join public.roles gr
                       on gr.id = gura.role_id
                      and gr.is_active
                      and gr.scope_type = 'global'
                     join public.role_permissions grp
                       on grp.role_id = gr.id
                    where gura.user_id = ura.user_id
                      and gura.bureau_id is null
                      and gura.assignment_status = 'active'
                      and (gura.expires_at is null or gura.expires_at > now())
                      and grp.permission_id = rp.permission_id
               )
             order by ura.user_id, p.code
             limit 1
            """
        ).fetchone()
    if row is None:
        pytest.skip("RLS tests need a bureau-scoped grant with an active membership.")
    return row


@pytest.fixture(scope="session")
def other_bureau(bureau_actor):
    """An active bureau where the actor has neither a grant nor a membership."""
    assert DATABASE_URL
    with psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=True) as owner:
        row = owner.execute(
            """
            select b.id
              from public.bureaus b
             where b.id <> %s
               and b.is_active
               and not exists (
                   select 1
                     from public.bureau_memberships bm
                    where bm.bureau_id = b.id
                      and bm.user_id = %s
                      and bm.membership_status = 'active'
                      and (bm.ended_at is null or bm.ended_at > now())
               )
               and not exists (
                   select 1
                     from public.user_role_assignments ura
                    where ura.bureau_id = b.id
                      and ura.user_id = %s
                      and ura.assignment_status = 'active'
                      and (ura.expires_at is null or ura.expires_at > now())
               )
             order by b.code
             limit 1
            """,
            (
                str(bureau_actor["bureau_id"]),
                str(bureau_actor["user_id"]),
                str(bureau_actor["user_id"]),
            ),
        ).fetchone()
    if row is None:
        pytest.skip("RLS tests need a second active bureau outside the actor's scope.")
    return row["id"]


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
        bureau = conn.execute(
            """
            select bm.bureau_id
              from public.bureau_memberships bm
              join public.bureaus b on b.id = bm.bureau_id
             where bm.user_id = %s
               and bm.membership_status = 'active'
               and (bm.ended_at is null or bm.ended_at > now())
               and b.is_active
             order by bm.is_primary desc, b.name asc
             limit 1
            """,
            (str(me["id"]),),
        ).fetchone()
        active_bureau_id = bureau["bureau_id"] if bureau else None
        _act_as(conn, me["id"], active_bureau_id=active_bureau_id)
        row = conn.execute(
            """
            select public.has_permission('REGION.VIEW') as allowed,
                   (
                       public.has_global_permission('REGION.VIEW')
                       or exists (
                           select 1
                             from public.user_role_assignments ura
                             join public.roles r
                               on r.id = ura.role_id
                              and r.is_active
                              and r.scope_type = 'bureau'
                             join public.role_permissions rp on rp.role_id = r.id
                             join public.permissions p
                               on p.id = rp.permission_id
                              and p.is_active
                             join public.bureau_memberships bm
                               on bm.user_id = ura.user_id
                              and bm.bureau_id = ura.bureau_id
                              and bm.membership_status = 'active'
                              and (bm.ended_at is null or bm.ended_at > now())
                             join public.bureaus b
                               on b.id = bm.bureau_id
                              and b.is_active
                            where ura.user_id = public.auth_uid()
                              and ura.bureau_id = public.active_bureau_id()
                              and ura.assignment_status = 'active'
                              and (ura.expires_at is null or ura.expires_at > now())
                              and p.code = 'REGION.VIEW'
                       )
                   ) as expected
            """
        ).fetchone()
    assert row["allowed"] == row["expected"]


def test_bureau_grant_requires_its_active_bureau_context(conn, bureau_actor) -> None:
    user_id = bureau_actor["user_id"]
    bureau_id = bureau_actor["bureau_id"]
    code = bureau_actor["permission_code"]

    with conn.transaction(force_rollback=True):
        _act_as(conn, user_id)
        without_context = conn.execute(
            "select public.has_permission(%s) as allowed", (code,)
        ).fetchone()
        _act_as(conn, user_id, active_bureau_id=bureau_id)
        in_context = conn.execute(
            "select public.has_permission(%s) as allowed,"
            "       public.is_bureau_member(%s) as member",
            (code, str(bureau_id)),
        ).fetchone()

    assert without_context["allowed"] is False
    assert in_context["allowed"] is True
    assert in_context["member"] is True


def test_bureau_grant_does_not_leak_into_another_bureau(conn, bureau_actor, other_bureau) -> None:
    user_id = bureau_actor["user_id"]
    code = bureau_actor["permission_code"]

    with conn.transaction(force_rollback=True):
        _act_as(conn, user_id, active_bureau_id=other_bureau)
        row = conn.execute(
            "select public.has_permission(%s) as allowed,"
            "       public.is_bureau_member(%s) as member",
            (code, str(other_bureau)),
        ).fetchone()

    assert row["allowed"] is False
    assert row["member"] is False


def test_user_cannot_update_privileged_profile_columns(conn, accounts) -> None:
    me = accounts["me"]
    with conn.transaction(force_rollback=True):
        _act_as(conn, me["id"])
        updated = conn.execute(
            "update public.users set is_super_admin = true, account_status = 'active'"
            " where id = %s",
            (str(me["id"]),),
        )
        profile = conn.execute(
            "select is_super_admin from public.users where id = %s", (str(me["id"]),)
        ).fetchone()

    assert updated.rowcount == 0
    assert profile is not None
    assert profile["is_super_admin"] is False


def test_user_cannot_update_another_profile(conn, accounts) -> None:
    me = accounts["me"]
    other = accounts["other"]
    with conn.transaction(force_rollback=True):
        _act_as(conn, me["id"])
        updated = conn.execute(
            "update public.users set full_name = 'RLS overwrite' where id = %s",
            (str(other["id"]),),
        )
    assert updated.rowcount == 0


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

"""Live RLS tests against PostgreSQL.

These tests only run when a database is configured. The connection string is
resolved in this order:

1. ``TEST_DATABASE_URL`` from the shell (a dedicated test project),
2. ``DATABASE_URL`` from the shell,
3. ``DATABASE_URL`` from ``backend/.env`` (the same file the API reads).

They assume:

* the Phase 1 migration has been applied, and
* the connecting role may ``SET LOCAL ROLE authenticated`` / ``anon``
  (the Supabase ``postgres`` role can; a limited app role cannot).
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg import errors as pg_errors
from psycopg.rows import dict_row

from app.core.config import Settings

_BACKEND_DIR = Path(__file__).resolve().parents[1]


def _resolve_database_url() -> str | None:
    """Shell variables win; otherwise read ``backend/.env`` like the API does."""
    for name in ("TEST_DATABASE_URL", "DATABASE_URL"):
        value = (os.getenv(name) or "").strip()
        if value:
            return value

    env_file = _BACKEND_DIR / ".env"
    try:
        settings = Settings(_env_file=str(env_file) if env_file.is_file() else None)
    except Exception:  # noqa: BLE001 - a broken config must not crash collection
        return None
    configured = (settings.database_url or "").strip()
    return configured or None


DATABASE_URL = _resolve_database_url()

pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason=(
        "No TEST_DATABASE_URL/DATABASE_URL in the shell and no DATABASE_URL in "
        "backend/.env; live RLS checks are skipped."
    ),
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
        total_users = owner.execute(
            "select count(*) as total from public.users"
        ).fetchone()["total"]
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
        "total_users": total_users,
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
    """A self-grant of SUPER_ADMIN is refused before any row lookup.

    ``validate_user_role_assignment`` is SECURITY DEFINER and now gates every
    untrusted session on the global ``USER.MANAGE`` capability, so an ordinary
    caller receives a deterministic ``42501`` (insufficient privilege) instead
    of the trigger's "Role must exist and be active" message. That ordering is
    what stops the definer context from being used to probe accounts.
    """
    me = accounts["me"]
    with conn.transaction(force_rollback=True):
        _act_as(conn, me["id"])
        conn.execute("savepoint grant_probe")
        with pytest.raises(pg_errors.InsufficientPrivilege) as excinfo:
            conn.execute(
                """
                insert into public.user_role_assignments (user_id, role_id)
                select %s, id from public.roles where code = 'SUPER_ADMIN'
                """,
                (str(me["id"]),),
            )
        assert excinfo.value.sqlstate == "42501"
        assert "USER.MANAGE" in str(excinfo.value)
        conn.execute("rollback to savepoint grant_probe")
        escalated = conn.execute(
            """
            select count(*) as total
              from public.user_role_assignments ura
              join public.roles r on r.id = ura.role_id
             where r.code = 'SUPER_ADMIN'
            """
        ).fetchone()["total"]
    assert escalated == 0


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
    expected = accounts["total_users"]
    with conn.transaction(force_rollback=True):
        _act_as(conn, super_admin["id"])
        actual = conn.execute("select count(*) as total from public.users").fetchone()["total"]
    assert actual == expected


# ---------------------------------------------------------------------------
# Phase 1 security closure (F10, F12, F14)
# ---------------------------------------------------------------------------
APPROVED_TABLES = {
    "attachments",
    "bureau_memberships",
    "bureaus",
    "case_access_grants",
    "case_access_requests",
    "case_action_history",
    "case_bureau_assignments",
    "case_deadlines",
    "case_escalations",
    "case_notes",
    "case_officer_assignments",
    "case_relationships",
    "case_statuses",
    "case_transfers",
    "cases",
    "complaint_categories",
    "duplicate_candidates",
    "escalation_rules",
    "institution_aliases",
    "institution_verification_tasks",
    "institutions",
    "intake_channels",
    "notification_rules",
    "notifications",
    "permissions",
    "regions",
    "role_permissions",
    "roles",
    "sla_policies",
    "submissions",
    "user_role_assignments",
    "users",
}

BUSINESS_TABLES = (
    "cases",
    "case_relationships",
    "complaint_categories",
    "duplicate_candidates",
    "institution_verification_tasks",
    "intake_channels",
    "submissions",
)


def _permanent_admin_assignment(executor: Any, user_id: UUID) -> UUID | None:
    """The active, non-expiring SUPER_ADMIN assignment of one user."""
    row = executor.execute(
        """
        select ura.id
          from public.user_role_assignments ura
          join public.roles r
            on r.id = ura.role_id
           and r.is_active
           and r.scope_type = 'global'
         where ura.user_id = %s
           and ura.bureau_id is null
           and ura.assignment_status = 'active'
           and ura.expires_at is null
           and r.code = 'SUPER_ADMIN'
         limit 1
        """,
        (str(user_id),),
    ).fetchone()
    return row["id"] if row else None


def _super_admin_or_skip(accounts) -> dict:
    super_admin = accounts["super"]
    if super_admin is None:
        pytest.skip("No active Super Admin account found.")
    return super_admin


def _expect_last_admin_refusal(conn, statement: str, params: tuple = ()) -> None:
    """Assert the guard refuses the statement, then keep the transaction usable."""
    conn.execute("savepoint admin_guard")
    with pytest.raises(pg_errors.RaiseException) as excinfo:
        conn.execute(statement, params)
    assert "permanent global administrator" in str(excinfo.value)
    conn.execute("rollback to savepoint admin_guard")


def test_anon_has_no_grants_on_any_public_table(conn) -> None:
    """F10: `anon` holds no privilege on any public table."""
    total = conn.execute(
        """
        select count(*) as total
          from information_schema.role_table_grants
         where table_schema = 'public' and grantee = 'anon'
        """
    ).fetchone()["total"]
    assert total == 0


def test_authenticated_has_no_ddl_privileges_on_business_tables(conn) -> None:
    """F10: no TRUNCATE/REFERENCES/TRIGGER anywhere in the public schema.

    ``information_schema.role_table_grants`` does not expose PostgreSQL 17's
    MAINTAIN privilege, so MAINTAIN is checked separately with
    ``has_table_privilege`` below.
    """
    rows = conn.execute(
        """
        select table_name, privilege_type
          from information_schema.role_table_grants
         where table_schema = 'public'
           and grantee = 'authenticated'
           and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
        """
    ).fetchall()
    assert rows == []


def test_authenticated_has_no_maintain_on_intake_tables(conn) -> None:
    """Phase 2.1 removes PostgreSQL 17 MAINTAIN from the two intake tables."""
    for table in ("submissions", "intake_channels"):
        granted = conn.execute(
            "select has_table_privilege(%s, %s, 'MAINTAIN') as granted",
            ("authenticated", f"public.{table}"),
        ).fetchone()["granted"]
        assert granted is False, table


def test_authenticated_cannot_write_the_permission_catalogue(conn, accounts) -> None:
    """F12: the capability catalogue is read-only through the Data API."""
    super_admin = _super_admin_or_skip(accounts)
    with conn.transaction(force_rollback=True):
        _act_as(conn, super_admin["id"])
        statements = (
            "delete from public.role_permissions where false",
            "update public.role_permissions set granted_at = granted_at where false",
            """
            insert into public.role_permissions (role_id, permission_id)
            select r.id, p.id from public.roles r, public.permissions p where false
            """,
        )
        for statement in statements:
            conn.execute("savepoint catalogue_probe")
            with pytest.raises(pg_errors.InsufficientPrivilege):
                conn.execute(statement)
            conn.execute("rollback to savepoint catalogue_probe")


def test_cleared_claims_do_not_unlock_the_assignment_trigger(conn, accounts) -> None:
    """F14: clearing request.jwt.claims must not skip the capability gate.

    The previous draft keyed its gate on `auth_uid() IS NULL`, but that GUC is
    client-settable, so a caller could reach the SECURITY DEFINER body and use
    its error messages to probe accounts. The gate now keys off the session.
    """
    me = accounts["me"]
    with conn.transaction(force_rollback=True):
        _act_as(conn, me["id"])
        conn.execute("select set_config('request.jwt.claims', '', true)")
        conn.execute("savepoint claims_probe")
        with pytest.raises(pg_errors.InsufficientPrivilege) as excinfo:
            conn.execute(
                """
                insert into public.user_role_assignments (user_id, role_id)
                values (%s, gen_random_uuid())
                """,
                (str(me["id"]),),
            )
        assert excinfo.value.sqlstate == "42501"
        assert "USER.MANAGE" in str(excinfo.value)
        assert "Role must exist" not in str(excinfo.value)
        conn.execute("rollback to savepoint claims_probe")


def test_last_administrator_cannot_be_revoked(conn, accounts) -> None:
    """F12: self-revocation of the only permanent administrator is refused."""
    super_admin = _super_admin_or_skip(accounts)
    with conn.transaction(force_rollback=True):
        assignment_id = _permanent_admin_assignment(conn, super_admin["id"])
        assert assignment_id is not None
        _act_as(conn, super_admin["id"])
        _expect_last_admin_refusal(
            conn,
            """
            update public.user_role_assignments
               set assignment_status = 'revoked', revoked_at = now()
             where id = %s
            """,
            (str(assignment_id),),
        )
        still_active = conn.execute(
            "select assignment_status from public.user_role_assignments where id = %s",
            (str(assignment_id),),
        ).fetchone()["assignment_status"]
    assert still_active == "active"


def test_last_administrator_cannot_receive_a_future_expiry(conn, accounts) -> None:
    """F12: an expiry in the future would silently remove the last admin."""
    super_admin = _super_admin_or_skip(accounts)
    with conn.transaction(force_rollback=True):
        assignment_id = _permanent_admin_assignment(conn, super_admin["id"])
        assert assignment_id is not None
        _act_as(conn, super_admin["id"])
        _expect_last_admin_refusal(
            conn,
            "update public.user_role_assignments set expires_at = now() + interval '30 days'"
            " where id = %s",
            (str(assignment_id),),
        )
        expires_at = conn.execute(
            "select expires_at from public.user_role_assignments where id = %s",
            (str(assignment_id),),
        ).fetchone()["expires_at"]
    assert expires_at is None


def test_last_administrator_cannot_be_deactivated(conn, accounts) -> None:
    """F12: the last administrator cannot deactivate their own account."""
    super_admin = _super_admin_or_skip(accounts)
    with conn.transaction(force_rollback=True):
        _act_as(conn, super_admin["id"])
        _expect_last_admin_refusal(
            conn,
            "update public.users set account_status = 'suspended' where id = %s",
            (str(super_admin["id"]),),
        )
        status = conn.execute(
            "select account_status from public.users where id = %s",
            (str(super_admin["id"]),),
        ).fetchone()["account_status"]
    assert status == "active"


def test_user_manage_permission_cannot_be_deactivated(conn, accounts) -> None:
    """F12: disabling USER.MANAGE must not strand the administrator."""
    super_admin = _super_admin_or_skip(accounts)
    with conn.transaction(force_rollback=True):
        _act_as(conn, super_admin["id"])
        _expect_last_admin_refusal(
            conn,
            "update public.permissions set is_active = false where code = 'USER.MANAGE'",
        )
        active = conn.execute(
            "select is_active from public.permissions where code = 'USER.MANAGE'"
        ).fetchone()["is_active"]
    assert active is True


def test_administrator_role_cannot_be_deactivated(conn, accounts) -> None:
    """F12: disabling the administrator role must not strand the administrator."""
    super_admin = _super_admin_or_skip(accounts)
    with conn.transaction(force_rollback=True):
        _act_as(conn, super_admin["id"])
        _expect_last_admin_refusal(
            conn,
            "update public.roles set is_active = false where code = 'SUPER_ADMIN'",
        )
        active = conn.execute(
            "select is_active from public.roles where code = 'SUPER_ADMIN'"
        ).fetchone()["is_active"]
    assert active is True


def test_last_administrator_grant_cannot_be_deleted(conn, accounts) -> None:
    """F12: the owner path cannot strip the last USER.MANAGE grant either."""
    super_admin = _super_admin_or_skip(accounts)
    with conn.transaction(force_rollback=True):
        pair = conn.execute(
            """
            select rp.role_id, rp.permission_id
              from public.role_permissions rp
              join public.roles r on r.id = rp.role_id and r.code = 'SUPER_ADMIN'
              join public.permissions p
                on p.id = rp.permission_id and p.code = 'USER.MANAGE'
            """
        ).fetchone()
        assert pair is not None
        _expect_last_admin_refusal(
            conn,
            "delete from public.role_permissions where role_id = %s and permission_id = %s",
            (str(pair["role_id"]), str(pair["permission_id"])),
        )
        remaining = conn.execute(
            "select count(*) as total from public.role_permissions"
            " where role_id = %s and permission_id = %s",
            (str(pair["role_id"]), str(pair["permission_id"])),
        ).fetchone()["total"]
    assert remaining == 1


def test_expiring_second_administrator_does_not_satisfy_the_invariant(
    conn, accounts
) -> None:
    """F12: an administrator who will expire does not protect the last one."""
    super_admin = _super_admin_or_skip(accounts)
    me = accounts["me"]
    with conn.transaction(force_rollback=True):
        assignment_id = _permanent_admin_assignment(conn, super_admin["id"])
        assert assignment_id is not None
        conn.execute(
            """
            insert into public.user_role_assignments (user_id, role_id, assignment_status, expires_at)
            select %s, id, 'active', now() + interval '90 days'
              from public.roles where code = 'SUPER_ADMIN'
            """,
            (str(me["id"]),),
        )
        _expect_last_admin_refusal(
            conn,
            "update public.user_role_assignments set expires_at = now() + interval '30 days'"
            " where id = %s",
            (str(assignment_id),),
        )


def test_revocation_allowed_when_second_permanent_administrator_exists(
    conn, accounts
) -> None:
    """F12 negative control: a second permanent administrator unblocks removal."""
    super_admin = _super_admin_or_skip(accounts)
    me = accounts["me"]
    with conn.transaction(force_rollback=True):
        assignment_id = _permanent_admin_assignment(conn, super_admin["id"])
        assert assignment_id is not None
        conn.execute(
            """
            insert into public.user_role_assignments (user_id, role_id, assignment_status)
            select %s, id, 'active' from public.roles where code = 'SUPER_ADMIN'
            """,
            (str(me["id"]),),
        )
        updated = conn.execute(
            """
            update public.user_role_assignments
               set assignment_status = 'revoked', revoked_at = now()
             where id = %s
            """,
            (str(assignment_id),),
        )
        assert updated.rowcount == 1
        permanent_admins = conn.execute(
            """
            select count(*) as total
              from public.user_role_assignments ura
              join public.roles r
                on r.id = ura.role_id and r.is_active and r.scope_type = 'global'
              join public.role_permissions rp on rp.role_id = r.id
              join public.permissions p
                on p.id = rp.permission_id and p.is_active and p.code = 'USER.MANAGE'
              join public.users u on u.id = ura.user_id and u.account_status = 'active'
             where ura.bureau_id is null
               and ura.assignment_status = 'active'
               and ura.expires_at is null
            """
        ).fetchone()["total"]
    assert permanent_admins == 1


def test_concurrent_revocations_cannot_remove_both_administrators(accounts) -> None:
    """F12: the advisory lock plus fresh snapshot prevents a two-session lockout.

    Two sessions each revoke a different administrator. The first commits and
    the second blocks on the guard's advisory lock; after the commit it must see
    the new state and refuse. This needs real transactions (a rollback cannot
    prove the interaction), so the temporary assignment is removed in a
    ``finally`` block and the administrator count is re-checked afterwards.
    """
    assert DATABASE_URL
    super_admin = _super_admin_or_skip(accounts)
    me = accounts["me"]

    with psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=False) as owner:
        assignment_id = _permanent_admin_assignment(owner, super_admin["id"])
        assert assignment_id is not None
        temporary_id = owner.execute(
            """
            insert into public.user_role_assignments (user_id, role_id, assignment_status)
            select %s, id, 'active' from public.roles where code = 'SUPER_ADMIN'
            returning id
            """,
            (str(me["id"]),),
        ).fetchone()["id"]
        owner.commit()

    session_a: psycopg.Connection | None = None
    session_b: psycopg.Connection | None = None
    outcome: dict[str, str | None] = {"result": None}
    try:
        session_a = psycopg.connect(
            DATABASE_URL, row_factory=dict_row, autocommit=False
        )
        _act_as(session_a, super_admin["id"])
        session_a.execute(
            """
            update public.user_role_assignments
               set assignment_status = 'revoked', revoked_at = now()
             where id = %s
            """,
            (str(temporary_id),),
        )

        session_b = psycopg.connect(
            DATABASE_URL, row_factory=dict_row, autocommit=False
        )
        _act_as(session_b, super_admin["id"])

        def revoke_last_administrator() -> None:
            try:
                session_b.execute(
                    """
                    update public.user_role_assignments
                       set assignment_status = 'revoked', revoked_at = now()
                     where id = %s
                    """,
                    (str(assignment_id),),
                )
                session_b.commit()
                outcome["result"] = "accepted"
            except psycopg.Error as exc:
                outcome["result"] = exc.sqlstate
                session_b.rollback()

        worker = threading.Thread(target=revoke_last_administrator, daemon=True)
        worker.start()
        time.sleep(0.75)
        assert worker.is_alive(), "the second revocation was not blocked by the guard"
        session_a.commit()
        worker.join(timeout=30)
        assert not worker.is_alive()
        assert outcome["result"] == "P0001"
    finally:
        for session in (session_a, session_b):
            if session is not None and not session.closed:
                try:
                    session.rollback()
                finally:
                    session.close()
        with psycopg.connect(
            DATABASE_URL, row_factory=dict_row, autocommit=True
        ) as cleanup:
            cleanup.execute(
                """
                update public.user_role_assignments
                   set assignment_status = 'active', revoked_at = null
                 where id = %s and assignment_status = 'revoked'
                """,
                (str(assignment_id),),
            )
            cleanup.execute(
                "delete from public.user_role_assignments where id = %s",
                (str(temporary_id),),
            )
            remaining = cleanup.execute(
                """
                select count(*) as total
                  from public.user_role_assignments ura
                  join public.roles r
                    on r.id = ura.role_id and r.is_active and r.scope_type = 'global'
                  join public.role_permissions rp on rp.role_id = r.id
                  join public.permissions p
                    on p.id = rp.permission_id and p.is_active and p.code = 'USER.MANAGE'
                  join public.users u on u.id = ura.user_id and u.account_status = 'active'
                 where ura.bureau_id is null
                   and ura.assignment_status = 'active'
                   and ura.expires_at is null
                """
            ).fetchone()["total"]
        assert remaining >= 1

    assert outcome["result"] == "P0001"


def test_public_schema_still_has_32_tables(conn) -> None:
    """The closure creates no table and removes none."""
    names = {
        row["tablename"]
        for row in conn.execute(
            "select tablename from pg_tables where schemaname = 'public'"
        ).fetchall()
    }
    assert len(names) == 32
    assert names == APPROVED_TABLES


def test_authenticated_cannot_delete_role_assignments(conn, accounts) -> None:
    """F12: there is no Data API path that hard-deletes an assignment."""
    me = accounts["me"]
    with conn.transaction(force_rollback=True):
        _act_as(conn, me["id"])
        conn.execute("savepoint delete_probe")
        with pytest.raises(pg_errors.InsufficientPrivilege):
            conn.execute("delete from public.user_role_assignments where false")
        conn.execute("rollback to savepoint delete_probe")


# ---------------------------------------------------------------------------
# Phase 2.1 simulated intake
#
# Every probe below runs in a transaction that is always rolled back, so the
# preserved-submission guarantees are exercised without writing demo rows.
# ---------------------------------------------------------------------------
INTAKE_FUNCTION = (
    "public.create_demo_submission(text, text, text, text, text, text, text, "
    "text, text, timestamptz, boolean)"
)

# A past instant (the function refuses timestamps more than five minutes ahead).
INTAKE_ARGS = (
    "AICTE_SIM",
    "DEMO-UNKNOWN-9999",
    "Illustrative Institute",
    "Water supply disruption",
    "पानी की आपूर्ति ठप है — original text 123",
    "hi",
    None,
    "evt-rls-0001",
    "idem-rls-0001",
    "2026-10-20T10:25:00+05:30",
    True,
)


def _call_intake(conn: psycopg.Connection, args: tuple = INTAKE_ARGS) -> dict:
    """Invoke the write path exactly as the API does: as one_desk_intake."""
    conn.execute("reset role")
    conn.execute("set local role one_desk_intake")
    try:
        row = conn.execute(
            "select public.create_demo_submission("
            + ", ".join(["%s"] * 11)
            + ") as result",
            args,
        ).fetchone()
    finally:
        conn.execute("reset role")
    return row["result"]


def _call_intake_as(conn: psycopg.Connection, role: str) -> dict:
    conn.execute("reset role")
    conn.execute(f"set local role {role}")
    try:
        row = conn.execute(
            "select public.create_demo_submission("
            + ", ".join(["%s"] * 11)
            + ") as result",
            INTAKE_ARGS,
        ).fetchone()
    finally:
        conn.execute("reset role")
    return row["result"]


def _intake_count(conn: psycopg.Connection) -> int:
    conn.execute("reset role")
    return conn.execute("select count(*) as total from public.submissions").fetchone()["total"]


def test_intake_function_is_a_pinned_definer_with_an_allowlist(conn) -> None:
    row = conn.execute(
        """
        select p.prosecdef,
               p.proconfig,
               pg_get_userbyid(p.proowner) as owner,
               pg_get_functiondef(p.oid) as definition
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'create_demo_submission'
        """
    ).fetchone()
    assert row is not None
    assert row["prosecdef"] is True
    assert row["owner"] == "postgres"
    config = row["proconfig"] or []
    assert 'search_path=""' in config
    assert any(item.startswith("statement_timeout=") for item in config)
    assert "current_setting('role', true)" in row["definition"]
    assert "'one_desk_intake'" in row["definition"]

    role = conn.execute(
        "select rolcanlogin, rolbypassrls, rolsuper from pg_roles"
        " where rolname = 'one_desk_intake'"
    ).fetchone()
    assert role is not None
    assert role["rolcanlogin"] is False
    assert role["rolbypassrls"] is False
    assert role["rolsuper"] is False


def test_intake_execute_is_granted_only_to_the_intake_role(conn) -> None:
    for role, expected in (
        ("anon", False),
        ("authenticated", False),
        ("service_role", False),
        ("one_desk_intake", True),
    ):
        actual = conn.execute(
            "select has_function_privilege(%s, %s, 'EXECUTE') as granted",
            (role, INTAKE_FUNCTION),
        ).fetchone()["granted"]
        assert actual is expected, role


def test_intake_role_holds_no_table_privilege(conn) -> None:
    grants = conn.execute(
        """
        select table_name, privilege_type
          from information_schema.role_table_grants
         where table_schema = 'public' and grantee = 'one_desk_intake'
        """
    ).fetchall()
    assert grants == []

    with conn.transaction(force_rollback=True):
        conn.execute("set local role one_desk_intake")
        for statement in (
            "select id from public.submissions limit 1",
            "select id from public.intake_channels limit 1",
            "update public.submissions set subject = 'x' where false",
            "delete from public.submissions where false",
        ):
            conn.execute("savepoint intake_read")
            with pytest.raises(pg_errors.InsufficientPrivilege):
                conn.execute(statement)
            conn.execute("rollback to savepoint intake_read")


def test_authenticated_cannot_write_intake_tables(conn, accounts) -> None:
    """Preservation: no Data API path can rewrite or delete a submission."""
    me = accounts["me"]
    with conn.transaction(force_rollback=True):
        _act_as(conn, me["id"])
        for statement in (
            "insert into public.submissions (intake_channel_id, subject, original_text)"
            " select id, 'x', 'y' from public.intake_channels limit 1",
            "update public.submissions set subject = 'overwritten' where false",
            "delete from public.submissions where false",
            "update public.intake_channels set is_active = false where false",
            "delete from public.intake_channels where false",
        ):
            conn.execute("savepoint intake_write")
            with pytest.raises(pg_errors.InsufficientPrivilege):
                conn.execute(statement)
            conn.execute("rollback to savepoint intake_write")


def test_public_intake_preserves_the_original_submission(conn) -> None:
    with conn.transaction(force_rollback=True):
        cases_before = conn.execute("select count(*) as total from public.cases").fetchone()["total"]
        before = _intake_count(conn)

        result = _call_intake(conn)
        assert result["outcome"] == "created", result
        assert result["is_simulated"] is True
        assert result["intake_status"] == "awaiting_institution_verification"
        assert result["institution_resolved"] is False
        assert result["external_reference"].startswith("SIM-AICTE_SIM-")

        row = conn.execute(
            "select * from public.submissions where id = %s", (result["submission_id"],)
        ).fetchone()
        assert row["original_text"] == INTAKE_ARGS[4]
        assert row["subject"] == INTAKE_ARGS[3]
        assert row["original_language"] == "hi"
        assert row["normalized_text"] is None
        assert row["normalization_version"] is None
        assert row["submitter_reference"] is None
        assert row["canonical_case_id"] is None
        assert row["institution_id"] is None
        assert row["source_metadata"]["demo"] is True
        assert row["source_metadata"]["reference_origin"] == "demo_generated"
        assert row["source_metadata"]["source_submitted_at"] == "2026-10-20T04:55:00.000Z"

        # A submission never creates a case or a duplicate candidate. Phase 2.2
        # auto-queues exactly one human institution-verification task for an
        # unresolved submission.
        assert _intake_count(conn) == before + 1
        cases_after = conn.execute("select count(*) as total from public.cases").fetchone()["total"]
        assert cases_after == cases_before
        for table in ("duplicate_candidates", "attachments"):
            total = conn.execute(
                f'select count(*) as total from public."{table}" where submission_id = %s',
                (result["submission_id"],),
            ).fetchone()["total"]
            assert total == 0, table

        conn.execute("reset role")
        tasks = conn.execute(
            "select id, status, candidate_institution_id, submitted_institution_name"
            "  from public.institution_verification_tasks where submission_id = %s",
            (result["submission_id"],),
        ).fetchall()
        assert len(tasks) == 1, tasks
        assert tasks[0]["status"] == "pending"
        assert tasks[0]["candidate_institution_id"] is None


def test_public_intake_replay_and_conflict_do_not_duplicate(conn) -> None:
    with conn.transaction(force_rollback=True):
        before = _intake_count(conn)
        created = _call_intake(conn)
        assert created["outcome"] == "created"

        replay = _call_intake(conn)
        assert replay["outcome"] == "replay"
        assert replay["submission_id"] == created["submission_id"]

        changed_time = list(INTAKE_ARGS)
        changed_time[9] = "2026-10-20T10:25:01+05:30"
        conflict = _call_intake(conn, tuple(changed_time))
        assert conflict["outcome"] == "conflict"
        assert conflict["code"] == "IDEMPOTENCY_PAYLOAD_MISMATCH"
        assert "submission_id" not in conflict

        # A new key with identical content is a genuinely separate submission.
        second = list(INTAKE_ARGS)
        second[7] = "evt-rls-0002"
        second[8] = "idem-rls-0002"
        assert _call_intake(conn, tuple(second))["outcome"] == "created"
        assert _intake_count(conn) == before + 2


def test_public_intake_validation_failures_create_nothing(conn) -> None:
    with conn.transaction(force_rollback=True):
        before = _intake_count(conn)
        cases = (
            ({"index": 10, "value": False}, "CONSENT_REQUIRED"),
            ({"index": 5, "value": "fr"}, "UNSUPPORTED_LANGUAGE"),
            ({"index": 3, "value": "   "}, "SUBJECT_REQUIRED"),
            ({"index": 4, "value": "   "}, "TEXT_REQUIRED"),
            ({"index": 1, "value": None, "clear_name": True}, "INSTITUTION_IDENTIFIER_REQUIRED"),
            ({"index": 9, "value": "2099-01-01T00:00:00Z"}, "SOURCE_TIME_IN_FUTURE"),
        )
        for change, expected_code in cases:
            bad = list(INTAKE_ARGS)
            bad[change["index"]] = change["value"]
            if change.get("clear_name"):
                bad[2] = None
            bad[7] = f"evt-rls-bad-{expected_code}"
            bad[8] = f"idem-rls-bad-{expected_code}"
            result = _call_intake(conn, tuple(bad))
            assert result.get("code") == expected_code, result

        unknown = list(INTAKE_ARGS)
        unknown[0] = "NOPE_SIM"
        assert _call_intake(conn, tuple(unknown))["outcome"] == "channel_unavailable"

        assert _intake_count(conn) == before


def test_caller_gate_refuses_other_roles_even_after_an_accidental_grant(conn) -> None:
    """The allowlist is the last line of defence, not the grant alone."""
    with conn.transaction(force_rollback=True):
        before = _intake_count(conn)
        conn.execute(f"grant execute on function {INTAKE_FUNCTION} to authenticated")
        granted = conn.execute(
            "select has_function_privilege('authenticated', %s, 'EXECUTE') as granted",
            (INTAKE_FUNCTION,),
        ).fetchone()["granted"]
        assert granted is True

        result = _call_intake_as(conn, "authenticated")
        assert result["outcome"] == "channel_unavailable"
        assert result["code"] == "INTAKE_CHANNEL_UNAVAILABLE"
        assert _intake_count(conn) == before


def test_owner_session_without_set_role_is_refused(conn) -> None:
    with conn.transaction(force_rollback=True):
        before = _intake_count(conn)
        conn.execute("reset role")
        owned = conn.execute(
            "select public.create_demo_submission("
            + ", ".join(["%s"] * 11)
            + ") as result",
            INTAKE_ARGS,
        ).fetchone()["result"]
        assert owned["outcome"] == "channel_unavailable"
        assert _intake_count(conn) == before


def test_submission_bodies_require_the_submission_view_capability(conn, accounts) -> None:
    me = accounts["me"]
    super_admin = accounts["super"]
    with conn.transaction(force_rollback=True):
        created = _call_intake(conn)
        assert created["outcome"] == "created"

        # An ordinary active user has no global SUBMISSION.VIEW grant.
        _act_as(conn, me["id"])
        assert conn.execute("select id from public.submissions").fetchall() == []

        if super_admin is None:
            pytest.skip("No active Super Admin account found.")
        _act_as(conn, super_admin["id"])
        visible = {
            row["id"] for row in conn.execute("select id from public.submissions").fetchall()
        }
        assert UUID(created["submission_id"]) in visible

        # Channel reference data is visible to any active application user.
        assert len(conn.execute("select id from public.intake_channels").fetchall()) == 2


def test_anonymous_callers_cannot_read_or_create(conn) -> None:
    with conn.transaction(force_rollback=True):
        _act_as(conn, None, role="anon")
        conn.execute("savepoint anon_read")
        with pytest.raises(pg_errors.InsufficientPrivilege):
            conn.execute("select id from public.submissions").fetchall()
        conn.execute("rollback to savepoint anon_read")

        conn.execute("savepoint anon_call")
        with pytest.raises(pg_errors.InsufficientPrivilege):
            conn.execute(
                "select public.create_demo_submission("
                + ", ".join(["%s"] * 11)
                + ")",
                INTAKE_ARGS,
            )
        conn.execute("rollback to savepoint anon_call")


def test_concurrent_intake_calls_serialise_on_the_same_source_identity() -> None:
    """Two connections, one key: the second call waits and cannot double-insert.

    Both transactions are rolled back, so nothing is preserved by this test.
    The replay/conflict semantics on a committed row are covered by
    ``test_public_intake_replay_and_conflict_do_not_duplicate``.
    """
    assert DATABASE_URL
    args = list(INTAKE_ARGS)
    args[7] = "evt-rls-concurrent"
    args[8] = "idem-rls-concurrent"
    args = tuple(args)

    session_a: psycopg.Connection | None = None
    session_b: psycopg.Connection | None = None
    outcome: dict[str, dict | str | None] = {"result": None}
    try:
        session_a = psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=False)
        _call_intake(session_a, args)

        session_b = psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=False)
        session_b.execute("set local role one_desk_intake")

        def call_from_b() -> None:
            try:
                row = session_b.execute(
                    "select public.create_demo_submission("
                    + ", ".join(["%s"] * 11)
                    + ") as result",
                    args,
                ).fetchone()
                outcome["result"] = row["result"]
                session_b.rollback()
            except psycopg.Error as exc:  # pragma: no cover - a failure path
                outcome["result"] = type(exc).__name__
                session_b.rollback()

        worker = threading.Thread(target=call_from_b, daemon=True)
        worker.start()
        time.sleep(0.75)
        assert worker.is_alive(), "the second call did not wait for the first transaction"

        # Rolling the first call back releases the advisory lock. The second
        # call now sees no row, so it creates one exactly once.
        session_a.rollback()
        worker.join(timeout=30)
        assert not worker.is_alive()
        assert isinstance(outcome["result"], dict)
        assert outcome["result"]["outcome"] == "created"
    finally:
        for session in (session_a, session_b):
            if session is not None and not session.closed:
                try:
                    session.rollback()
                finally:
                    session.close()

    with psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=True) as cleanup:
        persisted = cleanup.execute(
            "select count(*) as total from public.submissions"
            " where idempotency_key = 'idem-rls-concurrent'"
        ).fetchone()["total"]
    assert persisted == 0


# ---------------------------------------------------------------------------
# Phase 2.2 institution verification
#
# `authenticated` holds no privilege on the task table, so every probe goes
# through the capability-gated SECURITY DEFINER surface. All writes below run
# inside a transaction that is always rolled back.
# ---------------------------------------------------------------------------
VERIFICATION_TASK_ROWS = (
    "public.institution_verification_task_rows(uuid, text, text, text, text, "
    "text, integer, integer)"
)
VERIFICATION_COMMANDS = (
    "public.decide_institution_verification(uuid, text, uuid, text, timestamptz)",
    "public.request_institution_verification_round(uuid, text, timestamptz)",
)
# Every Phase 2.2 function except the frozen submission trigger.
VERIFICATION_FUNCTIONS = (
    "institution_match_candidates_internal",
    "institution_verification_submission_metadata",
    "institution_match_candidates",
    "institution_verification_task_rows",
    "correction_request_requester",
    "decide_institution_verification",
    "request_institution_verification_round",
    "queue_institution_verification",
    "guard_institution_verification_task",
    "apply_institution_verification_outcome",
    "guard_case_creation_open_round",
)
# The parser is a pure helper and the evidence matcher is internal; neither is
# SECURITY DEFINER by design.
NON_DEFINER_FUNCTIONS = {"correction_request_requester", "institution_match_candidates_internal"}


def _verification_super_admin(accounts) -> dict:
    super_admin = accounts["super"]
    if super_admin is None:
        pytest.skip("Phase 2.2 RLS tests need an active Super Admin account.")
    return super_admin


def _verified_institution(conn) -> UUID | None:
    row = conn.execute(
        "select id from public.institutions"
        " where verification_status = 'verified' and is_active"
        " order by created_at asc, id asc limit 1"
    ).fetchone()
    return row["id"] if row else None


def _insert_probe_submission(
    conn: psycopg.Connection,
    *,
    institution_id: UUID | None = None,
    intake_status: str = "awaiting_institution_verification",
    institution_name: str = "Probe Institute",
) -> UUID:
    """Insert a submission directly as the owner, bypassing RLS but not triggers."""
    row = conn.execute(
        """
        insert into public.submissions (
            intake_channel_id, institution_id, institution_name_as_submitted,
            subject, original_text, intake_status
        )
        select c.id, %s, %s, 'Probe subject', 'Probe complaint body', %s
          from public.intake_channels c
         order by c.code
         limit 1
        returning id
        """,
        (institution_id, institution_name, intake_status),
    ).fetchone()
    assert row is not None
    return row["id"]


def _insert_probe_task(
    conn: psycopg.Connection,
    submission_id: UUID,
    *,
    status: str = "pending",
    notes: str | None = None,
) -> UUID:
    row = conn.execute(
        """
        insert into public.institution_verification_tasks
            (submission_id, submitted_institution_name, status, priority, resolution_notes)
        values (%s, 'Probe Institute', %s, 'normal', %s)
        returning id
        """,
        (submission_id, status, notes),
    ).fetchone()
    assert row is not None
    return row["id"]


def test_authenticated_holds_no_privilege_on_the_verification_task_table(conn, accounts) -> None:
    """The queue table is unreachable from the Data API in both directions."""
    grants = conn.execute(
        """
        select p,
               has_table_privilege('authenticated',
                                   'public.institution_verification_tasks', p) as granted
          from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE',
                            'REFERENCES','TRIGGER','MAINTAIN']) p
        """
    ).fetchall()
    assert [row["p"] for row in grants if row["granted"]] == []

    with conn.transaction(force_rollback=True):
        _act_as(conn, accounts["me"]["id"])
        for statement in (
            "select id from public.institution_verification_tasks limit 1",
            "insert into public.institution_verification_tasks"
            " (submission_id, submitted_institution_name)"
            " values (gen_random_uuid(), 'Forbidden')",
            "update public.institution_verification_tasks set status = 'rejected' where false",
            "delete from public.institution_verification_tasks where false",
        ):
            conn.execute("savepoint verification_priv")
            with pytest.raises(pg_errors.InsufficientPrivilege):
                conn.execute(statement)
            conn.execute("rollback to savepoint verification_priv")


def test_verification_surface_is_a_pinned_definer_with_narrow_grants(conn) -> None:
    rows = conn.execute(
        """
        select p.proname,
               p.prosecdef,
               coalesce(p.proconfig, array[]::text[]) as config,
               pg_get_userbyid(p.proowner) as owner
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = any(%s)
        """,
        (list(VERIFICATION_FUNCTIONS),),
    ).fetchall()
    assert {row["proname"] for row in rows} == set(VERIFICATION_FUNCTIONS)

    for row in rows:
        assert row["owner"] == "postgres", row["proname"]
        assert 'search_path=""' in row["config"], row["proname"]
        if row["proname"] in NON_DEFINER_FUNCTIONS:
            assert row["prosecdef"] is False, row["proname"]
        else:
            assert row["prosecdef"] is True, row["proname"]

    # Gated read/command surface is executable by authenticated ...
    for signature in (VERIFICATION_TASK_ROWS, *VERIFICATION_COMMANDS):
        assert conn.execute(
            "select has_function_privilege('authenticated', %s, 'EXECUTE') as granted",
            (signature,),
        ).fetchone()["granted"] is True, signature

    # ... while the internal matcher and marker parser are not reachable at all.
    for role in ("anon", "authenticated", "service_role"):
        for signature in (
            "public.institution_match_candidates_internal(text, text, integer)",
            "public.correction_request_requester(text)",
        ):
            assert conn.execute(
                "select has_function_privilege(%s, %s, 'EXECUTE') as granted",
                (role, signature),
            ).fetchone()["granted"] is False, (role, signature)

    for role in ("anon", "service_role"):
        for signature in (
            VERIFICATION_TASK_ROWS,
            *VERIFICATION_COMMANDS,
            "public.institution_match_candidates(uuid)",
            "public.institution_verification_submission_metadata(uuid)",
        ):
            assert conn.execute(
                "select has_function_privilege(%s, %s, 'EXECUTE') as granted",
                (role, signature),
            ).fetchone()["granted"] is False, (role, signature)


def test_verification_queue_requires_the_global_capability(conn, accounts) -> None:
    super_admin = _verification_super_admin(accounts)
    with conn.transaction(force_rollback=True):
        _act_as(conn, accounts["me"]["id"])
        conn.execute("savepoint queue_capability")
        with pytest.raises(pg_errors.InsufficientPrivilege):
            conn.execute("select * from public.institution_verification_task_rows()")
        conn.execute("rollback to savepoint queue_capability")

        # The decision command is gated before it looks anything up.
        conn.execute("savepoint decide_capability")
        with pytest.raises(pg_errors.InsufficientPrivilege):
            conn.execute(
                "select public.decide_institution_verification(%s, 'reject', null, 'x')",
                (uuid4(),),
            )
        conn.execute("rollback to savepoint decide_capability")

        _act_as(conn, super_admin["id"])
        rows = conn.execute("select * from public.institution_verification_task_rows()").fetchall()
        assert isinstance(rows, list)


def test_verification_queue_never_returns_complaint_content(conn, accounts) -> None:
    super_admin = _verification_super_admin(accounts)
    with conn.transaction(force_rollback=True):
        created = _call_intake(conn)
        submission_id = UUID(created["submission_id"])

        _act_as(conn, super_admin["id"])
        rows = conn.execute(
            "select * from public.institution_verification_task_rows"
            "(null, 'all', 'all', null, null, 'recent', 100, 0)"
        ).fetchall()
        task = next(row for row in rows if row["out_submission_id"] == submission_id)

        forbidden = {"subject", "original_text", "normalized_text", "content_fingerprint"}
        assert forbidden.isdisjoint(task.keys())

        metadata = conn.execute(
            "select * from public.institution_verification_submission_metadata(%s)",
            (submission_id,),
        ).fetchall()
        assert len(metadata) == 1
        assert forbidden.isdisjoint(metadata[0].keys())

        # The task is the only one auto-created by the submission.
        conn.execute("reset role")
        tasks = conn.execute("select id from public.institution_verification_tasks"
                             " where submission_id = %s", (submission_id,)).fetchall()
        assert len(tasks) == 1
        assert task["out_round_type"] == "new_round"


def test_canonical_case_creation_is_blocked_by_an_open_round(conn) -> None:
    """A populated institution_id must not let a case bypass verification."""
    institution_id = _verified_institution(conn)
    if institution_id is None:
        pytest.skip("Phase 2.2 RLS tests need one verified active institution.")

    with conn.transaction(force_rollback=True):
        submission_id = _insert_probe_submission(
            conn,
            institution_id=institution_id,
            intake_status="ready_for_case_creation",
        )
        _insert_probe_task(conn, submission_id, status="pending")

        conn.execute("savepoint case_guard")
        with pytest.raises((pg_errors.RaiseException, pg_errors.ProgrammingError)) as raised:
            conn.execute(
                "insert into public.cases"
                " (case_number, institution_id, title, description, source_submission_id)"
                " values ('P22-OPEN-ROUND', %s, 'Probe case', 'Probe case body', %s)",
                (institution_id, submission_id),
            )
        assert raised.value.sqlstate == "P2V10"
        conn.execute("rollback to savepoint case_guard")

        # The status branch alone also blocks, even with no task row.
        status_only = _insert_probe_submission(
            conn,
            institution_id=institution_id,
            intake_status="awaiting_institution_verification",
        )
        conn.execute("savepoint case_status_guard")
        with pytest.raises((pg_errors.RaiseException, pg_errors.ProgrammingError)) as raised:
            conn.execute(
                "insert into public.cases"
                " (case_number, institution_id, title, description, source_submission_id)"
                " values ('P22-AWAITING', %s, 'Probe case', 'Probe case body', %s)",
                (institution_id, status_only),
            )
        assert raised.value.sqlstate == "P2V10"
        conn.execute("rollback to savepoint case_status_guard")

        # Regression: an active correction round with institution_id populated also blocks.
        corr_sub = _insert_probe_submission(
            conn,
            institution_id=institution_id,
            intake_status="ready_for_case_creation",
        )
        corr_marker = "[correction-request] requester=00000000-0000-0000-0000-000000000001 at=2026-10-29T10:00:00.000Z"
        _insert_probe_task(conn, corr_sub, status="in_review", notes=corr_marker)
        conn.execute("savepoint case_correction_guard")
        with pytest.raises((pg_errors.RaiseException, pg_errors.ProgrammingError)) as raised:
            conn.execute(
                "insert into public.cases"
                " (case_number, institution_id, title, description, source_submission_id)"
                " values ('P22-CORR-ROUND', %s, 'Probe case', 'Probe case body', %s)",
                (institution_id, corr_sub),
            )
        assert raised.value.sqlstate == "P2V10"
        conn.execute("rollback to savepoint case_correction_guard")

        # Positive control: once the round is resolved, a case is allowed.
        resolved = _insert_probe_submission(
            conn,
            institution_id=institution_id,
            intake_status="ready_for_case_creation",
        )
        conn.execute(
            "insert into public.institution_verification_tasks"
            " (submission_id, submitted_institution_name, status, resolved_at,"
            "  reviewed_by_user_id, resolution_notes)"
            " values (%s, 'Probe Institute', 'rejected', now(), null, 'No match')",
            (resolved,),
        )
        case_row = conn.execute(
            "insert into public.cases"
            " (case_number, institution_id, title, description, source_submission_id)"
            " values ('P22-RESOLVED', %s, 'Probe case', 'Probe case body', %s)"
            " returning id",
            (institution_id, resolved),
        ).fetchone()
        assert case_row is not None
        # Nothing above changed the preserved submission.
        assert conn.execute(
            "select canonical_case_id from public.submissions where id = %s", (submission_id,)
        ).fetchone()["canonical_case_id"] is None


def test_correction_round_requires_an_independent_reviewer(conn, accounts) -> None:
    super_admin = _verification_super_admin(accounts)
    institution_id = _verified_institution(conn)
    if institution_id is None:
        pytest.skip("Phase 2.2 RLS tests need one verified active institution.")

    marker = (
        f"[correction-request] requester={super_admin['id']} "
        "at=2026-10-29T10:00:00.000Z"
    )
    with conn.transaction(force_rollback=True):
        submission_id = _insert_probe_submission(conn, institution_id=institution_id)
        task_id = _insert_probe_task(conn, submission_id, status="in_review", notes=marker)

        conn.execute("savepoint self_confirm")
        with pytest.raises((pg_errors.RaiseException, pg_errors.ProgrammingError)) as raised:
            conn.execute(
                "update public.institution_verification_tasks"
                "   set status = 'verified', resolved_at = now(),"
                "       resolved_institution_id = %s, reviewed_by_user_id = %s,"
                "       resolution_notes = %s || E'\\nConfirmed'"
                " where id = %s",
                (institution_id, super_admin["id"], marker, task_id),
            )
        assert raised.value.sqlstate == "P2V14"
        conn.execute("rollback to savepoint self_confirm")

        # A correction round with no requester record fails closed.
        no_marker_sub = _insert_probe_submission(conn, institution_id=institution_id)
        no_marker_id = _insert_probe_task(
            conn, no_marker_sub, status="in_review", notes="No requester record"
        )
        conn.execute("savepoint missing_marker")
        with pytest.raises((pg_errors.RaiseException, pg_errors.ProgrammingError)) as raised:
            conn.execute(
                "update public.institution_verification_tasks"
                "   set status = 'verified', resolved_at = now(),"
                "       resolved_institution_id = %s, reviewed_by_user_id = %s"
                " where id = %s",
                (institution_id, super_admin["id"], no_marker_id),
            )
        assert raised.value.sqlstate == "P2V05"
        conn.execute("rollback to savepoint missing_marker")


def test_correction_request_marker_parser_fails_closed(conn) -> None:
    requester = uuid4()
    good = f"[correction-request] requester={requester} at=2026-10-29T10:00:00.000Z"

    with conn.transaction(force_rollback=True):
        assert conn.execute(
            "select public.correction_request_requester(%s) as requester", (good,)
        ).fetchone()["requester"] == requester
        assert conn.execute(
            "select public.correction_request_requester(%s) as requester", ("plain notes",)
        ).fetchone()["requester"] is None

        for malformed in (
            good + "\n" + good,
            "note\n" + good,
            "[correction-request] requester=not-a-uuid at=2026-10-29T10:00:00.000Z",
            f"[correction-request] requester={requester}",
        ):
            conn.execute("savepoint marker_parser")
            with pytest.raises((pg_errors.RaiseException, pg_errors.ProgrammingError)) as raised:
                conn.execute(
                    "select public.correction_request_requester(%s) as requester",
                    (malformed,),
                )
            assert raised.value.sqlstate == "P2V05", malformed
            conn.execute("rollback to savepoint marker_parser")


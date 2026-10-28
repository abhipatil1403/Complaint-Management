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

Every test runs inside a transaction that is always rolled back, so no data is
created or modified.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any
from uuid import UUID

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
    """F10: no TRUNCATE/REFERENCES/TRIGGER anywhere in the public schema."""
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

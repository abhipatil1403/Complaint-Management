"""SQL access for user, role and role-assignment administration (Phase 1)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Mapping
from uuid import UUID

from psycopg import AsyncConnection


async def _fetch_all(conn: AsyncConnection, sql: str, params: Mapping[str, Any]) -> list[dict[str, Any]]:
    cursor = await conn.execute(sql, params)
    return list(await cursor.fetchall())


async def _fetch_one(conn: AsyncConnection, sql: str, params: Mapping[str, Any]) -> dict[str, Any] | None:
    cursor = await conn.execute(sql, params)
    return await cursor.fetchone()


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
_USER_COLUMNS = """
    id, employee_code, full_name, display_name, official_email, designation,
    account_status, last_seen_at, created_at, updated_at
"""


async def list_users(
    conn: AsyncConnection, *, limit: int, offset: int, q: str | None, account_status: str | None
) -> list[dict[str, Any]]:
    return await _fetch_all(
        conn,
        f"""
        select {_USER_COLUMNS}
          from public.users
         where (%(q)s::text is null
                or full_name ilike '%%' || %(q)s || '%%'
                or official_email ilike '%%' || %(q)s || '%%'
                or employee_code ilike '%%' || %(q)s || '%%')
           and (%(account_status)s::text is null or account_status = %(account_status)s::text)
         order by full_name asc
         limit %(limit)s offset %(offset)s
        """,
        {
            "q": q,
            "account_status": account_status,
            "limit": limit + 1,
            "offset": offset,
        },
    )


async def get_user(conn: AsyncConnection, user_id: UUID) -> dict[str, Any] | None:
    return await _fetch_one(
        conn,
        f"select {_USER_COLUMNS} from public.users where id = %(user_id)s",
        {"user_id": str(user_id)},
    )


async def user_exists_and_active(conn: AsyncConnection, user_id: UUID) -> bool:
    row = await _fetch_one(
        conn,
        "select 1 as ok from public.users where id = %(user_id)s and account_status = 'active'",
        {"user_id": str(user_id)},
    )
    return row is not None


async def set_account_status(
    conn: AsyncConnection, user_id: UUID, account_status: str
) -> dict[str, Any] | None:
    return await _fetch_one(
        conn,
        f"""
        update public.users
           set account_status = %(account_status)s
         where id = %(user_id)s
        returning {_USER_COLUMNS}
        """,
        {"user_id": str(user_id), "account_status": account_status},
    )


async def update_profile(
    conn: AsyncConnection, user_id: UUID, values: Mapping[str, Any]
) -> dict[str, Any] | None:
    allowed = {"full_name", "display_name", "employee_code", "designation", "phone_number"}
    params: dict[str, Any] = {key: value for key, value in values.items() if key in allowed}
    if not params:
        return await get_user(conn, user_id)
    assignments = [f"{column} = %({column})s" for column in params]
    params["user_id"] = str(user_id)
    return await _fetch_one(
        conn,
        f"""
        update public.users
           set {", ".join(assignments)}
         where id = %(user_id)s
        returning {_USER_COLUMNS}
        """,
        params,
    )


# ---------------------------------------------------------------------------
# Roles and assignments
# ---------------------------------------------------------------------------
async def list_roles(conn: AsyncConnection) -> list[dict[str, Any]]:
    return await _fetch_all(
        conn,
        """
        select r.id,
               r.code,
               r.name,
               r.description,
               r.scope_type,
               r.is_system_role,
               r.is_active,
               coalesce(
                   array_agg(p.code order by p.code) filter (where p.code is not null),
                   '{}'::text[]
               ) as permission_codes
          from public.roles r
          left join public.role_permissions rp on rp.role_id = r.id
          left join public.permissions p on p.id = rp.permission_id and p.is_active
         group by r.id
         order by r.scope_type asc, r.code asc
        """,
        {},
    )


async def get_role_by_code(conn: AsyncConnection, role_code: str) -> dict[str, Any] | None:
    return await _fetch_one(
        conn,
        """
        select id, code, name, scope_type, is_active
          from public.roles
         where code = %(code)s
        """,
        {"code": role_code},
    )


async def list_role_assignments_for_user(
    conn: AsyncConnection, user_id: UUID, *, include_ended: bool = False
) -> list[dict[str, Any]]:
    return await _fetch_all(
        conn,
        """
        select ura.id,
               ura.role_id,
               r.code as role_code,
               r.name as role_name,
               r.scope_type,
               ura.bureau_id,
               b.code as bureau_code,
               b.name as bureau_name,
               ura.assignment_status,
               ura.assigned_by_user_id,
               ura.assigned_at,
               ura.expires_at,
               ura.revoked_at,
               ura.revocation_reason
          from public.user_role_assignments ura
          join public.roles r on r.id = ura.role_id
          left join public.bureaus b on b.id = ura.bureau_id
         where ura.user_id = %(user_id)s
           and (%(include_ended)s::boolean or ura.assignment_status = 'active')
         order by r.code asc
        """,
        {"user_id": str(user_id), "include_ended": include_ended},
    )


async def list_role_assignments_for_users(
    conn: AsyncConnection, user_ids: list[UUID]
) -> dict[UUID, list[dict[str, Any]]]:
    if not user_ids:
        return {}
    rows = await _fetch_all(
        conn,
        """
        select ura.user_id,
               ura.id,
               r.code as role_code,
               r.name as role_name,
               r.scope_type,
               ura.bureau_id,
               b.name as bureau_name,
               ura.assignment_status,
               ura.assigned_at
          from public.user_role_assignments ura
          join public.roles r on r.id = ura.role_id
          left join public.bureaus b on b.id = ura.bureau_id
         where ura.user_id = any(%(user_ids)s::uuid[])
           and ura.assignment_status = 'active'
           and (ura.expires_at is null or ura.expires_at > now())
         order by r.code asc
        """,
        {"user_ids": [str(user_id) for user_id in user_ids]},
    )
    grouped: dict[UUID, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(row["user_id"], []).append(row)
    return grouped


async def list_memberships_for_user(conn: AsyncConnection, user_id: UUID) -> list[dict[str, Any]]:
    return await _fetch_all(
        conn,
        """
        select bm.id,
               bm.bureau_id,
               b.code as bureau_code,
               b.name as bureau_name,
               bm.membership_type,
               bm.membership_status,
               bm.is_primary,
               bm.joined_at,
               bm.ended_at
          from public.bureau_memberships bm
          join public.bureaus b on b.id = bm.bureau_id
         where bm.user_id = %(user_id)s
         order by bm.membership_status asc, b.name asc
        """,
        {"user_id": str(user_id)},
    )


async def assign_role(
    conn: AsyncConnection,
    *,
    user_id: UUID,
    role_id: UUID,
    bureau_id: UUID | None,
    expires_at: datetime | None,
    assigned_by_user_id: UUID,
) -> dict[str, Any]:
    return await _fetch_one(
        conn,
        """
        insert into public.user_role_assignments (
            user_id, role_id, bureau_id, assignment_status, assigned_by_user_id, expires_at
        ) values (
            %(user_id)s, %(role_id)s, %(bureau_id)s, 'active',
            %(assigned_by_user_id)s, %(expires_at)s
        )
        returning id, user_id, role_id, bureau_id, assignment_status,
                  assigned_by_user_id, assigned_at, expires_at
        """,
        {
            "user_id": str(user_id),
            "role_id": str(role_id),
            "bureau_id": str(bureau_id) if bureau_id else None,
            "expires_at": expires_at,
            "assigned_by_user_id": str(assigned_by_user_id),
        },
    )


async def has_active_membership(
    conn: AsyncConnection, *, user_id: UUID, bureau_id: UUID
) -> bool:
    row = await _fetch_one(
        conn,
        """
        select 1 as ok
          from public.bureau_memberships
         where user_id = %(user_id)s
           and bureau_id = %(bureau_id)s
           and membership_status = 'active'
           and (ended_at is null or ended_at > now())
        """,
        {"user_id": str(user_id), "bureau_id": str(bureau_id)},
    )
    return row is not None


async def get_role_assignment(
    conn: AsyncConnection, assignment_id: UUID
) -> dict[str, Any] | None:
    return await _fetch_one(
        conn,
        """
        select ura.id,
               ura.user_id,
               ura.role_id,
               r.code as role_code,
               ura.bureau_id,
               ura.assignment_status
          from public.user_role_assignments ura
          join public.roles r on r.id = ura.role_id
         where ura.id = %(assignment_id)s
        """,
        {"assignment_id": str(assignment_id)},
    )


async def count_active_role_holders(conn: AsyncConnection, role_code: str) -> int:
    row = await _fetch_one(
        conn,
        """
        select count(distinct ura.user_id) as holders
          from public.user_role_assignments ura
          join public.roles r on r.id = ura.role_id
          join public.users u on u.id = ura.user_id
         where r.code = %(role_code)s
           and ura.assignment_status = 'active'
           and (ura.expires_at is null or ura.expires_at > now())
           and u.account_status = 'active'
        """,
        {"role_code": role_code},
    )
    return int(row["holders"]) if row else 0


async def has_active_role(conn: AsyncConnection, user_id: UUID, role_code: str) -> bool:
    row = await _fetch_one(
        conn,
        """
        select 1 as ok
          from public.user_role_assignments ura
          join public.roles r on r.id = ura.role_id
         where ura.user_id = %(user_id)s
           and r.code = %(role_code)s
           and ura.assignment_status = 'active'
           and (ura.expires_at is null or ura.expires_at > now())
        """,
        {"user_id": str(user_id), "role_code": role_code},
    )
    return row is not None


async def revoke_role_assignment(
    conn: AsyncConnection,
    *,
    assignment_id: UUID,
    reason: str,
) -> dict[str, Any] | None:
    # The 32-table schema has no revoked_by_user_id column on
    # user_role_assignments. Who revoked the grant is recorded by the API's
    # structured audit log, not here; see the known audit gap in
    # docs/PHASE1_IMPLEMENTATION.md.
    return await _fetch_one(
        conn,
        """
        update public.user_role_assignments
           set assignment_status = 'revoked',
               revoked_at = now(),
               revocation_reason = %(reason)s
         where id = %(assignment_id)s
           and assignment_status = 'active'
        returning id, user_id, role_id, bureau_id, assignment_status,
                  revoked_at, revocation_reason
        """,
        {
            "assignment_id": str(assignment_id),
            "reason": reason,
        },
    )

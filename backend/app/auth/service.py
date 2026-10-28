"""Resolve the application principal from the identity tables.

All queries run under the caller's RLS context, so a caller can only load what
the database policies allow (own profile, own memberships, own role grants and
the non-sensitive capability catalogue).
"""

from __future__ import annotations

from uuid import UUID

from psycopg import AsyncConnection

from app.auth.permissions import to_api_code
from app.auth.principal import BureauMembership, Principal, RoleAssignment


class IdentityError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


_USER_SQL = """
    select id,
           employee_code,
           full_name,
           display_name,
           official_email,
           designation,
           account_status
      from public.users
     where id = %s
"""

_MEMBERSHIP_SQL = """
    select bm.id            as membership_id,
           bm.bureau_id     as bureau_id,
           b.code           as bureau_code,
           b.name           as bureau_name,
           bm.membership_type,
           bm.is_primary
      from public.bureau_memberships bm
      join public.bureaus b on b.id = bm.bureau_id
     where bm.user_id = %s
       and bm.membership_status = 'active'
       and (bm.ended_at is null or bm.ended_at > now())
       and b.is_active = true
     order by bm.is_primary desc, b.name asc
"""

_ROLE_SQL = """
    select ura.id          as assignment_id,
           r.code          as role_code,
           r.name          as role_name,
           r.scope_type    as scope_type,
           ura.bureau_id   as bureau_id,
           b.name          as bureau_name,
           coalesce(
               array_agg(p.code order by p.code) filter (where p.code is not null),
               '{}'::text[]
           )               as permission_codes
      from public.user_role_assignments ura
      join public.roles r on r.id = ura.role_id
      left join public.role_permissions rp on rp.role_id = r.id
      left join public.permissions p on p.id = rp.permission_id and p.is_active = true
      left join public.bureaus b on b.id = ura.bureau_id
     where ura.user_id = %s
       and ura.assignment_status = 'active'
       and (ura.expires_at is null or ura.expires_at > now())
       and r.is_active = true
     group by ura.id, r.code, r.name, r.scope_type, ura.bureau_id, b.name
     order by r.code asc
"""


class IdentityService:
    async def load(self, conn: AsyncConnection, user_id: UUID) -> Principal:
        cursor = await conn.execute(_USER_SQL, (str(user_id),))
        user = await cursor.fetchone()
        if user is None:
            raise IdentityError(
                "ACCOUNT_NOT_PROVISIONED",
                "No AICTE OneDesk profile is linked to this sign-in. Contact an administrator.",
            )
        if user["account_status"] != "active":
            raise IdentityError(
                "ACCOUNT_INACTIVE",
                "This AICTE OneDesk account is not active.",
            )

        cursor = await conn.execute(_MEMBERSHIP_SQL, (str(user_id),))
        membership_rows = await cursor.fetchall()
        memberships = tuple(
            BureauMembership(
                membership_id=row["membership_id"],
                bureau_id=row["bureau_id"],
                bureau_code=row["bureau_code"],
                bureau_name=row["bureau_name"],
                membership_type=row["membership_type"],
                is_primary=row["is_primary"],
            )
            for row in membership_rows
        )
        member_bureau_ids = {membership.bureau_id for membership in memberships}

        cursor = await conn.execute(_ROLE_SQL, (str(user_id),))
        role_rows = await cursor.fetchall()
        roles: list[RoleAssignment] = []
        global_permissions: set[str] = set()
        bureau_permissions: dict[UUID, set[str]] = {}

        for row in role_rows:
            granted = frozenset(to_api_code(code) for code in row["permission_codes"])
            bureau_id: UUID | None = row["bureau_id"]
            if bureau_id is not None and bureau_id not in member_bureau_ids:
                # Membership was ended after the role grant: the grant no longer
                # contributes capabilities (fail closed).
                continue
            if row["scope_type"] == "global" and bureau_id is not None:
                # Invalid shape; PostgreSQL's trigger rejects it, but never
                # let a global role be narrowed into a bureau grant.
                continue
            if row["scope_type"] == "bureau" and bureau_id is None:
                # Invalid shape; ignore the assignment rather than treating it
                # as a global grant.
                continue
            roles.append(
                RoleAssignment(
                    assignment_id=row["assignment_id"],
                    role_code=row["role_code"],
                    role_name=row["role_name"],
                    scope_type=row["scope_type"],
                    bureau_id=bureau_id,
                    bureau_name=row["bureau_name"],
                    permissions=granted,
                )
            )
            if bureau_id is None:
                global_permissions |= set(granted)
            else:
                bureau_permissions.setdefault(bureau_id, set()).update(granted)

        return Principal(
            user_id=user["id"],
            full_name=user["full_name"],
            display_name=user["display_name"],
            official_email=user["official_email"],
            designation=user["designation"],
            employee_code=user["employee_code"],
            account_status=user["account_status"],
            roles=tuple(roles),
            memberships=memberships,
            global_permissions=frozenset(global_permissions),
            bureau_permissions={
                bureau: frozenset(codes) for bureau, codes in bureau_permissions.items()
            },
        )

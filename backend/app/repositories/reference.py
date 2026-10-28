"""SQL access for Phase 1 reference data (regions, institutions, aliases, bureaus)."""

from __future__ import annotations

from typing import Any, Mapping
from uuid import UUID

from psycopg import AsyncConnection


def _fetch_limit(limit: int) -> int:
    # Fetch one extra row to detect whether another page exists.
    return limit + 1


async def _fetch_all(conn: AsyncConnection, sql: str, params: Mapping[str, Any]) -> list[dict[str, Any]]:
    cursor = await conn.execute(sql, params)
    return list(await cursor.fetchall())


async def _fetch_one(conn: AsyncConnection, sql: str, params: Mapping[str, Any]) -> dict[str, Any] | None:
    cursor = await conn.execute(sql, params)
    return await cursor.fetchone()


# ---------------------------------------------------------------------------
# Regions
# ---------------------------------------------------------------------------
async def list_regions(
    conn: AsyncConnection, *, limit: int, offset: int, include_inactive: bool
) -> list[dict[str, Any]]:
    return await _fetch_all(
        conn,
        """
        select id, code, name, description, is_active, created_at, updated_at
          from public.regions
         where (%(include_inactive)s::boolean or is_active)
         order by code asc
         limit %(limit)s offset %(offset)s
        """,
        {"include_inactive": include_inactive, "limit": _fetch_limit(limit), "offset": offset},
    )


async def create_region(
    conn: AsyncConnection,
    *,
    code: str,
    name: str,
    description: str | None,
    is_active: bool,
) -> dict[str, Any]:
    return await _fetch_one(
        conn,
        """
        insert into public.regions (code, name, description, is_active)
        values (%(code)s, %(name)s, %(description)s, %(is_active)s)
        returning id, code, name, description, is_active, created_at, updated_at
        """,
        {"code": code, "name": name, "description": description, "is_active": is_active},
    )


async def update_region(
    conn: AsyncConnection, region_id: UUID, values: Mapping[str, Any]
) -> dict[str, Any] | None:
    allowed = {"code", "name", "description", "is_active"}
    assignments = [f"{column} = %({column})s" for column in values if column in allowed]
    if not assignments:
        return await get_region(conn, region_id)
    params = {key: value for key, value in values.items() if key in allowed}
    params["region_id"] = str(region_id)
    return await _fetch_one(
        conn,
        f"""
        update public.regions
           set {", ".join(assignments)}
         where id = %(region_id)s
        returning id, code, name, description, is_active, created_at, updated_at
        """,
        params,
    )


async def get_region(conn: AsyncConnection, region_id: UUID) -> dict[str, Any] | None:
    return await _fetch_one(
        conn,
        """
        select id, code, name, description, is_active, created_at, updated_at
          from public.regions
         where id = %(region_id)s
        """,
        {"region_id": str(region_id)},
    )


# ---------------------------------------------------------------------------
# Institutions
# ---------------------------------------------------------------------------
_INSTITUTION_COLUMNS = """
    id, aicte_permanent_id, official_name, normalized_name, institution_type,
    ownership_type, address_line1, address_line2, city, district, state_name,
    postal_code, region_id, contact_email, contact_phone, website_url,
    verification_status, verification_source, verification_reference,
    verified_by_user_id, verified_at, is_active, created_at, updated_at
"""


async def list_institutions(
    conn: AsyncConnection,
    *,
    limit: int,
    offset: int,
    q: str | None,
    region_id: UUID | None,
    verification_status: str | None,
    is_active: bool | None,
) -> list[dict[str, Any]]:
    return await _fetch_all(
        conn,
        """
        select i.id,
               i.aicte_permanent_id,
               i.official_name,
               i.verification_status,
               i.is_active,
               i.region_id,
               r.code as region_code,
               r.name as region_name
          from public.institutions i
          left join public.regions r on r.id = i.region_id
         where (%(q)s::text is null
                or i.official_name ilike '%%' || %(q)s || '%%'
                or i.aicte_permanent_id ilike '%%' || %(q)s || '%%')
           and (%(region_id)s::uuid is null or i.region_id = %(region_id)s::uuid)
           and (%(verification_status)s::text is null
                or i.verification_status = %(verification_status)s::text)
           and (%(is_active)s::boolean is null or i.is_active = %(is_active)s::boolean)
         order by (upper(coalesce(i.aicte_permanent_id, '')) = upper(coalesce(%(q)s, ''))) desc,
                  i.official_name asc
         limit %(limit)s offset %(offset)s
        """,
        {
            "q": q,
            "region_id": str(region_id) if region_id else None,
            "verification_status": verification_status,
            "is_active": is_active,
            "limit": _fetch_limit(limit),
            "offset": offset,
        },
    )


async def get_institution(conn: AsyncConnection, institution_id: UUID) -> dict[str, Any] | None:
    return await _fetch_one(
        conn,
        f"""
        select i.*, r.code as region_code, r.name as region_name
          from public.institutions i
          left join public.regions r on r.id = i.region_id
         where i.id = %(institution_id)s
        """,
        {"institution_id": str(institution_id)},
    )


async def region_exists(conn: AsyncConnection, region_id: UUID) -> bool:
    row = await _fetch_one(
        conn,
        "select 1 as ok from public.regions where id = %(region_id)s and is_active",
        {"region_id": str(region_id)},
    )
    return row is not None


async def create_institution(
    conn: AsyncConnection, values: Mapping[str, Any]
) -> dict[str, Any]:
    params = dict(values)
    params["normalized_name"] = values["official_name"].strip().lower()
    return await _fetch_one(
        conn,
        f"""
        insert into public.institutions (
            aicte_permanent_id, official_name, normalized_name, institution_type,
            ownership_type, address_line1, address_line2, city, district,
            state_name, postal_code, region_id, contact_email, contact_phone,
            website_url, verification_status, verification_source,
            verification_reference, verified_by_user_id, verified_at, is_active
        ) values (
            %(aicte_permanent_id)s, %(official_name)s, %(normalized_name)s, %(institution_type)s,
            %(ownership_type)s, %(address_line1)s, %(address_line2)s, %(city)s, %(district)s,
            %(state_name)s, %(postal_code)s, %(region_id)s, %(contact_email)s, %(contact_phone)s,
            %(website_url)s, %(verification_status)s, %(verification_source)s,
            %(verification_reference)s, %(verified_by_user_id)s, %(verified_at)s, %(is_active)s
        )
        returning {_INSTITUTION_COLUMNS}
        """,
        params,
    )


async def update_institution(
    conn: AsyncConnection, institution_id: UUID, values: Mapping[str, Any]
) -> dict[str, Any] | None:
    allowed = {
        "aicte_permanent_id",
        "official_name",
        "institution_type",
        "ownership_type",
        "address_line1",
        "address_line2",
        "city",
        "district",
        "state_name",
        "postal_code",
        "region_id",
        "contact_email",
        "contact_phone",
        "website_url",
        "verification_status",
        "verification_source",
        "verification_reference",
        "verified_by_user_id",
        "verified_at",
        "is_active",
    }
    params: dict[str, Any] = {
        key: value for key, value in values.items() if key in allowed
    }
    if "official_name" in params:
        params["normalized_name"] = str(params["official_name"]).strip().lower()
        allowed.add("normalized_name")
    assignments = [f"{column} = %({column})s" for column in params]
    if not assignments:
        return await get_institution(conn, institution_id)
    params["institution_id"] = str(institution_id)
    return await _fetch_one(
        conn,
        f"""
        update public.institutions
           set {", ".join(assignments)}
         where id = %(institution_id)s
        returning {_INSTITUTION_COLUMNS}
        """,
        params,
    )


# ---------------------------------------------------------------------------
# Institution aliases
# ---------------------------------------------------------------------------
_ALIAS_COLUMNS = """
    id, institution_id, alias_name, normalized_alias, language_code, alias_type,
    source_type, source_reference, verification_status, is_active, created_at, updated_at
"""


async def list_aliases(
    conn: AsyncConnection,
    *,
    limit: int,
    offset: int,
    institution_id: UUID | None,
    q: str | None,
    include_inactive: bool,
) -> list[dict[str, Any]]:
    return await _fetch_all(
        conn,
        """
        select id, institution_id, alias_name, normalized_alias, language_code,
               alias_type, source_type, source_reference, verification_status,
               is_active, created_at, updated_at
          from public.institution_aliases
         where (%(institution_id)s::uuid is null or institution_id = %(institution_id)s::uuid)
           and (%(q)s::text is null or normalized_alias like '%%' || lower(%(q)s) || '%%')
           and (%(include_inactive)s::boolean or is_active)
         order by alias_name asc
         limit %(limit)s offset %(offset)s
        """,
        {
            "institution_id": str(institution_id) if institution_id else None,
            "q": q,
            "include_inactive": include_inactive,
            "limit": _fetch_limit(limit),
            "offset": offset,
        },
    )


async def create_alias(
    conn: AsyncConnection,
    *,
    institution_id: UUID,
    alias_name: str,
    language_code: str,
    alias_type: str,
    source_type: str,
    source_reference: str | None,
) -> dict[str, Any]:
    return await _fetch_one(
        conn,
        f"""
        insert into public.institution_aliases (
            institution_id, alias_name, normalized_alias, language_code,
            alias_type, source_type, source_reference, verification_status
        ) values (
            %(institution_id)s, %(alias_name)s, %(normalized_alias)s, %(language_code)s,
            %(alias_type)s, %(source_type)s, %(source_reference)s, 'pending'
        )
        returning {_ALIAS_COLUMNS}
        """,
        {
            "institution_id": str(institution_id),
            "alias_name": alias_name,
            "normalized_alias": alias_name.strip().lower(),
            "language_code": language_code,
            "alias_type": alias_type,
            "source_type": source_type,
            "source_reference": source_reference,
        },
    )


async def institution_exists(conn: AsyncConnection, institution_id: UUID) -> bool:
    row = await _fetch_one(
        conn,
        "select 1 as ok from public.institutions where id = %(institution_id)s",
        {"institution_id": str(institution_id)},
    )
    return row is not None


# ---------------------------------------------------------------------------
# Bureaus and memberships
# ---------------------------------------------------------------------------
_BUREAU_COLUMNS = """
    id, code, name, description, parent_bureau_id, bureau_type, is_active,
    display_order, created_at, updated_at
"""


async def list_bureaus(
    conn: AsyncConnection, *, limit: int, offset: int, include_inactive: bool
) -> list[dict[str, Any]]:
    return await _fetch_all(
        conn,
        f"""
        select {_BUREAU_COLUMNS}
          from public.bureaus
         where (%(include_inactive)s::boolean or is_active)
         order by display_order asc, name asc
         limit %(limit)s offset %(offset)s
        """,
        {"include_inactive": include_inactive, "limit": _fetch_limit(limit), "offset": offset},
    )


async def get_bureau(conn: AsyncConnection, bureau_id: UUID) -> dict[str, Any] | None:
    return await _fetch_one(
        conn,
        f"select {_BUREAU_COLUMNS} from public.bureaus where id = %(bureau_id)s",
        {"bureau_id": str(bureau_id)},
    )


async def create_bureau(
    conn: AsyncConnection,
    *,
    code: str,
    name: str,
    description: str | None,
    parent_bureau_id: UUID | None,
    bureau_type: str,
    display_order: int,
    is_active: bool,
) -> dict[str, Any]:
    return await _fetch_one(
        conn,
        f"""
        insert into public.bureaus (
            code, name, description, parent_bureau_id, bureau_type, display_order, is_active
        ) values (
            %(code)s, %(name)s, %(description)s, %(parent_bureau_id)s, %(bureau_type)s,
            %(display_order)s, %(is_active)s
        )
        returning {_BUREAU_COLUMNS}
        """,
        {
            "code": code,
            "name": name,
            "description": description,
            "parent_bureau_id": str(parent_bureau_id) if parent_bureau_id else None,
            "bureau_type": bureau_type,
            "display_order": display_order,
            "is_active": is_active,
        },
    )


async def update_bureau(
    conn: AsyncConnection, bureau_id: UUID, values: Mapping[str, Any]
) -> dict[str, Any] | None:
    allowed = {
        "code",
        "name",
        "description",
        "parent_bureau_id",
        "bureau_type",
        "display_order",
        "is_active",
    }
    params: dict[str, Any] = {key: value for key, value in values.items() if key in allowed}
    if not params:
        return await get_bureau(conn, bureau_id)
    if isinstance(params.get("parent_bureau_id"), UUID):
        params["parent_bureau_id"] = str(params["parent_bureau_id"])
    assignments = [f"{column} = %({column})s" for column in params]
    params["bureau_id"] = str(bureau_id)
    return await _fetch_one(
        conn,
        f"""
        update public.bureaus
           set {", ".join(assignments)}
         where id = %(bureau_id)s
        returning {_BUREAU_COLUMNS}
        """,
        params,
    )


async def list_bureau_members(
    conn: AsyncConnection,
    *,
    bureau_id: UUID,
    limit: int,
    offset: int,
    include_inactive: bool,
) -> list[dict[str, Any]]:
    return await _fetch_all(
        conn,
        """
        select bm.id as membership_id,
               bm.user_id,
               bm.bureau_id,
               bm.membership_type,
               bm.membership_status,
               bm.is_primary,
               bm.joined_at,
               bm.ended_at,
               u.full_name,
               u.official_email,
               u.designation
          from public.bureau_memberships bm
          join public.users u on u.id = bm.user_id
         where bm.bureau_id = %(bureau_id)s
           and (%(include_inactive)s::boolean or bm.membership_status = 'active')
         order by bm.is_primary desc, u.full_name asc
         limit %(limit)s offset %(offset)s
        """,
        {
            "bureau_id": str(bureau_id),
            "include_inactive": include_inactive,
            "limit": _fetch_limit(limit),
            "offset": offset,
        },
    )


async def get_membership(conn: AsyncConnection, membership_id: UUID) -> dict[str, Any] | None:
    return await _fetch_one(
        conn,
        """
        select id, user_id, bureau_id, membership_type, membership_status,
               is_primary, joined_at, ended_at
          from public.bureau_memberships
         where id = %(membership_id)s
        """,
        {"membership_id": str(membership_id)},
    )


async def add_membership(
    conn: AsyncConnection,
    *,
    user_id: UUID,
    bureau_id: UUID,
    membership_type: str,
    is_primary: bool,
) -> dict[str, Any]:
    if is_primary:
        await conn.execute(
            """
            update public.bureau_memberships
               set is_primary = false
             where user_id = %(user_id)s
               and membership_status = 'active'
               and is_primary
            """,
            {"user_id": str(user_id)},
        )
    return await _fetch_one(
        conn,
        """
        insert into public.bureau_memberships (
            user_id, bureau_id, membership_type, membership_status, is_primary
        ) values (
            %(user_id)s, %(bureau_id)s, %(membership_type)s, 'active', %(is_primary)s
        )
        returning id, user_id, bureau_id, membership_type, membership_status,
                  is_primary, joined_at, ended_at
        """,
        {
            "user_id": str(user_id),
            "bureau_id": str(bureau_id),
            "membership_type": membership_type,
            "is_primary": is_primary,
        },
    )


async def end_membership(
    conn: AsyncConnection, membership_id: UUID
) -> dict[str, Any] | None:
    return await _fetch_one(
        conn,
        """
        update public.bureau_memberships
           set membership_status = 'inactive',
               ended_at = now(),
               is_primary = false
         where id = %(membership_id)s
           and membership_status = 'active'
        returning id, user_id, bureau_id, membership_type, membership_status,
                  is_primary, joined_at, ended_at
        """,
        {"membership_id": str(membership_id)},
    )

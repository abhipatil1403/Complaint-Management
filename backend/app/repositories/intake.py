"""SQL access for Phase 2.1 simulated intake.

Every write goes through ``public.create_demo_submission``. The connection is
already scoped to the ``one_desk_intake`` role, which holds no table privilege,
so there is no direct INSERT/UPDATE/DELETE path from this module.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg import AsyncConnection

_CREATE_SQL = """
    select public.create_demo_submission(
        %(channel_code)s,
        %(institution_permanent_id)s,
        %(institution_name_as_submitted)s,
        %(subject)s,
        %(description)s,
        %(language)s,
        %(category_code)s,
        %(source_event_id)s,
        %(idempotency_key)s,
        %(source_submitted_at)s,
        %(consent_acknowledged)s
    ) as result
"""

_LIST_SQL = """
    select s.id,
           s.external_reference,
           s.source_event_id,
           s.received_at,
           s.intake_status,
           s.subject,
           s.original_language,
           s.institution_id,
           s.institution_name_as_submitted,
           s.canonical_case_id,
           s.source_metadata,
           c.code            as channel_code,
           c.name            as channel_name,
           c.is_simulated    as channel_is_simulated,
           i.aicte_permanent_id,
           i.official_name
      from public.submissions s
      join public.intake_channels c on c.id = s.intake_channel_id
      left join public.institutions i on i.id = s.institution_id
     where (%(channel_code)s::text is null or c.code = %(channel_code)s::text)
       and (%(intake_status)s::text is null or s.intake_status = %(intake_status)s::text)
       and (%(language)s::text is null or s.original_language = %(language)s::text)
       and (
             %(q)s::text is null
             or s.subject ilike %(q_like)s::text
             or s.external_reference ilike %(q_like)s::text
           )
     order by s.received_at desc, s.id
     limit %(limit)s offset %(offset)s
"""

_GET_SQL = """
    select s.id,
           s.external_reference,
           s.source_event_id,
           s.received_at,
           s.intake_status,
           s.subject,
           s.original_text,
           s.original_language,
           s.normalized_text,
           s.normalization_version,
           s.institution_id,
           s.institution_name_as_submitted,
           s.canonical_case_id,
           s.content_fingerprint,
           s.source_metadata,
           s.created_at,
           c.code            as channel_code,
           c.name            as channel_name,
           c.is_simulated    as channel_is_simulated,
           i.aicte_permanent_id,
           i.official_name
      from public.submissions s
      join public.intake_channels c on c.id = s.intake_channel_id
      left join public.institutions i on i.id = s.institution_id
     where s.id = %(submission_id)s
"""


async def create_submission(
    conn: AsyncConnection,
    *,
    channel_code: str,
    institution_permanent_id: str | None,
    institution_name_as_submitted: str | None,
    subject: str,
    description: str,
    language: str,
    category_code: str | None,
    source_event_id: str | None,
    idempotency_key: str | None,
    source_submitted_at: datetime | None,
) -> dict[str, Any]:
    cursor = await conn.execute(
        _CREATE_SQL,
        {
            "channel_code": channel_code,
            "institution_permanent_id": institution_permanent_id,
            "institution_name_as_submitted": institution_name_as_submitted,
            "subject": subject,
            "description": description,
            "language": language,
            "category_code": category_code,
            "source_event_id": source_event_id,
            "idempotency_key": idempotency_key,
            "source_submitted_at": source_submitted_at,
            "consent_acknowledged": True,
        },
    )
    row = await cursor.fetchone()
    return row["result"]


async def list_submissions(
    conn: AsyncConnection,
    *,
    limit: int,
    offset: int,
    channel_code: str | None,
    intake_status: str | None,
    language: str | None,
    q: str | None,
) -> list[dict[str, Any]]:
    cursor = await conn.execute(
        _LIST_SQL,
        {
            "channel_code": channel_code,
            "intake_status": intake_status,
            "language": language,
            "q": q,
            "q_like": f"%{q}%" if q else None,
            "limit": limit + 1,  # fetch one extra row to detect the next page
            "offset": offset,
        },
    )
    return list(await cursor.fetchall())


async def get_submission(conn: AsyncConnection, submission_id: UUID) -> dict[str, Any] | None:
    cursor = await conn.execute(_GET_SQL, {"submission_id": submission_id})
    return await cursor.fetchone()

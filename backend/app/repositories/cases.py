"""SQL access for Phase 2.3 canonical cases and index projections.

Provides cross-bureau minimal case index discovery and authorized full detail access.
Authorized detail access is strictly gated via PostgreSQL can_access_case_details()
which checks global CASE.VIEW_DETAIL or active bureau membership / unrevoked grant.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg import AsyncConnection

from app.core.errors import ApiError

_INDEX_SQL = """
    SELECT *
      FROM public.case_index_rows(
          p_status := %(status)s,
          p_search := %(search)s,
          p_limit := %(limit)s,
          p_offset := %(offset)s
      );
"""

_DETAIL_SQL = """
    SELECT *
      FROM public.case_detail_projection(%(case_id)s);
"""

_CREATE_CASE_SQL = """
    SELECT public.create_canonical_case(
        %(submission_id)s,
        %(lead_bureau_id)s,
        %(title)s,
        %(description)s,
        %(priority)s,
        %(visibility)s,
        %(expected_submission_updated_at)s
    ) AS case_id;
"""

_DOMAIN_ERRORS: dict[str, tuple[int, str, str]] = {
    "42501": (403, "FORBIDDEN", "The required case management or detail viewing capability is not held."),
    "P2D01": (409, "STALE_WRITE", "This submission was modified by another reviewer. Reload and try again."),
    "P2D02": (404, "NOT_FOUND", "The requested submission, bureau, or related case was not found."),
    "P2D03": (409, "VERIFICATION_HOLD", "Active institution verification or correction round is in progress."),
    "P2D04": (409, "INSTITUTION_INELIGIBLE", "The associated institution is not verified and active."),
    "P2D05": (422, "VALIDATION_ERROR", "The supplied priority or visibility classification is invalid."),
    "P2D06": (409, "ALREADY_RESOLVED", "The submission is already associated with a case or rejected."),
    "P2D07": (422, "FIELD_REQUIRED", "Case title and description cannot be blank."),
    "P2D08": (409, "INELIGIBLE_LEAD_BUREAU", "Lead bureau is invalid, caller lacks active membership, or related case is incompatible/closed."),
    "P2D10": (409, "UNREVIEWED_CANDIDATES", "Unreviewed duplicate candidates remain for this submission."),
    "P2D11": (409, "SCREENING_INCOMPLETE", "Duplicate screening must be completed before canonical case creation."),
    "P2D12": (422, "CONCURRENCY_TOKEN_REQUIRED", "An optimistic concurrency token is required."),
}


def _translate(exc: psycopg.Error) -> ApiError:
    code = exc.sqlstate or ""
    status_code, api_code, message = _DOMAIN_ERRORS.get(
        code, (500, "DATABASE_ERROR", "The case request could not be completed.")
    )
    return ApiError(status_code, api_code, message)


async def list_cases(
    conn: AsyncConnection,
    *,
    status: str | None = None,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    try:
        async with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            await cur.execute(
                _INDEX_SQL,
                {"status": status, "search": search, "limit": limit, "offset": offset},
            )
            return await cur.fetchall()
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def get_case_detail(
    conn: AsyncConnection,
    case_id: UUID,
) -> dict[str, Any] | None:
    try:
        async with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            await cur.execute(_DETAIL_SQL, {"case_id": case_id})
            return await cur.fetchone()
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def create_case(
    conn: AsyncConnection,
    *,
    submission_id: UUID,
    lead_bureau_id: UUID,
    title: str,
    description: str,
    priority: str,
    visibility: str,
    expected_submission_updated_at: datetime,
) -> UUID:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                _CREATE_CASE_SQL,
                {
                    "submission_id": submission_id,
                    "lead_bureau_id": lead_bureau_id,
                    "title": title,
                    "description": description,
                    "priority": priority,
                    "visibility": visibility,
                    "expected_submission_updated_at": expected_submission_updated_at,
                },
            )
            row = await cur.fetchone()
            if not row or not row[0]:
                raise ApiError(500, "CREATION_FAILED", "Failed to create canonical case")
            return row[0]
    except psycopg.Error as exc:
        raise _translate(exc) from exc

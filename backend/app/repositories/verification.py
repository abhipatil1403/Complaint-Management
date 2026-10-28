"""SQL access for Phase 2.2 institution verification.

``authenticated`` holds no privilege on ``institution_verification_tasks``.
Every read and write therefore goes through a capability-gated SECURITY DEFINER
function. PostgreSQL re-checks ``INSTITUTION.VERIFY`` on every call, so the API
dependency is a fast fail, not the enforcement point.

SQLSTATE codes raised by the migration are translated here into the uniform API
error envelope. Messages are fixed by this module so the API never echoes
database internals.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg import AsyncConnection

from app.core.errors import ApiError

_TASK_ROWS_SQL = """
    select *
      from public.institution_verification_task_rows(
          %(task_id)s, %(status)s, %(assignment)s, %(priority)s,
          %(query)s, %(sort)s, %(limit)s, %(offset)s)
"""

_CANDIDATES_SQL = """
    select *
      from public.institution_match_candidates(%(submission_id)s)
"""

_METADATA_SQL = """
    select *
      from public.institution_verification_submission_metadata(%(submission_id)s)
"""

_DECIDE_SQL = """
    select public.decide_institution_verification(
        %(task_id)s,
        %(action)s,
        %(institution_id)s,
        %(reason)s,
        %(expected_updated_at)s
    )
"""

_REQUEST_ROUND_SQL = """
    select public.request_institution_verification_round(
        %(submission_id)s,
        %(reason)s,
        %(expected_submission_updated_at)s
    ) as task_id
"""

# code -> (HTTP status, stable API code, message)
_DOMAIN_ERRORS: dict[str, tuple[int, str, str]] = {
    "42501": (
        403,
        "FORBIDDEN",
        "The 'institution.verify' capability is required for this operation.",
    ),
    "P2V01": (
        409,
        "STALE_WRITE",
        "This record changed since you loaded it. Reload and try again.",
    ),
    "P2V02": (404, "NOT_FOUND", "The verification record was not found."),
    "P2V03": (422, "VALIDATION_ERROR", "The verification action is not recognised."),
    "P2V04": (
        409,
        "IMMUTABLE_RECORD",
        "This verification record can no longer be changed.",
    ),
    "P2V05": (
        409,
        "INVARIANT_VIOLATION",
        "The verification record is inconsistent and was not changed.",
    ),
    "P2V06": (
        409,
        "CASE_LOCKED",
        "The submission is already associated with a canonical case.",
    ),
    "P2V07": (422, "REASON_REQUIRED", "A reason is required for this action."),
    "P2V08": (
        422,
        "INVALID_COMBINATION",
        "The supplied fields are not valid for this action.",
    ),
    "P2V09": (
        409,
        "INSTITUTION_NOT_ELIGIBLE",
        "The selected institution must be verified and active.",
    ),
    "P2V10": (
        409,
        "CASE_BLOCKED",
        "A canonical case cannot be created while institution verification is open.",
    ),
    "P2V11": (
        409,
        "ACTIVE_ROUND_EXISTS",
        "An active verification round already exists for this submission.",
    ),
    "P2V12": (422, "INVALID_FILTER", "One or more queue filters are not recognised."),
    "P2V13": (
        409,
        "IMMUTABLE_RECORD",
        "Submission origin and provenance fields are immutable.",
    ),
    "P2V14": (
        403,
        "INDEPENDENT_REVIEW_REQUIRED",
        "The reviewer who requested this correction cannot confirm it.",
    ),
    "23505": (
        409,
        "CONFLICT",
        "An active verification round already exists for this submission.",
    ),
}


def _translate(exc: psycopg.Error) -> ApiError:
    code = exc.sqlstate or ""
    status_code, api_code, message = _DOMAIN_ERRORS.get(
        code, (500, "DATABASE_ERROR", "The request could not be completed.")
    )
    return ApiError(status_code, api_code, message)


async def list_tasks(
    conn: AsyncConnection,
    *,
    status: str,
    assignment: str,
    priority: str | None,
    query: str | None,
    sort: str,
    limit: int,
    offset: int,
) -> list[dict[str, Any]]:
    try:
        cursor = await conn.execute(
            _TASK_ROWS_SQL,
            {
                "task_id": None,
                "status": status,
                "assignment": assignment,
                "priority": priority,
                "query": query,
                "sort": sort,
                "limit": limit,
                "offset": offset,
            },
        )
        return list(await cursor.fetchall())
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def get_task(
    conn: AsyncConnection, task_id: UUID
) -> dict[str, Any] | None:
    try:
        cursor = await conn.execute(
            _TASK_ROWS_SQL,
            {
                "task_id": task_id,
                "status": "open",
                "assignment": "all",
                "priority": None,
                "query": None,
                "sort": "oldest",
                "limit": 1,
                "offset": 0,
            },
        )
        return await cursor.fetchone()
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def list_candidates(
    conn: AsyncConnection, submission_id: UUID
) -> list[dict[str, Any]]:
    try:
        cursor = await conn.execute(_CANDIDATES_SQL, {"submission_id": submission_id})
        return list(await cursor.fetchall())
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def submission_metadata(
    conn: AsyncConnection, submission_id: UUID
) -> dict[str, Any] | None:
    try:
        cursor = await conn.execute(_METADATA_SQL, {"submission_id": submission_id})
        return await cursor.fetchone()
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def decide(
    conn: AsyncConnection,
    *,
    task_id: UUID,
    action: str,
    institution_id: UUID | None,
    reason: str | None,
    expected_updated_at: datetime | None,
) -> None:
    try:
        await conn.execute(
            _DECIDE_SQL,
            {
                "task_id": task_id,
                "action": action,
                "institution_id": institution_id,
                "reason": reason,
                "expected_updated_at": expected_updated_at,
            },
        )
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def request_round(
    conn: AsyncConnection,
    *,
    submission_id: UUID,
    reason: str,
    expected_submission_updated_at: datetime | None,
) -> UUID:
    try:
        cursor = await conn.execute(
            _REQUEST_ROUND_SQL,
            {
                "submission_id": submission_id,
                "reason": reason,
                "expected_submission_updated_at": expected_submission_updated_at,
            },
        )
        row = await cursor.fetchone()
    except psycopg.Error as exc:
        raise _translate(exc) from exc
    if row is None:
        raise ApiError(404, "NOT_FOUND", "The verification record was not found.")
    return row["task_id"]

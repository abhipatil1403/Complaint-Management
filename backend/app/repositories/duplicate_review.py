"""SQL access for Phase 2.3 duplicate review and decisions.

Access to duplicate candidate pairs and decisions requires the global DUPLICATE.REVIEW
capability. All reads and writes call SECURITY DEFINER stored procedures that enforce
permissions, active accounts, lock ordering, optimistic concurrency, and immutability.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg import AsyncConnection

from app.core.errors import ApiError

_QUEUE_SQL = """
    SELECT *
      FROM public.duplicate_review_queue_rows(
          p_status := %(status)s,
          p_limit := %(limit)s,
          p_offset := %(offset)s
      );
"""

_DETAIL_SQL = """
    SELECT *
      FROM public.duplicate_candidate_detail(%(candidate_id)s);
"""

_SCREEN_SQL = """
    SELECT public.generate_duplicate_candidates(
        %(submission_id)s,
        %(expected_submission_updated_at)s
    ) AS inserted_count;
"""

_DECIDE_SQL = """
    SELECT public.decide_duplicate_candidate(
        %(candidate_id)s,
        %(action)s,
        %(notes)s,
        %(expected_submission_updated_at)s,
        %(expected_candidate_updated_at)s
    );
"""

_REJECT_SUBMISSION_SQL = """
    SELECT public.reject_intake_submission(
        %(submission_id)s,
        %(reason)s,
        %(expected_submission_updated_at)s
    );
"""

_DOMAIN_ERRORS: dict[str, tuple[int, str, str]] = {
    "42501": (403, "FORBIDDEN", "The global DUPLICATE.REVIEW or SUBMISSION.REJECT capability is required."),
    "P2D01": (409, "STALE_WRITE", "This record was modified by another reviewer. Reload and try again."),
    "P2D02": (404, "NOT_FOUND", "The requested submission or candidate pair was not found."),
    "P2D03": (409, "VERIFICATION_HOLD", "Active institution verification or correction round is in progress."),
    "P2D04": (409, "IMMUTABLE_RECORD", "A decided duplicate candidate is immutable and cannot be altered."),
    "P2D05": (422, "VALIDATION_ERROR", "The supplied decision action or parameter is invalid."),
    "P2D06": (409, "ALREADY_RESOLVED", "The submission is already associated with a case or rejected."),
    "P2D07": (422, "REASON_REQUIRED", "A justification reason is required for this decision."),
    "P2D08": (409, "INELIGIBLE_ASSOCIATION", "Target candidate case does not match submission verified institution or is closed."),
    "P2D10": (409, "UNREVIEWED_CANDIDATES", "Unreviewed duplicate candidates remain for this submission."),
    "P2D11": (409, "SCREENING_INCOMPLETE", "Duplicate screening must be completed before canonical case creation."),
    "P2D12": (422, "CONCURRENCY_TOKEN_REQUIRED", "An optimistic concurrency token is required."),
}


def _translate(exc: psycopg.Error) -> ApiError:
    code = exc.sqlstate or ""
    status_code, api_code, message = _DOMAIN_ERRORS.get(
        code, (500, "DATABASE_ERROR", "The duplicate review request could not be completed.")
    )
    return ApiError(status_code, api_code, message)


async def list_queue(
    conn: AsyncConnection,
    *,
    status: str | None = "pending",
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    try:
        async with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            await cur.execute(
                _QUEUE_SQL,
                {"status": status, "limit": limit, "offset": offset},
            )
            return await cur.fetchall()
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def get_candidate_detail(
    conn: AsyncConnection,
    candidate_id: UUID,
) -> dict[str, Any] | None:
    try:
        async with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            await cur.execute(_DETAIL_SQL, {"candidate_id": candidate_id})
            return await cur.fetchone()
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def screen_submission(
    conn: AsyncConnection,
    *,
    submission_id: UUID,
    expected_submission_updated_at: datetime,
) -> int:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                _SCREEN_SQL,
                {
                    "submission_id": submission_id,
                    "expected_submission_updated_at": expected_submission_updated_at,
                },
            )
            row = await cur.fetchone()
            return row[0] if row else 0
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def decide_candidate(
    conn: AsyncConnection,
    *,
    candidate_id: UUID,
    action: str,
    notes: str,
    expected_submission_updated_at: datetime,
    expected_candidate_updated_at: datetime,
) -> None:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                _DECIDE_SQL,
                {
                    "candidate_id": candidate_id,
                    "action": action,
                    "notes": notes,
                    "expected_submission_updated_at": expected_submission_updated_at,
                    "expected_candidate_updated_at": expected_candidate_updated_at,
                },
            )
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def reject_submission(
    conn: AsyncConnection,
    *,
    submission_id: UUID,
    reason: str,
    expected_submission_updated_at: datetime,
) -> None:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                _REJECT_SUBMISSION_SQL,
                {
                    "submission_id": submission_id,
                    "reason": reason,
                    "expected_submission_updated_at": expected_submission_updated_at,
                },
            )
    except psycopg.Error as exc:
        raise _translate(exc) from exc

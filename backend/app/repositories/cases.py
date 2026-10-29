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
    "P3S01": (409, "STALE_WRITE", "Case was modified by another user. Reload and try again."),
    "P3S02": (422, "FIELD_REQUIRED", "A non-blank reason is required for status transitions."),
    "P3S03": (409, "SAME_STATUS", "Case is already in the requested status."),
    "P3S04": (422, "INVALID_TRANSITION", "The requested status transition is not permitted by policy."),
    "P3A01": (422, "INVALID_ASSIGNMENT_TYPE", "Invalid bureau assignment type. Must be lead or collaborating."),
    "P3A02": (422, "INVALID_ASSIGNMENT_STATUS", "Invalid bureau assignment status."),
    "P3O01": (409, "OFFICER_NOT_MEMBER", "Officer does not have active membership in the target bureau."),
    "P3O02": (422, "INVALID_OFFICER_ROLE", "Invalid officer role."),
    "P3O03": (422, "INVALID_OFFICER_STATUS", "Invalid officer assignment status."),
    "P3N01": (422, "FIELD_REQUIRED", "Note text cannot be blank."),
    "P3N02": (422, "INVALID_VISIBILITY", "Invalid note visibility."),
    "P3N03": (422, "INVALID_NOTE_TYPE", "Invalid note type."),
    "P3N04": (422, "FIELD_REQUIRED", "Bureau ID is required for bureau-private notes."),
    "P3D01": (422, "FIELD_REQUIRED", "Original filename cannot be blank."),
    "P3D02": (422, "INVALID_FILE_SIZE", "File size must be greater than zero."),
    "P3D03": (422, "INVALID_ATTACHMENT_TYPE", "Invalid attachment type."),
    "P3T01": (422, "FIELD_REQUIRED", "Transfer reason cannot be blank."),
    "P3T02": (422, "INVALID_TRANSFER_TYPE", "Invalid transfer type."),
    "P3T03": (409, "SAME_BUREAU_TRANSFER", "Cannot transfer to the same bureau."),
    "P3T04": (409, "ALREADY_RESOLVED", "Transfer request is already resolved."),
    "P3T05": (422, "INVALID_DECISION", "Invalid transfer decision."),
    "P3R01": (422, "FIELD_REQUIRED", "Request reason cannot be blank."),
    "P3R02": (422, "INVALID_ACCESS_LEVEL", "Invalid access level."),
    "P3R03": (409, "ALREADY_RESOLVED", "Access request is already resolved."),
    "P3R04": (422, "INVALID_DECISION", "Decision must be approved or rejected."),
    "P3R05": (422, "FIELD_REQUIRED", "Rejection reason is required."),
    "P3R06": (409, "ALREADY_REVOKED", "Access grant is already revoked."),
    "P3R07": (422, "FIELD_REQUIRED", "Revocation reason cannot be blank."),
}


def _translate(exc: psycopg.Error) -> ApiError:
    code = exc.sqlstate or ""
    status_code, api_code, message = _DOMAIN_ERRORS.get(
        code, (500, "DATABASE_ERROR", "The case request could not be completed.")
    )
    return ApiError(status_code, api_code, message)


def _first_val(row: Any) -> Any:
    if not row:
        return None
    if isinstance(row, dict):
        return next(iter(row.values()))
    return row[0]


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
            val = _first_val(row)
            if not val:
                raise ApiError(500, "CREATION_FAILED", "Failed to create canonical case")
            return val
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def transition_case_status(
    conn: AsyncConnection,
    *,
    case_id: UUID,
    to_status: str,
    reason: str,
    expected_updated_at: datetime | None,
) -> dict[str, Any]:
    try:
        async with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            await cur.execute(
                "SELECT public.transition_case_status(%(case_id)s, %(to_status)s, %(reason)s, %(expected_updated_at)s) AS res;",
                {
                    "case_id": case_id,
                    "to_status": to_status,
                    "reason": reason,
                    "expected_updated_at": expected_updated_at,
                },
            )
            row = await cur.fetchone()
            return row["res"] if row else {}
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def assign_case_bureau(
    conn: AsyncConnection,
    *,
    case_id: UUID,
    bureau_id: UUID,
    assignment_type: str,
    reason: str | None,
) -> UUID:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT public.assign_case_bureau(%(case_id)s, %(bureau_id)s, %(assignment_type)s, %(reason)s);",
                {
                    "case_id": case_id,
                    "bureau_id": bureau_id,
                    "assignment_type": assignment_type,
                    "reason": reason,
                },
            )
            row = await cur.fetchone()
            return _first_val(row)
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def update_case_bureau_assignment(
    conn: AsyncConnection,
    *,
    assignment_id: UUID,
    status: str,
    completion_notes: str | None,
) -> bool:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT public.update_case_bureau_assignment(%(assignment_id)s, %(status)s, %(completion_notes)s);",
                {
                    "assignment_id": assignment_id,
                    "status": status,
                    "completion_notes": completion_notes,
                },
            )
            row = await cur.fetchone()
            val = _first_val(row)
            return bool(val) if val is not None else False
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def assign_case_officer(
    conn: AsyncConnection,
    *,
    case_bureau_assignment_id: UUID,
    officer_user_id: UUID,
    role: str,
    notes: str | None,
) -> UUID:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT public.assign_case_officer(%(case_bureau_assignment_id)s, %(officer_user_id)s, %(role)s, %(notes)s);",
                {
                    "case_bureau_assignment_id": case_bureau_assignment_id,
                    "officer_user_id": officer_user_id,
                    "role": role,
                    "notes": notes,
                },
            )
            row = await cur.fetchone()
            return _first_val(row)
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def update_case_officer_assignment(
    conn: AsyncConnection,
    *,
    assignment_id: UUID,
    status: str,
    notes: str | None,
) -> bool:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT public.update_case_officer_assignment(%(assignment_id)s, %(status)s, %(notes)s);",
                {
                    "assignment_id": assignment_id,
                    "status": status,
                    "notes": notes,
                },
            )
            row = await cur.fetchone()
            val = _first_val(row)
            return bool(val) if val is not None else False
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def create_case_note(
    conn: AsyncConnection,
    *,
    case_id: UUID,
    note_text: str,
    visibility: str,
    note_type: str,
    bureau_id: UUID | None,
    is_pinned: bool,
) -> UUID:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT public.create_case_note(%(case_id)s, %(note_text)s, %(visibility)s, %(note_type)s, %(bureau_id)s, %(is_pinned)s);",
                {
                    "case_id": case_id,
                    "note_text": note_text,
                    "visibility": visibility,
                    "note_type": note_type,
                    "bureau_id": bureau_id,
                    "is_pinned": is_pinned,
                },
            )
            row = await cur.fetchone()
            return _first_val(row)
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def update_case_note(
    conn: AsyncConnection,
    *,
    note_id: UUID,
    note_text: str,
    is_pinned: bool,
) -> bool:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT public.update_case_note(%(note_id)s, %(note_text)s, %(is_pinned)s);",
                {
                    "note_id": note_id,
                    "note_text": note_text,
                    "is_pinned": is_pinned,
                },
            )
            row = await cur.fetchone()
            val = _first_val(row)
            return bool(val) if val is not None else False
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def soft_delete_case_note(
    conn: AsyncConnection,
    *,
    note_id: UUID,
) -> bool:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT public.soft_delete_case_note(%(note_id)s);",
                {"note_id": note_id},
            )
            row = await cur.fetchone()
            val = _first_val(row)
            return bool(val) if val is not None else False
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def list_case_notes(
    conn: AsyncConnection,
    case_id: UUID,
) -> list[dict[str, Any]]:
    try:
        async with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            await cur.execute(
                "SELECT * FROM public.case_notes_projection(%(case_id)s);",
                {"case_id": case_id},
            )
            return await cur.fetchall()
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def register_case_attachment(
    conn: AsyncConnection,
    *,
    case_id: UUID,
    original_filename: str,
    storage_bucket: str,
    storage_path: str,
    mime_type: str,
    file_size_bytes: int,
    sha256_checksum: str | None,
    attachment_type: str,
    description: str | None,
) -> UUID:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT public.register_case_attachment(
                    %(case_id)s,
                    %(original_filename)s,
                    %(storage_bucket)s,
                    %(storage_path)s,
                    %(mime_type)s,
                    %(file_size_bytes)s,
                    %(sha256_checksum)s,
                    %(attachment_type)s,
                    %(description)s
                );
                """,
                {
                    "case_id": case_id,
                    "original_filename": original_filename,
                    "storage_bucket": storage_bucket,
                    "storage_path": storage_path,
                    "mime_type": mime_type,
                    "file_size_bytes": file_size_bytes,
                    "sha256_checksum": sha256_checksum,
                    "attachment_type": attachment_type,
                    "description": description,
                },
            )
            row = await cur.fetchone()
            return _first_val(row)
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def list_case_attachments(
    conn: AsyncConnection,
    case_id: UUID,
) -> list[dict[str, Any]]:
    try:
        async with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            await cur.execute(
                "SELECT * FROM public.case_attachments_projection(%(case_id)s);",
                {"case_id": case_id},
            )
            return await cur.fetchall()
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def quarantine_case_attachment(
    conn: AsyncConnection,
    *,
    attachment_id: UUID,
    reason: str,
) -> bool:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT public.quarantine_case_attachment(%(attachment_id)s, %(reason)s);",
                {"attachment_id": attachment_id, "reason": reason},
            )
            row = await cur.fetchone()
            val = _first_val(row)
            return bool(val) if val is not None else False
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def get_case_attachment_for_download(
    conn: AsyncConnection,
    *,
    case_id: UUID,
    attachment_id: UUID,
) -> dict[str, Any]:
    try:
        async with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            # Validate caller can access case details first
            await cur.execute("SELECT public.can_access_case_details(%(case_id)s);", {"case_id": case_id})
            access_row = await cur.fetchone()
            access_val = _first_val(access_row)
            if not access_val:
                raise ApiError(
                    status_code=403,
                    code="FORBIDDEN",
                    message="Caller is not authorized to download attachments from this case.",
                )

            # Query attachment via projection function (SECURITY DEFINER with case access checks)
            await cur.execute(
                """
                SELECT attachment_id AS id, case_id, original_filename, storage_bucket, storage_path,
                       mime_type, file_size_bytes, sha256_checksum, upload_status
                  FROM public.case_attachments_projection(%(case_id)s)
                 WHERE attachment_id = %(attachment_id)s;
                """,
                {"attachment_id": attachment_id, "case_id": case_id},
            )
            row = await cur.fetchone()
            if not row:
                raise ApiError(status_code=404, code="NOT_FOUND", message="Attachment not found.")

            if row["upload_status"] == "quarantined":
                raise ApiError(
                    status_code=403,
                    code="QUARANTINED_FILE",
                    message="Attachment has been quarantined for security and cannot be downloaded.",
                )

            return dict(row)
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def request_case_transfer(
    conn: AsyncConnection,
    *,
    case_id: UUID,
    from_bureau_assignment_id: UUID,
    to_bureau_id: UUID,
    transfer_type: str,
    reason: str,
) -> UUID:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT public.request_case_transfer(%(case_id)s, %(from_bureau_assignment_id)s, %(to_bureau_id)s, %(transfer_type)s, %(reason)s);",
                {
                    "case_id": case_id,
                    "from_bureau_assignment_id": from_bureau_assignment_id,
                    "to_bureau_id": to_bureau_id,
                    "transfer_type": transfer_type,
                    "reason": reason,
                },
            )
            row = await cur.fetchone()
            return _first_val(row)
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def decide_case_transfer(
    conn: AsyncConnection,
    *,
    transfer_id: UUID,
    decision: str,
    decision_notes: str | None,
) -> bool:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT public.decide_case_transfer(%(transfer_id)s, %(decision)s, %(decision_notes)s);",
                {
                    "transfer_id": transfer_id,
                    "decision": decision,
                    "decision_notes": decision_notes,
                },
            )
            row = await cur.fetchone()
            val = _first_val(row)
            return bool(val) if val is not None else False
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def request_case_access(
    conn: AsyncConnection,
    *,
    case_id: UUID,
    access_level: str,
    reason: str,
    requesting_bureau_id: UUID | None = None,
) -> UUID:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT public.request_case_access(%(case_id)s, %(access_level)s, %(reason)s, %(requesting_bureau_id)s);",
                {
                    "case_id": case_id,
                    "access_level": access_level,
                    "reason": reason,
                    "requesting_bureau_id": requesting_bureau_id,
                },
            )
            row = await cur.fetchone()
            return _first_val(row)
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def list_case_access_requests(
    conn: AsyncConnection,
    *,
    status: str | None = "pending",
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    try:
        async with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            await cur.execute(
                "SELECT * FROM public.case_access_requests_queue(%(status)s, %(limit)s, %(offset)s);",
                {"status": status, "limit": limit, "offset": offset},
            )
            return await cur.fetchall()
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def decide_case_access_request(
    conn: AsyncConnection,
    *,
    request_id: UUID,
    decision: str,
    decision_reason: str,
    expires_at: datetime | None = None,
) -> UUID | None:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT public.decide_case_access_request(%(request_id)s, %(decision)s, %(decision_reason)s, %(expires_at)s);",
                {
                    "request_id": request_id,
                    "decision": decision,
                    "decision_reason": decision_reason,
                    "expires_at": expires_at,
                },
            )
            row = await cur.fetchone()
            return _first_val(row)
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def revoke_case_access_grant(
    conn: AsyncConnection,
    *,
    grant_id: UUID,
    revocation_reason: str,
) -> bool:
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT public.revoke_case_access_grant(%(grant_id)s, %(revocation_reason)s);",
                {
                    "grant_id": grant_id,
                    "revocation_reason": revocation_reason,
                },
            )
            row = await cur.fetchone()
            val = _first_val(row)
            return bool(val) if val is not None else False
    except psycopg.Error as exc:
        raise _translate(exc) from exc


async def list_case_access_grants(
    conn: AsyncConnection,
    case_id: UUID,
) -> list[dict[str, Any]]:
    try:
        async with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            await cur.execute(
                "SELECT * FROM public.case_access_grants_projection(%(case_id)s);",
                {"case_id": case_id},
            )
            return await cur.fetchall()
    except psycopg.Error as exc:
        raise _translate(exc) from exc


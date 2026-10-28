"""Phase 2.1 simulated complaint intake.

Two very different surfaces:

* ``POST /demo/intake/{channel_code}/submissions`` is public. It never touches
  a table directly: it calls an insert-only ``SECURITY DEFINER`` function as the
  ``one_desk_intake`` role, which is the only role the function accepts.
* ``GET /submissions`` and ``GET /submissions/{id}`` require the explicit global
  ``submission.view`` capability, and PostgreSQL RLS enforces the same rule.
"""

from __future__ import annotations

import re
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response, status

from app.api.pagination import decode_cursor, page_response, validate_limit
from app.api.v1.serializers import submission_detail, submission_summary
from app.auth import permissions as perms
from app.auth.dependencies import RequestContext, require_global_permission
from app.core.errors import ApiError
from app.repositories import intake as repo
from app.schemas.intake import (
    DemoSubmissionCreate,
    DemoSubmissionReceipt,
    SubmissionDetail,
)
from app.services.intake import DemoIntakeService

router = APIRouter(tags=["intake"])

_CHANNEL_PATTERN = re.compile(r"^[A-Za-z0-9_]{1,32}$")
_MAX_IDEMPOTENCY_KEY = 128
_INTAKE_STATUSES = {
    "received",
    "awaiting_institution_verification",
    "awaiting_duplicate_review",
    "ready_for_case_creation",
    "associated_with_case",
    "rejected",
}


def _client_ip(request: Request) -> str:
    # The demo does not persist or log the address; it is only a rate-limit key.
    return request.client.host if request.client else "unknown"


@router.post(
    "/demo/intake/{channel_code}/submissions",
    status_code=status.HTTP_201_CREATED,
    response_model=DemoSubmissionReceipt,
    summary="Record a simulated complaint submission",
)
async def create_demo_submission(
    request: Request,
    response: Response,
    channel_code: str,
    payload: DemoSubmissionCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> DemoSubmissionReceipt:
    if not _CHANNEL_PATTERN.match(channel_code):
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "The intake channel code is not valid.",
            details=[{"field": "channel_code", "issue": "Must be an alphanumeric channel code"}],
        )

    key = idempotency_key.strip() if idempotency_key else None
    if key is not None and len(key) > _MAX_IDEMPOTENCY_KEY:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "The Idempotency-Key header must be 128 characters or fewer.",
            details=[{"field": "idempotency_key", "issue": "Too long"}],
        )

    service: DemoIntakeService = request.app.state.intake_service
    receipt, replayed = await service.submit(
        request.app.state.db,
        channel_code=channel_code.upper(),
        payload=payload,
        idempotency_key=key or None,
        client_ip=_client_ip(request),
        request_id=getattr(request.state, "request_id", "req_unavailable"),
    )

    response.status_code = status.HTTP_200_OK if replayed else status.HTTP_201_CREATED
    return DemoSubmissionReceipt(**receipt)


@router.get("/submissions", summary="List preserved intake submissions")
async def list_submissions(
    ctx: RequestContext = Depends(require_global_permission(perms.SUBMISSION_VIEW)),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = Query(default=None),
    channel_code: str | None = Query(default=None, max_length=32),
    intake_status: str | None = Query(default=None),
    language: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
) -> dict:
    limit = validate_limit(limit)
    offset = decode_cursor(cursor)

    if intake_status is not None and intake_status not in _INTAKE_STATUSES:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "intake_status is not a recognised intake state.",
            details=[{"field": "intake_status", "issue": "Invalid value"}],
        )
    if language is not None and language not in {"en", "hi"}:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "language must be en or hi.",
            details=[{"field": "language", "issue": "Invalid value"}],
        )
    if channel_code is not None and not _CHANNEL_PATTERN.match(channel_code):
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "The intake channel code is not valid.",
            details=[{"field": "channel_code", "issue": "Invalid value"}],
        )

    rows = await repo.list_submissions(
        ctx.conn,
        limit=limit,
        offset=offset,
        channel_code=channel_code.upper() if channel_code else None,
        intake_status=intake_status,
        language=language,
        q=q.strip() if q and q.strip() else None,
    )
    return page_response(
        [submission_summary(row) for row in rows],
        limit=limit,
        offset=offset,
        request_id=ctx.request_id,
    )


@router.get(
    "/submissions/{submission_id}",
    response_model=SubmissionDetail,
    summary="Authorized submission detail including the original complaint text",
)
async def get_submission(
    submission_id: UUID,
    ctx: RequestContext = Depends(require_global_permission(perms.SUBMISSION_VIEW)),
) -> SubmissionDetail:
    row = await repo.get_submission(ctx.conn, submission_id)
    if row is None:
        # RLS returns nothing for an unauthorized caller, so this does not
        # confirm or deny the existence of a restricted record.
        raise ApiError(404, "NOT_FOUND", "Submission not found.")
    return SubmissionDetail(**submission_detail(row))

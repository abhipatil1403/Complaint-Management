"""Phase 2.2 human institution-verification queue.

A reviewer sees provenance and evidence, never complaint content. The API
requires the explicit global ``institution.verify`` capability and PostgreSQL
re-checks it inside every SECURITY DEFINER function it calls.

Explicit selection is a product rule, not a UI hint: ``confirm`` cannot succeed
without a caller-supplied ``institution_id`` and a reason. Evidence candidates
(including ``candidate_institution_id``) are advisory and are never applied
automatically.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.api.pagination import decode_cursor, page_response, validate_limit
from app.api.v1.serializers import (
    verification_candidate_payload,
    verification_task_payload,
)
from app.auth import permissions as perms
from app.auth.dependencies import RequestContext, require_global_permission
from app.core.errors import ApiError
from app.repositories import verification as repo
from app.schemas.verification import (
    CorrectionRoundCreate,
    VerificationCandidateList,
    VerificationDecision,
    VerificationTask,
)

router = APIRouter(prefix="/verification", tags=["verification"])

_STATUSES = {"open", "pending", "in_review", "verified", "rejected", "all"}
_ASSIGNMENTS = {"all", "unassigned", "mine"}
_PRIORITIES = {"low", "normal", "high", "critical"}
_SORTS = {"oldest", "recent"}


def _validate_filters(
    status_filter: str,
    assignment: str,
    priority: str | None,
    sort: str,
) -> None:
    if status_filter not in _STATUSES:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "status is not a recognised verification state.",
            details=[{"field": "status", "issue": "Invalid value"}],
        )
    if assignment not in _ASSIGNMENTS:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "assignment is not a recognised filter.",
            details=[{"field": "assignment", "issue": "Invalid value"}],
        )
    if priority is not None and priority not in _PRIORITIES:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "priority is not a recognised priority.",
            details=[{"field": "priority", "issue": "Invalid value"}],
        )
    if sort not in _SORTS:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "sort is not a recognised sort order.",
            details=[{"field": "sort", "issue": "Invalid value"}],
        )


@router.get("/tasks", summary="List the human institution-verification queue")
async def list_tasks(
    ctx: RequestContext = Depends(require_global_permission(perms.INSTITUTION_VERIFY)),
    status_filter: str = Query(default="open", alias="status"),
    assignment: str = Query(default="all"),
    priority: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    sort: str = Query(default="oldest"),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = Query(default=None),
) -> dict:
    limit = validate_limit(limit)
    offset = decode_cursor(cursor)
    _validate_filters(status_filter, assignment, priority, sort)

    rows = await repo.list_tasks(
        ctx.conn,
        status=status_filter,
        assignment=assignment,
        priority=priority,
        query=q.strip() if q and q.strip() else None,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    return page_response(
        [verification_task_payload(row) for row in rows],
        limit=limit,
        offset=offset,
        request_id=ctx.request_id,
    )


@router.get(
    "/tasks/{task_id}",
    response_model=VerificationTask,
    summary="Verification task detail",
)
async def get_task(
    task_id: UUID,
    ctx: RequestContext = Depends(require_global_permission(perms.INSTITUTION_VERIFY)),
) -> VerificationTask:
    row = await repo.get_task(ctx.conn, task_id)
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Verification task not found.")
    return VerificationTask(**verification_task_payload(row))


@router.get(
    "/submissions/{submission_id}/candidates",
    response_model=VerificationCandidateList,
    summary="Advisory institution candidates for one submission",
)
async def list_candidates(
    submission_id: UUID,
    ctx: RequestContext = Depends(require_global_permission(perms.INSTITUTION_VERIFY)),
) -> VerificationCandidateList:
    rows = await repo.list_candidates(ctx.conn, submission_id)
    return VerificationCandidateList(
        data=[verification_candidate_payload(row) for row in rows],
        request_id=ctx.request_id,
    )


@router.post(
    "/tasks/{task_id}/decision",
    response_model=VerificationTask,
    summary="Record a verification decision",
)
async def decide(
    task_id: UUID,
    payload: VerificationDecision,
    ctx: RequestContext = Depends(require_global_permission(perms.INSTITUTION_VERIFY)),
) -> VerificationTask:
    await repo.decide(
        ctx.conn,
        task_id=task_id,
        action=payload.action,
        institution_id=payload.institution_id,
        reason=payload.reason,
        expected_updated_at=payload.expected_updated_at,
    )
    row = await repo.get_task(ctx.conn, task_id)
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Verification task not found.")
    return VerificationTask(**verification_task_payload(row))


@router.post(
    "/submissions/{submission_id}/correction-rounds",
    status_code=status.HTTP_201_CREATED,
    response_model=VerificationTask,
    summary="Open a correction round for an existing association",
)
async def request_correction_round(
    submission_id: UUID,
    payload: CorrectionRoundCreate,
    ctx: RequestContext = Depends(require_global_permission(perms.INSTITUTION_VERIFY)),
) -> VerificationTask:
    task_id = await repo.request_round(
        ctx.conn,
        submission_id=submission_id,
        reason=payload.reason,
        expected_submission_updated_at=payload.expected_submission_updated_at,
    )
    row = await repo.get_task(ctx.conn, task_id)
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Verification task not found.")
    return VerificationTask(**verification_task_payload(row))

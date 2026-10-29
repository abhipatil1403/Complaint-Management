"""Phase 2.3 duplicate review endpoints.

Submissions do not carry an approved bureau ownership model; duplicate review
queue inspection, candidate detail projection, and decisions require the global
DUPLICATE.REVIEW capability. Rejection requires the global SUBMISSION.REJECT capability.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.auth import permissions as perms
from app.auth.dependencies import RequestContext, require_global_permission
from app.core.errors import ApiError
from app.repositories import duplicate_review as repo
from app.schemas.duplicate_review import (
    DuplicateCandidateDetail,
    DuplicateCandidateQueueItem,
    DuplicateDecisionRequest,
    DuplicateScreenRequest,
    IntakeSubmissionRejectRequest,
)

router = APIRouter(prefix="/duplicate-review", tags=["duplicate-review"])

_STATUSES = {"pending", "confirmed_duplicate", "not_duplicate", "related", "all"}


@router.get(
    "/queue",
    response_model=list[DuplicateCandidateQueueItem],
    summary="List duplicate candidate review queue",
)
async def list_duplicate_queue(
    ctx: RequestContext = Depends(require_global_permission(perms.DUPLICATE_REVIEW)),
    status_filter: str | None = Query(default="pending", alias="status"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[DuplicateCandidateQueueItem]:
    if status_filter and status_filter != "all" and status_filter not in _STATUSES:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "Invalid status filter.",
            details=[{"field": "status", "issue": "Invalid value"}],
        )

    db_status = None if status_filter == "all" else status_filter
    rows = await repo.list_queue(
        ctx.conn,
        status=db_status,
        limit=limit,
        offset=offset,
    )
    return [DuplicateCandidateQueueItem.model_validate(r) for r in rows]


@router.get(
    "/candidates/{candidate_id}",
    response_model=DuplicateCandidateDetail,
    summary="Get candidate pair detail for duplicate review",
)
async def get_candidate_detail(
    candidate_id: UUID,
    ctx: RequestContext = Depends(require_global_permission(perms.DUPLICATE_REVIEW)),
) -> DuplicateCandidateDetail:
    row = await repo.get_candidate_detail(ctx.conn, candidate_id)
    if not row:
        raise ApiError(404, "NOT_FOUND", "Duplicate candidate pair not found.")
    return DuplicateCandidateDetail.model_validate(row)


@router.post(
    "/screen",
    status_code=status.HTTP_200_OK,
    summary="Screen an intake submission for duplicate candidate cases",
)
async def screen_submission(
    payload: DuplicateScreenRequest,
    ctx: RequestContext = Depends(require_global_permission(perms.DUPLICATE_REVIEW)),
) -> dict[str, int]:
    count = await repo.screen_submission(
        ctx.conn,
        submission_id=payload.submission_id,
        expected_submission_updated_at=payload.expected_submission_updated_at,
    )
    return {"inserted_count": count}


@router.post(
    "/candidates/{candidate_id}/decide",
    status_code=status.HTTP_200_OK,
    summary="Record human duplicate decision",
)
async def decide_candidate(
    candidate_id: UUID,
    payload: DuplicateDecisionRequest,
    ctx: RequestContext = Depends(require_global_permission(perms.DUPLICATE_REVIEW)),
) -> dict[str, str]:
    await repo.decide_candidate(
        ctx.conn,
        candidate_id=candidate_id,
        action=payload.action,
        notes=payload.notes,
        expected_submission_updated_at=payload.expected_submission_updated_at,
        expected_candidate_updated_at=payload.expected_candidate_updated_at,
    )
    return {"status": "success", "action": payload.action}


@router.post(
    "/submissions/{submission_id}/reject",
    status_code=status.HTTP_200_OK,
    summary="Reject intake submission failing verification or duplicate screening",
)
async def reject_submission(
    submission_id: UUID,
    payload: IntakeSubmissionRejectRequest,
    ctx: RequestContext = Depends(require_global_permission(perms.SUBMISSION_REJECT)),
) -> dict[str, str]:
    await repo.reject_submission(
        ctx.conn,
        submission_id=submission_id,
        reason=payload.reason,
        expected_submission_updated_at=payload.expected_submission_updated_at,
    )
    return {"status": "rejected", "submission_id": str(submission_id)}

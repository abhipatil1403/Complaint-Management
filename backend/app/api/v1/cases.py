"""Phase 2.3 canonical case endpoints.

Cross-bureau minimal case index is separated from authorized full case detail.
Full detail access is gated by PostgreSQL can_access_case_details(), requiring
active bureau assignment or active case access grant in addition to CASE.VIEW_DETAIL.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.auth import permissions as perms
from app.auth.dependencies import RequestContext, require_any_permission, require_permission
from app.core.errors import ApiError
from app.repositories import cases as repo
from app.schemas.cases import (
    CaseCreateRequest,
    CaseDetail,
    CaseIndexItem,
)

router = APIRouter(prefix="/cases", tags=["cases"])


@router.get(
    "",
    response_model=list[CaseIndexItem],
    summary="List cross-bureau minimal case index",
)
async def list_cases(
    ctx: RequestContext = Depends(require_any_permission(perms.CASE_VIEW_INDEX, perms.CASE_VIEW_DETAIL)),
    status_filter: str | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, alias="search", max_length=120),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[CaseIndexItem]:
    rows = await repo.list_cases(
        ctx.conn,
        status=status_filter,
        search=q,
        limit=limit,
        offset=offset,
    )
    return [CaseIndexItem.model_validate(r) for r in rows]


@router.get(
    "/{case_id}",
    response_model=CaseDetail,
    summary="Get authorized full case details",
)
async def get_case_detail(
    case_id: UUID,
    ctx: RequestContext = Depends(require_permission(perms.CASE_VIEW_DETAIL)),
) -> CaseDetail:
    row = await repo.get_case_detail(ctx.conn, case_id)
    if not row:
        # If the case does not exist or PostgreSQL can_access_case_details returned false
        # it returns 0 rows. To preserve least privilege and privacy, 404 is returned if not found.
        raise ApiError(
            404,
            "NOT_FOUND",
            "Case not found or caller is not authorized to view full details.",
        )
    return CaseDetail.model_validate(row)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Create canonical complaint case from screened submission",
)
async def create_case(
    payload: CaseCreateRequest,
    ctx: RequestContext = Depends(require_permission(perms.CASE_CREATE)),
) -> dict[str, str]:
    new_case_id = await repo.create_case(
        ctx.conn,
        submission_id=payload.submission_id,
        lead_bureau_id=payload.lead_bureau_id,
        title=payload.title,
        description=payload.description,
        priority=payload.priority,
        visibility=payload.visibility,
        expected_submission_updated_at=payload.expected_submission_updated_at,
    )
    return {"status": "created", "case_id": str(new_case_id)}

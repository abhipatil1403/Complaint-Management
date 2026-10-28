"""Bureau reference data and bureau memberships (Phase 1)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.api.pagination import decode_cursor, page_response, validate_limit
from app.api.v1.serializers import bureau_member_payload, bureau_payload
from app.auth import permissions as perms
from app.auth.dependencies import RequestContext, get_request_context, require_permission
from app.core.errors import ApiError
from app.repositories import admin as admin_repo
from app.repositories import reference as repo
from app.schemas.reference import (
    BureauCreate,
    BureauMemberOut,
    BureauOut,
    BureauUpdate,
    MembershipCreate,
)

router = APIRouter(tags=["bureaus"])


def require_bureau_capability(
    ctx: RequestContext, bureau_id: UUID, api_code: str
) -> None:
    """A bureau-scoped capability only applies to the caller's own bureau."""
    if api_code in ctx.principal.global_permissions:
        return
    if ctx.principal.is_member(bureau_id) and api_code in ctx.principal.bureau_permissions.get(
        bureau_id, frozenset()
    ):
        return
    raise ApiError(
        403,
        "FORBIDDEN",
        f"The '{api_code}' capability is not granted for this bureau.",
    )


@router.get("/bureaus", summary="List bureaus")
async def list_bureaus(
    ctx: RequestContext = Depends(require_permission(perms.BUREAU_VIEW)),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = Query(default=None),
    include_inactive: bool = Query(default=False),
) -> dict:
    limit = validate_limit(limit)
    offset = decode_cursor(cursor)
    if include_inactive and not ctx.principal.has_permission(perms.BUREAU_MANAGE, ctx.active_bureau_id):
        raise ApiError(403, "FORBIDDEN", "Including inactive bureaus requires 'bureau.manage'.")
    rows = await repo.list_bureaus(
        ctx.conn, limit=limit, offset=offset, include_inactive=include_inactive
    )
    return page_response(
        [bureau_payload(row) for row in rows],
        limit=limit,
        offset=offset,
        request_id=ctx.request_id,
    )


@router.get("/bureaus/{bureau_id}", response_model=BureauOut, summary="Bureau detail")
async def get_bureau(
    bureau_id: UUID,
    ctx: RequestContext = Depends(require_permission(perms.BUREAU_VIEW)),
) -> BureauOut:
    row = await repo.get_bureau(ctx.conn, bureau_id)
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Bureau not found.")
    return BureauOut(**bureau_payload(row))


@router.post(
    "/bureaus",
    status_code=status.HTTP_201_CREATED,
    response_model=BureauOut,
    summary="Create a bureau",
)
async def create_bureau(
    payload: BureauCreate,
    ctx: RequestContext = Depends(require_permission(perms.BUREAU_MANAGE)),
) -> BureauOut:
    if payload.parent_bureau_id is not None:
        parent = await repo.get_bureau(ctx.conn, payload.parent_bureau_id)
        if parent is None:
            raise ApiError(422, "REFERENCE_ERROR", "The parent bureau does not exist.")
    row = await repo.create_bureau(
        ctx.conn,
        code=payload.code,
        name=payload.name,
        description=payload.description,
        parent_bureau_id=payload.parent_bureau_id,
        bureau_type=payload.bureau_type,
        display_order=payload.display_order,
        is_active=payload.is_active,
    )
    assert row is not None
    return BureauOut(**bureau_payload(row))


@router.patch("/bureaus/{bureau_id}", response_model=BureauOut, summary="Update a bureau")
async def update_bureau(
    bureau_id: UUID,
    payload: BureauUpdate,
    ctx: RequestContext = Depends(require_permission(perms.BUREAU_MANAGE)),
) -> BureauOut:
    values = payload.model_dump(exclude_unset=True)
    if values.get("parent_bureau_id") is not None:
        if values["parent_bureau_id"] == bureau_id:
            raise ApiError(422, "VALIDATION_ERROR", "A bureau cannot be its own parent.")
        parent = await repo.get_bureau(ctx.conn, values["parent_bureau_id"])
        if parent is None:
            raise ApiError(422, "REFERENCE_ERROR", "The parent bureau does not exist.")
    row = await repo.update_bureau(ctx.conn, bureau_id, values)
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Bureau not found.")
    return BureauOut(**bureau_payload(row))


@router.get("/bureaus/{bureau_id}/members", summary="Bureau membership list")
async def list_bureau_members(
    bureau_id: UUID,
    ctx: RequestContext = Depends(get_request_context),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = Query(default=None),
    include_inactive: bool = Query(default=False),
) -> dict:
    require_bureau_capability(ctx, bureau_id, perms.BUREAU_MEMBERS_VIEW)
    if include_inactive:
        require_bureau_capability(ctx, bureau_id, perms.BUREAU_MEMBERS_MANAGE)
    if await repo.get_bureau(ctx.conn, bureau_id) is None:
        raise ApiError(404, "NOT_FOUND", "Bureau not found.")
    limit = validate_limit(limit)
    offset = decode_cursor(cursor)
    rows = await repo.list_bureau_members(
        ctx.conn,
        bureau_id=bureau_id,
        limit=limit,
        offset=offset,
        include_inactive=include_inactive,
    )
    return page_response(
        [bureau_member_payload(row) for row in rows],
        limit=limit,
        offset=offset,
        request_id=ctx.request_id,
    )


@router.post(
    "/bureau-memberships",
    status_code=status.HTTP_201_CREATED,
    response_model=BureauMemberOut,
    summary="Add an active bureau membership",
)
async def add_bureau_membership(
    payload: MembershipCreate,
    ctx: RequestContext = Depends(get_request_context),
) -> BureauMemberOut:
    require_bureau_capability(ctx, payload.bureau_id, perms.BUREAU_MEMBERS_MANAGE)

    bureau = await repo.get_bureau(ctx.conn, payload.bureau_id)
    if bureau is None:
        raise ApiError(404, "NOT_FOUND", "Bureau not found.")
    if not bureau["is_active"]:
        raise ApiError(409, "BUREAU_INACTIVE", "Cannot add membership to an inactive bureau.")
    if not await admin_repo.user_exists_and_active(ctx.conn, payload.user_id):
        raise ApiError(422, "REFERENCE_ERROR", "The selected user does not exist or is not active.")

    row = await repo.add_membership(
        ctx.conn,
        user_id=payload.user_id,
        bureau_id=payload.bureau_id,
        membership_type=payload.membership_type,
        is_primary=payload.is_primary,
    )
    assert row is not None
    user = await admin_repo.get_user(ctx.conn, payload.user_id)
    return BureauMemberOut(
        membership_id=row["id"],
        user_id=row["user_id"],
        bureau_id=row["bureau_id"],
        full_name=user["full_name"] if user else "",
        official_email=user["official_email"] if user else "",
        designation=user["designation"] if user else None,
        membership_type=row["membership_type"],
        membership_status=row["membership_status"],
        is_primary=row["is_primary"],
        joined_at=row["joined_at"],
        ended_at=row["ended_at"],
    )


@router.post(
    "/bureau-memberships/{membership_id}/end",
    response_model=BureauMemberOut,
    summary="End a bureau membership (never hard-deleted)",
)
async def end_bureau_membership(
    membership_id: UUID,
    ctx: RequestContext = Depends(get_request_context),
) -> BureauMemberOut:
    existing = await repo.get_membership(ctx.conn, membership_id)
    if existing is None:
        raise ApiError(404, "NOT_FOUND", "Bureau membership not found.")
    require_bureau_capability(ctx, existing["bureau_id"], perms.BUREAU_MEMBERS_MANAGE)

    row = await repo.end_membership(ctx.conn, membership_id)
    if row is None:
        raise ApiError(409, "ALREADY_INACTIVE", "This membership is already inactive.")
    user = await admin_repo.get_user(ctx.conn, row["user_id"])
    return BureauMemberOut(
        membership_id=row["id"],
        user_id=row["user_id"],
        bureau_id=row["bureau_id"],
        full_name=user["full_name"] if user else "",
        official_email=user["official_email"] if user else "",
        designation=user["designation"] if user else None,
        membership_type=row["membership_type"],
        membership_status=row["membership_status"],
        is_primary=row["is_primary"],
        joined_at=row["joined_at"],
        ended_at=row["ended_at"],
    )

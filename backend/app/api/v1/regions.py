"""Regions reference data."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.pagination import decode_cursor, page_response, validate_limit
from app.api.v1.serializers import region_payload
from app.auth import permissions as perms
from app.auth.dependencies import (
    RequestContext,
    require_global_permission,
    require_permission,
)
from app.core.errors import ApiError
from app.repositories import reference as repo
from app.schemas.reference import RegionCreate, RegionOut, RegionUpdate

router = APIRouter(tags=["regions"])


@router.get("/regions", summary="List regions")
async def list_regions(
    ctx: RequestContext = Depends(require_permission(perms.REGION_VIEW)),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = Query(default=None),
    include_inactive: bool = Query(default=False),
) -> dict:
    limit = validate_limit(limit)
    offset = decode_cursor(cursor)
    if include_inactive and not ctx.principal.has_permission(perms.REGION_MANAGE, ctx.active_bureau_id):
        raise ApiError(403, "FORBIDDEN", "Including inactive regions requires 'region.manage'.")
    rows = await repo.list_regions(
        ctx.conn, limit=limit, offset=offset, include_inactive=include_inactive
    )
    return page_response(
        [region_payload(row) for row in rows],
        limit=limit,
        offset=offset,
        request_id=ctx.request_id,
    )


@router.post(
    "/regions",
    status_code=status.HTTP_201_CREATED,
    response_model=RegionOut,
    summary="Create a region",
)
async def create_region(
    payload: RegionCreate,
    ctx: RequestContext = Depends(require_global_permission(perms.REGION_MANAGE)),
) -> RegionOut:
    row = await repo.create_region(
        ctx.conn,
        code=payload.code,
        name=payload.name,
        description=payload.description,
        is_active=payload.is_active,
    )
    return RegionOut(**region_payload(row))


@router.patch("/regions/{region_id}", response_model=RegionOut, summary="Update a region")
async def update_region(
    region_id: UUID,
    payload: RegionUpdate,
    ctx: RequestContext = Depends(require_global_permission(perms.REGION_MANAGE)),
) -> RegionOut:
    values = payload.model_dump(exclude_unset=True)
    row = await repo.update_region(ctx.conn, region_id, values)
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Region not found.")
    return RegionOut(**region_payload(row))


@router.delete(
    "/regions/{region_id}",
    status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
    include_in_schema=False,
)
async def delete_region(region_id: UUID) -> Response:  # pragma: no cover - guard rail
    # Reference data is deactivated, never hard-deleted (audit/history retention).
    raise ApiError(405, "METHOD_NOT_ALLOWED", "Regions are deactivated with is_active=false, not deleted.")

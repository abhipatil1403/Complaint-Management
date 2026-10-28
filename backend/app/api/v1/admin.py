"""Authorized-user and role administration (Phase 1)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.api.pagination import decode_cursor, page_response, validate_limit
from app.api.v1.serializers import user_summary
from app.auth import permissions as perms
from app.auth.dependencies import RequestContext, require_global_permission
from app.core.errors import ApiError
from app.repositories import admin as repo
from app.repositories import reference as reference_repo
from app.schemas.admin import (
    AccountStatusUpdate,
    RoleAssignRequest,
    RoleAssignmentDetail,
    RoleOut,
    RoleRevokeRequest,
    UserDetail,
    UserProfileUpdate,
    UserSummary,
)

logger = logging.getLogger("aicte_onedesk.audit")
router = APIRouter(tags=["administration"])


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
@router.get("/users", summary="List authorized users")
async def list_users(
    ctx: RequestContext = Depends(require_global_permission(perms.USER_VIEW)),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    account_status: str | None = Query(default=None),
) -> dict:
    limit = validate_limit(limit)
    offset = decode_cursor(cursor)
    if account_status is not None and account_status not in {"active", "inactive", "suspended"}:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "account_status must be one of active, inactive, suspended.",
        )
    rows = await repo.list_users(
        ctx.conn,
        limit=limit,
        offset=offset,
        q=q.strip() if q and q.strip() else None,
        account_status=account_status,
    )
    page_rows = rows[:limit]
    grouped = await repo.list_role_assignments_for_users(
        ctx.conn, [row["id"] for row in page_rows]
    )
    return page_response(
        [user_summary(row, grouped.get(row["id"], [])) for row in rows[: limit + 1]],
        limit=limit,
        offset=offset,
        request_id=ctx.request_id,
    )


@router.get("/users/{user_id}", response_model=UserDetail, summary="User profile, roles and memberships")
async def get_user(
    user_id: UUID,
    ctx: RequestContext = Depends(require_global_permission(perms.USER_VIEW)),
) -> UserDetail:
    row = await repo.get_user(ctx.conn, user_id)
    if row is None:
        raise ApiError(404, "NOT_FOUND", "User not found.")
    assignments = await repo.list_role_assignments_for_user(ctx.conn, user_id, include_ended=True)
    memberships = await repo.list_memberships_for_user(ctx.conn, user_id)
    summary = user_summary(row, [item for item in assignments if item["assignment_status"] == "active"])
    return UserDetail(
        **summary,
        memberships=[
            {
                "id": item["id"],
                "bureau_id": item["bureau_id"],
                "bureau_code": item["bureau_code"],
                "bureau_name": item["bureau_name"],
                "membership_type": item["membership_type"],
                "membership_status": item["membership_status"],
                "is_primary": item["is_primary"],
                "joined_at": item["joined_at"],
                "ended_at": item["ended_at"],
            }
            for item in memberships
        ],
        role_assignments=[RoleAssignmentDetail(**item) for item in assignments],
    )


@router.patch("/users/{user_id}", response_model=UserSummary, summary="Update an authorized user profile")
async def update_user(
    user_id: UUID,
    payload: UserProfileUpdate,
    ctx: RequestContext = Depends(require_global_permission(perms.USER_MANAGE)),
) -> UserSummary:
    values = payload.model_dump(exclude_unset=True)
    row = await repo.update_profile(ctx.conn, user_id, values)
    if row is None:
        raise ApiError(404, "NOT_FOUND", "User not found.")
    assignments = await repo.list_role_assignments_for_user(ctx.conn, user_id)
    logger.info(
        "user_profile_updated actor=%s target=%s fields=%s",
        ctx.principal.user_id,
        user_id,
        sorted(values),
    )
    return UserSummary(**user_summary(row, assignments))


@router.post(
    "/users/{user_id}/account-status",
    response_model=UserSummary,
    summary="Activate, deactivate or suspend an account (never deleted)",
)
async def update_account_status(
    user_id: UUID,
    payload: AccountStatusUpdate,
    ctx: RequestContext = Depends(require_global_permission(perms.USER_MANAGE)),
) -> UserSummary:
    if user_id == ctx.principal.user_id and payload.account_status != "active":
        raise ApiError(409, "CANNOT_DEACTIVATE_SELF", "Administrators cannot deactivate their own account.")
    row = await repo.set_account_status(ctx.conn, user_id, payload.account_status)
    if row is None:
        raise ApiError(404, "NOT_FOUND", "User not found.")
    assignments = await repo.list_role_assignments_for_user(ctx.conn, user_id)
    logger.info(
        "user_account_status_changed actor=%s target=%s status=%s",
        ctx.principal.user_id,
        user_id,
        payload.account_status,
    )
    return UserSummary(**user_summary(row, assignments))


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------
@router.get("/roles", response_model=list[RoleOut], summary="Role and permission catalogue")
async def list_roles(
    ctx: RequestContext = Depends(require_global_permission(perms.ROLE_VIEW)),
) -> list[RoleOut]:
    rows = await repo.list_roles(ctx.conn)
    return [
        RoleOut(
            id=row["id"],
            code=row["code"],
            name=row["name"],
            description=row["description"],
            scope_type=row["scope_type"],
            is_system_role=row["is_system_role"],
            is_active=row["is_active"],
            permissions=sorted(code.lower() for code in row["permission_codes"]),
        )
        for row in rows
    ]


@router.post(
    "/users/{user_id}/role-assignments",
    status_code=status.HTTP_201_CREATED,
    response_model=RoleAssignmentDetail,
    summary="Grant a role (global or bureau-scoped, audited by attribution columns)",
)
async def assign_role(
    user_id: UUID,
    payload: RoleAssignRequest,
    ctx: RequestContext = Depends(require_global_permission(perms.USER_MANAGE)),
) -> RoleAssignmentDetail:
    target = await repo.get_user(ctx.conn, user_id)
    if target is None:
        raise ApiError(404, "NOT_FOUND", "User not found.")
    if target["account_status"] != "active":
        raise ApiError(422, "REFERENCE_ERROR", "Role grants require an active user.")

    role = await repo.get_role_by_code(ctx.conn, payload.role_code)
    if role is None:
        raise ApiError(404, "ROLE_NOT_FOUND", "Role not found.")
    if not role["is_active"]:
        raise ApiError(409, "ROLE_INACTIVE", "Inactive roles cannot be granted.")

    if role["scope_type"] == "global":
        if payload.bureau_id is not None:
            raise ApiError(
                422,
                "VALIDATION_ERROR",
                "A global role cannot be scoped to a bureau.",
            )
        bureau_id = None
    else:
        if payload.bureau_id is None:
            raise ApiError(
                422,
                "VALIDATION_ERROR",
                "A bureau-scoped role requires a bureau_id.",
            )
        bureau = await reference_repo.get_bureau(ctx.conn, payload.bureau_id)
        if bureau is None or not bureau["is_active"]:
            raise ApiError(422, "REFERENCE_ERROR", "The selected bureau does not exist or is inactive.")
        if not await repo.has_active_membership(
            ctx.conn, user_id=user_id, bureau_id=payload.bureau_id
        ):
            raise ApiError(
                422,
                "BUREAU_MEMBERSHIP_REQUIRED",
                "The user must have an active membership of the bureau before a bureau-scoped role is granted.",
            )
        bureau_id = payload.bureau_id

    if payload.expires_at is not None and payload.expires_at <= datetime.now(timezone.utc):
        raise ApiError(422, "VALIDATION_ERROR", "expires_at must be in the future.")

    row = await repo.assign_role(
        ctx.conn,
        user_id=user_id,
        role_id=role["id"],
        bureau_id=bureau_id,
        expires_at=payload.expires_at,
        assigned_by_user_id=ctx.principal.user_id,
    )
    assert row is not None
    bureau = await reference_repo.get_bureau(ctx.conn, bureau_id) if bureau_id else None
    logger.info(
        "role_granted actor=%s target=%s role=%s bureau=%s",
        ctx.principal.user_id,
        user_id,
        role["code"],
        bureau_id,
    )
    return RoleAssignmentDetail(
        id=row["id"],
        role_code=role["code"],
        role_name=role["name"],
        scope_type=role["scope_type"],
        bureau_id=bureau_id,
        bureau_code=bureau["code"] if bureau else None,
        bureau_name=bureau["name"] if bureau else None,
        assignment_status=row["assignment_status"],
        assigned_at=row["assigned_at"],
        expires_at=row["expires_at"],
    )


@router.post(
    "/role-assignments/{assignment_id}/revoke",
    response_model=RoleAssignmentDetail,
    summary="Revoke a role grant with a recorded reason",
)
async def revoke_role_assignment(
    assignment_id: UUID,
    payload: RoleRevokeRequest,
    ctx: RequestContext = Depends(require_global_permission(perms.USER_MANAGE)),
) -> RoleAssignmentDetail:
    existing = await repo.get_role_assignment(ctx.conn, assignment_id)
    if existing is None:
        raise ApiError(404, "NOT_FOUND", "Role assignment not found.")
    if existing["assignment_status"] != "active":
        raise ApiError(409, "ALREADY_REVOKED", "This role assignment is not active.")

    if existing["role_code"] == perms.SUPER_ADMIN and existing["user_id"] == ctx.principal.user_id:
        holders = await repo.count_active_role_holders(ctx.conn, perms.SUPER_ADMIN)
        if holders <= 1:
            raise ApiError(
                409,
                "LAST_SUPER_ADMIN",
                "The last active Super Admin cannot revoke their own global role.",
            )

    row = await repo.revoke_role_assignment(
        ctx.conn,
        assignment_id=assignment_id,
        revoked_by_user_id=ctx.principal.user_id,
        reason=payload.reason,
    )
    if row is None:
        raise ApiError(409, "ALREADY_REVOKED", "This role assignment is not active.")

    role = await repo.get_role_by_code(ctx.conn, existing["role_code"])
    bureau = (
        await reference_repo.get_bureau(ctx.conn, row["bureau_id"])
        if row["bureau_id"]
        else None
    )
    logger.info(
        "role_revoked actor=%s target=%s role=%s bureau=%s reason_present=true",
        ctx.principal.user_id,
        row["user_id"],
        existing["role_code"],
        row["bureau_id"],
    )
    return RoleAssignmentDetail(
        id=row["id"],
        role_code=existing["role_code"],
        role_name=role["name"] if role else existing["role_code"],
        scope_type=role["scope_type"] if role else ("bureau" if row["bureau_id"] else "global"),
        bureau_id=row["bureau_id"],
        bureau_code=bureau["code"] if bureau else None,
        bureau_name=bureau["name"] if bureau else None,
        assignment_status=row["assignment_status"],
        revoked_at=row["revoked_at"],
        revocation_reason=row["revocation_reason"],
    )

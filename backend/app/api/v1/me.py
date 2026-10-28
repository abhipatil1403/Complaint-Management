"""Current user, effective permissions and active bureau context."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.auth.dependencies import RequestContext, get_request_context
from app.core.errors import ApiError
from app.schemas.identity import (
    ActiveBureauRequest,
    ActiveBureauResponse,
    MeMembership,
    MeResponse,
    MeRole,
    MeUser,
    PermissionsResponse,
)

router = APIRouter(tags=["me"])


def _principal_payload(ctx: RequestContext, request: Request) -> dict:
    settings = request.app.state.settings
    principal = ctx.principal
    permissions = sorted(principal.permissions_for(ctx.active_bureau_id))
    return {
        "user": MeUser(
            id=principal.user_id,
            full_name=principal.full_name,
            display_name=principal.display_name,
            official_email=principal.official_email,
            designation=principal.designation,
            employee_code=principal.employee_code,
            account_status=principal.account_status,
        ),
        "roles": [
            MeRole(
                role_code=role.role_code,
                role_name=role.role_name,
                scope_type=role.scope_type,
                bureau_id=role.bureau_id,
                bureau_name=role.bureau_name,
                permissions=sorted(role.permissions),
            )
            for role in principal.roles
        ],
        "memberships": [
            MeMembership(
                bureau_id=membership.bureau_id,
                bureau_code=membership.bureau_code,
                bureau_name=membership.bureau_name,
                membership_type=membership.membership_type,
                is_primary=membership.is_primary,
            )
            for membership in principal.memberships
        ],
        "active_bureau_id": ctx.active_bureau_id,
        "permissions": permissions,
        "global_permissions": sorted(principal.global_permissions),
        "is_super_admin": principal.is_super_admin,
        "demo_mode": settings.demo_mode,
        "demo_notice": settings.demo_banner_text,
    }


@router.get("/me", response_model=MeResponse, summary="Current internal profile and capabilities")
async def read_me(
    request: Request,
    ctx: RequestContext = Depends(get_request_context),
) -> MeResponse:
    return MeResponse(**_principal_payload(ctx, request))


@router.get(
    "/me/permissions",
    response_model=PermissionsResponse,
    summary="Effective permission list for the current bureau context",
)
async def read_my_permissions(
    ctx: RequestContext = Depends(get_request_context),
) -> PermissionsResponse:
    return PermissionsResponse(
        active_bureau_id=ctx.active_bureau_id,
        permissions=sorted(ctx.principal.permissions_for(ctx.active_bureau_id)),
        global_permissions=sorted(ctx.principal.global_permissions),
    )


@router.post(
    "/me/active-bureau",
    response_model=ActiveBureauResponse,
    summary="Select an existing bureau membership as the UI context",
)
async def select_active_bureau(
    payload: ActiveBureauRequest,
    ctx: RequestContext = Depends(get_request_context),
) -> ActiveBureauResponse:
    membership = ctx.principal.membership(payload.bureau_id)
    if membership is None:
        raise ApiError(
            403,
            "BUREAU_CONTEXT_DENIED",
            "The selected bureau context is not an active membership of the caller.",
        )
    return ActiveBureauResponse(
        active_bureau_id=membership.bureau_id,
        bureau_code=membership.bureau_code,
        bureau_name=membership.bureau_name,
        permissions=sorted(ctx.principal.permissions_for(membership.bureau_id)),
    )

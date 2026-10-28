"""Institution and institution-alias reference data (Phase 1)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.api.pagination import decode_cursor, page_response, validate_limit
from app.api.v1.serializers import institution_detail, institution_summary
from app.auth import permissions as perms
from app.auth.dependencies import RequestContext, get_request_context, require_permission
from app.core.errors import ApiError
from app.repositories import reference as repo
from app.schemas.reference import (
    AliasCreate,
    AliasOut,
    InstitutionCreate,
    InstitutionDetail,
    InstitutionUpdate,
)

router = APIRouter(tags=["institutions"])

_ALLOWED_VERIFICATION_TRANSITIONS = {
    ("pending", "verified"),
    ("pending", "rejected"),
    ("verified", "verified"),
    ("rejected", "rejected"),
}


@router.get("/institutions", summary="Search institution master data")
async def list_institutions(
    ctx: RequestContext = Depends(require_permission(perms.INSTITUTION_VIEW)),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    region_id: UUID | None = Query(default=None),
    verification_status: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
) -> dict:
    limit = validate_limit(limit)
    offset = decode_cursor(cursor)
    if verification_status is not None and verification_status not in {"pending", "verified", "rejected"}:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "verification_status must be one of pending, verified, rejected.",
            details=[{"field": "verification_status", "issue": "Invalid value"}],
        )
    rows = await repo.list_institutions(
        ctx.conn,
        limit=limit,
        offset=offset,
        q=q.strip() if q and q.strip() else None,
        region_id=region_id,
        verification_status=verification_status,
        is_active=is_active,
    )
    return page_response(
        [institution_summary(row) for row in rows],
        limit=limit,
        offset=offset,
        request_id=ctx.request_id,
    )


@router.get(
    "/institutions/{institution_id}",
    response_model=InstitutionDetail,
    summary="Institution profile",
)
async def get_institution(
    institution_id: UUID,
    ctx: RequestContext = Depends(require_permission(perms.INSTITUTION_VIEW)),
) -> InstitutionDetail:
    row = await repo.get_institution(ctx.conn, institution_id)
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Institution not found.")
    return InstitutionDetail(**institution_detail(row))


@router.post(
    "/institutions",
    status_code=status.HTTP_201_CREATED,
    response_model=InstitutionDetail,
    summary="Create an institution master record",
)
async def create_institution(
    payload: InstitutionCreate,
    ctx: RequestContext = Depends(require_permission(perms.INSTITUTION_MANAGE)),
) -> InstitutionDetail:
    if payload.region_id is not None and not await repo.region_exists(ctx.conn, payload.region_id):
        raise ApiError(422, "REFERENCE_ERROR", "The selected region does not exist or is inactive.")

    now = datetime.now(timezone.utc)
    verified = payload.verification_status == "verified"
    row = await repo.create_institution(
        ctx.conn,
        {
            "aicte_permanent_id": payload.aicte_permanent_id,
            "official_name": payload.official_name,
            "institution_type": payload.institution_type,
            "ownership_type": payload.ownership_type,
            "address_line1": payload.address_line1,
            "address_line2": payload.address_line2,
            "city": payload.city,
            "district": payload.district,
            "state_name": payload.state_name,
            "postal_code": payload.postal_code,
            "region_id": str(payload.region_id) if payload.region_id else None,
            "contact_email": payload.contact_email,
            "contact_phone": payload.contact_phone,
            "website_url": payload.website_url,
            "verification_status": payload.verification_status,
            "verification_source": payload.verification_source,
            "verification_reference": None,
            "verified_by_user_id": str(ctx.principal.user_id) if verified else None,
            "verified_at": now if verified else None,
            "is_active": payload.is_active,
        },
    )
    assert row is not None  # INSERT .. RETURNING always yields a row
    refreshed = await repo.get_institution(ctx.conn, row["id"])
    return InstitutionDetail(**institution_detail(refreshed or row))


@router.patch(
    "/institutions/{institution_id}",
    response_model=InstitutionDetail,
    summary="Update institution master data (verification changes are constrained)",
)
async def update_institution(
    institution_id: UUID,
    payload: InstitutionUpdate,
    ctx: RequestContext = Depends(require_permission(perms.INSTITUTION_MANAGE)),
) -> InstitutionDetail:
    current = await repo.get_institution(ctx.conn, institution_id)
    if current is None:
        raise ApiError(404, "NOT_FOUND", "Institution not found.")

    values: dict[str, Any] = payload.model_dump(exclude_unset=True)

    if values.get("region_id") is not None:
        region_id = values["region_id"]
        if not await repo.region_exists(ctx.conn, region_id):
            raise ApiError(422, "REFERENCE_ERROR", "The selected region does not exist or is inactive.")

    requested_status = values.get("verification_status")
    if requested_status is not None and requested_status != current["verification_status"]:
        pair = (current["verification_status"], requested_status)
        if pair not in _ALLOWED_VERIFICATION_TRANSITIONS:
            raise ApiError(
                409,
                "INVALID_STATE_TRANSITION",
                f"An institution cannot move from '{current['verification_status']}' to '{requested_status}'.",
            )
        if requested_status == "verified":
            permanent_id = values.get("aicte_permanent_id") or current.get("aicte_permanent_id")
            source = values.get("verification_source") or current.get("verification_source")
            if not permanent_id or not (source or "").strip():
                raise ApiError(
                    422,
                    "VERIFICATION_EVIDENCE_REQUIRED",
                    "Verifying an institution requires an AICTE Permanent ID and a verification source.",
                )
            values["verified_at"] = datetime.now(timezone.utc)
            values["verified_by_user_id"] = ctx.principal.user_id
        elif requested_status == "rejected":
            values["verified_at"] = None
            values["verified_by_user_id"] = None

    if "region_id" in values and values["region_id"] is not None:
        values["region_id"] = str(values["region_id"])

    row = await repo.update_institution(ctx.conn, institution_id, values)
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Institution not found.")
    refreshed = await repo.get_institution(ctx.conn, institution_id)
    return InstitutionDetail(**institution_detail(refreshed or row))


# ---------------------------------------------------------------------------
# Aliases
# ---------------------------------------------------------------------------
@router.get("/institution-aliases", summary="Search institution aliases")
async def list_aliases(
    ctx: RequestContext = Depends(require_permission(perms.INSTITUTION_ALIAS_VIEW)),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = Query(default=None),
    institution_id: UUID | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
    include_inactive: bool = Query(default=False),
) -> dict:
    limit = validate_limit(limit)
    offset = decode_cursor(cursor)
    if include_inactive and not ctx.principal.has_permission(
        perms.INSTITUTION_ALIAS_MANAGE, ctx.active_bureau_id
    ):
        raise ApiError(403, "FORBIDDEN", "Including inactive aliases requires 'institution.alias.manage'.")
    rows = await repo.list_aliases(
        ctx.conn,
        limit=limit,
        offset=offset,
        institution_id=institution_id,
        q=q.strip() if q and q.strip() else None,
        include_inactive=include_inactive,
    )
    return page_response(
        [AliasOut(**row).model_dump() for row in rows],
        limit=limit,
        offset=offset,
        request_id=ctx.request_id,
    )


@router.post(
    "/institutions/{institution_id}/aliases",
    status_code=status.HTTP_201_CREATED,
    response_model=AliasOut,
    summary="Add an institution alias with provenance",
)
async def create_alias(
    institution_id: UUID,
    payload: AliasCreate,
    ctx: RequestContext = Depends(require_permission(perms.INSTITUTION_ALIAS_MANAGE)),
) -> AliasOut:
    if not await repo.institution_exists(ctx.conn, institution_id):
        raise ApiError(404, "NOT_FOUND", "Institution not found.")
    row = await repo.create_alias(
        ctx.conn,
        institution_id=institution_id,
        alias_name=payload.alias_name,
        language_code=payload.language_code,
        alias_type=payload.alias_type,
        source_type=payload.source_type,
        source_reference=payload.source_reference,
    )
    assert row is not None
    return AliasOut(**row)

"""Phase 2.3, 3, and 4 canonical cases, workflow operations, and cross-bureau controls.

Implements PRD Section 30 Phase 3 (Bureau operations) & Phase 4 (Cross-bureau controls)
with least-privilege RBAC and PostgreSQL RLS.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from app.auth import permissions as perms
from app.auth.dependencies import RequestContext, require_any_permission, require_permission
from app.core.errors import ApiError
from app.repositories import cases as repo
from app.schemas.cases import (
    CaseAccessGrantItem,
    CaseAccessGrantRevokeRequest,
    CaseAccessRequestCreate,
    CaseAccessRequestDecision,
    CaseAccessRequestItem,
    CaseAttachmentItem,
    CaseAttachmentQuarantineRequest,
    CaseAttachmentRegisterRequest,
    CaseBureauAssignRequest,
    CaseBureauAssignUpdateRequest,
    CaseCreateRequest,
    CaseDetail,
    CaseIndexItem,
    CaseNoteCreateRequest,
    CaseNoteItem,
    CaseNoteUpdateRequest,
    CaseOfficerAssignRequest,
    CaseOfficerAssignUpdateRequest,
    CaseStatusTransitionRequest,
    CaseTransferDecisionRequest,
    CaseTransferItem,
    CaseTransferRequest,
)

router = APIRouter(prefix="/cases", tags=["cases"])
operations_router = APIRouter(tags=["case-operations"])


# --- Minimal Case Index & Detail Projections ---------------------------------

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


# --- Phase 3: Status Transitions ---------------------------------------------

@router.post(
    "/{case_id}/status",
    summary="Execute validated status transition",
)
@router.post(
    "/{case_id}/status-transitions",
    summary="Execute validated status transition",
)
async def transition_case_status(
    case_id: UUID,
    payload: CaseStatusTransitionRequest,
    ctx: RequestContext = Depends(require_permission(perms.CASE_STATUS_CHANGE)),
) -> dict[str, str]:
    res = await repo.transition_case_status(
        ctx.conn,
        case_id=case_id,
        to_status=payload.to_status,
        reason=payload.reason,
        expected_updated_at=payload.expected_updated_at,
    )
    return res


# --- Phase 3: Bureau Assignments ---------------------------------------------

@router.post(
    "/{case_id}/bureau-assignments",
    status_code=status.HTTP_201_CREATED,
    summary="Assign lead or collaborating bureau to case",
)
async def assign_bureau(
    case_id: UUID,
    payload: CaseBureauAssignRequest,
    ctx: RequestContext = Depends(require_permission(perms.CASE_ASSIGN_BUREAU)),
) -> dict[str, str]:
    assignment_id = await repo.assign_case_bureau(
        ctx.conn,
        case_id=case_id,
        bureau_id=payload.bureau_id,
        assignment_type=payload.assignment_type,
        reason=payload.reason,
    )
    return {"status": "assigned", "assignment_id": str(assignment_id)}


@operations_router.patch(
    "/bureau-assignments/{assignment_id}",
    summary="Update bureau assignment status",
)
async def update_bureau_assignment(
    assignment_id: UUID,
    payload: CaseBureauAssignUpdateRequest,
    ctx: RequestContext = Depends(require_permission(perms.CASE_ASSIGN_BUREAU)),
) -> dict[str, bool]:
    ok = await repo.update_case_bureau_assignment(
        ctx.conn,
        assignment_id=assignment_id,
        status=payload.status,
        completion_notes=payload.completion_notes,
    )
    return {"success": ok}


# --- Phase 3: Officer Assignments --------------------------------------------

@operations_router.post(
    "/bureau-assignments/{assignment_id}/officer-assignments",
    status_code=status.HTTP_201_CREATED,
    summary="Assign officer to bureau assignment",
)
async def assign_officer(
    assignment_id: UUID,
    payload: CaseOfficerAssignRequest,
    ctx: RequestContext = Depends(require_permission(perms.CASE_ASSIGN_OFFICER)),
) -> dict[str, str]:
    officer_assign_id = await repo.assign_case_officer(
        ctx.conn,
        case_bureau_assignment_id=assignment_id,
        officer_user_id=payload.officer_user_id,
        role=payload.role,
        notes=payload.notes,
    )
    return {"status": "assigned", "officer_assignment_id": str(officer_assign_id)}


@operations_router.patch(
    "/officer-assignments/{assignment_id}",
    summary="Update officer assignment status",
)
async def update_officer_assignment(
    assignment_id: UUID,
    payload: CaseOfficerAssignUpdateRequest,
    ctx: RequestContext = Depends(require_permission(perms.CASE_ASSIGN_OFFICER)),
) -> dict[str, bool]:
    ok = await repo.update_case_officer_assignment(
        ctx.conn,
        assignment_id=assignment_id,
        status=payload.status,
        notes=payload.notes,
    )
    return {"success": ok}


# --- Phase 3: Notes (Shared & Bureau-Private) --------------------------------

@router.get(
    "/{case_id}/notes",
    response_model=list[CaseNoteItem],
    summary="List internal case notes subject to visibility rules",
)
async def get_notes(
    case_id: UUID,
    ctx: RequestContext = Depends(require_permission(perms.CASE_NOTE_VIEW)),
) -> list[CaseNoteItem]:
    rows = await repo.list_case_notes(ctx.conn, case_id)
    return [CaseNoteItem.model_validate(r) for r in rows]


@router.post(
    "/{case_id}/notes",
    status_code=status.HTTP_201_CREATED,
    summary="Add shared or bureau-private note",
)
async def add_note(
    case_id: UUID,
    payload: CaseNoteCreateRequest,
    ctx: RequestContext = Depends(require_permission(perms.CASE_NOTE_CREATE)),
) -> dict[str, str]:
    note_id = await repo.create_case_note(
        ctx.conn,
        case_id=case_id,
        note_text=payload.note_text,
        visibility=payload.visibility,
        note_type=payload.note_type,
        bureau_id=payload.bureau_id,
        is_pinned=payload.is_pinned,
    )
    return {"status": "created", "note_id": str(note_id)}


@router.patch(
    "/{case_id}/notes/{note_id}",
    summary="Edit authorized case note",
)
async def edit_note(
    case_id: UUID,
    note_id: UUID,
    payload: CaseNoteUpdateRequest,
    ctx: RequestContext = Depends(require_permission(perms.CASE_NOTE_EDIT)),
) -> dict[str, bool]:
    ok = await repo.update_case_note(
        ctx.conn,
        note_id=note_id,
        note_text=payload.note_text,
        is_pinned=payload.is_pinned,
    )
    return {"success": ok}


@router.delete(
    "/{case_id}/notes/{note_id}",
    summary="Soft-delete authorized case note",
)
async def delete_note(
    case_id: UUID,
    note_id: UUID,
    ctx: RequestContext = Depends(require_permission(perms.CASE_NOTE_EDIT)),
) -> dict[str, bool]:
    ok = await repo.soft_delete_case_note(ctx.conn, note_id=note_id)
    return {"success": ok}


# --- Phase 3: Attachments & Evidence -----------------------------------------

@router.get(
    "/{case_id}/attachments",
    response_model=list[CaseAttachmentItem],
    summary="List verified attachments for case",
)
async def get_attachments(
    case_id: UUID,
    ctx: RequestContext = Depends(require_permission(perms.ATTACHMENT_VIEW)),
) -> list[CaseAttachmentItem]:
    rows = await repo.list_case_attachments(ctx.conn, case_id)
    return [CaseAttachmentItem.model_validate(r) for r in rows]


@router.post(
    "/{case_id}/attachments",
    status_code=status.HTTP_201_CREATED,
    summary="Register verified attachment on case",
)
@router.post(
    "/{case_id}/attachments/upload-intent",
    status_code=status.HTTP_201_CREATED,
    summary="Create upload intent and register attachment",
)
async def upload_attachment(
    case_id: UUID,
    payload: CaseAttachmentRegisterRequest,
    ctx: RequestContext = Depends(require_permission(perms.ATTACHMENT_UPLOAD)),
) -> dict[str, str]:
    attachment_id = await repo.register_case_attachment(
        ctx.conn,
        case_id=case_id,
        original_filename=payload.original_filename,
        storage_bucket=payload.storage_bucket,
        storage_path=payload.storage_path,
        mime_type=payload.mime_type,
        file_size_bytes=payload.file_size_bytes,
        sha256_checksum=payload.sha256_checksum,
        attachment_type=payload.attachment_type,
        description=payload.description,
    )
    return {"status": "registered", "attachment_id": str(attachment_id)}


@router.post(
    "/{case_id}/attachments/{attachment_id}/quarantine",
    summary="Quarantine suspicious case attachment",
)
async def quarantine_attachment(
    case_id: UUID,
    attachment_id: UUID,
    payload: CaseAttachmentQuarantineRequest,
    ctx: RequestContext = Depends(require_permission(perms.ATTACHMENT_QUARANTINE)),
) -> dict[str, bool]:
    ok = await repo.quarantine_case_attachment(
        ctx.conn,
        attachment_id=attachment_id,
        reason=payload.reason,
    )
    return {"success": ok}


@router.get(
    "/{case_id}/attachments/{attachment_id}/download",
    summary="Authorize and retrieve attachment download metadata / signed access",
)
async def download_attachment(
    case_id: UUID,
    attachment_id: UUID,
    ctx: RequestContext = Depends(require_permission(perms.ATTACHMENT_DOWNLOAD)),
) -> dict[str, Any]:
    file_info = await repo.get_case_attachment_for_download(
        ctx.conn,
        case_id=case_id,
        attachment_id=attachment_id,
    )
    return {
        "attachment_id": str(file_info["id"]),
        "original_filename": file_info["original_filename"],
        "storage_bucket": file_info["storage_bucket"],
        "storage_path": file_info["storage_path"],
        "mime_type": file_info["mime_type"],
        "file_size_bytes": file_info["file_size_bytes"],
        "sha256_checksum": file_info["sha256_checksum"],
        "download_url": f"/storage/v1/object/authenticated/{file_info['storage_bucket']}/{file_info['storage_path']}",
    }


# --- Phase 4: Case Transfers -------------------------------------------------

@router.post(
    "/{case_id}/transfers",
    status_code=status.HTTP_201_CREATED,
    summary="Request inter-bureau case transfer",
)
async def request_transfer(
    case_id: UUID,
    payload: CaseTransferRequest,
    ctx: RequestContext = Depends(require_permission(perms.CASE_TRANSFER_REQUEST)),
) -> dict[str, str]:
    transfer_id = await repo.request_case_transfer(
        ctx.conn,
        case_id=case_id,
        from_bureau_assignment_id=payload.from_bureau_assignment_id,
        to_bureau_id=payload.to_bureau_id,
        transfer_type=payload.transfer_type,
        reason=payload.reason,
    )
    return {"status": "requested", "transfer_id": str(transfer_id)}


@operations_router.post(
    "/transfers/{transfer_id}/decision",
    summary="Approve or reject case transfer",
)
async def decide_transfer(
    transfer_id: UUID,
    payload: CaseTransferDecisionRequest,
    ctx: RequestContext = Depends(require_permission(perms.CASE_TRANSFER_DECIDE)),
) -> dict[str, bool]:
    ok = await repo.decide_case_transfer(
        ctx.conn,
        transfer_id=transfer_id,
        decision=payload.decision,
        decision_notes=payload.decision_notes,
    )
    return {"success": ok}


# --- Phase 4: Cross-Bureau Access Requests & Grants --------------------------

@router.post(
    "/{case_id}/access-requests",
    status_code=status.HTTP_201_CREATED,
    summary="Request cross-bureau restricted case access",
)
async def request_access(
    case_id: UUID,
    payload: CaseAccessRequestCreate,
    ctx: RequestContext = Depends(require_permission(perms.CASE_ACCESS_REQUEST)),
) -> dict[str, str]:
    request_id = await repo.request_case_access(
        ctx.conn,
        case_id=case_id,
        access_level=payload.access_level,
        reason=payload.reason,
        requesting_bureau_id=payload.requesting_bureau_id,
    )
    return {"status": "requested", "request_id": str(request_id)}


@operations_router.get(
    "/access-requests",
    response_model=list[CaseAccessRequestItem],
    summary="List pending cross-bureau access requests queue",
)
async def list_access_requests(
    ctx: RequestContext = Depends(require_any_permission(perms.CASE_ACCESS_REVIEW, perms.CASE_ACCESS_APPROVE)),
    status_filter: str | None = Query(default="pending", alias="status"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[CaseAccessRequestItem]:
    rows = await repo.list_case_access_requests(
        ctx.conn,
        status=status_filter,
        limit=limit,
        offset=offset,
    )
    return [CaseAccessRequestItem.model_validate(r) for r in rows]


@operations_router.post(
    "/access-requests/{request_id}/decision",
    summary="Approve or reject cross-bureau access request",
)
async def decide_access_request(
    request_id: UUID,
    payload: CaseAccessRequestDecision,
    ctx: RequestContext = Depends(require_permission(perms.CASE_ACCESS_APPROVE)),
) -> dict[str, str | None]:
    grant_id = await repo.decide_case_access_request(
        ctx.conn,
        request_id=request_id,
        decision=payload.decision,
        decision_reason=payload.decision_reason,
        expires_at=payload.expires_at,
    )
    return {"status": "decided", "grant_id": str(grant_id) if grant_id else None}


@router.get(
    "/{case_id}/access-grants",
    response_model=list[CaseAccessGrantItem],
    summary="List active and revoked access grants for case",
)
async def list_access_grants(
    case_id: UUID,
    ctx: RequestContext = Depends(require_permission(perms.CASE_ACCESS_MANAGE)),
) -> list[CaseAccessGrantItem]:
    rows = await repo.list_case_access_grants(ctx.conn, case_id)
    return [CaseAccessGrantItem.model_validate(r) for r in rows]


@operations_router.post(
    "/access-grants/{grant_id}/revoke",
    summary="Revoke active cross-bureau access grant",
)
async def revoke_access_grant(
    grant_id: UUID,
    payload: CaseAccessGrantRevokeRequest,
    ctx: RequestContext = Depends(require_permission(perms.CASE_ACCESS_REVOKE)),
) -> dict[str, bool]:
    ok = await repo.revoke_case_access_grant(
        ctx.conn,
        grant_id=grant_id,
        revocation_reason=payload.revocation_reason,
    )
    return {"success": ok}

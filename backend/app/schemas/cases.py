"""Request/response models for Phase 2.3 canonical cases and index projections.

Cross-bureau minimal case index is separated from authorized full case detail.
Caller identity is validated via auth_uid() and active bureau memberships/grants.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


CasePriority = Literal["low", "normal", "high", "critical"]
CaseVisibility = Literal["restricted", "confidential"]


class CaseIndexItem(ApiModel):
    case_id: UUID
    case_number: str
    institution_id: UUID
    institution_name: str
    institution_region: str | None = None
    category_id: UUID | None = None
    category_name: str | None = None
    status: str
    priority: str
    lead_bureau_id: UUID | None = None
    lead_bureau_name: str | None = None
    lead_bureau_code: str | None = None
    opened_at: datetime
    closed_at: datetime | None = None
    can_view_details: bool


class CollaboratingBureau(ApiModel):
    bureau_id: UUID
    bureau_name: str
    bureau_code: str
    assignment_type: str
    assignment_status: str
    assigned_at: datetime


class RelatedCaseItem(ApiModel):
    relationship_id: UUID
    related_case_id: UUID
    related_case_number: str
    related_case_title: str
    relationship_type: str
    description: str | None = None
    created_at: datetime


class OfficerAssignmentItem(ApiModel):
    officer_assignment_id: UUID
    case_bureau_assignment_id: UUID
    bureau_name: str
    officer_user_id: UUID
    officer_name: str
    role: str
    status: str
    assigned_at: datetime


class CaseActionHistoryItem(ApiModel):
    action_id: UUID
    action_type: str
    action_description: str
    previous_status: str | None = None
    new_status: str | None = None
    actor_user_id: UUID | None = None
    created_at: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)


class CaseDetail(ApiModel):
    case_id: UUID
    case_number: str
    title: str
    description: str
    institution_id: UUID
    institution_name: str
    institution_code: str | None = None
    institution_region: str | None = None
    category_id: UUID | None = None
    category_name: str | None = None
    status: str
    priority: str
    visibility: str
    source_submission_id: UUID
    opened_at: datetime
    closed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    lead_bureau_id: UUID | None = None
    lead_bureau_name: str | None = None
    lead_bureau_code: str | None = None
    collaborating_bureaus: list[CollaboratingBureau] = Field(default_factory=list)
    officer_assignments: list[OfficerAssignmentItem] = Field(default_factory=list)
    related_cases: list[RelatedCaseItem] = Field(default_factory=list)
    action_history: list[CaseActionHistoryItem] = Field(default_factory=list)
    notes_count: int = 0
    attachments_count: int = 0


class CaseCreateRequest(ApiModel):
    submission_id: UUID
    lead_bureau_id: UUID
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=5, max_length=10000)
    priority: CasePriority = "normal"
    visibility: CaseVisibility = "restricted"
    expected_submission_updated_at: datetime


class CaseStatusTransitionRequest(ApiModel):
    to_status: str = Field(min_length=1, max_length=50)
    reason: str = Field(min_length=3, max_length=1000)
    expected_updated_at: datetime | None = None


class CaseBureauAssignRequest(ApiModel):
    bureau_id: UUID
    assignment_type: Literal["lead", "collaborating"] = "collaborating"
    reason: str | None = Field(default=None, max_length=1000)


class CaseBureauAssignUpdateRequest(ApiModel):
    status: Literal["active", "completed", "cancelled"]
    completion_notes: str | None = Field(default=None, max_length=1000)


class CaseOfficerAssignRequest(ApiModel):
    officer_user_id: UUID
    role: Literal["lead_officer", "supporting", "reviewer"] = "supporting"
    notes: str | None = Field(default=None, max_length=1000)


class CaseOfficerAssignUpdateRequest(ApiModel):
    status: Literal["active", "completed", "revoked"]
    notes: str | None = Field(default=None, max_length=1000)


class CaseNoteItem(ApiModel):
    note_id: UUID
    case_id: UUID
    author_user_id: UUID
    author_name: str
    bureau_id: UUID | None = None
    bureau_name: str | None = None
    bureau_code: str | None = None
    note_text: str
    visibility: Literal["shared", "bureau_private"]
    note_type: Literal["general", "internal_review", "resolution", "handover"]
    is_pinned: bool = False
    edited_at: datetime | None = None
    created_at: datetime


class CaseNoteCreateRequest(ApiModel):
    note_text: str = Field(min_length=1, max_length=10000)
    visibility: Literal["shared", "bureau_private"] = "shared"
    note_type: Literal["general", "internal_review", "resolution", "handover"] = "general"
    bureau_id: UUID | None = None
    is_pinned: bool = False


class CaseNoteUpdateRequest(ApiModel):
    note_text: str = Field(min_length=1, max_length=10000)
    is_pinned: bool = False


class CaseAttachmentItem(ApiModel):
    attachment_id: UUID
    case_id: UUID | None = None
    submission_id: UUID | None = None
    uploaded_by_user_id: UUID | None = None
    uploader_name: str | None = None
    original_filename: str
    storage_bucket: str
    storage_path: str
    mime_type: str
    file_size_bytes: int
    sha256_checksum: str | None = None
    attachment_type: str
    upload_status: str
    description: str | None = None
    uploaded_at: datetime
    verified_at: datetime | None = None


ALLOWED_ATTACHMENT_MIME_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
}
MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024  # 25MB


class CaseAttachmentRegisterRequest(ApiModel):
    original_filename: str = Field(min_length=1, max_length=255)
    storage_bucket: str = "complaint-evidence"
    storage_path: str = Field(min_length=1, max_length=500)
    mime_type: str = Field(min_length=1, max_length=100)
    file_size_bytes: int = Field(gt=0, le=MAX_ATTACHMENT_SIZE_BYTES)
    sha256_checksum: str | None = None
    attachment_type: Literal["original_submission", "supporting_document", "evidence", "response", "resolution_document"] = "supporting_document"
    description: str | None = None

    @field_validator("mime_type")
    @classmethod
    def validate_mime(cls, v: str) -> str:
        clean = v.strip().lower()
        if clean not in ALLOWED_ATTACHMENT_MIME_TYPES:
            raise ValueError(f"MIME type '{v}' is not permitted. Allowed: {sorted(ALLOWED_ATTACHMENT_MIME_TYPES)}")
        return clean


class CaseAttachmentQuarantineRequest(ApiModel):
    reason: str = Field(min_length=3, max_length=500)


class CaseTransferItem(ApiModel):
    transfer_id: UUID
    case_id: UUID
    from_bureau_assignment_id: UUID | None = None
    to_bureau_assignment_id: UUID | None = None
    transfer_type: str
    transfer_status: str
    transfer_reason: str
    initiated_by_user_id: UUID
    initiated_at: datetime
    decided_by_user_id: UUID | None = None
    decided_at: datetime | None = None
    completed_at: datetime | None = None
    decision_notes: str | None = None


class CaseTransferRequest(ApiModel):
    from_bureau_assignment_id: UUID
    to_bureau_id: UUID
    transfer_type: Literal["handover", "lead_change", "reassignment"] = "handover"
    reason: str = Field(min_length=3, max_length=1000)


class CaseTransferDecisionRequest(ApiModel):
    decision: Literal["approved", "rejected", "cancelled"]
    decision_notes: str | None = Field(default=None, max_length=1000)


class CaseAccessRequestItem(ApiModel):
    request_id: UUID
    case_id: UUID
    case_number: str
    institution_name: str
    requester_user_id: UUID
    requester_name: str
    requesting_bureau_id: UUID | None = None
    requesting_bureau_name: str | None = None
    requested_access_level: str
    request_reason: str
    request_status: str
    requested_at: datetime
    reviewed_by_user_id: UUID | None = None
    reviewed_at: datetime | None = None
    decision_reason: str | None = None


class CaseAccessRequestCreate(ApiModel):
    access_level: Literal["details", "collaborate"] = "details"
    reason: str = Field(min_length=3, max_length=1000)
    requesting_bureau_id: UUID | None = None


class CaseAccessRequestDecision(ApiModel):
    decision: Literal["approved", "rejected"]
    decision_reason: str = Field(min_length=3, max_length=1000)
    expires_at: datetime | None = None


class CaseAccessGrantItem(ApiModel):
    grant_id: UUID
    case_id: UUID
    grantee_user_id: UUID
    grantee_name: str
    access_request_id: UUID | None = None
    access_level: str
    grant_reason: str
    granted_by_user_id: UUID
    granted_by_name: str
    granted_at: datetime
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    revoked_by_user_id: UUID | None = None
    revocation_reason: str | None = None
    is_active: bool


class CaseAccessGrantRevokeRequest(ApiModel):
    revocation_reason: str = Field(min_length=3, max_length=1000)


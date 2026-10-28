"""Request/response models for Phase 2.2 institution verification.

The verification surface intentionally exposes provenance and workflow metadata
only. Complaint subject text and body text never appear here; those remain
behind the separate ``submission.view`` surface.

``candidate_institution_id`` and the candidate list are advisory evidence. They
are never treated as a decision: every command requires the reviewer to name the
institution explicitly and to give a reason.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

VerificationTaskStatus = Literal["pending", "in_review", "verified", "rejected"]
VerificationPriority = Literal["low", "normal", "high", "critical"]
VerificationRoundType = Literal["new_round", "correction"]
VerificationAction = Literal[
    "confirm", "reject", "request_information", "assign_to_me", "unassign"
]


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class VerificationSubmissionRef(ApiModel):
    id: UUID
    channel_code: str
    channel_name: str
    channel_is_simulated: bool
    external_reference: str | None = None
    source_event_id: str | None = None
    received_at: datetime
    updated_at: datetime
    intake_status: str
    original_language: str
    institution_name_as_submitted: str | None = None
    submitted_permanent_id: str | None = None
    institution_id: UUID | None = None
    institution_official_name: str | None = None
    institution_permanent_id: str | None = None
    canonical_case_id: UUID | None = None


class VerificationTask(ApiModel):
    id: UUID
    status: VerificationTaskStatus
    priority: VerificationPriority
    submitted_institution_name: str
    submitted_permanent_id: str | None = None
    # Advisory evidence only. Never used as an implicit decision.
    candidate_institution_id: UUID | None = None
    candidate_count: int = 0
    strongest_evidence: str | None = None
    assigned_to_user_id: UUID | None = None
    assigned_to_name: str | None = None
    reviewed_by_user_id: UUID | None = None
    reviewed_by_name: str | None = None
    resolved_institution_id: UUID | None = None
    resolved_institution_name: str | None = None
    resolution_notes: str | None = None
    resolved_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    age_days: int
    round_type: VerificationRoundType
    requester_user_id: UUID | None = None
    submission: VerificationSubmissionRef

    @model_validator(mode="after")
    def _resolved_task_has_reviewer(self) -> "VerificationTask":
        if self.status in {"verified", "rejected"}:
            if self.reviewed_by_user_id is None or self.resolved_at is None:
                raise ValueError("a resolved task must carry a reviewer and a resolution time")
        return self


class VerificationCandidate(ApiModel):
    institution_id: UUID
    official_name: str
    permanent_id: str | None = None
    region_code: str | None = None
    region_name: str | None = None
    verification_status: str
    is_active: bool
    evidence: list[str]
    matched_alias_id: UUID | None = None
    matched_alias_name: str | None = None
    evidence_rank: int
    is_eligible: bool


class VerificationCandidateList(ApiModel):
    data: list[VerificationCandidate]
    request_id: str


class VerificationDecision(BaseModel):
    action: VerificationAction
    institution_id: UUID | None = None
    reason: str | None = Field(default=None, max_length=2000)
    expected_updated_at: datetime | None = None

    @field_validator("reason")
    @classmethod
    def _reason_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value.strip():
            raise ValueError("must not be blank")
        return value

    @model_validator(mode="after")
    def _action_fields(self) -> "VerificationDecision":
        if self.action == "confirm":
            if self.institution_id is None:
                raise ValueError("confirming requires an explicit institution_id")
            if not (self.reason or "").strip():
                raise ValueError("confirming requires a reason")
        elif self.action == "reject":
            if self.institution_id is not None:
                raise ValueError("a rejection cannot carry an institution_id")
            if not (self.reason or "").strip():
                raise ValueError("rejecting requires a reason")
        elif self.action == "request_information":
            if not (self.reason or "").strip():
                raise ValueError("requesting information requires a reason")
        return self


class CorrectionRoundCreate(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)
    expected_submission_updated_at: datetime | None = None

    @field_validator("reason")
    @classmethod
    def _reason_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be blank")
        return value

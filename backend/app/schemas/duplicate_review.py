"""Request/response models for Phase 2.3 duplicate review and decisions.

Submissions do not carry an approved bureau ownership model; duplicate review
operations are scoped to global DUPLICATE.REVIEW capability.
All decisions require explicit human judgment and justification notes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


DuplicateCandidateStatus = Literal["pending", "confirmed_duplicate", "not_duplicate", "related"]
DuplicateDecisionAction = Literal["confirmed_duplicate", "not_duplicate", "related"]


class DuplicateCandidateQueueItem(ApiModel):
    candidate_id: UUID
    submission_id: UUID
    candidate_case_id: UUID
    case_number: str
    institution_id: UUID | None = None
    institution_name: str | None = None
    similarity_score: float
    matching_method: str
    matching_signals: dict[str, Any] = Field(default_factory=dict)
    review_status: DuplicateCandidateStatus
    reviewed_at: datetime | None = None
    reviewer_user_id: UUID | None = None
    review_notes: str | None = None
    candidate_created_at: datetime
    candidate_updated_at: datetime
    submission_updated_at: datetime
    submission_subject: str
    submission_received_at: datetime


class DuplicateCandidateDetail(ApiModel):
    candidate_id: UUID
    submission_id: UUID
    submission_subject: str
    submission_body: str
    submission_category_id: UUID | None = None
    submission_category_name: str | None = None
    submission_institution_id: UUID | None = None
    submission_institution_name: str | None = None
    submission_updated_at: datetime
    candidate_case_id: UUID
    case_number: str
    case_title: str
    case_status: str
    case_category_id: UUID | None = None
    case_category_name: str | None = None
    case_created_at: datetime
    case_lead_bureau_id: UUID | None = None
    case_lead_bureau_name: str | None = None
    similarity_score: float
    matching_method: str
    matching_signals: dict[str, Any] = Field(default_factory=dict)
    review_status: DuplicateCandidateStatus
    reviewed_at: datetime | None = None
    reviewer_user_id: UUID | None = None
    review_notes: str | None = None
    candidate_created_at: datetime
    candidate_updated_at: datetime


class DuplicateDecisionRequest(ApiModel):
    action: DuplicateDecisionAction
    notes: str = Field(min_length=3, max_length=2000)
    expected_submission_updated_at: datetime
    expected_candidate_updated_at: datetime


class DuplicateScreenRequest(ApiModel):
    submission_id: UUID
    expected_submission_updated_at: datetime


class IntakeSubmissionRejectRequest(ApiModel):
    reason: str = Field(min_length=3, max_length=2000)
    expected_submission_updated_at: datetime

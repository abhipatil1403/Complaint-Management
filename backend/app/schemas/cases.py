"""Request/response models for Phase 2.3 canonical cases and index projections.

Cross-bureau minimal case index is separated from authorized full case detail.
Caller identity is validated via auth_uid() and active bureau memberships/grants.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


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
    related_cases: list[RelatedCaseItem] = Field(default_factory=list)
    action_history: list[CaseActionHistoryItem] = Field(default_factory=list)


class CaseCreateRequest(ApiModel):
    submission_id: UUID
    lead_bureau_id: UUID
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=5, max_length=10000)
    priority: CasePriority = "normal"
    visibility: CaseVisibility = "restricted"
    expected_submission_updated_at: datetime

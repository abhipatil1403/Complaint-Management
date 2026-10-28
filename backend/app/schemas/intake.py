"""Request/response models for Phase 2.1 simulated intake.

The API mirrors the database function's validation so callers get a useful
error, but the database remains the enforcement point: every rule below is
also checked in SQL. Complaint text is stored exactly as submitted; nothing in
this module trims, translates or normalises it.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

OriginalLanguage = Literal["en", "hi"]
IntakeOutcome = Literal["created", "replay"]


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class IntakeChannelRef(ApiModel):
    code: str
    name: str
    is_simulated: bool


class InstitutionRef(ApiModel):
    id: UUID
    aicte_permanent_id: str | None = None
    official_name: str


class DemoSubmissionCreate(BaseModel):
    """Body of the public simulated submissions endpoint.

    ``subject`` and ``description`` are deliberately not stripped: the original
    text is preserved exactly (FR-INT-002). Blank-only values are rejected by
    both this model and the database function.
    """

    institution_permanent_id: str | None = Field(default=None, max_length=64)
    institution_name_as_submitted: str | None = Field(default=None, max_length=300)
    subject: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=20000)
    language: OriginalLanguage = "en"
    category_code: str | None = Field(default=None, max_length=64)
    source_event_id: str | None = Field(default=None, max_length=64)
    source_submitted_at: datetime | None = None
    consent_acknowledged: Literal[True]

    @field_validator("subject", "description")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        # Whitespace-only text is not a complaint. The value itself is never
        # trimmed: leading/trailing whitespace is preserved for the record.
        if not value.strip():
            raise ValueError("must not be blank")
        return value

    @model_validator(mode="after")
    def _institution_identifier(self) -> "DemoSubmissionCreate":
        has_id = bool((self.institution_permanent_id or "").strip())
        has_name = bool((self.institution_name_as_submitted or "").strip())
        if not has_id and not has_name:
            raise ValueError(
                "provide institution_permanent_id or institution_name_as_submitted"
            )
        return self

    @field_validator("source_submitted_at")
    @classmethod
    def _require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return value
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("must include a UTC offset, for example 2026-10-20T10:25:00+05:30")
        return value.astimezone(timezone.utc)


class DemoSubmissionReceipt(ApiModel):
    outcome: IntakeOutcome
    replayed: bool
    submission_id: UUID
    external_reference: str | None = None
    intake_status: str
    received_at: datetime
    institution_resolved: bool
    channel: IntakeChannelRef
    demo_notice: str
    simulation_notice_version: str


class SubmissionSummary(ApiModel):
    id: UUID
    external_reference: str | None = None
    source_event_id: str | None = None
    channel: IntakeChannelRef
    received_at: datetime
    institution: InstitutionRef | None = None
    institution_name_as_submitted: str | None = None
    subject: str
    original_language: str
    intake_status: str
    canonical_case_id: UUID | None = None


class SubmissionDetail(SubmissionSummary):
    original_text: str
    content_fingerprint: str | None = None
    source_submitted_at: str | None = None
    reference_origin: str | None = None
    simulation_notice_version: str | None = None
    consent_acknowledged: bool | None = None
    created_at: datetime

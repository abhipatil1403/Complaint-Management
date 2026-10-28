"""Request/response models for Phase 1 reference data."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

VerificationStatus = Literal["pending", "verified", "rejected"]
AliasSourceType = Literal["manual", "official_record", "complaint_submission", "import"]
AliasType = Literal["alternate_name", "former_name", "abbreviation", "spelling_variant", "submitted_name"]
BureauType = Literal["bureau", "cell", "division", "unit"]
MembershipType = Literal["member", "coordinator", "head"]


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Regions
# ---------------------------------------------------------------------------
class RegionOut(ApiModel):
    id: UUID
    code: str
    name: str
    description: str | None = None
    is_active: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None


class RegionCreate(BaseModel):
    code: str = Field(min_length=2, max_length=32)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def _upper_code(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("name")
    @classmethod
    def _trim_name(cls, value: str) -> str:
        return value.strip()


class RegionUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=2, max_length=32)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def _upper_code(cls, value: str | None) -> str | None:
        return value.strip().upper() if value else value


# ---------------------------------------------------------------------------
# Institutions
# ---------------------------------------------------------------------------
class RegionRef(ApiModel):
    id: UUID
    code: str
    name: str


class InstitutionSummary(ApiModel):
    id: UUID
    aicte_permanent_id: str | None = None
    official_name: str
    verification_status: VerificationStatus
    is_active: bool
    region: RegionRef | None = None


class InstitutionDetail(InstitutionSummary):
    institution_type: str | None = None
    ownership_type: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    district: str | None = None
    state_name: str | None = None
    postal_code: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    website_url: str | None = None
    verification_source: str | None = None
    verification_reference: str | None = None
    verified_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class InstitutionCreate(BaseModel):
    official_name: str = Field(min_length=2, max_length=300)
    aicte_permanent_id: str | None = Field(default=None, max_length=64)
    institution_type: str | None = Field(default=None, max_length=80)
    ownership_type: str | None = Field(default=None, max_length=80)
    address_line1: str | None = Field(default=None, max_length=200)
    address_line2: str | None = Field(default=None, max_length=200)
    city: str | None = Field(default=None, max_length=120)
    district: str | None = Field(default=None, max_length=120)
    state_name: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, pattern=r"^[0-9]{6}$")
    region_id: UUID | None = None
    contact_email: str | None = Field(default=None, max_length=254)
    contact_phone: str | None = Field(default=None, max_length=32)
    website_url: str | None = Field(default=None, max_length=500)
    verification_status: Literal["pending", "verified"] = "pending"
    verification_source: str | None = Field(default=None, max_length=200)
    is_active: bool = True

    @field_validator("official_name")
    @classmethod
    def _trim(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def _verified_needs_evidence(self) -> "InstitutionCreate":
        if self.verification_status == "verified":
            if not self.aicte_permanent_id or not self.aicte_permanent_id.strip():
                raise ValueError("A verified institution requires an AICTE Permanent ID.")
            if not self.verification_source or not self.verification_source.strip():
                raise ValueError("A verified institution requires a verification source.")
        return self


class InstitutionUpdate(BaseModel):
    official_name: str | None = Field(default=None, min_length=2, max_length=300)
    aicte_permanent_id: str | None = Field(default=None, max_length=64)
    institution_type: str | None = Field(default=None, max_length=80)
    ownership_type: str | None = Field(default=None, max_length=80)
    address_line1: str | None = Field(default=None, max_length=200)
    address_line2: str | None = Field(default=None, max_length=200)
    city: str | None = Field(default=None, max_length=120)
    district: str | None = Field(default=None, max_length=120)
    state_name: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, pattern=r"^[0-9]{6}$")
    region_id: UUID | None = None
    contact_email: str | None = Field(default=None, max_length=254)
    contact_phone: str | None = Field(default=None, max_length=32)
    website_url: str | None = Field(default=None, max_length=500)
    verification_status: VerificationStatus | None = None
    verification_source: str | None = Field(default=None, max_length=200)
    verification_reference: str | None = Field(default=None, max_length=300)
    is_active: bool | None = None


# ---------------------------------------------------------------------------
# Institution aliases
# ---------------------------------------------------------------------------
class AliasOut(ApiModel):
    id: UUID
    institution_id: UUID
    alias_name: str
    normalized_alias: str
    language_code: str
    alias_type: AliasType
    source_type: AliasSourceType
    source_reference: str | None = None
    verification_status: VerificationStatus
    is_active: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AliasCreate(BaseModel):
    alias_name: str = Field(min_length=1, max_length=300)
    language_code: str = Field(default="en", min_length=2, max_length=10)
    alias_type: AliasType = "alternate_name"
    source_type: AliasSourceType
    source_reference: str | None = Field(default=None, max_length=300)

    @field_validator("alias_name")
    @classmethod
    def _trim(cls, value: str) -> str:
        return " ".join(value.split())

    @model_validator(mode="after")
    def _provenance_required(self) -> "AliasCreate":
        if self.source_type != "manual" and not (self.source_reference or "").strip():
            raise ValueError("A source reference is required for non-manual alias provenance.")
        return self


# ---------------------------------------------------------------------------
# Bureaus and memberships
# ---------------------------------------------------------------------------
class BureauOut(ApiModel):
    id: UUID
    code: str
    name: str
    description: str | None = None
    parent_bureau_id: UUID | None = None
    bureau_type: BureauType
    is_active: bool
    display_order: int
    created_at: datetime | None = None
    updated_at: datetime | None = None


class BureauCreate(BaseModel):
    code: str = Field(min_length=2, max_length=32)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    parent_bureau_id: UUID | None = None
    bureau_type: BureauType = "bureau"
    display_order: int = Field(default=0, ge=0, le=1000)
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def _upper_code(cls, value: str) -> str:
        return value.strip().upper()


class BureauUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=2, max_length=32)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=1000)
    parent_bureau_id: UUID | None = None
    bureau_type: BureauType | None = None
    display_order: int | None = Field(default=None, ge=0, le=1000)
    is_active: bool | None = None

    @field_validator("code")
    @classmethod
    def _upper_code(cls, value: str | None) -> str | None:
        return value.strip().upper() if value else value


class BureauMemberOut(ApiModel):
    membership_id: UUID
    user_id: UUID
    bureau_id: UUID
    full_name: str
    official_email: str
    designation: str | None = None
    membership_type: MembershipType
    membership_status: Literal["active", "inactive"]
    is_primary: bool
    joined_at: datetime | None = None
    ended_at: datetime | None = None


class MembershipCreate(BaseModel):
    user_id: UUID
    bureau_id: UUID
    membership_type: MembershipType = "member"
    is_primary: bool = False

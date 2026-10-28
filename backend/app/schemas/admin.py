"""Request/response models for user, role and membership administration."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

AccountStatus = Literal["active", "inactive", "suspended"]


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class RoleBrief(ApiModel):
    role_code: str
    role_name: str
    scope_type: str
    bureau_id: UUID | None = None
    bureau_name: str | None = None


class UserSummary(ApiModel):
    id: UUID
    employee_code: str | None = None
    full_name: str
    display_name: str | None = None
    official_email: str
    designation: str | None = None
    account_status: AccountStatus
    roles: list[RoleBrief] = Field(default_factory=list)


class MembershipBrief(ApiModel):
    id: UUID
    bureau_id: UUID
    bureau_code: str
    bureau_name: str
    membership_type: str
    membership_status: str
    is_primary: bool
    joined_at: datetime | None = None
    ended_at: datetime | None = None


class RoleAssignmentDetail(ApiModel):
    id: UUID
    role_code: str
    role_name: str
    scope_type: str
    bureau_id: UUID | None = None
    bureau_code: str | None = None
    bureau_name: str | None = None
    assignment_status: str
    assigned_at: datetime | None = None
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    revocation_reason: str | None = None


class UserDetail(UserSummary):
    memberships: list[MembershipBrief] = Field(default_factory=list)
    role_assignments: list[RoleAssignmentDetail] = Field(default_factory=list)


class RoleOut(ApiModel):
    id: UUID
    code: str
    name: str
    description: str | None = None
    scope_type: str
    is_system_role: bool
    is_active: bool
    permissions: list[str] = Field(default_factory=list)


class RoleAssignRequest(BaseModel):
    role_code: str = Field(min_length=2, max_length=64)
    bureau_id: UUID | None = None
    expires_at: datetime | None = None

    @field_validator("role_code")
    @classmethod
    def _upper_code(cls, value: str) -> str:
        return value.strip().upper()


class RoleRevokeRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("reason")
    @classmethod
    def _trim(cls, value: str) -> str:
        return value.strip()


class AccountStatusUpdate(BaseModel):
    account_status: AccountStatus


class UserProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    display_name: str | None = Field(default=None, max_length=200)
    employee_code: str | None = Field(default=None, max_length=64)
    designation: str | None = Field(default=None, max_length=120)
    phone_number: str | None = Field(default=None, max_length=32)

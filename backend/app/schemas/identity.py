"""Response/request models for the current-user endpoints."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class MeUser(ApiModel):
    id: UUID
    full_name: str
    display_name: str | None = None
    official_email: str
    designation: str | None = None
    employee_code: str | None = None
    account_status: str


class MeRole(ApiModel):
    role_code: str
    role_name: str
    scope_type: str
    bureau_id: UUID | None = None
    bureau_name: str | None = None
    permissions: list[str]


class MeMembership(ApiModel):
    bureau_id: UUID
    bureau_code: str
    bureau_name: str
    membership_type: str
    is_primary: bool


class MeResponse(ApiModel):
    user: MeUser
    roles: list[MeRole]
    memberships: list[MeMembership]
    active_bureau_id: UUID | None = None
    permissions: list[str] = Field(default_factory=list)
    global_permissions: list[str] = Field(default_factory=list)
    is_super_admin: bool = False
    demo_mode: bool
    demo_notice: str


class PermissionsResponse(ApiModel):
    active_bureau_id: UUID | None = None
    permissions: list[str]
    global_permissions: list[str]


class ActiveBureauRequest(BaseModel):
    bureau_id: UUID


class ActiveBureauResponse(ApiModel):
    active_bureau_id: UUID
    bureau_code: str
    bureau_name: str
    permissions: list[str]


class DemoChannelInfo(ApiModel):
    code: str
    name: str
    channel_type: str
    portal: str
    is_simulated: bool = True


class DemoInfo(ApiModel):
    demo_mode: bool
    notice: str
    phase: str = "Phase 2.1 - Simulated complaint intake"
    demo_intake_enabled: bool = False
    channels: list[DemoChannelInfo] = Field(default_factory=list)
    simulation_notice_version: str | None = None
    simulation_notice_en: str | None = None
    simulation_notice_hi: str | None = None

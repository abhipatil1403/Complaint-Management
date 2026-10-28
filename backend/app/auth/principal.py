"""Authenticated principal resolved from Supabase Auth plus the application tables."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping
from uuid import UUID

from app.auth import permissions as perms


@dataclass(frozen=True)
class RoleAssignment:
    assignment_id: UUID
    role_code: str
    role_name: str
    scope_type: str
    bureau_id: UUID | None
    bureau_name: str | None
    permissions: frozenset[str]

    @property
    def is_global(self) -> bool:
        # A bureau-scoped role is never global, even if a bad row has a null
        # bureau_id. PostgreSQL's validate_user_role_assignment trigger rejects
        # that shape, but the API must fail closed on its own.
        return self.scope_type == "global" and self.bureau_id is None


@dataclass(frozen=True)
class BureauMembership:
    membership_id: UUID
    bureau_id: UUID
    bureau_code: str
    bureau_name: str
    membership_type: str
    is_primary: bool


@dataclass(frozen=True)
class Principal:
    user_id: UUID
    full_name: str
    display_name: str | None
    official_email: str
    designation: str | None
    employee_code: str | None
    account_status: str
    roles: tuple[RoleAssignment, ...] = ()
    memberships: tuple[BureauMembership, ...] = ()
    global_permissions: frozenset[str] = field(default_factory=frozenset)
    bureau_permissions: Mapping[UUID, frozenset[str]] = field(default_factory=dict)

    # -- role helpers ----------------------------------------------------
    @property
    def role_codes(self) -> tuple[str, ...]:
        return tuple(assignment.role_code for assignment in self.roles)

    @property
    def is_super_admin(self) -> bool:
        """Derived from the explicit global SUPER_ADMIN role.

        The denormalised ``users.is_super_admin`` column is deliberately not
        used for authorization, and Super Admin is not a content-access bypass.
        """
        return any(
            assignment.role_code == perms.SUPER_ADMIN and assignment.is_global
            for assignment in self.roles
        )

    # -- bureau helpers --------------------------------------------------
    def membership(self, bureau_id: UUID) -> BureauMembership | None:
        for membership in self.memberships:
            if membership.bureau_id == bureau_id:
                return membership
        return None

    def is_member(self, bureau_id: UUID) -> bool:
        return self.membership(bureau_id) is not None

    def permissions_for(self, active_bureau_id: UUID | None = None) -> frozenset[str]:
        granted = set(self.global_permissions)
        if active_bureau_id is not None:
            granted |= set(self.bureau_permissions.get(active_bureau_id, frozenset()))
        return frozenset(granted)

    def has_permission(self, api_code: str, active_bureau_id: UUID | None = None) -> bool:
        return api_code in self.permissions_for(active_bureau_id)

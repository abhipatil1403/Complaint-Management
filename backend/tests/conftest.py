"""Test doubles for persona-based authorization tests.

No database is required for most tests: the request context dependency is fed
by a fake verifier and a fake identity service, and repository functions are
patched per test. Database reality (RLS) is covered by tests/test_rls_db.py,
which runs only when DATABASE_URL is configured.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.auth import permissions as perms
from app.auth.principal import BureauMembership, Principal, RoleAssignment
from app.auth.service import IdentityError
from app.core.config import Settings
from app.core.security import TokenClaims, TokenVerificationError
from app.main import create_app

RB_ID = UUID("11111111-1111-1111-1111-111111111111")
PGRC_ID = UUID("22222222-2222-2222-2222-222222222222")
UNRELATED_ID = UUID("33333333-3333-3333-3333-333333333333")

SUPER_ID = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
RB_ADMIN_ID = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
PGRC_OFFICER_ID = UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")
COLLABORATOR_ID = UUID("dddddddd-dddd-dddd-dddd-dddddddddddd")
SENIOR_ID = UUID("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee")
AUDITOR_ID = UUID("ffffffff-ffff-ffff-ffff-ffffffffffff")
INACTIVE_ID = UUID("99999999-9999-9999-9999-999999999999")
UNPROVISIONED_ID = UUID("88888888-8888-8888-8888-888888888888")

ALL_PHASE1 = frozenset(perms.PHASE1_PERMISSIONS)


def role_permissions(role_code: str) -> frozenset[str]:
    """Test personas must mirror the catalogue exactly, or they prove nothing."""
    return frozenset(perms.ROLE_DEFINITIONS[role_code]["permissions"])


READ_ONLY = role_permissions(perms.SENIOR_MANAGEMENT)
BUREAU_READ = role_permissions(perms.CASE_OFFICER)


def _membership(user_id: UUID, bureau_id: UUID, code: str, name: str) -> BureauMembership:
    return BureauMembership(
        membership_id=uuid4(),
        bureau_id=bureau_id,
        bureau_code=code,
        bureau_name=name,
        membership_type="member",
        is_primary=True,
    )


def _role(code: str, name: str, permission_codes: frozenset[str], bureau_id: UUID | None) -> RoleAssignment:
    return RoleAssignment(
        assignment_id=uuid4(),
        role_code=code,
        role_name=name,
        scope_type="global" if bureau_id is None else "bureau",
        bureau_id=bureau_id,
        bureau_name=None,
        permissions=permission_codes,
    )


def build_personas() -> dict[UUID, Principal]:
    super_admin = Principal(
        user_id=SUPER_ID,
        full_name="Demo Super Admin",
        display_name="Super Admin",
        official_email="super.admin@demo.invalid",
        designation="System administrator",
        employee_code="DEMO-0001",
        account_status="active",
        roles=(_role(perms.SUPER_ADMIN, "Super Admin", ALL_PHASE1, None),),
        memberships=(),
        global_permissions=ALL_PHASE1,
        bureau_permissions={},
    )
    rb_admin = Principal(
        user_id=RB_ADMIN_ID,
        full_name="Demo RB Administrator",
        display_name=None,
        official_email="rb.admin@demo.invalid",
        designation="Bureau administrator",
        employee_code="DEMO-0002",
        account_status="active",
        roles=(_role(perms.BUREAU_ADMIN, "Bureau Administrator", role_permissions(perms.BUREAU_ADMIN), RB_ID),),
        memberships=(_membership(RB_ADMIN_ID, RB_ID, "RB", "Regulation Bureau"),),
        global_permissions=frozenset(),
        bureau_permissions={RB_ID: role_permissions(perms.BUREAU_ADMIN)},
    )
    pgrcc_officer = Principal(
        user_id=PGRC_OFFICER_ID,
        full_name="Demo PGRC Officer",
        display_name=None,
        official_email="pgrc.officer@demo.invalid",
        designation="Case officer",
        employee_code="DEMO-0003",
        account_status="active",
        roles=(_role(perms.CASE_OFFICER, "Case Officer", role_permissions(perms.CASE_OFFICER), PGRC_ID),),
        memberships=(_membership(PGRC_OFFICER_ID, PGRC_ID, "PGRC", "Public Grievance Redressal Cell"),),
        global_permissions=frozenset(),
        bureau_permissions={PGRC_ID: role_permissions(perms.CASE_OFFICER)},
    )
    collaborator = Principal(
        user_id=COLLABORATOR_ID,
        full_name="Demo Cross-bureau Collaborator",
        display_name=None,
        official_email="collaborator@demo.invalid",
        designation="Coordinator",
        employee_code="DEMO-0004",
        account_status="active",
        roles=(_role(perms.CROSS_BUREAU_COLLABORATOR, "Cross-bureau collaborator", role_permissions(perms.CROSS_BUREAU_COLLABORATOR), RB_ID),),
        memberships=(_membership(COLLABORATOR_ID, RB_ID, "RB", "Regulation Bureau"),),
        global_permissions=frozenset(),
        bureau_permissions={RB_ID: role_permissions(perms.CROSS_BUREAU_COLLABORATOR)},
    )
    senior = Principal(
        user_id=SENIOR_ID,
        full_name="Demo Senior Management",
        display_name=None,
        official_email="senior@demo.invalid",
        designation="Director",
        employee_code="DEMO-0005",
        account_status="active",
        roles=(_role(perms.SENIOR_MANAGEMENT, "Senior Management", READ_ONLY, None),),
        memberships=(),
        global_permissions=READ_ONLY,
        bureau_permissions={},
    )
    auditor = Principal(
        user_id=AUDITOR_ID,
        full_name="Demo Auditor",
        display_name=None,
        official_email="auditor@demo.invalid",
        designation="Auditor",
        employee_code="DEMO-0006",
        account_status="active",
        roles=(_role(perms.AUDITOR, "Auditor", READ_ONLY, None),),
        memberships=(),
        global_permissions=READ_ONLY,
        bureau_permissions={},
    )
    return {
        SUPER_ID: super_admin,
        RB_ADMIN_ID: rb_admin,
        PGRC_OFFICER_ID: pgrcc_officer,
        COLLABORATOR_ID: collaborator,
        SENIOR_ID: senior,
        AUDITOR_ID: auditor,
    }


class FakeDatabase:
    def __init__(self) -> None:
        self.configured = True
        self.connected = True
        self.last_claims: dict[str, Any] = {}

    async def open(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def ready(self) -> bool:
        return True

    @asynccontextmanager
    async def session(self, claims: dict[str, Any] | None = None):
        self.last_claims = dict(claims or {})
        yield object()


class FakeVerifier:
    """Maps test tokens to users; mirrors the real verifier's failure modes."""

    def __init__(self, personas: dict[UUID, Principal]) -> None:
        self._personas = personas

    def verify(self, token: str) -> TokenClaims:
        if token == "expired":
            raise TokenVerificationError("TOKEN_EXPIRED", "The access token has expired.")
        if token == "service-role":
            raise TokenVerificationError("INVALID_TOKEN", "The access token role is not accepted.")
        try:
            user_id = UUID(token)
        except ValueError as exc:
            raise TokenVerificationError("INVALID_TOKEN", "The access token is not valid.") from exc
        return TokenClaims(
            subject=str(user_id),
            email="demo@demo.invalid",
            role="authenticated",
            claims={"sub": str(user_id), "role": "authenticated", "aud": "authenticated"},
        )


class FakeIdentityService:
    def __init__(self, personas: dict[UUID, Principal]) -> None:
        self._personas = personas

    async def load(self, conn: Any, user_id: UUID) -> Principal:
        if user_id == INACTIVE_ID:
            raise IdentityError("ACCOUNT_INACTIVE", "This AICTE OneDesk account is not active.")
        if user_id == UNPROVISIONED_ID or user_id not in self._personas:
            raise IdentityError(
                "ACCOUNT_NOT_PROVISIONED",
                "No AICTE OneDesk profile is linked to this sign-in. Contact an administrator.",
            )
        return self._personas[user_id]


def build_test_app() -> TestClient:
    settings = Settings(
        app_env="test",
        demo_mode=True,
        database_url="postgresql://test-invalid/test",
        supabase_jwt_secret="test-secret-not-used",
        cors_origins="http://localhost:5173",
    )
    app = create_app(settings)
    personas = build_personas()
    app.state.db = FakeDatabase()
    app.state.token_verifier = FakeVerifier(personas)
    app.state.identity_service = FakeIdentityService(personas)
    return TestClient(app)


@pytest.fixture()
def personas() -> dict[UUID, Principal]:
    return build_personas()


@pytest.fixture()
def client() -> TestClient:
    with build_test_app() as test_client:
        yield test_client


def auth_headers(user_id: UUID, bureau_id: UUID | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {user_id}"}
    if bureau_id is not None:
        headers["X-Active-Bureau"] = str(bureau_id)
    return headers

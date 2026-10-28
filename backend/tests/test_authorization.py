"""Persona-based authorization tests for Phase 1.

Each case states who is calling, from which bureau context, and what the API
must answer. Both directions are covered: granted capabilities work, and
everything else is refused with a stable error code.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.auth import permissions as perms
from app.auth.principal import Principal, RoleAssignment
from app.repositories import admin as admin_repo
from app.repositories import reference as reference_repo
from tests.conftest import (
    AUDITOR_ID,
    COLLABORATOR_ID,
    INACTIVE_ID,
    PGRC_ID,
    PGRC_OFFICER_ID,
    RB_ADMIN_ID,
    RB_ID,
    SENIOR_ID,
    SUPER_ID,
    UNPROVISIONED_ID,
    auth_headers,
)

READ_ENDPOINTS = ("/api/v1/regions", "/api/v1/institutions", "/api/v1/bureaus")

MANAGE_PERMISSIONS = frozenset(
    {
        perms.REGION_MANAGE,
        perms.INSTITUTION_MANAGE,
        perms.INSTITUTION_ALIAS_MANAGE,
        perms.BUREAU_MANAGE,
        perms.BUREAU_MEMBERS_MANAGE,
        perms.USER_MANAGE,
        perms.ROLE_MANAGE,
    }
)


# ---------------------------------------------------------------------------
# Stubs: authorization must be proven independently of database contents.
# ---------------------------------------------------------------------------
@pytest.fixture()
def read_stubs(monkeypatch: pytest.MonkeyPatch) -> None:
    async def empty(conn, **kwargs):
        return []

    async def no_role_groups(conn, user_ids):
        return {}

    for name in ("list_regions", "list_institutions", "list_bureaus", "list_aliases"):
        monkeypatch.setattr(reference_repo, name, empty)
    for name in ("list_users", "list_roles"):
        monkeypatch.setattr(admin_repo, name, empty)
    monkeypatch.setattr(admin_repo, "list_role_assignments_for_users", no_role_groups)


@pytest.fixture()
def bureau_stubs(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_get_bureau(conn, bureau_id):
        return {
            "id": bureau_id,
            "code": "TST",
            "name": "Test bureau",
            "description": None,
            "parent_bureau_id": None,
            "bureau_type": "bureau",
            "is_active": True,
            "display_order": 0,
            "created_at": None,
            "updated_at": None,
        }

    async def empty_members(conn, **kwargs):
        return []

    monkeypatch.setattr(reference_repo, "get_bureau", fake_get_bureau)
    monkeypatch.setattr(reference_repo, "list_bureau_members", empty_members)


# ---------------------------------------------------------------------------
# Authentication failures
# ---------------------------------------------------------------------------
def test_missing_authorization_header_is_rejected(client) -> None:
    response = client.get("/api/v1/me")
    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "MISSING_TOKEN"
    assert body["error"]["request_id"]


def test_non_bearer_scheme_is_rejected(client) -> None:
    response = client.get("/api/v1/me", headers={"Authorization": f"Token {SUPER_ID}"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "MISSING_TOKEN"


@pytest.mark.parametrize(
    "token,expected_code",
    [("expired", "TOKEN_EXPIRED"), ("service-role", "INVALID_TOKEN"), ("not-a-jwt", "INVALID_TOKEN")],
)
def test_unusable_tokens_are_rejected(client, token: str, expected_code: str) -> None:
    response = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == expected_code


def test_inactive_account_is_denied(client) -> None:
    response = client.get("/api/v1/me", headers=auth_headers(INACTIVE_ID))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ACCOUNT_INACTIVE"


def test_account_without_profile_is_denied(client) -> None:
    response = client.get("/api/v1/me", headers=auth_headers(UNPROVISIONED_ID))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ACCOUNT_NOT_PROVISIONED"


# ---------------------------------------------------------------------------
# Active bureau context
# ---------------------------------------------------------------------------
def test_unknown_bureau_context_is_denied(client) -> None:
    response = client.get("/api/v1/bureaus", headers=auth_headers(COLLABORATOR_ID, PGRC_ID))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "BUREAU_CONTEXT_DENIED"


def test_malformed_bureau_context_is_a_validation_error(client) -> None:
    headers = {"Authorization": f"Bearer {SUPER_ID}", "X-Active-Bureau": "not-a-uuid"}
    response = client.get("/api/v1/me", headers=headers)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["error"]["details"][0]["field"] == "X-Active-Bureau"


def test_bureau_scoped_capability_needs_an_active_bureau(client, read_stubs) -> None:
    response = client.get("/api/v1/bureaus", headers=auth_headers(PGRC_OFFICER_ID))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_permissions_do_not_leak_across_bureau_contexts(personas) -> None:
    principal = personas[RB_ADMIN_ID]
    assert perms.BUREAU_MEMBERS_VIEW in principal.permissions_for(RB_ID)
    assert principal.permissions_for(PGRC_ID) == principal.global_permissions
    assert perms.BUREAU_MEMBERS_VIEW not in principal.permissions_for(None)


# ---------------------------------------------------------------------------
# Read matrix
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("path", READ_ENDPOINTS)
@pytest.mark.parametrize(
    "persona,bureau_id,expected",
    [
        (SUPER_ID, None, 200),
        (SENIOR_ID, None, 200),
        (AUDITOR_ID, None, 200),
        (RB_ADMIN_ID, RB_ID, 200),
        (RB_ADMIN_ID, None, 403),
        (PGRC_OFFICER_ID, PGRC_ID, 200),
        (COLLABORATOR_ID, RB_ID, 200),
    ],
    ids=[
        "super-admin",
        "senior-management",
        "auditor",
        "bureau-admin-in-context",
        "bureau-admin-without-context",
        "case-officer-in-context",
        "cross-bureau-collaborator",
    ],
)
def test_read_matrix(client, read_stubs, path, persona, bureau_id, expected) -> None:
    response = client.get(path, headers=auth_headers(persona, bureau_id))
    assert response.status_code == expected, response.text
    body = response.json()
    if expected == 200:
        assert body["data"] == []
        assert body["page"]["limit"] == 25
        assert body["page"]["next_cursor"] is None
        assert body["request_id"]
    else:
        assert body["error"]["code"] in {"FORBIDDEN", "BUREAU_CONTEXT_DENIED"}


@pytest.mark.parametrize(
    "persona,bureau_id",
    [(SENIOR_ID, None), (AUDITOR_ID, None), (PGRC_OFFICER_ID, PGRC_ID)],
    ids=["senior-management", "auditor", "case-officer"],
)
def test_read_only_personas_cannot_include_inactive_reference_data(
    client, read_stubs, persona, bureau_id
) -> None:
    response = client.get(
        "/api/v1/regions?include_inactive=true", headers=auth_headers(persona, bureau_id)
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_region_manager_can_include_inactive_reference_data(client, read_stubs) -> None:
    response = client.get(
        "/api/v1/regions?include_inactive=true", headers=auth_headers(SUPER_ID)
    )
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# Write matrix
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "persona,bureau_id",
    [(SENIOR_ID, None), (AUDITOR_ID, None), (RB_ADMIN_ID, RB_ID), (PGRC_OFFICER_ID, PGRC_ID)],
    ids=["senior-management", "auditor", "bureau-admin", "case-officer"],
)
def test_reference_data_writes_are_denied_without_manage(
    client, read_stubs, persona, bureau_id
) -> None:
    response = client.post(
        "/api/v1/regions",
        headers=auth_headers(persona, bureau_id),
        json={"code": "xx", "name": "Test region"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_bureau_membership_management_is_denied_to_bureau_admin(
    client, read_stubs, bureau_stubs
) -> None:
    response = client.post(
        "/api/v1/bureau-memberships",
        headers=auth_headers(RB_ADMIN_ID, RB_ID),
        json={
            "user_id": str(COLLABORATOR_ID),
            "bureau_id": str(RB_ID),
            "membership_type": "member",
        },
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


# ---------------------------------------------------------------------------
# Administration boundaries
# ---------------------------------------------------------------------------
def test_user_directory_requires_a_global_capability(client, read_stubs) -> None:
    denied = client.get("/api/v1/users", headers=auth_headers(RB_ADMIN_ID, RB_ID))
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "GLOBAL_CAPABILITY_REQUIRED"

    allowed = client.get("/api/v1/users", headers=auth_headers(SUPER_ID))
    assert allowed.status_code == 200
    assert allowed.json()["data"] == []


def test_role_catalogue_requires_a_global_capability(client, read_stubs) -> None:
    denied = client.get("/api/v1/roles", headers=auth_headers(PGRC_OFFICER_ID, PGRC_ID))
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "GLOBAL_CAPABILITY_REQUIRED"

    allowed = client.get("/api/v1/roles", headers=auth_headers(SUPER_ID))
    assert allowed.status_code == 200


# ---------------------------------------------------------------------------
# Bureau members are visible only inside the caller's own bureau
# ---------------------------------------------------------------------------
def test_bureau_members_are_scoped_to_the_callers_bureau(
    client, read_stubs, bureau_stubs
) -> None:
    own = client.get(
        f"/api/v1/bureaus/{PGRC_ID}/members",
        headers=auth_headers(PGRC_OFFICER_ID, PGRC_ID),
    )
    assert own.status_code == 200, own.text
    assert own.json()["data"] == []

    other = client.get(
        f"/api/v1/bureaus/{RB_ID}/members",
        headers=auth_headers(PGRC_OFFICER_ID, PGRC_ID),
    )
    assert other.status_code == 403
    assert other.json()["error"]["code"] == "FORBIDDEN"


# ---------------------------------------------------------------------------
# Effective permissions surfaced by /me
# ---------------------------------------------------------------------------
def test_me_reports_global_permissions_for_a_global_role(client) -> None:
    response = client.get("/api/v1/me", headers=auth_headers(SUPER_ID))
    assert response.status_code == 200
    body = response.json()
    assert body["is_super_admin"] is True
    assert body["active_bureau_id"] is None
    assert set(body["permissions"]) == set(perms.PHASE1_PERMISSIONS)
    assert body["demo_mode"] is True
    assert body["demo_notice"]


def test_me_permissions_follow_the_active_bureau(client) -> None:
    without_context = client.get("/api/v1/me", headers=auth_headers(PGRC_OFFICER_ID))
    assert without_context.status_code == 200
    assert without_context.json()["permissions"] == []

    with_context = client.get(
        "/api/v1/me", headers=auth_headers(PGRC_OFFICER_ID, PGRC_ID)
    )
    body = with_context.json()
    assert body["active_bureau_id"] == str(PGRC_ID)
    assert perms.BUREAU_MEMBERS_VIEW in body["permissions"]
    assert perms.REGION_MANAGE not in body["permissions"]


def test_active_bureau_selection_accepts_only_memberships(client) -> None:
    allowed = client.post(
        "/api/v1/me/active-bureau",
        headers=auth_headers(PGRC_OFFICER_ID),
        json={"bureau_id": str(PGRC_ID)},
    )
    assert allowed.status_code == 200
    assert allowed.json()["bureau_name"] == "Public Grievance Redressal Cell"

    denied = client.post(
        "/api/v1/me/active-bureau",
        headers=auth_headers(RB_ADMIN_ID),
        json={"bureau_id": str(PGRC_ID)},
    )
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "BUREAU_CONTEXT_DENIED"


def test_permissions_endpoint_matches_me(client) -> None:
    response = client.get(
        "/api/v1/me/permissions", headers=auth_headers(PGRC_OFFICER_ID, PGRC_ID)
    )
    assert response.status_code == 200
    body = response.json()
    assert body["active_bureau_id"] == str(PGRC_ID)
    assert perms.INSTITUTION_VIEW in body["permissions"]


# ---------------------------------------------------------------------------
# Catalogue invariants (PRD 7.1, 7.2, 7.3)
# ---------------------------------------------------------------------------
def test_super_admin_holds_the_whole_phase1_catalogue(personas) -> None:
    assert frozenset(perms.ROLE_DEFINITIONS[perms.SUPER_ADMIN]["permissions"]) == frozenset(
        perms.PHASE1_PERMISSIONS
    )


def test_super_admin_is_not_a_content_access_bypass(personas) -> None:
    super_admin = personas[SUPER_ID]
    assert super_admin.is_super_admin is True
    # Case content is a separate capability that Phase 1 cannot grant.
    assert super_admin.has_permission("case.content.view") is False


def test_roles_only_reference_catalogue_permissions() -> None:
    catalogue = set(perms.PHASE1_PERMISSIONS)
    for role_code, definition in perms.ROLE_DEFINITIONS.items():
        granted = set(definition["permissions"])  # type: ignore[arg-type]
        assert granted <= catalogue, f"{role_code} references unknown permissions"


def test_bureau_scoped_roles_carry_no_administration_capability() -> None:
    for role_code, definition in perms.ROLE_DEFINITIONS.items():
        if definition["scope_type"] != "bureau":
            continue
        assert not (set(definition["permissions"]) & MANAGE_PERMISSIONS), (  # type: ignore[arg-type]
            f"{role_code} must not hold an organisation-wide manage capability"
        )


def test_permission_code_casing_round_trips() -> None:
    for api_code in perms.PHASE1_PERMISSIONS:
        assert perms.to_db_code(api_code) == api_code.upper()
        assert perms.to_api_code(perms.to_db_code(api_code)) == api_code


def test_missing_bureau_id_does_not_turn_a_bureau_role_into_a_global_grant() -> None:
    """Defence in depth: only a role whose scope_type is global can be global."""
    assignment = RoleAssignment(
        assignment_id=uuid4(),
        role_code=perms.SUPER_ADMIN,
        role_name="Super Admin",
        scope_type="bureau",
        bureau_id=None,
        bureau_name=None,
        permissions=frozenset({perms.USER_MANAGE}),
    )
    principal = Principal(
        user_id=uuid4(),
        full_name="Misconfigured Grant",
        display_name=None,
        official_email="misconfigured@demo.invalid",
        designation=None,
        employee_code=None,
        account_status="active",
        roles=(assignment,),
        memberships=(),
        global_permissions=frozenset(),
        bureau_permissions={},
    )
    assert assignment.is_global is False
    assert principal.is_super_admin is False
    assert principal.permissions_for(None) == frozenset()


# ---------------------------------------------------------------------------
# The bureau context used by the API is the one PostgreSQL evaluates
# ---------------------------------------------------------------------------
def test_active_bureau_context_is_published_to_postgres(client) -> None:
    client.get("/api/v1/me", headers=auth_headers(PGRC_OFFICER_ID, PGRC_ID))
    claims = client.app.state.db.last_claims
    assert claims["sub"] == str(PGRC_OFFICER_ID)
    assert claims["active_bureau_id"] == str(PGRC_ID)


def test_absent_bureau_context_publishes_no_bureau_claim(client) -> None:
    client.get("/api/v1/me", headers=auth_headers(SUPER_ID))
    assert "active_bureau_id" not in client.app.state.db.last_claims


# ---------------------------------------------------------------------------
# The RLS migration may only use catalogue permissions and may not alter tables
# ---------------------------------------------------------------------------
def _migration_sql() -> str:
    from pathlib import Path

    path = (
        Path(__file__).resolve().parents[2]
        / "supabase"
        / "migrations"
        / "0001_phase1_identity_rls.sql"
    )
    if not path.exists():  # pragma: no cover - repository layout guard
        pytest.skip("Phase 1 migration file is not present.")
    return path.read_text(encoding="utf-8")


def test_rls_policies_reference_only_catalogue_permissions() -> None:
    import re

    sql = _migration_sql()
    codes = set(re.findall(r"has_(?:global_)?permission\('([A-Z0-9.]+)'\)", sql))
    assert codes, "No permission checks found in the RLS migration."
    assert {code.lower() for code in codes} <= set(perms.PHASE1_PERMISSIONS)


def test_rls_migration_does_not_restructure_the_schema() -> None:
    import re

    sql = _migration_sql().lower()
    forbidden = (
        r"\bcreate\s+table\b",
        r"\bdrop\s+table\b",
        r"\balter\s+table\b",
        r"\badd\s+column\b",
        r"\bdrop\s+column\b",
        r"\brename\s+to\b",
    )
    for pattern in forbidden:
        assert not re.search(pattern, sql), f"Migration must not perform {pattern}"


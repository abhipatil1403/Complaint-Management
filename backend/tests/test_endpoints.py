"""Endpoint contract tests for Phase 1 (success paths, validation, error shape)."""

from __future__ import annotations

from uuid import uuid4

from app.auth import permissions as perms
from app.auth.permissions import to_db_code
from app.core.errors import ApiError
from app.repositories import admin as admin_repo
from app.repositories import reference as reference_repo
from tests.conftest import (
    AUDITOR_ID,
    COLLABORATOR_ID,
    PGRC_ID,
    RB_ID,
    SUPER_ID,
    auth_headers,
)

INSTITUTION_ID = uuid4()
REGION_ID = uuid4()


def _region_row(**overrides) -> dict:
    row = {
        "id": REGION_ID,
        "code": "WEST",
        "name": "West Region",
        "description": None,
        "is_active": True,
        "created_at": None,
        "updated_at": None,
    }
    row.update(overrides)
    return row


def _institution_row(**overrides) -> dict:
    row = {
        "id": INSTITUTION_ID,
        "aicte_permanent_id": "1-12345678",
        "official_name": "Demo Institute of Technology",
        "normalized_name": "demo institute of technology",
        "institution_type": "engineering",
        "ownership_type": "private",
        "address_line1": None,
        "address_line2": None,
        "city": "Pune",
        "district": "Pune",
        "state_name": "Maharashtra",
        "postal_code": "411001",
        "region_id": REGION_ID,
        "region_code": "WEST",
        "region_name": "West Region",
        "contact_email": None,
        "contact_phone": None,
        "website_url": None,
        "verification_status": "pending",
        "verification_source": None,
        "verification_reference": None,
        "verified_by_user_id": None,
        "verified_at": None,
        "is_active": True,
        "created_at": None,
        "updated_at": None,
    }
    row.update(overrides)
    return row


def _bureau_row(bureau_id=None, **overrides) -> dict:
    row = {
        "id": bureau_id or RB_ID,
        "code": "RB",
        "name": "Regulation Bureau",
        "description": None,
        "parent_bureau_id": None,
        "bureau_type": "bureau",
        "is_active": True,
        "display_order": 1,
        "created_at": None,
        "updated_at": None,
    }
    row.update(overrides)
    return row


def _user_row(user_id=None, **overrides) -> dict:
    row = {
        "id": user_id or COLLABORATOR_ID,
        "employee_code": "DEMO-0004",
        "full_name": "Demo Collaborator",
        "display_name": None,
        "official_email": "collaborator@demo.invalid",
        "designation": "Coordinator",
        "account_status": "active",
        "last_seen_at": None,
        "created_at": None,
        "updated_at": None,
    }
    row.update(overrides)
    return row


def _alias_row(**overrides) -> dict:
    row = {
        "id": uuid4(),
        "institution_id": INSTITUTION_ID,
        "alias_name": "Demo Tech",
        "normalized_alias": "demo tech",
        "language_code": "en",
        "alias_type": "alternate_name",
        "source_type": "manual",
        "source_reference": None,
        "verification_status": "pending",
        "is_active": True,
        "created_at": None,
        "updated_at": None,
    }
    row.update(overrides)
    return row


# ---------------------------------------------------------------------------
# System endpoints
# ---------------------------------------------------------------------------
def test_liveness_and_demo_info_are_public(client) -> None:
    live = client.get("/api/v1/health/live")
    assert live.status_code == 200
    assert live.json() == {"status": "ok"}

    demo = client.get("/api/v1/demo/info")
    assert demo.status_code == 200
    assert demo.json()["demo_mode"] is True
    assert demo.json()["phase"].startswith("Phase 2.1")
    assert demo.json()["demo_intake_enabled"] is True
    assert [c["code"] for c in demo.json()["channels"]] == ["AICTE_SIM", "CPGRAMS_SIM"]
    assert all(c["is_simulated"] for c in demo.json()["channels"])
    assert "not a real complaint portal" in demo.json()["simulation_notice_en"]
    assert "सिमुलेशन" in demo.json()["simulation_notice_hi"]
    assert demo.json()["simulation_notice_version"] == "SIM-NOTICE-2026-10-29-v1"


def test_readiness_reflects_database_status(client) -> None:
    response = client.get("/api/v1/health/ready")
    assert response.status_code == 200
    assert response.json()["checks"]["database"] == "ok"


def test_request_id_is_echoed_and_correlated(client) -> None:
    response = client.get("/api/v1/me", headers={**auth_headers(SUPER_ID), "X-Request-ID": "trace-abc.123"})
    assert response.headers["X-Request-ID"] == "trace-abc.123"
    assert response.json()["demo_mode"] is True

    error = client.get("/api/v1/me")
    assert error.headers["X-Request-ID"].startswith("req_")
    assert error.json()["error"]["request_id"] == error.headers["X-Request-ID"]


def test_openapi_marks_authenticated_routes(client) -> None:
    schema = client.get("/openapi.json").json()
    assert "bearerAuth" in schema["components"]["securitySchemes"]
    assert "security" in schema["paths"]["/api/v1/me"]["get"]
    assert "security" not in schema["paths"]["/api/v1/health/live"]["get"]


# ---------------------------------------------------------------------------
# Regions
# ---------------------------------------------------------------------------
def test_create_region_normalizes_code(client, monkeypatch) -> None:
    captured = {}

    async def fake_create(conn, **kwargs):
        captured.update(kwargs)
        return _region_row(code=kwargs["code"], name=kwargs["name"])

    monkeypatch.setattr(reference_repo, "create_region", fake_create)

    response = client.post(
        "/api/v1/regions",
        headers=auth_headers(SUPER_ID),
        json={"code": " west ", "name": " West Region "},
    )
    assert response.status_code == 201, response.text
    assert response.json()["code"] == "WEST"
    assert captured["code"] == "WEST"
    assert captured["name"] == "West Region"


def test_update_missing_region_returns_404(client, monkeypatch) -> None:
    async def missing(conn, region_id, values):
        return None

    monkeypatch.setattr(reference_repo, "update_region", missing)

    response = client.patch(
        f"/api/v1/regions/{REGION_ID}",
        headers=auth_headers(SUPER_ID),
        json={"name": "Renamed"},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_region_delete_is_not_allowed(client) -> None:
    response = client.delete(f"/api/v1/regions/{REGION_ID}", headers=auth_headers(SUPER_ID))
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "METHOD_NOT_ALLOWED"


def test_limit_outside_bounds_is_rejected(client, monkeypatch) -> None:
    response = client.get("/api/v1/regions?limit=500", headers=auth_headers(SUPER_ID))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------------------
# Institutions
# ---------------------------------------------------------------------------
def test_verified_institution_requires_evidence(client) -> None:
    response = client.post(
        "/api/v1/institutions",
        headers=auth_headers(SUPER_ID),
        json={"official_name": "Demo Institute", "verification_status": "verified"},
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert any("AICTE Permanent ID" in item["issue"] for item in body["error"]["details"])


def test_create_institution_records_verification_attribution(client, monkeypatch) -> None:
    captured = {}

    async def region_exists(conn, region_id):
        return True

    async def create(conn, values):
        captured.update(values)
        return _institution_row(
            verification_status=values["verification_status"],
            verified_by_user_id=values["verified_by_user_id"],
            verified_at=values["verified_at"],
        )

    async def get(conn, institution_id):
        return _institution_row(
            verification_status="verified",
            verified_by_user_id=str(SUPER_ID),
            verification_source="AICTE approval letter",
            aicte_permanent_id="1-12345678",
        )

    monkeypatch.setattr(reference_repo, "region_exists", region_exists)
    monkeypatch.setattr(reference_repo, "create_institution", create)
    monkeypatch.setattr(reference_repo, "get_institution", get)

    response = client.post(
        "/api/v1/institutions",
        headers=auth_headers(SUPER_ID),
        json={
            "official_name": "Demo Institute of Technology",
            "aicte_permanent_id": "1-12345678",
            "region_id": str(REGION_ID),
            "verification_status": "verified",
            "verification_source": "AICTE approval letter",
        },
    )
    assert response.status_code == 201, response.text
    assert captured["verified_by_user_id"] == str(SUPER_ID)
    assert captured["verified_at"] is not None
    assert response.json()["region"]["code"] == "WEST"


def test_institution_cannot_leave_verified_state(client, monkeypatch) -> None:
    async def get(conn, institution_id):
        return _institution_row(
            verification_status="verified",
            aicte_permanent_id="1-12345678",
            verification_source="Approval letter",
        )

    monkeypatch.setattr(reference_repo, "get_institution", get)

    response = client.patch(
        f"/api/v1/institutions/{INSTITUTION_ID}",
        headers=auth_headers(SUPER_ID),
        json={"verification_status": "pending"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INVALID_STATE_TRANSITION"


def test_verification_without_evidence_is_refused(client, monkeypatch) -> None:
    async def get(conn, institution_id):
        return _institution_row(
            verification_status="pending",
            aicte_permanent_id=None,
            verification_source=None,
        )

    monkeypatch.setattr(reference_repo, "get_institution", get)

    response = client.patch(
        f"/api/v1/institutions/{INSTITUTION_ID}",
        headers=auth_headers(SUPER_ID),
        json={"verification_status": "verified"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VERIFICATION_EVIDENCE_REQUIRED"


def test_rejecting_an_institution_clears_verification_attribution(client, monkeypatch) -> None:
    row = _institution_row(
        verification_status="pending",
        aicte_permanent_id="1-12345678",
    )

    async def get(conn, institution_id):
        return row

    async def update(conn, institution_id, values):
        row.update(values)
        row["verification_status"] = "rejected"
        return row

    monkeypatch.setattr(reference_repo, "get_institution", get)
    monkeypatch.setattr(reference_repo, "update_institution", update)

    response = client.patch(
        f"/api/v1/institutions/{INSTITUTION_ID}",
        headers=auth_headers(SUPER_ID),
        json={"verification_status": "rejected"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["verification_status"] == "rejected"
    assert response.json()["verified_at"] is None


def test_institution_detail_is_404_when_absent(client, monkeypatch) -> None:
    async def missing(conn, institution_id):
        return None

    monkeypatch.setattr(reference_repo, "get_institution", missing)

    response = client.get(
        f"/api/v1/institutions/{INSTITUTION_ID}", headers=auth_headers(AUDITOR_ID)
    )
    assert response.status_code == 404


def test_non_manual_alias_requires_provenance(client, monkeypatch) -> None:
    async def exists(conn, institution_id):
        return True

    monkeypatch.setattr(reference_repo, "institution_exists", exists)

    response = client.post(
        f"/api/v1/institutions/{INSTITUTION_ID}/aliases",
        headers=auth_headers(SUPER_ID),
        json={"alias_name": "Demo Tech", "source_type": "official_record"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_alias_creation_normalizes_name(client, monkeypatch) -> None:
    async def exists(conn, institution_id):
        return True

    captured = {}

    async def create(conn, **kwargs):
        captured.update(kwargs)
        return _alias_row(alias_name="Demo Tech", normalized_alias="demo tech")

    monkeypatch.setattr(reference_repo, "institution_exists", exists)
    monkeypatch.setattr(reference_repo, "create_alias", create)

    response = client.post(
        f"/api/v1/institutions/{INSTITUTION_ID}/aliases",
        headers=auth_headers(SUPER_ID),
        json={
            "alias_name": "  Demo   Tech  ",
            "source_type": "official_record",
            "source_reference": "AICTE list 2026",
        },
    )
    assert response.status_code == 201, response.text
    assert captured["alias_name"] == "Demo Tech"
    assert captured["source_reference"] == "AICTE list 2026"
    assert response.json()["verification_status"] == "pending"


# ---------------------------------------------------------------------------
# Bureaus and memberships
# ---------------------------------------------------------------------------
def test_create_bureau_rejects_unknown_parent(client, monkeypatch) -> None:
    async def missing(conn, bureau_id):
        return None

    monkeypatch.setattr(reference_repo, "get_bureau", missing)

    response = client.post(
        "/api/v1/bureaus",
        headers=auth_headers(SUPER_ID),
        json={"code": "NEW", "name": "New Bureau", "parent_bureau_id": str(uuid4())},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "REFERENCE_ERROR"


def test_bureau_cannot_be_its_own_parent(client) -> None:
    response = client.patch(
        f"/api/v1/bureaus/{RB_ID}",
        headers=auth_headers(SUPER_ID),
        json={"parent_bureau_id": str(RB_ID)},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_add_membership_requires_an_active_user_and_bureau(client, monkeypatch) -> None:
    async def bureau(conn, bureau_id):
        return _bureau_row(bureau_id)

    async def inactive_user(conn, user_id):
        return False

    monkeypatch.setattr(reference_repo, "get_bureau", bureau)
    monkeypatch.setattr(admin_repo, "user_exists_and_active", inactive_user)

    response = client.post(
        "/api/v1/bureau-memberships",
        headers=auth_headers(SUPER_ID),
        json={"user_id": str(COLLABORATOR_ID), "bureau_id": str(RB_ID)},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "REFERENCE_ERROR"


def test_add_membership_uses_the_physical_membership_columns(client, monkeypatch) -> None:
    async def bureau(conn, bureau_id):
        return _bureau_row(bureau_id)

    async def exists(conn, user_id):
        return True

    async def add(conn, **kwargs):
        return {
            "id": uuid4(),
            "user_id": kwargs["user_id"],
            "bureau_id": kwargs["bureau_id"],
            "membership_type": kwargs["membership_type"],
            "membership_status": "active",
            "is_primary": kwargs["is_primary"],
            "joined_at": None,
            "ended_at": None,
        }

    async def get_user(conn, user_id):
        return _user_row(user_id)

    monkeypatch.setattr(reference_repo, "get_bureau", bureau)
    monkeypatch.setattr(admin_repo, "user_exists_and_active", exists)
    monkeypatch.setattr(reference_repo, "add_membership", add)
    monkeypatch.setattr(admin_repo, "get_user", get_user)

    response = client.post(
        "/api/v1/bureau-memberships",
        headers=auth_headers(SUPER_ID),
        json={
            "user_id": str(COLLABORATOR_ID),
            "bureau_id": str(RB_ID),
            "membership_type": "coordinator",
            "is_primary": True,
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["membership_status"] == "active"
    assert body["membership_type"] == "coordinator"
    assert body["full_name"] == "Demo Collaborator"


def test_ending_an_inactive_membership_conflicts(client, monkeypatch) -> None:
    membership_id = uuid4()

    async def existing(conn, target):
        return {
            "id": membership_id,
            "user_id": COLLABORATOR_ID,
            "bureau_id": RB_ID,
            "membership_type": "member",
            "membership_status": "active",
            "is_primary": False,
            "joined_at": None,
            "ended_at": None,
        }

    async def already_ended(conn, target):
        return None

    monkeypatch.setattr(reference_repo, "get_membership", existing)
    monkeypatch.setattr(reference_repo, "end_membership", already_ended)

    response = client.post(
        f"/api/v1/bureau-memberships/{membership_id}/end",
        headers=auth_headers(SUPER_ID),
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ALREADY_INACTIVE"


# ---------------------------------------------------------------------------
# Administration
# ---------------------------------------------------------------------------
def test_user_list_reports_next_cursor(client, monkeypatch) -> None:
    rows = [_user_row(uuid4(), full_name=f"User {index:02d}") for index in range(26)]

    async def list_users(conn, **kwargs):
        # The repository adds one row to detect whether another page exists.
        return rows[: kwargs["limit"] + 1]

    async def groups(conn, user_ids):
        return {}

    monkeypatch.setattr(admin_repo, "list_users", list_users)
    monkeypatch.setattr(admin_repo, "list_role_assignments_for_users", groups)

    response = client.get("/api/v1/users?limit=25", headers=auth_headers(SUPER_ID))
    assert response.status_code == 200
    body = response.json()
    assert len(body["data"]) == 25
    assert body["page"]["next_cursor"] == "25"


def test_user_detail_aggregates_roles_and_memberships(client, monkeypatch) -> None:
    async def get_user(conn, user_id):
        return _user_row(user_id)

    async def assignments(conn, user_id, include_ended=False):
        return [
            {
                "id": uuid4(),
                "role_id": uuid4(),
                "user_id": user_id,
                "role_code": "CASE_OFFICER",
                "role_name": "Case Officer",
                "scope_type": "bureau",
                "bureau_id": PGRC_ID,
                "bureau_code": "PGRC",
                "bureau_name": "Public Grievance Redressal Cell",
                "assignment_status": "active",
                "assigned_by_user_id": SUPER_ID,
                "assigned_at": None,
                "expires_at": None,
                "revoked_at": None,
                "revocation_reason": None,
            }
        ]

    async def memberships(conn, user_id):
        return [
            {
                "id": uuid4(),
                "bureau_id": PGRC_ID,
                "bureau_code": "PGRC",
                "bureau_name": "Public Grievance Redressal Cell",
                "membership_type": "member",
                "membership_status": "active",
                "is_primary": True,
                "joined_at": None,
                "ended_at": None,
            }
        ]

    monkeypatch.setattr(admin_repo, "get_user", get_user)
    monkeypatch.setattr(admin_repo, "list_role_assignments_for_user", assignments)
    monkeypatch.setattr(admin_repo, "list_memberships_for_user", memberships)

    response = client.get(
        f"/api/v1/users/{COLLABORATOR_ID}", headers=auth_headers(SUPER_ID)
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["roles"][0]["role_code"] == "CASE_OFFICER"
    assert body["memberships"][0]["bureau_code"] == "PGRC"
    assert body["role_assignments"][0]["assignment_status"] == "active"


def test_administrator_cannot_deactivate_self(client) -> None:
    response = client.post(
        f"/api/v1/users/{SUPER_ID}/account-status",
        headers=auth_headers(SUPER_ID),
        json={"account_status": "inactive"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "CANNOT_DEACTIVATE_SELF"


def test_account_status_change_is_recorded(client, monkeypatch) -> None:
    async def set_status(conn, user_id, status):
        return _user_row(user_id, account_status=status)

    async def assignments(conn, user_id, include_ended=False):
        return []

    monkeypatch.setattr(admin_repo, "set_account_status", set_status)
    monkeypatch.setattr(admin_repo, "list_role_assignments_for_user", assignments)

    response = client.post(
        f"/api/v1/users/{COLLABORATOR_ID}/account-status",
        headers=auth_headers(SUPER_ID),
        json={"account_status": "suspended"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["account_status"] == "suspended"


def test_role_grant_rejects_a_global_role_with_a_bureau(client, monkeypatch) -> None:
    async def get_user(conn, user_id):
        return _user_row(user_id)

    async def role(conn, code):
        return {
            "id": uuid4(),
            "code": code,
            "name": "Auditor / Read-only official",
            "scope_type": "global",
            "is_active": True,
        }

    monkeypatch.setattr(admin_repo, "get_user", get_user)
    monkeypatch.setattr(admin_repo, "get_role_by_code", role)

    response = client.post(
        f"/api/v1/users/{COLLABORATOR_ID}/role-assignments",
        headers=auth_headers(SUPER_ID),
        json={"role_code": "AUDITOR", "bureau_id": str(RB_ID)},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_bureau_scoped_role_requires_membership(client, monkeypatch) -> None:
    async def get_user(conn, user_id):
        return _user_row(user_id)

    async def role(conn, code):
        return {
            "id": uuid4(),
            "code": code,
            "name": "Case Officer",
            "scope_type": "bureau",
            "is_active": True,
        }

    async def bureau(conn, bureau_id):
        return _bureau_row(bureau_id)

    async def no_membership(conn, *, user_id, bureau_id):
        return False

    monkeypatch.setattr(admin_repo, "get_user", get_user)
    monkeypatch.setattr(admin_repo, "get_role_by_code", role)
    monkeypatch.setattr(reference_repo, "get_bureau", bureau)
    monkeypatch.setattr(admin_repo, "has_active_membership", no_membership)

    response = client.post(
        f"/api/v1/users/{COLLABORATOR_ID}/role-assignments",
        headers=auth_headers(SUPER_ID),
        json={"role_code": "CASE_OFFICER", "bureau_id": str(RB_ID)},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "BUREAU_MEMBERSHIP_REQUIRED"


def test_bureau_scoped_role_grant_is_recorded(client, monkeypatch) -> None:
    role_id = uuid4()

    async def get_user(conn, user_id):
        return _user_row(user_id)

    async def role(conn, code):
        return {
            "id": role_id,
            "code": code,
            "name": "Case Officer",
            "scope_type": "bureau",
            "is_active": True,
        }

    async def bureau(conn, bureau_id):
        return _bureau_row(bureau_id, code="PGRC", name="Public Grievance Redressal Cell")

    async def membership(conn, *, user_id, bureau_id):
        return True

    async def assign(conn, **kwargs):
        return {
            "id": uuid4(),
            "user_id": kwargs["user_id"],
            "role_id": kwargs["role_id"],
            "bureau_id": kwargs["bureau_id"],
            "assignment_status": "active",
            "assigned_at": None,
            "expires_at": None,
        }

    monkeypatch.setattr(admin_repo, "get_user", get_user)
    monkeypatch.setattr(admin_repo, "get_role_by_code", role)
    monkeypatch.setattr(reference_repo, "get_bureau", bureau)
    monkeypatch.setattr(admin_repo, "has_active_membership", membership)
    monkeypatch.setattr(admin_repo, "assign_role", assign)

    response = client.post(
        f"/api/v1/users/{COLLABORATOR_ID}/role-assignments",
        headers=auth_headers(SUPER_ID),
        json={"role_code": "case_officer", "bureau_id": str(PGRC_ID)},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["role_code"] == "CASE_OFFICER"
    assert body["bureau_name"] == "Public Grievance Redressal Cell"
    assert body["assignment_status"] == "active"


def test_revoked_role_cannot_be_revoked_twice(client, monkeypatch) -> None:
    assignment_id = uuid4()

    async def existing(conn, target):
        return {
            "id": assignment_id,
            "user_id": COLLABORATOR_ID,
            "role_id": uuid4(),
            "role_code": "CASE_OFFICER",
            "bureau_id": PGRC_ID,
            "assignment_status": "revoked",
        }

    monkeypatch.setattr(admin_repo, "get_role_assignment", existing)

    response = client.post(
        f"/api/v1/role-assignments/{assignment_id}/revoke",
        headers=auth_headers(SUPER_ID),
        json={"reason": "Transferred to another bureau"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ALREADY_REVOKED"


def test_last_super_admin_cannot_revoke_their_own_role(client, monkeypatch) -> None:
    assignment_id = uuid4()

    async def existing(conn, target):
        return {
            "id": assignment_id,
            "user_id": SUPER_ID,
            "role_id": uuid4(),
            "role_code": "SUPER_ADMIN",
            "bureau_id": None,
            "assignment_status": "active",
        }

    async def holders(conn, role_code):
        return 1

    monkeypatch.setattr(admin_repo, "get_role_assignment", existing)
    monkeypatch.setattr(admin_repo, "count_active_role_holders", holders)

    response = client.post(
        f"/api/v1/role-assignments/{assignment_id}/revoke",
        headers=auth_headers(SUPER_ID),
        json={"reason": "Cleanup"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "LAST_SUPER_ADMIN"


def test_role_revocation_records_reason(client, monkeypatch) -> None:
    assignment_id = uuid4()

    async def existing(conn, target):
        return {
            "id": assignment_id,
            "user_id": COLLABORATOR_ID,
            "role_id": uuid4(),
            "role_code": "CASE_OFFICER",
            "bureau_id": PGRC_ID,
            "assignment_status": "active",
        }

    async def revoke(conn, **kwargs):
        return {
            "id": kwargs["assignment_id"],
            "user_id": COLLABORATOR_ID,
            "role_id": uuid4(),
            "bureau_id": PGRC_ID,
            "assignment_status": "revoked",
            "revoked_at": None,
            "revocation_reason": kwargs["reason"],
        }

    async def role(conn, code):
        return {
            "id": uuid4(),
            "code": code,
            "name": "Case Officer",
            "scope_type": "bureau",
            "is_active": True,
        }

    async def bureau(conn, bureau_id):
        return _bureau_row(bureau_id, code="PGRC", name="Public Grievance Redressal Cell")

    monkeypatch.setattr(admin_repo, "get_role_assignment", existing)
    monkeypatch.setattr(admin_repo, "revoke_role_assignment", revoke)
    monkeypatch.setattr(admin_repo, "get_role_by_code", role)
    monkeypatch.setattr(reference_repo, "get_bureau", bureau)

    response = client.post(
        f"/api/v1/role-assignments/{assignment_id}/revoke",
        headers=auth_headers(SUPER_ID),
        json={"reason": "Transferred to another bureau"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["assignment_status"] == "revoked"
    assert response.json()["revocation_reason"] == "Transferred to another bureau"


def test_permission_codes_follow_the_database_constraint() -> None:
    """permissions.code must satisfy code = upper(btrim(code)) in PostgreSQL."""
    for api_code in perms.PHASE1_PERMISSIONS:
        assert api_code == api_code.lower()
        assert " " not in api_code
        assert to_db_code(api_code) == to_db_code(api_code).strip().upper()
        assert "." in api_code


def test_api_error_carries_details() -> None:
    error = ApiError(422, "VALIDATION_ERROR", "Bad input", [{"field": "x", "issue": "y"}])
    assert error.status_code == 422
    assert error.details[0]["field"] == "x"

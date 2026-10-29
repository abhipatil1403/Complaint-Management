"""Phase 2.3 canonical cases and index API contract and unit tests."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from app.auth import permissions as perms
from app.core.errors import ApiError
from app.repositories import cases as repo
from tests.conftest import AUDITOR_ID, SENIOR_ID, SUPER_ID, auth_headers

CASE_ID = uuid4()
SUBMISSION_ID = uuid4()
BUREAU_ID = uuid4()
NOW = datetime(2026, 10, 29, 10, 0, tzinfo=timezone.utc)


def _index_row(**overrides) -> dict:
    row = {
        "case_id": CASE_ID,
        "case_number": "CASE-2026-000001",
        "institution_id": uuid4(),
        "institution_name": "Delhi Technological University",
        "institution_region": "North",
        "category_id": uuid4(),
        "category_name": "Faculty & Staff Grievances",
        "status": "new",
        "priority": "normal",
        "lead_bureau_id": BUREAU_ID,
        "lead_bureau_name": "Public Grievance Redressal Cell",
        "lead_bureau_code": "PGRC",
        "opened_at": NOW,
        "closed_at": None,
        "can_view_details": True,
    }
    row.update(overrides)
    return row


def _detail_row(**overrides) -> dict:
    row = {
        "case_id": CASE_ID,
        "case_number": "CASE-2026-000001",
        "title": "DTU Faculty Grievance",
        "description": "Comprehensive case description of faculty grievance",
        "institution_id": uuid4(),
        "institution_name": "Delhi Technological University",
        "institution_code": "1-0012345",
        "institution_region": "North",
        "category_id": uuid4(),
        "category_name": "Faculty & Staff Grievances",
        "status": "new",
        "priority": "normal",
        "visibility": "restricted",
        "source_submission_id": SUBMISSION_ID,
        "opened_at": NOW,
        "closed_at": None,
        "created_at": NOW,
        "updated_at": NOW,
        "lead_bureau_id": BUREAU_ID,
        "lead_bureau_name": "Public Grievance Redressal Cell",
        "lead_bureau_code": "PGRC",
        "collaborating_bureaus": [],
        "related_cases": [],
        "action_history": [
            {
                "action_id": str(uuid4()),
                "action_type": "case_created",
                "action_description": "Canonical case created from submission",
                "previous_status": None,
                "new_status": "new",
                "actor_user_id": str(SUPER_ID),
                "created_at": NOW.isoformat(),
                "metadata": {"case_number": "CASE-2026-000001"},
            }
        ],
    }
    row.update(overrides)
    return row


def test_case_index_requires_auth(client):
    resp = client.get("/api/v1/cases")
    assert resp.status_code == 401


def test_case_index_success_for_auditor(client, monkeypatch):
    # Auditor has CASE.VIEW_INDEX
    async def mock_list(conn, *, status=None, search=None, limit=50, offset=0):
        return [_index_row()]

    monkeypatch.setattr(repo, "list_cases", mock_list)

    headers = auth_headers(AUDITOR_ID)
    resp = client.get("/api/v1/cases", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["case_id"] == str(CASE_ID)
    assert data[0]["case_number"] == "CASE-2026-000001"


def test_case_detail_success_for_authorized_caller(client, monkeypatch):
    async def mock_detail(conn, case_id):
        return _detail_row()

    monkeypatch.setattr(repo, "get_case_detail", mock_detail)

    headers = auth_headers(SUPER_ID)
    resp = client.get(f"/api/v1/cases/{CASE_ID}", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["case_id"] == str(CASE_ID)
    assert data["title"] == "DTU Faculty Grievance"


def test_case_detail_not_found_or_unauthorized(client, monkeypatch):
    async def mock_detail(conn, case_id):
        return None

    monkeypatch.setattr(repo, "get_case_detail", mock_detail)

    headers = auth_headers(SUPER_ID)
    resp = client.get(f"/api/v1/cases/{CASE_ID}", headers=headers)
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_create_case_requires_auth(client):
    resp = client.post("/api/v1/cases", json={})
    assert resp.status_code == 401


def test_create_case_success(client, monkeypatch):
    created_cases = []

    async def mock_create(conn, *, submission_id, lead_bureau_id, title, description, priority, visibility, expected_submission_updated_at):
        created_cases.append((submission_id, lead_bureau_id, title))
        return CASE_ID

    monkeypatch.setattr(repo, "create_case", mock_create)

    headers = auth_headers(SUPER_ID)
    resp = client.post(
        "/api/v1/cases",
        json={
            "submission_id": str(SUBMISSION_ID),
            "lead_bureau_id": str(BUREAU_ID),
            "title": "Canonical Case Title",
            "description": "Validated canonical case description",
            "priority": "normal",
            "visibility": "restricted",
            "expected_submission_updated_at": NOW.isoformat(),
        },
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "created"
    assert resp.json()["case_id"] == str(CASE_ID)
    assert len(created_cases) == 1


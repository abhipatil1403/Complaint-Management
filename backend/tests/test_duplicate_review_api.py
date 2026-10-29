"""Phase 2.3 duplicate review API contract and unit tests."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from app.auth import permissions as perms
from app.core.errors import ApiError
from app.repositories import duplicate_review as repo
from tests.conftest import AUDITOR_ID, SENIOR_ID, SUPER_ID, auth_headers

CANDIDATE_ID = uuid4()
SUBMISSION_ID = uuid4()
CASE_ID = uuid4()
NOW = datetime(2026, 10, 29, 10, 0, tzinfo=timezone.utc)


def _queue_row(**overrides) -> dict:
    row = {
        "candidate_id": CANDIDATE_ID,
        "submission_id": SUBMISSION_ID,
        "candidate_case_id": CASE_ID,
        "case_number": "CASE-2026-000001",
        "institution_id": uuid4(),
        "institution_name": "Indian Institute of Technology",
        "similarity_score": 0.900,
        "matching_method": "rules",
        "matching_signals": {
            "category_match": True,
            "heuristic_label": "Same institution and complaint category (uncalibrated rule heuristic)",
        },
        "review_status": "pending",
        "reviewed_at": None,
        "reviewer_user_id": None,
        "review_notes": None,
        "candidate_created_at": NOW,
        "candidate_updated_at": NOW,
        "submission_updated_at": NOW,
        "submission_subject": "Fee Refund Grievance",
        "submission_received_at": NOW,
    }
    row.update(overrides)
    return row


def _detail_row(**overrides) -> dict:
    row = {
        "candidate_id": CANDIDATE_ID,
        "submission_id": SUBMISSION_ID,
        "submission_subject": "Fee Refund Grievance",
        "submission_body": "Full body text of the complaint",
        "submission_category_id": uuid4(),
        "submission_category_name": "Fee & Financial Issues",
        "submission_institution_id": uuid4(),
        "submission_institution_name": "Indian Institute of Technology",
        "submission_updated_at": NOW,
        "candidate_case_id": CASE_ID,
        "case_number": "CASE-2026-000001",
        "case_title": "IIT Fee Dispute",
        "case_status": "under_review",
        "case_category_id": uuid4(),
        "case_category_name": "Fee & Financial Issues",
        "case_created_at": NOW,
        "case_lead_bureau_id": uuid4(),
        "case_lead_bureau_name": "Public Grievance Redressal Cell",
        "similarity_score": 0.900,
        "matching_method": "rules",
        "matching_signals": {"category_match": True},
        "review_status": "pending",
        "reviewed_at": None,
        "reviewer_user_id": None,
        "review_notes": None,
        "candidate_created_at": NOW,
        "candidate_updated_at": NOW,
    }
    row.update(overrides)
    return row


def test_queue_requires_auth(client):
    resp = client.get("/api/v1/duplicate-review/queue")
    assert resp.status_code == 401


def test_queue_forbidden_without_capability(client):
    # Auditor does not hold DUPLICATE.REVIEW
    headers = auth_headers(AUDITOR_ID)
    resp = client.get("/api/v1/duplicate-review/queue", headers=headers)
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] in {"FORBIDDEN", "GLOBAL_CAPABILITY_REQUIRED"}


def test_queue_list_success(client, monkeypatch):
    async def mock_list(conn, *, status="pending", limit=50, offset=0):
        return [_queue_row()]

    monkeypatch.setattr(repo, "list_queue", mock_list)

    headers = auth_headers(SUPER_ID)
    resp = client.get("/api/v1/duplicate-review/queue?status=pending", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["candidate_id"] == str(CANDIDATE_ID)
    assert data[0]["similarity_score"] == 0.900
    assert data[0]["matching_signals"]["heuristic_label"] == "Same institution and complaint category (uncalibrated rule heuristic)"


def test_candidate_detail_success(client, monkeypatch):
    async def mock_detail(conn, candidate_id):
        return _detail_row()

    monkeypatch.setattr(repo, "get_candidate_detail", mock_detail)

    headers = auth_headers(SUPER_ID)
    resp = client.get(f"/api/v1/duplicate-review/candidates/{CANDIDATE_ID}", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["candidate_id"] == str(CANDIDATE_ID)
    assert data["submission_subject"] == "Fee Refund Grievance"


def test_candidate_detail_not_found(client, monkeypatch):
    async def mock_detail(conn, candidate_id):
        return None

    monkeypatch.setattr(repo, "get_candidate_detail", mock_detail)

    headers = auth_headers(SUPER_ID)
    resp = client.get(f"/api/v1/duplicate-review/candidates/{CANDIDATE_ID}", headers=headers)
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_screening_success(client, monkeypatch):
    async def mock_screen(conn, *, submission_id, expected_submission_updated_at):
        return 2

    monkeypatch.setattr(repo, "screen_submission", mock_screen)

    headers = auth_headers(SUPER_ID)
    resp = client.post(
        "/api/v1/duplicate-review/screen",
        json={
            "submission_id": str(SUBMISSION_ID),
            "expected_submission_updated_at": NOW.isoformat(),
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["inserted_count"] == 2


def test_decide_candidate_success(client, monkeypatch):
    decided = []

    async def mock_decide(conn, *, candidate_id, action, notes, expected_submission_updated_at, expected_candidate_updated_at):
        decided.append((candidate_id, action, notes))

    monkeypatch.setattr(repo, "decide_candidate", mock_decide)

    headers = auth_headers(SUPER_ID)
    resp = client.post(
        f"/api/v1/duplicate-review/candidates/{CANDIDATE_ID}/decide",
        json={
            "action": "confirmed_duplicate",
            "notes": "Verified identical grievance from same complainant",
            "expected_submission_updated_at": NOW.isoformat(),
            "expected_candidate_updated_at": NOW.isoformat(),
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "success"
    assert len(decided) == 1
    assert decided[0][1] == "confirmed_duplicate"


def test_reject_submission_requires_global_reject_capability(client):
    # Auditor lacks global SUBMISSION.REJECT
    headers = auth_headers(AUDITOR_ID)
    resp = client.post(
        f"/api/v1/duplicate-review/submissions/{SUBMISSION_ID}/reject",
        json={
            "reason": "Invalid submission lacking verified documentation",
            "expected_submission_updated_at": NOW.isoformat(),
        },
        headers=headers,
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] in {"FORBIDDEN", "GLOBAL_CAPABILITY_REQUIRED"}


def test_reject_submission_success(client, monkeypatch):
    rejected = []

    async def mock_reject(conn, *, submission_id, reason, expected_submission_updated_at):
        rejected.append((submission_id, reason))

    monkeypatch.setattr(repo, "reject_submission", mock_reject)

    headers = auth_headers(SUPER_ID)
    resp = client.post(
        f"/api/v1/duplicate-review/submissions/{SUBMISSION_ID}/reject",
        json={
            "reason": "Administrative rejection following screening",
            "expected_submission_updated_at": NOW.isoformat(),
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"
    assert len(rejected) == 1
    assert rejected[0][0] == SUBMISSION_ID


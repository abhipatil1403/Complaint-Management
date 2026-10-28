"""Phase 2.2 verification API contract tests.

No database is required: the repository is replaced per test while the real
router, authorization dependency, request models and SQLSTATE translation run.
Database reality (grants, definer posture, the case-creation guard) is covered
by ``tests/test_rls_db.py``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from app.auth import permissions as perms
from app.core.errors import ApiError
from app.repositories import verification as repo
from app.repositories.verification import _translate
from tests.conftest import AUDITOR_ID, SENIOR_ID, SUPER_ID, auth_headers

TASK_ID = uuid4()
SUBMISSION_ID = uuid4()
INSTITUTION_ID = uuid4()
NOW = datetime(2026, 10, 29, 10, 0, tzinfo=timezone.utc)


def _task_row(**overrides) -> dict:
    """One row shaped like ``institution_verification_task_rows``."""
    row = {
        "out_task_id": TASK_ID,
        "out_status": "pending",
        "out_priority": "high",
        "out_submitted_institution_name": "Illustrative Institute",
        "out_submitted_permanent_id": "DEMO-UNKNOWN-9999",
        "out_candidate_institution_id": None,
        "out_assigned_to_user_id": None,
        "out_assigned_to_name": None,
        "out_reviewed_by_user_id": None,
        "out_reviewed_by_name": None,
        "out_resolved_institution_id": None,
        "out_resolved_institution_name": None,
        "out_resolution_notes": None,
        "out_resolved_at": None,
        "out_created_at": NOW,
        "out_updated_at": NOW,
        "out_age_days": 0,
        "out_round_type": "new_round",
        "out_requester_user_id": None,
        "out_strongest_evidence": None,
        "out_candidate_count": 0,
        "out_submission_id": SUBMISSION_ID,
        "out_channel_code": "AICTE_SIM",
        "out_channel_name": "AICTE portal (simulated)",
        "out_channel_is_simulated": True,
        "out_external_reference": "AICTE-SIM-0001",
        "out_source_event_id": "evt-1",
        "out_received_at": NOW,
        "out_submission_updated_at": NOW,
        "out_intake_status": "awaiting_institution_verification",
        "out_original_language": "en",
        "out_institution_name_as_submitted": "Illustrative Institute",
        "out_submission_institution_id": None,
        "out_submission_institution_name": None,
        "out_submission_institution_permanent_id": None,
        "out_canonical_case_id": None,
    }
    row.update(overrides)
    return row


def _candidate_row(**overrides) -> dict:
    row = {
        "out_institution_id": INSTITUTION_ID,
        "out_official_name": "Verified Institute",
        "out_permanent_id": "1-12345678",
        "out_region_code": "WEST",
        "out_region_name": "West Region",
        "out_verification_status": "verified",
        "out_is_active": True,
        "out_evidence": ["exact_permanent_id"],
        "out_matched_alias_id": None,
        "out_matched_alias_name": None,
        "out_evidence_rank": 1,
        "out_is_eligible": True,
    }
    row.update(overrides)
    return row


async def _noop(*_args, **_kwargs) -> None:
    return None


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------
def test_every_verification_endpoint_requires_the_capability(client, monkeypatch) -> None:
    async def unpatched(*_args, **_kwargs):  # pragma: no cover - must never run
        raise AssertionError("a forbidden request reached the repository")

    monkeypatch.setattr(repo, "list_tasks", unpatched)
    monkeypatch.setattr(repo, "get_task", unpatched)
    monkeypatch.setattr(repo, "list_candidates", unpatched)
    monkeypatch.setattr(repo, "decide", unpatched)
    monkeypatch.setattr(repo, "request_round", unpatched)

    requests = (
        ("get", "/api/v1/verification/tasks", None),
        ("get", f"/api/v1/verification/tasks/{TASK_ID}", None),
        ("get", f"/api/v1/verification/submissions/{SUBMISSION_ID}/candidates", None),
        (
            "post",
            f"/api/v1/verification/tasks/{TASK_ID}/decision",
            {"action": "reject", "reason": "not a match"},
        ),
        (
            "post",
            f"/api/v1/verification/submissions/{SUBMISSION_ID}/correction-rounds",
            {"reason": "re-examine"},
        ),
    )
    for user_id in (SENIOR_ID, AUDITOR_ID):
        for method, url, body in requests:
            kwargs = {"json": body} if method == "post" else {}
            response = getattr(client, method)(
                url, headers=auth_headers(user_id), **kwargs
            )
            assert response.status_code == 403, (user_id, url)
            body_json = response.json()
            assert body_json["error"]["code"] in {
                "FORBIDDEN",
                "GLOBAL_CAPABILITY_REQUIRED",
            }
            assert body_json["error"]["request_id"]

    assert perms.INSTITUTION_VERIFY not in perms.PHASE1_PERMISSIONS
    assert perms.INSTITUTION_VERIFY in perms.PHASE2_VERIFICATION_ROLE_GRANTS[perms.SUPER_ADMIN]


# ---------------------------------------------------------------------------
# Queue listing
# ---------------------------------------------------------------------------
def test_list_tasks_returns_a_bounded_page_and_no_complaint_content(client, monkeypatch) -> None:
    captured: dict = {}

    async def fake_list(conn, **kwargs):
        captured.update(kwargs)
        return [_task_row(), _task_row(out_task_id=uuid4()), _task_row(out_task_id=uuid4())]

    monkeypatch.setattr(repo, "list_tasks", fake_list)

    response = client.get(
        "/api/v1/verification/tasks?limit=2&status=open&sort=oldest",
        headers=auth_headers(SUPER_ID),
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["data"]) == 2
    assert body["page"] == {"limit": 2, "next_cursor": "2"}
    assert body["request_id"]
    assert captured["limit"] == 2
    assert captured["offset"] == 0
    assert captured["status"] == "open"

    serialized = response.text
    assert "subject" not in body["data"][0]
    assert "original_text" not in body["data"][0]
    assert "Probe complaint body" not in serialized


def test_list_tasks_rejects_an_unknown_filter(client, monkeypatch) -> None:
    async def unpatched(*_args, **_kwargs):  # pragma: no cover - must never run
        raise AssertionError("an invalid filter reached the repository")

    monkeypatch.setattr(repo, "list_tasks", unpatched)

    response = client.get(
        "/api/v1/verification/tasks?status=bogus",
        headers=auth_headers(SUPER_ID),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_list_tasks_applies_the_default_filters(client, monkeypatch) -> None:
    captured: dict = {}

    async def fake_list(conn, **kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr(repo, "list_tasks", fake_list)

    response = client.get("/api/v1/verification/tasks", headers=auth_headers(SUPER_ID))
    assert response.status_code == 200
    assert response.json()["data"] == []
    assert response.json()["page"]["next_cursor"] is None
    assert captured == {
        "status": "open",
        "assignment": "all",
        "priority": None,
        "query": None,
        "sort": "oldest",
        "limit": 25,
        "offset": 0,
    }


# ---------------------------------------------------------------------------
# Detail and evidence
# ---------------------------------------------------------------------------
def test_task_detail_returns_provenance_only(client, monkeypatch) -> None:
    async def fake_get(conn, task_id):
        assert task_id == TASK_ID
        return _task_row()

    monkeypatch.setattr(repo, "get_task", fake_get)

    response = client.get(
        f"/api/v1/verification/tasks/{TASK_ID}", headers=auth_headers(SUPER_ID)
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(TASK_ID)
    assert body["round_type"] == "new_round"
    assert body["candidate_institution_id"] is None
    assert body["submission"]["intake_status"] == "awaiting_institution_verification"
    assert "subject" not in body
    assert "original_text" not in body["submission"]


def test_unknown_task_returns_404(client, monkeypatch) -> None:
    async def missing(conn, task_id):
        return None

    monkeypatch.setattr(repo, "get_task", missing)

    response = client.get(
        f"/api/v1/verification/tasks/{uuid4()}", headers=auth_headers(SUPER_ID)
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_candidates_are_advisory_evidence(client, monkeypatch) -> None:
    async def fake_candidates(conn, submission_id):
        assert submission_id == SUBMISSION_ID
        return [_candidate_row()]

    monkeypatch.setattr(repo, "list_candidates", fake_candidates)

    response = client.get(
        f"/api/v1/verification/submissions/{SUBMISSION_ID}/candidates",
        headers=auth_headers(SUPER_ID),
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["data"]) == 1
    candidate = body["data"][0]
    assert candidate["institution_id"] == str(INSTITUTION_ID)
    assert candidate["evidence"] == ["exact_permanent_id"]
    assert candidate["is_eligible"] is True
    assert "subject" not in candidate


# ---------------------------------------------------------------------------
# Decisions
# ---------------------------------------------------------------------------
def test_confirm_requires_an_explicit_institution_and_reason(client, monkeypatch) -> None:
    async def unpatched(*_args, **_kwargs):  # pragma: no cover - must never run
        raise AssertionError("an invalid decision reached the repository")

    monkeypatch.setattr(repo, "decide", unpatched)

    missing_institution = client.post(
        f"/api/v1/verification/tasks/{TASK_ID}/decision",
        json={"action": "confirm", "reason": "exact permanent id"},
        headers=auth_headers(SUPER_ID),
    )
    assert missing_institution.status_code == 422
    assert missing_institution.json()["error"]["code"] == "VALIDATION_ERROR"

    missing_reason = client.post(
        f"/api/v1/verification/tasks/{TASK_ID}/decision",
        json={"action": "confirm", "institution_id": str(INSTITUTION_ID)},
        headers=auth_headers(SUPER_ID),
    )
    assert missing_reason.status_code == 422

    reject_with_institution = client.post(
        f"/api/v1/verification/tasks/{TASK_ID}/decision",
        json={
            "action": "reject",
            "institution_id": str(INSTITUTION_ID),
            "reason": "not a match",
        },
        headers=auth_headers(SUPER_ID),
    )
    assert reject_with_institution.status_code == 422


def test_confirm_passes_the_reviewers_explicit_selection(client, monkeypatch) -> None:
    captured: dict = {}

    async def fake_decide(conn, **kwargs):
        captured.update(kwargs)

    async def fake_get(conn, task_id):
        return _task_row(
            out_status="verified",
            out_reviewed_by_user_id=SUPER_ID,
            out_resolved_at=NOW,
            out_resolved_institution_id=INSTITUTION_ID,
            out_resolved_institution_name="Verified Institute",
            out_resolution_notes="exact permanent id",
        )

    monkeypatch.setattr(repo, "decide", fake_decide)
    monkeypatch.setattr(repo, "get_task", fake_get)

    response = client.post(
        f"/api/v1/verification/tasks/{TASK_ID}/decision",
        json={
            "action": "confirm",
            "institution_id": str(INSTITUTION_ID),
            "reason": "exact permanent id",
            "expected_updated_at": NOW.isoformat(),
        },
        headers=auth_headers(SUPER_ID),
    )
    assert response.status_code == 200
    assert captured["task_id"] == TASK_ID
    assert captured["action"] == "confirm"
    assert captured["institution_id"] == INSTITUTION_ID
    assert captured["reason"] == "exact permanent id"
    assert captured["expected_updated_at"] is not None
    assert response.json()["status"] == "verified"


def test_domain_errors_use_the_uniform_envelope(client, monkeypatch) -> None:
    async def conflict(conn, **kwargs):
        raise ApiError(
            403,
            "INDEPENDENT_REVIEW_REQUIRED",
            "The reviewer who requested this correction cannot confirm it.",
        )

    monkeypatch.setattr(repo, "decide", conflict)

    response = client.post(
        f"/api/v1/verification/tasks/{TASK_ID}/decision",
        json={
            "action": "confirm",
            "institution_id": str(INSTITUTION_ID),
            "reason": "second look",
        },
        headers=auth_headers(SUPER_ID),
    )
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "INDEPENDENT_REVIEW_REQUIRED"
    assert error["request_id"]


# ---------------------------------------------------------------------------
# Correction rounds
# ---------------------------------------------------------------------------
def test_correction_round_requires_a_reason(client, monkeypatch) -> None:
    async def unpatched(*_args, **_kwargs):  # pragma: no cover - must never run
        raise AssertionError("an invalid correction round reached the repository")

    monkeypatch.setattr(repo, "request_round", unpatched)

    response = client.post(
        f"/api/v1/verification/submissions/{SUBMISSION_ID}/correction-rounds",
        json={"reason": "   "},
        headers=auth_headers(SUPER_ID),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_correction_round_records_a_separate_task(client, monkeypatch) -> None:
    new_task_id = uuid4()
    captured: dict = {}

    async def fake_request(conn, **kwargs):
        captured.update(kwargs)
        return new_task_id

    async def fake_get(conn, task_id):
        assert task_id == new_task_id
        return _task_row(
            out_task_id=new_task_id,
            out_status="pending",
            out_priority="high",
            out_round_type="correction",
            out_requester_user_id=SUPER_ID,
            out_resolution_notes=(
                "[correction-request] requester="
                f"{SUPER_ID} at=2026-10-29T10:00:00.000Z\nPermanent id looked wrong"
            ),
            out_submission_institution_id=INSTITUTION_ID,
            out_submission_institution_name="Verified Institute",
            out_submission_institution_permanent_id="1-12345678",
            out_intake_status="awaiting_institution_verification",
        )

    monkeypatch.setattr(repo, "request_round", fake_request)
    monkeypatch.setattr(repo, "get_task", fake_get)

    response = client.post(
        f"/api/v1/verification/submissions/{SUBMISSION_ID}/correction-rounds",
        json={"reason": "Permanent id looked wrong"},
        headers=auth_headers(SUPER_ID),
    )
    assert response.status_code == 201
    assert captured["submission_id"] == SUBMISSION_ID
    assert captured["reason"] == "Permanent id looked wrong"
    body = response.json()
    assert body["id"] == str(new_task_id)
    assert body["round_type"] == "correction"
    assert body["requester_user_id"] == str(SUPER_ID)
    assert body["submission"]["institution_id"] == str(INSTITUTION_ID)


# ---------------------------------------------------------------------------
# SQLSTATE translation
# ---------------------------------------------------------------------------
class _FakeDatabaseError(Exception):
    def __init__(self, sqlstate: str) -> None:
        super().__init__(sqlstate)
        self.sqlstate = sqlstate


@pytest.mark.parametrize(
    ("sqlstate", "status_code", "code"),
    (
        ("42501", 403, "FORBIDDEN"),
        ("P2V01", 409, "STALE_WRITE"),
        ("P2V02", 404, "NOT_FOUND"),
        ("P2V04", 409, "IMMUTABLE_RECORD"),
        ("P2V05", 409, "INVARIANT_VIOLATION"),
        ("P2V06", 409, "CASE_LOCKED"),
        ("P2V09", 409, "INSTITUTION_NOT_ELIGIBLE"),
        ("P2V10", 409, "CASE_BLOCKED"),
        ("P2V11", 409, "ACTIVE_ROUND_EXISTS"),
        ("P2V12", 422, "INVALID_FILTER"),
        ("P2V14", 403, "INDEPENDENT_REVIEW_REQUIRED"),
        ("23505", 409, "CONFLICT"),
        ("XX000", 500, "DATABASE_ERROR"),
    ),
)
def test_sqlstates_map_to_stable_api_errors(sqlstate, status_code, code) -> None:
    error = _translate(_FakeDatabaseError(sqlstate))  # type: ignore[arg-type]
    assert error.status_code == status_code
    assert error.code == code


def test_unknown_database_error_never_echoes_internals() -> None:
    error = _translate(_FakeDatabaseError("XX000"))  # type: ignore[arg-type]
    assert "XX000" not in error.message
    assert "public." not in error.message
    assert error.details == []

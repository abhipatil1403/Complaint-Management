"""Phase 2.1 simulated intake: API contract and failure modes.

The database function is the security boundary (see tests/test_rls_db.py for
the live probes). These tests prove the FastAPI layer:

* never requires a token on the two simulated portals,
* passes complaint text through untouched,
* turns every function outcome into the documented envelope,
* hides complaint bodies from callers without ``submission.view``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from app.repositories import intake as intake_repo
from app.services.intake import SIMULATION_NOTICE_EN, SlidingWindowRateLimiter
from tests.conftest import AUDITOR_ID, SUPER_ID, auth_headers

SUBMISSION_ID = UUID("12345678-1234-5678-1234-567812345678")


def _receipt(**overrides) -> dict:
    row = {
        "outcome": "created",
        "submission_id": SUBMISSION_ID,
        "channel_code": "AICTE_SIM",
        "channel_name": "Simulated AICTE portal",
        "is_simulated": True,
        "external_reference": "SIM-AICTE_SIM-20261028-abcdef123456",
        "intake_status": "awaiting_institution_verification",
        "institution_resolved": False,
        "received_at": datetime(2026, 10, 20, 4, 55, tzinfo=timezone.utc),
    }
    row.update(overrides)
    return row


def _submission_row(**overrides) -> dict:
    row = {
        "id": SUBMISSION_ID,
        "external_reference": "SIM-AICTE_SIM-20261028-abcdef123456",
        "source_event_id": None,
        "received_at": datetime(2026, 10, 20, 4, 55, tzinfo=timezone.utc),
        "intake_status": "awaiting_institution_verification",
        "subject": "Water supply disruption",
        "original_text": "पानी की आपूर्ति ठप है — original text",
        "original_language": "hi",
        "normalized_text": None,
        "normalization_version": None,
        "institution_id": None,
        "institution_name_as_submitted": "Illustrative Institute",
        "canonical_case_id": None,
        "content_fingerprint": "a" * 64,
        "source_metadata": {
            "source_submitted_at": "2026-10-20T04:55:00.000Z",
            "reference_origin": "demo_generated",
            "simulation_notice_version": "SIM-NOTICE-2026-10-29-v1",
            "consent_acknowledged": True,
        },
        "created_at": datetime(2026, 10, 20, 4, 55, tzinfo=timezone.utc),
        "channel_code": "AICTE_SIM",
        "channel_name": "Simulated AICTE portal",
        "channel_is_simulated": True,
        "aicte_permanent_id": None,
        "official_name": None,
    }
    row.update(overrides)
    return row


def _body(**overrides) -> dict:
    body = {
        "institution_permanent_id": None,
        "institution_name_as_submitted": "Illustrative Institute",
        "subject": "Water supply disruption",
        "description": "पानी की आपूर्ति ठप है — original text",
        "language": "hi",
        "source_event_id": "evt-0001",
        "source_submitted_at": "2026-10-20T10:25:00+05:30",
        "consent_acknowledged": True,
    }
    body.update(overrides)
    return body


@pytest.fixture()
def captured(monkeypatch):
    """Replace the SQL call; capture what the API passed down."""
    state: dict = {"kwargs": None, "result": _receipt()}

    async def fake_create(conn, **kwargs):
        state["kwargs"] = kwargs
        return state["result"]

    monkeypatch.setattr(intake_repo, "create_submission", fake_create)
    return state


# ---------------------------------------------------------------------------
# Public simulated portals
# ---------------------------------------------------------------------------
def test_public_submission_needs_no_token_and_marks_the_simulation(client, captured) -> None:
    response = client.post(
        "/api/v1/demo/intake/aicte_sim/submissions",
        json=_body(),
        headers={"Idempotency-Key": "idem-0001"},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["outcome"] == "created"
    assert body["replayed"] is False
    assert body["submission_id"] == str(SUBMISSION_ID)
    assert body["intake_status"] == "awaiting_institution_verification"
    assert body["institution_resolved"] is False
    assert body["channel"] == {
        "code": "AICTE_SIM",
        "name": "Simulated AICTE portal",
        "is_simulated": True,
    }
    assert body["demo_notice"] == SIMULATION_NOTICE_EN
    assert "not a real complaint portal" in body["demo_notice"]
    assert body["simulation_notice_version"] == "SIM-NOTICE-2026-10-29-v1"
    # Complaint content is never echoed back.
    assert "पानी" not in response.text

    sent = captured["kwargs"]
    assert sent["channel_code"] == "AICTE_SIM"
    assert sent["idempotency_key"] == "idem-0001"
    assert sent["language"] == "hi"
    assert sent["description"] == _body()["description"]


def test_submission_uses_the_dedicated_intake_role(client, captured) -> None:
    response = client.post("/api/v1/demo/intake/CPGRAMS_SIM/submissions", json=_body())
    assert response.status_code == 201, response.text
    assert client.app.state.db.last_role == "one_desk_intake"


def test_subject_and_body_are_forwarded_verbatim(client, captured) -> None:
    subject = "  Spacing, punctuation… and (brackets)  "
    description = "  line one\r\nline two\t— हिंदी \u2014 देवनागरी  "
    response = client.post(
        "/api/v1/demo/intake/AICTE_SIM/submissions",
        json=_body(subject=subject, description=description),
    )
    assert response.status_code == 201, response.text
    assert captured["kwargs"]["subject"] == subject
    assert captured["kwargs"]["description"] == description


def test_replay_returns_200_with_the_same_submission(client, captured) -> None:
    captured["result"] = _receipt(outcome="replay")
    response = client.post("/api/v1/demo/intake/AICTE_SIM/submissions", json=_body())
    assert response.status_code == 200, response.text
    assert response.json()["outcome"] == "replay"
    assert response.json()["replayed"] is True
    assert response.json()["submission_id"] == str(SUBMISSION_ID)


def test_conflict_returns_409_without_identifiers(client, captured) -> None:
    captured["result"] = {
        "outcome": "conflict",
        "code": "IDEMPOTENCY_PAYLOAD_MISMATCH",
    }
    response = client.post("/api/v1/demo/intake/AICTE_SIM/submissions", json=_body())
    assert response.status_code == 409
    body = response.json()["error"]
    assert body["code"] == "IDEMPOTENCY_CONFLICT"
    assert body["details"] == [
        {"field": "idempotency_key", "issue": "IDEMPOTENCY_PAYLOAD_MISMATCH"}
    ]
    assert "submission_id" not in response.text


def test_database_validation_error_maps_to_a_safe_field_message(client, captured) -> None:
    captured["result"] = {
        "outcome": "validation_error",
        "code": "TEXT_REQUIRED",
        "field": "original_text",
    }
    payload = _body()
    response = client.post("/api/v1/demo/intake/AICTE_SIM/submissions", json=payload)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["details"][0]["field"] == "description"
    assert payload["description"] not in response.text


def test_unknown_channel_returns_404(client, captured) -> None:
    captured["result"] = {"outcome": "channel_unavailable", "code": "INTAKE_CHANNEL_UNAVAILABLE"}
    response = client.post("/api/v1/demo/intake/NOPE_SIM/submissions", json=_body())
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "INTAKE_CHANNEL_UNAVAILABLE"


def test_unknown_function_outcome_fails_closed(client, captured) -> None:
    captured["result"] = {"outcome": "something_new"}
    response = client.post("/api/v1/demo/intake/AICTE_SIM/submissions", json=_body())
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "INTAKE_UNAVAILABLE"


def test_rate_limit_returns_429_and_retry_after(client, captured) -> None:
    client.app.state.intake_service.limiter = SlidingWindowRateLimiter(1, 60)
    first = client.post("/api/v1/demo/intake/AICTE_SIM/submissions", json=_body())
    second = client.post("/api/v1/demo/intake/AICTE_SIM/submissions", json=_body())
    assert first.status_code == 201
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "RATE_LIMITED"
    assert int(second.headers["Retry-After"]) >= 1
    assert captured["kwargs"] is not None  # only the first call reached the repository


def test_disabled_demo_returns_404(client, captured) -> None:
    client.app.state.settings.demo_intake_enabled = False
    response = client.post("/api/v1/demo/intake/AICTE_SIM/submissions", json=_body())
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "INTAKE_DISABLED"
    assert captured["kwargs"] is None


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"consent_acknowledged": False}, None),
        ({"consent_acknowledged": True, "subject": "   "}, "subject"),
        ({"description": ""}, "description"),
        ({"language": "fr"}, "language"),
        ({"institution_permanent_id": None, "institution_name_as_submitted": None}, None),
    ],
)
def test_schema_validation_rejects_malformed_requests(client, captured, overrides, field) -> None:
    response = client.post(
        "/api/v1/demo/intake/AICTE_SIM/submissions", json=_body(**overrides)
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    if field:
        assert any(d["field"] == field for d in response.json()["error"]["details"])
    assert captured["kwargs"] is None


def test_naive_source_timestamp_is_rejected(client, captured) -> None:
    response = client.post(
        "/api/v1/demo/intake/AICTE_SIM/submissions",
        json=_body(source_submitted_at="2026-10-20T10:25:00"),
    )
    assert response.status_code == 422
    assert any(
        detail["field"] == "source_submitted_at"
        for detail in response.json()["error"]["details"]
    )
    assert captured["kwargs"] is None


def test_source_timestamp_is_normalised_to_utc(client, captured) -> None:
    response = client.post(
        "/api/v1/demo/intake/AICTE_SIM/submissions",
        json=_body(source_submitted_at="2026-10-20T10:25:00+05:30"),
    )
    assert response.status_code == 201, response.text
    passed = captured["kwargs"]["source_submitted_at"]
    assert passed == datetime(2026, 10, 20, 4, 55, tzinfo=timezone.utc)


def test_invalid_channel_code_and_overlong_key_are_rejected(client, captured) -> None:
    bad_channel = client.post(
        "/api/v1/demo/intake/" + "x" * 33 + "/submissions", json=_body()
    )
    assert bad_channel.status_code == 422

    long_key = client.post(
        "/api/v1/demo/intake/AICTE_SIM/submissions",
        json=_body(),
        headers={"Idempotency-Key": "k" * 129},
    )
    assert long_key.status_code == 422
    assert long_key.json()["error"]["details"][0]["field"] == "idempotency_key"
    assert captured["kwargs"] is None


# ---------------------------------------------------------------------------
# Authorized read surface
# ---------------------------------------------------------------------------
def test_list_requires_the_global_submission_view_capability(client, monkeypatch) -> None:
    async def fake_list(conn, **kwargs):
        return [_submission_row()]

    monkeypatch.setattr(intake_repo, "list_submissions", fake_list)

    denied = client.get("/api/v1/submissions", headers=auth_headers(AUDITOR_ID))
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "GLOBAL_CAPABILITY_REQUIRED"

    allowed = client.get("/api/v1/submissions", headers=auth_headers(SUPER_ID))
    assert allowed.status_code == 200, allowed.text
    body = allowed.json()
    assert body["data"][0]["id"] == str(SUBMISSION_ID)
    # Index responses must not carry complaint bodies.
    assert "original_text" not in body["data"][0]


def test_detail_requires_the_capability_and_returns_the_original_text(client, monkeypatch) -> None:
    async def fake_get(conn, submission_id):
        return _submission_row(id=submission_id)

    monkeypatch.setattr(intake_repo, "get_submission", fake_get)

    denied = client.get(f"/api/v1/submissions/{SUBMISSION_ID}", headers=auth_headers(AUDITOR_ID))
    assert denied.status_code == 403

    allowed = client.get(f"/api/v1/submissions/{SUBMISSION_ID}", headers=auth_headers(SUPER_ID))
    assert allowed.status_code == 200, allowed.text
    body = allowed.json()
    assert body["original_text"] == "पानी की आपूर्ति ठप है — original text"
    assert body["original_language"] == "hi"
    assert body["source_submitted_at"] == "2026-10-20T04:55:00.000Z"
    assert body["reference_origin"] == "demo_generated"
    assert body["consent_acknowledged"] is True
    assert body["canonical_case_id"] is None


def test_missing_submission_returns_404(client, monkeypatch) -> None:
    async def missing(conn, submission_id):
        return None

    monkeypatch.setattr(intake_repo, "get_submission", missing)
    response = client.get(f"/api/v1/submissions/{uuid4()}", headers=auth_headers(SUPER_ID))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_list_filters_are_validated(client, monkeypatch) -> None:
    async def fake_list(conn, **kwargs):
        return []

    monkeypatch.setattr(intake_repo, "list_submissions", fake_list)

    for query in ("intake_status=nonsense", "language=fr", "channel_code=bad code"):
        response = client.get(f"/api/v1/submissions?{query}", headers=auth_headers(SUPER_ID))
        assert response.status_code == 422, query


def test_rate_limiter_is_scoped_per_client_and_channel() -> None:
    limiter = SlidingWindowRateLimiter(2, 60, clock=lambda: 100.0)
    assert limiter.hit("1.2.3.4|AICTE_SIM") == 0
    assert limiter.hit("1.2.3.4|AICTE_SIM") == 0
    assert limiter.hit("1.2.3.4|AICTE_SIM") == 60
    assert limiter.hit("1.2.3.4|CPGRAMS_SIM") == 0
    assert limiter.hit("5.6.7.8|AICTE_SIM") == 0

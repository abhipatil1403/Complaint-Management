"""Phase 3 and Phase 4 Operations, Bureau Workflow & Cross-Bureau Controls Tests.

Verifies status transitions, bureau assignments, officer assignments, shared & private notes,
attachments, case transfers, cross-bureau access requests and grants.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from app.auth import permissions as perms
from app.core.errors import ApiError
from app.repositories import cases as repo
from tests.conftest import (
    AUDITOR_ID,
    PGRC_ID,
    PGRC_OFFICER_ID,
    RB_ADMIN_ID,
    RB_ID,
    SENIOR_ID,
    SUPER_ID,
    auth_headers,
)

CASE_ID = uuid4()
BUREAU_ID = uuid4()
ASSIGNMENT_ID = uuid4()
NOTE_ID = uuid4()
ATTACHMENT_ID = uuid4()
TRANSFER_ID = uuid4()
ACCESS_REQUEST_ID = uuid4()
GRANT_ID = uuid4()
NOW = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)


# --- 1. Status Transitions ---

def test_status_transition_unauthenticated(client):
    resp = client.post(f"/api/v1/cases/{CASE_ID}/status-transitions", json={"to_status": "in_progress", "reason": "Moving along"})
    assert resp.status_code == 401


def test_status_transition_forbidden_for_auditor(client):
    headers = auth_headers(AUDITOR_ID)
    resp = client.post(
        f"/api/v1/cases/{CASE_ID}/status-transitions",
        json={"to_status": "in_progress", "reason": "Audit review"},
        headers=headers,
    )
    assert resp.status_code == 403


def test_status_transition_success_for_officer(client, monkeypatch):
    async def mock_transition(conn, *, case_id, to_status, reason, expected_updated_at):
        return {
            "case_id": str(case_id),
            "previous_status": "under_review",
            "new_status": to_status,
            "updated_at": NOW.isoformat(),
        }

    monkeypatch.setattr(repo, "transition_case_status", mock_transition)

    headers = auth_headers(PGRC_OFFICER_ID, bureau_id=PGRC_ID)
    resp = client.post(
        f"/api/v1/cases/{CASE_ID}/status-transitions",
        json={"to_status": "in_progress", "reason": "Investigation ongoing"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["new_status"] == "in_progress"


# --- 2. Bureau & Officer Assignments ---

def test_bureau_assignment_success_for_bureau_admin(client, monkeypatch):
    async def mock_assign_bureau(conn, *, case_id, bureau_id, assignment_type, reason):
        return ASSIGNMENT_ID

    monkeypatch.setattr(repo, "assign_case_bureau", mock_assign_bureau)

    headers = auth_headers(RB_ADMIN_ID, bureau_id=RB_ID)
    resp = client.post(
        f"/api/v1/cases/{CASE_ID}/bureau-assignments",
        json={"bureau_id": str(BUREAU_ID), "assignment_type": "collaborating", "reason": "Assisting with technical audit"},
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["assignment_id"] == str(ASSIGNMENT_ID)


def test_officer_assignment_success_for_bureau_admin(client, monkeypatch):
    async def mock_assign_officer(conn, *, case_bureau_assignment_id, officer_user_id, role, notes):
        return uuid4()

    monkeypatch.setattr(repo, "assign_case_officer", mock_assign_officer)

    headers = auth_headers(RB_ADMIN_ID, bureau_id=RB_ID)
    resp = client.post(
        f"/api/v1/bureau-assignments/{ASSIGNMENT_ID}/officer-assignments",
        json={"officer_user_id": str(PGRC_OFFICER_ID), "role": "lead_officer", "notes": "Primary investigator"},
        headers=headers,
    )
    assert resp.status_code == 201
    assert "officer_assignment_id" in resp.json()


# --- 3. Internal Notes (Shared & Private) ---

def test_create_and_list_notes(client, monkeypatch):
    async def mock_create_note(conn, *, case_id, note_text, visibility, note_type, bureau_id, is_pinned):
        return NOTE_ID

    async def mock_list_notes(conn, case_id):
        return [
            {
                "note_id": NOTE_ID,
                "case_id": case_id,
                "author_user_id": PGRC_OFFICER_ID,
                "author_name": "PGRC Officer",
                "bureau_id": BUREAU_ID,
                "bureau_name": "Public Grievance Redressal Cell",
                "bureau_code": "PGRC",
                "note_text": "Meeting held with college principal.",
                "visibility": "shared",
                "note_type": "internal_review",
                "is_pinned": True,
                "edited_at": None,
                "created_at": NOW,
            }
        ]

    monkeypatch.setattr(repo, "create_case_note", mock_create_note)
    monkeypatch.setattr(repo, "list_case_notes", mock_list_notes)

    headers = auth_headers(PGRC_OFFICER_ID, bureau_id=PGRC_ID)

    # Create note
    create_resp = client.post(
        f"/api/v1/cases/{CASE_ID}/notes",
        json={"note_text": "Meeting held with college principal.", "visibility": "shared", "note_type": "internal_review"},
        headers=headers,
    )
    assert create_resp.status_code == 201
    assert create_resp.json()["note_id"] == str(NOTE_ID)

    # List notes
    list_resp = client.get(f"/api/v1/cases/{CASE_ID}/notes", headers=headers)
    assert list_resp.status_code == 200
    notes = list_resp.json()
    assert len(notes) == 1
    assert notes[0]["visibility"] == "shared"
    assert notes[0]["is_pinned"] is True


def test_edit_and_delete_note(client, monkeypatch):
    async def mock_update_note(conn, *, note_id, note_text, is_pinned):
        return True

    async def mock_delete_note(conn, *, note_id):
        return True

    monkeypatch.setattr(repo, "update_case_note", mock_update_note)
    monkeypatch.setattr(repo, "soft_delete_case_note", mock_delete_note)

    headers = auth_headers(PGRC_OFFICER_ID, bureau_id=PGRC_ID)

    patch_resp = client.patch(
        f"/api/v1/cases/{CASE_ID}/notes/{NOTE_ID}",
        json={"note_text": "Updated note content", "is_pinned": False},
        headers=headers,
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["success"] is True

    del_resp = client.delete(f"/api/v1/cases/{CASE_ID}/notes/{NOTE_ID}", headers=headers)
    assert del_resp.status_code == 200
    assert del_resp.json()["success"] is True


# --- 4. Attachments & Evidence ---

def test_attachment_registration_and_retrieval(client, monkeypatch):
    async def mock_register(conn, **kwargs):
        return ATTACHMENT_ID

    async def mock_list(conn, case_id):
        return [
            {
                "attachment_id": ATTACHMENT_ID,
                "case_id": case_id,
                "submission_id": None,
                "uploaded_by_user_id": PGRC_OFFICER_ID,
                "uploader_name": "PGRC Officer",
                "original_filename": "affidavit.pdf",
                "storage_bucket": "complaint-evidence",
                "storage_path": "cases/affidavit.pdf",
                "mime_type": "application/pdf",
                "file_size_bytes": 102400,
                "sha256_checksum": "a" * 64,
                "attachment_type": "evidence",
                "upload_status": "verified",
                "description": "Signed affidavit",
                "uploaded_at": NOW,
                "verified_at": NOW,
            }
        ]

    monkeypatch.setattr(repo, "register_case_attachment", mock_register)
    monkeypatch.setattr(repo, "list_case_attachments", mock_list)

    headers = auth_headers(PGRC_OFFICER_ID, bureau_id=PGRC_ID)

    post_resp = client.post(
        f"/api/v1/cases/{CASE_ID}/attachments",
        json={
            "original_filename": "affidavit.pdf",
            "storage_path": "cases/affidavit.pdf",
            "mime_type": "application/pdf",
            "file_size_bytes": 102400,
            "attachment_type": "evidence",
        },
        headers=headers,
    )
    assert post_resp.status_code == 201
    assert post_resp.json()["attachment_id"] == str(ATTACHMENT_ID)

    get_resp = client.get(f"/api/v1/cases/{CASE_ID}/attachments", headers=headers)
    assert get_resp.status_code == 200
    atts = get_resp.json()
    assert len(atts) == 1
    assert atts[0]["original_filename"] == "affidavit.pdf"


# --- 5. Case Transfers ---

def test_case_transfer_workflow(client, monkeypatch):
    async def mock_request_transfer(conn, **kwargs):
        return TRANSFER_ID

    async def mock_decide_transfer(conn, *, transfer_id, decision, decision_notes):
        return True

    monkeypatch.setattr(repo, "request_case_transfer", mock_request_transfer)
    monkeypatch.setattr(repo, "decide_case_transfer", mock_decide_transfer)

    headers = auth_headers(PGRC_OFFICER_ID, bureau_id=PGRC_ID)

    # Request transfer
    req_resp = client.post(
        f"/api/v1/cases/{CASE_ID}/transfers",
        json={
            "from_bureau_assignment_id": str(ASSIGNMENT_ID),
            "to_bureau_id": str(BUREAU_ID),
            "transfer_type": "handover",
            "reason": "Regulatory compliance matter falls under RB jurisdiction",
        },
        headers=headers,
    )
    assert req_resp.status_code == 201
    assert req_resp.json()["transfer_id"] == str(TRANSFER_ID)

    # Decide transfer (Bureau Admin)
    admin_headers = auth_headers(RB_ADMIN_ID, bureau_id=RB_ID)
    dec_resp = client.post(
        f"/api/v1/transfers/{TRANSFER_ID}/decision",
        json={"decision": "approved", "decision_notes": "Accepted under RB mandate"},
        headers=admin_headers,
    )
    assert dec_resp.status_code == 200
    assert dec_resp.json()["success"] is True


# --- 6. Cross-Bureau Access Requests & Grants ---

def test_access_request_and_grant_workflow(client, monkeypatch):
    async def mock_request_access(conn, **kwargs):
        return ACCESS_REQUEST_ID

    async def mock_list_requests(conn, *, status="pending", limit=50, offset=0):
        return [
            {
                "request_id": ACCESS_REQUEST_ID,
                "case_id": CASE_ID,
                "case_number": "CASE-2026-000001",
                "institution_name": "ABC College of Engineering",
                "requester_user_id": PGRC_OFFICER_ID,
                "requester_name": "PGRC Officer",
                "requesting_bureau_id": BUREAU_ID,
                "requesting_bureau_name": "PGRC",
                "requested_access_level": "details",
                "request_reason": "Cross-verification of faculty complaint",
                "request_status": "pending",
                "requested_at": NOW,
                "reviewed_by_user_id": None,
                "reviewed_at": None,
                "decision_reason": None,
            }
        ]

    async def mock_decide_access(conn, *, request_id, decision, decision_reason, expires_at=None):
        return GRANT_ID

    async def mock_list_grants(conn, case_id):
        return [
            {
                "grant_id": GRANT_ID,
                "case_id": case_id,
                "grantee_user_id": PGRC_OFFICER_ID,
                "grantee_name": "PGRC Officer",
                "access_request_id": ACCESS_REQUEST_ID,
                "access_level": "details",
                "grant_reason": "Approved for 7 days cross-verification",
                "granted_by_user_id": SUPER_ID,
                "granted_by_name": "Super Admin",
                "granted_at": NOW,
                "expires_at": None,
                "revoked_at": None,
                "revoked_by_user_id": None,
                "revocation_reason": None,
                "is_active": True,
            }
        ]

    async def mock_revoke_grant(conn, *, grant_id, revocation_reason):
        return True

    monkeypatch.setattr(repo, "request_case_access", mock_request_access)
    monkeypatch.setattr(repo, "list_case_access_requests", mock_list_requests)
    monkeypatch.setattr(repo, "decide_case_access_request", mock_decide_access)
    monkeypatch.setattr(repo, "list_case_access_grants", mock_list_grants)
    monkeypatch.setattr(repo, "revoke_case_access_grant", mock_revoke_grant)

    # 1. Request access
    officer_headers = auth_headers(PGRC_OFFICER_ID, bureau_id=PGRC_ID)
    req_resp = client.post(
        f"/api/v1/cases/{CASE_ID}/access-requests",
        json={"access_level": "details", "reason": "Cross-verification of faculty complaint"},
        headers=officer_headers,
    )
    assert req_resp.status_code == 201
    assert req_resp.json()["request_id"] == str(ACCESS_REQUEST_ID)

    # 2. View queue as Senior Management / Approver
    senior_headers = auth_headers(SENIOR_ID)
    queue_resp = client.get("/api/v1/access-requests", headers=senior_headers)
    assert queue_resp.status_code == 200
    queue = queue_resp.json()
    assert len(queue) == 1
    assert queue[0]["request_id"] == str(ACCESS_REQUEST_ID)

    # 3. Approve request
    dec_resp = client.post(
        f"/api/v1/access-requests/{ACCESS_REQUEST_ID}/decision",
        json={"decision": "approved", "decision_reason": "Approved for 7 days cross-verification"},
        headers=senior_headers,
    )
    assert dec_resp.status_code == 200
    assert dec_resp.json()["grant_id"] == str(GRANT_ID)

    # 4. View active grants
    grants_resp = client.get(f"/api/v1/cases/{CASE_ID}/access-grants", headers=senior_headers)
    assert grants_resp.status_code == 200
    grants = grants_resp.json()
    assert len(grants) == 1
    assert grants[0]["is_active"] is True

    # 5. Revoke grant (requires CASE.ACCESS.REVOKE - SUPER_ADMIN or BUREAU_ADMIN)
    super_headers = auth_headers(SUPER_ID)
    revoke_resp = client.post(
        f"/api/v1/access-grants/{GRANT_ID}/revoke",
        json={"revocation_reason": "Audit review concluded"},
        headers=super_headers,
    )
    assert revoke_resp.status_code == 200
    assert revoke_resp.json()["success"] is True


def test_attachment_quarantine_and_download_security(client, monkeypatch) -> None:
    """Tests MIME/size validation, quarantine enforcement, and secure download blocking."""
    super_headers = auth_headers(SUPER_ID)
    officer_headers = auth_headers(PGRC_OFFICER_ID, bureau_id=PGRC_ID)

    # 1. Negative MIME validation: Disallowed executable MIME type
    bad_mime_resp = client.post(
        f"/api/v1/cases/{CASE_ID}/attachments",
        json={
            "original_filename": "malware.exe",
            "storage_path": "cases/malware.exe",
            "mime_type": "application/x-msdownload",
            "file_size_bytes": 1024,
            "attachment_type": "supporting_document",
        },
        headers=officer_headers,
    )
    assert bad_mime_resp.status_code == 422
    assert "MIME type" in bad_mime_resp.text

    # 2. Negative Size validation: Exceeds 25MB
    oversized_resp = client.post(
        f"/api/v1/cases/{CASE_ID}/attachments",
        json={
            "original_filename": "huge_dump.pdf",
            "storage_path": "cases/huge.pdf",
            "mime_type": "application/pdf",
            "file_size_bytes": 30 * 1024 * 1024,
            "attachment_type": "evidence",
        },
        headers=officer_headers,
    )
    assert oversized_resp.status_code == 422

    # 3. Unauthorized quarantine attempt: Case officer lacks ATTACHMENT.QUARANTINE
    unauth_quarantine = client.post(
        f"/api/v1/cases/{CASE_ID}/attachments/{ATTACHMENT_ID}/quarantine",
        json={"reason": "Suspicious signature"},
        headers=officer_headers,
    )
    assert unauth_quarantine.status_code == 403

    # 4. Authorized quarantine by Super Admin
    async def mock_quarantine(conn, *, attachment_id, reason):
        return True

    monkeypatch.setattr(repo, "quarantine_case_attachment", mock_quarantine)
    quarantine_resp = client.post(
        f"/api/v1/cases/{CASE_ID}/attachments/{ATTACHMENT_ID}/quarantine",
        json={"reason": "Contains potential phishing links"},
        headers=super_headers,
    )
    assert quarantine_resp.status_code == 200
    assert quarantine_resp.json()["success"] is True

    # 5. Download attempt on quarantined file is blocked
    async def mock_download_quarantined(conn, *, case_id, attachment_id):
        raise ApiError(
            status_code=403,
            code="QUARANTINED_FILE",
            message="Attachment has been quarantined for security and cannot be downloaded.",
        )

    monkeypatch.setattr(repo, "get_case_attachment_for_download", mock_download_quarantined)
    dl_resp = client.get(
        f"/api/v1/cases/{CASE_ID}/attachments/{ATTACHMENT_ID}/download",
        headers=super_headers,
    )
    assert dl_resp.status_code == 403
    assert dl_resp.json()["error"]["code"] == "QUARANTINED_FILE"

    # 6. Authorized download on clean file succeeds with authorized path
    async def mock_download_clean(conn, *, case_id, attachment_id):
        return {
            "id": attachment_id,
            "case_id": case_id,
            "original_filename": "evidence.pdf",
            "storage_bucket": "complaint-evidence",
            "storage_path": "cases/evidence.pdf",
            "mime_type": "application/pdf",
            "file_size_bytes": 2048,
            "sha256_checksum": "a" * 64,
            "upload_status": "verified",
        }

    monkeypatch.setattr(repo, "get_case_attachment_for_download", mock_download_clean)
    dl_clean_resp = client.get(
        f"/api/v1/cases/{CASE_ID}/attachments/{ATTACHMENT_ID}/download",
        headers=super_headers,
    )
    assert dl_clean_resp.status_code == 200
    body = dl_clean_resp.json()
    assert body["original_filename"] == "evidence.pdf"
    assert "/storage/v1/object/authenticated/" in body["download_url"]


def test_cross_bureau_negative_authorization_matrix(client) -> None:
    """Verifies that unprivileged roles are strictly forbidden across every action."""
    auditor_headers = auth_headers(AUDITOR_ID)
    officer_headers = auth_headers(PGRC_OFFICER_ID, bureau_id=PGRC_ID)

    # Auditor cannot change case status (requires CASE.STATUS.CHANGE)
    res = client.post(
        f"/api/v1/cases/{CASE_ID}/status",
        json={"to_status": "in_progress", "reason": "Audit review"},
        headers=auditor_headers,
    )
    assert res.status_code == 403

    # Auditor cannot assign bureau (requires CASE.ASSIGN.BUREAU)
    res = client.post(
        f"/api/v1/cases/{CASE_ID}/bureau-assignments",
        json={"bureau_id": str(BUREAU_ID), "assignment_type": "collaborator"},
        headers=auditor_headers,
    )
    assert res.status_code == 403

    # Officer cannot decide case transfers (requires CASE.TRANSFER.DECIDE - Super Admin or Bureau Admin)
    res = client.post(
        f"/api/v1/transfers/{TRANSFER_ID}/decision",
        json={"decision": "approved", "decision_notes": "Officer approval"},
        headers=officer_headers,
    )
    assert res.status_code == 403

    # Officer cannot approve access requests (requires CASE.ACCESS.APPROVE)
    res = client.post(
        f"/api/v1/access-requests/{ACCESS_REQUEST_ID}/decision",
        json={"decision": "approved", "decision_reason": "Officer approval"},
        headers=officer_headers,
    )
    assert res.status_code == 403

    # Auditor cannot register attachments (requires ATTACHMENT.UPLOAD)
    res = client.post(
        f"/api/v1/cases/{CASE_ID}/attachments",
        json={
            "original_filename": "doc.pdf",
            "storage_path": "cases/doc.pdf",
            "mime_type": "application/pdf",
            "file_size_bytes": 1024,
            "attachment_type": "evidence",
        },
        headers=auditor_headers,
    )
    assert res.status_code == 403


def test_concurrency_and_conflict_rejections(client, monkeypatch) -> None:
    """Verifies handling of conflicting/concurrent writes and domain constraint violations."""
    super_headers = auth_headers(SUPER_ID)

    # 1. Stale token / concurrent modification on status transition
    async def mock_stale_status(*args, **kwargs):
        raise ApiError(status_code=409, code="STALE_WRITE", message="Case was modified by another user.")

    monkeypatch.setattr(repo, "transition_case_status", mock_stale_status)
    res = client.post(
        f"/api/v1/cases/{CASE_ID}/status",
        json={"to_status": "in_progress", "reason": "Starting investigation", "expected_updated_at": NOW.isoformat()},
        headers=super_headers,
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "STALE_WRITE"

    # 2. Officer not member of bureau conflict
    async def mock_officer_conflict(*args, **kwargs):
        raise ApiError(status_code=409, code="OFFICER_NOT_MEMBER", message="Officer does not have active membership.")

    monkeypatch.setattr(repo, "assign_case_officer", mock_officer_conflict)
    res = client.post(
        f"/api/v1/bureau-assignments/{ASSIGNMENT_ID}/officer-assignments",
        json={"officer_user_id": str(uuid4())},
        headers=super_headers,
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "OFFICER_NOT_MEMBER"

    # 3. Same-bureau transfer rejection
    async def mock_same_bureau(*args, **kwargs):
        raise ApiError(status_code=409, code="SAME_BUREAU_TRANSFER", message="Cannot transfer to the same bureau.")

    monkeypatch.setattr(repo, "request_case_transfer", mock_same_bureau)
    res = client.post(
        f"/api/v1/cases/{CASE_ID}/transfers",
        json={"from_bureau_assignment_id": str(ASSIGNMENT_ID), "to_bureau_id": str(BUREAU_ID), "reason": "Self transfer"},
        headers=super_headers,
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "SAME_BUREAU_TRANSFER"

    # 4. Already resolved access request conflict
    async def mock_already_resolved(*args, **kwargs):
        raise ApiError(status_code=409, code="ALREADY_RESOLVED", message="Access request is already resolved.")

    monkeypatch.setattr(repo, "decide_case_access_request", mock_already_resolved)
    res = client.post(
        f"/api/v1/access-requests/{ACCESS_REQUEST_ID}/decision",
        json={"decision": "approved", "decision_reason": "Second decision"},
        headers=super_headers,
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "ALREADY_RESOLVED"

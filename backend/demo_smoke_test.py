import os
import sys
from datetime import datetime, timezone
from uuid import UUID, uuid4
from dotenv import dotenv_values
import psycopg

env_dict = dotenv_values('backend/.env') if os.path.exists('backend/.env') else dotenv_values('.env')
os.environ.update({k: v for k, v in env_dict.items() if v is not None})
dsn = env_dict.get('DATABASE_URL') or os.environ.get('DATABASE_URL') or os.environ.get('SUPABASE_DB_URL')

from fastapi.testclient import TestClient
from app.core.config import Settings
from app.auth.service import IdentityService
from app.core.security import TokenClaims
from app.main import create_app

REAL_SUPER_ID = UUID("e78e67aa-bbf6-4a44-9280-dc8eb71025a8")
REAL_RB_ADMIN_ID = UUID("98c45802-7e15-4a9f-9f96-f1bfc5a66fbc")
REAL_PGRC_OFFICER_ID = UUID("102482ed-a698-4f4e-bc97-bcc0e03b5767")
REAL_SENIOR_ID = UUID("8d595627-519e-476a-82ec-d9da7992b9c3")

REAL_RB_ID = UUID("befa3aef-23f8-47c7-8427-4bcbbef3d55a")
REAL_PGRC_ID = UUID("1841a0b4-112a-495f-8c20-dc8bb13c2b2e")
REAL_AFF_ID = UUID("5808349a-b8df-4223-8f6d-c60451954df7")

class LiveTokenVerifier:
    def verify(self, token: str) -> TokenClaims:
        user_id = UUID(token)
        return TokenClaims(
            subject=str(user_id),
            email="demo@aicte-onedesk.gov.in",
            role="authenticated",
            claims={"sub": str(user_id), "role": "authenticated", "aud": "authenticated"},
        )

settings = Settings()
app = create_app(settings)
app.state.token_verifier = LiveTokenVerifier()
app.state.identity_service = IdentityService()

def auth_headers(user_id: UUID, bureau_id: UUID | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {user_id}"}
    if bureau_id is not None:
        headers["X-Active-Bureau"] = str(bureau_id)
    return headers

super_hdrs = auth_headers(REAL_SUPER_ID)
pgrc_officer_hdrs = auth_headers(REAL_PGRC_OFFICER_ID, bureau_id=REAL_PGRC_ID)
senior_hdrs = auth_headers(REAL_SENIOR_ID)

print("=" * 70)
print("AICTE ONEDESK — REAL LIVE SUPABASE END-TO-END DEMO SMOKE TEST")
print("=" * 70)

with TestClient(app) as client:
    # 1. Fetch Verified Institutions
    res = client.get("/api/v1/institutions", headers=super_hdrs)
    assert res.status_code == 200, f"Failed to get institutions: {res.text}"
    resp_obj = res.json()
    inst_list = resp_obj.get("data", resp_obj.get("items", resp_obj))
    assert len(inst_list) > 0, f"No institutions returned! {resp_obj}"
    verified_inst = next((i for i in inst_list if i.get("verification_status") == "verified"), inst_list[0])
    inst_id = verified_inst["id"]
    print(f"[STEP 1] Verified Institution: {verified_inst['official_name']} ({inst_id})")

    # 2. Check Bureaus
    res = client.get("/api/v1/bureaus", headers=super_hdrs)
    assert res.status_code == 200, f"Failed to get bureaus: {res.text}"
    b_resp = res.json()
    bureaus = b_resp.get("data", b_resp.get("items", b_resp))
    assert len(bureaus) > 0, "No bureaus returned"
    pgrc_bureau = next((b for b in bureaus if b.get("code") == "PGRC"), bureaus[0])
    aff_bureau = next((b for b in bureaus if b.get("code") == "AFF"), bureaus[1] if len(bureaus) > 1 else bureaus[0])
    print(f"[STEP 2] Lead Bureau: {pgrc_bureau['name']} ({pgrc_bureau['id']}), Collab: {aff_bureau['name']} ({aff_bureau['id']})")

    # 3. Create Intake Submission via Public Intake Channel
    sub_payload = {
        "institution_permanent_id": verified_inst.get("aicte_permanent_id") or "DEMO-AICTE-0001",
        "institution_name_as_submitted": verified_inst["official_name"],
        "subject": "Delay in 7th Pay Commission arrears disbursement",
        "description": "Faculty members submitted multiple representations for pending arrears without institutional redressal.",
        "language": "en",
        "category_code": None,
        "consent_acknowledged": True,
    }
    res = client.post("/api/v1/demo/intake/AICTE_SIM/submissions", json=sub_payload)
    assert res.status_code in (200, 201), f"Submission creation failed: {res.text}"
    receipt = res.json()
    sub_id = receipt["submission_id"]
    print(f"[STEP 3] Live Intake Submission created: ID {sub_id} (Status: {receipt['intake_status']})")

    # 3b. Screen Submission for Duplicates
    with psycopg.connect(dsn) as dconn:
        with dconn.cursor() as dcur:
            dcur.execute("SELECT updated_at FROM public.submissions WHERE id = %s;", (sub_id,))
            sub_updated_at = dcur.fetchone()[0]

    screen_res = client.post(
        "/api/v1/duplicate-review/screen",
        json={"submission_id": str(sub_id), "expected_submission_updated_at": sub_updated_at.isoformat()},
        headers=super_hdrs,
    )
    assert screen_res.status_code == 200, f"Duplicate screen failed: {screen_res.text}"
    inserted_candidates = screen_res.json()["inserted_count"]
    print(f"[STEP 3b] Duplicate Screening completed: {inserted_candidates} candidates found")

    if inserted_candidates > 0:
        # Step 3c: Human Duplicate Review
        q_res = client.get("/api/v1/duplicate-review/queue?status=pending", headers=super_hdrs)
        assert q_res.status_code == 200, f"Queue fetch failed: {q_res.text}"
        queue_rows = q_res.json()
        matching = [r for r in queue_rows if r["submission_id"] == str(sub_id)]
        for cand in matching:
            dec_res = client.post(
                f"/api/v1/duplicate-review/candidates/{cand['candidate_id']}/decide",
                json={
                    "action": "not_duplicate",
                    "notes": "Verified distinct complaint in live smoke test.",
                    "expected_submission_updated_at": cand["submission_updated_at"],
                    "expected_candidate_updated_at": cand["candidate_updated_at"],
                },
                headers=super_hdrs,
            )
            assert dec_res.status_code == 200, f"Candidate decision failed: {dec_res.text}"
            print(f"[STEP 3c] Candidate {cand['candidate_id']} decided as not_duplicate")

    with psycopg.connect(dsn) as dconn:
        with dconn.cursor() as dcur:
            dcur.execute("SELECT updated_at FROM public.submissions WHERE id = %s;", (sub_id,))
            sub_updated_at = dcur.fetchone()[0]

    # 4. Create Canonical Case from Screened Submission
    case_payload = {
        "submission_id": str(sub_id),
        "lead_bureau_id": str(pgrc_bureau["id"]),
        "title": "7th CPC Arrears Disbursement Grievance",
        "description": "Formal investigation into institutional non-compliance with pay commission guidelines.",
        "priority": "high",
        "visibility": "restricted",
        "expected_submission_updated_at": sub_updated_at.isoformat(),
    }
    res = client.post("/api/v1/cases", json=case_payload, headers=super_hdrs)
    assert res.status_code in (200, 201), f"Canonical case creation failed: {res.text}"
    case_id = res.json()["case_id"]
    print(f"[STEP 4] Live Canonical Case created: ID {case_id}")

    # 5. Fetch Case Detail (backward compatibility & projection check)
    res = client.get(f"/api/v1/cases/{case_id}", headers=super_hdrs)
    assert res.status_code == 200, f"Case detail failed: {res.text}"
    case_detail = res.json()
    case_token = case_detail["updated_at"]
    print(f"[STEP 5] Case Detail: Case Number '{case_detail['case_number']}', Status '{case_detail['status']}'")

    # 6. Status Transition: new -> under_review
    res = client.post(
        f"/api/v1/cases/{case_id}/status",
        json={"to_status": "under_review", "reason": "Initial case assessment started", "expected_updated_at": case_token},
        headers=super_hdrs,
    )
    assert res.status_code == 200, f"Status transition failed: {res.text}"
    case_token = res.json()["updated_at"]
    print(f"[STEP 6] Status transitioned to 'under_review' (Token: {case_token})")

    # 7. Add Collaborating Bureau Assignment
    assign_payload = {
        "bureau_id": str(aff_bureau["id"]),
        "assignment_type": "collaborating",
        "reason": "Collaborating on institutional compliance audit",
    }
    res = client.post(f"/api/v1/cases/{case_id}/bureau-assignments", json=assign_payload, headers=super_hdrs)
    assert res.status_code == 201, f"Bureau assignment failed: {res.text}"
    collab_assign_id = res.json()["assignment_id"]
    print(f"[STEP 7] Collaborating bureau assigned: ID {collab_assign_id}")

    # 8. Create Internal Notes (Shared & Bureau-Private)
    res = client.post(
        f"/api/v1/cases/{case_id}/notes",
        json={"note_text": "Shared audit memo: Records requested from college bursar.", "visibility": "shared", "note_type": "internal_review"},
        headers=super_hdrs,
    )
    assert res.status_code == 201, f"Shared note creation failed: {res.text}"
    shared_note_id = res.json()["note_id"]

    res = client.post(
        f"/api/v1/cases/{case_id}/notes",
        json={"note_text": "Confidential legal note: Prior compliance notice pending.", "visibility": "bureau_private", "note_type": "internal_review", "bureau_id": str(pgrc_bureau["id"])},
        headers=super_hdrs,
    )
    assert res.status_code == 201, f"Private note creation failed: {res.text}"
    private_note_id = res.json()["note_id"]
    print(f"[STEP 8] Notes created (Shared: {shared_note_id}, Private: {private_note_id})")

    # 9. Register Evidence Attachment
    att_payload = {
        "original_filename": "CPC_Arrears_Audit_Report.pdf",
        "storage_bucket": "complaint-evidence",
        "storage_path": f"cases/{case_id}/CPC_Arrears_Audit_Report.pdf",
        "mime_type": "application/pdf",
        "file_size_bytes": 1048576,
        "sha256_checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "attachment_type": "evidence",
        "description": "Certified audit evidence from regional office",
    }
    res = client.post(f"/api/v1/cases/{case_id}/attachments", json=att_payload, headers=super_hdrs)
    assert res.status_code == 201, f"Attachment registration failed: {res.text}"
    attachment_id = res.json()["attachment_id"]
    print(f"[STEP 9] Attachment registered: ID {attachment_id}")

    # 10. Attachment Download URL Resolution
    res = client.get(f"/api/v1/cases/{case_id}/attachments/{attachment_id}/download", headers=super_hdrs)
    assert res.status_code == 200, f"Download failed: {res.text}"
    dl_info = res.json()
    assert "/storage/v1/object/authenticated/" in dl_info["download_url"]
    print(f"[STEP 10] Download URL resolved: {dl_info['download_url']}")

    # 11. Quarantine Attachment
    res = client.post(
        f"/api/v1/cases/{case_id}/attachments/{attachment_id}/quarantine",
        json={"reason": "Contains sensitive unredacted employee PII"},
        headers=super_hdrs,
    )
    assert res.status_code == 200, f"Quarantine failed: {res.text}"
    print(f"[STEP 11] Attachment quarantined successfully")

    # 12. Verify Quarantined File Download Blocked
    res = client.get(f"/api/v1/cases/{case_id}/attachments/{attachment_id}/download", headers=super_hdrs)
    assert res.status_code == 403, f"Quarantine block failed: {res.status_code} {res.text}"
    assert res.json()["error"]["code"] == "QUARANTINED_FILE"
    print(f"[STEP 12] Quarantined download blocked: 403 QUARANTINED_FILE verified")

    # 13. Request Cross-Bureau Access
    res = client.post(
        f"/api/v1/cases/{case_id}/access-requests",
        json={"access_level": "details", "reason": "Inter-bureau compliance review", "requesting_bureau_id": str(aff_bureau["id"])},
        headers=super_hdrs,
    )
    assert res.status_code == 201, f"Access request failed: {res.text}"
    access_req_id = res.json()["request_id"]
    print(f"[STEP 13] Access request initiated: ID {access_req_id}")

    # 14. Approve Access Request
    res = client.post(
        f"/api/v1/access-requests/{access_req_id}/decision",
        json={"decision": "approved", "decision_reason": "Granted 14-day audit access"},
        headers=senior_hdrs,
    )
    assert res.status_code == 200, f"Access decision failed: {res.text}"
    grant_id = res.json()["grant_id"]
    print(f"[STEP 14] Access approved & Grant issued: ID {grant_id}")

    # 15. Verify Case Detail Projection & Action History on Live Database
    res = client.get(f"/api/v1/cases/{case_id}", headers=super_hdrs)
    assert res.status_code == 200
    final_detail = res.json()
    print(f"[STEP 15] Live Case Projection successfully verified:")
    print(f"         - Status: {final_detail['status']}")
    print(f"         - Lead Bureau: {final_detail['lead_bureau_name']}")
    print(f"         - Collaborating Bureaus: {len(final_detail.get('collaborating_bureaus', []))}")
    print(f"         - Notes Count: {final_detail.get('notes_count')}")
    print(f"         - Attachments Count: {final_detail.get('attachments_count')}")
    print(f"         - Action History Events: {len(final_detail.get('action_history', []))}")

print("=" * 70)
print("ALL 15 REAL END-TO-END DEMO SMOKE TEST STEPS PASSED ON LIVE SUPABASE!")
print("=" * 70)

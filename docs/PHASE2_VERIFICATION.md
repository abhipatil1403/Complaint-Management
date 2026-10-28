# Phase 2.2 — Human Institution Verification and Identification

Status: **implemented, applied and verified** on 29 October 2026.  
Scope owner: Phase 2.2 only. Phase 2.3 (duplicate review, canonical case creation, assignment) is **not** started.

> **Demonstrator / Simulation.** Every seeded institution, task and intake submission is illustrative demo data. Content isolation is strictly preserved: verification reviewers see only provenance, references and advisory evidence, never complaint subject or body text.

---

## 1. Deliverables & Approved Invariants

| Decision / Invariant | Specification | Implementation |
| --- | --- | --- |
| **D-3 (Table Invariant)** | Exactly 32 approved application tables; no new table or column | No table or column added. Uses existing `public.institution_verification_tasks` and `public.submissions`. |
| **D-11 (Option A)** | Use existing `resolution_notes` marker for correction rounds; no new column or table | First line format: `[correction-request] requester=<uuid> at=<iso-timestamp>`. Authoritative append-only audit trail. |
| **Safeguard 1 (Marker Fail-Closed)** | Correction requester markers fail closed if absent, malformed, duplicated, or modified | Enforced by `correction_request_requester()` and `guard_institution_verification_task()`. SQLSTATE `P2V05` on malformed/missing/tampered markers; `P2V14` if requester confirms own correction. |
| **Safeguard 2 (Advisory Candidates)** | `candidate_institution_id` is advisory only; never automatically select or confirm | `decide_institution_verification()` requires caller-supplied `p_institution_id` and non-empty `p_reason`. SQLSTATE `P2V08` and `P2V07` on omitted values. |
| **Safeguard 3 (Case Creation Guard)** | Submission with an active verification or correction round cannot create a canonical case | `guard_case_creation_open_round()` trigger on `public.cases` refuses insert/update with SQLSTATE `P2V10` if task is pending/in_review or intake_status is awaiting verification, even with populated `institution_id`. |
| **Safeguard 4 (Definer Posture)** | SECURITY DEFINER ownership, grants, search_path and authorization | All functions owned by `postgres`, `set search_path = ''`. `authenticated` holds zero table privileges on `institution_verification_tasks`. Reads and writes go through capability-gated functions checking `INSTITUTION.VERIFY`. |
| **Safeguard 5 (Lock Order)** | Concurrency protection and deadlock prevention | Single global lock order: 1. `submissions` (FOR UPDATE) -> 2. `institution_verification_tasks` (FOR UPDATE/INSERT) -> 3. `institutions` (FOR SHARE). Optimistic concurrency checked via `expected_updated_at` (SQLSTATE `P2V01`). |
| **Evidence Tiers** | Advisory candidate ranking without auto-commit | E1 (Exact Permanent ID, rank 1), E2 (Exact Official Name, rank 2), E3 (Verified Alias, rank 3), E4 (Name Containment, rank 4). |
| **Queue & Decision API** | FastAPI `/api/v1/verification` | `GET /tasks`, `GET /tasks/{id}`, `GET /submissions/{id}/candidates`, `POST /tasks/{id}/decision`, `POST /submissions/{id}/correction-rounds`. |
| **Reviewer Interface** | React + TypeScript + Vite | Verification queue, candidate evidence breakdown, decision interface, and correction round request. |

---

## 2. Security Architecture

### 2.1 Table Isolation
The `public.institution_verification_tasks` table is completely inaccessible to `authenticated`, `anon`, and `service_role` via Data API:
- `REVOKE ALL ON TABLE public.institution_verification_tasks FROM authenticated;`
- All reads go through `public.institution_verification_task_rows(...)`, which re-checks `public.has_global_permission('INSTITUTION.VERIFY')`.
- All writes go through `public.decide_institution_verification(...)` and `public.request_institution_verification_round(...)`.

### 2.2 Content Privacy
Reviewers evaluating institution identity do not need access to complaint content. The verification projections strictly omit:
- `subject`
- `original_text`
- `normalized_text`
- `content_fingerprint`
- `submitter_reference`
- `source_metadata`

Complaint bodies remain guarded behind the separate `SUBMISSION.VIEW` capability and are never rendered in verification screens.

### 2.3 Independent Review Trail
When an association is disputed or replacement is requested:
1. `request_institution_verification_round()` opens a new task with `resolution_notes = '[correction-request] requester=' || v_actor || ' at=' || to_json(now()) || E'\n' || p_reason`.
2. When resolving, `guard_institution_verification_task()` parses the marker. If `reviewed_by_user_id == requester`, the transaction is aborted with `P2V14`.
3. The previous task row remains preserved in `verified` state, recording the previous institution, previous reviewer, and original timestamp. The new confirming task appends a `[correction]` replacement trail.

---

## 3. Database Functions & Triggers (Migration 0004)

- `public.institution_match_candidates_internal(text, text, integer)`: Internal evidence matcher (not SECURITY DEFINER, non-callable by API).
- `public.institution_verification_submission_metadata(uuid)`: SECURITY DEFINER provenance projector.
- `public.institution_match_candidates(uuid)`: SECURITY DEFINER candidate finder.
- `public.institution_verification_task_rows(...)`: SECURITY DEFINER queue projector with filtering, sorting and offset pagination.
- `public.correction_request_requester(text)`: Pure immutable marker parser with fail-closed validation.
- `public.decide_institution_verification(...)`: SECURITY DEFINER decision processor.
- `public.request_institution_verification_round(...)`: SECURITY DEFINER correction round creator.
- `public.queue_institution_verification()`: Trigger on `public.submissions` auto-creating pending task for unresolved submissions.
- `public.guard_institution_verification_task()`: Guard trigger enforcing immutability of resolved tasks and independent review.
- `public.apply_institution_verification_outcome()`: Trigger propagating verified institution back to submission.
- `public.guard_case_creation_open_round()`: Trigger on `public.cases` blocking canonical case creation while verification is open.

---

## 4. Verification & Test Evidence

### Backend Test Suite (Pytest)
- **Total tests**: 235 passed, 0 failed.
- **Coverage**:
  - Live PostgreSQL RLS, grants, definer posture, concurrency, and immutability (`tests/test_rls_db.py`).
  - Verification API contract, validation, and error translation (`tests/test_verification_api.py`).
  - Seed and migration consistency (`tests/test_phase2_seed.py`).
  - Authorization and security permissions (`tests/test_authorization.py`, `tests/test_security.py`).
  - Intake preservation and rate limiting (`tests/test_intake.py`).

### Frontend Test Suite (Vitest)
- **Total tests**: 33 passed, 0 failed.
- **Coverage**:
  - Verification helpers, labels, evidence formatters (`src/test/verification.test.ts`).
  - API client error and token handling (`src/test/api.test.ts`).
  - Capability and role access evaluation (`src/test/access.test.ts`).
  - Intake helpers and portal routing (`src/test/intake.test.ts`).

### TypeScript & Production Build
- `tsc --noEmit && vite build` completed with zero type errors.

### Database Table Count
- Exactly 32 approved application tables verified on live Supabase PostgreSQL.

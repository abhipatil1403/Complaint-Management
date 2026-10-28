# **AICTE OneDesk — REST API Documentation**

**Document ID:** ANX-API-001  
**Version:** 1.0 draft contract  
**Base path:** `/api/v1`  
**Status:** Proposed; to be generated/refined as executable OpenAPI from FastAPI  
**Audience:** Frontend, backend, QA, database, and integration developers

## **1\. Scope**

This document defines the initial API surface for the seeded-data demonstrator. It is aligned to React \+ TypeScript \+ Vite, FastAPI, Supabase Auth, and Supabase PostgreSQL. All routes are illustrative contracts until implemented and tested. No real AICTE or CPGRAMS integration is implied.

## **2\. Authentication**

### **Request headers**

Authorization: Bearer \<supabase\_access\_token\>  
Content-Type: application/json  
Accept: application/json  
X-Request-ID: \<optional-client-correlation-id\>  
Idempotency-Key: \<required-for-supported-retry-safe-mutations\>

* Sign-in, password reset, and session refresh use Supabase Auth client flows; the application API does not accept or store passwords.  
* FastAPI validates the access token, resolves `auth_user_id` to an active internal `users` record, then authorizes the operation.  
* Invalid/expired token: `401`.  
* Authenticated but insufficient scope: `403` (or `404` where policy intentionally avoids confirming a restricted record's existence).  
* The frontend must not contain service-role keys or database secrets.

## **3\. Common conventions**

### **IDs and timestamps**

* Internal IDs: UUID strings.  
* `case_number`: human-readable immutable identifier, separate from UUID.  
* Timestamps: UTC ISO 8601, e.g. `2026-10-28T10:25:00Z`.  
* Original complaint language/text is preserved. Normalized text is a derived field and carries a normalization version.

### **Pagination**

List routes accept `limit` (default 25, maximum 100\) and an opaque `cursor`. Response shape:

{  
  "data": \[\],  
  "page": {"limit": 25, "next\_cursor": null},  
  "request\_id": "req\_example"  
}

### **Standard error shape**

{  
  "error": {  
    "code": "VALIDATION\_ERROR",  
    "message": "One or more fields are invalid.",  
    "details": \[{"field": "title", "issue": "Required"}\],  
    "request\_id": "req\_example"  
  }  
}

Never return stack traces, SQL statements, tokens, private notes, complaint text from inaccessible records, or Storage object paths in errors.

### **Status codes**

* `200` successful read/update/action  
* `201` created  
* `202` accepted for asynchronous processing  
* `204` successful no-content action  
* `400` malformed request or invalid state transition  
* `401` missing/invalid authentication  
* `403` authenticated but not authorized  
* `404` not found or intentionally undisclosed  
* `409` duplicate/idempotency/version conflict  
* `413` upload too large  
* `415` unsupported media type  
* `422` schema/field validation error  
* `429` rate limited  
* `500` unexpected server failure with request ID only  
* `503` dependency temporarily unavailable

## **4\. Core domain models**

These are API DTOs, not direct ORM dumps. Response fields are permission-filtered.

### **4.1 Institution summary**

{  
  "id": "uuid",  
  "aicte\_permanent\_id": "DEMO-PIC-0001",  
  "official\_name": "Illustrative Institute of Technology",  
  "region": {"id": "uuid", "code": "WEST", "name": "Illustrative Region"},  
  "verification\_status": "verified",  
  "is\_active": true  
}

Use only illustrative values in demo seed data. Never imply a demo institution is a verified real institution.

### **4.2 Submission**

{  
  "id": "uuid",  
  "intake\_channel": {"code": "DEMO\_PORTAL", "name": "Simulated Portal"},  
  "external\_reference": "DEMO-SRC-00001",  
  "received\_at": "2026-10-28T10:25:00Z",  
  "original\_language": "en",  
  "intake\_status": "awaiting\_duplicate\_review",  
  "institution\_id": "uuid",  
  "canonical\_case\_id": null  
}

Complaint text is returned only to authorized users and should be omitted from general list/index responses.

### **4.3 Case index DTO (minimal visibility)**

{  
  "id": "uuid",  
  "case\_number": "ANX-DEMO-000001",  
  "institution": {"id": "uuid", "aicte\_permanent\_id": "DEMO-PIC-0001", "official\_name": "Illustrative Institute of Technology"},  
  "current\_status": {"code": "under\_review", "name": "Under Review"},  
  "primary\_category": {"code": "FACILITIES", "name": "Facilities"},  
  "priority": "normal",  
  "opened\_at": "2026-10-28T10:30:00Z",  
  "visibility": "index\_only"  
}

The minimal index deliberately excludes complaint body, restricted summary, private notes, and attachment links.

### **4.4 Case detail DTO (authorized only)**

{  
  "id": "uuid",  
  "case\_number": "ANX-DEMO-000001",  
  "institution\_id": "uuid",  
  "primary\_category\_id": "uuid",  
  "current\_status": {"code": "under\_review", "name": "Under Review"},  
  "priority": "normal",  
  "title": "Illustrative complaint title",  
  "summary": "Synthetic demo summary only.",  
  "opened\_at": "2026-10-28T10:30:00Z",  
  "closed\_at": null,  
  "version": 1  
}

## **5\. Endpoint catalogue**

All routes below require authentication unless explicitly marked public-demo intake. Authorization is per operation, resource, bureau, and visibility scope. The implementation may split routes into routers while preserving these contracts.

### **5.1 Session and current user**

| Method | Path | Purpose | Required permission |
| ----- | ----- | ----- | ----- |
| GET | `/me` | Current internal profile, active roles, memberships, UI capabilities | authenticated |
| GET | `/me/permissions` | Effective permission/capability list for current context | authenticated |
| POST | `/me/active-bureau` | Select a bureau context from existing memberships | active membership |

`POST /me/active-bureau` body:

{"bureau\_id":"uuid"}

This selects UI context only; it does not grant membership or access.

### **5.2 Reference data and institutions**

| Method | Path | Purpose | Permission |
| ----- | ----- | ----- | ----- |
| GET | `/regions` | List active regions | authenticated |
| GET | `/institutions` | Search institution master data | `institution.view` |
| GET | `/institutions/{institution_id}` | Institution profile and permitted case summaries | `institution.view` |
| GET | `/institutions/{institution_id}/cases` | Authorized case index for an institution | `case.view_index` |
| GET | `/institution-aliases` | Search aliases where authorized | `institution.alias.view` |
| POST | `/institutions/{institution_id}/aliases` | Add alias with provenance | `institution.alias.manage` |
| POST | `/institution-verification-tasks/{task_id}/decision` | Verify/reject a candidate institution | `institution.verify` |
| GET | `/queues/institution-verification` | Unresolved submissions/tasks | `institution.verify` |

Institution search filters: `q`, `region_id`, `verification_status`, `is_active`, `limit`, `cursor`. Exact Permanent ID matches should rank above name similarity. Name alone does not verify an institution.

### **5.3 Intake and submissions**

| Method | Path | Purpose | Permission |
| ----- | ----- | ----- | ----- |
| POST | `/demo/intake/{channel_code}/submissions` | Simulated public/demo submission intake | demo intake enabled |
| GET | `/submissions` | Search/list submissions | `submission.view` |
| GET | `/submissions/{submission_id}` | Authorized submission details | `submission.view` |
| POST | `/submissions/{submission_id}/process` | Start/retry idempotent processing | `submission.process` |
| POST | `/submissions/{submission_id}/associate-case` | Associate after authorized review | `submission.associate` |
| POST | `/submissions/{submission_id}/create-case` | Create case after institution resolution and duplicate review | `case.create` |

Example demo intake request:

{  
  "institution\_permanent\_id": "DEMO-PIC-0001",  
  "institution\_name\_as\_submitted": "Illustrative Institute of Technology",  
  "subject": "Illustrative issue",  
  "description": "Synthetic text used for the demonstrator.",  
  "language": "en",  
  "category\_code": "FACILITIES",  
  "submitter\_reference": "DEMO-SUBMITTER-001"  
}

Response `201`:

{  
  "submission\_id": "uuid",  
  "source\_reference": "DEMO-SRC-00001",  
  "intake\_status": "received",  
  "demo\_notice": "This is a simulated submission. It has not been sent to AICTE or CPGRAMS."  
}

Intake rules:

* Accept an idempotency key for retries.  
* Preserve every genuine source event.  
* Do not create a canonical institution based only on unverified free-text name.  
* Do not silently discard repeated submissions.  
* Distinguish duplicate delivery of the same source event from a genuine new submission.

### **5.4 Cases, workflow, notes, and history**

| Method | Path | Purpose | Permission |
| ----- | ----- | ----- | ----- |
| GET | `/cases` | Filtered case index/detail projection | `case.view_index` plus field-level authorization |
| POST | `/cases` | Create canonical case (only after institution resolved) | `case.create` |
| GET | `/cases/{case_id}` | Return authorized case detail or minimal index representation | `case.view_detail` or `case.view_index` |
| PATCH | `/cases/{case_id}` | Update allowed editable fields with concurrency check | `case.update` |
| POST | `/cases/{case_id}/status-transitions` | Validated status transition | `case.status.change` |
| GET | `/cases/{case_id}/history` | Action history visible to caller | `case.history.view` |
| GET | `/cases/{case_id}/submissions` | Associated source submissions | `submission.view` |
| GET | `/cases/{case_id}/notes` | Notes filtered by visibility and scope | `case.note.view` |
| POST | `/cases/{case_id}/notes` | Add shared or bureau-private note | `case.note.create` |
| PATCH | `/cases/{case_id}/notes/{note_id}` | Edit own/authorized note; audited | `case.note.edit` |
| GET | `/cases/{case_id}/relationships` | Related case links | `case.relationship.view` |
| POST | `/cases/{case_id}/relationships` | Add reviewed relationship | `case.relationship.manage` |

Case list filters: `q`, `institution_id`, `region_id`, `status`, `category_id`, `priority`, `bureau_id`, `officer_id`, `opened_from`, `opened_to`, `deadline_state`, `include_index_only`. Every filter must be authorized and allowlisted.

Status transition request:

{  
  "to\_status\_code": "under\_process",  
  "reason": "Reviewed and assigned for action.",  
  "expected\_version": 3  
}

The backend validates the transition, caller authority, required reason, and concurrency version. The case status update and append-only action-history event must commit in one transaction.

### **5.5 Duplicate review**

| Method | Path | Purpose | Permission |
| ----- | ----- | ----- | ----- |
| GET | `/queues/duplicate-review` | Candidate queue | `duplicate.review` |
| GET | `/submissions/{submission_id}/duplicate-candidates` | Candidate details and explainable signals | `duplicate.review` |
| POST | `/duplicate-candidates/{candidate_id}/decision` | Confirm association, reject candidate, or request further review | `duplicate.review` |
| POST | `/submissions/{submission_id}/matching` | Recompute candidates if authorized | `duplicate.match.run` |

Decision request:

{  
  "decision": "associate\_with\_case",  
  "case\_id": "uuid",  
  "reason": "Same underlying issue confirmed by reviewer.",  
  "expected\_version": 1  
}

Allowed decisions are implementation-controlled enumerations such as `associate_with_case`, `not_duplicate`, `needs_more_information`, and `create_new_case` where applicable. Validate that selected case is accessible and institution association is consistent. Record reviewer, time, reason, method/version, and candidate decision. Never merge/delete solely from score.

### **5.6 Bureau and officer assignments / transfers**

| Method | Path | Purpose | Permission |
| ----- | ----- | ----- | ----- |
| GET | `/bureaus` | Active bureau list | `bureau.view` |
| GET | `/bureaus/{bureau_id}/members` | Authorized bureau membership list | `bureau.members.view` |
| POST | `/cases/{case_id}/bureau-assignments` | Add bureau participation | `case.assign.bureau` |
| PATCH | `/bureau-assignments/{assignment_id}` | Change assignment state/type/primary flag | `case.assign.bureau` |
| POST | `/bureau-assignments/{assignment_id}/officer-assignments` | Assign officer | `case.assign.officer` |
| PATCH | `/officer-assignments/{assignment_id}` | End/reassign officer assignment | `case.assign.officer` |
| POST | `/cases/{case_id}/transfers` | Request transfer | `case.transfer.request` |
| POST | `/transfers/{transfer_id}/decision` | Approve/reject/complete transfer | `case.transfer.decide` |

Rules: the target officer must have active membership or explicit approved authorization. Transfer does not erase prior assignments. A transfer must preserve its request, decision, and completion events. Only one active assignment per case/bureau and the approved primary-bureau rule may be enforced.

### **5.7 Access requests and grants**

| Method | Path | Purpose | Permission |
| ----- | ----- | ----- | ----- |
| POST | `/cases/{case_id}/access-requests` | Request restricted access | `case.access.request` |
| GET | `/access-requests` | Queue of requests within approver scope | `case.access.review` |
| POST | `/access-requests/{request_id}/decision` | Approve/deny with reason and expiry/scope | `case.access.approve` |
| GET | `/cases/{case_id}/access-grants` | View grants if authorized | `case.access.manage` |
| POST | `/access-grants/{grant_id}/revoke` | Revoke a grant | `case.access.revoke` |

Exactly one grant target is expected: user or bureau. The backend must validate scope, expiry, approver authority, and note/evidence visibility. Revocation must take effect on the next authorized request; do not rely on old frontend state.

### **5.8 Attachments and evidence**

| Method | Path | Purpose | Permission |
| ----- | ----- | ----- | ----- |
| POST | `/cases/{case_id}/attachments/upload-intent` | Authorize and create upload intent | `attachment.upload` |
| POST | `/submissions/{submission_id}/attachments/upload-intent` | Upload evidence attached to submission | `attachment.upload` |
| POST | `/attachments/{attachment_id}/complete-upload` | Verify object metadata/checksum and finalize | `attachment.upload` |
| GET | `/attachments/{attachment_id}` | Authorized metadata | `attachment.view` |
| POST | `/attachments/{attachment_id}/download-url` | Issue short-lived authorized URL | `attachment.download` |
| POST | `/attachments/{attachment_id}/quarantine` | Restrict a suspicious file | `attachment.quarantine` |

Storage bucket is private. Validate file size, extension and actual MIME/signature where feasible; calculate checksum; track scan status; do not serve unscanned/rejected content. A signed URL is a temporary capability and must be short-lived. Do not expose raw object paths in public APIs.

### **5.9 SLA, deadlines, escalations**

| Method | Path | Purpose | Permission |
| ----- | ----- | ----- | ----- |
| GET | `/sla-policies` | List policies and verification status | `sla.view` |
| POST | `/sla-policies` | Create a policy version | `sla.configure` |
| POST | `/sla-policies/{policy_id}/activate` | Activate approved effective policy | `sla.configure` |
| GET | `/cases/{case_id}/deadlines` | Read calculated deadlines | `case.deadline.view` |
| POST | `/cases/{case_id}/deadlines/{deadline_id}/override` | Authorized override with reason | `case.deadline.override` |
| GET | `/escalation-rules` | Read configured rules | `escalation.configure` |
| POST | `/escalation-rules` | Create/update rule | `escalation.configure` |
| GET | `/cases/{case_id}/escalations` | Escalation history | `case.escalation.view` |
| POST | `/case-escalations/{escalation_id}/resolve` | Resolve an escalation | `case.escalation.resolve` |

Every deadline records policy ID/version, start basis, due time, calendar basis, and override history. Unknown/unverified policy: return `policy_status: "verification_required"` and do not invent a due date. CPGRAMS or specific grievance-process timelines must not be applied to every case by default.

### **5.10 Notifications, dashboards, reports, audit**

| Method | Path | Purpose | Permission |
| ----- | ----- | ----- | ----- |
| GET | `/notifications` | Current user's in-app alerts | authenticated |
| POST | `/notifications/{notification_id}/read` | Mark own notification read | recipient |
| POST | `/notifications/read-all` | Mark visible notifications read | recipient |
| GET | `/dashboard/overview` | Role-scoped dashboard aggregates | `dashboard.view` |
| GET | `/dashboard/workload` | Workload/ageing by permitted bureau | `dashboard.workload.view` |
| GET | `/reports/cases` | Case report with bounded filters | `report.case.view` |
| POST | `/reports/exports` | Start authorized export job if enabled | `report.export` |
| GET | `/reports/exports/{export_id}` | Export status/download metadata | export owner/authorized |
| GET | `/audit-events` | Search permitted audit events | `audit.view` |

Dashboard definitions must document date range, numerator/denominator, status scope, access scope, and whether records are index-only. Notifications must avoid restricted complaint text and route users back through authorization. Export is a separate permission and must be audited.

### **5.11 Health and demo configuration**

| Method | Path | Purpose | Auth |
| ----- | ----- | ----- | ----- |
| GET | `/health/live` | Process liveness only | no sensitive data |
| GET | `/health/ready` | Readiness and dependency status | internal/demo-safe |
| GET | `/demo/info` | Return demo-mode notice and feature flags | public-safe |

Health responses must not expose credentials, database URLs, internal hostnames, or stack traces.

## **6\. State machine and business invariants**

* `submissions.intake_status` is separate from `cases.current_status`.  
* Proposed case statuses: `received`, `under_review`, `under_process`, `awaiting_information`, `escalated`, `disposed`, `rejected`, `reopened`. The transition matrix needs product/policy approval before being enforced.  
* Transfer state, access-request state, institution-verification state, duplicate-review state, and deadline state are separate state machines.  
* A case must reference a verified institution.  
* Every case creation associates its first submission atomically where applicable.  
* No automatic merge or deletion based on a score.  
* Case number is unique and immutable.  
* Notes and attachments are visibility-filtered server-side.  
* All material changes create audit/action events in the same transaction when feasible.  
* Repeated requests with the same idempotency key return the original result or a safe conflict, not duplicate side effects.

## **7\. API security checklist**

* Validate Supabase token signature, issuer, audience/claims, and expiry using a supported library/configuration.  
* Resolve active internal user profile.  
* Authorize every request on server; no trust in frontend role labels.  
* Protect against IDOR by checking access to each target resource.  
* Apply field-level response shaping for index-only access.  
* Protect private notes and attachment URLs.  
* Use rate limits on public demo intake and expensive matching routes.  
* Use request IDs and structured logs without sensitive payloads.  
* Use bounded pagination and allowlisted sort/filter keys.  
* Validate upload size/type and scan/quarantine workflow.  
* Test access grant expiry and revocation.  
* Test unauthorized search, reports, exports, notifications, and file access.  
* Ensure secrets are server-side only.

## **8\. Initial test matrix**

| Scenario | Expected result |
| ----- | ----- |
| No token on protected route | `401` |
| Active user requests case outside all scopes | `403` or privacy-preserving `404` |
| User has index-only visibility | Minimal case DTO only; no body, notes, evidence, or signed URLs |
| Bureau-private note requested by another bureau | Note omitted/denied |
| Grant expired or revoked | Detail/file request denied |
| Duplicate score exceeds threshold | Candidate enters review queue; no merge |
| Same idempotency key repeated | No duplicate side effect |
| Case creation fails while submission association fails | Entire transaction rolls back |
| Illegal status transition | `400`/`409`; no state/history mutation |
| Unverified SLA policy | No official due date; verification warning |
| File type not allowed or scan fails | Upload rejected/quarantined |
| Demo intake submitted | Explicit simulated-submission notice |
| Export permission missing | Denied even if list view is allowed |

## **9\. OpenAPI delivery requirements**

FastAPI should expose `/openapi.json` in local development and Swagger UI at `/docs` only in approved environments. Commit a reviewed OpenAPI snapshot to the repository and generate a typed TypeScript client from it if practical. The OpenAPI contract must include authentication, error schemas, request/response models, pagination, permissions in descriptions, and examples using synthetic data only.


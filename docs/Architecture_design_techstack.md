# **AICTE OneDesk — Architecture Decision Record (ADR)**

**Document ID:** ANX-ADR-001  
**Version:** 1.0  
**Status:** Proposed baseline based on stakeholder selections; approve before implementation  
**Date:** 28 October 2026  
**Product:** AICTE Nexus — Integrated Institution Grievance Monitoring and Redressal Platform

## **1\. Decision summary**

| Area | Decision | Rationale |
| ----- | ----- | ----- |
| Frontend | React \+ TypeScript \+ Vite | Strong fit for an authenticated, dashboard-heavy SPA; fast local feedback and typed components |
| Backend | Python \+ FastAPI | Central place for domain rules, permission checks, transactions, matching orchestration, and versioned APIs |
| Authentication | Supabase Auth \+ backend authorization | Avoids a second password/session system; backend independently authorizes every operation |
| Database | Supabase PostgreSQL | Relational source of truth for institutions, submissions, cases, assignments, policies, and audit |
| File storage | Private Supabase Storage buckets | Evidence files are separate from relational metadata and must remain private |
| Matching | Hybrid rules \+ similarity/semantic signals, human review | Explainable candidate generation without automatic merges |
| Integrations | Seeded-data demo first; integrations later | Enables reliable MVP without claiming access to official external systems |
| Deployment | Local development \+ hosted demonstrator | Separates development, demo, and any future production environment |
| API style | Versioned REST at `/api/v1` | Predictable contracts, OpenAPI docs, clear client/server boundary |

## **2\. Context and domain invariants**

1. A **submission** is an intake event; a **case** is the canonical record for an underlying issue.  
2. Every genuine submission is preserved, including repeat submissions associated with an existing case.  
3. Institution identity must be resolved before a normal canonical case is created or routed.  
4. A case can have multiple bureau assignments; each assignment can have multiple officer assignments.  
5. Duplicate scores create review candidates, not automatic merges. The initial 60-day lookback and 0.90 high-confidence threshold are demonstrator configuration, not a legal rule or calibrated probability.  
6. Cross-bureau index visibility is narrower than access to complaint text, evidence, and private notes.  
7. Meaningful actions and security decisions must be attributable and auditable.  
8. SLA rules are versioned configuration. Unverified policy timelines must be labelled illustrative or left unconfigured.  
9. Supabase PostgreSQL is the system of record. Future n8n/email integrations orchestrate work but do not become alternate sources of truth.  
10. Real CPGRAMS or AICTE system integration is out of scope until an authorized mechanism and credentials/process are confirmed.

## **3\. Logical architecture**

\`\`\`mermaid  
flowchart TB  
    U\[Authorized users\] \--\> FE\[React \+ TypeScript \+ Vite\]  
    FE \--\>\|Supabase Auth sign-in/session\| AUTH\[Supabase Auth\]  
    FE \--\>\|Bearer access token\| API\[FastAPI /api/v1\]  
    API \--\> AUTH  
    API \--\> AUTHZ\[Authorization service\]  
    AUTHZ \--\> DB\[(Supabase PostgreSQL)\]  
    API \--\> DB  
    API \--\> ST\[Private Supabase Storage\]  
    API \--\> MATCH\[Matching service module\]  
    MATCH \--\> DB  
    API \--\> NOTIFY\[In-app notification service\]  
    API \-. future .-\> N8N\[n8n orchestration\]  
    N8N \-. authorized events only .-\> API  
    API \-. future authorized connector .-\> EXT\[Email / CPGRAMS / other source\]  
\`\`\`

### **Component responsibilities**

* **React/Vite:** presentation, form validation for usability, route guards as a convenience, dashboard/list views, case timeline, queues, and API client. Frontend checks are never the security boundary.  
* **Supabase Auth:** identity proof and session lifecycle. No custom password storage.  
* **FastAPI:** input validation, authorization, domain workflows, idempotency, transactions, matching orchestration, audit event creation, file authorization, and response shaping.  
* **PostgreSQL:** durable relational state, referential integrity, uniqueness, check constraints, indexes, and carefully scoped database policies/views.  
* **Supabase Storage:** private evidence objects. Database records store object paths and metadata, not public URLs.  
* **Matching module:** deterministic features and optional semantic similarity; records method/version/score/features; never merges automatically.  
* **Future automation:** n8n may trigger notifications or intake jobs after the MVP, using authenticated, idempotent API contracts.

## **4\. Request and trust boundaries**

1. Browser signs in through Supabase Auth and receives a short-lived access token.  
2. Browser sends `Authorization: Bearer <access_token>` to FastAPI.  
3. FastAPI validates the token using the supported Supabase/JWT verification approach configured for the project. It must not merely decode an unverified JWT.  
4. FastAPI resolves the internal user profile and current roles/memberships, then authorizes the requested action against the target case, bureau, scope, and grant validity.  
5. FastAPI performs the transaction and writes required audit history.  
6. The response includes only fields the caller is allowed to see.  
7. For uploads/downloads, FastAPI authorizes the parent record before issuing a short-lived signed URL or streaming the object. Storage remains private.

**Important implementation choice:** use the Supabase server-side client or direct PostgreSQL access from FastAPI only with server-side credentials. Keep `service_role`/secret keys out of the Vite client bundle. Decide the exact DB access library during implementation; SQLAlchemy 2.x \+ Alembic is the default recommendation if using direct PostgreSQL access.

## **5\. Authentication and authorization model**

Authorization is an intersection of:

* authenticated identity;  
* active internal user account;  
* global role and permission;  
* active bureau membership;  
* case/bureau assignment;  
* case-specific access grant and its scope/expiry/revocation;  
* requested operation;  
* note visibility and evidence classification.

Default-deny. The frontend may hide unavailable actions but the backend must enforce them. Do not treat Super Admin as an unconditional content-access bypass. RLS must be designed and tested for any direct client access; with the selected backend-mediated approach, browser access to sensitive tables should be minimized. Keep RLS enabled for exposed tables and use carefully scoped policies; never use an unrestricted service role from the browser.

## **6\. Matching decision**

The initial candidate pipeline should be explainable and replaceable:

1. Verify/resolve institution identifier, using exact verified Permanent ID as strongest signal.  
2. Apply a configurable 60-day candidate lookback for duplicate discovery.  
3. Generate lexical/metadata features (normalized subject/body, category, source reference, dates, institution).  
4. Optionally compute semantic similarity when enabled and appropriate for the data/privacy constraints.  
5. Store score, method/version, matched features, and candidate status.  
6. Route candidates to human review. Reviewer can associate the submission with an existing case, reject the candidate, or create a new case.  
7. Preserve the source submission regardless of decision.

A score of `>= 0.90` is only a high-confidence review-queue threshold in the initial demo configuration. It is not a calibrated probability and does not authorize automatic merging.

## **7\. Environments and deployment**

* **Local:** Vite frontend, FastAPI backend, dedicated development Supabase project or local Supabase stack. Use synthetic data only.  
* **Hosted demo:** separate frontend deployment and FastAPI deployment, separate Supabase project, seeded illustrative data, visible demo banner.  
* **Production (not approved by this ADR):** requires security review, official policy sign-off, retention schedule, threat model, backup/restore tests, monitoring, secrets management, access review, incident response, and approved integration contracts.

Configuration is environment-based. Never commit `.env` files, Supabase secret keys, JWT secrets, or external credentials. Provide `.env.example` with placeholders only.

## **8\. API conventions**

* Base path: `/api/v1`  
* JSON for ordinary requests/responses.  
* UTC timestamps in ISO 8601 format.  
* UUIDs for internal primary keys; human-readable `case_number` is a separate immutable identifier.  
* Pagination: `limit` and `cursor` (or a documented offset scheme for initial MVP; cursor is preferred for large queues).  
* Filters must be allowlisted and bounded.  
* Mutating operations should accept `Idempotency-Key` where retry can create duplicate effects.  
* Use `ETag`/`If-Match` or a `version` field for conflict-sensitive updates.  
* Standard errors: `code`, `message`, `request_id`, optional field `details`; never leak SQL, tokens, or sensitive case content.  
* Generate OpenAPI from FastAPI and review it as a versioned API artifact.

## **9\. Transaction boundaries**

Must be atomic:

* create canonical case and associate its first submission;  
* resolve duplicate review and associate submission;  
* change case status and append action history;  
* change assignment and append history;  
* complete approved transfer while preserving old assignment history;  
* approve/revoke access grant and write audit event;  
* apply deadline override and write audit event;  
* process idempotent intake.

Use database transactions and/or narrowly scoped PostgreSQL functions for multi-row invariants. Avoid implementing cross-row rules only in frontend code.

## **10\. Non-functional requirements (initial targets; validate later)**

* No unauthorized access through API, search, exports, notification payloads, or Storage.  
* Every material action has server timestamp and actor attribution.  
* Bounded queries, pagination, and indexes on queue filters.  
* Accessible keyboard interactions and readable status text.  
* Original complaint text preserved; normalized text is derived and versioned.  
* Logs exclude complaint bodies, access tokens, signed URLs, and unnecessary personal data.  
* Backups and restore procedure documented for any hosted environment.  
* Tests include RB, PGRC, unrelated bureau, case officer, bureau admin, Super Admin, and auditor profiles.

## **11\. Key consequences and trade-offs**

**Benefits:** clear separation of UI and domain rules; typed, documented API; Python ecosystem for matching; relational integrity; replaceable integrations; auditable workflows.

**Costs:** two application services (frontend and API) plus managed data services; developers must maintain API contracts, deployment configuration, token verification, and authorization tests.

**Rejected shortcuts:** custom password storage; browser-side service-role credentials; automatic duplicate merging; public evidence buckets; hard-coded official SLA claims; unauthorized scraping/integration; direct UI-only permission enforcement.

## **12\. Decisions still requiring approval**

* Official bureau list and category-to-bureau routing matrix.  
* Current authoritative SLA/SOP source for each case type, clock start/pause behavior, holidays, escalation authority.  
* Retention, archival, legal hold, and disposal schedule.  
* Official institution master-data source and refresh cadence.  
* Whether a case supports multiple categories in MVP.  
* Exact case-number format.  
* Which cross-bureau fields can be shown in the minimal index.  
* Who may approve access grants and whether grants are user- or bureau-scoped.  
* Attachment classification, file limits, malware scanning, and retention.  
* Production hosting, data residency, monitoring, and recovery requirements.

## **13\. Acceptance checks for this ADR**

* A signed-in user cannot access a case solely by guessing its UUID.  
* A user can see a minimal cross-bureau index row without gaining the complaint body.  
* An expired/revoked grant stops access immediately.  
* A bureau-private note is not returned to other bureaus.  
* A duplicate score never merges cases without a reviewer decision.  
* Repeating a mutation with the same idempotency key does not duplicate effects.  
* Case creation and first-submission association either both commit or both roll back.  
* Every status change creates an audit/action-history event in the same transaction.  
* The demo clearly states simulated submissions are not delivered to AICTE/CPGRAMS.


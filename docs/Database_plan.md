# **AICTE OneDesk — Database Implementation Plan and Table Context Catalogue**

**Document ID:** ANX-DB-001  
**Version:** 1.0 logical plan  
**Status:** Table-by-table implementation plan; not yet production SQL  
**Database:** Supabase PostgreSQL  
**Migration approach:** ordered, version-controlled migrations; validate and test each table before continuing

## **1\. Purpose and working method**

This document turns the existing logical ER model into an implementation sequence. It is not a replacement for the master ER model and it is not a claim that all physical decisions have been approved. The canonical concepts remain: one case per underlying issue, preserve every submission, verified institution identity before case creation, many-to-many bureau participation, human-reviewed duplicate candidates, least-privilege cross-bureau visibility, and append-oriented audit history.

### **Table-by-table delivery contract**

For **each table**, the implementation step will deliver:

1. A numbered SQL migration for that table and any necessary index/constraint.  
2. A table context sheet documenting purpose, column-by-column meaning, SQL type, nullability/default, constraints, foreign keys, relationships, features and API routes.  
3. Seed data only where safe and clearly illustrative.  
4. Validation queries and expected outcomes.  
5. Access/RLS analysis and tests.  
6. A migration dependency note and rollback/recovery consideration.

Do not create all tables in one unreviewed script. Create, inspect, test, and approve each table before moving to dependent tables.

## **2\. Global database conventions**

* Use `uuid` primary keys with `gen_random_uuid()` unless a real external key is mandated.  
* Use `timestamptz` for event times and UTC at the API boundary.  
* Use `created_at` and `updated_at` where mutable records need them; immutable event tables may need only an event timestamp.  
* Use foreign keys with deliberate delete behavior. Avoid cascading deletion of case/audit records. Prefer `RESTRICT`/soft deactivation for referenced records.  
* Use check constraints for bounded values and date/score invariants; use reference tables when values need governed configuration.  
* Use partial unique indexes for “one active row” invariants where supported.  
* Use JSONB only for bounded source-specific metadata or event details—not as a substitute for normalized relational fields.  
* Use explicit `ON DELETE` behavior. Do not hard-delete users/bureaus/cases with retained audit history.  
* Use migrations through Alembic or an agreed migration tool; never edit production schema manually without recording the migration.  
* Supabase Auth owns credentials. `users.auth_user_id` maps to the Auth identity; no password column exists.  
* Private files live in Supabase Storage. The database stores metadata/object paths only.  
* RLS and backend authorization must agree. Never expose a service-role key to the browser.  
* Do not assume that an illustrative category, bureau, SLA, institution, case number or deadline is official.  
* Before production, obtain approved retention/disposal rules, current routing taxonomy, official bureau list, and field-level access policy.

## **3\. Dependency-aware implementation sequence**

### **Phase A — Foundation and reference data**

1. `regions`  
2. `institutions`  
3. `institution_aliases`  
4. `bureaus`  
5. `users`  
6. `bureau_memberships`

### **Phase B — Roles and permissions**

7. `roles`  
8. `permissions`  
9. `role_permissions`  
10. `user_role_assignments`

### **Phase C — Governed workflow configuration**

11. `intake_channels`  
12. `complaint_categories`  
13. `case_statuses`  
14. `case_status_transitions` (recommended if transitions need to be configurable)

### **Phase D — Intake and institution verification**

15. `submissions`  
16. `institution_verification_tasks`

### **Phase E — Canonical cases and matching**

17. `cases`  
18. `duplicate_candidates`  
19. `case_relationships`

### **Phase F — Assignments, transfers, and collaboration**

20. `case_bureau_assignments`  
21. `case_officer_assignments`  
22. `case_transfers`  
23. `case_notes`

### **Phase G — Access control and evidence**

24. `case_access_requests`  
25. `case_access_grants`  
26. `attachments`

### **Phase H — Audit and policy execution**

27. `case_action_history`  
28. `sla_policies`  
29. `case_deadlines`  
30. `escalation_rules`  
31. `case_escalations`

### **Phase I — Notifications and reliable processing**

32. `notification_rules`  
33. `notifications`  
34. `idempotency_records` (recommended addition)  
35. `outbox_events` (recommended addition for reliable future event delivery)

**Dependency note:** the logical master model lists some entities in a different order. Physical migration order must follow actual foreign keys. For example, `users` must exist before tables that reference users, and `cases` must exist before assignment/history tables. If the project chooses to reference `auth.users` directly, confirm migration privileges and Supabase conventions first.

## **4\. Core ER relationships**

\`\`\`mermaid  
erDiagram  
  REGIONS \|\|--o{ INSTITUTIONS : classifies  
  INSTITUTIONS \|\|--o{ INSTITUTION\_ALIASES : has  
  INSTITUTIONS \|\|--o{ CASES : concerns  
  INTAKE\_CHANNELS \|\|--o{ SUBMISSIONS : receives  
  SUBMISSIONS \|\|--o{ INSTITUTION\_VERIFICATION\_TASKS : verifies  
  SUBMISSIONS \|\|--o{ DUPLICATE\_CANDIDATES : compared  
  INSTITUTIONS \|\|--o{ CASES : identifies  
  COMPLAINT\_CATEGORIES \|\|--o{ CASES : classifies  
  CASE\_STATUSES \|\|--o{ CASES : current\_status  
  CASES \|\|--o{ SUBMISSIONS : groups  
  CASES \|\|--o{ CASE\_BUREAU\_ASSIGNMENTS : assigned  
  BUREAUS \|\|--o{ CASE\_BUREAU\_ASSIGNMENTS : handles  
  CASE\_BUREAU\_ASSIGNMENTS \|\|--o{ CASE\_OFFICER\_ASSIGNMENTS : staffed  
  USERS \|\|--o{ CASE\_OFFICER\_ASSIGNMENTS : works  
  CASES \|\|--o{ CASE\_ACTION\_HISTORY : audits  
  CASES \|\|--o{ CASE\_NOTES : notes  
  CASES \|\|--o{ CASE\_DEADLINES : deadlines  
  SLA\_POLICIES \|\|--o{ CASE\_DEADLINES : governs  
  CASES \|\|--o{ CASE\_ESCALATIONS : escalates  
  ESCALATION\_RULES \|\|--o{ CASE\_ESCALATIONS : triggers  
\`\`\`

## **5\. Table-by-table context catalogue**

The following sections define each table’s intended contract. Exact DDL is generated table-by-table after its dependencies and constraints are confirmed. Types below are proposed PostgreSQL types and may be adjusted during the physical schema review.

### **1\. `regions`**

**Phase:** Foundation  
**Purpose:** Reference list of geographic/administrative regions.

**Proposed attributes:** id UUID PK; code TEXT; name TEXT; description TEXT nullable; is\_active BOOLEAN; created\_at/updated\_at TIMESTAMPTZ

**Constraints and validation:** Unique normalized code; name required; soft-deactivate rather than delete when referenced.

**Relationships:** One region to many institutions.

**Connected features / API areas:** Institution profile, region filters, dashboards/reports.

**Table-specific SQL deliverable:** `NNNN_create_regions.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **2\. `institutions`**

**Phase:** Foundation  
**Purpose:** Canonical institution master record.

**Proposed attributes:** id UUID PK; aicte\_permanent\_id TEXT; official\_name TEXT; address JSONB or normalized address columns (decision); region\_id UUID FK nullable; verification\_status TEXT/enum; source\_reference TEXT; is\_active BOOLEAN; timestamps

**Constraints and validation:** Unique Permanent ID when verified (partial unique index may be needed); status enum/check; verified status requires a valid ID/source evidence; do not infer identity from name alone.

**Relationships:** Region 1:N institutions; institution 1:N aliases and cases; optional institution reference from submissions before resolution.

**Connected features / API areas:** Institution lookup, institution profile, verified case creation, reports.

**Table-specific SQL deliverable:** `NNNN_create_institutions.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **3\. `institution_aliases`**

**Phase:** Foundation  
**Purpose:** Verified and unverified alternate names/spellings.

**Proposed attributes:** id UUID PK; institution\_id UUID FK; alias\_text TEXT; normalized\_alias TEXT; language\_code TEXT; source TEXT; verification\_status TEXT; verified\_by UUID FK users nullable; verified\_at TIMESTAMPTZ nullable; timestamps

**Constraints and validation:** Alias text nonblank; normalized alias indexed; provenance required; uniqueness policy should avoid duplicate active aliases per institution/language.

**Relationships:** Institution 1:N aliases; optional verifier user.

**Connected features / API areas:** Institution matching and identity verification.

**Table-specific SQL deliverable:** `NNNN_create_institution_aliases.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **4\. `users`**

**Phase:** Identity  
**Purpose:** Application profile mapped to Supabase Auth identity.

**Proposed attributes:** id UUID PK; auth\_user\_id UUID UNIQUE; employee\_reference TEXT nullable; display\_name TEXT; email CITEXT/TEXT; account\_status TEXT; last\_login\_at TIMESTAMPTZ nullable; timestamps

**Constraints and validation:** No password fields; auth\_user\_id references auth.users if migration permissions permit; unique email policy must account for Supabase identity; deactivate rather than delete.

**Relationships:** User 1:N memberships, role assignments, notes, actions, notifications.

**Connected features / API areas:** Authentication mapping, authorization, attribution.

**Table-specific SQL deliverable:** `NNNN_create_users.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **5\. `bureaus`**

**Phase:** Identity  
**Purpose:** Approved organizational units in the application.

**Proposed attributes:** id UUID PK; code TEXT UNIQUE; name TEXT; description TEXT nullable; bureau\_type TEXT; is\_active BOOLEAN; timestamps

**Constraints and validation:** Unique code; only validated units seeded as official; demo units visibly illustrative.

**Relationships:** Bureau 1:N memberships and case-bureau assignments.

**Connected features / API areas:** Bureau workspace, assignment, workload, permissions.

**Table-specific SQL deliverable:** `NNNN_create_bureaus.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **6\. `bureau_memberships`**

**Phase:** Identity  
**Purpose:** Time-bounded user membership in a bureau.

**Proposed attributes:** id UUID PK; user\_id UUID FK; bureau\_id UUID FK; membership\_role TEXT; valid\_from TIMESTAMPTZ; valid\_until TIMESTAMPTZ nullable; is\_active BOOLEAN; created\_by\_user\_id UUID FK nullable; timestamps

**Constraints and validation:** valid\_until \> valid\_from if present; prevent overlapping/duplicate active membership using exclusion/partial unique strategy as chosen; only authorized admin can change.

**Relationships:** User N:M bureau via memberships.

**Connected features / API areas:** Active bureau context, officer eligibility, access evaluation.

**Table-specific SQL deliverable:** `NNNN_create_bureau_memberships.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **7\. `roles`**

**Phase:** Authorization  
**Purpose:** Named application roles.

**Proposed attributes:** id UUID PK; code TEXT UNIQUE; name TEXT; description TEXT nullable; is\_system\_role BOOLEAN; timestamps

**Constraints and validation:** Unique stable code; seeded roles reviewed; do not treat role names in frontend as authorization.

**Relationships:** Role N:M users via user\_role\_assignments; N:M permissions via role\_permissions.

**Connected features / API areas:** Admin, bureau admin, case officer, reviewer, management, auditor.

**Table-specific SQL deliverable:** `NNNN_create_roles.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **8\. `permissions`**

**Phase:** Authorization  
**Purpose:** Atomic permission catalogue.

**Proposed attributes:** id UUID PK; code TEXT UNIQUE; description TEXT; resource TEXT; action TEXT; timestamps

**Constraints and validation:** Unique permission code; permission codes stable and machine-readable.

**Relationships:** Permission N:M roles through role\_permissions.

**Connected features / API areas:** Fine-grained API and UI capability mapping.

**Table-specific SQL deliverable:** `NNNN_create_permissions.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **9\. `user_role_assignments`**

**Phase:** Authorization  
**Purpose:** Role assignment to a user, optionally scoped to bureau.

**Proposed attributes:** id UUID PK; user\_id UUID FK; role\_id UUID FK; bureau\_id UUID FK nullable; valid\_from TIMESTAMPTZ; valid\_until TIMESTAMPTZ nullable; granted\_by\_user\_id UUID FK nullable; revoked\_at TIMESTAMPTZ nullable; timestamps

**Constraints and validation:** Valid date range; audit grant/revoke; null bureau means global scope only for roles designed to allow it; unique active equivalent assignment.

**Relationships:** User N:M roles; optional bureau scope.

**Connected features / API areas:** Authorization and admin access management.

**Table-specific SQL deliverable:** `NNNN_create_user_role_assignments.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **10\. `role_permissions`**

**Phase:** Authorization  
**Purpose:** Join table between roles and permissions.

**Proposed attributes:** role\_id UUID FK; permission\_id UUID FK; created\_at TIMESTAMPTZ; composite PK(role\_id, permission\_id)

**Constraints and validation:** Composite PK; no duplicate grants.

**Relationships:** Role N:M permissions.

**Connected features / API areas:** Effective permission computation.

**Table-specific SQL deliverable:** `NNNN_create_role_permissions.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **11\. `intake_channels`**

**Phase:** Configuration  
**Purpose:** Registry of source channels such as simulated portal or email connector.

**Proposed attributes:** id UUID PK; code TEXT UNIQUE; name TEXT; channel\_type TEXT; is\_active BOOLEAN; configuration\_reference TEXT nullable; timestamps

**Constraints and validation:** Never store secrets in configuration\_reference; unique code; distinguish simulated from real channels.

**Relationships:** Channel 1:N submissions.

**Connected features / API areas:** Demo portals, future authorized integrations, source reporting.

**Table-specific SQL deliverable:** `NNNN_create_intake_channels.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **12\. `complaint_categories`**

**Phase:** Configuration  
**Purpose:** Governed category taxonomy.

**Proposed attributes:** id UUID PK; code TEXT UNIQUE; name TEXT; description TEXT nullable; parent\_category\_id UUID FK self nullable; default\_priority TEXT; is\_active BOOLEAN; timestamps

**Constraints and validation:** Prevent self-parent and cycles in application validation; category code unique; routing is not embedded as fixed ownership.

**Relationships:** Category 1:N cases and SLA policy versions; optional hierarchy.

**Connected features / API areas:** Classification, filters, routing configuration, SLA selection.

**Table-specific SQL deliverable:** `NNNN_create_complaint_categories.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **13\. `case_statuses`**

**Phase:** Configuration  
**Purpose:** Shared case lifecycle vocabulary.

**Proposed attributes:** id UUID PK; code TEXT UNIQUE; name TEXT; description TEXT nullable; is\_terminal BOOLEAN; display\_order INTEGER; is\_active BOOLEAN; timestamps

**Constraints and validation:** Stable unique code; transition legality belongs in workflow service or separate transition table if approved.

**Relationships:** Case N:1 current status; action history references from/to status.

**Connected features / API areas:** Kanban, case lifecycle, reports.

**Table-specific SQL deliverable:** `NNNN_create_case_statuses.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **14\. `submissions`**

**Phase:** Intake  
**Purpose:** Immutable record of each incoming complaint event.

**Proposed attributes:** id UUID PK; intake\_channel\_id UUID FK; external\_reference TEXT nullable; received\_at TIMESTAMPTZ; original\_text TEXT; original\_language TEXT; normalized\_text TEXT nullable; normalization\_version TEXT nullable; submitter\_reference TEXT nullable; institution\_id UUID FK nullable; canonical\_case\_id UUID FK nullable; intake\_status TEXT; content\_fingerprint TEXT nullable; source\_metadata JSONB; idempotency\_key TEXT nullable; timestamps

**Constraints and validation:** Source reference unique within channel when non-null; idempotency key scope defined; preserve original text; institution/case nullable until resolved; bound JSON size and avoid core fields in JSON.

**Relationships:** Channel 1:N submissions; optional institution and case; 1:N verification tasks, candidates, attachments.

**Connected features / API areas:** Demo intake, preservation, source traceability, repeat submission handling.

**Table-specific SQL deliverable:** `NNNN_create_submissions.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **15\. `institution_verification_tasks`**

**Phase:** Intake  
**Purpose:** Candidate institution resolution work and reviewer decision.

**Proposed attributes:** id UUID PK; submission\_id UUID FK; candidate\_institution\_id UUID FK nullable; match\_score NUMERIC(5,4) nullable; verification\_status TEXT; assigned\_to\_user\_id UUID FK nullable; decision TEXT nullable; decision\_reason TEXT nullable; resolved\_at TIMESTAMPTZ nullable; created\_at/updated\_at

**Constraints and validation:** Score in \[0,1\]; terminal decision requires reviewer/time/reason as configured; unresolved submissions cannot create/routable cases.

**Relationships:** Submission 1:N tasks; candidate institution optional; assigned reviewer user.

**Connected features / API areas:** Identity queue, verified institution association, audit trail.

**Table-specific SQL deliverable:** `NNNN_create_institution_verification_tasks.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **16\. `cases`**

**Phase:** Case core  
**Purpose:** Canonical issue record; not one case per source or bureau.

**Proposed attributes:** id UUID PK; case\_number TEXT UNIQUE; institution\_id UUID FK NOT NULL; primary\_category\_id UUID FK; current\_status\_id UUID FK; priority TEXT; title TEXT; summary TEXT nullable; opened\_at TIMESTAMPTZ; closed\_at TIMESTAMPTZ nullable; created\_by\_user\_id UUID FK; reopened\_at TIMESTAMPTZ nullable; version INTEGER; timestamps

**Constraints and validation:** Case number immutable/unique; verified institution required by transactional workflow; closed\_at only for terminal state per approved lifecycle; version increments on conflict-sensitive update.

**Relationships:** Institution/category/status N:1; 1:N submissions, assignments, notes, actions, deadlines, escalations.

**Connected features / API areas:** Case detail, Kanban, institution profile, reports, linked submissions.

**Table-specific SQL deliverable:** `NNNN_create_cases.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **17\. `duplicate_candidates`**

**Phase:** Matching  
**Purpose:** Candidate comparisons generated for human review.

**Proposed attributes:** id UUID PK; submission\_id UUID FK; candidate\_case\_id UUID FK; confidence\_score NUMERIC(5,4); matching\_method TEXT; model\_version TEXT nullable; matched\_features JSONB; review\_status TEXT; reviewed\_by\_user\_id UUID FK nullable; reviewed\_at TIMESTAMPTZ nullable; review\_decision TEXT nullable; review\_reason TEXT nullable; timestamps

**Constraints and validation:** Score \[0,1\]; submission/case pair unique; reviewed status requires reviewer/time/decision; score never causes automatic merge.

**Relationships:** Submission N:M candidate cases through this table.

**Connected features / API areas:** Duplicate queue, explainable matching, reviewer decisions.

**Table-specific SQL deliverable:** `NNNN_create_duplicate_candidates.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **18\. `case_relationships`**

**Phase:** Case core  
**Purpose:** Explicit links between distinct canonical cases.

**Proposed attributes:** id UUID PK; case\_a\_id UUID FK; case\_b\_id UUID FK; relationship\_type TEXT; created\_by\_user\_id UUID FK; reason TEXT; confirmed\_at TIMESTAMPTZ nullable; is\_active BOOLEAN; timestamps

**Constraints and validation:** No self-link; canonical pair ordering or unique unordered pair; relationship enum; consequential link requires reason and authorized action.

**Relationships:** Self-referential N:M cases.

**Connected features / API areas:** Related case view, potential overlap, supersedes/duplicate relationships.

**Table-specific SQL deliverable:** `NNNN_create_case_relationships.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **19\. `case_bureau_assignments`**

**Phase:** Assignments  
**Purpose:** Represents each bureau's involvement in a case.

**Proposed attributes:** id UUID PK; case\_id UUID FK; bureau\_id UUID FK; assignment\_type TEXT; assignment\_status TEXT; is\_primary BOOLEAN; assigned\_at TIMESTAMPTZ; ended\_at TIMESTAMPTZ nullable; assigned\_by\_user\_id UUID FK; reason TEXT nullable; timestamps

**Constraints and validation:** At most one active assignment per case/bureau; primary-bureau invariant enforced transactionally; ended\_at after assigned\_at.

**Relationships:** Case N:M bureau; assignment 1:N officer assignments.

**Connected features / API areas:** Cross-bureau coordination, workload, ownership.

**Table-specific SQL deliverable:** `NNNN_create_case_bureau_assignments.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **20\. `case_officer_assignments`**

**Phase:** Assignments  
**Purpose:** Officer assignment within a specific bureau assignment.

**Proposed attributes:** id UUID PK; case\_bureau\_assignment\_id UUID FK; user\_id UUID FK; assignment\_role TEXT; assigned\_at TIMESTAMPTZ; ended\_at TIMESTAMPTZ nullable; assigned\_by\_user\_id UUID FK; timestamps

**Constraints and validation:** Valid date range; active officer must have active bureau membership or explicit authorized exception; avoid duplicate active assignment.

**Relationships:** Bureau assignment 1:N officer assignments; user 1:N assignments.

**Connected features / API areas:** My work queue, responsible officer, workload.

**Table-specific SQL deliverable:** `NNNN_create_case_officer_assignments.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **21\. `case_transfers`**

**Phase:** Assignments  
**Purpose:** Formal request and history for transfer of responsibility.

**Proposed attributes:** id UUID PK; case\_id UUID FK; from\_bureau\_assignment\_id UUID FK; to\_bureau\_assignment\_id UUID FK; requested\_by\_user\_id UUID FK; approved\_by\_user\_id UUID FK nullable; transfer\_status TEXT; reason TEXT; requested\_at TIMESTAMPTZ; completed\_at TIMESTAMPTZ nullable; timestamps

**Constraints and validation:** From and to assignments must belong to same case; from \!= to; decision authority checked; completed transfer preserves old assignment/history.

**Relationships:** Case 1:N transfers; each transfer references source and target assignments.

**Connected features / API areas:** Transfer workflow, audit, responsibility handover.

**Table-specific SQL deliverable:** `NNNN_create_case_transfers.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **22\. `case_access_requests`**

**Phase:** Access  
**Purpose:** Request to view restricted case details.

**Proposed attributes:** id UUID PK; case\_id UUID FK; requesting\_user\_id UUID FK; requesting\_bureau\_id UUID FK nullable; requested\_scope TEXT; reason TEXT; request\_status TEXT; decided\_by\_user\_id UUID FK nullable; decision\_reason TEXT nullable; decided\_at TIMESTAMPTZ nullable; expires\_at TIMESTAMPTZ nullable; timestamps

**Constraints and validation:** Valid states; decision fields required on decision; expiry after request/decision as defined; requesters cannot approve own request unless approved policy explicitly allows.

**Relationships:** Case 1:N requests; user requests; approver user.

**Connected features / API areas:** Cross-bureau collaboration and least-privilege access.

**Table-specific SQL deliverable:** `NNNN_create_case_access_requests.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **23\. `case_access_grants`**

**Phase:** Access  
**Purpose:** Time-bounded scope grant to exactly one user or bureau.

**Proposed attributes:** id UUID PK; case\_id UUID FK; grantee\_user\_id UUID FK nullable; grantee\_bureau\_id UUID FK nullable; access\_scope TEXT; granted\_by\_user\_id UUID FK; granted\_at TIMESTAMPTZ; expires\_at TIMESTAMPTZ nullable; revoked\_at TIMESTAMPTZ nullable; source\_request\_id UUID FK nullable; timestamps

**Constraints and validation:** Exactly one of grantee\_user\_id/grantee\_bureau\_id; expiry after grant; revocation tracked; scope allowlisted; no implicit private-note access.

**Relationships:** Case 1:N grants; optional user/bureau grantee; optional source request.

**Connected features / API areas:** Access decisions, case detail, attachments, scope enforcement.

**Table-specific SQL deliverable:** `NNNN_create_case_access_grants.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **24\. `case_status_transitions`**

**Phase:** Optional workflow config  
**Purpose:** Allowed transitions between case statuses; recommended addition if transitions need data-driven administration.

**Proposed attributes:** id UUID PK; from\_status\_id UUID FK; to\_status\_id UUID FK; permission\_code TEXT nullable; requires\_reason BOOLEAN; is\_active BOOLEAN; timestamps

**Constraints and validation:** Unique from/to pair; no self-transition unless explicitly allowed; permission code validated against permissions.

**Relationships:** Status self-join N:M through transition rows.

**Connected features / API areas:** Workflow validation, transition UI. Add if PRD requires configurable transitions.

**Table-specific SQL deliverable:** `NNNN_create_case_status_transitions.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **25\. `case_action_history`**

**Phase:** Audit/workflow  
**Purpose:** Append-only event log for material case actions.

**Proposed attributes:** id UUID PK; case\_id UUID FK; actor\_user\_id UUID FK nullable for trusted system events; bureau\_id UUID FK nullable; action\_type TEXT; from\_status\_id UUID FK nullable; to\_status\_id UUID FK nullable; action\_at TIMESTAMPTZ; remarks TEXT nullable; metadata JSONB; correlation\_id UUID/TEXT nullable

**Constraints and validation:** Server timestamp; ordinary users cannot update/delete; metadata must not contain secrets or uncontrolled complaint body; indexes by case/time and actor/time.

**Relationships:** Case 1:N actions; optional actor/bureau/status references.

**Connected features / API areas:** Timeline, audit, incident review, metrics.

**Table-specific SQL deliverable:** `NNNN_create_case_action_history.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **26\. `case_notes`**

**Phase:** Collaboration  
**Purpose:** Shared or bureau-private case notes.

**Proposed attributes:** id UUID PK; case\_id UUID FK; author\_user\_id UUID FK; visibility\_type TEXT; bureau\_id UUID FK nullable; body TEXT; created\_at TIMESTAMPTZ; edited\_at TIMESTAMPTZ nullable; edited\_by\_user\_id UUID FK nullable; deleted\_at TIMESTAMPTZ nullable

**Constraints and validation:** Shared note should not carry private bureau\_id unless defined; bureau-private note requires bureau\_id; edit/delete audited; access filtered server-side.

**Relationships:** Case 1:N notes; author user; optional bureau scope.

**Connected features / API areas:** Collaboration, internal notes, case timeline.

**Table-specific SQL deliverable:** `NNNN_create_case_notes.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **27\. `attachments`**

**Phase:** Evidence  
**Purpose:** Metadata for objects stored in private Supabase Storage.

**Proposed attributes:** id UUID PK; submission\_id UUID FK nullable; case\_id UUID FK nullable; uploaded\_by\_user\_id UUID FK; storage\_object\_path TEXT UNIQUE; original\_filename TEXT; mime\_type TEXT; file\_size\_bytes BIGINT; checksum TEXT nullable; uploaded\_at TIMESTAMPTZ; classification TEXT; scan\_status TEXT

**Constraints and validation:** At least one valid parent; enforce parent consistency; file size \> 0 and max limit; allowlisted MIME; path unique; never public; do not trust filename MIME alone.

**Relationships:** Submission and/or case parent; uploader user.

**Connected features / API areas:** Evidence, intake attachments, authorized download.

**Table-specific SQL deliverable:** `NNNN_create_attachments.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **28\. `sla_policies`**

**Phase:** Policy configuration  
**Purpose:** Versioned category-level timeline policy.

**Proposed attributes:** id UUID PK; category\_id UUID FK; policy\_code TEXT; version INTEGER; acknowledgement\_duration INTEGER nullable; action\_duration INTEGER nullable; disposal\_duration INTEGER nullable; duration\_unit TEXT; calendar\_basis TEXT; effective\_from DATE/TIMESTAMPTZ; effective\_until DATE/TIMESTAMPTZ nullable; source\_document TEXT nullable; verification\_status TEXT; is\_active BOOLEAN; timestamps

**Constraints and validation:** Unique policy\_code+version; valid effective range; positive durations; activation requires source and approved verification state; illustrative is explicit.

**Relationships:** Category 1:N policy versions; policy 1:N case deadlines.

**Connected features / API areas:** Due-date calculation, SLA configuration, reporting.

**Table-specific SQL deliverable:** `NNNN_create_sla_policies.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **29\. `case_deadlines`**

**Phase:** Policy execution  
**Purpose:** Actual milestone deadlines instantiated for a case.

**Proposed attributes:** id UUID PK; case\_id UUID FK; sla\_policy\_id UUID FK nullable; deadline\_type TEXT; started\_at TIMESTAMPTZ; due\_at TIMESTAMPTZ nullable; paused\_at TIMESTAMPTZ nullable; resumed\_at TIMESTAMPTZ nullable; completed\_at TIMESTAMPTZ nullable; deadline\_status TEXT; override\_reason TEXT nullable; overridden\_by\_user\_id UUID FK nullable; policy\_snapshot JSONB; timestamps

**Constraints and validation:** due\_at can be null if policy unconfigured; date ordering checks; override requires reason/actor; snapshot records applied version and calculation basis.

**Relationships:** Case 1:N deadlines; optional applied policy.

**Connected features / API areas:** Due soon/overdue queue, case details, escalation triggers.

**Table-specific SQL deliverable:** `NNNN_create_case_deadlines.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **30\. `escalation_rules`**

**Phase:** Policy configuration  
**Purpose:** Configurable trigger and recipient rule.

**Proposed attributes:** id UUID PK; code TEXT UNIQUE; name TEXT; trigger\_type TEXT; threshold\_duration INTEGER nullable; recipient\_scope TEXT; priority TEXT; is\_active BOOLEAN; effective\_from TIMESTAMPTZ; effective\_until TIMESTAMPTZ nullable; timestamps

**Constraints and validation:** Valid effective range; threshold positive when applicable; recipients and policy approved; no unverified automatic escalation in production.

**Relationships:** Rule 1:N case escalations.

**Connected features / API areas:** Escalation engine, workload alerts.

**Table-specific SQL deliverable:** `NNNN_create_escalation_rules.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **31\. `case_escalations`**

**Phase:** Policy execution  
**Purpose:** Recorded occurrence of an escalation.

**Proposed attributes:** id UUID PK; case\_id UUID FK; escalation\_rule\_id UUID FK; triggered\_at TIMESTAMPTZ; escalation\_level INTEGER; recipient\_user\_id UUID FK nullable; recipient\_bureau\_id UUID FK nullable; reason TEXT; resolution\_status TEXT; resolved\_at TIMESTAMPTZ nullable; resolved\_by\_user\_id UUID FK nullable; deduplication\_key TEXT; timestamps

**Constraints and validation:** Escalation level positive; deduplication key unique for rule/window; resolved state requires resolver/time.

**Relationships:** Case 1:N escalation events; rule 1:N events; recipient user/bureau.

**Connected features / API areas:** Escalation history, alerts, dashboard.

**Table-specific SQL deliverable:** `NNNN_create_case_escalations.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **32\. `notification_rules`**

**Phase:** Notifications  
**Purpose:** Configuration mapping events to recipient/channel/template.

**Proposed attributes:** id UUID PK; code TEXT UNIQUE; event\_type TEXT; recipient\_scope TEXT; channel TEXT; template\_reference TEXT; is\_active BOOLEAN; timestamps

**Constraints and validation:** Unique code; channel enum; template contains no hard-coded secrets; only approved channels enabled.

**Relationships:** Rule 1:N notifications.

**Connected features / API areas:** In-app notification generation and later email.

**Table-specific SQL deliverable:** `NNNN_create_notification_rules.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **33\. `notifications`**

**Phase:** Notifications  
**Purpose:** Per-recipient notification and read/delivery state.

**Proposed attributes:** id UUID PK; notification\_rule\_id UUID FK nullable; recipient\_user\_id UUID FK; event\_type TEXT; subject TEXT; body\_reference TEXT nullable; related\_case\_id UUID FK nullable; created\_at TIMESTAMPTZ; read\_at TIMESTAMPTZ nullable; delivery\_status TEXT; deduplication\_key TEXT; timestamps

**Constraints and validation:** Unique deduplication key at defined scope; recipient must be valid; avoid restricted complaint text in body/preview.

**Relationships:** User 1:N notifications; optional rule and related case.

**Connected features / API areas:** Notification centre, reminders, deadline alerts.

**Table-specific SQL deliverable:** `NNNN_create_notifications.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **34\. `idempotency_records`**

**Phase:** Operational reliability  
**Purpose:** Recommended addition to safely retry mutating requests and integration intake.

**Proposed attributes:** id UUID PK; key TEXT; actor\_user\_id UUID FK nullable; route\_scope TEXT; request\_hash TEXT; response\_status INTEGER nullable; response\_body JSONB nullable; expires\_at TIMESTAMPTZ; created\_at TIMESTAMPTZ

**Constraints and validation:** Unique key \+ actor/route scope; same key with different request hash returns conflict; response body must not store sensitive payload unnecessarily.

**Relationships:** Actor user optional; logical link to operation, not necessarily FK to every resource.

**Connected features / API areas:** Safe retries for case creation, intake, duplicate decisions, transfers.

**Table-specific SQL deliverable:** `NNNN_create_idempotency_records.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

### **35\. `outbox_events`**

**Phase:** Operational reliability  
**Purpose:** Recommended transactional outbox for reliable notifications/integration events.

**Proposed attributes:** id UUID PK; event\_type TEXT; aggregate\_type TEXT; aggregate\_id UUID; payload JSONB; occurred\_at TIMESTAMPTZ; published\_at TIMESTAMPTZ nullable; attempts INTEGER; last\_error\_code TEXT nullable

**Constraints and validation:** Payload minimized and classified; retries bounded; no secrets; only insert in same transaction as source event; unique event/dedup key as needed.

**Relationships:** Logical reference to domain aggregate; consumers include notification worker/n8n later.

**Connected features / API areas:** Reliable event delivery and future integrations.

**Table-specific SQL deliverable:** `NNNN_create_outbox_events.sql` plus indexes, grants/RLS policy tests as applicable. Include a rollback note and verification query in the migration ticket.

## **6\. Cross-table constraints that require special care**

### **6.1 Verified institution before case creation**

A simple foreign key proves that an institution row exists; it does not prove the row is verified. Enforce this in a trusted transaction/function or service layer, and add a database guard if the chosen schema supports it safely.

### **6.2 Case creation and first submission**

Creating a case and linking the initiating submission must be atomic. If either write fails, both roll back. Case number generation must be concurrency-safe and immutable.

### **6.3 Duplicate review**

A candidate score is a suggestion, not a decision. The reviewer decision and submission-to-case association should commit atomically and create a history event. The same source submission must not be associated to two cases.

### **6.4 Active bureau assignment and primary assignment**

Use partial unique indexes for active case/bureau pairs. Enforcing exactly one active primary bureau across multiple rows may require a partial unique index plus a transaction-level check; confirm whether zero-primary states are permitted during transfers.

### **6.5 Access grants**

Exactly one of `grantee_user_id` and `grantee_bureau_id` must be non-null. Scope is enumerated and grant expiry/revocation must be checked on every request. A bureau grant does not automatically reveal private notes or all attachments.

### **6.6 Notes and attachments**

`case_notes.visibility_type = 'bureau_private'` requires a bureau scope. Attachments require a valid parent and must have a private object path. If attachments may belong to both a submission and its case, verify consistency between those parent references.

### **6.7 SLA and deadlines**

A deadline must store the policy version and calculation basis used at the time. Unknown/unverified policy means the deadline may be absent or marked verification-required; never silently insert a generic deadline. Policy-specific timeframes must not be merged into a universal SLA.

### **6.8 Audit immutability**

Ordinary application users cannot update/delete audit events. Corrections should be new events. Sensitive access decisions should remain auditable even when the actor cannot view case content.

### **6.9 Idempotency and outbox**

Idempotency prevents the same retry from duplicating side effects; it must not erase genuine repeat submissions. An outbox row is written in the same transaction as the domain event, then delivered/retried asynchronously.

## **7\. RLS and API access plan**

1. Identify which tables are accessed directly by the browser, if any. Default: sensitive case tables are accessed through FastAPI.  
2. Enable RLS on exposed tables and write policies that deny by default.  
3. Do not assume a role in a JWT alone proves current bureau membership; membership/grant revocation must be reflected promptly.  
4. Avoid broad `SELECT` on `cases` for users who only have index visibility. Use an authorized server projection or carefully scoped view/RPC.  
5. Keep private notes and attachment metadata behind case-scope checks.  
6. Protect Storage buckets as private and enforce parent-record authorization before issuing signed URLs.  
7. Do not grant `service_role` to frontend or normal users.  
8. Test the matrix using Super Admin, RB member, PGRC member, unrelated bureau member, assigned officer, unassigned officer, auditor, inactive user, expired grant, and revoked grant.

## **8\. Validation queries to include in table tickets**

Each table ticket must include:

* Table exists and expected columns/types/defaults are present.  
* Primary key and foreign keys are present.  
* Unique/check constraints reject invalid records.  
* Indexes support documented queue queries.  
* Unauthorized read/write attempts fail.  
* Soft deactivation preserves historical references.  
* Representative synthetic rows can be inserted and queried.  
* Migration is repeatable only according to the migration tool’s rules; do not rely on blind `IF NOT EXISTS` to hide schema drift.

## **9\. SQL migration naming**

Recommended file naming:

* `0001_create_regions.sql`  
* `0002_create_institutions.sql`  
* `0003_create_institution_aliases.sql`  
* ...  
* `0035_create_outbox_events.sql`

Use one migration per table or one tightly coupled dependency group. Do not renumber applied migrations; append new migrations.

## **10\. Important open schema decisions**

Resolve before production SQL freeze:

1. Official institution master source and refresh/reconciliation method.  
2. Current official bureau list and approved category-to-bureau routing matrix.  
3. Whether cases need multiple formal categories in MVP.  
4. Case-number format.  
5. Exact cross-bureau index fields and grant approvers.  
6. Attachment size/type limits, malware scanning, classification and retention.  
7. Official retention/archive/legal-hold/disposal policy.  
8. SLA source, clock basis, pause rules, calendar/holiday handling and escalation authority.  
9. External submitter identity/contact fields and privacy/consent requirements.  
10. Whether status transitions are a configurable table or fixed validated service rules.  
11. Direct client database access versus API-mediated access; recommended default is API-mediated for sensitive domain data.  
12. Whether a transactional outbox is included in MVP or introduced when asynchronous notifications/integrations begin.

## **11\. First implementation ticket**

**Table 1: `regions`** is the first SQL deliverable because it has no domain foreign-key dependency and supports institution records and filters.

The next table ticket should contain:

* `0001_create_regions.sql`  
* `regions.context.md`  
* a seed script for clearly illustrative regions only  
* checks for unique code, required name, active flag, and timestamp defaults  
* permission/RLS note  
* insert/select/update/deactivate validation SQL

After approval, proceed to `institutions`, then `institution_aliases`. Do not start `cases` until institution verification and reference data rules are clear.


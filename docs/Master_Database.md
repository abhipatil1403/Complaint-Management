# **AICTE Integrated Institution Complaint Monitoring and Status Dashboard**

## **Master Database Design and ER Model**

**Version:** 0.1 \--- Logical design draft  
**Status:** Proposed baseline for review; not production SQL  
**Purpose:** Authoritative reference for the normalized data model and  
subsequent Supabase implementation.

---

## **1\. Database design principles**

1. **One canonical case per underlying issue.** A case is not  
   synonymous with an intake submission.  
2. **Preserve every submission.** Portal, CPGRAMS and email submissions  
   retain their source identity, original text, language, timestamps  
   and external references---even when they are associated with an  
   existing case.  
3. **Institution identity is verified.** A canonical case is created  
   only after its institution has been resolved. Uncertain submissions  
   remain in an institution-verification queue.  
4. **Many-to-many relationships are explicit.** Cases can involve  
   several bureaus; officers can have authorized memberships in several  
   bureaus.  
5. **Human review controls consequential decisions.** Duplicate  
   candidates are scored and surfaced for review; the score alone does  
   not merge cases or discard submissions.  
6. **Cross-bureau index visibility differs from content access.**  
   Authorized users may see a minimal case index while complaint  
   details, attachments and restricted notes remain protected.  
7. **History is append-oriented.** Actions, transfers, access  
   decisions, duplicate decisions and escalations must remain  
   auditable.  
8. **Rules are data, not hard-coded UI logic.** Complaint categories,  
   status vocabulary, SLA policy versions, escalation rules and  
   notification rules are configurable.  
9. **Reports derive from canonical records.** Dashboard totals should  
   be calculated from source entities or secured views, not maintained  
   as competing writable copies.  
10. **Supabase is the system of record.** n8n and other integrations  
    orchestrate intake and notifications but do not become alternate  
    sources of truth.

## **2\. Normalization assessment**

The proposed design targets **Third Normal Form (3NF)** for  
transactional data, subject to final column-level review when the  
physical schema is written.

* **1NF:** Each field stores one value; do not store multiple bureau  
  IDs, officer IDs, attachment URLs or categories in comma-separated  
  columns.  
* **2NF:** Attributes in junction entities depend on the complete key.  
  For example, case-specific officer assignment data belongs to  
  `case_officer_assignments`, not to a user or bureau row.  
* **3NF:** Descriptive bureau, region, category, role and status  
  labels belong in their respective reference entities rather than  
  being repeated in every case row.  
* **History versus current state:** `cases.current_status_id` and  
  current assignment indicators may be retained as operational  
  projections for efficient queries, but every state transition must  
  also be written to the append-only history. These values must be  
  updated transactionally and never treated as a substitute for  
  history.  
* **Avoid polymorphic foreign keys:** An attachment should not use an  
  unchecked `(parent_type, parent_id)` pair. Use a defined owner such  
  as a submission or case, or separate validated association tables  
  where multiple parent types are genuinely required.  
* **Avoid derived duplicates:** Institution name, bureau name and  
  category label should not be copied into every transactional row as  
  independently editable values. Snapshot fields are allowed only when  
  explicitly required for audit/legal preservation and must be named  
  as snapshots.  
* **Temporal configuration:** SLA policies need effective dates and  
  versions. A case deadline records the policy/version applied when it  
  was calculated.

Normalization cannot be certified solely from entity names. It must be  
rechecked against actual attributes, candidate keys, functional  
dependencies and constraints before SQL is approved.

## **3\. Logical ER model**

The diagram below shows the principal relationships. It is intentionally  
logical rather than a final physical schema.

\`\`\`mermaid  
erDiagram  
    REGIONS \|\|--o{ INSTITUTIONS : classifies  
    INSTITUTIONS \|\|--o{ INSTITUTION\_ALIASES : has  
    INSTITUTIONS \|\|--o{ CASES : concerns  
    INTAKE\_CHANNELS \|\|--o{ SUBMISSIONS : receives  
    SUBMISSIONS \|\|--o{ INSTITUTION\_VERIFICATION\_TASKS : may\_require  
    INSTITUTIONS o\|--o{ SUBMISSIONS : identified\_as  
    CASES o\|--o{ SUBMISSIONS : associated\_with  
    COMPLAINT\_CATEGORIES \|\|--o{ CASES : classifies  
    SUBMISSIONS \|\|--o{ DUPLICATE\_CANDIDATES : source\_submission  
    CASES \|\|--o{ DUPLICATE\_CANDIDATES : candidate\_case  
    CASES \|\|--o{ CASE\_RELATIONSHIPS : related\_case\_a  
    CASES \|\|--o{ CASE\_RELATIONSHIPS : related\_case\_b  
    BUREAUS \|\|--o{ BUREAU\_MEMBERSHIPS : has  
    USERS \|\|--o{ BUREAU\_MEMBERSHIPS : holds  
    ROLES \|\|--o{ USER\_ROLE\_ASSIGNMENTS : assigned  
    USERS \|\|--o{ USER\_ROLE\_ASSIGNMENTS : receives  
    ROLES \|\|--o{ ROLE\_PERMISSIONS : grants  
    PERMISSIONS \|\|--o{ ROLE\_PERMISSIONS : included  
    CASES \|\|--o{ CASE\_BUREAU\_ASSIGNMENTS : assigned\_to  
    BUREAUS \|\|--o{ CASE\_BUREAU\_ASSIGNMENTS : handles  
    CASE\_BUREAU\_ASSIGNMENTS \|\|--o{ CASE\_OFFICER\_ASSIGNMENTS : staffed\_by  
    USERS \|\|--o{ CASE\_OFFICER\_ASSIGNMENTS : works\_on  
    CASES \|\|--o{ CASE\_ACTION\_HISTORY : records  
    CASE\_STATUSES \|\|--o{ CASE\_ACTION\_HISTORY : records\_status  
    CASES \|\|--o{ CASE\_NOTES : has  
    USERS \|\|--o{ CASE\_NOTES : authors  
    BUREAUS o\|--o{ CASE\_NOTES : scopes\_private\_note  
    SUBMISSIONS \|\|--o{ ATTACHMENTS : includes  
    CASES o\|--o{ ATTACHMENTS : includes  
    COMPLAINT\_CATEGORIES \|\|--o{ SLA\_POLICIES : governed\_by  
    SLA\_POLICIES \|\|--o{ CASE\_DEADLINES : instantiated\_as  
    CASES \|\|--o{ CASE\_DEADLINES : has  
    CASES \|\|--o{ CASE\_ESCALATIONS : escalates  
    ESCALATION\_RULES \|\|--o{ CASE\_ESCALATIONS : triggers  
    CASES \|\|--o{ CASE\_ACCESS\_REQUESTS : access\_requested  
    USERS \|\|--o{ CASE\_ACCESS\_REQUESTS : requests  
    CASES \|\|--o{ CASE\_ACCESS\_GRANTS : access\_scoped  
    USERS o\|--o{ CASE\_ACCESS\_GRANTS : user\_grantee  
    BUREAUS o\|--o{ CASE\_ACCESS\_GRANTS : bureau\_grantee  
    USERS \|\|--o{ NOTIFICATIONS : receives  
    NOTIFICATION\_RULES \|\|--o{ NOTIFICATIONS : generates  
\`\`\`

**Diagram interpretation:** optional relationships indicate that a  
record may exist before the relevant association is resolved. The exact  
physical constraints---including how attachments associate with cases  
and submissions, and how access grants identify their grantee---must be  
enforced in SQL.

## **4\. Entity catalogue and attributes**

Attribute lists below are brief logical requirements, not final SQL  
types. Common fields such as `id`, `created_at` and `updated_at` are not  
repeated in every row. Use UUID primary keys unless an integration or  
externally mandated identifier requires another type. Human-readable  
Case IDs and source reference IDs are separate from database primary  
keys.

### **4.1 Institution and reference data**

#### **`regions`**

* **Purpose:** Standard region or regional-office reference.  
* **Attributes:** `id`, `code`, `name`, `description`, `is_active`.  
* **Relationships:** One region to many institutions.  
* **Rules:** Region codes are unique. Do not infer an institution's  
  region from the assigned officer.

#### **`institutions`**

* **Purpose:** Canonical AICTE institution identity.  
* **Attributes:** `id`, `aicte_permanent_id`, `official_name`,  
  `address`, `region_id`, `verification_status`, `source_reference`,  
  `is_active`.  
* **Relationships:** Many cases and aliases; one region per current  
  classification unless requirements establish a  
  temporal/multiple-region model.  
* **Rules:** Enforce uniqueness on a verified AICTE Permanent ID. A  
  provisional or unverified institution must not be treated as a  
  verified canonical institution.

#### **`institution_aliases`**

* **Purpose:** Alternate names, spelling variants and recognized  
  historical names used during institution matching.  
* **Attributes:** `id`, `institution_id`, `alias_text`,  
  `normalized_alias`, `language_code`, `source`, `verified_by`,  
  `verified_at`.  
* **Relationships:** Many aliases to one institution.  
* **Rules:** Preserve alias provenance; do not let an unverified alias  
  silently override a verified Permanent ID.

#### **`complaint_categories`**

* **Purpose:** Governed category taxonomy for classification, routing  
  and SLA policy.  
* **Attributes:** `id`, `code`, `name`, `description`,  
  `parent_category_id`, `default_priority`, `is_active`.  
* **Relationships:** One category to many cases and SLA policy  
  versions.  
* **Rules:** Category hierarchy is optional; do not hard-code bureau  
  ownership into the category row if routing may change over time.

### **4.2 Intake and case records**

#### **`intake_channels`**

* **Purpose:** Identifies how a submission entered the system.  
* **Attributes:** `id`, `code`, `name`, `channel_type`, `is_active`,  
  `configuration_reference`.  
* **Relationships:** One channel to many submissions.  
* **Rules:** Store secrets and credentials in a secrets manager, not  
  in this table.

#### **`submissions`**

* **Purpose:** Immutable record of each incoming complaint event,  
  including repeated submissions.  
* **Attributes:** `id`, `intake_channel_id`, `external_reference`,  
  `received_at`, `original_text`, `original_language`,  
  `normalized_text`, `normalization_version`, `submitter_reference`,  
  `institution_id` (nullable until resolved), `canonical_case_id`  
  (nullable until associated), `intake_status`, `content_fingerprint`,  
  `source_metadata`.  
* **Relationships:** Many submissions can be associated with one case;  
  each submission is associated with at most one canonical case.  
* **Rules:** Unique source-reference constraints must be scoped to the  
  relevant source system. Preserve original text. `source_metadata` is  
  for source-specific fields that do not warrant first-class columns;  
  do not hide core relational data in JSON.

#### **`institution_verification_tasks`**

* **Purpose:** Tracks institution identity checks and their outcomes.  
* **Attributes:** `id`, `submission_id`, `candidate_institution_id`,  
  `match_score`, `verification_status`, `assigned_to_user_id`,  
  `decision`, `decision_reason`, `resolved_at`.  
* **Relationships:** A submission can have multiple candidate  
  attempts/tasks; each task may point to a candidate institution.  
* **Rules:** Keep unresolved submissions out of normal case  
  creation/routing. Record the final decision and reviewer.

#### **`cases`**

* **Purpose:** Canonical record for one underlying complaint issue.  
* **Attributes:** `id`, `case_number`, `institution_id`,  
  `primary_category_id`, `current_status_id`, `priority`, `title`,  
  `summary`, `opened_at`, `closed_at`, `created_by_user_id`,  
  `reopened_at`.  
* **Relationships:** One institution, many submissions, assignments,  
  notes, actions, deadlines and escalations.  
* **Rules:** `case_number` is unique and immutable. `institution_id`  
  is required when a canonical case is created. Keep source-specific  
  IDs in submissions, not in the case number.

#### **`duplicate_candidates`**

* **Purpose:** Stores similarity comparisons requiring review.  
* **Attributes:** `id`, `submission_id`, `candidate_case_id`,  
  `confidence_score`, `matching_method`, `model_version`,  
  `matched_features`, `review_status`, `reviewed_by_user_id`,  
  `reviewed_at`, `review_decision`, `review_reason`.  
* **Relationships:** One submission may be compared with many  
  candidate cases; a case may be a candidate for many submissions.  
* **Rules:** Score is a model score, not automatically a calibrated  
  probability. Scores at or above the initial 0.90 threshold enter the  
  high-confidence review queue; lower potential matches can also be  
  surfaced. No automatic merge or deletion.

#### **`case_relationships`**

* **Purpose:** Explicitly links distinct cases.  
* **Attributes:** `id`, `case_a_id`, `case_b_id`, `relationship_type`,  
  `created_by_user_id`, `reason`, `confirmed_at`, `is_active`.  
* **Relationships:** Many-to-many self-relationship between cases.  
* **Rules:** Prevent self-links. Define canonical ordering or  
  uniqueness constraints to prevent duplicate reciprocal links.  
  Relationship types can include `related`, `duplicate_of`,  
  `supersedes` and `potential_conflict`; only authorized human  
  decisions confirm consequential relationships.

### **4.3 Users, bureaus and authorization**

#### **`bureaus`**

* **Purpose:** AICTE organizational units participating in case  
  handling.  
* **Attributes:** `id`, `code`, `name`, `description`, `bureau_type`,  
  `is_active`.  
* **Relationships:** Many memberships and case assignments.  
* **Rules:** Unique bureau code; use seed/reference records for RB,  
  PGRC and other validated units.

#### **`users`**

* **Purpose:** Authorized system identities.  
* **Attributes:** `id`, `auth_user_id`, `employee_reference`,  
  `display_name`, `email`, `account_status`, `last_login_at`.  
* **Relationships:** Bureau memberships, role assignments, actions,  
  notes and notifications.  
* **Rules:** Link to Supabase Auth; do not store passwords or create a  
  parallel authentication system.

#### **`bureau_memberships`**

* **Purpose:** Defines a user's membership in a bureau.  
* **Attributes:** `id`, `user_id`, `bureau_id`, `membership_role`,  
  `valid_from`, `valid_until`, `is_active`.  
* **Relationships:** Junction between users and bureaus.  
* **Rules:** Support several officers per bureau and authorized  
  cross-bureau membership. Avoid duplicate active memberships for the  
  same user/bureau.

#### **`roles`**

* **Purpose:** Named system roles such as Super Admin, Bureau Admin,  
  Case Officer, Reviewer and Read-only/Auditor.  
* **Attributes:** `id`, `code`, `name`, `description`,  
  `is_system_role`.  
* **Relationships:** Many users through user-role assignments; many  
  permissions through role-permission assignments.

#### **`permissions`**

* **Purpose:** Atomic capabilities such as `case.view_index`,  
  `case.view_restricted`, `case.assign`, `case.transfer`,  
  `case.dispose`, `access.approve` and `sla.configure`.  
* **Attributes:** `id`, `code`, `description`, `resource`, `action`.  
* **Relationships:** Many-to-many with roles.  
* **Rules:** Permission checks must be enforced server-side and  
  through database policies where applicable.

#### **`user_role_assignments`**

* **Purpose:** Associates users with roles and, where necessary, a  
  defined scope.  
* **Attributes:** `id`, `user_id`, `role_id`, `bureau_id` (nullable  
  for global scope), `valid_from`, `valid_until`,  
  `granted_by_user_id`.  
* **Relationships:** Junction between users and roles.  
* **Rules:** Distinguish a global Super Admin role from a  
  bureau-scoped role; audit grants and revocations.

#### **`role_permissions`**

* **Purpose:** Junction between roles and permissions.  
* **Attributes:** `role_id`, `permission_id`.  
* **Relationships:** Many-to-many.  
* **Rules:** Composite unique/primary key on the pair.

### **4.4 Assignment and access**

#### **`case_bureau_assignments`**

* **Purpose:** Represents a bureau's involvement in a case.  
* **Attributes:** `id`, `case_id`, `bureau_id`, `assignment_type`,  
  `assignment_status`, `is_primary`, `assigned_at`, `ended_at`,  
  `assigned_by_user_id`, `reason`.  
* **Relationships:** Junction between cases and bureaus; one  
  assignment has many officer assignments.  
* **Rules:** Support primary and collaborating bureau assignments.  
  Enforce at most one active assignment per case/bureau and a defined  
  primary-bureau policy.

#### **`case_officer_assignments`**

* **Purpose:** Assigns individual officers to a particular case/bureau  
  assignment.  
* **Attributes:** `id`, `case_bureau_assignment_id`, `user_id`,  
  `assignment_role`, `assigned_at`, `ended_at`, `assigned_by_user_id`.  
* **Relationships:** One bureau assignment to many officer  
  assignments.  
* **Rules:** Keep the responsible officer distinguishable from  
  additional participants. Enforce that assigned users have  
  appropriate active membership or explicit authorization.

#### **`case_access_requests`**

* **Purpose:** Records requests to view restricted case details.  
* **Attributes:** `id`, `case_id`, `requesting_user_id`,  
  `requesting_bureau_id`, `requested_scope`, `reason`,  
  `request_status`, `decided_by_user_id`, `decision_reason`,  
  `decided_at`, `expires_at`.  
* **Relationships:** One case to many requests.  
* **Rules:** Only the case owner or designated authorized officer can  
  approve, deny or revoke access under the approved policy.

#### **`case_access_grants`**

* **Purpose:** Records authorized access to restricted case details.  
* **Attributes:** `id`, `case_id`, `grantee_user_id` (nullable),  
  `grantee_bureau_id` (nullable), `access_scope`,  
  `granted_by_user_id`, `granted_at`, `expires_at`, `revoked_at`,  
  `source_request_id`.  
* **Relationships:** Case to many grants; grant applies to one user or  
  one bureau.  
* **Rules:** Require exactly one grantee target unless a deliberate  
  alternative is approved. Define precedence, expiry and revocation  
  behavior. A bureau grant must not expose private notes unless their  
  visibility policy explicitly allows it.

#### **`case_transfers`**

* **Purpose:** Audits formal responsibility transfers.  
* **Attributes:** `id`, `case_id`, `from_bureau_assignment_id`,  
  `to_bureau_assignment_id`, `requested_by_user_id`,  
  `approved_by_user_id`, `transfer_status`, `reason`, `requested_at`,  
  `completed_at`.  
* **Relationships:** Many transfers over a case lifecycle.  
* **Rules:** Transfer changes responsibility but does not erase  
  historical assignments or actions.

### **4.5 Workflow and evidence**

#### **`case_statuses`**

* **Purpose:** Shared status reference used across bureaus.  
* **Attributes:** `id`, `code`, `name`, `description`, `is_terminal`,  
  `display_order`, `is_active`.  
* **Suggested initial values:** `received`, `under_review`,  
  `under_process`, `awaiting_information`, `escalated`, `disposed`,  
  `rejected`, `reopened`.  
* **Rules:** Transfers and access states are not themselves case  
  statuses. Valid transitions must be enforced by workflow logic.

#### **`case_action_history`**

* **Purpose:** Chronological audit of meaningful case actions.  
* **Attributes:** `id`, `case_id`, `actor_user_id`, `bureau_id`,  
  `action_type`, `from_status_id`, `to_status_id`, `action_at`,  
  `remarks`, `metadata`, `correlation_id`.  
* **Relationships:** One case to many action events.  
* **Rules:** Append-only for ordinary users. Corrections use a new  
  auditable event rather than silent edits. Never rely on client  
  timestamps as the authoritative time.

#### **`case_notes`**

* **Purpose:** Supports collaboration while preserving private bureau  
  notes.  
* **Attributes:** `id`, `case_id`, `author_user_id`,  
  `visibility_type`, `bureau_id` (required for bureau-private notes),  
  `body`, `created_at`, `edited_at`, `edited_by_user_id`,  
  `deleted_at`.  
* **Relationships:** One case to many notes.  
* **Rules:** Shared notes are visible to authorized assigned  
  participants; bureau-private notes are visible only to authorized  
  users within the defined bureau scope. Changes and  
  deletion/retention must be audited.

#### **`attachments`**

* **Purpose:** Metadata for documents and evidence stored in private  
  Supabase Storage buckets.  
* **Attributes:** `id`, `submission_id` (nullable), `case_id`  
  (nullable), `uploaded_by_user_id`, `storage_object_path`,  
  `original_filename`, `mime_type`, `file_size_bytes`, `checksum`,  
  `uploaded_at`, `classification`, `scan_status`.  
* **Relationships:** Belongs to a submission, case or both through  
  explicit validated associations.  
* **Rules:** Require at least one valid parent association; validate  
  parent consistency. Do not make private evidence publicly  
  accessible. Apply upload limits, allowed MIME types, malware  
  scanning and authorization checks.

### **4.6 SLA, escalation and notification**

#### **`sla_policies`**

* **Purpose:** Versioned category-based timelines.  
* **Attributes:** `id`, `category_id`, `policy_code`, `version`,  
  `acknowledgement_duration`, `action_duration`, `disposal_duration`,  
  `duration_unit`, `calendar_basis`, `effective_from`,  
  `effective_until`, `source_document`, `verification_status`,  
  `is_active`.  
* **Relationships:** One category to many policy versions; a policy  
  version may be applied to many case deadlines.  
* **Rules:** Unverified demo values must be labelled illustrative. Do  
  not represent an illustrative deadline as official AICTE policy.

#### **`case_deadlines`**

* **Purpose:** Stores the deadlines actually calculated for a case.  
* **Attributes:** `id`, `case_id`, `sla_policy_id`, `deadline_type`,  
  `started_at`, `due_at`, `paused_at`, `resumed_at`, `completed_at`,  
  `deadline_status`, `override_reason`, `overridden_by_user_id`.  
* **Relationships:** One case to one or more milestone deadlines.  
* **Rules:** Preserve the applied policy version and the calculation  
  basis. Overrides require authorization and an audit event.

#### **`escalation_rules`**

* **Purpose:** Configures escalation conditions and recipients.  
* **Attributes:** `id`, `code`, `name`, `trigger_type`,  
  `threshold_duration`, `recipient_scope`, `priority`, `is_active`,  
  `effective_from`, `effective_until`.  
* **Relationships:** One rule can trigger many case escalations.  
* **Rules:** Keep rule configuration distinct from actual escalation  
  occurrences.

#### **`case_escalations`**

* **Purpose:** Records each escalation event.  
* **Attributes:** `id`, `case_id`, `escalation_rule_id`,  
  `triggered_at`, `escalation_level`, `recipient_user_id`,  
  `recipient_bureau_id`, `reason`, `resolution_status`, `resolved_at`,  
  `resolved_by_user_id`.  
* **Relationships:** One case to many escalation events.  
* **Rules:** Deduplicate repeated triggers for the same rule and  
  deadline window; retain all legitimate subsequent escalation levels.

#### **`notification_rules`**

* **Purpose:** Defines which events produce notifications.  
* **Attributes:** `id`, `code`, `event_type`, `recipient_scope`,  
  `channel`, `template_reference`, `is_active`.  
* **Relationships:** One rule to many generated notifications.  
* **Rules:** Support in-app alerts initially; email delivery can be  
  integrated later.

#### **`notifications`**

* **Purpose:** Per-recipient delivery and read-state record.  
* **Attributes:** `id`, `notification_rule_id`, `recipient_user_id`,  
  `event_type`, `subject`, `body_reference`, `related_case_id`,  
  `created_at`, `read_at`, `delivery_status`, `deduplication_key`.  
* **Relationships:** One user to many notifications; one event may  
  generate separate notifications for multiple recipients.  
* **Rules:** Do not put restricted complaint text in notifications  
  visible to users without content access. Use a minimal alert and  
  route the user through authorization checks.

## **5\. Additional entity and schema decisions**

### **5.1 Submission association versus duplicate candidate**

A submission can be associated with one canonical case only. Candidate  
comparisons are separate records because one submission may resemble  
multiple cases. A reviewer resolves the candidate set, then the  
submission is associated with the selected case or proceeds to create a  
new case.

### **5.2 Institution verification**

`submissions.institution_id` is nullable while unresolved. Verification  
tasks record candidates and decisions. Once verified, the resolved  
institution is set and normal case creation/routing can proceed. Avoid  
creating an `institutions` row for every unverified spelling.

### **5.3 Multi-domain complaints**

Use one canonical case with multiple `case_bureau_assignments`. If  
reporting later requires multiple independent complaint categories per  
case, add a `case_categories` junction rather than a list field. A  
primary category may remain for default SLA selection, but category  
assignment and bureau assignment must not be assumed to be identical.

### **5.4 Case status versus intake status**

`submissions.intake_status` tracks intake processing, such as  
`received`, `awaiting_institution_verification`,  
`awaiting_duplicate_review`, `associated_with_case`, `new_case_created`  
or `rejected_as_invalid`. `cases.current_status_id` tracks the  
operational case lifecycle. They are different state machines.

### **5.5 Audit integrity**

Record actor, server timestamp, action type and affected case for all  
material actions. Sensitive access decisions should be auditable even if  
the user cannot view the underlying case content. Do not permit ordinary  
application users to update or delete audit history.

### **5.6 Data retention and deletion**

Define retention rules for complaint text, attachments, email content,  
access logs and audit records before production deployment. Do not  
cascade-delete case history when a user, bureau membership or source  
integration is deactivated. Prefer deactivation and restricted retention  
over destructive deletion where records must remain auditable.

## **6\. Important indexes and constraints to consider later**

These are design requirements, not SQL statements:

* Unique verified `institutions.aicte_permanent_id`.  
* Unique `cases.case_number`.  
* Unique source reference scoped to `intake_channel_id` where a source  
  reference exists.  
* Index `submissions` by resolved institution and receipt time for the  
  60-day candidate search.  
* Index cases by institution, status, primary category and opened  
  date.  
* Index active case-bureau assignments by bureau and case.  
* Index officer assignments by user and active assignment state.  
* Index unresolved verification tasks and pending duplicate candidates  
  by review status and creation time.  
* Unique role-permission and user-role assignment keys appropriate to  
  their scope.  
* Check constraints for score range, valid deadline ordering, note  
  visibility requirements and exactly-one access-grantee target.  
* Prevent self-referential case relationships and duplicate reciprocal  
  relationships.  
* Use transaction-safe logic for creating a case and associating its  
  first submission.  
* Use a durable idempotency key or source fingerprint to reduce  
  repeated processing without deleting repeated submissions.

## **7\. Supabase implementation and security principles**

* Use Supabase Auth for user authentication; map application users to  
  the Auth user ID.  
* Enable Row Level Security on all tables exposed to client access.  
* Treat a minimal cross-bureau index as a separate authorized  
  query/view or carefully scoped policy. Do not grant broad table  
  access merely to make the dashboard work.  
* Protect case details, bureau-private notes and Storage objects with  
  server-side authorization.  
* Keep privileged service-role credentials out of browser code.  
* Use database transactions or trusted server-side functions for case  
  creation, assignment changes, access grants, deadline calculation  
  and duplicate-review resolution.  
* Never rely on frontend filtering as the only security boundary.  
* Test access using users from RB, PGRC, an unassigned bureau, a case  
  officer, a bureau administrator and Super Admin.  
* Record changes to role membership and access grants.

## **8\. Open decisions before physical schema approval**

1. Exact official institution master-data source and reconciliation  
   process.  
2. Official bureau list, organizational hierarchy and cross-bureau  
   membership policy.  
3. Official category taxonomy and verified SLA/SOP source documents.  
4. Whether cases can have multiple formal categories in the first  
   release.  
5. Attachment ownership and retention policy.  
6. Whether external submitter identities and contact information must  
   be stored, and which fields are mandatory.  
7. Which Super Admin operations may access restricted content.  
8. Whether SLA clocks pause during any specific state, and under which  
   official rule.  
9. Case-number format and whether it includes a year or bureau prefix.  
10. Data retention, archival and privacy requirements for real  
    deployment.

**Approval gate:** approve the logical entities and cardinalities first.  
Then freeze the PRD and master data dictionary together, resolve open  
policy decisions, and only then generate SQL migrations table by table.


# **AICTE Integrated Institution Complaint Monitoring and Status Dashboard**

## **Product Requirements Document \--- Implementation Source of Truth**

**Document ID:** AICTE-ICMS-PRD  
**Project Title:** AICTE OneDesk  
**Version:** 1.1 \--- Source-researched implementation specification  
**Status:** Detailed baseline for product review; not yet approved as  
official AICTE operating policy  
**System of record:** Supabase PostgreSQL  
**Initial delivery:** Seeded-data demonstrator with simulated intake  
portals  
**Later integration:** n8n, authorized email ingestion, and CPGRAMS  
integration only where an approved mechanism exists

---

# **0\. How to use this document**

This document specifies intended product behavior. It is intended to be  
used with the separate **Master Database Design and ER Model**. The PRD  
explains what the system must do; the database document defines  
canonical entities and their relationships.

## **0.1 Source-of-truth hierarchy**

When requirements conflict, apply this hierarchy:

1. Applicable laws, regulations, formally approved AICTE policies, SOPs  
   and competent-authority instructions.  
2. This approved PRD for product behavior.  
3. Approved master database specification and migration history for  
   data structures.  
4. Approved UI designs and feature-specific technical notes.  
5. Implementation code and seed data.

Code must not silently become the specification. If a requirement cannot  
be implemented as written, the agent must document the conflict and  
propose a change before altering behavior.

## **0.2 Policy versus demonstrator assumptions**

The following are confirmed product decisions: \- One canonical case  
represents one underlying issue. \- Every source submission is  
retained. \- Institution identity must be verified before ordinary case  
creation/routing. \- Duplicate matching uses an initial 60-day  
lookback. \- A score of 0.90 or above is a high-confidence duplicate  
candidate, not an automatic merge. \- Potential duplicates require human  
review. \- One case can have multiple bureau assignments and multiple  
officers. \- Cross-bureau index access is narrower than full case-content  
access. \- Notes can be shared or bureau-private. \- Common statuses are  
used across bureaus. \- Deadlines are based on category-level SLA  
policy. \- Original Hindi or English complaint text is preserved;  
normalized text supports search/matching.

The following remain policy-dependent and must be verified before  
production: \- Complete official bureau list and responsibility matrix. \-  
Official complaint taxonomy and routing rules. \- Official  
category-specific acknowledgement, action and disposal timelines. \-  
Whether a clock can pause and under which conditions. \- Authorized  
disposal, transfer and access-approval authority for each case type. \-  
Data retention, archival, privacy and evidence requirements. \- Actual  
CPGRAMS/email integration method and authorization.

Any unverified sample deadline, category mapping, institution, officer  
or complaint must be visibly marked **Illustrative Demo Data**.

## **0.3 Requirement identifiers**

Use the requirement IDs in issue tracking, tests and implementation  
notes: \- `FR-INT-*`: intake and submissions \- `FR-INS-*`: institution  
resolution \- `FR-DUP-*`: duplicate and related-case review \-  
`FR-CASE-*`: canonical case lifecycle \- `FR-ORG-*`: bureau and officer  
management \- `FR-ACC-*`: access control and collaboration \- `FR-WF-*`:  
workflow and Kanban \- `FR-SLA-*`: deadlines and escalations \-  
`FR-NOT-*`: notifications \- `FR-SEARCH-*`: search \- `FR-REP-*`:  
dashboards and reporting \- `FR-DOC-*`: attachments and evidence \-  
`FR-AUD-*`: audit \- `FR-INTG-*`: integrations \- `NFR-*`: non-functional  
requirements \- `SEC-*`: security requirements \- `AT-*`: acceptance tests

---

# **1\. Project overview**

AICTE receives complaints and grievances concerning technical education  
institutions from students, faculty members, stakeholders and other  
concerned parties. Submissions can reach different Bureaus/Cells,  
including the Regulation Bureau (RB) and Public Grievance Redressal Cell  
(PGRC). Cases concerning the same institution may be processed  
separately, causing duplicated effort, parallel or conflicting actions,  
delays, unclear responsibility and limited management visibility.

The Integrated Institution Complaint Monitoring and Status Dashboard  
will centralize the institution identity, submissions, canonical cases,  
bureau assignments, officer ownership, status history, deadlines,  
escalations, access decisions and reports. It must provide  
institution-first visibility without granting unrestricted access to  
restricted case details.

The demonstrator will initially use seeded data and simulated complaint  
submission portals. Actual email intake, n8n workflows and authorized  
external integrations are a later phase. The database and user flows  
must be designed so future intake channels use the same source-of-truth  
rules.

# **2A. Source-verified policy baseline (reviewed 28 October 2026\)**

This section distinguishes publicly documented rules from system-design  
decisions. Public sources establish some responsibilities and timelines,  
but do not establish every internal AICTE workflow, every case category  
SLA, a complete current bureau-to-category routing matrix, or a  
complaint-specific retention schedule. Do not generalize a rule outside  
the scope of its source.

## **2A.1 Confirmed public baseline**

---

Topic Source-backed finding Product consequence Boundary

---

PGRC AICTE's published Seed PGRC as a The material does not  
 responsibilities roles/responsibilities material known bureau and prove that PGRC is  
 describes PGRC work including support the only handler for  
 grievances of CPGRAMS-origin every  
 students/faculty/stakeholders of submissions and institution-related  
 AICTE-approved technical these broad matter or supply a  
 institutions, grievances received complaint domains complete, current  
 through CPGRAMS, ragging in the data model. routing matrix for  
 complaints, complaints of violation all AICTE bureaus.  
 of AICTE norms/standards, and Confirm current  
 related coordination matters. organization orders  
 before production  
 routing.

Complaints about AICTE Approval Process Handbook Model PGRC Do not make every  
 institutions material states that complaints assignment, case follow the  
 about institutions are processed by committee-review SCSC/EVC path;  
 PGRC and describes placing them events, notices, applicability depends  
 before a Standing Complaint EVC-related actions on the complaint and  
 Scrutiny Committee (SCSC), with and follow-up as current governing  
 possible warning/show-cause notice configurable procedure.  
 or EVC and further handling under workflow actions,  
 the applicable process. where applicable to  
 the complaint type.

CPGRAMS general The current CPGRAMS FAQ states a Provide a distinct, This is not a  
 redress timeline 21-day redress timeline and source-scoped universal deadline  
 requires an interim reply with CPGRAMS milestone for every AICTE  
 reasons when delayed. policy that can complaint, internal  
 track the 21-day case, student  
 target and grievance, or  
 interim-delay regulatory action.  
 response. Validate the  
 applicable current  
 CPGRAMS instructions  
 and start-date  
 semantics before  
 production.

Student grievance The published AICTE Redressal of If the system The 2019 text itself  
 process Grievance of Students Regulations, explicitly handles says it superseded  
 2019 text states that the Student this regulated the 2012 regulation.  
 Grievance Redressal Committee student-grievance Verify later  
 (SGRC) sends its pathway, model amendments/current  
 report/recommendations within 15 these as separate, official Gazette text  
 days of receipt; a student may event-specific before production.  
 appeal to the Ombudsperson within milestones and These are  
 15 days of receiving the SGRC appeal events, not institution-level  
 decision; the Ombudsperson is to one generic case student-grievance  
 make efforts to resolve the appeal SLA. process timings, not  
 within 30 days. default AICTE PGRC  
 deadlines.

Faculty/staff AICTE Approval Process Handbook Support a separate The complete current  
 grievances material references AICTE's faculty/staff official text and  
 Redressal of Grievance of grievance pathway exact milestone rules  
 Faculty/Staff Member Regulations, and policy must be obtained and  
 2021 (F.No. configuration verified before  
 1-103/AICTE/PGRC/Regulation/2021, rather than configuring  
 dated 25 March 2021). assuming student deadlines. Do not  
 rules apply. copy student  
 timelines into  
 faculty/staff cases.

Public records Government of India's Central Implement retention A general government  
 retention Secretariat Manual of Office as policy retention schedule  
 Procedure and National Archives of configuration with does not itself  
 India guidance state that record class, establish the exact  
 departments must use applicable authority, retention period for  
 record-retention schedules; effective version, AICTE complaint/case  
 schedules for substantive functions legal hold, review records. No numeric  
 are organization-specific and are and disposal complaint retention  
 vetted through the National approval. Keep period is assumed in  
 Archives process. The Public deletion disabled this PRD.  
 Records Act/Rules constrain for official  
 destruction of public records. records until the  
 authorized schedule  
 is entered.

Cross-bureau The reviewed public materials Use least These are recommended  
 content access describe complaint responsibilities privilege, minimal system controls, not  
 and grievance processes but do not cross-bureau index, a claim that AICTE  
 establish the exact field-level scoped access has publicly  
 access policy for this proposed grants and audited prescribed this exact  
 internal dashboard. approvals as matrix. The competent  
 product security authority must  
 defaults. approve the  
 operational access  
 matrix.

---

## **2A.2 Source register**

1. **AICTE Approval Process Handbook** (AICTE-hosted PDF):  
   [https\://aicte-qa.aicte-india.org/sites/default/files/APH%20Final.pdf\\](https://aicte-qa.aicte-india.org/sites/default/files/APH%20Final.pdf\\)  
   Relevant to complaint cases, PGRC processing, SCSC and possible  
   downstream actions. The handbook must be checked against the current  
   edition and later amendments before production.  
2. **AICTE Roles and Responsibilities \--- Public Grievances Redressal**  
   **Cell** (AICTE material mirrored in a page-viewing service):  
   [https\://fliphtml5.com/jfjx/elln/Roles\_and\_Responsibilities\_21\_03\_2022\_Combined/29/\\](https://fliphtml5.com/jfjx/elln/Roles_and_Responsibilities_21_03_2022_Combined/29/\\)  
   Describes PGRC responsibility areas. Because the accessible copy is  
   hosted by a third-party viewer, obtain the original AICTE-issued  
   document/version for formal production sign-off.  
3. **CPGRAMS FAQ** (official portal): [https\://pgportal.gov.in/Home/Faq\\](https://pgportal.gov.in/Home/Faq\\)  
   States 21 days for grievance redress and an interim reply with  
   reasons for delay. Applies to CPGRAMS procedure, not automatically  
   to every internal case.  
4. **AICTE (Redressal of Grievance of Students) Regulations, 2019**  
   (reproduced legal text): [https\://indiankanoon.org/doc/93892215/\\](https://indiankanoon.org/doc/93892215/\\)  
   Text describes SGRC and Ombudsperson stages and 15-/30-day timings.  
   The reproduced page itself notes that the original publication  
   document was not available for its copy; verify the official  
   Gazette/current amendments before production.  
5. **AICTE Approval Process Handbook** (AICTE-hosted PDF, faculty/staff  
   grievance reference):  
   [https\://aicte-qa.aicte-india.org/sites/default/files/APH%20Final.pdf\\](https://aicte-qa.aicte-india.org/sites/default/files/APH%20Final.pdf\\)  
   References the 2021 faculty/staff grievance regulations. Obtain the  
   complete official notification to define its detailed process.  
6. **Central Secretariat Manual of Office Procedure** (Government of  
   India, DARPG):  
   [https\://www\.darpg.gov.in/sites/default/files/CSMOP\_0.pdf\\](https://www.darpg.gov.in/sites/default/files/CSMOP_0.pdf\\)  
   Describes record-management and retention-schedule obligations.  
7. **Records Retention Schedule guidance** (National Archives of  
   India):  
   [https\://www\.nationalarchives.nic.in/en/record-management/records-retention-schedule-rrs\\](https://www.nationalarchives.nic.in/en/record-management/records-retention-schedule-rrs\\)  
   Explains the distinction between common departmental records and  
   substantive-function records, and the need for organization-specific  
   retention schedules.

## **2A.3 Required configuration treatment**

* Create policy records with `source_name`, `source_url`,  
  `source_clause`, `jurisdiction/scope`, `verified_status`,  
  `verified_by`, `verified_at`, `effective_from`, `effective_to`,  
  `version`, and `last_reviewed_at`.  
* Status values must distinguish `official_verified`,  
  `official_source_needs_currentness_check`, `illustrative_demo`,  
  `draft_for_approval`, and `inactive`.  
* A deadline can be used for operational escalation only if its policy  
  status permits that use. Illustrative policies may appear in demo  
  mode with a persistent label but must not trigger claims of  
  regulatory non-compliance.  
* Do not combine CPGRAMS 21-day redress, student SGRC 15-day  
  reporting, student Ombudsperson 30-day resolution efforts, and  
  faculty/staff timelines into a single generic SLA.  
* If the correct policy cannot be determined, show **Policy not**  
  **configured / verification required** and route the item to an  
  authorized policy exception queue. Do not silently apply a default  
  duration.  
* Preserve the policy version applied to each deadline. Policy changes  
  require explicit effective-date and recalculation behavior.  
* Retention expiry must never automatically delete a record until an  
  approved AICTE-specific retention schedule, applicable legal holds,  
  and authorized disposal workflow are configured.

# **2\. Problem statement**

AICTE lacks a single consolidated and real-time view of  
institution-related complaints across Bureaus/Cells. As a result,  
officials may not know which unit is handling a matter, whether another  
unit has a related case, what action is pending, or whether a deadline  
is approaching. The system must enable coordinated, accountable case  
handling with institution-wise visibility, duplicate review, controlled  
cross-bureau access and deadline monitoring.

# **3\. Product vision**

For any recognized institution, an authorized official should be able to  
determine: 1\. Which submissions and canonical cases exist. 2\. Which  
bureau or bureaus are involved in each case. 3\. Which officer is  
responsible for each bureau's work. 4\. What the current status and next  
required action are. 5\. Whether related, duplicate or potentially  
overlapping matters exist. 6\. What actions have been taken, by whom and  
when. 7\. Which deadlines are due, overdue or escalated. 8\. Which case  
details the current viewer is permitted to access. 9\. What the bureau  
and management workload looks like over a selected period.

# **4\. Product principles**

1. **Institution-centred navigation:** institutions are the primary way  
   to inspect all associated cases.  
2. **One issue, one canonical case:** repeated source submissions do  
   not automatically create multiple canonical cases.  
3. **Submissions are preserved:** no duplicate review silently deletes  
   an intake event.  
4. **Identity before routing:** uncertain institution identity is held  
   for verification.  
5. **Human review for consequential matching:** confidence scores  
   assist a reviewer; they do not decide case identity alone.  
6. **Shared case, separate bureau responsibility:** collaboration does  
   not require duplicate case records.  
7. **Least-privilege visibility:** index visibility is not permission  
   to read full content.  
8. **Traceability by default:** actions, transfers, grants, status  
   changes and decisions are attributable and timestamped.  
9. **Policy-driven deadlines:** policy values are configurable,  
   versioned and sourced.  
10. **One database source of truth:** n8n and other systems orchestrate  
    events; Supabase remains the canonical store.  
11. **Separate workflow dimensions:** case status, intake status,  
    institution verification, access state, transfer state and  
    escalation state are not collapsed into one field.  
12. **Explainable operations:** reviewers should see why a candidate,  
    alert or deadline was generated.

# **5\. Goals and measurable outcomes**

## **5.1 Goals**

* Consolidate all institution-related cases across participating  
  bureaus.  
* Maintain a durable record of each submission and its source.  
* Detect likely duplicate or overlapping matters within the defined  
  lookback.  
* Make bureau and officer responsibility explicit.  
* Support coordinated action on a shared case.  
* Enforce minimal index visibility and restricted content access.  
* Track status, action history, deadlines, transfers and escalations.  
* Generate reliable institution-wise, region-wise, category-wise and  
  bureau-wise reports.  
* Enable phased integration without rewriting the domain model.

## **5.2 MVP success conditions**

* Every case has one unique internal Case ID and a verified  
  institution.  
* Multiple source submissions can be associated with one canonical  
  case while remaining independently traceable.  
* Potential duplicates display score, method/version, candidate case  
  and review status.  
* Unresolved institution records cannot enter normal case routing.  
* A case can have multiple bureau assignments and multiple officer  
  assignments.  
* Unauthorized users cannot retrieve restricted case content via UI,  
  API, search, export, notifications or Storage URLs.  
* All material actions have server timestamps and actor attribution.  
* Dashboard counts reconcile with the documented metric definitions.  
* Unverified SLA rules are clearly labelled as illustrative.  
* All key workflows have automated tests and role-based access tests.

## **5.3 Metrics to collect**

* Submission volume by source and time period.  
* Canonical case volume by institution, category, region and bureau.  
* Time from submission receipt to institution verification.  
* Time from verification to duplicate decision.  
* Percentage of submissions associated with an existing case after  
  review.  
* Human-confirmed duplicate precision and reviewer overturn rate.  
* Number of cross-bureau cases and overlap alerts.  
* Number of access requests, approvals, denials and elapsed decision  
  times.  
* Number of cases approaching deadlines, overdue and escalated.  
* Median and percentile time to first action and disposal, where  
  reliable dates exist.  
* Number of routing failures and integration retries.

Metrics must be measured from event data; do not claim a reduction in  
workload or disposal time until measured against a baseline.

# **6\. Scope and delivery plan**

## **6.1 MVP \--- seeded-data internal demonstrator**

Must include: \- Authentication and role-based access. \- Super Admin and  
bureau workspaces. \- Institution profile and region grouping. \-  
Simulated AICTE portal and simulated CPGRAMS intake portal. \- Submission  
preservation and source references. \- Institution verification queue. \-  
Duplicate candidate scoring/review screens using seeded scores or a  
replaceable matching service. \- One canonical case with multiple bureau  
assignments. \- Multiple officers per bureau and per case assignment. \-  
Shared and bureau-private notes. \- Cross-bureau minimal index, overlap  
alerts and access request workflow. \- Common case statuses and validated  
transitions. \- Kanban board. \- Case action history, transfer history and  
attachments metadata. \- Category-based SLA configuration, deadline  
displays and escalation records. \- In-app notifications. \- Search and  
filters. \- Dashboards and standard reports. \- RLS and Storage security  
tests. \- Seed data that exercises ordinary and exceptional workflows.

## **6.2 Later phases**

* n8n automation for intake processing, scheduled SLA checks and  
  notifications.  
* Authorized mailbox ingestion.  
* Real CPGRAMS integration only if approved API/access exists.  
* Production AICTE portal integration.  
* Production-grade Hindi/English normalization and cross-language  
  semantic matching.  
* Email notifications and delivery tracking.  
* Operational monitoring, dead-letter/retry queues and  
  integration-health views.  
* Import/reconciliation with an authoritative institution master  
  dataset.  
* Performance tuning based on realistic volume.

## **6.3 Out of scope unless separately approved**

* Replacing official AICTE or CPGRAMS systems.  
* Unauthorized scraping or accessing non-public external systems.  
* Automatic adjudication of grievances or regulatory decisions by AI.  
* Automatic case merging/deletion solely on a similarity score.  
* Public access to internal case records or private notes.  
* Complainant self-service case tracking in the initial internal  
  dashboard.  
* Blockchain or unrelated technologies not required by the problem  
  statement.  
* Treating sample SLA values as official.  
* A separate canonical case for each bureau merely because the same  
  issue is handled by multiple bureaus.  
* A parallel authentication system or custom password storage when  
  Supabase Auth is used.

# **7\. Personas, roles and permission model**

## **7.1 Personas**

### **Super Admin**

Manages global reference data, authorized users, memberships,  
categories, configuration and exception queues. Can see system-wide  
operational metrics. Restricted content access must still be governed by  
explicit permissions and audited; do not make all content readable  
solely because the user is an administrator.

### **Bureau Administrator**

Manages cases assigned to the bureau, staff assignment, workload, due  
dates and permitted transfers. May approve access requests only if  
designated by policy or case ownership.

### **Case Officer**

Works assigned case tasks, records actions, updates next action, adds  
notes/evidence, requests information and performs permitted status  
transitions.

### **Cross-bureau collaborator**

Sees the minimal case index and can request access. Can edit or add  
shared actions only when assigned or granted the relevant scope.

### **Senior Management / Competent Authority**

Reviews authorized aggregate dashboards, workload, ageing, overlap,  
escalation and disposal performance. Access to restricted details is  
permission-controlled.

### **Auditor / Read-only official**

Views authorized case details and history without write access, unless a  
separate permission is explicitly assigned.

### **Intake submitter**

May submit information through a demo portal. External authenticated  
tracking and direct case management are not in MVP scope.

## **7.2 Authorization dimensions**

Authorization is the intersection of: \- Authenticated user identity. \-  
Global role. \- Active bureau membership. \- Case/bureau assignment. \-  
Case-specific access grant. \- Requested operation. \- Data  
sensitivity/visibility scope. \- Grant expiry/revocation. \- Applicable  
policy.

A frontend-hidden button is not a security control. The database and  
trusted server-side operations must enforce authorization.

## **7.3 Permission matrix \--- baseline**

Legend: `Yes` means allowed only within the role's defined scope;  
`Scoped` means only with assignment/grant; `No` means denied unless an  
additional explicit permission is granted.

---

Capability Super Admin Bureau Admin Case Officer Cross-bureau Senior Auditor  
 collaborator Management

---

View aggregate Yes Scoped Scoped Scoped Yes Scoped  
 system dashboard

Manage global Yes No No No No No  
 reference data

Manage Yes Scoped only if No No No No  
 user/bureau delegated  
 membership

View minimal Yes Yes Yes Yes Yes Scoped  
 cross-bureau  
 index

View full case Permission Scoped Scoped Grant required Permission Scoped  
 content required required read-only

Create a case Permission Scoped Scoped No unless No by default No  
 manually required granted

Assign/reassign Yes if Scoped No by default No No No  
 officers authorized

Add shared note Scoped Scoped Scoped Grant required No by default No

Add Only in Own bureau scope Own bureau scope No unless No by default Read only if  
 bureau-private authorized explicitly authorized  
 note scope granted

Change case Explicit Scoped Scoped Only if No by default No  
 status permission granted

Dispose/reopen Explicit Policy-defined Policy-defined No by default Policy-defined No  
 case permission only if  
 authorized

Request Yes Yes Yes Yes Yes Yes  
 restricted access

Approve access Only if Only if Only if No Only if No  
 request designated designated designated designated

Configure SLA Yes with No by default No No No by default Read only  
 policies authorization

View audit Scoped/system Scoped Scoped Scoped Scoped Scoped  
 history

Export data Explicit Scoped Scoped Scoped Explicit Explicit  
 permission permission permission

---

This matrix is a baseline and must be converted into explicit  
permissions and RLS policy tests. "Super Admin" is not a blanket bypass  
for restricted content.

# **8\. Information architecture and screen inventory**

Every screen must have loading, empty, error and permission-denied  
states. All lists must support pagination or bounded retrieval. Buttons  
must be wired to real actions; no decorative controls may imply  
unsupported behavior.

## **8.1 Global shell**

* Organization/system name and environment indicator.  
* Current user and role.  
* Active bureau context, where relevant.  
* Navigation filtered by permission.  
* Notification centre.  
* Search entry point.  
* Sign-out.  
* Visible demo-data indicator in demonstrator environments.  
* Consistent date/time and timezone display.

## **8.2 Super Admin workspace**

Required sections: 1\. Overview dashboard. 2\. Institution verification  
queue. 3\. Duplicate review queue. 4\. Cross-bureau overlap overview. 5\.  
All-case minimal index and authorized full-detail access. 6\. Bureau and  
officer administration. 7\. Category and routing configuration. 8\. SLA  
policy configuration. 9\. Escalation and notification configuration. 10\.  
Access-request oversight. 11\. Audit log. 12\. Intake/integration  
exceptions and health (integration phase). 13\. Reports and exports,  
subject to permission.

### **Admin dashboard widgets**

* Total submissions.  
* Canonical cases.  
* Cases by status.  
* Cases by bureau.  
* Cases by region.  
* Cases approaching deadlines.  
* Overdue cases.  
* Institution verification backlog.  
* Duplicate review backlog, with score bands.  
* Cross-bureau cases/overlap alerts.  
* Pending access requests.  
* Recent transfers and escalations.  
* Intake processing exceptions.

Every widget must define its time range, status scope, permission scope  
and click-through destination. A metric card must open the corresponding  
filtered list.

## **8.3 Bureau workspace**

Required sections: \- Bureau overview. \- Kanban board. \- Table/list  
view. \- My assigned work. \- Team workload. \- Due soon/overdue. \-  
Awaiting information. \- Transfers. \- Cross-bureau alerts/minimal  
index. \- Access requests received or initiated. \- Reports. \-  
Bureau-private notes visible only to authorized bureau members.

The active bureau context must be visible. If a user has multiple bureau  
memberships, switching bureau context must not combine permissions  
accidentally.

## **8.4 Institution profile**

Header: \- Official institution name. \- AICTE Permanent ID. \- Region. \-  
Verification status. \- Other approved master-data attributes. \-  
Institution aliases where authorized.

Sections: \- Case summary counts. \- Canonical case list. \-  
Submissions/source references. \- Bureau participation and responsible  
officers where visible. \- Status, category, priority and dates. \-  
Deadline and ageing indicators. \- Related/duplicate/overlap links. \-  
Action history where permitted. \- Access-request action for restricted  
cases.

Restricted cases may appear as minimal index entries. The UI must not  
infer that a user can open full details simply because a case appears on  
the institution page.

## **8.5 Case detail page**

Recommended tabs or sections: 1\. Overview. 2\. Bureau assignments and  
officer ownership. 3\. Timeline/action history. 4\. Submissions and source  
references. 5\. Notes, with shared/private visibility clearly marked. 6\.  
Attachments/evidence. 7\. Deadlines and escalation history. 8\. Related  
cases and duplicate decisions. 9\. Access and sharing (only for  
authorized users). 10\. Audit details (only for authorized users).

Overview fields: \- Case ID. \- Title and summary. \- Institution and  
Permanent ID. \- Primary category and priority. \- Common status. \-  
Participating bureaus. \- Responsible officer per assignment. \-  
Created/opened date, last action and next action. \- Applicable deadlines  
and ageing. \- Related-case indicators. \- Access restrictions.

## **8.6 Intake screens**

The demo AICTE and CPGRAMS portals must be visually distinguishable as  
simulated environments. Each captures: \- Institution identifier if  
known. \- Institution name if supplied. \- Complaint subject/title. \-  
Complaint description. \- Language selection or detected language. \-  
Category if known/selected. \- Submission date/reference appropriate to  
the demo. \- Attachments if enabled. \- Required consent/notice text  
approved for the demonstrator. \- Submit confirmation with a source  
submission reference.

The demo must not imply that a real complaint has been submitted to  
AICTE or CPGRAMS. Display a clear demo confirmation.

## **8.7 Queue/list screen behavior**

Every queue/list should include: \- Search within the queue. \- Relevant  
filters. \- Sort order. \- Pagination. \- Row-level action menu filtered by  
permission. \- Status and age. \- Assignment/owner. \- Empty state  
explaining why there are no results. \- Error state with retry where  
safe. \- Bulk actions only if explicitly designed, authorized and  
audited.

## **8.8 Responsive and accessible behavior**

* Desktop-first administrative workspace, usable on tablet and mobile  
  for critical review actions.  
* Keyboard-operable controls.  
* Clear focus states.  
* Status must not be communicated only by colour.  
* Text labels for icons.  
* Readable contrast and sensible tab order.  
* Hindi text must render correctly with Unicode support.  
* Avoid truncating a complaint in a way that hides a critical warning;  
  provide a secure detail view.

# **9\. Canonical domain rules**

## **9.1 Institution**

* A verified AICTE Permanent ID is the preferred canonical identifier.  
* Institution name matching alone is not authoritative.  
* Multiple aliases can point to one institution.  
* Alias additions/corrections require provenance and appropriate  
  authorization.  
* An uncertain identity remains unresolved; do not create a canonical  
  institution from an unverified spelling solely to pass validation.  
* Institution region is the official institution classification, not  
  the region of the handling officer.  
* Corrections to institution association are audited.

## **9.2 Submission**

A submission represents one intake event. It preserves: \- Source  
channel. \- Source/external reference. \- Receipt timestamp. \- Original  
text and language. \- Normalized text and normalization version where  
available. \- Supplied institution data. \- Attachments/source metadata. \-  
Intake processing state. \- Final case association, if any.

Each submission is retained even if it is linked to an existing case. A  
source-system retry of the exact same event must not create duplicate  
processing artifacts, but genuine repeated submissions must still be  
represented separately.

## **9.3 Canonical case**

A case represents one underlying issue, not one bureau or one email. It  
must have: \- Unique immutable internal Case ID. \- Verified  
institution. \- Primary category. \- Common status. \- Priority. \-  
Title/summary. \- Opened/closed timestamps as applicable. \- One or more  
bureau assignments. \- Action history and applicable deadlines.

Case number format is configurable and must be finalized before  
production. External source references never replace the internal Case  
ID.

## **9.4 Multi-category and multi-bureau distinction**

A complaint may span more than one domain. The initial model may use one  
primary category and multiple bureau assignments. If the product  
requires multiple formal categories on one case, use a normalized  
case-category junction. Do not use a comma-separated category field. A  
category does not automatically determine bureau ownership unless a  
verified routing rule says so.

## **9.5 State dimensions**

Maintain separate state machines: \- Submission intake state. \-  
Institution verification state. \- Duplicate candidate review state. \-  
Canonical case status. \- Bureau assignment state. \- Transfer state. \-  
Access request/grant state. \- Deadline state. \- Escalation state. \-  
Attachment scan state. \- Notification delivery/read state.

Do not add values to the case status merely to represent an unrelated  
process.

# **10\. Intake and submission requirements**

## **FR-INT-001 \--- Create submission**

The system shall create a durable submission record for each accepted  
intake event and record source, received time, original language and  
original content.

## **FR-INT-002 \--- Preserve original content**

Original text must never be overwritten by normalized or translated  
text. Normalized text is an additional derived field with version  
metadata.

## **FR-INT-003 \--- Source identity**

External references must be scoped by source channel/system. If a source  
does not provide a stable reference, the intake adapter must generate a  
durable idempotency key without pretending it is an official source ID.

## **FR-INT-004 \--- Duplicate source-event retry**

Repeated processing of the same source event must be idempotent. A retry  
should update/retry processing state, not create another submission or  
case. A separate genuine submission remains a separate submission even  
if its text is identical.

## **FR-INT-005 \--- Intake validation**

Validate required fields, allowed text lengths, language support, file  
constraints and safe input handling. Validation failures must return  
actionable errors and must not create a partially valid canonical case.

## **FR-INT-006 \--- Intake status**

Track states such as `received`, `awaiting_institution_verification`,  
`awaiting_duplicate_review`, `ready_for_case_creation`,  
`associated_with_existing_case`, `new_case_created`, `rejected_invalid`  
and `processing_error`. Final values must be governed by a documented  
state machine.

## **FR-INT-007 \--- Intake confirmation**

For demo portals, display a generated submission reference and clearly  
state that the submission is part of a demonstration, not a real  
external government filing.

## **FR-INT-008 \--- Attachments**

If attachments are enabled, validate file type/size, store in private  
storage, scan where available, preserve metadata and enforce access  
through parent submission/case permissions.

## **FR-INT-009 \--- Source history**

Users with appropriate permissions can see the list of submissions  
associated with a case, their channels, timestamps and external  
references. Original content is protected by content-access policy.

## **FR-INT-010 \--- Exception handling**

A failed parse, unsupported format, missing required data or integration  
error must create a visible processing exception and a retry/review path  
where safe.

# **11\. Institution verification workflow**

## **FR-INS-001 \--- Candidate resolution**

The system shall attempt resolution using verified Permanent ID,  
official name and verified aliases. Exact Permanent ID match is stronger  
than name similarity.

## **FR-INS-002 \--- Verification queue**

If the institution cannot be confidently resolved, the submission must  
remain on hold and appear in the Super Admin/designated verifier queue.

## **FR-INS-003 \--- Candidate display**

Show candidate institution names, Permanent IDs, region and match  
evidence/score. Do not show unrelated restricted complaint content.

## **FR-INS-004 \--- Reviewer actions**

Permitted decisions: \- Confirm candidate institution. \- Reject all  
candidates and request more information. \- Mark the institution  
unidentifiable under current evidence. \- Correct a previously incorrect  
association through an audited correction path. \- Add a verified alias  
when authorized.

## **FR-INS-005 \--- Assignment and ageing**

Verification tasks must support  
unassigned/assigned/in-progress/resolved/rejected states, assignee,  
created time, last action and age.

## **FR-INS-006 \--- Verification completion**

Once institution identity is verified, the submission may proceed to  
duplicate matching. Verification must not silently create a canonical  
case without completing duplicate evaluation.

## **FR-INS-007 \--- Multiple submissions**

Multiple submissions about the same institution may be verified  
independently. Verification of the institution on one submission must  
not automatically prove that every similarly named submission refers to  
it.

## **FR-INS-008 \--- Audit**

Record candidate evidence, reviewer, decision, time and reason. A  
correction must preserve the prior association in audit history.

# **12\. Duplicate candidate and related-case workflow**

## **FR-DUP-001 \--- Candidate window**

Initial search window is the preceding 60 days for the verified  
institution. The window is configurable. The exact  
interpretation---rolling 60 days or two calendar months---must be a  
system setting; the initial demonstrator should use rolling 60 days  
unless explicitly changed.

## **FR-DUP-002 \--- Candidate evidence**

The matching layer may consider: \- Institution identity. \- Normalized  
complaint text. \- Hindi/English cross-language semantic similarity where  
supported. \- Category and issue keywords. \- Dates and known external  
references. \- Relevant metadata that is authorized for matching.

Same institution alone is not enough to declare a duplicate.

## **FR-DUP-003 \--- Score meaning**

A confidence score is a model output and must not be presented as a  
calibrated probability unless calibration has been tested and  
documented. Display the matching method/model version where relevant.

## **FR-DUP-004 \--- High-confidence band**

Scores `>= 0.90` are high-confidence candidates and appear in the  
priority duplicate review queue. The system must not automatically merge  
cases, discard submissions or change ownership on the score alone.

## **FR-DUP-005 \--- Potential band**

Scores below 0.90 but above a configurable candidate threshold may  
appear in the potential duplicate queue. The threshold must be  
configurable and evaluated against representative data. Candidate  
records should show the score and available explanation.

## **FR-DUP-006 \--- No candidate**

If no relevant candidate is found, the submission can proceed to  
new-case creation after institution verification and other validation.

## **FR-DUP-007 \--- Candidate list**

One submission may have several candidate cases. The review UI must show  
each candidate, case ID, institution, title or sanitized title, bureau,  
status, dates, score and allowed explanation. Restricted details remain  
hidden.

## **FR-DUP-008 \--- Human decision**

Reviewer decisions: 1\. Same underlying issue \--- associate submission  
with the selected canonical case. 2\. Related but distinct \--- preserve  
separate case identity and create a case relationship if a separate case  
exists. 3\. Unrelated \--- permit new-case creation. 4\. Insufficient  
evidence \--- keep pending/request more information. 5\. Incorrect  
institution/candidate \--- return to institution verification or reject  
candidate.

## **FR-DUP-009 \--- Multiple candidate conflict**

If one submission appears to duplicate multiple existing cases, the  
reviewer must choose the canonical issue or mark relationships as  
appropriate. The system must not associate one submission with multiple  
canonical cases.

## **FR-DUP-010 \--- Review concurrency**

If two reviewers act concurrently, the system must detect stale  
decisions and require refresh/reconciliation. It must not apply  
conflicting decisions silently.

## **FR-DUP-011 \--- Rejected candidate suppression**

Once a reviewer marks a candidate unrelated, avoid repeatedly raising  
the same candidate on unchanged evidence. A materially changed  
submission, new model version or changed candidate context may permit  
re-evaluation, with audit history retained.

## **FR-DUP-012 \--- Canonical case creation**

Creation of a new case and association of the first submission must be  
transaction-safe. A race between similar incoming submissions must not  
create duplicate cases after a reviewer has confirmed they concern the  
same issue.

## **FR-DUP-013 \--- Audit**

Record candidate score, method/version, reviewer decision, rationale,  
timestamp and the resulting submission-to-case association.

## **FR-DUP-014 \--- Dashboard locations**

High-confidence and potential duplicate candidates appear in: \- Super  
Admin duplicate-review queue. \- Institution profile related/overlap  
section when visibility allows. \- Bureau cross-bureau alert panel as a  
minimal index signal. These are different views over the same underlying  
records, not separate duplicate records.

# **13\. Canonical case creation and lifecycle**

## **FR-CASE-001 \--- Creation prerequisites**

A case may be created only after institution identity is resolved, the  
submission is validated and duplicate review has concluded that it is a  
new issue. Any explicitly authorized exception must be logged.

## **FR-CASE-002 \--- Unique case number**

Every case receives a unique internal Case ID. It is immutable and  
distinct from all source references.

## **FR-CASE-003 \--- Initial values**

Creation must set institution, title/summary, primary category, initial  
status, priority, opened timestamp, creator/source provenance and  
initial action-history event.

## **FR-CASE-004 \--- Case summary**

Summary may be normalized or AI-assisted, but the original submission  
remains authoritative evidence. A generated summary must be marked as  
generated and must not change source text.

## **FR-CASE-005 \--- Current status**

The current status is a queryable projection of the valid status  
history. Status and action-history updates must occur atomically.

## **FR-CASE-006 \--- Next action**

Every active case should expose next required action, responsible  
assignment/officer and target date when applicable. If no next action is  
currently set, the UI should flag it for review rather than invent one.

## **FR-CASE-007 \--- Reopen**

A disposed case may be reopened only by an authorized role and with a  
reason. Reopening records a new history event, updates active status and  
recalculates/reinstates deadlines only according to policy.

## **FR-CASE-008 \--- Reject/invalid**

Rejected/invalid is a defined terminal or review outcome according to  
the approved transition matrix. It must require a reason and must not  
erase the submission.

## **FR-CASE-009 \--- Related cases**

Case relationship links must have a type, reason, creator and  
creation/confirmation time. Prevent self-links and duplicate reciprocal  
links.

## **FR-CASE-010 \--- No silent deletion**

Ordinary users cannot delete canonical cases or their histories.  
Corrections, cancellation or archival use audited workflows and  
retention rules.

# **14\. Bureau routing, assignments and officer workload**

## **FR-ORG-001 \--- Bureau registry**

The system supports RB, PGRC and other validated bureaus as reference  
data. Do not invent the complete official list; populate it from an  
approved source.

## **FR-ORG-002 \--- Routing rules**

Routing should be configurable by verified complaint category, issue  
domain and other approved criteria. The initial demo may use seeded  
routing outcomes. If no routing rule exists or rules conflict, route to  
a visible exception queue for authorized assignment.

## **FR-ORG-003 \--- Multi-domain case**

One canonical case may have multiple active bureau assignments. The  
system must not create a separate canonical case solely because another  
bureau is involved.

## **FR-ORG-004 \--- Primary and participating bureau**

Where required for coordination, one assignment can be marked primary  
and others collaborating. The policy for selecting/changing the primary  
bureau must be explicit. Multiple participating bureaus remain visible.

## **FR-ORG-005 \--- Officer membership**

Each bureau supports multiple officers. Users may belong to more than  
one bureau only where authorized. Active membership and role are checked  
before assignment.

## **FR-ORG-006 \--- Officer assignment**

Each bureau assignment supports a responsible officer and additional  
participants. The system must identify who owns the next action;  
participation alone does not imply responsibility.

## **FR-ORG-007 \--- Reassignment**

Record old and new assignee, actor, reason, timestamp and effective  
time. Reassignment must not rewrite historical actions.

## **FR-ORG-008 \--- Workload**

Bureau and officer workload must use documented definitions (for  
example, active assigned cases versus total historical assignments). Do  
not count ended assignments as active workload.

## **FR-ORG-009 \--- Transfer**

Transfers must record source assignment, destination assignment,  
requester, approver where required, reason, state and completion time. A  
transfer cannot erase the source bureau's history. Transfer must not  
grant full content access to the destination before the approved point  
in the transfer workflow.

## **FR-ORG-010 \--- Routing failure**

If no valid bureau can be assigned, keep the case in a visible  
routing-exception queue. Do not silently assign it to a random bureau.

# **15\. Common case workflow and Kanban behavior**

## **15.1 Initial common statuses**

Suggested baseline: \- `received` \- `under_review` \- `under_process` \-  
`awaiting_information` \- `escalated` \- `disposed` \- `rejected` \-  
`reopened`

The final list and transition matrix must be approved before the  
workflow is implemented. `transferred` should be represented as  
transfer/assignment history unless the product owner explicitly requires  
it as a common status. Institution verification, duplicate review,  
access approval and deadline state are separate state machines.

## **15.2 Transition matrix baseline**

---

From To Conditions Required audit  
 details

---

Received Under Review Case created and Actor, time,  
 assigned/accepted assignment

Under Review Under Process Review completed Actor, time,  
 action/remarks

Under Review Awaiting Authorized request for Requested  
 Information information information,  
 recipient, due  
 date if  
 applicable

Under Process Awaiting Information needed to Reason,  
 Information proceed recipient, next  
 action

Awaiting Under Process Information received or Trigger,  
 Information waiting period ends per actor/system,  
 policy time

Under Process Escalated Authorized escalation Rule/reason,  
 or rule trigger level, recipient

Escalated Under Process Escalation Resolution and  
 acknowledged/resolved actor  
 and work resumes

Under Process Disposed Authorized disposition Outcome,  
 completed rationale,  
 actor, date

Disposed Reopened Authorized reopening Reopen reason,  
 with reason actor, time

Any permitted Rejected Valid rejection ground Reason,  
 non-terminal and authority authority, time  
 state

Reopened Under Re-entry into active Actor, reason,  
 Review/Under handling next action  
 Process

---

This table is a starting proposal, not an official AICTE transition  
policy. The approved matrix must define permitted transitions, required  
fields, permissions, deadline effects and notification events. Invalid  
transitions must be rejected server-side.

## **15.3 Kanban requirements**

* Show only cases in the active bureau's authorized scope.  
* Use common statuses across bureaus.  
* Allow movement only where the transition is valid and the user is  
  authorized.  
* Drag-and-drop must call the same validated transition operation as a  
  status menu.  
* Require a reason/remarks when the transition matrix says so.  
* Display Case ID, title/sanitized title, institution, category,  
  priority, responsible officer, next action and deadline indicator  
  subject to permission.  
* Display overlap, access and restricted-content indicators without  
  leaking details.  
* Support filters, sort, search, pagination/virtualization and  
  refresh.  
* Provide a list/table alternative.  
* Avoid optimistic UI updates that leave the interface inconsistent  
  after a failed transition.  
* Display clear success/failure feedback only after the server  
  confirms the change.  
* Column counts must match the filtered authorized record set.

## **15.4 Case action history**

Record: \- Status changes. \- Assignment/reassignment. \- Bureau assignment  
and removal. \- Transfer request/approval/completion. \- Notes  
created/edited/visibility changes. \- Attachment  
additions/removals/quarantine events. \- Deadline overrides and state  
changes. \- Escalation trigger/resolution. \- Duplicate decisions and case  
links. \- Access request/grant/revocation. \- Disposition and reopening. \-  
Administrative corrections.

History entries should include actor, server timestamp, action type,  
bureau scope, relevant before/after values, reason and correlation/event  
ID when available.

# **16\. Cross-bureau index, access requests and collaboration**

## **FR-ACC-001 \--- Minimal index**

Authorized officials may see a minimal index entry for relevant cases  
outside their bureau. The baseline fields are: \- Case ID. \- Institution  
identity. \- Bureau(s) handling the case. \- Common status. \-  
Receipt/opened date and last action date. \- Sanitized title or a generic  
restricted label where needed. \- Overlap indicator. \- Whether access may  
be requested.

Title itself can be sensitive. The final security policy may require a  
generic title for restricted categories.

## **FR-ACC-002 \--- No implicit content access**

Seeing an index record does not authorize reading the complaint body,  
full summary, attachments, private notes, submitter information or  
sensitive action remarks.

## **FR-ACC-003 \--- Access request**

A request includes requesting user, requesting bureau, case, reason,  
requested scope, timestamp and request status.

## **FR-ACC-004 \--- Approval authority**

The case owner or designated authorized officer approves or denies  
access, consistent with the approved policy. Super Admin can approve  
only when explicitly designated. All decisions are audited.

## **FR-ACC-005 \--- Scoped grants**

A grant identifies exactly one grantee target type (user or bureau),  
scope, grantor, creation time and optional expiry. A grant can be  
revoked. Define whether grants apply to content, attachments, shared  
notes, actions or export separately.

## **FR-ACC-006 \--- Expiry and revocation**

Expired or revoked grants must stop subsequent access. Existing browser  
caches and signed URLs must not be relied on to preserve access. Use  
short-lived signed URLs and re-authorize protected requests.

## **FR-ACC-007 \--- Shared notes**

Shared notes are visible to authorized participants on the case. The UI  
must state the visibility before the note is saved.

## **FR-ACC-008 \--- Bureau-private notes**

A private note has a bureau scope and is visible only to authorized  
users of that bureau and any explicitly authorized reviewer under  
policy. Assignment to the shared case does not expose private notes to  
every other bureau.

## **FR-ACC-009 \--- Visibility changes**

Changing a note from private to shared or shared to private requires  
authorization and an audit event. Do not silently alter who can see  
historical content.

## **FR-ACC-010 \--- Overlap alerts**

When a case is assigned to a bureau, detect other relevant cases for the  
same institution and show an overlap alert. Alert text must  
distinguish: \- Same institution, other active case. \- Potentially  
related case. \- Reviewer-confirmed duplicate/related case. \- Confirmed  
distinct cases.

Do not call two cases duplicates solely because they concern the same  
institution.

## **FR-ACC-011 \--- Alert recipients**

Notify authorized officers and bureau administrators relevant to the  
case according to configured rules. Avoid sending restricted content to  
a recipient who can only view the index.

## **FR-ACC-012 \--- Shared case action**

When several bureaus work on one case, each bureau's actions remain  
attributed to the acting officer and bureau. The shared case status is  
common; assignment responsibility remains bureau-specific.

# **17\. Deadlines, SLA policies and escalation engine**

## **17.1 Policy data requirements**

An SLA policy should define: \- Policy code and version. \- Applicable  
category and any approved bureau/priority condition. \- Milestone type:  
acknowledgement, first action, response or disposal, as required by  
policy. \- Duration and duration unit. \- Calendar basis: calendar days,  
working days or an approved explicit calendar. \- Effective start/end  
dates. \- Source document/section and verification state. \- Pause/stop  
conditions if authorized. \- Escalation thresholds and recipient scope. \-  
Whether the rule is official or illustrative.

The exact schema may evolve, but policy provenance and version must not  
be omitted.

## **FR-SLA-001 \--- Category policy selection**

Select the policy effective for the relevant case category and  
applicable date. If no verified official rule exists, use only an  
explicitly labelled demo rule or flag the case for policy configuration.  
Do not invent official deadlines.

## **FR-SLA-002 \--- Deadline instantiation**

When a case is created or a policy applies, create the appropriate case  
deadline record and preserve the applied policy version and calculation  
basis.

## **FR-SLA-003 \--- Working days**

If a policy uses working days, calculate using the configured approved  
holiday/weekend calendar. Do not assume all timelines use working days  
or all use calendar days.

## **FR-SLA-004 \--- Deadline display**

Show due date, remaining time/age, overdue state and milestone type. The  
user must be able to identify which policy governs the deadline.

## **FR-SLA-005 \--- Approaching deadline**

Configure reminder thresholds by policy. Thresholds are not hard-coded  
into frontend components.

## **FR-SLA-006 \--- Overdue**

Mark a deadline overdue when its due time has passed and the milestone  
remains incomplete, after approved pauses/adjustments.

## **FR-SLA-007 \--- Pause/resume**

Only pause a deadline when an approved policy allows it. Record reason,  
actor/system, start and resume times. Do not let a case officer pause an  
SLA merely by moving the case to Awaiting Information unless policy  
explicitly permits it.

## **FR-SLA-008 \--- Override**

Manual due-date override requires permission, a reason, previous value,  
new value, actor and timestamp. Preserve the original policy and  
deadline history.

## **FR-SLA-009 \--- Policy version changes**

Changing a policy must not silently rewrite every existing deadline.  
Define whether changes apply only to new cases or trigger an authorized  
recalculation of active cases. Preserve old and new values.

## **FR-SLA-010 \--- Escalation rules**

Rules can trigger based on approaching/overdue milestones, elapsed time,  
priority or approved conditions. Each rule has effective dates,  
recipient scope and deduplication policy.

## **FR-SLA-011 \--- Escalation event**

An actual escalation records rule, case, level, trigger time, reason,  
recipient, resolution state and resolver. Rule configuration is not  
itself an escalation event.

## **FR-SLA-012 \--- Repeat escalation**

Avoid generating the same escalation repeatedly for the same rule and  
time window. A later level or new overdue milestone may legitimately  
create another event.

## **FR-SLA-013 \--- Category/SLA governance**

The full official AICTE bureau/category/SLA matrix must be validated  
against authorized documents before production. Public portal guidance  
must not be generalized into every AICTE category. Seed values are  
marked illustrative.

# **18\. Notifications and reminders**

## **18.1 Event catalogue**

In-app notifications should support: \- New case assignment. \- Officer  
assignment/reassignment. \- Bureau assignment or collaboration. \-  
Institution verification required/assigned/resolved. \- High-confidence  
duplicate candidate. \- Potential duplicate candidate. \- Duplicate review  
decision. \- Cross-bureau overlap. \- Access request received. \- Access  
request approved/denied/revoked/expired. \- Deadline approaching. \-  
Deadline overdue. \- Escalation triggered/resolved. \- Transfer  
requested/approved/denied/completed. \- Information requested/received. \-  
Case disposed/reopened. \- Integration or intake exception requiring  
admin action.

## **FR-NOT-001 \--- Recipient scope**

Resolve recipients from current assignments, active memberships and  
configured notification rules. Do not notify every user in the system by  
default.

## **FR-NOT-002 \--- Content minimization**

A notification must not include restricted complaint text, private notes  
or attachments when the recipient lacks content access. A generic notice  
with a secure link is preferred.

## **FR-NOT-003 \--- Deduplication**

Use a stable deduplication key for repeated trigger processing.  
Reprocessing an event must not create uncontrolled duplicate  
notifications.

## **FR-NOT-004 \--- Read state**

Track created, read and delivery status separately. Reading a  
notification does not resolve the underlying task.

## **FR-NOT-005 \--- Delivery failure**

Failed external delivery must be visible to authorized operators and  
retryable. In-app notification creation should not fail the underlying  
case action unless the business rule explicitly requires atomic  
notification creation.

## **FR-NOT-006 \--- Preferences**

If notification preferences are introduced, they may suppress  
non-critical delivery channels but must not disable mandatory  
deadline/escalation obligations without policy approval.

# **19\. Search, filters and sorting**

## **FR-SEARCH-001 \--- Search fields**

Search by: \- AICTE Permanent ID. \- Official institution name and  
verified aliases. \- Case ID. \- External submission/source reference. \-  
Category. \- Bureau. \- Assigned officer, subject to permission. \-  
Region. \- Status. \- Intake channel. \- Receipt/opened/last-action date. \-  
Priority. \- Deadline state. \- Related/overlap indicator. \- Institution  
verification state. \- Duplicate-review state.

## **FR-SEARCH-002 \--- Search scope**

Apply row-level authorization before results are returned. A search  
query must not reveal a restricted case through its result count,  
snippet, title, autocomplete or error message.

## **FR-SEARCH-003 \--- Date ranges**

Use explicit date boundaries and a documented timezone. Date filters  
must be consistent across cards, tables and exports.

## **FR-SEARCH-004 \--- Filters**

Filters must combine predictably using AND semantics across filter  
groups unless a control clearly specifies alternatives. The active  
filters must be visible and removable.

## **FR-SEARCH-005 \--- Sorting and pagination**

Provide stable sorting with a deterministic tie-breaker. Preserve  
filters while navigating pages. Avoid unbounded list queries.

## **FR-SEARCH-006 \--- Cross-language search**

Where normalization is implemented, allow Hindi and English complaints  
to be searched using normalized text while retaining original text.  
Search must not imply that an automatic translation is the  
legal/original record.

# **20\. Dashboards, analytics and reports**

## **20.1 Super Admin dashboard**

Required metrics: \- Submission count. \- Canonical case count. \- Cases by  
common status. \- Cases by bureau and category. \- Cases by region. \-  
Cases approaching deadlines. \- Overdue cases. \- Institution verification  
backlog and ageing. \- Duplicate candidate backlog by confidence band. \-  
Cross-bureau active cases and overlap alerts. \- Pending access  
requests. \- Recent transfers and escalations. \- Intake/routing  
exceptions. \- Integration health in later phases.

Every card must have a documented metric formula, data scope, date basis  
and click-through filter.

## **20.2 Bureau dashboard**

* Active cases assigned to the bureau.  
* Kanban distribution.  
* My active assignments and next actions.  
* Team workload by officer.  
* Due soon and overdue milestones.  
* Cases awaiting information.  
* Pending transfers.  
* Cross-bureau overlap alerts.  
* Access requests.  
* Recent case actions.  
* Bureau-level reports.

## **20.3 Institution dashboard/profile**

* Canonical institution identity.  
* Total submissions and total canonical cases as separate metrics.  
* Cases by status, category and bureau.  
* Active cases, disposed cases and overdue deadlines.  
* Source submission history.  
* Related/duplicate case links.  
* Recent action timeline, subject to permission.  
* Access-request entry points for restricted records.

## **20.4 Standard reports**

1. Bureau-wise case volume and active workload.  
2. Region-wise case distribution.  
3. Institution-wise complaint/case history.  
4. Category-wise case distribution.  
5. Status-wise case distribution.  
6. Pending-case ageing.  
7. Overdue and approaching deadline report.  
8. Disposal rate by period.  
9. Cross-bureau and overlap report.  
10. Duplicate candidate review outcomes.  
11. Transfer and escalation history.  
12. Officer workload.  
13. Access request/grant audit.  
14. Intake channel volume and exception rate.  
15. Monthly/quarterly trend report.

## **20.5 Metric definitions**

* **Submission count:** count of submission events, including repeated  
  submissions.  
* **Canonical case count:** count of unique canonical cases.  
* **Active case:** case whose current status is in the approved active  
  status set.  
* **Pending case:** defined status set excluding terminal statuses;  
  exact formula must be documented.  
* **Disposed case:** case in disposed status at the relevant  
  snapshot/date. Reopened cases must be treated according to a  
  documented reporting rule.  
* **Overdue case:** case with at least one applicable incomplete  
  deadline past due, after permitted adjustments.  
* **Disposal rate:** disposed cases in the selected period divided by  
  the approved denominator. Decide whether the denominator is cases  
  received during the period or all cases active at period start;  
  never mix these definitions.  
* **Duplicate candidate rate:** submissions with at least one  
  candidate divided by eligible submissions.  
* **Confirmed duplicate rate:** reviewer-confirmed duplicate  
  associations divided by eligible submissions, distinct from  
  candidate rate.  
* **Bureau workload:** active bureau assignments, not simply the count  
  of all cases ever touched by that bureau.  
* **Officer workload:** active officer assignments under the approved  
  responsibility rule.

## **20.6 Export**

Exports require explicit permission, should record actor, scope and  
time, and must apply the same access rules as the on-screen report.  
Sensitive fields must be omitted unless specifically authorized. Export  
links/files must expire or be access-controlled according to security  
policy.

# **21\. Attachments and evidence**

## **FR-DOC-001 \--- Private storage**

Evidence files must be stored in private storage buckets, never public  
by default.

## **FR-DOC-002 \--- Parent association**

Each attachment must have a validated association to a submission or  
case. If the file belongs to both, both associations must be explicitly  
validated. Do not use an unchecked polymorphic `(type, id)` field.

## **FR-DOC-003 \--- Metadata**

Record filename, MIME type, size, checksum, upload actor/time,  
classification and scan state.

## **FR-DOC-004 \--- Validation**

Validate extension, MIME type, size and allowed file policy. Do not  
trust client-provided MIME type alone.

## **FR-DOC-005 \--- Malware scanning**

If scanning is unavailable in the demo, clearly mark the limitation and  
do not represent unscanned uploads as production-safe. Production  
release requires a defined scanning/quarantine process.

## **FR-DOC-006 \--- Access**

File retrieval requires permission to the associated parent content. Use  
short-lived signed URLs or an authorized download endpoint. Re-check  
authorization at download time.

## **FR-DOC-007 \--- Retention**

Deletion, archival and retention must follow approved policy. Deleting a  
case or user must not cascade-delete audit evidence unintentionally.

# **22\. Audit and accountability**

## **FR-AUD-001 \--- Required events**

Audit at least: \- Submission intake and processing decisions. \-  
Institution resolution/correction. \- Duplicate candidate creation and  
review decision. \- Case creation, status change, disposition and  
reopening. \- Bureau and officer assignments. \- Transfer lifecycle. \-  
Notes creation/edit/visibility changes. \- Attachment upload, scan,  
access and retention events as applicable. \- SLA policy change and  
deadline override. \- Escalation creation/resolution. \- Access  
request/grant/approval/denial/revocation/expiry. \- User, role,  
permission and membership changes. \- Export and sensitive administrative  
actions. \- Integration retries and manual reprocessing.

## **FR-AUD-002 \--- Attribution**

Each event must include actor or system identity, server timestamp,  
event type, relevant entity, and before/after details where appropriate.

## **FR-AUD-003 \--- Append-oriented history**

Ordinary users cannot rewrite or delete audit events. Corrections must  
create a new event that references the corrected event.

## **FR-AUD-004 \--- Sensitive access**

Audit restricted access decisions and sensitive administrative reads  
where required by policy. Do not store secrets, authentication tokens or  
unnecessary full complaint content in logs.

## **FR-AUD-005 \--- Audit visibility**

Users can view only the audit records permitted for their scope. A  
bureau must not learn restricted content merely by reading an audit  
event.

# **23\. Security and privacy requirements**

## **SEC-001 \--- Authentication**

Use Supabase Auth. Application user records link to the Auth user ID. Do  
not create custom password storage or a parallel authentication system.

## **SEC-002 \--- Row Level Security**

Enable RLS on all exposed tables. Test both allowed and denied paths.  
Views and RPC functions must be reviewed for security-definer behavior  
and authorization bypass.

## **SEC-003 \--- Least privilege**

Grant only the operations required by each role, bureau membership and  
case grant.

## **SEC-004 \--- Restricted index**

Implement the minimal cross-bureau index as a secured query/view or  
equivalent policy. Do not grant broad `SELECT` merely to support the  
institution page.

## **SEC-005 \--- Private notes**

Enforce bureau-private note access in the database/API. Hiding notes in  
the UI is insufficient.

## **SEC-006 \--- Storage**

Private complaint files must not be publicly retrievable. Guessing an  
object path must not bypass authorization.

## **SEC-007 \--- Secrets**

Never expose Supabase service-role keys, email credentials, integration  
secrets or API tokens to browser code. Store them in an approved secrets  
manager/environment.

## **SEC-008 \--- Input safety**

Use parameterized database operations, output encoding and safe  
rendering. Treat complaint text, filenames, email bodies and external  
data as untrusted input.

## **SEC-009 \--- Audit**

Role grants, access grants, restricted exports and sensitive workflow  
actions must be logged.

## **SEC-010 \--- Privacy and retention**

Before production, define personal data categories, purpose, access,  
retention, deletion/archival, backup and incident-response obligations.  
Do not assume a demonstrator's retention policy is production-ready.

## **SEC-011 \--- Administrative access**

Super Admin permissions must be explicit and testable. Administrative  
configuration access does not automatically grant unrestricted access to  
all complaint bodies and private notes.

## **SEC-012 \--- Notification privacy**

Notification titles, previews and email subjects must not reveal  
restricted complaint content to users with index-only access.

# **24\. Integration and automation architecture**

## **24.1 Current demo**

The initial build uses seeded data and simulated intake pages. It must  
not claim a real CPGRAMS or email submission occurred.

## **24.2 Future n8n role**

n8n may orchestrate: \- Polling or receiving authorized intake events. \-  
Parsing emails/approved source payloads. \- Normalization and  
institution-resolution calls. \- Duplicate-candidate processing. \-  
Notifications and scheduled deadline checks. \- Retry and exception  
workflows.

n8n must not become a second canonical database. Every workflow should  
call approved backend operations and write traceable processing  
outcomes.

## **24.3 Integration contract**

Each adapter must define: \- Source/channel identity. \- Source event  
ID/idempotency key. \- Receipt time and source time, when available. \-  
Original payload preservation rules. \- Parsing/normalization version. \-  
Retry policy and maximum attempts. \- Error categories and  
dead-letter/exception behavior. \- Correlation ID across processing  
steps. \- Authorization and secrets handling. \- Audit events. \-  
Reconciliation procedure.

## **FR-INTG-001 \--- Idempotency**

The same source event may be retried without creating unintended  
duplicate submissions/cases. Similar content from a distinct event must  
remain preserved as a distinct submission.

## **FR-INTG-002 \--- Retry**

Retry transient failures with bounded backoff. Do not endlessly retry  
permanent validation or authorization errors.

## **FR-INTG-003 \--- Dead-letter queue**

After retry exhaustion, surface the event in an administrator-visible  
exception queue with reason, source and safe retry action.

## **FR-INTG-004 \--- Reprocessing**

Manual reprocessing must be authorized and audited. It must preserve the  
original event and record processing versions.

## **FR-INTG-005 \--- External references**

Keep external source IDs separate from internal submission and case IDs.

## **FR-INTG-006 \--- CPGRAMS integration**

Implement only through an approved interface or authorized process. Do  
not assume public portal access implies an available API.

## **FR-INTG-007 \--- Email intake**

Email parsing must preserve relevant source metadata, receipt timestamp,  
sender reference as permitted, original body and attachment references  
under policy. Email threads and repeated forwards must not automatically  
become separate canonical cases without duplicate review.

# **25\. Data model alignment**

The database document is the canonical reference for entity definitions  
and relationships. The main entity groups are: \- Institution identity:  
`regions`, `institutions`, `institution_aliases`. \- Reference data:  
`bureaus`, `complaint_categories`, `case_statuses`, `intake_channels`. \-  
Intake: `submissions`, `institution_verification_tasks`,  
`attachments`. \- Case identity: `cases`, `duplicate_candidates`,  
`case_relationships`. \- Organizational access: `users`, `roles`,  
`permissions`, `bureau_memberships`, `user_role_assignments`,  
`role_permissions`. \- Ownership: `case_bureau_assignments`,  
`case_officer_assignments`, `case_transfers`. \- Collaboration/access:  
`case_notes`, `case_access_requests`, `case_access_grants`. \- Workflow:  
`case_action_history`. \- SLA: `sla_policies`, `case_deadlines`,  
`escalation_rules`, `case_escalations`. \- Notifications:  
`notification_rules`, `notifications`.

Do not implement multiple bureau IDs, officer IDs, categories or  
attachments as comma-separated fields. Do not use unchecked polymorphic  
foreign keys. Dashboard metrics should be derived from canonical records  
or secured views.

## **25.1 Required transactional invariants**

* A verified institution identity is required for canonical case  
  creation.  
* One submission may associate with at most one canonical case.  
* A submission may have multiple duplicate candidate records but only  
  one final canonical case association.  
* One case can have multiple active bureau assignments.  
* Active officer assignments require valid membership or explicit  
  authorization.  
* A case relationship cannot link a case to itself.  
* A grant must identify exactly one grantee target unless an approved  
  alternate design is adopted.  
* A bureau-private note requires a bureau scope.  
* A status change and its action-history record must be atomic.  
* Case creation and first submission association must be  
  transaction-safe.  
* Current-state projections must reconcile with history.  
* Audit history is not cascade-deleted when a user or membership is  
  deactivated.

# **26\. Non-functional requirements**

## **NFR-001 \--- Reliability**

Operations that create cases, change assignments or grant access must be  
transactional and recoverable. Partial failures must be visible.

## **NFR-002 \--- Performance**

Index institution ID, case ID, status, category, bureau assignments,  
officer assignments, received dates, pending queues and deadlines. Use  
pagination and bounded queries. Establish numeric latency targets after  
expected data volume and hosting are known.

## **NFR-003 \--- Consistency**

Dashboard counts, case details and assignment views must derive from the  
same canonical records. Any denormalized projection must have a  
documented update/reconciliation strategy.

## **NFR-004 \--- Maintainability**

Keep UI, business logic, database access and integration orchestration  
separate. Use versioned migrations and documented configuration.

## **NFR-005 \--- Availability**

Availability objectives and recovery targets must be agreed before  
production. The demonstrator should expose clear failure states rather  
than silently displaying stale data as current.

## **NFR-006 \--- Observability**

Record structured errors and correlation IDs without logging secrets or  
unnecessary complaint content. Monitor failed intake, routing,  
notification and deadline jobs.

## **NFR-007 \--- Accessibility**

Keyboard navigation, visible focus, text labels and non-colour-only  
status indicators are required for key flows.

## **NFR-008 \--- Language**

Support Hindi and English input and display. Preserve original Unicode  
text. Use a normalization version and language metadata for derived  
search/matching text.

## **NFR-009 \--- Time handling**

Store timestamps consistently, preferably as timezone-aware values;  
display in the configured user/system timezone. Use an explicit timezone  
for date-range boundaries and SLA calculation.

## **NFR-010 \--- Backup and recovery**

Define backup, restoration testing and disaster recovery before  
production. A backup is not sufficient unless restoration is tested.

# **27\. Error and exception behavior**

The product must define and test outcomes for: \- Missing/ambiguous  
institution. \- No verified SLA policy. \- No category or routing rule. \-  
Duplicate candidate conflict. \- Concurrent reviewer decisions. \-  
Duplicate source-event retry. \- Invalid case transition. \- Unauthorized  
access request/decision. \- Expired/revoked grant. \- Failed upload or  
malware scan. \- Notification delivery failure. \- Integration outage. \-  
Retry exhaustion. \- Incorrect institution/case association requiring  
correction. \- Attempted duplicate reciprocal relationship. \- Stale UI  
state after another officer changes a case. \- Partial failure between  
case creation, assignment and deadline creation.

General rules: \- Do not silently drop the source submission. \- Do not  
silently grant access. \- Do not silently merge cases. \- Do not display  
success before the server confirms success. \- Make retry safe and  
idempotent. \- Show actionable error text without exposing internal  
secrets or restricted content. \- Keep the failed operation and its cause  
visible to authorized operators.

# **28\. Seed data specification**

The demo dataset must include: \- Multiple institutions across multiple  
regions. \- Verified Permanent IDs and verified aliases. \- Several  
bureaus, including RB and PGRC, marked as demo data where appropriate. \-  
Multiple officers per bureau and at least one authorized cross-bureau  
membership if the scenario needs it. \- Cases in each common status. \-  
Cases assigned to one and multiple bureaus. \- Multiple source  
submissions associated with one canonical case. \- Unresolved  
institution-verification cases. \- High-confidence duplicate candidates  
at/above 0.90. \- Borderline potential candidates below 0.90. \-  
Reviewer-confirmed duplicate, related-but-distinct and unrelated  
outcomes. \- Same-institution cases that are explicitly distinct. \- Cases  
due soon, overdue, escalated, transferred, disposed and reopened. \-  
Shared and bureau-private notes. \- Pending, approved, denied, expired  
and revoked access requests/grants. \- Attachments in permitted and  
rejected/quarantined states if upload scanning is demonstrated. \-  
Illustrative category SLA policies, visibly labelled. \- Failed  
intake/routing examples for exception queue demonstration. \-  
Notification examples for assignments, overlaps, access requests and  
deadlines.

Use synthetic or properly authorized data. Do not include real personal  
complainant information in demonstration seeds.

# **29\. Acceptance test catalogue**

## **Intake and identity**

* **AT-001:** Valid demo submission creates exactly one submission  
  record.  
* **AT-002:** Demo confirmation explicitly states that it is not a  
  real external filing.  
* **AT-003:** Original Hindi/English text remains unchanged after  
  normalization.  
* **AT-004:** Exact retry of the same source event does not create a  
  second processing artifact.  
* **AT-005:** A genuine repeated submission is retained as a separate  
  submission.  
* **AT-006:** Unresolved institution enters verification queue and  
  cannot create a canonical case.  
* **AT-007:** Institution decision records reviewer, time and reason.

## **Duplicate handling**

* **AT-008:** A score of 0.90 or higher enters the high-confidence  
  queue.  
* **AT-009:** High score alone does not merge or delete records.  
* **AT-010:** Reviewer can confirm duplicate and associate the  
  submission with one existing case.  
* **AT-011:** Reviewer can mark related-but-distinct and retain  
  separate cases.  
* **AT-012:** Reviewer can mark unrelated and create a new case.  
* **AT-013:** One submission cannot be associated with two canonical  
  cases.  
* **AT-014:** Rejected candidate does not reappear repeatedly without  
  changed evidence/re-evaluation reason.

## **Case and assignment**

* **AT-015:** New issue creates one unique canonical Case ID.  
* **AT-016:** One case supports RB and PGRC assignments  
  simultaneously.  
* **AT-017:** Each bureau assignment supports a responsible officer  
  and additional participants.  
* **AT-018:** Unauthorized user cannot assign an officer outside their  
  scope.  
* **AT-019:** Transfer retains historical assignments and action  
  history.  
* **AT-020:** Invalid status transition is rejected server-side.  
* **AT-021:** Valid status transition and audit event commit  
  atomically.  
* **AT-022:** Reopening requires permission and reason.

## **Access and notes**

* **AT-023:** Index-only user sees minimal case fields but cannot  
  fetch restricted content.  
* **AT-024:** Private note cannot be read by an unapproved  
  other-bureau user through database/API/UI.  
* **AT-025:** Access request requires a reason and enters the approval  
  queue.  
* **AT-026:** Grant exposes only the approved scope.  
* **AT-027:** Revoked/expired grant no longer authorizes subsequent  
  access.  
* **AT-028:** Notification previews do not leak restricted content.  
* **AT-029:** Super Admin content access follows explicit permission  
  and is audited.

## **SLA and reporting**

* **AT-030:** Deadline is instantiated from the applicable policy  
  version.  
* **AT-031:** Unverified/illustrative policy is visibly labelled.  
* **AT-032:** Overdue state follows due time and approved pause rules.  
* **AT-033:** Deadline override records previous/new value, reason,  
  actor and time.  
* **AT-034:** Escalation trigger creates one deduplicated event for  
  the configured window.  
* **AT-035:** Submission and canonical case counts are different  
  metrics and reconcile correctly.  
* **AT-036:** Reopened-case treatment follows documented disposal-rate  
  definitions.  
* **AT-037:** Region, bureau and institution reports apply access  
  control.

## **Security and resilience**

* **AT-038:** RLS blocks unauthorized direct table access.  
* **AT-039:** Guessing a Storage path does not expose a private  
  attachment.  
* **AT-040:** Service-role credentials are not present in browser  
  bundles.  
* **AT-041:** Failed notification delivery does not silently fail the  
  case action.  
* **AT-042:** Failed integration is visible and can be retried safely.  
* **AT-043:** Concurrent duplicate-review actions do not silently  
  overwrite one another.  
* **AT-044:** Audit history cannot be edited/deleted by ordinary  
  users.  
* **AT-045:** Search, autocomplete, exports and notifications do not  
  leak restricted fields.

# **30\. Implementation sequencing and dependencies**

## **Phase 0 \--- Specification freeze**

* Review this PRD and the master database document together.  
* Approve role/action matrix.  
* Approve state machines and transitions.  
* Resolve official category/SLA data source and label demo  
  assumptions.  
* Confirm physical entity names and relationships.

## **Phase 1 \--- Identity and authorization**

* Supabase Auth integration.  
* Users, roles, permissions, bureaus, memberships.  
* Institutions, aliases and regions.  
* RLS tests before adding sensitive data.

## **Phase 2 \--- Intake and canonical case**

* Intake channels and submissions.  
* Institution verification tasks.  
* Categories and case statuses.  
* Cases and source association.  
* Duplicate candidates and case relationships.  
* Seed data and core invariants.

## **Phase 3 \--- Bureau operations**

* Bureau and officer assignments.  
* Case status transitions and action history.  
* Notes and attachments.  
* Kanban, list view and case detail.

## **Phase 4 \--- Cross-bureau controls**

* Minimal index.  
* Access requests/grants.  
* Shared/private notes.  
* Overlap alerts.  
* Transfers.  
* Permission regression tests.

## **Phase 5 \--- SLA, escalation and analytics**

* SLA policies and case deadlines.  
* Escalation rules/events.  
* Notifications.  
* Dashboard views and metric definitions.  
* Reports and secured exports.

## **Phase 6 \--- Integrations**

* n8n workflows and adapter contracts.  
* Authorized email/portal intake.  
* Retry/error handling.  
* Integration monitoring and reconciliation.  
* Production policy validation and security review.

A later phase must not be started by bypassing unfinished authorization  
or data-integrity dependencies.

# **31\. Implementation-agent operating rules**

The agent must: 1\. Read this PRD and the master database document before  
coding. 2\. Implement one bounded feature/table group at a time. 3\. Use  
migrations; do not modify production schema manually without a recorded  
migration. 4\. Add RLS and authorization tests with every sensitive  
feature. 5\. Never invent or rename approved entities without a  
documented proposal. 6\. Never collapse submissions, cases, bureau  
assignments and case relationships. 7\. Never automatically merge/delete  
based solely on semantic similarity. 8\. Never allow the UI to be the  
only enforcement layer for permissions. 9\. Never expose private content  
through search, logs, exports, notification previews or Storage. 10\.  
Never represent unverified deadlines as official AICTE rules. 11\. Never  
claim a demo portal submitted data to a real external system. 12\.  
Preserve audit history and original submission content. 13\. Update  
tests, seed data and documentation whenever an approved requirement  
changes. 14\. Record assumptions and unresolved questions instead of  
inventing answers. 15\. Provide a feature completion report listing  
requirements implemented, tests run, known gaps and relevant migrations.

# **32\. Open decisions and release gates**

## **Decisions resolved from public-source research**

* PGRC can be seeded as a known unit with the broad responsibilities  
  listed in Section 2A. Do not infer a complete all-bureau routing  
  matrix from that source.  
* CPGRAMS has a published general 21-day redress timeline with an  
  interim-reply requirement for delay. Apply it only to the applicable  
  CPGRAMS workflow after validating current instructions and the  
  start-date rule.  
* The 2019 student-grievance text describes a 15-day SGRC  
  report/recommendation period, a 15-day student appeal window, and a  
  30-day Ombudsperson resolution-effort period. These are distinct  
  milestones and are not generic AICTE complaint SLAs.  
* The 2021 faculty/staff grievance regulation is referenced by AICTE  
  material, but its full current text and detailed timelines must be  
  obtained before configuration.  
* Government record-management guidance requires applicable retention  
  schedules and does not justify inventing one generic retention  
  period for AICTE complaint records.  
* No public source reviewed establishes the exact field-level  
  cross-bureau access matrix for this proposed application.  
  Least-privilege controls in this PRD are product security defaults  
  pending internal approval.

## **Remaining design decisions before schema/workflow freeze**

* Whether a canonical case can have multiple formal categories or only  
  one primary category.  
* Exact internal Case ID format.  
* Full current bureau list, current organization chart and approved  
  category-to-bureau routing matrix.  
* Complete current official text/amendments for student and  
  faculty/staff grievance procedures.  
* Authoritative AICTE/CPGRAMS milestone start dates, pause rules,  
  calendar rules and escalation authority for each applicable pathway.  
* Current AICTE-specific retention schedule for complaint records,  
  attachments, audit events and derived matching data; legal-hold and  
  authorized disposal process.  
* Exact minimum cross-bureau index fields by sensitivity class and  
  authorized grant-approval roles.  
* Whether case access grants can be bureau-wide or user-specific and  
  which scopes each grant covers.  
* Attachment parentage, classification, retention and quarantine  
  rules.  
* Authoritative institution master-data source and refresh method.  
* Current approved external integration mechanism and  
  credentials/permissions.

Before production: \- Obtain written approval of the role/action matrix,  
routing matrix, SLA/policy catalogue and retention schedule from the  
competent authority. \- Verify all cited regulations against official  
Gazette/current AICTE notifications and subsequent amendments. \-  
Complete RLS, Storage, role and export security review. \- Validate  
privacy and retention requirements. \- Confirm backups and restore  
procedure. \- Set operational latency/availability targets. \- Validate  
monitoring, incident response and integration retries. \- Run the  
acceptance suite with multiple role personas.

**MVP release gate:** seeded data, simulated intake, complete audit  
trails, secure cross-bureau index, human duplicate review, institution  
verification, case workflows, SLA demo configuration and acceptance  
tests pass.

**Production release gate:** official AICTE policies and mappings  
verified, external integration authorized, security and privacy  
reviewed, operational controls tested.

---

# **Appendix A \--- Required feature traceability template**

For every feature, maintain a record with: \- Feature ID and title. \-  
User role(s). \- Entry point/screen. \- Preconditions. \- Main flow. \-  
Alternate and error flows. \- Entities read/written. \- Permissions  
required. \- Audit events. \- Notifications triggered. \- Acceptance  
tests. \- Status: planned/in progress/implemented/verified. \- Known  
limitation and linked decision.

# **Appendix B \--- Required state-machine artifacts**

Before implementing workflows, maintain explicit diagrams/tables for: 1\.  
Submission intake state. 2\. Institution verification state. 3\. Duplicate  
candidate review state. 4\. Canonical case status. 5\. Bureau assignment  
and transfer state. 6\. Access request and grant state. 7\. Deadline and  
escalation state. 8\. Attachment scan state. 9\. Notification delivery  
state.

Each state machine must define valid transitions, actor permissions,  
mandatory fields, side effects, audit events and retry/idempotency


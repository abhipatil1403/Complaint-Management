# Role-specific workspaces and portal QA

Date: 29 October 2026

## Scope and sources

Implemented the user's role-specific frontend refinement on the existing simulation. Read PRD v1.1, `docs/Master_Database.md` (the repository's master design filename), and `docs/CURRENT_SUPABASE_SCHEMA.sql`. No backend, database, schema, role roster, permission array, or package dependency was changed in this pass. Previous uncommitted refinement work is retained.

PRD section 7 defines seven personas. Institution verification and duplicate review are capability workspaces, not new roles. The latest user request explicitly extends the PRD's original public-intake-only MVP with personal history and correspondence in this frontend simulation. This does not provision a new authentication system or a live public service. Ownership uses the approved `submitter_reference`; source reference and public correspondence use the existing `source_metadata` JSON concept. Only the known seed submission owned by the seeded complainant is backfilled; matching an email address does not grant ownership of arbitrary old submissions.

## Landing pages and navigation

| Existing persona | Landing and responsibilities | Scope |
| --- | --- | --- |
| Super Administrator | System overview; all-bureau workload, intake/resolution, SLA, escalations, verification, duplicate review, decisions, administration | Existing explicit global permissions |
| Bureau Administrator | Bureau command center; active and unassigned work, officer workload, SLA, access/transfer decisions, routing | Active own-bureau lead/collaborating assignments and authorized grants |
| Case Officer | My assigned work; personal deadlines, overdue/awaiting-information work, next actions, source submissions and recent actions | Active officer assignments with active membership; valid grants remain available where permitted |
| Cross-bureau Collaborator | Collaboration desk; accessible work, pending/expiring grants, minimal case index, shared actions | Assignment or valid user/bureau grant; view-only grants do not enable writing |
| Senior Management | Executive overview; critical work, escalations, disposal, trends, bureau performance | Explicit authorized global reporting/detail permissions |
| Auditor | Audit workspace; searchable action register, evidence counts, completed records and reports | Authorized read-only records, without investigation/assignment controls |
| Public Complainant | My complaints; portal choice, personal history, channel filter, original text, progress and two-way public responses | Stable submitter identity; internal navigation and private content excluded |

`/workspaces/verification` requires the existing `institution.verify` capability and includes pending checks, corrections and past decisions. `/workspaces/duplicate-review` requires `duplicate.review` and includes candidate comparisons, review history and verified distinct sources eligible for case creation. No verification or duplicate-review role was added.

Switching accounts navigates to the selected landing and remounts user-specific screens without recreating the shared simulation state. Search, case boards, intake, exports, reports and direct simulated API detail requests enforce the same scope helpers. The cross-bureau index remains an explicit minimal-index view. A role name alone does not grant content access. Assignment, note and duplicate-decision mutations also check scope. Cross-bureau candidate details redact case title and matching keywords, and require authorized content access before recording a decision.

## Portal experiences

AICTE presents an institution-complaint/evidence flow and receipt-code tracking. CPGRAMS presents a referral flow with an optional originating reference, source-specific receipt and referral tracking by originating reference, intake number or tracking code. Lookups are channel-specific. Both write to the same submission, verification, duplicate and case-processing state. Receipts accurately state that no filing was sent to an external service.

Public messages are separate from shared and bureau-private notes. An assigned staff member with existing submission-view and note-write permissions can explicitly publish a response; the owning complainant can answer. View-only grants cannot publish. These messages persist with the source record and produce simulation audit/notification events.

## Changed file groups

- `frontend/src/pages/RoleLandingPage.tsx`: role dashboards, capability desks, decisions, escalations and audit workspace.
- `frontend/src/pages/ComplainantPage.tsx`, `components/PublicCorrespondence.tsx`, `pages/DemoIntakePage.tsx`: personal public experience, correspondence and distinct source portals.
- `frontend/src/simulation/scope.ts`, `selectors.ts`, `simulationStore.ts`, `apiHandler.ts`, `types.ts`, `seedData.ts`, `storage.ts`: shared filters, action guards, ownership and persistence.
- `frontend/src/App.tsx`, `auth/AuthProvider.tsx`, `auth/RequireAuth.tsx`, `components/AppShell.tsx`, `PublicShell.tsx`, `RoleSwitcher.tsx`, `GlobalSearch.tsx`: routing, authorization-aware navigation and account switching.
- Existing Home, Cases, CaseDetail, Analytics, Intake, Verification and DuplicateReview pages: scoped data, actionable filters, review links and correspondence integration. `frontend/src/types.ts` adds the simulated candidate-content availability flag.
- `frontend/src/styles/app.css`: consistent existing Fernly tokens, role layouts, source variations and correspondence styles.
- `frontend/src/test/roleWorkspaces.test.tsx`: 22 additional tests.

## Validation

- Full Vitest run: **103 passed, 0 failed**, across 9 test files. JSON result: `frontend/qa/role-final-results.json`.
- Production build, including TypeScript checking: **passed**. The existing bundle-size warning remains (main chunk approximately 757 kB before gzip).
- Tests cover all seven landings, account-menu switching without data reset, unchanged permission arrays, membership termination, direct restricted requests, bureau/officer filtering, capability gating, submitter identity, public/private message separation, CPGRAMS source-reference lookup and cross-bureau candidate redaction.
- Parameterized end-to-end store/API tests for **each portal** cover public submission, verification, human review of all pending duplicate candidates, bureau eligibility, case creation, officer invisibility before assignment, visibility after assignment, and persisted reload state.
- Browser checked all seven landing experiences and their navigation. Created AICTE fixture `DEMO-AICTE-2026-000113` and CPGRAMS fixture `DEMO-CPGRAMS-2026-000114` on the existing development origin. Both appeared in personal history and centralized intake, then in the Approval Bureau routing desk. Their institution matches were verified and no duplicate candidates met the existing threshold, so the routing desk correctly offered case creation.
- Browser converted the CPGRAMS fixture into `CASE-2026-000098`, confirmed its content was restricted to the officer before assignment, assigned Vikram Singh from Approval Bureau, and confirmed the case appeared on his landing afterward. The officer published a response; switching to Rahul Verma showed the response and updated public-response count. Existing shared data was retained throughout.
- Inspected public and internal layouts at the default narrow viewport and at a 1440-pixel desktop viewport. Temporary viewport overrides were reset after inspection.
- Browser fixtures are local demonstration records, not external submissions. The previous browser data and earlier QA records were not reset.

Screenshots: `frontend/qa/role-officer-dashboard.png`, `role-public-history.png`, `role-public-response.png`, and `role-cpgrams-tracking.png`.

## Limits

Authorization is enforced within the frontend simulation only, as requested. This pass does not claim server-side/RLS enforcement or live AICTE/CPGRAMS integration. No new role, official SLA policy or live database change was introduced. No commit or push was made.

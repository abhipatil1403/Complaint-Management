\# AICTE OneDesk — Coding Agent Instructions



\## Project



Build AICTE OneDesk, an AICTE institution complaint monitoring and status dashboard.



\## Sources of truth



Read these documents before implementation:



1\. `docs/PRD.md`

2\. `docs/MASTER\_DATABASE\_DESIGN.md`

3\. `docs/CURRENT\_SUPABASE\_SCHEMA.sql`



The PRD defines required behavior. The Master Database Design defines the intended data model. The actual Supabase schema defines what currently exists.



If they conflict, report the discrepancy and request approval before changing the database or product behavior.



\## Technology stack



\- Frontend: React, TypeScript, Vite

\- Backend: Python, FastAPI

\- Database: Supabase PostgreSQL

\- Authentication: Supabase Auth

\- API convention: `/api/v1/`

\- Styling: Choose one consistent, maintainable UI system and document the choice.



\## Database rules



\- Exactly 32 approved application tables.

\- Do not create extra tables.

\- Do not rename, delete, or modify existing tables without explicit approval.

\- Do not invent columns or assume relationships exist.

\- Inspect the actual database schema before writing queries.

\- Keep SQL migrations version-controlled.

\- Never execute destructive SQL automatically.

\- Never expose database service-role credentials to the frontend.



\## Business rules



\- One canonical case per underlying complaint issue.

\- Preserve every original submission.

\- Verify the institution before creating a normal canonical case.

\- Duplicate matching requires human review; never automatically merge cases.

\- Support multiple bureaus and officers per case.

\- Preserve full action and assignment history.

\- Distinguish cross-bureau case-index visibility from restricted case-content access.

\- Support shared and bureau-private notes.

\- Apply category-specific, versioned SLA policies.

\- Do not invent official AICTE timelines or policies.

\- Preserve original complaint language and text.



\## Security



\- Use Supabase Auth, not a separate authentication system.

\- Enforce permissions in FastAPI and PostgreSQL RLS.

\- Apply least-privilege access.

\- Never rely solely on frontend authorization.

\- Restrict access to complaint content and attachments.

\- Audit sensitive decisions and case changes.



\## Development process



For each feature:



1\. Read the relevant PRD requirements.

2\. Inspect the existing schema and code.

3\. Explain the proposed implementation.

4\. Identify required files and endpoints.

5\. Implement only the approved feature.

6\. Add relevant tests.

7\. Run checks and report results.

8\. Summarize changed files and unresolved issues.



Do not implement unrelated features or redesign the architecture without approval.



\## Initial task



Start with repository initialization and a read-only database/schema assessment.



Do not begin implementing the full application until the assessment is reviewed.




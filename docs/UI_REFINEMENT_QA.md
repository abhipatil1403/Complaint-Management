# AICTE OneDesk UI refinement and QA

Date: 29 October 2026

## Scope and reference decisions

Refined the existing React/TypeScript frontend and browser simulation. The backend, live Supabase database, and schema snapshot were not changed. No commit or push was made. Existing uncommitted implementation work was retained.

Read PRD v1.1, `Master_Database.md` (the repository's filename for the master design), and the current SQL schema snapshot. The snapshot contains the approved 32 application tables. No live database access was necessary for this frontend task. The user's recording-interface instructions override the PRD's persistent illustrative-data banners; public receipts still accurately state that no external filing occurred.

Inspected all seven `reference/screenshots/fernly-reference-0*.png` images and the DesignMD design, component, theme, and token references. Applied reference 01's Kanban principles, 03's reporting layout, 04's dashboard hierarchy, 05's directory cards, 06's settings layout, and 07's Help structure. Reference 02 informed spacing and status grouping; no unrelated calendar was added. A separate current-dashboard screenshot was not present in the attachment; the existing implementation was inspected directly.

Styling remains plain CSS with the existing design tokens and Plus Jakarta Sans. No UI framework was added. The single new runtime dependency is `pdfjs-dist`, loaded on demand with its local worker for reliable PDF previews in browsers without an embedded PDF plugin; package manifest and lockfile changes are limited to this renderer. Icons have explicit dimensions rather than depending on an absent Tailwind installation. Shared controls include inputs with an omitted `type`, searchable fields, focus states, tables, badges, cards, tabs, responsive grids, and accessible modal focus management.

## Changes

- Replaced overlapping search and presentation controls with permission-aware global search, notifications, and an account menu. Ctrl/Command+K focuses search; results navigate to cases, institutions, bureaus, or intake records.
- Removed the guide, reset button, visible time controls, promotional sidebar card, obsolete intake banners, unsupported password form, sample public tracking shortcuts, and unsupported user-role/account mutation controls.
- Added compact sidebar navigation, scroll containment, grouped links, restrained active states, consistent icon sizing, and responsive layouts.
- Rebuilt dashboard and Analytics charts from actual source records. Counts distinguish submissions from cases. Date ranges, status/bureau/officer links, KPI navigation, workload, completion percentages, and CSV exports use the shared state.
- Corrected SLA calculations for late completions and short overdue intervals. Removed invented statutory labels and a hardcoded 14-business-day description. Officer bars show the share of active cases rather than an invented capacity limit.
- Restored missing fictional archive submissions for seven legacy seed cases, deriving them from their existing seeded statements and timestamps. Existing original submissions are never replaced. Seed counts and throughput now reconcile with case history.
- Improved Cases, case details, intake, verification, duplicate comparison, administration/directory, institution/bureau/region surfaces, login, and both public portals. Added searchable Help and saved notification/compact-table preferences.
- Added the reopened Kanban column, URL filters, eligible submission selection, actionable creation errors, exact institution/alias matching, and duplicate-association guards.
- Fixed simulation adapters for intake, verification assignment/decisions, duplicate queue/filtering, reference records, directory profiles, and the correct case for officer assignment. Unsupported requests now fail explicitly instead of reporting empty success.
- Added scoped content access, read-only grant enforcement, expiry/revocation, private-note filtering, denial decisions, safe notification previews, and identity-separated resource caching. These are prototype behavior checks, not a claim of production backend/RLS enforcement.
- Uploaded evidence is stored in IndexedDB and reloaded for previews/downloads. Public-upload binary references avoid filling localStorage. Replaced truncated seeded PDF payloads with valid fictional PDF fixtures and corrected their displayed byte sizes. PDF previews render on canvas with working page navigation; the native iframe viewer did not render in the in-app browser. Downloaded evidence uses Blob URLs.
- Public tracking shows the linked case's current status and does not claim active investigation before case creation. Hindi/English metadata and original complaint text are preserved.

## Validation

- Full frontend suite: **81 tests passed, 8 test files**.
- TypeScript: passed through the production build's `tsc --noEmit` check.
- Production build: passed. Vite reports a JavaScript chunk of approximately 715 kB (186 kB gzip), exceeding its 500 kB advisory threshold.
- Browser navigation: dashboard, Kanban/table controls, Analytics, institutions, bureaus, regions, administration, Settings, Help, intake, verification, duplicate comparison, public intake/tracking, and case details rendered.
- Browser workflows: public submission and tracking; reviewer assignment; institution confirmation; human duplicate rejection; canonical creation from a reviewed submission; officer assignment; cross-bureau request and approval; bureau-private note; status changes through assignment, investigation, and resolution; dashboard/workload updates; account switching.
- CSV report export downloaded successfully. PDF canvas preview displayed the actual repaired fixture; production console remained clear.
- Real attachment test: uploaded `frontend/qa/evidence.txt`, refreshed the browser, previewed its actual text, and downloaded it. The download SHA-256 matched the original.
- Automated regression coverage additionally checks denied access/transfers, grant expiry, read-only grants, private-note isolation, transfer history, Unicode preservation, ambiguous institution names, canonical-case invariants, persisted binary reloads, dashboard metrics, URL scope, global search, Help filtering, and settings save/discard.
- Layout screenshots captured at 1920×1080 and 1366×768; tablet layout checked at 820×1180. Corrected case-tab overflow and the compressed institution overview discovered in the tablet check.
- Production console checked during navigation; no warning/error entries appeared in the inspected production session. Development hot reload produced transient context errors during source edits; a fresh production load was used for the final check.

## Files and review evidence

Main changes are in `frontend/src/components/`, `frontend/src/pages/`, `frontend/src/simulation/`, `frontend/src/lib/useResource.ts`, `frontend/src/lib/api.ts`, authentication routing, and `frontend/src/styles/app.css`. New regression coverage is in `frontend/src/test/refinement.test.tsx`; older simulation tests now use valid source submissions, memberships, and bureau-scoped authors.

Screenshots and the harmless upload fixture are in `frontend/qa/`. Development-only reset/time helpers are available as `window.onedeskDevelopment` on the Vite development server; they are not exposed in normal application UI or the production build.

## Remaining limits

- Capacity limits are not present in the approved model; no official or invented capacity figure was introduced.
- Account identity fields and production role provisioning remain read-only in this frontend. Unsupported mutation controls were removed.
- The browser checks cover the workflows listed above, not every permutation of every administrative form, role, file format, and concurrency scenario. Production authorization, live RLS, external integrations, and malware scanning were outside this frontend-only request.
- Bundle splitting remains a potential performance improvement; the build warning is not hidden or suppressed.

# Phase 2.1 — Simulated complaint intake and submission preservation

Status: **implemented, applied and verified** on 29 October 2026.
Scope owner: Phase 2.1 only. Phase 2.2 (institution verification, duplicate review, case creation) is **not** started.

> **Simulation only.** No AICTE, CPGRAMS, mailbox, n8n or government endpoint is contacted. Both demo portals are labelled as simulations in the interface, in the API response and in the database metadata.

## 1. What this phase delivers

| Requirement | Implementation |
| --- | --- |
| Simulated AICTE and CPGRAMS portals | `/demo`, `/demo/aicte`, `/demo/cpgrams` (React) |
| Public submission path | `POST /api/v1/demo/intake/{channel_code}/submissions` |
| Submission preservation | `public.submissions` row written verbatim, never updated or deleted by the API |
| Intake state machine | `received` → `awaiting_institution_verification` or `awaiting_duplicate_review` |
| Intake visibility | `GET /api/v1/submissions` and `/submissions/{id}`, global `submission.view` |
| Least-privilege database security | Dedicated NOLOGIN role, insert-only `SECURITY DEFINER` function, RLS read policies |
| Original text and language | Stored exactly as submitted; no translation, trimming or normalisation |
| No automatic case creation | `canonical_case_id` stays null; no `cases`, `duplicate_candidates`, `institution_verification_tasks` or `attachments` row is created |
| Table count | Still exactly 32 approved application tables; no column, constraint or index change |

Deliberately **out of scope**: institution verification, duplicate detection/matching/merging, canonical case creation, Kanban/assignment, dashboards, SLA, notifications, attachments and any external integration.

## 2. Files

| Path | Purpose |
| --- | --- |
| `supabase/migrations/0003_phase2_intake.sql` | Role, revokes, RLS policies, `create_demo_submission()` and grants |
| `supabase/seed/phase2_intake_seed.sql` | Two simulated channels, `SUBMISSION.VIEW`, Super Admin grant |
| `backend/app/api/v1/intake.py` | Public POST, authorized list/detail |
| `backend/app/services/intake.py` | Demo flags, rate limiter, outcome mapping, notices |
| `backend/app/repositories/intake.py` | Function call and read SQL |
| `backend/app/schemas/intake.py` | Request/response models |
| `backend/app/db/session.py` | `session(..., role=...)` with an allowlist |
| `frontend/src/pages/DemoHomePage.tsx` | Public demo hub |
| `frontend/src/pages/DemoIntakePage.tsx` | Public submission form and receipt |
| `frontend/src/pages/IntakePage.tsx` | Authorized queue |
| `frontend/src/pages/IntakeDetailPage.tsx` | Authorized detail, original text |
| `backend/tests/test_intake.py` | API contract and validation tests |
| `backend/tests/test_phase2_seed.py` | SQL/Python drift checks |
| `backend/tests/test_rls_db.py` | Live rollback-safe security probes |
| `frontend/src/test/intake.test.ts` | Public client and helper tests |

## 3. Database model (existing tables only)

No table or column was added. Phase 2.1 uses:

* `public.intake_channels` — two seeded rows: `AICTE_SIM` (`portal`), `CPGRAMS_SIM` (`cpgrams`), both `is_simulated = true`, `is_active = true`.
* `public.submissions` — one row per accepted simulation submission. Existing columns only: `intake_channel_id`, `external_reference`, `source_event_id`, `institution_id`, `institution_name_as_submitted`, `category_id`, `subject`, `original_text`, `original_language`, `normalized_text`, `normalization_version`, `submitter_reference`, `intake_status`, `content_fingerprint`, `idempotency_key`, `source_metadata`.
* `public.institutions` — read-only resolution target. Only an exact, active, `verification_status = 'verified'` `aicte_permanent_id` resolves.
* `public.complaint_categories` — read-only. No categories are seeded in Phase 2.1; an unknown code is rejected rather than dropped.
* `public.permissions`, `public.roles`, `public.role_permissions` — `SUBMISSION.VIEW` is granted to `SUPER_ADMIN` only, as an explicit grant.

Values never written: `normalized_text`, `normalization_version` (no normalisation in this phase), `submitter_reference` (no submitter identity is collected), `canonical_case_id` (case creation is a later phase).

`source_metadata` records provenance only:

```json
{
  "demo": true,
  "simulation_notice_version": "SIM-NOTICE-2026-10-29-v1",
  "consent_acknowledged": true,
  "reference_origin": "demo_generated",
  "payload_version": "1",
  "request_hash": "<sha256 hex>",
  "fingerprint_version": "sha256-v1",
  "institution_permanent_id_as_submitted": "DEMO-AICTE-0001",
  "source_submitted_at": "2026-10-29T04:55:00.000Z",
  "received_at_origin": "server_clock"
}
```

No IP address, user agent or submitter identity is stored (`D9`).

## 4. Security model

### 4.1 One write path

`public.create_demo_submission(...)` is `SECURITY DEFINER`, owned by `postgres`, with `search_path = ''` and `statement_timeout = '15s'`. Every identifier is schema-qualified and there is no dynamic SQL.

`EXECUTE` is revoked from `PUBLIC`, `anon`, `authenticated` and `service_role`, and granted only to the NOLOGIN, NOBYPASSRLS role `one_desk_intake`. That role holds no table privilege at all.

Defence in depth: the function itself requires

```sql
current_setting('role', true) = 'one_desk_intake'
```

and otherwise returns `channel_unavailable` without doing any work. `current_user` inside the definer is `postgres`, so the `role` GUC is the correct caller signal. A future accidental `EXECUTE` grant to another role therefore still cannot create a submission. This is a deliberate change from the denylist (`not in ('anon','authenticated')`) that was rejected during review.

### 4.2 Read policies

| Table | Policy | Rule |
| --- | --- | --- |
| `submissions` | `phase2_submissions_select_authorized` | `authenticated` and `has_global_permission('SUBMISSION.VIEW')` |
| `intake_channels` | `phase2_intake_channels_select_active` | `authenticated` and `is_active_user()` |

`authenticated` keeps `SELECT` only on both tables. `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` and PostgreSQL 17 `MAINTAIN` are revoked. There is no Data API path to overwrite or delete a preserved submission.

### 4.3 FastAPI

* Public POST is outside bearer authentication but still passes the demo flags and a process-local sliding-window rate limit (default 10 per 60 seconds per client IP and channel). `429` carries `Retry-After`.
* List/detail require the **global** `submission.view` capability, so a bureau-scoped grant cannot unlock complaint content.
* List responses omit `original_text`; only the detail endpoint returns it.
* Error messages never echo submitted values.
* `db/session.py` only allows `authenticated`, `anon` and `one_desk_intake`; the role name comes from configuration, never from request data.

### 4.4 Threat notes

* A browser cannot become `one_desk_intake`: it is NOLOGIN, is not assumed by PostgREST, and the anon key has no `EXECUTE`.
* A service-role key is never shipped to the frontend. `service_role` retains owner-adjacent table privileges on the server, which is outside the browser threat model.
* The demo rate limit is convenience, not a durable control. Multi-process deployments need a shared store.

## 5. Validation (enforced in SQL and mirrored in FastAPI)

| Rule | Result on failure |
| --- | --- |
| Channel exists, active, simulated, type `portal`/`cpgrams` | `404 INTAKE_CHANNEL_UNAVAILABLE` |
| Consent acknowledged | `422`, field `consent_acknowledged` |
| Language `en` or `hi` | `422 UNSUPPORTED_LANGUAGE` |
| Subject 1–200 characters, non-blank, single line | `422` with field `subject` |
| Description 1–20,000 characters, non-blank | `422` with field `description` |
| Control characters rejected (tab/LF/CR allowed in the body) | `422` with the relevant field |
| Permanent ID ≤ 64, name ≤ 300, source event ≤ 64, key ≤ 128 | `422` with the relevant field |
| At least one of permanent ID / institution name | `422` with field `institution` |
| Unknown/inactive category code | `422`, never silently dropped |
| `source_submitted_at` ≤ now + 5 minutes, with a UTC offset | `422 SOURCE_TIME_IN_FUTURE` / schema rejection |

Complaint text is never trimmed, translated or normalised; leading/trailing whitespace, line breaks, tabs and Devanagari characters are preserved.

Institution resolution is exact and fail-closed:

```sql
where aicte_permanent_id = <submitted id>
  and verification_status = 'verified'
  and is_active
```

Zero or multiple matches leaves `institution_id` null and the submission moves to `awaiting_institution_verification`. Exactly one match moves it to `awaiting_duplicate_review`. Free-text name matching, aliases and verification are Phase 2.2.

## 6. Idempotency

Canonical payload (`payload_version = '1'`), built by `jsonb_build_object` so key order is deterministic:

* `channel_code`
* `institution_permanent_id`
* `institution_name_as_submitted`
* `subject`
* `original_text`
* `original_language`
* `category_code`
* `source_event_id`
* `source_submitted_at`, normalised to UTC with millisecond precision:
  `to_char(p_source_submitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
* `payload_version`

`request_hash = sha256(payload::text)` in hex. The same normalised timestamp string is both hashed and stored in `source_metadata`, so hash input and provenance cannot drift. The idempotency key is the lookup scope, not payload content, and is excluded.

Concurrency:

1. Transaction-scoped advisory locks are taken on the sorted hash of each key scope (`channel + idempotency key`, `channel + source event`), so concurrent retries serialise instead of racing and cannot deadlock.
2. Under the lock, an existing row with the same hash is a **replay** (`200`, same id); a different hash is a **conflict** (`409`, no ids).
3. Rows matching both keys, or a unique-violation backstop, are classified the same way. `submissions_idempotency_uq` and `submissions_source_event_uq` remain the final guard.

A genuinely new key with identical text creates a new submission. Nothing is merged.

## 7. Notices and consent

Version `SIM-NOTICE-2026-10-29-v1` is stored in every submission and returned by the API. English and Hindi wording is served by `GET /demo/info` so the public pages do not duplicate text:

* **English:** "Simulation notice — this is not a real complaint portal. This page is a demonstration of AICTE OneDesk. Do not submit a real grievance here. Anything you enter is stored only in this project's demo database. It is not sent to AICTE, to CPGRAMS or to any government office, no acknowledgement is issued, and no action will be taken on it. Do not enter personal data, confidential information, or the details of a real complaint."
* **Hindi:** "सिमुलेशन सूचना — यह वास्तविक शिकायत पोर्टल नहीं है। यह पृष्ठ AICTE OneDesk का केवल प्रदर्शन है। कृपया यहाँ कोई वास्तविक शिकायत दर्ज न करें। आप जो भी लिखते हैं वह केवल इस परियोजना के डेमो डेटाबेस में संग्रहीत होता है। यह AICTE, CPGRAMS या किसी सरकारी कार्यालय को नहीं भेजा जाता, कोई पावती जारी नहीं होती और उस पर कोई कार्रवाई नहीं की जाएगी। कृपया व्यक्तिगत डेटा, गोपनीय जानकारी या किसी वास्तविक शिकायत का विवरण दर्ज न करें।"

Consent is a required checkbox; the value is re-checked in SQL.

## 8. Frontend

| Route | Access | Purpose |
| --- | --- | --- |
| `/demo` | public | Simulation hub, approves notices, links to both portals |
| `/demo/aicte` | public | Simulated AICTE submission form |
| `/demo/cpgrams` | public | Simulated CPGRAMS submission form |
| `/intake` | global `submission.view` | Queue with status/language/channel filters |
| `/intake/:submissionId` | global `submission.view` | Detail with original text, provenance and "no case" state |

The public client (`PublicApiClient`) never reads the Supabase session and never sends `Authorization`. The form reuses one idempotency key per session so a resubmit is a replay; "New idempotency key" starts a separate submission. The app shell shows an **Intake** link only when the capability is granted.

## 9. Verification evidence

* Rollback-only dry run of `0003` + seed: **76/76 probes passed**, rollback removed the role, function, policies, channels and rows; 32 tables before and after.
* Apply + verify: 32 tables; `one_desk_intake` NOLOGIN/NOBYPASSRLS; function `SECURITY DEFINER`, owner `postgres`, `search_path=""`; `EXECUTE` only for `one_desk_intake`; both policies present; two simulated channels; `SUBMISSION.VIEW` active with one Super Admin grant; 0 submissions and 0 cases.
* Backend: **196 passed, 0 failed** (42 live database/RLS tests), including:
  * accidental-grant test: `EXECUTE` granted to `authenticated` inside a rolled-back transaction is still refused by the caller allowlist and creates no row;
  * owner session without `SET ROLE` refused;
  * `authenticated` cannot INSERT/UPDATE/DELETE either intake table;
  * a concurrent second connection blocks on the advisory lock and cannot double-insert;
  * original text, language, null normalisation and null `canonical_case_id` verified;
  * replay, payload-conflict and source-event conflict verified;
  * 32-table baseline and unchanged `submissions` column count.
* Frontend: **28 passed**; `tsc --noEmit` clean; production build succeeded.
* Schema snapshot regenerated from the live project and contains `create_demo_submission`, `one_desk_intake`, both `phase2_*` policies and 32 `CREATE TABLE` statements.

## 10. How to apply and inspect

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0003_phase2_intake.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed/phase2_intake_seed.sql
```

Both files are transaction-wrapped and re-runnable. The migration creates a role, so apply it as `postgres`.

Useful read-only checks:

```sql
select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r';                       -- 32

select pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'create_demo_submission';

select has_function_privilege('anon', 'public.create_demo_submission(text,text,text,text,text,text,text,text,text,timestamptz,boolean)', 'EXECUTE');  -- false

select code, channel_type, is_simulated, is_active from public.intake_channels order by code;
```

To roll back Phase 2.1 only (manual, reviewed, never automatic):

```sql
begin;
drop policy if exists phase2_submissions_select_authorized on public.submissions;
drop policy if exists phase2_intake_channels_select_active on public.intake_channels;
drop function if exists public.create_demo_submission(text,text,text,text,text,text,text,text,text,timestamptz,boolean);
-- restore only the privileges you actually want; do not blindly re-grant writes
revoke one_desk_intake from postgres;
drop role if exists one_desk_intake;
delete from public.role_permissions rp
 using public.roles r, public.permissions p
 where rp.role_id = r.id and rp.permission_id = p.id
   and r.code = 'SUPER_ADMIN' and p.code = 'SUBMISSION.VIEW';
delete from public.permissions where code = 'SUBMISSION.VIEW';
delete from public.intake_channels where code in ('AICTE_SIM', 'CPGRAMS_SIM');
commit;
```

**Do not run the rollback block automatically.** It is destructive to Phase 2.1 data and was not part of the applied migration.

## 11. Known limitations and review items

1. **D15 — no durable read audit.** Complaint-body access is explicitly authorized and logged by the API, but the 32-table model has no audit table. Do not claim audit compliance. This remains open, together with F8.
2. **Original-text guarantee is privilege-based.** `postgres`, `service_role`, superusers and future migrations can still update rows; there is no immutability trigger. The guarantee is that no API or Data API path can rewrite a preserved submission.
3. **Rate limiting is process-local.** It resets on restart and is not shared across workers.
4. **No institution verification, alias matching, duplicate matching or case creation.** The status values stop at `awaiting_institution_verification` / `awaiting_duplicate_review`.
5. **No categories seeded.** Category-specific SLA data therefore cannot be exercised yet.
6. **No attachments.** The public portals accept text only.
7. **No submitters.** The public path stores no identity, IP address or user agent; `submitter_reference` stays null by design.
8. **`SUBMISSION.VIEW` is Super-Admin-only.** The PRD's fuller role matrix and delegation are not approved yet. Changing that grant is a product decision.
9. **Not a real portal.** The reference prefix `SIM-`, the `is_simulated` columns and the interface notices are the only acknowledgement. No external acknowledgement exists.

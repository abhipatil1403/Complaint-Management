# AICTE OneDesk

AICTE institution complaint monitoring and status dashboard — **Phase 2.1: simulated complaint intake and submission preservation** (on top of Phase 1 identity, authorization and reference data).

> **Demonstrator only.** Every seeded bureau, region, institution and person is illustrative. This is not an official AICTE service, no real complaint is filed or tracked, and no data is sent to AICTE, CPGRAMS or any external system.

## What is implemented

| Area | Implemented |
| --- | --- |
| Identity | Supabase Auth is the only identity system; no parallel password store |
| Profiles | `public.users` linked to the Auth identity, with account status and no hard deletion |
| Authorization | 14 Phase 1 capabilities plus `submission.view`; 6 persona roles; global and bureau-scoped grants |
| Enforcement | FastAPI dependency checks **and** PostgreSQL row level security |
| Reference data | Regions, institutions, institution aliases, bureaus and bureau memberships |
| Administration | User profiles, account status, role grants and revocations |
| Simulated intake | Public AICTE and CPGRAMS demo portals, preserved submissions, idempotent replay/conflict handling |
| Intake review | `submission.view` list and detail screens; complaint bodies omitted from lists |
| Interface | React + TypeScript + Vite, bureau-context switcher, capability-aware navigation |
| Tests | `pytest` authorization/RLS/intake suites and `vitest` helper/client tests |

Phase 2.2 and later (institution verification, duplicate review, canonical cases, assignments, notes, SLA, analytics, notifications, attachments) are intentionally **not** implemented.

## Repository layout

```
backend/            FastAPI service (Python 3.11+)
  app/auth/         token verification, principal resolution, permission catalogue
  app/api/v1/       versioned API routes
  app/repositories/ SQL access
  tests/            security, authorization, endpoint, pagination and RLS tests
frontend/           React + TypeScript + Vite application
  src/auth/         session/profile/bureau-context state machine
  src/pages/        Phase 1 screens
  src/styles/       hand-written CSS with design tokens
docs/               PRD, database designs, API notes and this phase's implementation report
supabase/
  migrations/       additive RLS, helper-function and grant migration
  seed/             illustrative permissions, roles, regions, bureaus and institutions
scripts/            idempotent demo identity provisioning
```

## Prerequisites

- Python 3.11+ (tested with 3.13)
- Node.js 22+ and npm
- A Supabase project with the documented 32-table schema applied
- Access to the project's `postgres` connection string for migrations and tests

## Setup

### 1. Database migration and reference seed

The migrations are **additive**: they create helper functions, grants, roles and RLS policies. They do not create, rename, drop or alter any of the 32 application tables, and they add no columns.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_phase1_identity_rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed/phase1_identity_seed.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0002_phase1_security_closure.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0003_phase2_intake.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed/phase2_intake_seed.sql
```

Every file is wrapped in a transaction and is safe to re-run. Review them and obtain approval before applying to any shared environment. Never run destructive SQL automatically. Do **not** use `supabase db reset` against a linked remote project; it is destructive. See [`docs/PHASE1_VERIFICATION.md`](docs/PHASE1_VERIFICATION.md) and [`docs/PHASE2_INTAKE.md`](docs/PHASE2_INTAKE.md) for the safe apply and verification procedure.

Phase 2.1 creates one NOLOGIN role, `one_desk_intake`. Apply the migration as `postgres` so the `grant one_desk_intake to postgres` statement succeeds; the API then uses `SET LOCAL ROLE one_desk_intake` only for the insert-only intake function.

### 2. Backend

```bash
cd backend
python -m venv .venv
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
# macOS/Linux:        source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env        # then fill in local values
uvicorn app.main:app --reload --port 8000
```

Useful endpoints:

- `GET http://127.0.0.1:8000/api/v1/health/live`
- `GET http://127.0.0.1:8000/api/v1/health/ready`
- `GET http://127.0.0.1:8000/docs` (disabled when `APP_ENV=production`)

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local  # then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

The browser bundle only ever receives the Supabase URL, the **anon** key and the API base URL. Never place a service-role key, database URL or JWT secret in `VITE_*` variables.

### 4. Demo identities

Demo accounts are optional and are created through the Supabase Auth admin API. They are idempotent and require explicit opt-in:

```bash
# From the repository root, with backend dependencies installed
export ALLOW_DEMO_SEED=true
export DEMO_PASSWORD='use-a-long-demo-only-password'
export SUPABASE_URL='https://<project-ref>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='<server-side only>'
export DATABASE_URL='postgresql://...'
python scripts/seed_demo_users.py
```

PowerShell equivalent: `$env:ALLOW_DEMO_SEED = "true"`, etc.

The default email pattern is `demo.<persona>@demo.invalid`:

| Persona | Email | Role | Bureau |
| --- | --- | --- | --- |
| Super Admin | `demo.super.admin@demo.invalid` | `SUPER_ADMIN` (global) | — |
| Bureau Administrator | `demo.rb.admin@demo.invalid` | `BUREAU_ADMIN` | RB |
| Case Officer | `demo.pgrc.officer@demo.invalid` | `CASE_OFFICER` | PGRC |
| Cross-bureau collaborator | `demo.collaborator@demo.invalid` | `CROSS_BUREAU_COLLABORATOR` | RB |
| Senior Management | `demo.senior@demo.invalid` | `SENIOR_MANAGEMENT` (global) | — |
| Auditor | `demo.auditor@demo.invalid` | `AUDITOR` (global) | — |
| Inactive account | `demo.inactive@demo.invalid` | none | — |

The inactive account is deliberate: a valid Supabase session without an active profile is still refused.

## Configuration

### Backend

See [`backend/.env.example`](backend/.env.example).

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Project URL; JWKS and issuer are derived from it |
| `SUPABASE_JWT_SECRET` | Optional legacy HS256 secret; prefer JWKS |
| `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER` | Optional explicit overrides |
| `SUPABASE_JWT_AUDIENCE` | Expected audience (default `authenticated`) |
| `DATABASE_URL` | Server-side PostgreSQL connection string |
| `DB_RLS_ROLE` | Session role used for RLS (default `authenticated`) |
| `CORS_ORIGINS` | Comma-separated browser origins |
| `DEMO_MODE`, `DEMO_BANNER_TEXT` | Demo notice returned by `/me` and `/demo/info` |

### Frontend

See [`frontend/.env.example`](frontend/.env.example).

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Public anon key (safe for the browser) |
| `VITE_API_BASE_URL` | API base, default `http://127.0.0.1:8000/api/v1` |

## API surface

All routes are under `/api/v1`; all except health/demo require a Supabase bearer token.

| Method and path | Capability |
| --- | --- |
| `GET /health/live`, `GET /health/ready`, `GET /demo/info` | public |
| `POST /demo/intake/{channel_code}/submissions` | public (simulated portals only) |
| `GET /submissions`, `GET /submissions/{id}` | global `submission.view` |
| `GET /me`, `GET /me/permissions`, `POST /me/active-bureau` | authenticated |
| `GET /regions` | `region.view` |
| `POST /regions`, `PATCH /regions/{id}` | global `region.manage` |
| `GET /institutions`, `GET /institutions/{id}` | `institution.view` |
| `POST /institutions`, `PATCH /institutions/{id}` | global `institution.manage` |
| `GET /institution-aliases` | `institution.alias.view` |
| `POST /institutions/{id}/aliases` | global `institution.alias.manage` |
| `GET /bureaus`, `GET /bureaus/{id}` | `bureau.view` |
| `POST /bureaus`, `PATCH /bureaus/{id}` | global `bureau.manage` |
| `GET /bureaus/{id}/members` | `bureau.members.view` (bureau capability) |
| `POST /bureau-memberships`, `POST /bureau-memberships/{id}/end` | global `bureau.members.manage` |
| `GET /users`, `GET /users/{id}` | global `user.view` |
| `PATCH /users/{id}`, `POST /users/{id}/account-status` | global `user.manage` |
| `GET /roles` | global `role.view` |
| `POST /users/{id}/role-assignments`, `POST /role-assignments/{id}/revoke` | global `user.manage` |

Errors use a stable envelope: `{"error": {"code", "message", "details", "request_id"}}`.

## Tests and checks

```bash
# Backend unit/authorization tests (no database required)
cd backend
python -m pytest -q

# RLS tests against a real Supabase database
# (reads TEST_DATABASE_URL / DATABASE_URL, or backend/.env)
python -m pytest -q tests/test_rls_db.py

# Frontend
cd frontend
npm run typecheck
npm test
npm run build
npm audit
```

The RLS suite skips when no connection string is found, so a green local run does not prove database enforcement. The suite reads `TEST_DATABASE_URL`, then `DATABASE_URL`, then `DATABASE_URL` from `backend/.env`; never put that value in a `VITE_*` variable or commit it. Apply the migration and run the RLS suite against a dedicated test project before trusting RLS in a shared environment.

## Security posture

- Supabase Auth tokens are verified for signature, issuer, audience and expiry; service-role tokens are rejected.
- Every authenticated request runs as PostgreSQL `authenticated` with `request.jwt.claims` set, so RLS applies to the caller.
- The API validates `X-Active-Bureau` as an active membership and publishes it as the `active_bureau_id` claim. PostgreSQL applies bureau-scoped grants only for that bureau.
- Administration endpoints require a **global** capability; a bureau-scoped grant never enables user or role administration. The nine reference and bureau-membership write endpoints return `403 GLOBAL_CAPABILITY_REQUIRED` for a caller without the global grant, matching the RLS policy.
- The capability catalogue (`role_permissions`) is read-only through the Data API; `authenticated` holds `SELECT` only. A last-administrator guard in PostgreSQL refuses any change that would leave no active, non-expiring global `USER.MANAGE` holder.
- `anon` holds no table privilege in `public`; `authenticated` holds no `TRUNCATE`/`REFERENCES`/`TRIGGER` on any table, and Phase 2.1 revokes PostgreSQL 17's `MAINTAIN` on `submissions` and `intake_channels`.
- Intake writes have exactly one path: `public.create_demo_submission` is `SECURITY DEFINER` with `search_path = ''`, owned by `postgres`, and executable only by the NOLOGIN `one_desk_intake` role. An explicit allowlist also requires `current_setting('role') = 'one_desk_intake'`, so an accidental future `EXECUTE` grant still cannot create a submission.
- `authenticated` holds `SELECT` only on `submissions` and `intake_channels`; there is no Data API path to overwrite, delete or truncate a preserved submission.
- Complaint text requires the global `submission.view` capability in FastAPI and in RLS; list responses never include the body.
- `users.is_super_admin` is ignored for authorization. Super Admin is derived from a global `SUPER_ADMIN` role and is not a case-content bypass.
- The frontend hides unavailable controls for usability only; it is not a security boundary.
- Accounts and reference data are deactivated, never hard-deleted.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — product requirements (source of truth)
- [`docs/PHASE1_IMPLEMENTATION.md`](docs/PHASE1_IMPLEMENTATION.md) — Phase 1 implementation report, permission catalogue, RLS design and known gaps
- [`docs/PHASE2_INTAKE.md`](docs/PHASE2_INTAKE.md) — Phase 2.1 simulated intake design, security model, idempotency semantics and limitations
- [`docs/CURRENT_SUPABASE_SCHEMA.sql`](docs/CURRENT_SUPABASE_SCHEMA.sql) — physical schema snapshot
- [`docs/Master_Database.md`](docs/Master_Database.md), [`docs/Database_plan.md`](docs/Database_plan.md) — logical database designs
- [`docs/Api_document.md`](docs/Api_document.md) — API conventions and error envelope

## Known limitations

- Live database and RLS tests require a connection string; when it is missing the RLS suite skips rather than fails. With credentials configured, the full backend suite is `196 passed, 0 failed` (42 of them live database tests) and the frontend suite is `28 passed`.
- The formal role/action matrix and state machines are still marked **baseline** in the PRD and need sign-off.
- There is no general audit table in the 32-table model. Grants record `assigned_by_user_id`, but revocations have no `revoked_by_user_id` column: revocation attribution is log-only and must not be presented as a durable audit trail. This carries the F8 identifier in `docs/PHASE1_VERIFICATION.md`. Phase 2.1 reads of complaint bodies are authorized explicitly, but durable read auditing is **not** implemented (D15 in `docs/PHASE2_INTAKE.md`).
- The Phase 2.1 demo rate limit is process-local. A multi-process deployment needs a shared store such as Redis.
- Phase 2.1 does not verify institutions, detect or merge duplicates, create cases, assign officers, start SLA timers, send notifications or store attachments. Unknown institution IDs and free-text names remain unresolved.
- The original-text guarantee is privilege-based: `postgres`, `service_role`, superusers and future migrations can still modify rows. No trigger prevents an owner-level rewrite.
- Some Phase 1 tables (`cases`, `complaint_categories`, `duplicate_candidates`, `institution_verification_tasks`, `case_relationships`) still carry PostgreSQL 17's `MAINTAIN` privilege for `authenticated` from the original schema grants. Phase 2.1 removed it only from the two intake tables and did not change unrelated grants; closing this needs an approved follow-up migration.
- Bureau Admin membership management is not delegated because the PRD does not define that delegation. It remains read-only for bureau administrators.
- Phase 1 has no create-user endpoint. Identities are provisioned through Supabase Auth out of band, then linked to a profile.

# AICTE OneDesk

AICTE institution complaint monitoring and status dashboard — **Phase 1: identity, authorization and reference data**.

> **Demonstrator only.** Every seeded bureau, region, institution and person is illustrative. This is not an official AICTE service, no real complaint is filed or tracked, and no data is sent to CPGRAMS or any external system.

## What Phase 1 delivers

| Area | Implemented |
| --- | --- |
| Identity | Supabase Auth is the only identity system; no parallel password store |
| Profiles | `public.users` linked to the Auth identity, with account status and no hard deletion |
| Authorization | 14 Phase 1 capabilities, 6 persona roles, global and bureau-scoped grants |
| Enforcement | FastAPI dependency checks **and** PostgreSQL row level security |
| Reference data | Regions, institutions, institution aliases, bureaus and bureau memberships |
| Administration | User profiles, account status, role grants and revocations |
| Interface | React + TypeScript + Vite, bureau-context switcher, capability-aware navigation |
| Tests | `pytest` authorization/RLS suites and `vitest` helper/client tests |

Phase 2 and later (intake, canonical cases, duplicate review, assignments, notes, SLA, analytics) are intentionally **not** implemented.

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

The migration is **additive**: it creates helper functions, grants and RLS policies. It does not create, rename, drop or alter any of the 32 application tables, and it adds no columns.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_phase1_identity_rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed/phase1_identity_seed.sql
```

`0001_phase1_identity_rls.sql` is wrapped in a transaction. Review it and obtain approval before applying it to any shared environment. Never run destructive SQL automatically. Do **not** use `supabase db reset` against a linked remote project; it is destructive. See [`docs/PHASE1_VERIFICATION.md`](docs/PHASE1_VERIFICATION.md) for the safe apply and rollback procedure.

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
| `GET /me`, `GET /me/permissions`, `POST /me/active-bureau` | authenticated |
| `GET /regions` | `region.view` |
| `POST /regions`, `PATCH /regions/{id}` | `region.manage` |
| `GET /institutions`, `GET /institutions/{id}` | `institution.view` |
| `POST /institutions`, `PATCH /institutions/{id}` | `institution.manage` |
| `GET /institution-aliases` | `institution.alias.view` |
| `POST /institutions/{id}/aliases` | `institution.alias.manage` |
| `GET /bureaus`, `GET /bureaus/{id}` | `bureau.view` |
| `POST /bureaus`, `PATCH /bureaus/{id}` | `bureau.manage` |
| `GET /bureaus/{id}/members` | `bureau.members.view` (bureau capability) |
| `POST /bureau-memberships`, `POST /bureau-memberships/{id}/end` | `bureau.members.manage` (bureau capability) |
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
- Administration endpoints require a **global** capability; a bureau-scoped grant never enables user or role administration.
- `users.is_super_admin` is ignored for authorization. Super Admin is derived from a global `SUPER_ADMIN` role and is not a case-content bypass.
- The frontend hides unavailable controls for usability only; it is not a security boundary.
- Accounts and reference data are deactivated, never hard-deleted.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — product requirements (source of truth)
- [`docs/PHASE1_IMPLEMENTATION.md`](docs/PHASE1_IMPLEMENTATION.md) — this phase's implementation report, permission catalogue, RLS design and known gaps
- [`docs/CURRENT_SUPABASE_SCHEMA.sql`](docs/CURRENT_SUPABASE_SCHEMA.sql) — physical schema snapshot
- [`docs/Master_Database.md`](docs/Master_Database.md), [`docs/Database_plan.md`](docs/Database_plan.md) — logical database designs
- [`docs/Api_document.md`](docs/Api_document.md) — API conventions and error envelope

## Known limitations

- Live database and RLS test execution require credentials that were not available during implementation; see the implementation report.
- The formal role/action matrix and state machines are still marked **baseline** in the PRD and need sign-off.
- There is no general audit table in the 32-table model. Role-grant and revocation events use attribution columns plus structured logs; they are not queryable as an audit trail.
- Bureau Admin membership management is not delegated because the PRD does not define that delegation. It remains read-only for bureau administrators.
- Phase 1 has no create-user endpoint. Identities are provisioned through Supabase Auth out of band, then linked to a profile.

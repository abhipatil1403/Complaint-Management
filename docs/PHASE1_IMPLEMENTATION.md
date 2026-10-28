# Phase 1 Implementation Report

**Project:** AICTE OneDesk — AICTE institution complaint monitoring and status dashboard  
**Phase:** 1 — identity, authorization and reference data (PRD §30)  
**Date:** 28 October 2026  
**Status:** Implementation complete for the approved Phase 1 scope; live database verification pending credentials  
**Demonstrator notice:** all seeded names, bureaus, regions and institutions are illustrative. This is not an official AICTE service.

---

## 1. Scope and approvals

The implementation followed the source-of-truth hierarchy in `docs/PRD.md` §0.1:

1. `docs/PRD.md` (product behaviour)
2. `docs/MASTER_DATABASE_DESIGN.md` / `docs/Master_Database.md` (intended data model)
3. `docs/CURRENT_SUPABASE_SCHEMA.sql` (physical schema)

The approved Phase 1 plan covered:

- Supabase Auth integration.
- Users, roles, permissions, bureaus and memberships.
- Institutions, aliases and regions.
- RLS policies and RLS tests **before** any sensitive case data exists.

The user approved the additive RLS/grants migration before it was written. No application table was created, renamed, dropped or altered, and no columns were added. The physical model remains the documented **32-table** model.

---

## 2. What was delivered

| PRD §30 Phase 1 item | Delivered | Evidence |
| --- | --- | --- |
| Supabase Auth integration | Yes | `backend/app/core/security.py`, `backend/app/auth/service.py`, `frontend/src/auth/AuthProvider.tsx` |
| Users | Yes | profile resolution, admin list/detail/profile update/account status |
| Roles and permissions | Yes | 14 permissions, 6 persona roles, grant/revoke API, role catalogue screen |
| Bureaus and memberships | Yes | bureau CRUD, membership add/end, active-context switcher |
| Institutions | Yes | search, detail, create, update, verification evidence rules |
| Institution aliases | Yes | search and create with provenance |
| Regions | Yes | list, create, update/deactivate |
| RLS tests before sensitive data | Partly | `backend/tests/test_rls_db.py` written; **skipped without `DATABASE_URL`** |

### Not in Phase 1

Intake, submissions, canonical cases, verification tasks, duplicate review, case assignments, notes, attachments, SLA policies, escalation, analytics, exports and integrations are intentionally absent. No placeholder tables were created.

---

## 3. Architecture and trust boundaries

```
Browser (React/Vite)
  ├─ Supabase JS: sign-in, session refresh, access token
  └─ FastAPI: Authorization: Bearer <token>, X-Active-Bureau: <uuid?>
                     │
                     ▼
FastAPI (server-side secrets only)
  ├─ verifies JWT signature / issuer / audience / expiry
  ├─ resolves public.users + active roles + memberships
  ├─ validates X-Active-Bureau as an active membership
  ├─ publishes request.jwt.claims (including active_bureau_id)
  └─ opens a transaction as PostgreSQL role "authenticated"
                     │
                     ▼
PostgreSQL + RLS
  └─ every policy re-evaluates the claims; the API is not trusted blindly
```

Key properties:

- The browser never receives `DATABASE_URL`, a service-role key or a JWT secret.
- The API enforces capability checks **and** PostgreSQL RLS enforces row visibility. Frontend gating is usability only.
- Every authenticated request runs under `SET LOCAL ROLE authenticated` with claims set via `set_config('request.jwt.claims', ...)`.
- Administration requires a **global** capability (`require_global_permission`), so a bureau-scoped grant cannot escalate to user/role administration.

---

## 4. Identity model

- `public.users.id` **is** the Supabase Auth user id. The physical foreign key `users_auth_fk` enforces this.
- There is no separate password store, invitation table or self-registration.
- `users.account_status` (`active`, `inactive`, `suspended`) is checked on every request; inactive and suspended accounts are refused with `ACCOUNT_INACTIVE`.
- Accounts are deactivated, never deleted.
- `users.is_super_admin` exists in the physical schema but is **ignored for authorization**. Super Admin is derived from an active, global `SUPER_ADMIN` role grant. This avoids a denormalised flag becoming a hidden privilege path.
- Super Admin is **not** a case-content bypass. Phase 1 policies grant only the Phase 1 capabilities that exist.

---

## 5. Permission catalogue

Database codes are UPPERCASE because the physical schema enforces `code = upper(btrim(code))`. The API and frontend use lowercase dotted codes. `backend/app/auth/permissions.py` is the API source of truth; `backend/tests/test_seed_consistency.py` asserts the seed matches it.

| API code | Database code | Meaning |
| --- | --- | --- |
| `region.view` | `REGION.VIEW` | View regions |
| `region.manage` | `REGION.MANAGE` | Create/update/deactivate regions |
| `institution.view` | `INSTITUTION.VIEW` | View and search institutions |
| `institution.manage` | `INSTITUTION.MANAGE` | Create/update institutions and record verification |
| `institution.alias.view` | `INSTITUTION.ALIAS.VIEW` | View institution aliases |
| `institution.alias.manage` | `INSTITUTION.ALIAS.MANAGE` | Add aliases with provenance |
| `bureau.view` | `BUREAU.VIEW` | View bureau reference data |
| `bureau.manage` | `BUREAU.MANAGE` | Create/update bureaus |
| `bureau.members.view` | `BUREAU.MEMBERS.VIEW` | View members of a bureau |
| `bureau.members.manage` | `BUREAU.MEMBERS.MANAGE` | Add/end bureau memberships |
| `user.view` | `USER.VIEW` | View authorized users and role grants |
| `user.manage` | `USER.MANAGE` | Update users, account status, grant/revoke roles |
| `role.view` | `ROLE.VIEW` | View the role catalogue |
| `role.manage` | `ROLE.MANAGE` | Change role definitions and role-permission mappings |

---

## 6. Roles and grants

Two grant scopes exist:

- **Global** (`bureau_id IS NULL`) — applies everywhere.
- **Bureau** (`bureau_id` set) — applies only while that bureau is the caller's validated active context.

| Role | Scope | Phase 1 capabilities |
| --- | --- | --- |
| `SUPER_ADMIN` | global | all 14 |
| `BUREAU_ADMIN` | bureau | region.view, institution.view, institution.alias.view, bureau.view, bureau.members.view |
| `CASE_OFFICER` | bureau | region.view, institution.view, institution.alias.view, bureau.view, bureau.members.view |
| `CROSS_BUREAU_COLLABORATOR` | bureau | region.view, institution.view, institution.alias.view, bureau.view, bureau.members.view |
| `SENIOR_MANAGEMENT` | global | region.view, institution.view, institution.alias.view, bureau.view |
| `AUDITOR` | global | region.view, institution.view, institution.alias.view, bureau.view |

### Baseline matrix caveats

PRD §7.3 is explicitly marked **baseline** and has not been signed off as an implementation contract. The catalogue above is deliberately conservative:

- **No role except Super Admin** receives `*.manage` capabilities in Phase 1. The matrix says “scoped” or “only if delegated”; no delegation model is defined yet.
- **Bureau Admin does not receive `user.view` or bureau-membership management.** The PRD says “Scoped only if delegated” and does not define the delegation mechanism. This is recorded as a limitation rather than invented.
- **Auditor is read-only** and gets no administration capability.
- Role grants are checked for `assignment_status = 'active'`, `expires_at`, role active state, bureau membership and active user in both FastAPI and SQL.

This catalogue needs formal product sign-off before Phase 2 adds case capabilities.

---

## 7. Bureau context

- The UI sends `X-Active-Bureau: <uuid>` only when a bureau is selected.
- FastAPI validates the value against the caller's **active** memberships. An invalid or ended membership returns `BUREAU_CONTEXT_DENIED`; the frontend clears the stored selection.
- The validated value is republished to PostgreSQL as the `active_bureau_id` JWT claim.
- `has_permission(code)` in SQL:
  - accepts a global grant, or
  - accepts a bureau grant only when `ura.bureau_id = active_bureau_id()`, the bureau is active, the membership is active and unexpired, and the user is active.
- Direct PostgREST access cannot set `active_bureau_id`; it therefore receives only global grants (fail closed).
- Every write policy uses `has_global_permission(...)`, so no bureau-scoped role can write reference/identity data even if the catalogue changes later.

---

## 8. PostgreSQL RLS and grants

Migration: `supabase/migrations/0001_phase1_identity_rls.sql` (single transaction, additive only).

### Helper functions

| Function | Purpose |
| --- | --- |
| `jwt_claims()` | Parses `request.jwt.claims` defensively |
| `jwt_uuid_claim(name)` | Returns a UUID claim only if it matches a UUID pattern |
| `auth_uid()` | Current `sub` claim |
| `active_bureau_id()` | Validated active bureau claim |
| `is_active_user()` | Active profile check |
| `has_global_permission(code)` | Global grant check |
| `has_permission(code)` | Global grant or active-context bureau grant |
| `is_bureau_member(bureau_id)` | Active membership check |
| `shares_bureau_with(user_id)` | Shared active bureau check (reserved for Phase 2+) |

All helpers are `SECURITY DEFINER` where they read identity tables, with `search_path = ''` and schema-qualified identifiers. Execute is revoked from `PUBLIC` and `anon`; granted to `authenticated` and `service_role`.

### Policies (30)

| Table | Policies | Read rule | Write rule |
| --- | --- | --- | --- |
| `users` | 2 | self, global `USER.VIEW` / `USER.MANAGE` | global `USER.MANAGE` only |
| `roles` | 3 | any active user | global `ROLE.MANAGE` |
| `permissions` | 3 | any active user | global `ROLE.MANAGE` |
| `role_permissions` | 4 | any active user | global `ROLE.MANAGE` |
| `user_role_assignments` | 3 | self, `USER.VIEW`, `USER.MANAGE` | global `USER.MANAGE` |
| `regions` | 3 | `REGION.VIEW` / `REGION.MANAGE` | global `REGION.MANAGE` |
| `institutions` | 3 | `INSTITUTION.VIEW` / `INSTITUTION.MANAGE` | global `INSTITUTION.MANAGE` |
| `institution_aliases` | 3 | `INSTITUTION.ALIAS.VIEW` / `.MANAGE` | global `INSTITUTION.ALIAS.MANAGE` |
| `bureaus` | 3 | any active user (needed to render memberships) | global `BUREAU.MANAGE` |
| `bureau_memberships` | 3 | self; global members/manage; or members of the active bureau | global `BUREAU.MEMBERS.MANAGE` |

All ten tables had RLS enabled already but **zero policies**. The migration adds policies and least-privilege grants:

- `anon` loses all table and helper access.
- `authenticated` receives only `select/insert/update` (plus `delete` on `role_permissions` for catalogue maintenance). There is no `delete` grant on business/reference tables, so deactivation remains the only removal path.
- There is deliberately **no self-update policy on `users`**. Profile administration is a global `USER.MANAGE` capability; without this restriction a signed-in user could write `is_super_admin` or `account_status` through the exposed PostgREST API. No self-service profile-edit endpoint exists in Phase 1, so no product behaviour is lost.
- `USER.VIEW` / `USER.MANAGE` checks in policies use `has_global_permission`, matching the API's `require_global_permission`; a bureau-scoped grant can never read the user directory.
- RLS is not disabled and no table ownership is changed.

---

## 9. API endpoints

All routes are under `/api/v1`. Errors use `{"error": {"code", "message", "details", "request_id"}}`.

| Method | Path | Capability |
| --- | --- | --- |
| GET | `/health/live`, `/health/ready`, `/demo/info` | public |
| GET | `/me` | authenticated |
| GET | `/me/permissions` | authenticated |
| POST | `/me/active-bureau` | authenticated, active membership |
| GET | `/regions` | `region.view` |
| POST | `/regions` | `region.manage` |
| PATCH | `/regions/{id}` | `region.manage` |
| GET | `/institutions` | `institution.view` |
| GET | `/institutions/{id}` | `institution.view` |
| POST | `/institutions` | `institution.manage` |
| PATCH | `/institutions/{id}` | `institution.manage` |
| GET | `/institution-aliases` | `institution.alias.view` |
| POST | `/institutions/{id}/aliases` | `institution.alias.manage` |
| GET | `/bureaus` | `bureau.view` |
| GET | `/bureaus/{id}` | `bureau.view` |
| POST | `/bureaus` | `bureau.manage` |
| PATCH | `/bureaus/{id}` | `bureau.manage` |
| GET | `/bureaus/{id}/members` | `bureau.members.view` in that bureau |
| POST | `/bureau-memberships` | `bureau.members.manage` in that bureau |
| POST | `/bureau-memberships/{id}/end` | `bureau.members.manage` in that bureau |
| GET | `/users`, `/users/{id}` | global `user.view` |
| PATCH | `/users/{id}` | global `user.manage` |
| POST | `/users/{id}/account-status` | global `user.manage` |
| GET | `/roles` | global `role.view` |
| POST | `/users/{id}/role-assignments` | global `user.manage` |
| POST | `/role-assignments/{id}/revoke` | global `user.manage` |

Additional safeguards:

- Role grants require an active target user; bureau roles require an active membership of that bureau; global roles reject a `bureau_id`.
- The last active Super Admin cannot revoke their own global role.
- An administrator cannot deactivate or suspend their own account.
- Institution verification requires an AICTE Permanent ID and a non-blank verification source, and only these transitions are accepted: `pending → verified`, `pending → rejected`, `verified → verified`, `rejected → rejected`.
- Aliases with non-manual provenance require a source reference.
- Reference data has no DELETE route; `DELETE /regions/{id}` returns 405.

---

## 10. Frontend

### Routes

| Route | Screen |
| --- | --- |
| `/sign-in` | Supabase Auth sign-in |
| `/` | Identity, roles, bureau context, capability overview |
| `/institutions`, `/institutions/:id` | Search/list, detail, edit, verification, aliases |
| `/bureaus`, `/bureaus/:id` | List/create, detail/edit, memberships |
| `/regions` | List/create/deactivate |
| `/administration` | Users tab and role catalogue tab |
| `/administration/users/:id` | Profile, account status, role grants, memberships |

### UI system decision

The interface uses **hand-written CSS with design tokens** (`frontend/src/styles/tokens.css`, `app.css`) and no component framework. Reasons:

- No additional runtime dependency or design-system licence.
- The small Phase 1 surface does not justify a framework.
- Tokens keep colour, spacing, radius, focus and typography consistent and make a later migration to a design system mechanical.

The layout is responsive; tables scroll horizontally; forms use native controls with visible focus rings; status is never communicated by colour alone (text badges are always present).

### State machine

`AuthProvider` handles: `loading → signed_out → no_profile | error | ready`. It:

- restores the Supabase session,
- loads `/me` with the stored bureau context,
- clears an invalid stored bureau and retries without context,
- signs out on a 401,
- reloads capabilities when the bureau context changes.

The browser treats the API's permission list as display state only.

---

## 11. Database changes

### Migration

`supabase/migrations/0001_phase1_identity_rls.sql`

- 9 helper functions.
- 30 RLS policies on 10 tables.
- Table/function grants and `anon` revokes.
- No `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE` or column additions.
- Wrapped in `BEGIN … COMMIT`.

### Seed

`supabase/seed/phase1_identity_seed.sql` (idempotent, illustrative):

| Entity | Rows |
| --- | --- |
| Permissions | 14 |
| Roles | 6 |
| Role-permission mappings | 37 |
| Regions | 6 |
| Bureaus | 3 (`RB`, `PGRC`, `AFF`) |
| Institutions | 5 (`DEMO-AICTE-0001` … `0005`) |
| Institution aliases | 3 |

The seed ends with count assertions so an incomplete catalogue fails loudly. Institution names and IDs are prefixed `Demo`/`DEMO-`; none are real AICTE records.

### Demo identities

`scripts/seed_demo_users.py` creates Auth users through the Supabase admin API, then upserts profiles, memberships and role grants. It refuses to run unless `ALLOW_DEMO_SEED=true` and `DEMO_PASSWORD` is at least 12 characters. It is idempotent.

### Not executed in this environment

The migration and seed were **not applied to a live project** because no database or Supabase credentials were supplied. No destructive SQL was executed. See §14.

---

## 12. Tests and results

### Backend

Command: `python -m pytest -o addopts= -q` from `backend/`

Result: **119 passed, 14 skipped, 13 warnings in 3.79s**

The 14 skips are the live RLS suite (`tests/test_rls_db.py`), which requires `DATABASE_URL`. The warnings are `InsecureKeyLengthWarning` from short HMAC keys generated inside the security tests; they are test fixtures, not deployed secrets.

Coverage areas:

- `test_security.py` — signature, expiry, audience, issuer, service-role token rejection, fail-closed configuration.
- `test_authorization.py` — persona capabilities, bureau scoping, global-only administration, context denial.
- `test_endpoints.py` — route contracts, validation, state transitions, self-deactivation and last-Super-Admin guards.
- `test_pagination.py` — cursor encoding/limits.
- `test_seed_consistency.py` — permission/role catalogue parity between Python and SQL seed.
- `test_rls_db.py` — live database assertions (skipped locally): anon denial, self-only profile and role visibility, helper parity with the caller's grants, bureau grants requiring their own active context and not leaking into another bureau, users unable to self-escalate privileged profile columns or edit another profile, ordinary users unable to write reference data or grant roles, Super Admin reference management and profile visibility. Every test uses `force_rollback=True`.

### Frontend

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm test` | 19 passed in 2 files |
| `npm run build` | pass (Vite 8.3.5) |
| `npm audit` | 0 vulnerabilities |

Frontend tests cover permission helpers, bureau-selection normalisation, permission grouping, API error-envelope mapping, bearer/bureau headers, transport failure and 204 handling.

### Dependency note

The initial scaffold used Vite 5 / Vitest 2 / React Router 6, which produced 8 audit findings (including critical test-tooling issues and a React Router open-redirect advisory). The project was upgraded to Vite 8.3.5, Vitest 5.0.5, React Router 7.18.5 and jsdom 29.1.1; all checks pass and `npm audit` reports zero vulnerabilities. No application architecture changed.

---

## 13. Configuration and runbook

See `README.md` for full setup. Summary:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_phase1_identity_rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed/phase1_identity_seed.sql

cd backend
pip install -r requirements.txt -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

cd frontend
npm install
npm run dev
```

Environment templates: `backend/.env.example`, `frontend/.env.example`.

Minimum live verification sequence:

1. Apply migration and seed to a dedicated project.
2. Run `python -m pytest -q tests/test_rls_db.py` with `DATABASE_URL` (must not skip).
3. Seed demo users and sign in as each persona.
4. Confirm a bureau officer cannot read another bureau's membership rows.
5. Confirm a Bureau Admin receives `GLOBAL_CAPABILITY_REQUIRED` from `/users`.
6. Confirm the inactive persona receives `ACCOUNT_INACTIVE`.

---

## 14. Security review notes

- **Token verification:** JWKS by default; issuer/audience/expiry checked; `service_role` tokens rejected; no "decode without verify" path.
- **RLS:** every Phase 1 table has policies; `anon` has no access; writes require global capabilities.
- **Scope confusion:** `has_global_permission` requires `roles.scope_type = 'global'` as well as `bureau_id IS NULL`, and the API's `RoleAssignment.is_global` applies the same rule. This is defence in depth on top of the existing `validate_user_role_assignment` trigger, which already rejects a bureau role with no bureau.
- **No self-service profile writes:** the `users` table has no self-update policy, so a signed-in user cannot write `is_super_admin`, `account_status` or another profile through PostgREST. Admin profile changes require global `USER.MANAGE`.
- **Least privilege:** no DELETE grants on business tables; reference data deactivates.
- **Header handling:** `X-Active-Bureau` is validated server-side, never trusted as an authorization claim on its own.
- **Error handling:** stable error envelope; no SQL text, connection strings or token contents returned to the client.
- **CORS:** explicit origin list; authorization and bureau headers allowed; credentials disabled.
- **Logging:** sensitive values are not logged. Role grant/revoke events log actor, target, role and bureau, but the revocation reason is deliberately not written to logs.
- **Secrets:** only example values are committed. `.env`, `.env.*`, dumps and local Supabase state are ignored.

### Known audit gap

The 32-table model has no general audit table. Role grants record `assigned_by_user_id`, `assigned_at`, `revoked_at` and `revocation_reason`, but there is **no `revoked_by_user_id` column**. Revocation attribution is therefore only in structured logs. Fixing this properly requires an approved schema change or an audit table, neither of which Phase 1 permits.

---

## 15. Discrepancies and decisions

| Observation | Sources | Decision |
| --- | --- | --- |
| `users.id` is the Auth identity; some design text refers to a separate `auth_user_id` | Master design vs physical schema | Treat `users.id` as the identity, enforced by `users_auth_fk`. No column added. |
| `users.is_super_admin` exists physically but not in the logical design | Physical schema vs master design | Ignore it for authorization; derive Super Admin from the global `SUPER_ADMIN` role. |
| Permission codes are UPPERCASE in the database but dotted/lowercase in API documentation | Schema check `permissions_code_format` vs `docs/Api_document.md` | Store UPPERCASE, expose lowercase dotted codes, document the mapping. |
| `Database_plan.md` describes 34–35 tables; the physical schema has 32 | Logical plan vs physical schema | Use the 32-table physical model; create no extra tables. |
| `case_access_grants` cannot grant to a bureau, only a user | Phase 4 design vs physical schema | Deferred to Phase 4; no Phase 1 change. |
| “Examination Bureau” naming differs between narrative sections | PRD narrative vs seed | Do not assert an official bureau list. Seed uses illustrative `RB`, `PGRC`, `AFF`. |
| PRD §7.3 matrix is a baseline; delegation is undefined | PRD §7.3 | Implement a conservative catalogue; record missing delegation as a limitation. |
| PRD §15.2 state machines are baseline | PRD | Only institution verification transitions are implemented, using the constrained transitions in the physical schema. No case state machine exists yet. |

No unresolved discrepancy was silently “fixed” by changing product behaviour or the database.

---

## 16. Limitations and unresolved items

1. **Live database verification is outstanding.** No `DATABASE_URL` or Supabase credentials were provided, so the migration/seed were not applied and the RLS suite skipped. This is the largest remaining risk.
2. **Role/action matrix sign-off is outstanding.** The Phase 1 catalogue is conservative and needs product approval before Phase 2.
3. **Bureau Admin delegation is undefined.** Membership management remains global-only.
4. **Revocation attribution is log-only.** No `revoked_by_user_id` column and no audit table.
5. **No create-user API.** Identities are provisioned through Supabase Auth out of band.
6. **No password reset / MFA UI.** Supabase Auth supports these, but the Phase 1 screens do not expose them.
7. **Aliases cannot be edited or deactivated through the API.** Only creation and listing exist; the schema supports more, but no approved requirement defined the workflow.
8. **Institution re-verification is not supported.** `verified` and `rejected` are terminal in this build.
9. **No refresh-token rotation handling beyond the Supabase JS client defaults.**
10. **Demo data is illustrative.** It must never be presented as official AICTE data.

---

## 17. Phase 2 entry gates

Before starting Phase 2:

1. Supply database credentials and apply `0001_phase1_identity_rls.sql` to a dedicated project.
2. Run `tests/test_rls_db.py` without skips and record the result.
3. Obtain sign-off for the Phase 1 permission catalogue and the role/action matrix.
4. Decide whether an audit table or `revoked_by_user_id` column is approved.
5. Define the institution verification task workflow and case state machine.
6. Confirm the official category/SLA source or label assumptions as demo-only.

---

## 18. File inventory (Phase 1)

**Backend**

- `backend/app/{main.py,core/,db/,auth/,repositories/,schemas/,api/}`
- `backend/tests/{conftest.py,test_security.py,test_authorization.py,test_endpoints.py,test_pagination.py,test_rls_db.py,test_seed_consistency.py}`
- `backend/{requirements.txt,requirements-dev.txt,pytest.ini,.env.example}`

**Database**

- `supabase/migrations/0001_phase1_identity_rls.sql`
- `supabase/seed/phase1_identity_seed.sql`
- `scripts/seed_demo_users.py`

**Frontend**

- `frontend/src/{App.tsx,main.tsx,types.ts}`
- `frontend/src/auth/`, `components/`, `lib/`, `pages/`, `styles/`, `test/`
- `frontend/{package.json,tsconfig.json,vite.config.ts,index.html,.env.example}`

**Documentation**

- `README.md`
- `docs/PHASE1_IMPLEMENTATION.md` (this report)

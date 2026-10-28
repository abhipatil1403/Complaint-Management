# Phase 1 Verification and Sign-off Review

**Project:** AICTE OneDesk — AICTE institution complaint monitoring and status dashboard  
**Phase:** 1 — identity, authorization and reference data (PRD §30)  
**Review date:** 28 October 2026  
**Status:** **DATABASE VERIFICATION PASSED — product sign-off still pending.** The
migration and reference seed were applied to the linked project on 28 October
2026, the seven demo identities were provisioned, and the live RLS suite returned
**14 passed, 0 skipped**. Phase 1 cannot be marked fully signed off until the
permission decisions in §4.2 and the audit-attribution decision (F8) are approved.

This report is the verification companion to `docs/PHASE1_IMPLEMENTATION.md`. It
records the migration review, the RLS test review, the permission decisions that
still need product sign-off, the demo-data assessment, the exact safe apply
procedure, and the remaining blockers. Phase 2 work has not started.

---

## 1. Sources inspected

| Source | Used for |
| --- | --- |
| `docs/PRD.md` §7.1–§7.3, §15.2, §30 | personas, baseline permission matrix, state-machine baseline, Phase 1 scope |
| `docs/MASTER_DATABASE_DESIGN.md` / `docs/Master_Database.md` | intended logical model |
| `docs/Database_plan.md` | 34–35 table design discrepancy |
| `docs/CURRENT_SUPABASE_SCHEMA.sql` | physical 32-table source of truth |
| `supabase/migrations/0001_phase1_identity_rls.sql` | migration under review |
| `supabase/seed/phase1_identity_seed.sql` | reference/demo seed |
| `backend/app/**` | API authorization, identity resolution, DB session, repositories |
| `backend/tests/**` | unit and live-RLS test coverage |
| `frontend/src/**` | permission display, demo banner, route gating (not a security control) |
| `scripts/seed_demo_users.py` | demo identity provisioning |
| `docs/PHASE1_IMPLEMENTATION.md` | prior implementation report |

The physical schema contains exactly **32** application tables in `public`. The
migration does not create, rename, drop or alter any of them, and does not add a
column. The 32-table physical model remains authoritative over the 34–35 table
logical plan.

---

## 2. Migration review against the actual schema

### 2.1 Objects created

| Object type | Count | Notes |
| --- | --- | --- |
| Helper functions | 9 | claim parsing, active-user, permission, membership helpers |
| RLS policies | 30 | on the 10 Phase 1 tables |
| Table grants | 10 tables | `authenticated` select/insert/update; delete only on `role_permissions` |
| `anon` revokes | 10 tables + 9 functions | fail closed for unauthenticated Data API access |

The migration is wrapped in `BEGIN … COMMIT` and uses `create or replace`,
`drop policy if exists` and `if exists` guards, so it is re-runnable without
duplicating objects.

### 2.2 Dependency check

Every table and column referenced by the migration exists in
`docs/CURRENT_SUPABASE_SCHEMA.sql`:

| Table | Columns used | Exists |
| --- | --- | --- |
| `users` | `id`, `account_status` | yes |
| `roles` | `id`, `is_active`, `scope_type` | yes |
| `permissions` | `id`, `code`, `is_active` | yes |
| `role_permissions` | `role_id`, `permission_id` | yes |
| `user_role_assignments` | `user_id`, `role_id`, `bureau_id`, `assignment_status`, `expires_at` | yes |
| `bureaus` | `id`, `is_active` | yes |
| `bureau_memberships` | `user_id`, `bureau_id`, `membership_status`, `ended_at` | yes |
| `regions`, `institutions`, `institution_aliases` | seed columns only | yes |

Other verified dependencies:

- `users.id` is the Auth identity (`users_auth_fk` → `auth.users(id)`); no
  separate `auth_user_id` column is assumed.
- The existing `validate_user_role_assignment` trigger already rejects a global
  role with a `bureau_id` and a bureau role without one. The migration's
  `has_global_permission` now also checks `scope_type = 'global'` as defence in
  depth.
- The seed's `on conflict` clauses match existing unique indexes:
  `permissions.code`, `roles.code`, `regions.code`, `bureaus.code`,
  `role_permissions (role_id, permission_id)`,
  `institutions.aicte_permanent_id` (partial),
  `institution_aliases (institution_id, normalized_alias, language_code, alias_type)`,
  and `bureau_memberships (user_id, bureau_id) WHERE membership_status = 'active'`.
- The migration relies on the Supabase-managed roles `anon`, `authenticated` and
  `service_role`. It must be applied to a Supabase project (or a database with
  equivalent roles), not a bare PostgreSQL instance.
- The migration does not reference `auth.*` directly.

### 2.3 Security review and resolutions

The following issues were found and corrected **in the pending migration and
application code**, not applied to a database:

| ID | Issue | Severity | Resolution |
| --- | --- | --- | --- |
| F1 | `has_global_permission` accepted any active assignment with `bureau_id IS NULL`, even if the role's `scope_type` was `bureau`. The existing trigger already prevents that row shape, but the helper should fail closed. | Low (defence in depth) | Added `r.scope_type = 'global'` to the global grant query. |
| F2 | `phase1_users_update_self` let any active signed-in user update their own `users` row through PostgREST, including `is_super_admin` and `account_status`. No self-service profile endpoint exists. | Medium | Removed the self-update policy. Profile changes now require global `USER.MANAGE`. |
| F3 | `users` and `user_role_assignments` SELECT policies used context-aware `has_permission`, while the API requires a **global** `USER.VIEW`/`USER.MANAGE`. A future bureau-scoped grant could have exposed the user directory via PostgREST. | Low (no current bureau role holds these) | Switched both policies to `has_global_permission`. |
| F4 | `IdentityService` classified any assignment with `bureau_id IS NULL` as global, without checking `RoleAssignment.scope_type`. | Low (trigger already blocks the data shape) | `RoleAssignment.is_global` now requires `scope_type == 'global'`; the service ignores invalid scope/bureau combinations. |
| F5 | The live RLS parity test compared `has_permission` (no active bureau claim) with a query that counted bureau grants, so it would fail for a bureau officer. | Test defect | Rewritten to publish the actor's active bureau and compare against the same context-aware rule; added positive/negative bureau tests. |
| F6 | `supabase/config.toml` pointed `db.seed.sql_paths` at `./seed.sql`, which does not exist. `supabase db reset` would not load the Phase 1 seed. | Tooling defect | Pointed it at `./seed/phase1_identity_seed.sql`. |
| F7 | `revoke_role_assignment` accepted a `revoked_by_user_id` argument that was never written (the physical table has no such column), giving a false impression of attribution. | Correctness/audit clarity | Removed the unused argument; the API audit log remains the only attribution record. |

Remaining security observations (not changed without approval):

| ID | Observation | Recommendation |
| --- | --- | --- |
| F8 | `user_role_assignments` has no `revoked_by_user_id` column and there is no general audit table. Revocation attribution is log-only. | Approve an additive audit table or a `revoked_by_user_id` column in a later migration. Do not invent one now. |
| F9 | `shares_bureau_with(uuid)` is defined but unused and does not check `bureaus.is_active`. | Keep as reserved Phase 2+ helper, or verify it before use. |
| F10 | `anon` retains full `ALL` table grants on **7** tables outside Phase 1 (`cases`, `case_relationships`, `complaint_categories`, `duplicate_candidates`, `institution_verification_tasks`, `intake_channels`, `submissions`) plus the 3 reference tables this migration handles. RLS is enabled on all 32 tables and no policies exist, so access is denied by default; this is fail-closed but broader than necessary. | Revoke `anon` from all business tables in a dedicated Phase 2 hardening migration. |
| F11 | Reference-write API routes use `require_permission` (context-aware) and bureau-membership writes use `require_bureau_capability`, while the DB policies require a **global** manage capability. The current catalogue and `test_bureau_scoped_roles_carry_no_administration_capability` prevent this from being reachable, but the layers should be made explicit. | Either switch these writes to `require_global_permission`, or document that the catalogue invariant is the guard. |
| F12 | A global `ROLE.MANAGE` holder can edit `role_permissions` directly (no API route) and remove the `ROLE.MANAGE`/`USER.MANAGE` grants from the last Super Admin role, locking out administration. | Add a last-administrator guard or restrict direct Data API writes to `role_permissions`. |
| F13 | `users.is_super_admin` is a dormant denormalised column. It is ignored by the API, but a future query could trust it. | Keep it ignored; document it; do not use it for authorization. |
| F14 | The pre-existing `validate_user_role_assignment` trigger reads `users`, `roles`, `bureaus` and `bureau_memberships` with `FOR SHARE`, and PostgreSQL applies the UPDATE policy to a locking read. Inserts therefore depend on the caller also holding the *update* capability for those tables (`ROLE.MANAGE`, `BUREAU.MANAGE`, `USER.MANAGE`, `BUREAU.MEMBERS.*`), not just `USER.MANAGE`. The seeded `SUPER_ADMIN` holds all of them, so the API path works; a future role with only `USER.MANAGE` would see spurious "Role must exist and be active" errors. Unauthorized callers are still denied, but with the trigger message (`P0001`) instead of `42501`. | Before delegating user administration, either make the trigger `SECURITY DEFINER` with an empty `search_path`, or drop the `FOR SHARE` clauses. Requires a separately approved migration. |

### 2.4 Grants and RLS coverage

- RLS was already enabled on all 32 tables, but the 10 Phase 1 tables had **zero**
  policies. The migration supplies the missing policies.
- `anon` is revoked from the 10 Phase 1 tables and all 9 helper functions.
- `authenticated` receives only `select/insert/update` on the Phase 1 tables
  (plus `delete` on `role_permissions` for catalogue maintenance). There is no
  `DELETE` grant on `users`, `roles`, `permissions`, `user_role_assignments`,
  `bureaus`, `bureau_memberships`, `regions`, `institutions` or
  `institution_aliases`; deactivation/revocation is the removal path.
- All write policies use `has_global_permission`; bureau-scoped grants cannot
  write reference or identity data.
- No table ownership, RLS enablement or existing constraint is changed.
- The migration does not add or remove application tables.

### 2.5 Side effects

The migration changes authorization behaviour, not data:

- Before: `authenticated` had no access to the seven identity tables and had
  broad `ALL` grants on `regions`, `institutions` and `institution_aliases`
  (with no policies, so effectively denied).
- After: `authenticated` can read/write the intended Phase 1 surface under RLS;
  `anon` is denied.
- The seed inserts/updates only reference and catalogue rows; it never deletes.
- No case, submission, attachment or notification table is touched.

---

## 3. RLS test review

### 3.1 How the live tests authenticate

`backend/tests/test_rls_db.py` connects with `DATABASE_URL` or
`TEST_DATABASE_URL`, then for each test:

1. sets `request.jwt.claims` with `set_config(..., true)` (including `sub` and,
   where relevant, `active_bureau_id`), and
2. executes `SET LOCAL ROLE authenticated` or `SET LOCAL ROLE anon`.

Every test runs inside `conn.transaction(force_rollback=True)`, so no row is
committed. The connecting role must be allowed to `SET ROLE` (the Supabase
`postgres` role can; a limited application role cannot).

This means the tests exercise **PostgreSQL RLS as the application roles**, not
just the FastAPI dependency layer. Unauthorized reads and writes are asserted
with `pytest.raises(InsufficientPrivilege)` or by asserting zero affected rows.

### 3.2 Coverage after this review

| Test | Role under test | What it proves |
| --- | --- | --- |
| `test_anon_cannot_read_identity_tables` | `anon` | no table grant for unauthenticated callers |
| `test_anon_cannot_call_the_permission_helper` | `anon` | helper execute is not public |
| `test_user_sees_only_their_own_profile` | `authenticated` | self-only profile visibility without `USER.VIEW` |
| `test_user_sees_only_their_own_role_assignments` | `authenticated` | self-only role-grant visibility |
| `test_missing_subject_claim_yields_no_identity_rows` | `authenticated` | fail closed without `sub` |
| `test_permission_helper_matches_the_callers_own_grants` | `authenticated` | helper parity, now with active bureau context |
| `test_bureau_grant_requires_its_active_bureau_context` | `authenticated` | bureau grant is denied without context and allowed in its own bureau |
| `test_bureau_grant_does_not_leak_into_another_bureau` | `authenticated` | bureau grant is denied in a different bureau |
| `test_user_cannot_update_privileged_profile_columns` | `authenticated` | no self-update of `is_super_admin` / `account_status` |
| `test_user_cannot_update_another_profile` | `authenticated` | no cross-profile update |
| `test_ordinary_user_cannot_write_reference_data` | `authenticated` | no reference write without manage |
| `test_ordinary_user_cannot_grant_roles` | `authenticated` | no self-grant of `SUPER_ADMIN` |
| `test_super_admin_can_manage_reference_data` | `authenticated` | authorized reference write works |
| `test_super_admin_can_read_every_profile` | `authenticated` | authorized directory read works |

The suite also discovers two ordinary active accounts and one active Super Admin
from the live data, and skips with an explicit message if the seed is missing.
It now excludes accounts that already hold global `USER.VIEW`/`USER.MANAGE` from
the "ordinary" set, so the negative tests cannot accidentally use an
administrator.

### 3.3 Remaining test gaps

- No live test for `role_permissions` mutation by a global `ROLE.MANAGE` holder.
- No live test for expired or revoked assignments.
- No live test for `bureau_memberships` insert/update by a delegated bureau role
  (the current catalogue has no such role).
- No live test for `anon` on the 7 non-Phase-1 tables that still hold `anon`
  grants; they are fail-closed by missing policies, but a future policy change
  should add explicit coverage.
- No PostgREST-level test; the tests use the same PostgreSQL roles and GUCs that
  PostgREST uses, which is the security-relevant layer.

### 3.4 Results

Command (from `backend/`):

```bash
python -m pytest -o addopts= -q
```

The suite resolves its connection string from `TEST_DATABASE_URL`, then
`DATABASE_URL`, then `DATABASE_URL` in `backend/.env` (the same file the API
reads), so the 14 live tests run without a duplicate export.

| Stage | Result |
| --- | --- |
| Before credentials (unit suite only) | `119 passed, 14 skipped` |
| Before the migration, with credentials | `1 passed, 2 failed, 11 skipped` — expected: the helpers did not exist and `authenticated` had no grant on `users`; the suite really was talking to the database |
| Migration + seed applied, no identities | `3 passed, 11 skipped` — explicit skip messages for missing accounts |
| Migration + seed + 7 demo identities | **`14 passed, 0 skipped`** |
| Full suite after verification | **`133 passed, 0 skipped, 13 warnings`** |

The final run exercised every policy with real data: ordinary-user self-only
visibility, bureau-context allow/deny, cross-bureau isolation, profile-update
denial, reference-write denial, role-grant denial, and the authorised Super Admin
read/write paths.

### 3.5 Post-apply object verification

| Check | Expected | Actual |
| --- | --- | --- |
| `public` base tables | 32 | 32 |
| Tables with RLS enabled | 32 | 32 |
| Phase 1 helper functions | 9 | 9 |
| Phase 1 policies | 30 | 30 |
| `permissions` / `roles` / `role_permissions` | 14 / 6 / 37 | 14 / 6 / 37 |
| `regions` / `bureaus` / `institutions` / `aliases` | 6 / 3 / 5 / 3 | 6 / 3 / 5 / 3 |
| `anon` grants on the 10 Phase 1 tables | none | none |
| Helper `EXECUTE` for `anon` | denied | denied for all 9 |
| `authenticated` grants | select/insert/update (+delete on `role_permissions`) | as planned |

---

## 4. Permission catalogue versus PRD §7.3

PRD §7.3 is explicitly a **baseline** and has not been signed off as an
implementation contract. Phase 1 implements only the identity and reference-data
capabilities; case, intake, assignment, note, SLA, escalation, audit and export
capabilities are intentionally absent.

### 4.1 Implemented mapping

| PRD §7.3 capability | Phase 1 implementation | Assessment |
| --- | --- | --- |
| Manage global reference data | `SUPER_ADMIN` has `region.manage`, `institution.manage`, `institution.alias.manage`, `bureau.manage`; all other roles have no manage capability | consistent with "Yes / No" |
| Manage user/bureau membership | `SUPER_ADMIN` only (`user.manage`, `bureau.members.manage`); `BUREAU_ADMIN` has neither | conservative reading of "Scoped only if delegated" |
| View reference data | all six roles have `region.view`, `institution.view`, `institution.alias.view`, `bureau.view` | consistent |
| View bureau members | `BUREAU_ADMIN`, `CASE_OFFICER`, `CROSS_BUREAU_COLLABORATOR` have `bureau.members.view` in their own active bureau; global roles have it only through `SUPER_ADMIN` | consistent with "Scoped" |
| View minimal cross-bureau index | not implemented | Phase 2+ |
| View full case content | not implemented; `SUPER_ADMIN` is not a case-content bypass | Phase 2+ |
| Create/assign/note/status/dispose/access/SLA/audit/export | not implemented | Phase 2+ |

### 4.2 Decisions requiring explicit approval

1. **Bureau Admin delegation.** `BUREAU_ADMIN` does **not** receive `user.view`,
   `user.manage`, or `bureau.members.manage`. PRD §7.3 says "Scoped only if
   delegated" for user/bureau membership, but no delegation model exists. Approve
   the conservative global-only behaviour, or define the delegation model before
   Phase 2.
2. **Role differentiation.** `BUREAU_ADMIN`, `CASE_OFFICER` and
   `CROSS_BUREAU_COLLABORATOR` have the same five Phase 1 permissions. Approve
   that they are indistinguishable until case capabilities exist, or split them
   now.
3. **Read-only global roles.** `SENIOR_MANAGEMENT` and `AUDITOR` have the same
   four read permissions. Approve that this is sufficient for Phase 1.
4. **Super Admin scope.** `SUPER_ADMIN` holds all 14 Phase 1 capabilities but is
   not a content-access bypass. Approve this as the Phase 1 interpretation of
   "explicit permissions and audited".
5. **Catalogue readability.** The database lets any active user read `roles`,
   `permissions` and `role_permissions` (needed to resolve `/me` without a bureau
   context), while the `/roles` API still requires global `role.view`. Approve
   this split, or add a narrower `/me` resolution path and tighten the DB policy.
6. **Bureau readability.** The database lets any active user read `bureaus`
   (needed to render memberships), while `/bureaus` requires `bureau.view` in the
   active context. Approve that bureau names are non-sensitive.
7. **Permission code casing.** Database codes are UPPERCASE (enforced by
   `permissions_code_format`); the API exposes lowercase dotted codes. Approve
   the mapping.
8. **`users.is_super_admin`.** The physical column is ignored for authorization;
   Super Admin is derived from the global `SUPER_ADMIN` role. Approve keeping the
   column dormant.
9. **Revocation attribution.** Approve log-only attribution, or approve an
   additive schema change (`revoked_by_user_id` and/or audit table).
10. **Matrix and state machines.** Sign off the §7.3 role/action matrix and the
    §15.2 state-machine baseline before Phase 2. Phase 1 implements only the
    institution verification transitions constrained by the physical schema.

No official AICTE bureau list, timeline or policy has been invented. The seed's
`RB`, `PGRC` and `AFF` bureaus are illustrative.

---

## 5. Demo-data labelling assessment

**Assessment: clearly labelled and not mistakable for official AICTE policy.**

Evidence:

- The seed header says `Phase 1 demo seed (ILLUSTRATIVE DATA ONLY)` and states
  there are no real AICTE institution records, approvals or timelines.
- Institution IDs are `DEMO-AICTE-0001` … `0005`; names begin with `Demo`;
  verification source says `Illustrative demo record - not an official AICTE
  approval`.
- Regions, bureaus and aliases use descriptions such as `Illustrative demo
  region`, `Illustrative demo bureau` and `Illustrative demo record`.
- Demo people use the reserved `@demo.invalid` domain and `DEMO-` employee codes.
- The API returns `demo_mode` and `demo_notice`; every authenticated screen shows
  a `Demo` banner, and the shell footer says
  `Demonstrator only. Illustrative demo data; not an official AICTE service.`
- `README.md` repeats the demonstrator-only notice at the top.
- `scripts/seed_demo_users.py` refuses to run without `ALLOW_DEMO_SEED=true`,
  requires a 12+ character `DEMO_PASSWORD`, and never prints passwords or the
  service-role key.

Residual risk: if the seeded project is later run with `DEMO_MODE=false`, the
banner disappears while the demo rows remain. Do not deploy the seeded reference
data to a production project, or keep `DEMO_MODE=true` until the rows are
replaced. The seed's upserts also reactivate demo rows on re-run; that is
intentional for demos but should not be run against production.

---

## 6. Exact safe apply procedure

**Do not run these steps until the review and the permission decisions in §4.2
are approved.** Do not paste credentials into chat, tickets or commits.

### 6.1 Preconditions

1. Use a dedicated Supabase project (staging/demo), not production.
2. Take a backup or confirm point-in-time recovery is available.
3. Confirm the project has the documented 32-table `public` schema. If the
   physical schema differs, stop and reconcile it first.
4. Confirm the migration has not already been applied.
5. Use the Supabase `postgres` connection string (or a role that owns the tables
   and can `SET ROLE authenticated`). The `service_role` key is **not** a database
   password and must not be used as one.

Set the connection string in the local shell only (never commit it):

```powershell
# PowerShell, local session only
$env:DATABASE_URL = "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require"
```

```bash
# bash, local session only
export DATABASE_URL='postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require'
```

### 6.2 Preflight queries (read-only)

```sql
-- exactly 32 application tables
select count(*) as public_tables
  from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE';

-- RLS enabled on every table
select c.relname, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by c.relname;

-- no Phase 1 policies or helpers yet
select tablename, policyname
  from pg_policies
 where schemaname = 'public' and policyname like 'phase1\_%' escape '\';

select proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and proname in (
     'jwt_claims', 'jwt_uuid_claim', 'auth_uid', 'active_bureau_id',
     'is_active_user', 'has_global_permission', 'has_permission',
     'is_bureau_member', 'shares_bureau_with'
   );
```

Expected before apply: 32 tables; all `relrowsecurity = true`; zero `phase1_*`
policies; zero of the nine functions.

### 6.3 Apply the migration

Preferred (psql, explicit transaction in the file, fail on first error):

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/0001_phase1_identity_rls.sql
```

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_phase1_identity_rls.sql
```

Alternative (Supabase CLI, linked project):

```bash
supabase db push
```

`supabase db push` applies pending migrations but does **not** run the seed. Do
not use `supabase db reset` against a linked remote project; it is destructive.

### 6.4 Apply the reference seed

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/seed/phase1_identity_seed.sql
```

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed/phase1_identity_seed.sql
```

The seed is idempotent for the catalogue/reference rows and ends with count
assertions (14 permissions, 6 roles, at least 37 role-permission grants). It does
not create Auth users.

### 6.5 Post-apply verification

```sql
-- 9 helpers, 30 policies
select count(*) as helper_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'jwt_claims', 'jwt_uuid_claim', 'auth_uid', 'active_bureau_id',
     'is_active_user', 'has_global_permission', 'has_permission',
     'is_bureau_member', 'shares_bureau_with'
   );

select count(*) as policy_count
  from pg_policies
 where schemaname = 'public' and policyname like 'phase1\_%' escape '\';

-- seed counts
select count(*) as permissions from public.permissions
 where code in (
   'REGION.VIEW','REGION.MANAGE','INSTITUTION.VIEW','INSTITUTION.MANAGE',
   'INSTITUTION.ALIAS.VIEW','INSTITUTION.ALIAS.MANAGE','BUREAU.VIEW',
   'BUREAU.MANAGE','BUREAU.MEMBERS.VIEW','BUREAU.MEMBERS.MANAGE',
   'USER.VIEW','USER.MANAGE','ROLE.VIEW','ROLE.MANAGE'
 );

select count(*) as roles from public.roles
 where code in (
   'SUPER_ADMIN','BUREAU_ADMIN','CASE_OFFICER',
   'CROSS_BUREAU_COLLABORATOR','SENIOR_MANAGEMENT','AUDITOR'
 );

select count(*) as role_permission_grants
  from public.role_permissions rp
  join public.roles r on r.id = rp.role_id
 where r.code in (
   'SUPER_ADMIN','BUREAU_ADMIN','CASE_OFFICER',
   'CROSS_BUREAU_COLLABORATOR','SENIOR_MANAGEMENT','AUDITOR'
 );

select count(*) as demo_institutions from public.institutions
 where aicte_permanent_id like 'DEMO-AICTE-%';

select count(*) as demo_aliases from public.institution_aliases a
  join public.institutions i on i.id = a.institution_id
 where i.aicte_permanent_id like 'DEMO-AICTE-%';
```

Expected: 9 helpers, 30 policies, 14 permissions, 6 roles, at least 37 grants,
5 demo institutions, 3 demo aliases. The seed's own assertions also fail the
transaction if the catalogue is incomplete.

### 6.6 Run the live RLS suite

```powershell
cd backend
python -m pytest -q tests/test_rls_db.py
```

The suite reads `TEST_DATABASE_URL`, then `DATABASE_URL`, then `DATABASE_URL`
from `backend/.env`; no export is needed. Expected after apply, seed and demo
identities: **14 passed, 0 skipped**. Skips mean the actor-discovery fixtures
found no accounts (run `scripts/seed_demo_users.py`) — not that RLS passed. If
the suite cannot `SET LOCAL ROLE authenticated`, use the Supabase `postgres`
connection, not a limited app role.

### 6.7 Seed demo identities (optional, after reference seed)

```powershell
$env:ALLOW_DEMO_SEED = "true"
$env:DEMO_PASSWORD = "<a long demo-only password, 12+ chars>"
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<server-side only>"
$env:DATABASE_URL = "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require"
python scripts/seed_demo_users.py
```

The script creates Auth users through the admin API, then upserts profiles,
memberships and role grants. It prints no passwords or keys. Use the demo
accounts only in the demo environment.

### 6.8 Rollback (only with explicit approval)

The migration is additive and changes no data. The safest rollback is to restore
the pre-change backup/snapshot. If a SQL rollback is preferred, it only needs to
drop the Phase 1 policies/functions and restore the previous grants:

```sql
begin;

do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and policyname like 'phase1\_%' escape '\'
  loop
    execute format('drop policy if exists %I on %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  end loop;
end
$$;

drop function if exists public.shares_bureau_with(uuid);
drop function if exists public.is_bureau_member(uuid);
drop function if exists public.has_permission(text);
drop function if exists public.has_global_permission(text);
drop function if exists public.is_active_user();
drop function if exists public.active_bureau_id();
drop function if exists public.auth_uid();
drop function if exists public.jwt_uuid_claim(text);
drop function if exists public.jwt_claims();

-- restore the pre-migration state: identity tables had no anon/authenticated grants
revoke all on table public.users from anon, authenticated;
revoke all on table public.roles from anon, authenticated;
revoke all on table public.permissions from anon, authenticated;
revoke all on table public.role_permissions from anon, authenticated;
revoke all on table public.user_role_assignments from anon, authenticated;
revoke all on table public.bureaus from anon, authenticated;
revoke all on table public.bureau_memberships from anon, authenticated;

-- regions/institutions/institution_aliases originally had ALL for anon and authenticated
grant all on table public.regions to anon, authenticated;
grant all on table public.institutions to anon, authenticated;
grant all on table public.institution_aliases to anon, authenticated;

commit;
```

Do not run the rollback against a project where later migrations depend on these
objects. Do not drop tables or delete reference rows.

---

## 7. Status of blockers

Resolved on 28 October 2026:

1. **Database credentials configured.** `backend/.env` holds the server-side
   connection string (gitignored, never printed). Connectivity and `SET ROLE`
   capability were verified.
2. **Migration and seed applied.** `0001_phase1_identity_rls.sql` and
   `phase1_identity_seed.sql` were applied with `psql -v ON_ERROR_STOP=1`; the
   post-apply counts in §3.5 match the plan. Seven demo identities were created
   with `scripts/seed_demo_users.py`; the shared demo password lives only in
   `backend/.env`.
3. **Live RLS suite run.** `14 passed, 0 skipped`; full suite `133 passed`.

Still open:

4. **Permission catalogue sign-off outstanding.** The decisions in §4.2,
   especially Bureau Admin delegation, role differentiation and revocation
   attribution, need explicit product approval.
5. **Role/action matrix and state-machine baseline not signed off.** PRD §7.3 and
   §15.2 are baseline documents, not approved implementation contracts.
6. **Audit gap.** No general audit table and no `revoked_by_user_id` column;
   revocation attribution is log-only.
7. **No create-user API, password-reset/MFA UI, alias edit/deactivate route, or
   institution re-verification.** These are documented Phase 1 limitations, not
   verification failures.
8. **No official category/SLA source.** Phase 2 must confirm the category and SLA
   source or label assumptions as demo-only.
9. **Deferred hardening.** `anon` still holds full grants on 7 non-Phase-1 tables
   (F10), and the assignment trigger couples to the UPDATE policies (F14). Both
   need separately approved migrations before Phase 2 policies are added.

---

## 8. Criteria for full sign-off

| Criterion | Status |
| --- | --- |
| Migration and seed applied using §6 | **done** (28 Oct 2026) |
| `tests/test_rls_db.py` returns 14 passed, 0 skipped | **done** |
| Post-apply queries return the expected counts | **done** (§3.5) |
| Permission decisions in §4.2 explicitly approved (or amended) | **pending** |
| Audit-attribution decision (F8) recorded | **pending** |
| Manual smoke check of `/me`, `/users`, bureau context and the inactive account through the running frontend/API | **pending** |

Database verification is complete; product sign-off is not. Phase 1 remains
**implementation and database verification complete, product sign-off pending**,
and Phase 2 must not start until the two pending rows above are decided.

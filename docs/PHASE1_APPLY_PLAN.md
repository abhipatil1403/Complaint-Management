# Phase 1 Apply Plan — exact database changes

**Project:** AICTE OneDesk — AICTE institution complaint monitoring and status dashboard
**Phase:** 1 — identity, authorization and reference data (PRD §30)
**Prepared:** 28 October 2026
**Status:** **APPLIED AND VERIFIED on 28 October 2026.** The migration, reference
seed and seven demo identities were applied to the linked project after
approval. Post-apply results: 32 tables (unchanged), 9 helpers, 30 policies,
14 permissions, 6 roles, 37 grants, 6 regions, 3 bureaus, 5 institutions,
3 aliases, zero `anon` grants on the Phase 1 tables, and the live RLS suite at
**14 passed, 0 skipped** (full suite 133 passed). The original preflight below is
kept as the record of the pre-apply state. Product sign-off remains open — see
`docs/PHASE1_VERIFICATION.md` §4.2 and §8.

Companion documents: `docs/PHASE1_VERIFICATION.md` (review, sign-off list),
`docs/PHASE1_IMPLEMENTATION.md` (implementation report).

---

## 1. Live preflight (read-only, executed)

Connected as `postgres` (project `oqqecqnrxdkbesyikqfj`, PostgreSQL 17.11).
No credentials are recorded here.

| Check | Result |
| --- | --- |
| `public` base tables | **32** (matches `docs/CURRENT_SUPABASE_SCHEMA.sql`) |
| Tables with RLS enabled | **32 / 32** |
| Existing policies in `public` | **0** |
| Existing functions in `public` | **8** (`set_updated_at`, 6 `validate_*`, `prevent_case_action_history_mutation`) |
| Name collisions with the 9 new helpers | **none** |
| Rows in `permissions`, `roles`, `regions`, `bureaus`, `institutions`, `users` | **0** (unseeded) |
| `supabase_migrations.schema_migrations` | does not exist (schema was applied outside the CLI ledger) |
| `anon` / `authenticated` grants, 7 identity tables | none |
| `anon` / `authenticated` grants, `regions`, `institutions`, `institution_aliases` | full `ALL` (this migration narrows them) |
| `anon` / `authenticated` grants, 7 other case tables | full `ALL` (out of scope — see §6) |
| Login role can `SET ROLE authenticated` / `anon` | yes (`pg_has_role … 'USAGE'` true for both) |

Because every table already has RLS enabled and no policies, the project is
currently **fail-closed**: `authenticated` and `anon` can see nothing. This
migration is what turns the intended access on.

---

## 2. Migration `supabase/migrations/0001_phase1_identity_rls.sql`

Additive only. No `CREATE/ALTER/DROP TABLE`, no column change, no ownership
change, no RLS-flag change. Wrapped in `BEGIN … COMMIT`; safe to re-run
(`create or replace`, `drop policy if exists`). Applied with
`psql -v ON_ERROR_STOP=1`, so any error rolls the whole file back.

### 2.1 Nine helper functions (all `set search_path = ''`, schema-qualified)

| Function | Returns | Security | Execute granted to |
| --- | --- | --- | --- |
| `public.jwt_claims()` | `jsonb` | invoker | `authenticated`, `service_role` |
| `public.jwt_uuid_claim(text)` | `uuid` | invoker | `authenticated`, `service_role` |
| `public.auth_uid()` | `uuid` | invoker | `authenticated`, `service_role` |
| `public.active_bureau_id()` | `uuid` | invoker | `authenticated`, `service_role` |
| `public.is_active_user()` | `boolean` | definer | `authenticated`, `service_role` |
| `public.has_global_permission(text)` | `boolean` | definer | `authenticated`, `service_role` |
| `public.has_permission(text)` | `boolean` | definer | `authenticated`, `service_role` |
| `public.is_bureau_member(uuid)` | `boolean` | definer | `authenticated`, `service_role` |
| `public.shares_bureau_with(uuid)` | `boolean` | definer | `authenticated`, `service_role` |

`EXECUTE` is revoked from `PUBLIC` and `anon` for all nine. The five
`SECURITY DEFINER` functions are owned by `postgres` and are the only path that
reads identity tables for policy evaluation, so a caller cannot read rows
directly. They return booleans only.

### 2.2 Thirty policies (all `TO authenticated`)

| Table | Policy | Command | Rule |
| --- | --- | --- | --- |
| `users` | `phase1_users_select` | SELECT | own row, or global `USER.VIEW`, or global `USER.MANAGE` |
| `users` | `phase1_users_update_admin` | UPDATE | global `USER.MANAGE` (using + with check) |
| `roles` | `phase1_roles_select` | SELECT | any active user profile |
| `roles` | `phase1_roles_insert` | INSERT | global `ROLE.MANAGE` |
| `roles` | `phase1_roles_update` | UPDATE | global `ROLE.MANAGE` |
| `permissions` | `phase1_permissions_select` | SELECT | any active user profile |
| `permissions` | `phase1_permissions_insert` | INSERT | global `ROLE.MANAGE` |
| `permissions` | `phase1_permissions_update` | UPDATE | global `ROLE.MANAGE` |
| `role_permissions` | `phase1_role_permissions_select` | SELECT | any active user profile |
| `role_permissions` | `phase1_role_permissions_insert` | INSERT | global `ROLE.MANAGE` |
| `role_permissions` | `phase1_role_permissions_update` | UPDATE | global `ROLE.MANAGE` |
| `role_permissions` | `phase1_role_permissions_delete` | DELETE | global `ROLE.MANAGE` |
| `user_role_assignments` | `phase1_user_role_assignments_select` | SELECT | own rows, or global `USER.VIEW`/`USER.MANAGE` |
| `user_role_assignments` | `phase1_user_role_assignments_insert` | INSERT | global `USER.MANAGE` |
| `user_role_assignments` | `phase1_user_role_assignments_update` | UPDATE | global `USER.MANAGE` |
| `regions` | `phase1_regions_select` | SELECT | `REGION.VIEW` or `REGION.MANAGE` (bureau-context aware) |
| `regions` | `phase1_regions_insert` | INSERT | global `REGION.MANAGE` |
| `regions` | `phase1_regions_update` | UPDATE | global `REGION.MANAGE` |
| `institutions` | `phase1_institutions_select` | SELECT | `INSTITUTION.VIEW` or `INSTITUTION.MANAGE` |
| `institutions` | `phase1_institutions_insert` | INSERT | global `INSTITUTION.MANAGE` |
| `institutions` | `phase1_institutions_update` | UPDATE | global `INSTITUTION.MANAGE` |
| `institution_aliases` | `phase1_institution_aliases_select` | SELECT | `INSTITUTION.ALIAS.VIEW` or `.MANAGE` |
| `institution_aliases` | `phase1_institution_aliases_insert` | INSERT | global `INSTITUTION.ALIAS.MANAGE` |
| `institution_aliases` | `phase1_institution_aliases_update` | UPDATE | global `INSTITUTION.ALIAS.MANAGE` |
| `bureaus` | `phase1_bureaus_select` | SELECT | any active user profile |
| `bureaus` | `phase1_bureaus_insert` | INSERT | global `BUREAU.MANAGE` |
| `bureaus` | `phase1_bureaus_update` | UPDATE | global `BUREAU.MANAGE` |
| `bureau_memberships` | `phase1_bureau_memberships_select` | SELECT | own rows; bureau members only in that active bureau; or a global member/manage capability |
| `bureau_memberships` | `phase1_bureau_memberships_insert` | INSERT | global `BUREAU.MEMBERS.MANAGE` |
| `bureau_memberships` | `phase1_bureau_memberships_update` | UPDATE | global `BUREAU.MEMBERS.MANAGE` |

The migration also issues `drop policy if exists phase1_users_update_self`
(no-op today, removes the policy if an earlier draft was ever applied locally).
There is deliberately **no** self-update policy on `users`.

### 2.3 Privilege diff (table grants)

| Table | `anon` before → after | `authenticated` before → after |
| --- | --- | --- |
| `users` | none → none | none → `SELECT, UPDATE` |
| `roles` | none → none | none → `SELECT, INSERT, UPDATE` |
| `permissions` | none → none | none → `SELECT, INSERT, UPDATE` |
| `role_permissions` | none → none | none → `SELECT, INSERT, UPDATE, DELETE` |
| `user_role_assignments` | none → none | none → `SELECT, INSERT, UPDATE` |
| `bureaus` | none → none | none → `SELECT, INSERT, UPDATE` |
| `bureau_memberships` | none → none | none → `SELECT, INSERT, UPDATE` |
| `regions` | `ALL` → **none** | `ALL` → `SELECT, INSERT, UPDATE` |
| `institutions` | `ALL` → **none** | `ALL` → `SELECT, INSERT, UPDATE` |
| `institution_aliases` | `ALL` → **none** | `ALL` → `SELECT, INSERT, UPDATE` |

No `DELETE` grant is given on identity or reference tables; deactivation and
revocation are the removal paths. `DELETE` exists only on `role_permissions`.

### 2.4 Explicitly not changed

- No table is created, renamed, dropped or altered; the count stays **32**.
- No column is added, removed or retyped.
- No table ownership, RLS enablement or `FORCE ROW LEVEL SECURITY` change.
- No existing constraint, index, trigger or data row is modified.
- No `auth.*` object is touched; `users.id` remains the Auth identity.
- The 7 non-Phase-1 tables that still carry `anon` grants are untouched (§6.1).

---

## 3. Seed `supabase/seed/phase1_identity_seed.sql`

Idempotent upserts; nothing is deleted; ends with count assertions that abort
the transaction if the catalogue is incomplete.

| Object | Rows | Notes |
| --- | --- | --- |
| `permissions` | 14 | UPPERCASE codes, matching `permissions_code_format`; unique on `(resource_type, action_type)` |
| `roles` | 6 | `SUPER_ADMIN`, `BUREAU_ADMIN`, `CASE_OFFICER`, `CROSS_BUREAU_COLLABORATOR`, `SENIOR_MANAGEMENT`, `AUDITOR`; scope matches `backend/app/auth/permissions.py` |
| `role_permissions` | 37 | 14 + 5 + 5 + 5 + 4 + 4 |
| `regions` | 6 | `NORTH`, `SOUTH`, `EAST`, `WEST`, `CENTRAL`, `NORTHEAST` — illustrative |
| `bureaus` | 3 | `RB`, `PGRC`, `AFF` — illustrative |
| `institutions` | 5 | `DEMO-AICTE-0001…0005`, labelled illustrative; 3 verified, 2 pending |
| `institution_aliases` | 3 | labels `Illustrative demo record` |
| `users` | 0 | demo people are created by `scripts/seed_demo_users.py` |

Every `on conflict` target matches a live unique index; the institutions upsert
uses the partial unique index on `aicte_permanent_id`; aliases use
`(institution_id, normalized_alias, language_code, alias_type)`. All values pass
the live `CHECK` constraints (uppercase codes, 6-digit postal codes, allowed
enums, verified-record identity requirements).

No official AICTE bureau list, approval or timeline is invented; every row is
prefixed `DEMO-`/`Demo` and described as illustrative.

---

## 4. Apply commands (to run only after approval)

```powershell
# from the repository root; credentials come from backend/.env, never from chat
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/0001_phase1_identity_rls.sql
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/seed/phase1_identity_seed.sql
```

Then the read-only verification queries in `docs/PHASE1_VERIFICATION.md` §6.5,
which must return: 9 helpers, 30 policies, 14 permissions, 6 roles, >= 37
grants, 5 demo institutions, 3 demo aliases.

---

## 5. Rollback (only with explicit approval)

The migration changes no data, so the first choice is restoring the
pre-change snapshot. The SQL rollback in `docs/PHASE1_VERIFICATION.md` §6.8
drops the 30 policies and 9 functions and restores the previous grants
(`ALL` back to `anon` and `authenticated` on the 3 reference tables).
Do not run it if later migrations depend on these objects.

---

## 6. Prerequisite for "14 passed": demo identities

The live suite discovers its actors from the database. With 0 users it can only
run **3 of 14** tests (`anon` denial, helper denial, missing-subject fail-closed)
and skips the other **11** with an explicit message.

To execute all 14, the project needs:

- at least 2 active ordinary accounts (no global `USER.VIEW`/`USER.MANAGE`),
- at least 1 active Super Admin,
- at least 1 bureau-scoped grant with an active membership,
- a second active bureau outside that scope.

`scripts/seed_demo_users.py` creates exactly this set (7 personas). It needs
`SUPABASE_SERVICE_ROLE_KEY` and `DEMO_PASSWORD` (12+ chars) in addition to the
`DATABASE_URL` already configured, and it refuses to run without
`ALLOW_DEMO_SEED=true`.

### 6.1 Remaining hardening (not part of this migration)

`anon` still holds full `ALL` grants on 7 non-Phase-1 tables (`cases`,
`case_relationships`, `complaint_categories`, `duplicate_candidates`,
`institution_verification_tasks`, `intake_channels`, `submissions`). RLS with no
policies denies access today, so this is fail-closed, but it is broader than
least privilege. Recommend a separate, approved hardening migration before any
Phase 2 policy is added to those tables. This plan does not touch them.

### 6.2 Test-suite changes in this review

- `backend/tests/test_rls_db.py` now resolves the connection string from
  `TEST_DATABASE_URL`/`DATABASE_URL` in the shell, then from `backend/.env`, so
  no duplicate export is needed.
- `test_super_admin_can_read_every_profile` compared the visible row count with
  the number of **active** accounts only; it now compares with the total `users`
  count. Without the fix it would fail as soon as the deliberately inactive demo
  account existed.

---

## 7. Approval checklist

Approve the following before any SQL is executed:

1. Apply `0001_phase1_identity_rls.sql` (9 functions, 30 policies, privilege
   narrowing in §2.3).
2. Apply `phase1_identity_seed.sql` (illustrative catalogue/reference rows in §3).
3. Create demo identities so all 14 live RLS tests execute rather than skip.
4. Accept the §6.1 hardening item as deferred to a separate approved migration.

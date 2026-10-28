# Phase 1 Security Closure — Revised Proposal

**Project:** AICTE OneDesk
**Phase:** 1 — identity, authorization and reference data
**Baseline commit:** `943f422` on `main`
**Prepared:** 28 October 2026 (revised after review)
**Status:** **APPLIED AND VERIFIED.** `0002_phase1_security_closure.sql` was
applied to the linked Supabase project on 28 October 2026, the F11 API change was
committed with it, and the full backend and live RLS suites were re-run. F10,
F11, F12 and F14 are closed; F8 remains open. Phase 2 has not started. Actual
results are recorded in §14.

This revision answers the five review points on the first draft. The five points
were valid: the draft's `auth_uid() IS NULL` bypass *was* exploitable, its
expiry check *was* time-dependent, and it did not cover `role_permissions`.

---

## 1. Response to the five review points

| # | Review point | Verdict | What changed |
| --- | --- | --- | --- |
| 1 | Guard must cover removal/deactivation of the final `USER.MANAGE` grant, including `role_permissions` | Draft was incomplete | Added `role_permissions` UPDATE/DELETE triggers; the guard now evaluates the `role_permissions` pair (`role_id`, `permission_id`), plus `permissions` code/`is_active`, `roles` scope/`is_active`, `users.account_status`, and assignment revoke/expire/delete |
| 2 | Future expiry of the final administrator must be handled | Draft was insufficient | The invariant is now "at least one **permanent** (non-expiring) administrator". Any expiry — past or future — on the last permanent administrator is rejected at write time, so no clock event can produce a lockout |
| 3 | Audit the `SECURITY DEFINER` function, especially the `auth_uid() IS NULL` bypass | **Confirmed exploitable** | The bypass is removed. The gate keys off the session role/privileges, not client-settable claims |
| 4 | Live tests for role deactivation and future expiry | Added | 15 new live RLS tests (14 → 29), listed in §6 |
| 5 | Verify concurrency safety and 32-table preservation | Verified | Advisory lock + fresh-snapshot behaviour proven on the live project (§4.3); dry run confirms 32 tables and zero `anon` grants (§5) |

---

## 2. Finding 3 in detail — the bypass was real

`auth_uid()` is `select public.jwt_uuid_claim('sub')`, i.e. it reads the
`request.jwt.claims` GUC. That GUC is **client-settable**: any Data API session
can run `set local request.jwt.claims = ''`, after which `auth_uid()` returns
`NULL`. Probe result on the live project:

```
auth_uid() with claims   : e78e67aa-bbf6-4a44-9280-dc8eb71025a8
current role (invoker)   : authenticated
auth_uid() after clearing: None
```

So the first draft's `if public.auth_uid() is not null and not has_global_permission(...)`
gate could be skipped by the very caller it was meant to stop. The body would
then run as the function owner and its first `SELECT … FROM public.roles WHERE id = NEW.role_id`
would tell the caller whether an arbitrary UUID is an active role; the same
applies to the `users` and `bureaus` lookups ("Active role assignments require
an active user" vs "Role must exist and be active"). That is account probing.

### 2.1 Replacement gate

```sql
select coalesce(pg_catalog.current_setting('role', true), 'none') = 'service_role'
       or (
           coalesce(pg_catalog.current_setting('role', true), 'none')
               not in ('authenticated', 'anon', 'authenticator')
           and exists (
               select 1 from pg_catalog.pg_roles
                where rolname = session_user
                  and (rolsuper or rolbypassrls)
           )
       )
  into trusted_session;

if trusted_session is not true
   and public.has_global_permission('USER.MANAGE') is not true then
    raise exception 'Role assignments require the global USER.MANAGE capability'
        using errcode = '42501';
end if;
```

| Session | `current_setting('role')` | Trusted? | Reason |
| --- | --- | --- | --- |
| FastAPI / Data API user | `authenticated` | No | application role |
| anonymous Data API | `anon` | No | application role |
| Data API after `RESET ROLE` | `none`, `session_user = authenticator` | No | `authenticator` is not superuser/BYPASSRLS |
| Data API with the secret key | `service_role` | Yes | secret-key holder already has full data access by design |
| Seed / operator running as the owner | `none`, `session_user = postgres` | Yes | superuser / BYPASSRLS |

`authenticated` cannot promote itself: `pg_has_role('authenticated','postgres','MEMBER')`
and `pg_has_role('authenticated','service_role','MEMBER')` are both **false**
(probe). `current_setting('role')` also survives the `SECURITY DEFINER` switch —
verified: `authenticated` outside, `authenticated` inside the definer function.
Had it been reset to the owner, the gate would have been unenforceable.

### 2.2 Audit of the definer body

* The gate is the **first statement**; nothing is read before it.
* The gate is the only new behaviour. The rest of the body is byte-identical to
  `docs/CURRENT_SUPABASE_SCHEMA.sql` (ordering of reads, messages, `FOR SHARE`
  locks, `RETURN NEW`).
* Every read is schema-qualified (`search_path = ''` is retained):
  `public.roles`, `public.users`, `public.bureaus`, `public.bureau_memberships`.
* The function is a trigger function, so it cannot be called directly; the only
  way to reach it is `INSERT`/`UPDATE OF user_id, role_id, bureau_id,
  assignment_status` on `public.user_role_assignments`. The gate applies
  regardless of grants and policies, because a `BEFORE` trigger runs before
  `WITH CHECK`.
* `has_global_permission()` is itself `SECURITY DEFINER` and returns a boolean
  only, so calling it discloses nothing.
* A caller that legitimately holds `USER.MANAGE` can already read these tables
  through the `USER.VIEW`/`USER.MANAGE` policies, so the definer context adds no
  privilege for them.

Evidence (dry run, live project, rolled back):

```
PROBE 08 gate, real claims        : blocked 42501 / Role assignments require the global USER.MANAGE capability
PROBE 09 gate, claims cleared     : blocked 42501 / Role assignments require the global USER.MANAGE capability
PROBE 10b admin write fires guard : OK (accepted)
```

Probe 10b answers the follow-on question raised by `SECURITY DEFINER`: revoking
`EXECUTE` on the new guard function from `PUBLIC` does **not** stop a legitimate
`authenticated` administrator from firing it, because PostgreSQL records the
trigger binding at `CREATE TRIGGER` time and does not re-check `EXECUTE` when
the trigger fires. Only direct invocation is blocked, and a trigger function
cannot be invoked directly.

Note that both probes target a **non-existent role UUID**. Under the old draft
the second probe would have returned "Role must exist and be active"; now both
return the capability error before any lookup, so the response is identical for
existing and non-existing accounts.

---

## 3. Finding 1 and 2 in detail — the last-administrator invariant

### 3.1 Definition

A **permanent administrator** is a row that satisfies all of:

* `users.account_status = 'active'`
* `user_role_assignments.assignment_status = 'active'`
* `user_role_assignments.bureau_id IS NULL`
* `user_role_assignments.expires_at IS NULL`
* `roles.is_active` and `roles.scope_type = 'global'`
* `role_permissions` links that role to `permissions.is_active`
  with `upper(btrim(code)) = 'USER.MANAGE'`

`USER.MANAGE` is the right anchor: granting a role itself requires
`USER.MANAGE`, so losing the last holder locks administration out completely.

### 3.2 Why "non-expiring"

A guard that only rejects an already-elapsed expiry (`new.expires_at <= now()`)
would still allow an operator to set `expires_at = tomorrow` on the last
administrator and walk away; the lockout would then happen silently with the
passage of time and no further write. Requiring one permanent holder inverts
that: **setting any expiry on the last permanent administrator is rejected
immediately**, whether the value is in the past or the future, and no clock
event can remove the final administrator.

The guard is precise about "this change removed the last one":

* it first returns early if a permanent administrator exists **after** the change;
* otherwise it recomputes from the `OLD` row whether the affected row was a
  permanent administrator.

Consequences:

* A database with no administrator yet (first bootstrap) is never blocked.
* Adding, reviving or extending an administrator is always allowed.
* Changing an unrelated column is not blocked.
* Deleting a role/permission/user cannot slip through: all identity foreign keys
  are `ON DELETE RESTRICT`, and the guard covers the two tables where a delete is
  possible (`user_role_assignments`, `role_permissions`).

### 3.3 Trigger coverage

| Table | Event | `WHEN` | Purpose |
| --- | --- | --- | --- |
| `user_role_assignments` | AFTER UPDATE | old row active + global + permanent, new row revoked / bureau-scoped / given any expiry | self-revocation, future expiry |
| `user_role_assignments` | AFTER DELETE | — | direct removal of the assignment |
| `users` | AFTER UPDATE | active → non-active | self-deactivation / suspension |
| `roles` | AFTER UPDATE | `is_active` or `scope_type` changed | disabling or de-scoping the administrator role |
| `permissions` | AFTER UPDATE | `is_active` or `code` changed | disabling or renaming `USER.MANAGE` |
| `role_permissions` | AFTER UPDATE | `role_id` or `permission_id` changed | re-pointing the grant |
| `role_permissions` | AFTER DELETE | — | removing the grant |

`role_permissions` INSERT is intentionally not guarded (adding a grant cannot
remove the last administrator). No `INSERT` path is guarded, so seeding is
unaffected.

### 3.4 No bypass

The guard has **no escape hatch**. The documented repair path is to add a
replacement administrator first, then remove the old one — the invariant is
always satisfiable by adding first. This is deliberate: any operator bypass
would be a second, weaker authentication path for the same decision.

### 3.5 Data API surface

`role_permissions` writes are revoked from `authenticated`, so the
`ROLE.MANAGE` Data API vector is closed outright; the triggers are defence in
depth for the owner path and for any future reviewed endpoint.

---

## 4. Concurrency safety

### 4.1 Serialisation

`assert_global_administrator_remains()` takes
`pg_advisory_xact_lock(hashtext('aicte_onedesk.last_global_administrator'))`
before its existence check. All removals therefore serialise on one
transaction-scoped key, released at commit or rollback. Row-level `FOR UPDATE`
locking is not used: two sessions may remove *different* administrator rows, so
row locks would not conflict and both could commit.

### 4.2 Fresh snapshot

Blocking on the lock is only useful if the waiting session then observes the
winner's commit. In `READ COMMITTED`, a `STABLE`/`IMMUTABLE` function keeps the
calling statement's snapshot, which would make the post-lock check read stale
data. `assert_global_administrator_remains()` is a plain (VOLATILE) PL/pgSQL
function, so each SPI query takes a fresh snapshot at its own start — *after* the
lock is granted.

### 4.3 Verified on the live project

```
reader blocked while writer holds the lock : True
reader saw the committed row               : True
probe row left behind                      : 0
regions count 6 -> 6
```

The probe inserted a temporary `regions` row inside the writer's transaction,
had a reader block on the same advisory key, committed the writer, and confirmed
that the reader's post-lock `SELECT` observed the committed row. The temporary
row was deleted; no existing row was modified by this probe.

---

## 5. Dry-run evidence (executed before apply, rolled back)

Before applying, the migration was executed against the live project inside a
single transaction with `psql --single-transaction`, followed by 12 behaviour
probes and object / privilege verification, then `ROLLBACK`. **Nothing was
applied by the dry run;** the real apply is recorded in §14.

### 5.1 Behaviour

| Probe | Result |
| --- | --- |
| 01 revoke last administrator (owner path) | blocked `P0001` |
| 02 give the last administrator a **future** expiry | blocked `P0001` |
| 03 deactivate the last administrator's account | blocked `P0001` |
| 04 deactivate `USER.MANAGE` | blocked `P0001` |
| 05 deactivate the administrator role | blocked `P0001` |
| 06 delete the `role_permissions` `USER.MANAGE` grant | blocked `P0001` |
| 07 delete the last assignment | blocked `P0001` |
| 08 F14 gate, ordinary user with real claims | blocked `42501` |
| 09 F14 gate, same user after clearing claims | blocked `42501` |
| 10b administrator writes through `authenticated`, guard fires | accepted (trigger executes; the `EXECUTE` revoke does not block legitimate writers) |
| 10 expiring second administrator does not satisfy the invariant | blocked `P0001` |
| 11 second **permanent** administrator unblocks removal (negative control) | accepted |

### 5.2 Objects and privileges

```
assert_global_administrator_remains | security_definer=t | search_path=""
validate_user_role_assignment       | security_definer=t | search_path=""
7 triggers, all enabled (O)
anon_grants_in_public                   = 0
authenticated_ddl_grants_on_seven       = 0
role_permissions_write_grants           = 0
public_tables                          = 32
```

---

## 6. Live RLS test plan (executed)

Suite file: `backend/tests/test_rls_db.py`. Result: **29 passed, 0 skipped** —
14 pre-existing (one tightened) + 15 new.

| # | New test | Assertion |
| --- | --- | --- |
| 1 | `test_anon_has_no_grants_on_any_public_table` | 0 `anon` grants across the 32 tables (F10) |
| 2 | `test_authenticated_has_no_ddl_privileges_on_business_tables` | no `TRUNCATE`/`REFERENCES`/`TRIGGER` on the seven (F10) |
| 3 | `test_authenticated_cannot_write_the_permission_catalogue` | INSERT/UPDATE/DELETE on `role_permissions` raise `42501` (F12) |
| 3b | `test_authenticated_cannot_delete_role_assignments` | `DELETE` on `user_role_assignments` raises `42501` (F12) |
| 4 | `test_ordinary_user_cannot_create_role_assignment` | the **tightened** pre-existing test: `42501` + capability message (F14) |
| 5 | `test_cleared_claims_do_not_unlock_the_assignment_trigger` | clears `request.jwt.claims`, then `42501` + same message (F14 bypass closed) |
| 6 | `test_last_administrator_cannot_be_revoked` | `P0001`, row unchanged (F12) |
| 7 | `test_last_administrator_cannot_receive_a_future_expiry` | `P0001` for `now() + 30 days` (review point 2) |
| 8 | `test_last_administrator_cannot_be_deactivated` | `P0001` on `users.account_status` |
| 9 | `test_user_manage_permission_cannot_be_deactivated` | `P0001` on `permissions.is_active` |
| 10 | `test_administrator_role_cannot_be_deactivated` | `P0001` on `roles.is_active` (review point 4) |
| 11 | `test_last_administrator_grant_cannot_be_deleted` | `P0001` on the `role_permissions` delete (review point 1) |
| 12 | `test_expiring_second_administrator_does_not_satisfy_the_invariant` | expiring twin + expire the permanent one → `P0001` |
| 13 | `test_revocation_allowed_when_second_permanent_administrator_exists` | negative control: accepted, admin count 1 |
| 14 | `test_concurrent_revocations_cannot_remove_both_administrators` | two connections; first commits, second blocks then raises `P0001`; exactly one removal survives (review point 5) |
| 15 | `test_public_schema_still_has_32_tables` | table count and names unchanged (review point 5) |

Notes:

* Tests 1–13 and 15 run inside `force_rollback` transactions. Test 14 needs two
  real transactions (a rollback cannot prove a committed-blocking interaction),
  so it creates one temporary administrator assignment and removes it in a
  `finally` block; the final assertion re-checks the administrator count.
* Test 13 and 14 use an existing demo user, not a new user row.
* `/me` and all read endpoints are unchanged, so the 14 existing live tests stay
  valid.

### 6.1 Existing tests to update (F11)

* `test_reference_data_writes_are_denied_without_manage` — expect
  `GLOBAL_CAPABILITY_REQUIRED`.
* `test_bureau_membership_management_is_denied_to_bureau_admin` — same.
* `test_ordinary_user_cannot_grant_roles` — tighten to the `42501` capability
  message produced by the F14 gate.

### 6.2 Commands (run in full, after apply)

```powershell
cd backend
python -m pytest -o addopts= -q                       # full suite
python -m pytest -o addopts= -q tests/test_rls_db.py  # live RLS
```

---

## 7. API change (F11, unchanged from the first draft)

Nine write endpoints move from context-aware checks to
`require_global_permission`, matching the RLS policy that guards each write:

| Endpoint | Capability | File |
| --- | --- | --- |
| `POST /regions`, `PATCH /regions/{id}` | `region.manage` | `backend/app/api/v1/regions.py` |
| `POST /bureaus`, `PATCH /bureaus/{id}` | `bureau.manage` | `backend/app/api/v1/bureaus.py` |
| `POST /bureau-memberships`, `POST /bureau-memberships/{id}/end` | `bureau.members.manage` | `backend/app/api/v1/bureaus.py` |
| `POST /institutions`, `PATCH /institutions/{id}` | `institution.manage` | `backend/app/api/v1/institutions.py` |
| `POST /institutions/{id}/aliases` | `institution.alias.manage` | `backend/app/api/v1/institutions.py` |

Callers without the capability receive `403 GLOBAL_CAPABILITY_REQUIRED` instead
of `403 FORBIDDEN`. No current role is affected: only `SUPER_ADMIN` holds any
manage capability, and no bureau-scoped role is granted one.

---

## 8. F8 — durable revocation attribution (REMAINS OPEN)

Not addressed by this migration, and not closed by documentation:

* `user_role_assignments` has only `revoked_at`; there is no `revoked_by_user_id`
  column, and no general audit table among the approved 32.
* Application logs are **not** an adequate audit trail: they are not
  transactional with the data change, are not queryable by the product, and can
  be rotated or lost.
* PRD §7.3 and §9 require auditable decisions with actor/time.

Decision required before Phase 2: approve an additive `revoked_by_user_id`
column (preferred) or designate an approved table as the audit home, or formally
narrow the PRD requirement. Until then Phase 1 must not claim durable revocation
attribution, and no UI may imply it.

---

## 9. PRD decisions still requiring sign-off (12)

Unchanged from the first draft; none are pre-empted by this migration.

1. **Bureau Admin delegation** — remains disabled (`BUREAU_ADMIN` has no
   `USER.MANAGE`, `USER.VIEW` or `BUREAU.MEMBERS.MANAGE`).
2. **Phase 1 role differentiation** — `BUREAU_ADMIN`, `CASE_OFFICER` and
   `CROSS_BUREAU_COLLABORATOR` are identical until case capabilities exist.
3. **Senior Management / Auditor equivalence** — same four read capabilities.
4. **Cross-bureau case index** — permission not defined yet.
5. **Restricted case content** — content permissions not defined; Super Admin
   must not become a blanket content bypass.
6. **Access-request approval designation** — model undefined.
7. **SLA authorisation and versioning** — no official AICTE timelines may be
   invented.
8. **Export** — no capability exists.
9. **Audit history** — blocked on F8.
10. **§15.1/§15.2 case status matrix** — final list and transitions unapproved.
11. **Institution verification transitions** — confirm the Phase 1 constraints.
12. **Duplicate human-review contract** — confirm no automatic merge.

---

## 10. Rollback

The migration removes privileges, replaces one trigger function and adds one
function plus seven triggers. To reverse it (approval required):

```sql
begin;
drop trigger if exists trg_last_admin_assignment_changed on public.user_role_assignments;
drop trigger if exists trg_last_admin_assignment_deleted on public.user_role_assignments;
drop trigger if exists trg_last_admin_user_deactivated on public.users;
drop trigger if exists trg_last_admin_role_changed on public.roles;
drop trigger if exists trg_last_admin_permission_changed on public.permissions;
drop trigger if exists trg_last_admin_grant_changed on public.role_permissions;
drop trigger if exists trg_last_admin_grant_deleted on public.role_permissions;
drop function if exists public.assert_global_administrator_remains();
-- restore the invoker version of validate_user_role_assignment() from
-- docs/CURRENT_SUPABASE_SCHEMA.sql
grant insert, update, delete on table public.role_permissions to authenticated;
grant all on table public.cases, public.case_relationships, public.complaint_categories,
    public.duplicate_candidates, public.institution_verification_tasks,
    public.intake_channels, public.submissions to anon;
grant truncate, references, trigger on table
    public.cases, public.case_relationships, public.complaint_categories,
    public.duplicate_candidates, public.institution_verification_tasks,
    public.intake_channels, public.submissions to authenticated;
commit;
```

No row is created, changed or deleted in either direction, and no table is added
or removed.

---

## 11. Files after approval

| File | Change |
| --- | --- |
| `supabase/migrations/0002_phase1_security_closure.sql` | this migration |
| `backend/app/api/v1/regions.py` | 2 write endpoints → global capability |
| `backend/app/api/v1/bureaus.py` | 4 write endpoints → global capability |
| `backend/app/api/v1/institutions.py` | 3 write endpoints → global capability |
| `backend/tests/test_authorization.py` | error codes for the three updated tests |
| `backend/tests/test_rls_db.py` | 15 new live tests |
| `docs/PHASE1_VERIFICATION.md` | F10/F11/F12/F14 closed, F8 open, results |
| `docs/PHASE1_IMPLEMENTATION.md` | grant/trigger inventory, global-write rule |
| `docs/CURRENT_SUPABASE_SCHEMA.sql` | new function definition, triggers, grants |
| `README.md` | manage endpoints require a global capability |
| `docs/PHASE1_SECURITY_CLOSURE.md` | this document becomes the closure record |

---

## 12. Approval checklist

Approved by the product owner on 28 October 2026, with the instruction that any
migration or test failure must stop the work rather than be bypassed.

1. Approve `0002_phase1_security_closure.sql` (F10 + F12 + F14) for application.
2. Approve the F11 endpoint changes and the `GLOBAL_CAPABILITY_REQUIRED` code.
3. Confirm F8 stays open with no schema change (§8).
4. Confirm Bureau Admin delegation stays disabled.
5. Confirm the 12 PRD decisions stay open for Phase 2 sign-off (§9).
6. Confirm the "permanent administrator" invariant (non-expiring) and that the
   guard has no operator bypass (§3.2, §3.4).

---

## 13. Environment housekeeping

The design probes are the only writes this review performed, and all were
reverted:

* `regions` code `NORTH`: the first probe's no-op `UPDATE` advanced `updated_at`
  through `trg_regions_set_updated_at`. The original value was restored
  (`updated_at = created_at`, the value every other seeded region holds) with the
  trigger disabled for that one statement; the trigger is re-enabled (`O`) and
  `select count(*) from regions where updated_at <> created_at` is now 0.
* Concurrency probe: temporary `regions` row `ZZPROBE` inserted and deleted;
  row count 6 → 6, no leftover.
* No application table was created, dropped or altered.

---

## 14. Applied and verified — 28 October 2026

### 14.1 Apply

```
psql "<DATABASE_URL>" -v ON_ERROR_STOP=1 -f supabase/migrations/0002_phase1_security_closure.sql
```

Exit code 0. The migration ran as one transaction and committed. The connection
string was read from `backend/.env` (gitignored) and never printed.

### 14.2 Post-apply verification

| Check | Expected | Actual |
| --- | --- | --- |
| `validate_user_role_assignment` | `SECURITY DEFINER`, `search_path=""` | as expected |
| `assert_global_administrator_remains` | `SECURITY DEFINER`, `search_path=""` | as expected |
| Last-administrator triggers | 7, enabled | 7, all `O` |
| `anon` grants on all 32 public tables | 0 | 0 |
| `authenticated` `TRUNCATE`/`REFERENCES`/`TRIGGER` | 0 | 0 |
| `authenticated` on `role_permissions` | `SELECT` only | `SELECT` only |
| `public` tables | 32, same set | 32, same set |
| Row counts, all 32 tables | unchanged | unchanged |
| Permanent global administrators | ≥ 1 | 1 |
| `user_role_assignments` | 6 | 6 (none revoked) |

### 14.3 F11 endpoint change

Nine write endpoints now use `require_global_permission`:
`POST/PATCH /regions`, `POST/PATCH /bureaus`, `POST /bureau-memberships`,
`POST /bureau-memberships/{id}/end`, `POST/PATCH /institutions`,
`POST /institutions/{id}/aliases`. Read endpoints are unchanged, and the
bureau-scoped read helper (`require_bureau_capability`) is retained for
`GET /bureaus/{id}/members`.

### 14.4 Test results (actual)

| Command | Result |
| --- | --- |
| `python -m pytest -o addopts= -q --ignore=tests/test_rls_db.py` | `119 passed, 13 warnings` |
| `python -m pytest -o addopts= -q tests/test_rls_db.py` | `29 passed, 0 skipped` |
| `python -m pytest -o addopts= -q` | **`148 passed, 0 skipped, 13 warnings`** |

One failure occurred during the first live run: the concurrency test's cleanup
helper connected without `row_factory=dict_row` and raised `TypeError` while
reading the post-test administrator count. The helper was fixed and the test
re-run (`1 passed`); the database was then verified as 6 assignments / 1
permanent administrator / 0 revoked, and the full suite passed. No security
assertion was relaxed to obtain a pass.

### 14.5 Remaining security issues

1. **F8 — durable revocation attribution (UNRESOLVED).** Still no
   `revoked_by_user_id` column and no audit table among the 32. Application logs
   are explicitly not treated as an adequate audit trail.
2. **F9 — `shares_bureau_with()`** remains unused and does not check
   `bureaus.is_active`; keep it reserved or verify before Phase 2 use.
3. **F13 — `users.is_super_admin`** remains dormant and must not be used for
   authorization.
4. **Capability-catalogue writes have no endpoint.** `role_permissions` is
   `SELECT`-only through the Data API; a future role-management feature needs a
   reviewed endpoint or a guarded definer operation.
5. **`service_role` is trusted by the F14 gate** because a secret-key holder
   already has full data access by design. Phase 1 has no `service_role`
   application path; a future one must not be given a capability-bypass role.
6. **Twelve PRD decisions remain unsigned** (§9), including Bureau Admin
   delegation, which stays disabled.
7. **Business-table `DELETE`/`MAINTAIN` grants remain.** `authenticated` keeps the
   baseline `SELECT/INSERT/UPDATE/DELETE/MAINTAIN` grant on the seven
   non-Phase-1 tables. They have no policies, so every row is denied today, but
   the grant set should be narrowed when Phase 2 adds policies. F10's approved
   scope covered `anon` plus `TRUNCATE`/`REFERENCES`/`TRIGGER`, so this was not
   changed here.
8. **Phase 2 must not start** until the §9 decisions and the F8 decision are
   recorded.

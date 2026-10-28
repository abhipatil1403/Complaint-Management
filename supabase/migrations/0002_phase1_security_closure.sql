-- =============================================================================
-- AICTE OneDesk - Phase 1 security closure (F10, F12, F14)
--
-- Additive and non-destructive. It creates no table, no column and no
-- permission, and changes no application row.
--
--   F10  Remove the `anon` grants the Data API still exposes on the seven
--        non-Phase-1 tables, and drop the TRUNCATE/REFERENCES/TRIGGER
--        privileges from `authenticated` (PostgREST never needs them).
--
--   F12  Keep at least one permanent global administrator. "Permanent" means an
--        active user with an active, non-expiring, global assignment to an
--        active global role that grants an active USER.MANAGE permission. The
--        guard fires on every path that can remove that capability:
--        assignment revocation/deletion/expiry, account deactivation, role
--        deactivation or re-scoping, permission deactivation or renaming, and
--        removal or reassignment of a role_permissions grant.
--        It also removes the direct Data API write grants on `role_permissions`
--        (Phase 1 has no role-catalogue write endpoint).
--
--   F14  Make validate_user_role_assignment() SECURITY DEFINER so its locking
--        reads are not filtered by the caller's policies. The `auth_uid() IS
--        NULL` bypass is replaced with a session-trust check, because
--        `request.jwt.claims` is client-settable and `auth_uid()` therefore
--        cannot prove that a caller is trusted.
--
-- Bureau Admin delegation stays disabled: no grant or policy below widens a
-- bureau-scoped role's reach.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- F10. `anon` must hold no privilege on business tables
-- -----------------------------------------------------------------------------
revoke all on table
    public.cases,
    public.case_relationships,
    public.complaint_categories,
    public.duplicate_candidates,
    public.institution_verification_tasks,
    public.intake_channels,
    public.submissions
from anon;

-- DDL-ish privileges are never used by the Data API and are not needed by an
-- application role. Row data and the RLS flags are untouched.
revoke truncate, references, trigger on table
    public.cases,
    public.case_relationships,
    public.complaint_categories,
    public.duplicate_candidates,
    public.institution_verification_tasks,
    public.intake_channels,
    public.submissions
from authenticated;

-- -----------------------------------------------------------------------------
-- F12(a). The role catalogue is read-only through the Data API in Phase 1.
-- There is no role-management endpoint; catalogue changes are made by an
-- operator (table owner) or by a future reviewed endpoint. Keeping the write
-- grant would let a ROLE.MANAGE holder delete the last administrator's
-- capability without any audited route.
-- -----------------------------------------------------------------------------
revoke insert, update, delete on table public.role_permissions from authenticated;

-- -----------------------------------------------------------------------------
-- F14. Role-assignment validation.
--
-- Body unchanged except for SECURITY DEFINER and the caller gate. The locking
-- reads (FOR SHARE) must see the real rows: with the previous invoker context,
-- PostgreSQL also applied the UPDATE policy to the locking read, so an
-- administrator who did not also hold BUREAU.MANAGE / ROLE.MANAGE saw "Role
-- must exist and be active" for valid rows.
--
-- The gate cannot use `auth_uid() IS NULL`: `request.jwt.claims` is a
-- GUC that any Data API session can clear, which makes auth_uid() return NULL
-- (probe verified on the live project). It keys off the session instead:
--
--   * role = 'service_role'                  -> trusted (secret-key holder)
--   * role in ('authenticated','anon',
--              'authenticator')              -> untrusted
--   * no role set, session_user superuser
--     or BYPASSRLS                           -> trusted operator session
--   * anything else (e.g. RESET ROLE on a
--     Data API connection, role = 'none'
--     with session_user = 'authenticator')   -> untrusted
--
-- An untrusted session must hold the global USER.MANAGE capability before the
-- body runs, so the definer context cannot be used to probe whether an
-- arbitrary UUID is an existing, active account.
-- -----------------------------------------------------------------------------
create or replace function public.validate_user_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    trusted_session boolean;
    required_scope text;
    role_enabled boolean;
    user_enabled boolean;
    bureau_enabled boolean;
    has_active_membership boolean;
begin
    select coalesce(pg_catalog.current_setting('role', true), 'none') = 'service_role'
           or (
               coalesce(pg_catalog.current_setting('role', true), 'none')
                   not in ('authenticated', 'anon', 'authenticator')
               and exists (
                   select 1
                     from pg_catalog.pg_roles
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

    select scope_type, is_active
      into required_scope, role_enabled
      from public.roles
     where id = new.role_id
       for share;

    if not found or role_enabled is distinct from true then
        raise exception 'Role must exist and be active';
    end if;

    if required_scope = 'global'
       and new.bureau_id is not null then
        raise exception 'Global roles cannot have a bureau_id';
    end if;

    if required_scope = 'bureau'
       and new.bureau_id is null then
        raise exception 'Bureau-scoped roles require a bureau_id';
    end if;

    if new.assignment_status = 'active' then
        select account_status = 'active'
          into user_enabled
          from public.users
         where id = new.user_id
           for share;

        if user_enabled is distinct from true then
            raise exception 'Active role assignments require an active user';
        end if;

        if new.bureau_id is not null then
            select is_active
              into bureau_enabled
              from public.bureaus
             where id = new.bureau_id
               for share;

            if bureau_enabled is distinct from true then
                raise exception 'Bureau-scoped role requires an active bureau';
            end if;

            select exists (
                select 1
                  from public.bureau_memberships
                 where user_id = new.user_id
                   and bureau_id = new.bureau_id
                   and membership_status = 'active'
            )
            into has_active_membership;

            if has_active_membership is distinct from true then
                raise exception 'User must have active bureau membership';
            end if;
        end if;
    end if;

    return new;
end;
$function$;

-- -----------------------------------------------------------------------------
-- F12(b). Last-administrator guard.
--
-- The invariant is "at least one permanent administrator remains". Requiring a
-- non-expiring assignment (expires_at IS NULL) is what makes the guard
-- future-proof: a guard that only rejects an already-elapsed expiry would still
-- allow an operator to expire the last administrator tomorrow, and the lockout
-- would happen silently with the passage of time. With this invariant, setting
-- any expiry - past or future - on the last permanent administrator is rejected
-- at write time, and no clock event can remove the final administrator.
--
-- The guard only blocks a change that removes administrator status. A database
-- with no administrator yet (first bootstrap) is therefore never blocked, and
-- adding or reviving an administrator is always permitted.
--
-- Removals are serialised with a transaction-scoped advisory lock taken before
-- the existence check. The function is VOLATILE (PL/pgSQL default), so each SPI
-- query inside it takes a fresh snapshot after the lock is granted; a session
-- that waited for a concurrent removal therefore observes that commit instead
-- of its own stale snapshot (probe verified on the live project).
-- -----------------------------------------------------------------------------
create or replace function public.assert_global_administrator_remains()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    row_was_administrator boolean := false;
begin
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('aicte_onedesk.last_global_administrator')
    );

    -- Fast path: a permanent administrator still exists after this change.
    if exists (
        select 1
          from public.user_role_assignments ura
          join public.roles r
            on r.id = ura.role_id
           and r.is_active
           and r.scope_type = 'global'
          join public.role_permissions rp
            on rp.role_id = r.id
          join public.permissions p
            on p.id = rp.permission_id
           and p.is_active
          join public.users u
            on u.id = ura.user_id
           and u.account_status = 'active'
         where ura.bureau_id is null
           and ura.assignment_status = 'active'
           and ura.expires_at is null
           and upper(btrim(p.code)) = 'USER.MANAGE'
    ) then
        return null;
    end if;

    -- Did this event remove an administrator? Evaluate the OLD row only, so the
    -- check is true exactly when the change took the last holder away.
    case tg_table_name
        when 'user_role_assignments' then
            row_was_administrator :=
                old.bureau_id is null
                and old.assignment_status = 'active'
                and old.expires_at is null
                and exists (
                    select 1
                      from public.users u
                     where u.id = old.user_id
                       and u.account_status = 'active'
                )
                and exists (
                    select 1
                      from public.roles r
                      join public.role_permissions rp
                        on rp.role_id = r.id
                      join public.permissions p
                        on p.id = rp.permission_id
                     where r.id = old.role_id
                       and r.is_active
                       and r.scope_type = 'global'
                       and p.is_active
                       and upper(btrim(p.code)) = 'USER.MANAGE'
                );

        when 'users' then
            row_was_administrator :=
                old.account_status = 'active'
                and exists (
                    select 1
                      from public.user_role_assignments ura
                      join public.roles r
                        on r.id = ura.role_id
                       and r.is_active
                       and r.scope_type = 'global'
                      join public.role_permissions rp
                        on rp.role_id = r.id
                      join public.permissions p
                        on p.id = rp.permission_id
                       and p.is_active
                     where ura.user_id = old.id
                       and ura.bureau_id is null
                       and ura.assignment_status = 'active'
                       and ura.expires_at is null
                       and upper(btrim(p.code)) = 'USER.MANAGE'
                );

        when 'roles' then
            row_was_administrator :=
                old.is_active
                and old.scope_type = 'global'
                and exists (
                    select 1
                      from public.role_permissions rp
                      join public.permissions p
                        on p.id = rp.permission_id
                       and p.is_active
                      join public.user_role_assignments ura
                        on ura.role_id = rp.role_id
                      join public.users u
                        on u.id = ura.user_id
                       and u.account_status = 'active'
                     where rp.role_id = old.id
                       and upper(btrim(p.code)) = 'USER.MANAGE'
                       and ura.bureau_id is null
                       and ura.assignment_status = 'active'
                       and ura.expires_at is null
                );

        when 'permissions' then
            row_was_administrator :=
                old.is_active
                and upper(btrim(old.code)) = 'USER.MANAGE'
                and exists (
                    select 1
                      from public.roles r
                      join public.role_permissions rp
                        on rp.role_id = r.id
                       and rp.permission_id = old.id
                      join public.user_role_assignments ura
                        on ura.role_id = r.id
                      join public.users u
                        on u.id = ura.user_id
                       and u.account_status = 'active'
                     where r.is_active
                       and r.scope_type = 'global'
                       and ura.bureau_id is null
                       and ura.assignment_status = 'active'
                       and ura.expires_at is null
                );

        when 'role_permissions' then
            row_was_administrator :=
                exists (
                    select 1
                      from public.roles r
                      join public.permissions p
                        on p.id = old.permission_id
                       and p.is_active
                      join public.user_role_assignments ura
                        on ura.role_id = r.id
                      join public.users u
                        on u.id = ura.user_id
                       and u.account_status = 'active'
                     where r.id = old.role_id
                       and r.is_active
                       and r.scope_type = 'global'
                       and upper(btrim(p.code)) = 'USER.MANAGE'
                       and ura.bureau_id is null
                       and ura.assignment_status = 'active'
                       and ura.expires_at is null
                );

        else
            row_was_administrator := false;
    end case;

    if row_was_administrator then
        raise exception 'The last permanent global administrator cannot be removed'
            using errcode = 'P0001',
                  hint = 'Add a replacement administrator with an active, non-expiring USER.MANAGE grant first.';
    end if;

    return null;
end;
$function$;

revoke all on function public.assert_global_administrator_remains() from public;

-- Assignment revoked, re-scoped to a bureau, or given any expiry (past or
-- future) while it was the last permanent administrator.
drop trigger if exists trg_last_admin_assignment_changed on public.user_role_assignments;
create trigger trg_last_admin_assignment_changed
    after update on public.user_role_assignments
    for each row
    when (
        old.bureau_id is null
        and old.assignment_status = 'active'
        and old.expires_at is null
        and (
            new.assignment_status is distinct from 'active'
            or new.bureau_id is not null
            or new.expires_at is not null
        )
    )
    execute function public.assert_global_administrator_remains();

drop trigger if exists trg_last_admin_assignment_deleted on public.user_role_assignments;
create trigger trg_last_admin_assignment_deleted
    after delete on public.user_role_assignments
    for each row
    execute function public.assert_global_administrator_remains();

-- Account deactivated or suspended.
drop trigger if exists trg_last_admin_user_deactivated on public.users;
create trigger trg_last_admin_user_deactivated
    after update on public.users
    for each row
    when (old.account_status = 'active' and new.account_status is distinct from 'active')
    execute function public.assert_global_administrator_remains();

-- Role deactivated or re-scoped away from a global role.
drop trigger if exists trg_last_admin_role_changed on public.roles;
create trigger trg_last_admin_role_changed
    after update on public.roles
    for each row
    when (
        old.is_active is distinct from new.is_active
        or old.scope_type is distinct from new.scope_type
    )
    execute function public.assert_global_administrator_remains();

-- Permission deactivated or renamed away from USER.MANAGE.
drop trigger if exists trg_last_admin_permission_changed on public.permissions;
create trigger trg_last_admin_permission_changed
    after update on public.permissions
    for each row
    when (
        old.is_active is distinct from new.is_active
        or old.code is distinct from new.code
    )
    execute function public.assert_global_administrator_remains();

-- A role/permission grant removed or pointed at another pair. Defence in depth:
-- the Data API write grants are revoked above, but the owner path still cannot
-- strip the last administrator.
drop trigger if exists trg_last_admin_grant_changed on public.role_permissions;
create trigger trg_last_admin_grant_changed
    after update on public.role_permissions
    for each row
    when (
        old.role_id is distinct from new.role_id
        or old.permission_id is distinct from new.permission_id
    )
    execute function public.assert_global_administrator_remains();

drop trigger if exists trg_last_admin_grant_deleted on public.role_permissions;
create trigger trg_last_admin_grant_deleted
    after delete on public.role_permissions
    for each row
    execute function public.assert_global_administrator_remains();

commit;

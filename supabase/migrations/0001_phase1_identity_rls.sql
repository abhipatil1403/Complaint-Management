-- =============================================================================
-- AICTE OneDesk - Phase 1: identity, authorization and reference data
--
-- Scope of this migration (additive only):
--   * helper functions that read the verified JWT claims already published on
--     the connection by the FastAPI service (request.jwt.claims),
--   * row level security policies for the ten Phase 1 tables,
--   * least-privilege grants for the `authenticated` role and removal of
--     `anon` access.
--
-- It does NOT create, rename, drop or alter any of the 32 application tables
-- and does not add columns. Reference data is deactivated, never deleted.
--
-- Design notes
--   * `has_permission` is context aware: a grant made by a bureau-scoped role
--     only counts while that bureau is the caller's active context. The API
--     passes the validated `X-Active-Bureau` value as `active_bureau_id` in the
--     claims it publishes to PostgreSQL. Direct PostgREST access (which cannot
--     set that claim) therefore only ever receives global grants (fail closed).
--   * `has_global_permission` ignores bureau context and is used by every write
--     policy: no bureau-scoped role may write reference or identity data, even
--     if the role catalogue changes later.
--   * Every helper is SECURITY DEFINER with an empty search_path so policy
--     evaluation is not affected by caller-controlled schemas, and all
--     identifiers are schema qualified.
--   * Super Admin is an administrative role, not a content-access bypass:
--     these policies grant only the Phase 1 capabilities that exist today.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Claim helpers (no table access)
-- -----------------------------------------------------------------------------
create or replace function public.jwt_claims()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select coalesce(
               nullif(current_setting('request.jwt.claims', true), '')::jsonb,
               '{}'::jsonb
           );
$$;

create or replace function public.jwt_uuid_claim(p_claim text)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
    select case
               when public.jwt_claims() ->> p_claim
                    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then (public.jwt_claims() ->> p_claim)::uuid
           end;
$$;

create or replace function public.auth_uid()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
    select public.jwt_uuid_claim('sub');
$$;

create or replace function public.active_bureau_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
    select public.jwt_uuid_claim('active_bureau_id');
$$;

-- -----------------------------------------------------------------------------
-- 2. Authorization helpers (read the identity tables as the function owner)
-- -----------------------------------------------------------------------------
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
          from public.users u
         where u.id = public.auth_uid()
           and u.account_status = 'active'
    );
$$;

create or replace function public.has_global_permission(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
          from public.user_role_assignments ura
          join public.roles r
            on r.id = ura.role_id
           and r.is_active
           -- Defence in depth: a bureau-scoped role must never count as a
           -- global grant even if its bureau_id is null (the schema trigger
           -- already rejects that shape).
           and r.scope_type = 'global'
          join public.role_permissions rp
            on rp.role_id = r.id
          join public.permissions p
            on p.id = rp.permission_id
           and p.is_active
         where ura.user_id = public.auth_uid()
           and ura.bureau_id is null
           and ura.assignment_status = 'active'
           and (ura.expires_at is null or ura.expires_at > now())
           and upper(btrim(p.code)) = upper(btrim(p_code))
           and exists (
               select 1
                 from public.users u
                where u.id = ura.user_id
                  and u.account_status = 'active'
           )
    );
$$;

create or replace function public.has_permission(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.has_global_permission(p_code)
        or exists (
            select 1
              from public.user_role_assignments ura
              join public.roles r
                on r.id = ura.role_id
               and r.is_active
               and r.scope_type = 'bureau'
              join public.role_permissions rp
                on rp.role_id = r.id
              join public.permissions p
                on p.id = rp.permission_id
               and p.is_active
             where ura.user_id = public.auth_uid()
               and ura.bureau_id is not null
               and ura.bureau_id = public.active_bureau_id()
               and ura.assignment_status = 'active'
               and (ura.expires_at is null or ura.expires_at > now())
               and upper(btrim(p.code)) = upper(btrim(p_code))
               and exists (
                   select 1
                     from public.bureau_memberships bm
                     join public.bureaus b on b.id = bm.bureau_id
                    where bm.user_id = ura.user_id
                      and bm.bureau_id = ura.bureau_id
                      and bm.membership_status = 'active'
                      and (bm.ended_at is null or bm.ended_at > now())
                      and b.is_active
               )
               and exists (
                   select 1
                     from public.users u
                    where u.id = ura.user_id
                      and u.account_status = 'active'
               )
        );
$$;

create or replace function public.is_bureau_member(p_bureau_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
          from public.bureau_memberships bm
          join public.bureaus b on b.id = bm.bureau_id
         where bm.user_id = public.auth_uid()
           and bm.bureau_id = p_bureau_id
           and bm.membership_status = 'active'
           and (bm.ended_at is null or bm.ended_at > now())
           and b.is_active
    );
$$;

create or replace function public.shares_bureau_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
          from public.bureau_memberships mine
          join public.bureau_memberships theirs
            on theirs.bureau_id = mine.bureau_id
         where mine.user_id = public.auth_uid()
           and mine.membership_status = 'active'
           and (mine.ended_at is null or mine.ended_at > now())
           and theirs.user_id = p_user_id
           and theirs.membership_status = 'active'
           and (theirs.ended_at is null or theirs.ended_at > now())
    );
$$;

-- Helper functions must not be usable without a verified access token.
revoke all on function public.jwt_claims() from public;
revoke all on function public.jwt_uuid_claim(text) from public;
revoke all on function public.auth_uid() from public;
revoke all on function public.active_bureau_id() from public;
revoke all on function public.is_active_user() from public;
revoke all on function public.has_global_permission(text) from public;
revoke all on function public.has_permission(text) from public;
revoke all on function public.is_bureau_member(uuid) from public;
revoke all on function public.shares_bureau_with(uuid) from public;

revoke all on function public.jwt_claims() from anon;
revoke all on function public.jwt_uuid_claim(text) from anon;
revoke all on function public.auth_uid() from anon;
revoke all on function public.active_bureau_id() from anon;
revoke all on function public.is_active_user() from anon;
revoke all on function public.has_global_permission(text) from anon;
revoke all on function public.has_permission(text) from anon;
revoke all on function public.is_bureau_member(uuid) from anon;
revoke all on function public.shares_bureau_with(uuid) from anon;

grant execute on function public.jwt_claims() to authenticated, service_role;
grant execute on function public.jwt_uuid_claim(text) to authenticated, service_role;
grant execute on function public.auth_uid() to authenticated, service_role;
grant execute on function public.active_bureau_id() to authenticated, service_role;
grant execute on function public.is_active_user() to authenticated, service_role;
grant execute on function public.has_global_permission(text) to authenticated, service_role;
grant execute on function public.has_permission(text) to authenticated, service_role;
grant execute on function public.is_bureau_member(uuid) to authenticated, service_role;
grant execute on function public.shares_bureau_with(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Table grants (RLS still filters every row)
-- -----------------------------------------------------------------------------
revoke all on table public.users from anon;
revoke all on table public.roles from anon;
revoke all on table public.permissions from anon;
revoke all on table public.role_permissions from anon;
revoke all on table public.user_role_assignments from anon;
revoke all on table public.bureaus from anon;
revoke all on table public.bureau_memberships from anon;
revoke all on table public.regions from anon;
revoke all on table public.institutions from anon;
revoke all on table public.institution_aliases from anon;

revoke all on table public.users from authenticated;
revoke all on table public.roles from authenticated;
revoke all on table public.permissions from authenticated;
revoke all on table public.role_permissions from authenticated;
revoke all on table public.user_role_assignments from authenticated;
revoke all on table public.bureaus from authenticated;
revoke all on table public.bureau_memberships from authenticated;
revoke all on table public.regions from authenticated;
revoke all on table public.institutions from authenticated;
revoke all on table public.institution_aliases from authenticated;

grant select, update on table public.users to authenticated;

grant select, insert, update on table public.roles to authenticated;
grant select, insert, update on table public.permissions to authenticated;
grant select, insert, update, delete on table public.role_permissions to authenticated;

grant select, insert, update on table public.user_role_assignments to authenticated;

grant select, insert, update on table public.bureaus to authenticated;
grant select, insert, update on table public.bureau_memberships to authenticated;

grant select, insert, update on table public.regions to authenticated;
grant select, insert, update on table public.institutions to authenticated;
grant select, insert, update on table public.institution_aliases to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Row level security policies
-- -----------------------------------------------------------------------------

-- users ----------------------------------------------------------------------
drop policy if exists phase1_users_select on public.users;
create policy phase1_users_select on public.users
    for select
    to authenticated
    using (
        id = public.auth_uid()
        or public.has_global_permission('USER.VIEW')
        or public.has_global_permission('USER.MANAGE')
    );

-- There is intentionally no self-update policy. Profile administration is a
-- global USER.MANAGE capability; a self-service update policy would also let a
-- signed-in user write privileged columns (is_super_admin, account_status)
-- through the exposed PostgREST API. The drop also removes the policy if an
-- earlier draft of this migration was applied locally.
drop policy if exists phase1_users_update_self on public.users;

drop policy if exists phase1_users_update_admin on public.users;
create policy phase1_users_update_admin on public.users
    for update
    to authenticated
    using (public.has_global_permission('USER.MANAGE'))
    with check (public.has_global_permission('USER.MANAGE'));

-- roles / permissions / role_permissions --------------------------------------
-- The capability catalogue is not sensitive: every active user needs it to
-- resolve their own effective permissions for /me.
drop policy if exists phase1_roles_select on public.roles;
create policy phase1_roles_select on public.roles
    for select
    to authenticated
    using (public.is_active_user());

drop policy if exists phase1_roles_insert on public.roles;
create policy phase1_roles_insert on public.roles
    for insert
    to authenticated
    with check (public.has_global_permission('ROLE.MANAGE'));

drop policy if exists phase1_roles_update on public.roles;
create policy phase1_roles_update on public.roles
    for update
    to authenticated
    using (public.has_global_permission('ROLE.MANAGE'))
    with check (public.has_global_permission('ROLE.MANAGE'));

drop policy if exists phase1_permissions_select on public.permissions;
create policy phase1_permissions_select on public.permissions
    for select
    to authenticated
    using (public.is_active_user());

drop policy if exists phase1_permissions_insert on public.permissions;
create policy phase1_permissions_insert on public.permissions
    for insert
    to authenticated
    with check (public.has_global_permission('ROLE.MANAGE'));

drop policy if exists phase1_permissions_update on public.permissions;
create policy phase1_permissions_update on public.permissions
    for update
    to authenticated
    using (public.has_global_permission('ROLE.MANAGE'))
    with check (public.has_global_permission('ROLE.MANAGE'));

drop policy if exists phase1_role_permissions_select on public.role_permissions;
create policy phase1_role_permissions_select on public.role_permissions
    for select
    to authenticated
    using (public.is_active_user());

drop policy if exists phase1_role_permissions_insert on public.role_permissions;
create policy phase1_role_permissions_insert on public.role_permissions
    for insert
    to authenticated
    with check (public.has_global_permission('ROLE.MANAGE'));

drop policy if exists phase1_role_permissions_update on public.role_permissions;
create policy phase1_role_permissions_update on public.role_permissions
    for update
    to authenticated
    using (public.has_global_permission('ROLE.MANAGE'))
    with check (public.has_global_permission('ROLE.MANAGE'));

drop policy if exists phase1_role_permissions_delete on public.role_permissions;
create policy phase1_role_permissions_delete on public.role_permissions
    for delete
    to authenticated
    using (public.has_global_permission('ROLE.MANAGE'));

-- user_role_assignments -------------------------------------------------------
drop policy if exists phase1_user_role_assignments_select on public.user_role_assignments;
create policy phase1_user_role_assignments_select on public.user_role_assignments
    for select
    to authenticated
    using (
        user_id = public.auth_uid()
        or public.has_global_permission('USER.VIEW')
        or public.has_global_permission('USER.MANAGE')
    );

drop policy if exists phase1_user_role_assignments_insert on public.user_role_assignments;
create policy phase1_user_role_assignments_insert on public.user_role_assignments
    for insert
    to authenticated
    with check (public.has_global_permission('USER.MANAGE'));

drop policy if exists phase1_user_role_assignments_update on public.user_role_assignments;
create policy phase1_user_role_assignments_update on public.user_role_assignments
    for update
    to authenticated
    using (public.has_global_permission('USER.MANAGE'))
    with check (public.has_global_permission('USER.MANAGE'));

-- regions --------------------------------------------------------------------
drop policy if exists phase1_regions_select on public.regions;
create policy phase1_regions_select on public.regions
    for select
    to authenticated
    using (
        public.has_permission('REGION.VIEW')
        or public.has_permission('REGION.MANAGE')
    );

drop policy if exists phase1_regions_insert on public.regions;
create policy phase1_regions_insert on public.regions
    for insert
    to authenticated
    with check (public.has_global_permission('REGION.MANAGE'));

drop policy if exists phase1_regions_update on public.regions;
create policy phase1_regions_update on public.regions
    for update
    to authenticated
    using (public.has_global_permission('REGION.MANAGE'))
    with check (public.has_global_permission('REGION.MANAGE'));

-- institutions ---------------------------------------------------------------
drop policy if exists phase1_institutions_select on public.institutions;
create policy phase1_institutions_select on public.institutions
    for select
    to authenticated
    using (
        public.has_permission('INSTITUTION.VIEW')
        or public.has_permission('INSTITUTION.MANAGE')
    );

drop policy if exists phase1_institutions_insert on public.institutions;
create policy phase1_institutions_insert on public.institutions
    for insert
    to authenticated
    with check (public.has_global_permission('INSTITUTION.MANAGE'));

drop policy if exists phase1_institutions_update on public.institutions;
create policy phase1_institutions_update on public.institutions
    for update
    to authenticated
    using (public.has_global_permission('INSTITUTION.MANAGE'))
    with check (public.has_global_permission('INSTITUTION.MANAGE'));

-- institution_aliases --------------------------------------------------------
drop policy if exists phase1_institution_aliases_select on public.institution_aliases;
create policy phase1_institution_aliases_select on public.institution_aliases
    for select
    to authenticated
    using (
        public.has_permission('INSTITUTION.ALIAS.VIEW')
        or public.has_permission('INSTITUTION.ALIAS.MANAGE')
    );

drop policy if exists phase1_institution_aliases_insert on public.institution_aliases;
create policy phase1_institution_aliases_insert on public.institution_aliases
    for insert
    to authenticated
    with check (public.has_global_permission('INSTITUTION.ALIAS.MANAGE'));

drop policy if exists phase1_institution_aliases_update on public.institution_aliases;
create policy phase1_institution_aliases_update on public.institution_aliases
    for update
    to authenticated
    using (public.has_global_permission('INSTITUTION.ALIAS.MANAGE'))
    with check (public.has_global_permission('INSTITUTION.ALIAS.MANAGE'));

-- bureaus --------------------------------------------------------------------
-- Bureau names are needed to render the caller's own memberships; they are not
-- sensitive. Writes are restricted to the global capability.
drop policy if exists phase1_bureaus_select on public.bureaus;
create policy phase1_bureaus_select on public.bureaus
    for select
    to authenticated
    using (public.is_active_user());

drop policy if exists phase1_bureaus_insert on public.bureaus;
create policy phase1_bureaus_insert on public.bureaus
    for insert
    to authenticated
    with check (public.has_global_permission('BUREAU.MANAGE'));

drop policy if exists phase1_bureaus_update on public.bureaus;
create policy phase1_bureaus_update on public.bureaus
    for update
    to authenticated
    using (public.has_global_permission('BUREAU.MANAGE'))
    with check (public.has_global_permission('BUREAU.MANAGE'));

-- bureau_memberships ---------------------------------------------------------
-- A caller sees their own rows, and the members of a bureau only while that
-- bureau is their active context (or when they hold a global capability).
drop policy if exists phase1_bureau_memberships_select on public.bureau_memberships;
create policy phase1_bureau_memberships_select on public.bureau_memberships
    for select
    to authenticated
    using (
        user_id = public.auth_uid()
        or public.has_global_permission('BUREAU.MEMBERS.VIEW')
        or public.has_global_permission('BUREAU.MEMBERS.MANAGE')
        or public.has_global_permission('BUREAU.MANAGE')
        or (
            bureau_id = public.active_bureau_id()
            and (
                public.has_permission('BUREAU.MEMBERS.VIEW')
                or public.has_permission('BUREAU.MEMBERS.MANAGE')
            )
        )
    );

drop policy if exists phase1_bureau_memberships_insert on public.bureau_memberships;
create policy phase1_bureau_memberships_insert on public.bureau_memberships
    for insert
    to authenticated
    with check (public.has_global_permission('BUREAU.MEMBERS.MANAGE'));

drop policy if exists phase1_bureau_memberships_update on public.bureau_memberships;
create policy phase1_bureau_memberships_update on public.bureau_memberships
    for update
    to authenticated
    using (public.has_global_permission('BUREAU.MEMBERS.MANAGE'))
    with check (public.has_global_permission('BUREAU.MEMBERS.MANAGE'));

commit;

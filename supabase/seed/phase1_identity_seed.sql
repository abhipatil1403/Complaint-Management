-- =============================================================================
-- AICTE OneDesk - Phase 1 demo seed (ILLUSTRATIVE DATA ONLY)
--
-- Contains no real AICTE institution records, approvals or timelines. Names and
-- identifiers are prefixed DEMO-/Demo on purpose. Run after
-- migrations/0001_phase1_identity_rls.sql.
--
-- Idempotent: safe to re-run. Catalogue rows are updated in place, reference
-- rows are upserted, and nothing is hard-deleted.
--
-- Demo *people* are created by scripts/seed_demo_users.py because users.id is
-- the Supabase Auth identity (FK users_auth_fk).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Permission catalogue (codes are UPPERCASE because of permissions_code_format;
-- the API exposes them as lowercase dotted codes)
-- -----------------------------------------------------------------------------
insert into public.permissions (code, name, description, resource_type, action_type)
values
    ('REGION.VIEW',              'View regions',                    'Read region reference data.',                                   'region',            'view'),
    ('REGION.MANAGE',            'Manage regions',                  'Create and deactivate regions.',                                'region',            'manage'),
    ('INSTITUTION.VIEW',         'View institutions',               'Read institution master data.',                                 'institution',       'view'),
    ('INSTITUTION.MANAGE',       'Manage institutions',             'Create, update and verify institution records.',                'institution',       'manage'),
    ('INSTITUTION.ALIAS.VIEW',   'View institution aliases',        'Read institution alias history.',                               'institution.alias', 'view'),
    ('INSTITUTION.ALIAS.MANAGE', 'Manage institution aliases',      'Add and deactivate institution aliases with provenance.',       'institution.alias', 'manage'),
    ('BUREAU.VIEW',              'View bureaus',                    'Read bureau reference data.',                                   'bureau',            'view'),
    ('BUREAU.MANAGE',            'Manage bureaus',                  'Create and deactivate bureaus.',                                'bureau',            'manage'),
    ('BUREAU.MEMBERS.VIEW',      'View bureau members',             'Read the member list of a bureau.',                             'bureau.members',    'view'),
    ('BUREAU.MEMBERS.MANAGE',    'Manage bureau members',           'Add and end bureau memberships.',                               'bureau.members',    'manage'),
    ('USER.VIEW',                'View authorized users',           'Read authorized user profiles and role grants.',                'user',              'view'),
    ('USER.MANAGE',              'Manage users',                    'Update profiles, account status and role grants.',              'user',              'manage'),
    ('ROLE.VIEW',                'View role catalogue',             'Read roles and their permissions.',                             'role',              'view'),
    ('ROLE.MANAGE',              'Manage role catalogue',           'Create roles and change role-permission grants.',               'role',              'manage')
on conflict (code) do update
    set name          = excluded.name,
        description   = excluded.description,
        resource_type = excluded.resource_type,
        action_type   = excluded.action_type,
        is_active     = true,
        updated_at    = now();

-- -----------------------------------------------------------------------------
-- Persona roles (PRD 7.1). Scope and permissions mirror
-- backend/app/auth/permissions.py; tests assert the two stay in sync.
-- -----------------------------------------------------------------------------
insert into public.roles (code, name, description, scope_type, is_system_role)
values
    ('SUPER_ADMIN', 'Super Admin',
     'Manages reference data, authorized users and memberships. Restricted case content still requires an explicit permission.',
     'global', true),
    ('BUREAU_ADMIN', 'Bureau Administrator',
     'Administers work inside one bureau. Membership-management delegation is not defined in Phase 1, so it stays read-only for staff.',
     'bureau', true),
    ('CASE_OFFICER', 'Case Officer',
     'Works assigned case tasks within a bureau.',
     'bureau', true),
    ('CROSS_BUREAU_COLLABORATOR', 'Cross-bureau collaborator',
     'Sees the minimal case index outside the home bureau and may request access.',
     'bureau', true),
    ('SENIOR_MANAGEMENT', 'Senior Management / Competent Authority',
     'Reviews authorized aggregate information; restricted details remain permission-controlled.',
     'global', true),
    ('AUDITOR', 'Auditor / Read-only official',
     'Read-only access to authorized reference data and history.',
     'global', true)
on conflict (code) do update
    set name           = excluded.name,
        description    = excluded.description,
        scope_type     = excluded.scope_type,
        is_system_role = true,
        is_active      = true,
        updated_at     = now();

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from (values
        ('SUPER_ADMIN', 'REGION.VIEW'),
        ('SUPER_ADMIN', 'REGION.MANAGE'),
        ('SUPER_ADMIN', 'INSTITUTION.VIEW'),
        ('SUPER_ADMIN', 'INSTITUTION.MANAGE'),
        ('SUPER_ADMIN', 'INSTITUTION.ALIAS.VIEW'),
        ('SUPER_ADMIN', 'INSTITUTION.ALIAS.MANAGE'),
        ('SUPER_ADMIN', 'BUREAU.VIEW'),
        ('SUPER_ADMIN', 'BUREAU.MANAGE'),
        ('SUPER_ADMIN', 'BUREAU.MEMBERS.VIEW'),
        ('SUPER_ADMIN', 'BUREAU.MEMBERS.MANAGE'),
        ('SUPER_ADMIN', 'USER.VIEW'),
        ('SUPER_ADMIN', 'USER.MANAGE'),
        ('SUPER_ADMIN', 'ROLE.VIEW'),
        ('SUPER_ADMIN', 'ROLE.MANAGE'),
        ('BUREAU_ADMIN', 'REGION.VIEW'),
        ('BUREAU_ADMIN', 'INSTITUTION.VIEW'),
        ('BUREAU_ADMIN', 'INSTITUTION.ALIAS.VIEW'),
        ('BUREAU_ADMIN', 'BUREAU.VIEW'),
        ('BUREAU_ADMIN', 'BUREAU.MEMBERS.VIEW'),
        ('CASE_OFFICER', 'REGION.VIEW'),
        ('CASE_OFFICER', 'INSTITUTION.VIEW'),
        ('CASE_OFFICER', 'INSTITUTION.ALIAS.VIEW'),
        ('CASE_OFFICER', 'BUREAU.VIEW'),
        ('CASE_OFFICER', 'BUREAU.MEMBERS.VIEW'),
        ('CROSS_BUREAU_COLLABORATOR', 'REGION.VIEW'),
        ('CROSS_BUREAU_COLLABORATOR', 'INSTITUTION.VIEW'),
        ('CROSS_BUREAU_COLLABORATOR', 'INSTITUTION.ALIAS.VIEW'),
        ('CROSS_BUREAU_COLLABORATOR', 'BUREAU.VIEW'),
        ('CROSS_BUREAU_COLLABORATOR', 'BUREAU.MEMBERS.VIEW'),
        ('SENIOR_MANAGEMENT', 'REGION.VIEW'),
        ('SENIOR_MANAGEMENT', 'INSTITUTION.VIEW'),
        ('SENIOR_MANAGEMENT', 'INSTITUTION.ALIAS.VIEW'),
        ('SENIOR_MANAGEMENT', 'BUREAU.VIEW'),
        ('AUDITOR', 'REGION.VIEW'),
        ('AUDITOR', 'INSTITUTION.VIEW'),
        ('AUDITOR', 'INSTITUTION.ALIAS.VIEW'),
        ('AUDITOR', 'BUREAU.VIEW')
       ) as mapping(role_code, permission_code)
  join public.roles r on r.code = mapping.role_code
  join public.permissions p on p.code = mapping.permission_code
on conflict (role_id, permission_id) do nothing;

-- -----------------------------------------------------------------------------
-- Illustrative regions
-- -----------------------------------------------------------------------------
insert into public.regions (code, name, description, is_active)
values
    ('NORTH',     'Northern Region',    'Illustrative demo region.', true),
    ('SOUTH',     'Southern Region',    'Illustrative demo region.', true),
    ('EAST',      'Eastern Region',     'Illustrative demo region.', true),
    ('WEST',      'Western Region',     'Illustrative demo region.', true),
    ('CENTRAL',   'Central Region',     'Illustrative demo region.', true),
    ('NORTHEAST', 'North Eastern Region', 'Illustrative demo region.', true)
on conflict (code) do update
    set name        = excluded.name,
        description = excluded.description,
        is_active   = true,
        updated_at  = now();

-- -----------------------------------------------------------------------------
-- Illustrative bureaus
-- -----------------------------------------------------------------------------
insert into public.bureaus (code, name, description, bureau_type, display_order, is_active)
values
    ('RB',   'Regulation Bureau',              'Illustrative demo bureau.', 'bureau', 10, true),
    ('PGRC', 'Public Grievance Redressal Cell', 'Illustrative demo cell.',   'cell',   20, true),
    ('AFF',  'Affiliation Bureau',              'Illustrative demo bureau.', 'bureau', 30, true)
on conflict (code) do update
    set name          = excluded.name,
        description   = excluded.description,
        bureau_type   = excluded.bureau_type,
        display_order = excluded.display_order,
        is_active     = true,
        updated_at    = now();

-- -----------------------------------------------------------------------------
-- Illustrative institutions (never real AICTE records)
-- -----------------------------------------------------------------------------
insert into public.institutions (
    aicte_permanent_id, official_name, normalized_name, institution_type,
    ownership_type, city, district, state_name, postal_code, region_id,
    verification_status, verification_source, verified_at, is_active
)
select v.aicte_permanent_id,
       v.official_name,
       lower(btrim(v.official_name)),
       v.institution_type,
       v.ownership_type,
       v.city,
       v.district,
       v.state_name,
       v.postal_code,
       r.id,
       v.verification_status,
       v.verification_source,
       v.verified_at::timestamptz,
       true
  from (values
        ('DEMO-AICTE-0001', 'Demo Institute of Technology, Pune', 'engineering', 'private', 'Pune', 'Pune', 'Maharashtra', '411001', 'WEST', 'verified', 'Illustrative demo record - not an official AICTE approval', '2026-01-15T00:00:00Z'),
        ('DEMO-AICTE-0002', 'Demo College of Engineering, Chennai', 'engineering', 'private', 'Chennai', 'Chennai', 'Tamil Nadu', '600001', 'SOUTH', 'verified', 'Illustrative demo record - not an official AICTE approval', '2026-01-15T00:00:00Z'),
        ('DEMO-AICTE-0003', 'Demo Institute of Management, Kolkata', 'management', 'private', 'Kolkata', 'Kolkata', 'West Bengal', '700001', 'EAST', 'verified', 'Illustrative demo record - not an official AICTE approval', '2026-02-10T00:00:00Z'),
        ('DEMO-AICTE-0004', 'Demo Polytechnic, Bhopal', 'polytechnic', 'government', 'Bhopal', 'Bhopal', 'Madhya Pradesh', '462001', 'CENTRAL', 'pending', null, null),
        ('DEMO-AICTE-0005', 'Demo Technical University, Guwahati', 'university', 'government', 'Guwahati', 'Kamrup', 'Assam', '781001', 'NORTHEAST', 'pending', null, null)
       ) as v(
           aicte_permanent_id, official_name, institution_type, ownership_type,
           city, district, state_name, postal_code, region_code,
           verification_status, verification_source, verified_at
       )
  left join public.regions r on r.code = v.region_code
on conflict (aicte_permanent_id) where aicte_permanent_id is not null do update
    set official_name       = excluded.official_name,
        normalized_name     = excluded.normalized_name,
        institution_type    = excluded.institution_type,
        ownership_type      = excluded.ownership_type,
        city                = excluded.city,
        district            = excluded.district,
        state_name          = excluded.state_name,
        postal_code         = excluded.postal_code,
        region_id           = excluded.region_id,
        verification_status = excluded.verification_status,
        verification_source = excluded.verification_source,
        verified_at         = excluded.verified_at,
        is_active           = true,
        updated_at          = now();

-- -----------------------------------------------------------------------------
-- Illustrative aliases (provenance is mandatory for non-manual sources)
-- -----------------------------------------------------------------------------
insert into public.institution_aliases (
    institution_id, alias_name, normalized_alias, language_code, alias_type,
    source_type, source_reference, verification_status, is_active
)
select i.id,
       v.alias_name,
       lower(btrim(v.alias_name)),
       v.language_code,
       v.alias_type,
       v.source_type,
       v.source_reference,
       v.verification_status,
       true
  from (values
        ('DEMO-AICTE-0001', 'Demo Tech Pune',      'en', 'abbreviation',     'manual',          null,                        'verified'),
        ('DEMO-AICTE-0002', 'Demo Engineering College', 'en', 'former_name',  'official_record',  'Illustrative demo record',  'pending'),
        ('DEMO-AICTE-0003', 'Demo Management Institute', 'en', 'alternate_name', 'complaint_submission', 'Illustrative submission', 'pending')
       ) as v(permanent_id, alias_name, language_code, alias_type, source_type, source_reference, verification_status)
  join public.institutions i on i.aicte_permanent_id = v.permanent_id
on conflict (institution_id, normalized_alias, language_code, alias_type) do update
    set source_type         = excluded.source_type,
        source_reference    = excluded.source_reference,
        verification_status = excluded.verification_status,
        is_active           = true,
        updated_at          = now();

-- -----------------------------------------------------------------------------
-- Sanity check: fail loudly if the catalogue is incomplete rather than leaving
-- a half-seeded project.
-- -----------------------------------------------------------------------------
do $$
declare
    permission_count integer;
    role_count integer;
    mapping_count integer;
begin
    select count(*) into permission_count
      from public.permissions
     where code in (
        'REGION.VIEW', 'REGION.MANAGE',
        'INSTITUTION.VIEW', 'INSTITUTION.MANAGE',
        'INSTITUTION.ALIAS.VIEW', 'INSTITUTION.ALIAS.MANAGE',
        'BUREAU.VIEW', 'BUREAU.MANAGE',
        'BUREAU.MEMBERS.VIEW', 'BUREAU.MEMBERS.MANAGE',
        'USER.VIEW', 'USER.MANAGE',
        'ROLE.VIEW', 'ROLE.MANAGE'
     );

    select count(*) into role_count
      from public.roles
     where code in (
        'SUPER_ADMIN', 'BUREAU_ADMIN', 'CASE_OFFICER',
        'CROSS_BUREAU_COLLABORATOR', 'SENIOR_MANAGEMENT', 'AUDITOR'
     );

    select count(*) into mapping_count
      from public.role_permissions rp
      join public.roles r on r.id = rp.role_id
      join public.permissions p on p.id = rp.permission_id
     where r.code in (
        'SUPER_ADMIN', 'BUREAU_ADMIN', 'CASE_OFFICER',
        'CROSS_BUREAU_COLLABORATOR', 'SENIOR_MANAGEMENT', 'AUDITOR'
     );

    if permission_count <> 14 then
        raise exception 'Phase 1 seed expected 14 permissions, found %', permission_count;
    end if;
    if role_count <> 6 then
        raise exception 'Phase 1 seed expected 6 roles, found %', role_count;
    end if;
    if mapping_count < 37 then
        raise exception 'Phase 1 seed expected at least 37 role-permission grants, found %', mapping_count;
    end if;
end
$$;

commit;

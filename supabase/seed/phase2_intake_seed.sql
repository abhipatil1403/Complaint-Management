-- =============================================================================
-- AICTE OneDesk - Phase 2.1 intake seed (SIMULATION ONLY)
--
-- Creates the two simulated channels and the single Phase 2.1 capability.
-- Idempotent: safe to re-run; nothing is deleted.
-- Contains no real AICTE/CPGRAMS identifiers and no secrets.
-- =============================================================================

begin;

insert into public.intake_channels (
    code, name, description, channel_type,
    is_simulated, is_active, requires_external_reference
)
values
    ('AICTE_SIM',
     'Simulated AICTE portal',
     'Demonstration only. Not connected to AICTE. Submissions here are never sent to any external system.',
     'portal', true, true, false),
    ('CPGRAMS_SIM',
     'Simulated CPGRAMS intake',
     'Demonstration only. Not connected to CPGRAMS. Submissions here are never sent to any external system.',
     'cpgrams', true, true, false)
on conflict (code) do update
    set name                        = excluded.name,
        description                 = excluded.description,
        channel_type                = excluded.channel_type,
        is_simulated                = true,
        is_active                   = true,
        requires_external_reference = excluded.requires_external_reference,
        updated_at                  = now();

insert into public.permissions (code, name, description, resource_type, action_type)
values (
    'SUBMISSION.VIEW',
    'View intake submissions',
    'Read preserved intake submissions, including the original complaint text. Restricted content access; not a default administrator capability.',
    'submission',
    'view'
)
on conflict (code) do update
    set name          = excluded.name,
        description   = excluded.description,
        resource_type = excluded.resource_type,
        action_type   = excluded.action_type,
        is_active     = true,
        updated_at    = now();

-- D2/D15: Super Admin only, and only as an explicit grant.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.permissions p on p.code = 'SUBMISSION.VIEW'
 where r.code = 'SUPER_ADMIN'
on conflict on constraint role_permissions_unique_pair do nothing;

do $$
declare
    channel_count    integer;
    permission_count integer;
    grant_count      integer;
begin
    select count(*) into channel_count
      from public.intake_channels
     where code in ('AICTE_SIM', 'CPGRAMS_SIM')
       and is_simulated
       and is_active;

    select count(*) into permission_count
      from public.permissions
     where code = 'SUBMISSION.VIEW'
       and is_active;

    select count(*) into grant_count
      from public.role_permissions rp
      join public.roles r       on r.id = rp.role_id
      join public.permissions p on p.id = rp.permission_id
     where r.code = 'SUPER_ADMIN'
       and p.code = 'SUBMISSION.VIEW';

    if channel_count <> 2 then
        raise exception 'Phase 2.1 seed expected 2 simulated channels, found %', channel_count;
    end if;
    if permission_count <> 1 then
        raise exception 'Phase 2.1 seed expected permission SUBMISSION.VIEW, found %', permission_count;
    end if;
    if grant_count <> 1 then
        raise exception 'Phase 2.1 seed expected 1 SUPER_ADMIN grant, found %', grant_count;
    end if;
end
$$;

commit;

-- =============================================================================
-- AICTE OneDesk - Phase 2.2 institution verification seed (SIMULATION ONLY)
--
-- 1. Adds the single Phase 2.2 capability `INSTITUTION.VERIFY` and grants it to
--    SUPER_ADMIN only, exactly like the Phase 2.1 `SUBMISSION.VIEW` seed.
-- 2. Creates four simulated intake submissions that exercise the four evidence
--    tiers. Every one is deliberately left unresolved by Phase 2.1, so the
--    Phase 2.2 auto-queue trigger creates exactly one pending task each.
--
-- Idempotent: reruns replay through the Phase 2.1 idempotency contract, so no
-- second submission and no second task is ever created. Nothing is deleted.
-- Contains no real AICTE/CPGRAMS identifier and no secret.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Capability
-- -----------------------------------------------------------------------------
insert into public.permissions (code, name, description, resource_type, action_type)
values (
    'INSTITUTION.VERIFY',
    'Verify submitted institution identity',
    'Review the human verification queue, confirm or reject an institution association and open a correction round. Institution indexing only; does not grant access to complaint content.',
    'institution',
    'verify'
)
on conflict (code) do update
    set name          = excluded.name,
        description   = excluded.description,
        resource_type = excluded.resource_type,
        action_type   = excluded.action_type,
        is_active     = true,
        updated_at    = now();

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.permissions p on p.code = 'INSTITUTION.VERIFY'
 where r.code = 'SUPER_ADMIN'
on conflict on constraint role_permissions_unique_pair do nothing;

-- -----------------------------------------------------------------------------
-- 2. Four unresolved demo submissions -> four auto-queued tasks
--
--    S1  no evidence           (unknown permanent id)
--    S2  exact official name   (Demo Institute of Technology, Pune)
--    S3  verified alias        (Demo Tech Pune)
--    S4  name containment      (Demo College of Engineering)
-- -----------------------------------------------------------------------------
set role one_desk_intake;

select public.create_demo_submission(
    'AICTE_SIM',
    'DEMO-AICTE-9999',
    'Unknown Institute of Technology, Nowhere',
    'Scholarship disbursement delay',
    'The scholarship amount for the current academic year has not been credited. Original text preserved verbatim.',
    'en',
    null,
    'p22-seed-evt-0001',
    'P22-SEED-0001',
    '2026-10-01T09:15:00+05:30',
    true
);

select public.create_demo_submission(
    'AICTE_SIM',
    null,
    'Demo Institute of Technology, Pune',
    'Hostel maintenance complaint',
    'Hostel water supply has been interrupted for four days. Original text preserved verbatim.',
    'en',
    null,
    'p22-seed-evt-0002',
    'P22-SEED-0002',
    '2026-10-02T10:30:00+05:30',
    true
);

select public.create_demo_submission(
    'CPGRAMS_SIM',
    null,
    'Demo Tech Pune',
    'Fee refund not processed',
    'The admission fee refund has not been processed after withdrawal. Original text preserved verbatim.',
    'en',
    null,
    'p22-seed-evt-0003',
    'P22-SEED-0003',
    '2026-10-03T11:45:00+05:30',
    true
);

select public.create_demo_submission(
    'AICTE_SIM',
    null,
    'Demo College of Engineering',
    'Faculty vacancy affecting classes',
    'Core subject classes have not been held for three weeks due to unfilled faculty posts. Original text preserved verbatim.',
    'en',
    null,
    'p22-seed-evt-0004',
    'P22-SEED-0004',
    '2026-10-04T12:00:00+05:30',
    true
);

reset role;

-- -----------------------------------------------------------------------------
-- 3. Post-conditions
-- -----------------------------------------------------------------------------
do $$
declare
    v_submissions integer;
    v_tasks       integer;
    v_orphans     integer;
    v_cases       integer;
    v_permission  integer;
    v_grant       integer;
begin
    select count(*) into v_submissions
      from public.submissions
     where idempotency_key in ('P22-SEED-0001','P22-SEED-0002','P22-SEED-0003','P22-SEED-0004');

    if v_submissions <> 4 then
        raise exception 'Phase 2.2 seed expected 4 submissions, found %', v_submissions;
    end if;

    select count(*) into v_tasks
      from public.institution_verification_tasks t
      join public.submissions s on s.id = t.submission_id
     where s.idempotency_key in ('P22-SEED-0001','P22-SEED-0002','P22-SEED-0003','P22-SEED-0004');

    if v_tasks <> 4 then
        raise exception 'Phase 2.2 seed expected 4 verification tasks, found %', v_tasks;
    end if;

    select count(*) into v_orphans
      from public.submissions s
     where s.idempotency_key in ('P22-SEED-0001','P22-SEED-0002','P22-SEED-0003','P22-SEED-0004')
       and (select count(*)
              from public.institution_verification_tasks t
             where t.submission_id = s.id) <> 1;

    if v_orphans <> 0 then
        raise exception 'Phase 2.2 seed found % submissions without exactly one task', v_orphans;
    end if;

    select count(*) into v_cases
      from public.submissions s
     where s.idempotency_key in ('P22-SEED-0001','P22-SEED-0002','P22-SEED-0003','P22-SEED-0004')
       and s.canonical_case_id is not null;

    if v_cases <> 0 then
        raise exception 'Phase 2.2 seed must never create a canonical case';
    end if;

    select count(*) into v_permission
      from public.permissions
     where code = 'INSTITUTION.VERIFY' and is_active;

    if v_permission <> 1 then
        raise exception 'Phase 2.2 seed expected exactly one INSTITUTION.VERIFY permission';
    end if;

    select count(*) into v_grant
      from public.role_permissions rp
      join public.roles r       on r.id = rp.role_id
      join public.permissions p on p.id = rp.permission_id
     where p.code = 'INSTITUTION.VERIFY' and r.code = 'SUPER_ADMIN';

    if v_grant <> 1 then
        raise exception 'Phase 2.2 seed expected exactly one SUPER_ADMIN grant';
    end if;
end
$$;

commit;

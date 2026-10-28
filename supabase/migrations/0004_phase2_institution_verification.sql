-- =============================================================================
-- AICTE OneDesk - Phase 2.2 institution identification & human verification
--
-- Scope: institution identification evidence, the human verification queue and
--        the verification decision/correction workflow. No canonical case
--        creation, no duplicate merging, no SLA, no notification, no officer
--        assignment, no new application table.
--
-- Security model (least privilege)
--   * `authenticated` keeps ZERO privilege on `institution_verification_tasks`.
--     Every read goes through a capability-gated SECURITY DEFINER projection.
--     This is enforced in PostgreSQL, not by an RLS policy that could be
--     bypassed by a future GRANT.
--   * Writes go through two narrowly scoped SECURITY DEFINER commands. Neither
--     can be reached by `anon`, `service_role` or PUBLIC.
--   * `MAINTAIN` (PostgreSQL 17) is removed from the five non-intake tables that
--     still carry it, and unused DML is removed from four of them.
--   * No complaint body or subject is ever returned by a verification function.
--
-- Concurrency (single, global lock order)
--   Every write path takes locks in exactly this order:
--
--       1. public.submissions          (SELECT ... FOR UPDATE)
--       2. public.institution_verification_tasks (SELECT ... FOR UPDATE / INSERT)
--       3. public.institutions         (SELECT ... FOR SHARE, confirm only)
--
--   `decide_institution_verification` pre-reads the task's `submission_id`
--   WITHOUT a lock only to learn which submission to lock first. That value is
--   immutable for the lifetime of the row (guard trigger below), so the
--   unlocked read cannot be stale in a way that changes the lock target.
--   `request_institution_verification_round` locks the submission first and
--   only then inspects/creates the round.
--
--   The partial unique index `institution_verification_active_submission_uq`
--   (already present, not created here) is the final backstop for the
--   one-active-round invariant: (submission_id) WHERE status IN
--   ('pending','in_review').
--
-- Independent correction review
--   A correction round records its requester in the first line of the existing
--   `resolution_notes` column:
--
--       [correction-request] requester=<uuid> at=<UTC timestamp>
--
--   No new column is introduced. The marker is the authoritative, append-only
--   record. Every writer parses it with `public.correction_request_requester`,
--   which fails closed (P2V05) when the marker is duplicated, misplaced or
--   malformed; it returns NULL only when no marker is present at all.
--
--   `decide_institution_verification` refuses to resolve a submission that
--   already carries an institution unless a well-formed marker exists, so an
--   alternate path that skipped round creation cannot confirm an association
--   with no independent-review trail. It also refuses a confirm where the
--   confirmer is the requester (P2V14). `guard_institution_verification_task`
--   independently enforces the same rules for any direct table write, and
--   forbids removing, rewriting or injecting a marker after the round started.
--
--   Why not `assigned_to_user_id`? It is a mutable working assignment
--   (`assign_to_me`/`unassign`), so it cannot be an immutable audit record.
--   Why not `reviewed_by_user_id`? That is the resolving reviewer, not the
--   requester.
--
-- Canonical case creation
--   `public.guard_case_creation_open_round` (BEFORE INSERT, and BEFORE UPDATE
--   when the source submission changes) refuses to create a canonical case for
--   a submission that still has an open verification/correction round, or that
--   is `awaiting_institution_verification`, even when `institution_id` is
--   populated. SQLSTATE P2V10. The submission row is locked first, so this
--   cannot race with `request_institution_verification_round`.
--
-- Reconstructability of a replaced association
--   The submission row keeps only the CURRENT institution pointer. History is
--   the task ledger, which is append-only:
--     * the earlier task row stays `verified` with `resolved_institution_id`
--       (the previous institution), `reviewed_by_user_id` (the previous
--       reviewer) and `resolved_at` (when the previous association began);
--     * the correction task row keeps the requester marker and the reason;
--     * the confirming task row keeps `resolved_institution_id` (the new
--       institution), the confirmer, and an appended line
--       `[correction] previous association <name> (<permanent id>) replaced by
--       reviewer <uuid> at <timestamp>`.
--   Resolved tasks are immutable, so none of this can be rewritten afterwards.
--
-- Pagination
--   The queue projection is OFFSET based and returns at most `limit + 1` rows so
--   FastAPI's existing `page_response` helper can trim to `limit` and emit
--   `next_cursor = str(offset + limit)`. No keyset pagination is claimed.
--
-- SQLSTATE map (translated to ApiError by the repository layer)
--   42501 privilege / inactive account       P2V01 stale write
--   P2V02 not found                          P2V03 unknown action
--   P2V04 immutable or invalid transition    P2V05 invariant violation
--   P2V06 case locked                        P2V07 reason required
--   P2V08 invalid field combination          P2V09 institution not eligible
--   P2V10 case blocked by an open round      P2V11 active round exists
--   P2V12 invalid filter                     P2V13 submission provenance immutable
--   P2V14 independent review required
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Candidate evidence (internal, no grants to any API role)
--
-- Deterministic, explainable evidence tiers only. No numeric similarity score is
-- produced or stored, because no similarity extension is installed and the
-- product must never auto-verify. `name_contains` is weak candidate-generation
-- evidence: it never resolves an institution on its own and is capped by the
-- caller's LIMIT.
-- -----------------------------------------------------------------------------
create function public.institution_match_candidates_internal(
    p_permanent_id    text,
    p_normalized_name text,
    p_limit           integer default null
) returns table (
    out_institution_id  uuid,
    out_evidence        text,
    out_evidence_rank   integer,
    out_matched_alias_id   uuid,
    out_matched_alias_name text
)
language sql
stable
set search_path = ''
as $$
    with submitted as (
        select nullif(upper(btrim(p_permanent_id)), '')   as pid,
               nullif(lower(btrim(p_normalized_name)), '') as name
    ),
    evidence as (
        -- E1: exact AICTE Permanent ID. Outranks every name signal.
        select i.id as institution_id,
               'exact_permanent_id'::text as evidence,
               1 as evidence_rank,
               null::uuid as alias_id,
               null::text as alias_name
          from public.institutions i, submitted s
         where s.pid is not null
           and upper(btrim(i.aicte_permanent_id)) = s.pid

        union all

        -- E2: exact official (normalised) name.
        select i.id, 'exact_official_name', 2, null::uuid, null::text
          from public.institutions i, submitted s
         where s.name is not null
           and i.normalized_name = s.name

        union all

        -- E3: exact alias that a human already verified. Pending aliases never
        -- contribute evidence.
        select a.institution_id, 'exact_verified_alias', 3, a.id, a.alias_name
          from public.institution_aliases a, submitted s
         where s.name is not null
           and a.normalized_alias = s.name
           and a.is_active
           and a.verification_status = 'verified'

        union all

        -- E4: containment. Weak, never auto-verifying.
        select i.id, 'name_contains', 4, null::uuid, null::text
          from public.institutions i, submitted s
         where s.name is not null
           and char_length(s.name) >= 3
           and i.normalized_name is not null
           and i.normalized_name <> s.name
           and (position(s.name in i.normalized_name) > 0
                or position(i.normalized_name in s.name) > 0)
    )
    select distinct
           e.institution_id,
           e.evidence,
           e.evidence_rank,
           e.alias_id,
           e.alias_name
      from evidence e
     order by e.evidence_rank, e.institution_id
     limit p_limit;
$$;

alter function public.institution_match_candidates_internal(text, text, integer) owner to postgres;
revoke all on function public.institution_match_candidates_internal(text, text, integer) from public;
revoke all on function public.institution_match_candidates_internal(text, text, integer) from anon;
revoke all on function public.institution_match_candidates_internal(text, text, integer) from authenticated;
revoke all on function public.institution_match_candidates_internal(text, text, integer) from service_role;

-- -----------------------------------------------------------------------------
-- 2. Restricted submission projection (capability gated)
--
-- Returns provenance and workflow metadata only. It deliberately omits
-- `subject`, `original_text`, `normalized_text`, `submitter_reference`,
-- `content_fingerprint` and `source_metadata` (which carries the request hash).
-- -----------------------------------------------------------------------------
create function public.institution_verification_submission_metadata(p_submission_id uuid)
returns table (
    out_submission_id       uuid,
    out_channel_code        text,
    out_channel_name        text,
    out_channel_is_simulated boolean,
    out_external_reference  text,
    out_source_event_id     text,
    out_received_at         timestamptz,
    out_submission_updated_at timestamptz,
    out_intake_status       text,
    out_original_language   text,
    out_institution_name_as_submitted text,
    out_submitted_permanent_id text,
    out_institution_id      uuid,
    out_institution_official_name text,
    out_institution_permanent_id  text,
    out_canonical_case_id   uuid
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
begin
    if public.has_global_permission('INSTITUTION.VERIFY') is not true then
        raise exception 'The INSTITUTION.VERIFY capability is required'
            using errcode = '42501';
    end if;

    return query
    select s.id,
           c.code,
           c.name,
           c.is_simulated,
           s.external_reference,
           s.source_event_id,
           s.received_at,
           s.updated_at,
           s.intake_status,
           s.original_language,
           s.institution_name_as_submitted,
           nullif(upper(btrim(s.source_metadata ->> 'institution_permanent_id_as_submitted')), ''),
           s.institution_id,
           i.official_name,
           i.aicte_permanent_id,
           s.canonical_case_id
      from public.submissions s
      join public.intake_channels c on c.id = s.intake_channel_id
      left join public.institutions i on i.id = s.institution_id
     where s.id = p_submission_id;
end;
$$;

alter function public.institution_verification_submission_metadata(uuid) owner to postgres;
revoke all on function public.institution_verification_submission_metadata(uuid) from public;
revoke all on function public.institution_verification_submission_metadata(uuid) from anon;
revoke all on function public.institution_verification_submission_metadata(uuid) from service_role;
grant execute on function public.institution_verification_submission_metadata(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Candidate projection for one submission (capability gated)
-- -----------------------------------------------------------------------------
create function public.institution_match_candidates(p_submission_id uuid)
returns table (
    out_institution_id      uuid,
    out_official_name       text,
    out_permanent_id        text,
    out_region_code         text,
    out_region_name         text,
    out_verification_status text,
    out_is_active           boolean,
    out_evidence            text[],
    out_matched_alias_id    uuid,
    out_matched_alias_name  text,
    out_evidence_rank       integer,
    out_is_eligible         boolean
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
    v_pid  text;
    v_name text;
begin
    if public.has_global_permission('INSTITUTION.VERIFY') is not true then
        raise exception 'The INSTITUTION.VERIFY capability is required'
            using errcode = '42501';
    end if;

    select nullif(upper(btrim(s.source_metadata ->> 'institution_permanent_id_as_submitted')), ''),
           nullif(lower(btrim(s.institution_name_as_submitted)), '')
      into v_pid, v_name
      from public.submissions s
     where s.id = p_submission_id;

    if not found then
        raise exception 'Submission not found' using errcode = 'P2V02';
    end if;

    return query
    with raw as (
        select *
          from public.institution_match_candidates_internal(v_pid, v_name, null) c
    ),
    agg as (
        select r.out_institution_id as institution_id,
               array_agg(r.out_evidence order by r.out_evidence_rank) as evidence,
               min(r.out_evidence_rank) as best_rank,
               (array_agg(r.out_matched_alias_id order by r.out_evidence_rank))[1] as alias_id,
               (array_agg(r.out_matched_alias_name order by r.out_evidence_rank))[1] as alias_name
          from raw r
         group by r.out_institution_id
    )
    select a.institution_id,
           i.official_name,
           i.aicte_permanent_id,
           reg.code,
           reg.name,
           i.verification_status,
           i.is_active,
           a.evidence,
           a.alias_id,
           a.alias_name,
           a.best_rank,
           (i.verification_status = 'verified' and i.is_active)
      from agg a
      join public.institutions i on i.id = a.institution_id
      left join public.regions reg on reg.id = i.region_id
     order by a.best_rank, i.official_name
     limit 10;
end;
$$;

alter function public.institution_match_candidates(uuid) owner to postgres;
revoke all on function public.institution_match_candidates(uuid) from public;
revoke all on function public.institution_match_candidates(uuid) from anon;
revoke all on function public.institution_match_candidates(uuid) from service_role;
grant execute on function public.institution_match_candidates(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Queue / detail projection (capability gated, OFFSET paginated)
--
-- `p_task_id` is the detail path. When it is supplied every list filter is
-- bypassed so a terminal (verified/rejected) task remains retrievable with the
-- endpoint's default `status=open`.
--
-- Returns `limit + 1` rows (bounded to 101) so the API can detect "more".
-- -----------------------------------------------------------------------------
create function public.institution_verification_task_rows(
    p_task_id    uuid default null,
    p_status     text default 'open',
    p_assignment text default 'all',
    p_priority   text default null,
    p_query      text default null,
    p_sort       text default 'oldest',
    p_limit      integer default 25,
    p_offset     integer default 0
) returns table (
    out_task_id                     uuid,
    out_status                      text,
    out_priority                    text,
    out_submitted_institution_name  text,
    out_submitted_permanent_id      text,
    out_candidate_institution_id    uuid,
    out_assigned_to_user_id         uuid,
    out_assigned_to_name            text,
    out_reviewed_by_user_id         uuid,
    out_reviewed_by_name            text,
    out_resolved_institution_id     uuid,
    out_resolved_institution_name   text,
    out_resolution_notes            text,
    out_resolved_at                 timestamptz,
    out_created_at                  timestamptz,
    out_updated_at                  timestamptz,
    out_age_days                    integer,
    out_submission_id               uuid,
    out_channel_code                text,
    out_channel_name                text,
    out_channel_is_simulated        boolean,
    out_external_reference          text,
    out_source_event_id             text,
    out_received_at                 timestamptz,
    out_submission_updated_at       timestamptz,
    out_intake_status               text,
    out_original_language           text,
    out_institution_name_as_submitted text,
    out_submission_institution_id   uuid,
    out_submission_institution_name text,
    out_submission_institution_permanent_id text,
    out_canonical_case_id           uuid,
    out_strongest_evidence          text,
    out_candidate_count             integer,
    out_round_type                  text,
    out_requester_user_id           uuid
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
    v_actor  uuid;
    v_q      text;
    v_limit  integer;
    v_offset integer;
begin
    if public.has_global_permission('INSTITUTION.VERIFY') is not true then
        raise exception 'The INSTITUTION.VERIFY capability is required'
            using errcode = '42501';
    end if;

    v_actor := public.auth_uid();
    if v_actor is null then
        raise exception 'An authenticated caller is required' using errcode = '42501';
    end if;

    if p_status not in ('open','pending','in_review','verified','rejected','all') then
        raise exception 'Unknown status filter' using errcode = 'P2V12';
    end if;
    if p_assignment not in ('all','unassigned','mine') then
        raise exception 'Unknown assignment filter' using errcode = 'P2V12';
    end if;
    if p_priority is not null and p_priority not in ('low','normal','high','critical') then
        raise exception 'Unknown priority filter' using errcode = 'P2V12';
    end if;
    if p_sort not in ('oldest','recent') then
        raise exception 'Unknown sort order' using errcode = 'P2V12';
    end if;

    v_limit  := least(greatest(coalesce(p_limit, 25), 1), 100);
    v_offset := greatest(coalesce(p_offset, 0), 0);
    v_q      := nullif(lower(btrim(coalesce(p_query, ''))), '');

    return query
    select t.id,
           t.status,
           t.priority,
           t.submitted_institution_name,
           m.out_submitted_permanent_id,
           t.candidate_institution_id,
           t.assigned_to_user_id,
           au.full_name,
           t.reviewed_by_user_id,
           ru.full_name,
           t.resolved_institution_id,
           ri.official_name,
           t.resolution_notes,
           t.resolved_at,
           t.created_at,
           t.updated_at,
           greatest(0, floor(extract(epoch from (now() - t.created_at)) / 86400))::integer,
           m.out_submission_id,
           m.out_channel_code,
           m.out_channel_name,
           m.out_channel_is_simulated,
           m.out_external_reference,
           m.out_source_event_id,
           m.out_received_at,
           m.out_submission_updated_at,
           m.out_intake_status,
           m.out_original_language,
           m.out_institution_name_as_submitted,
           m.out_institution_id,
           m.out_institution_official_name,
           m.out_institution_permanent_id,
           m.out_canonical_case_id,
           ev.strongest_evidence,
           coalesce(ev.candidate_count, 0)::integer,
           case when m.out_institution_id is not null then 'correction' else 'new_round' end,
           public.correction_request_requester(t.resolution_notes)
      from public.institution_verification_tasks t
      left join lateral public.institution_verification_submission_metadata(t.submission_id) m on true
      left join lateral (
          select (array_agg(c.out_evidence order by c.out_evidence_rank))[1] as strongest_evidence,
                 count(distinct c.out_institution_id) as candidate_count
            from public.institution_match_candidates_internal(
                     m.out_submitted_permanent_id,
                     lower(btrim(coalesce(m.out_institution_name_as_submitted, ''))),
                     null) c
      ) ev on true
      left join public.users au on au.id = t.assigned_to_user_id
      left join public.users ru on ru.id = t.reviewed_by_user_id
      left join public.institutions ri on ri.id = t.resolved_institution_id
     where (p_task_id is null or t.id = p_task_id)
       and (p_task_id is not null
            or p_status = 'all'
            or (p_status = 'open' and t.status in ('pending','in_review'))
            or t.status = p_status)
       and (p_task_id is not null
            or p_assignment = 'all'
            or (p_assignment = 'unassigned' and t.assigned_to_user_id is null)
            or (p_assignment = 'mine' and t.assigned_to_user_id = v_actor))
       and (p_task_id is not null or p_priority is null or t.priority = p_priority)
       and (p_task_id is not null
            or v_q is null
            or position(v_q in lower(t.submitted_institution_name)) > 0
            or position(v_q in lower(coalesce(m.out_external_reference, ''))) > 0
            or position(v_q in lower(coalesce(m.out_submitted_permanent_id, ''))) > 0)
     order by case when p_sort = 'oldest' then t.created_at end asc,
              case when p_sort = 'recent' then t.updated_at end desc,
              t.id
     limit (v_limit + 1) offset v_offset;
end;
$$;

alter function public.institution_verification_task_rows(uuid, text, text, text, text, text, integer, integer) owner to postgres;
revoke all on function public.institution_verification_task_rows(uuid, text, text, text, text, text, integer, integer) from public;
revoke all on function public.institution_verification_task_rows(uuid, text, text, text, text, text, integer, integer) from anon;
revoke all on function public.institution_verification_task_rows(uuid, text, text, text, text, text, integer, integer) from service_role;
grant execute on function public.institution_verification_task_rows(uuid, text, text, text, text, text, integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 4b. Correction-request marker parser (fail closed)
--
-- The correction requester is recorded in the first line of the existing
-- `resolution_notes` column:
--
--     [correction-request] requester=<uuid> at=<UTC timestamp>
--
-- This helper never guesses. A missing marker returns NULL (the caller decides
-- whether that is legal), while a duplicated, misplaced or malformed marker
-- raises P2V05 so no write can proceed on an ambiguous record.
-- -----------------------------------------------------------------------------
create function public.correction_request_requester(p_notes text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
    c_token constant text := '[correction-request]';
    v_count integer;
    v_requester uuid;
begin
    if p_notes is null or btrim(p_notes) = '' then
        return null;
    end if;

    v_count := (length(p_notes) - length(replace(p_notes, c_token, ''))) / length(c_token);

    if v_count = 0 then
        return null;
    end if;
    if v_count > 1 then
        raise exception 'The correction request record is duplicated or ambiguous'
            using errcode = 'P2V05';
    end if;
    if left(p_notes, length(c_token)) <> c_token then
        raise exception 'The correction request record is not the first line'
            using errcode = 'P2V05';
    end if;

    v_requester := substring(
        p_notes
        from '^\[correction-request\] requester=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z'
    )::uuid;

    if v_requester is null then
        raise exception 'The correction request record is malformed'
            using errcode = 'P2V05';
    end if;

    return v_requester;
end;
$$;

alter function public.correction_request_requester(text) owner to postgres;
revoke all on function public.correction_request_requester(text) from public;
revoke all on function public.correction_request_requester(text) from anon;
revoke all on function public.correction_request_requester(text) from authenticated;
revoke all on function public.correction_request_requester(text) from service_role;

-- -----------------------------------------------------------------------------
-- 5. Decision command (capability gated, lock order 1 -> 2 -> 3)
-- -----------------------------------------------------------------------------
create function public.decide_institution_verification(
    p_task_id             uuid,
    p_action              text,
    p_institution_id      uuid default null,
    p_reason              text default null,
    p_expected_updated_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
set lock_timeout = '5s'
as $$
declare
    v_actor         uuid;
    v_task          public.institution_verification_tasks%rowtype;
    v_sub           public.submissions%rowtype;
    v_submission_id uuid;
    v_reason        text;
    v_notes         text;
    v_eligible      boolean;
    v_prior_name    text;
    v_prior_pid     text;
    v_requester     uuid;
begin
    if public.has_global_permission('INSTITUTION.VERIFY') is not true then
        raise exception 'The INSTITUTION.VERIFY capability is required'
            using errcode = '42501';
    end if;

    v_actor := public.auth_uid();
    if v_actor is null then
        raise exception 'An authenticated caller is required' using errcode = '42501';
    end if;
    if not exists (
        select 1 from public.users u
         where u.id = v_actor and u.account_status = 'active'
    ) then
        raise exception 'The caller account is not active' using errcode = '42501';
    end if;

    if p_action not in ('confirm','reject','request_information','assign_to_me','unassign') then
        raise exception 'Unknown verification action: %', p_action using errcode = 'P2V03';
    end if;

    -- Lock order step 1 target. `submission_id` is immutable, so this unlocked
    -- read cannot be stale with respect to the lock we are about to take.
    select t.submission_id
      into v_submission_id
      from public.institution_verification_tasks t
     where t.id = p_task_id;

    if not found then
        raise exception 'Verification task not found' using errcode = 'P2V02';
    end if;

    -- Lock order step 1.
    select * into v_sub
      from public.submissions
     where id = v_submission_id
       for update;

    if not found then
        raise exception 'Submission not found' using errcode = 'P2V02';
    end if;

    -- Lock order step 2. The row is re-read after any lock wait, so the stale
    -- check below compares against the latest committed version.
    select * into v_task
      from public.institution_verification_tasks
     where id = p_task_id
       for update;

    if not found then
        raise exception 'Verification task not found' using errcode = 'P2V02';
    end if;
    if v_task.submission_id <> v_submission_id then
        raise exception 'Verification task submission changed concurrently' using errcode = 'P2V01';
    end if;

    if p_expected_updated_at is not null and v_task.updated_at <> p_expected_updated_at then
        raise exception 'The verification task was modified by another reviewer'
            using errcode = 'P2V01';
    end if;
    if v_task.status in ('verified','rejected') then
        raise exception 'A resolved verification task is immutable' using errcode = 'P2V04';
    end if;

    v_reason := nullif(btrim(coalesce(p_reason, '')), '');

    -- The correction requester record is the authoritative independence trail.
    -- Parsing fails closed (P2V05) on a duplicated, misplaced or malformed
    -- marker for every action, not only confirmation, so an ambiguous record
    -- can never be resolved through an alternate path.
    v_requester := public.correction_request_requester(v_task.resolution_notes);

    if p_action = 'assign_to_me' then
        update public.institution_verification_tasks
           set assigned_to_user_id = v_actor,
               status = case when status = 'pending' then 'in_review' else status end
         where id = v_task.id;
        return;
    end if;

    if p_action = 'unassign' then
        update public.institution_verification_tasks
           set assigned_to_user_id = null,
               status = 'in_review'
         where id = v_task.id;
        return;
    end if;

    if p_action = 'request_information' then
        if v_reason is null then
            raise exception 'A reason is required' using errcode = 'P2V07';
        end if;
        update public.institution_verification_tasks
           set status = 'in_review',
               assigned_to_user_id = coalesce(assigned_to_user_id, v_actor),
               resolution_notes = concat_ws(E'\n', nullif(resolution_notes, ''), v_reason)
         where id = v_task.id;
        return;
    end if;

    if p_action = 'reject' then
        if v_reason is null then
            raise exception 'A reason is required' using errcode = 'P2V07';
        end if;
        if p_institution_id is not null then
            raise exception 'A rejection cannot carry an institution' using errcode = 'P2V08';
        end if;
        update public.institution_verification_tasks
           set status = 'rejected',
               resolved_at = now(),
               resolved_institution_id = null,
               reviewed_by_user_id = v_actor,
               assigned_to_user_id = coalesce(assigned_to_user_id, v_actor),
               resolution_notes = concat_ws(E'\n', nullif(resolution_notes, ''), v_reason)
         where id = v_task.id;
        return;
    end if;

    -- ---- confirm -----------------------------------------------------------
    if p_institution_id is null then
        raise exception 'Confirming requires an institution' using errcode = 'P2V08';
    end if;
    if v_reason is null then
        raise exception 'A reason is required' using errcode = 'P2V07';
    end if;

    -- Fail closed. A submission that already carries an institution is being
    -- re-examined, so the round MUST have a requester record. Without one, an
    -- alternate path could confirm the association with no independent-review
    -- trail, including a requester confirming their own correction.
    if v_sub.institution_id is not null and v_requester is null then
        raise exception 'A correction round is missing its requester record'
            using errcode = 'P2V05';
    end if;

    if v_requester is not null and v_requester = v_actor then
        raise exception 'The reviewer who requested this correction cannot confirm it'
            using errcode = 'P2V14';
    end if;

    -- Lock order step 3. FOR SHARE keeps a concurrent institution update from
    -- invalidating the eligibility check without blocking other confirmations.
    select (i.verification_status = 'verified' and i.is_active)
      into v_eligible
      from public.institutions i
     where i.id = p_institution_id
       for share;

    if v_eligible is distinct from true then
        raise exception 'The selected institution must be verified and active'
            using errcode = 'P2V09';
    end if;

    if v_sub.canonical_case_id is not null then
        raise exception 'The submission is already associated with a canonical case'
            using errcode = 'P2V06';
    end if;

    v_notes := concat_ws(E'\n', nullif(v_task.resolution_notes, ''), v_reason);

    if v_sub.institution_id is not null and v_sub.institution_id <> p_institution_id then
        select i.official_name, i.aicte_permanent_id
          into v_prior_name, v_prior_pid
          from public.institutions i
         where i.id = v_sub.institution_id;

        v_notes := concat_ws(
            E'\n', v_notes,
            format('[correction] previous association %s (%s) replaced by reviewer %s at %s',
                   coalesce(v_prior_name, 'unknown'),
                   coalesce(v_prior_pid, 'no permanent id'),
                   v_actor,
                   now()));
    end if;

    update public.institution_verification_tasks
       set status = 'verified',
           resolved_institution_id = p_institution_id,
           resolved_at = now(),
           reviewed_by_user_id = v_actor,
           assigned_to_user_id = coalesce(assigned_to_user_id, v_actor),
           resolution_notes = v_notes
     where id = v_task.id;
end;
$$;

alter function public.decide_institution_verification(uuid, text, uuid, text, timestamptz) owner to postgres;
revoke all on function public.decide_institution_verification(uuid, text, uuid, text, timestamptz) from public;
revoke all on function public.decide_institution_verification(uuid, text, uuid, text, timestamptz) from anon;
revoke all on function public.decide_institution_verification(uuid, text, uuid, text, timestamptz) from service_role;
grant execute on function public.decide_institution_verification(uuid, text, uuid, text, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Correction round command (capability gated, lock order 1 -> insert 2)
-- -----------------------------------------------------------------------------
create function public.request_institution_verification_round(
    p_submission_id uuid,
    p_reason        text,
    p_expected_submission_updated_at timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
set lock_timeout = '5s'
as $$
declare
    v_actor    uuid;
    v_reason   text;
    v_sub      public.submissions%rowtype;
    v_name     text;
    v_priority text;
    v_status   text;
    v_notes    text;
    v_task_id  uuid;
begin
    if public.has_global_permission('INSTITUTION.VERIFY') is not true then
        raise exception 'The INSTITUTION.VERIFY capability is required'
            using errcode = '42501';
    end if;

    v_actor := public.auth_uid();
    if v_actor is null then
        raise exception 'An authenticated caller is required' using errcode = '42501';
    end if;
    if not exists (
        select 1 from public.users u
         where u.id = v_actor and u.account_status = 'active'
    ) then
        raise exception 'The caller account is not active' using errcode = '42501';
    end if;

    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is null then
        raise exception 'A reason is required' using errcode = 'P2V07';
    end if;

    -- Lock order step 1.
    select * into v_sub
      from public.submissions
     where id = p_submission_id
       for update;

    if not found then
        raise exception 'Submission not found' using errcode = 'P2V02';
    end if;
    if v_sub.canonical_case_id is not null then
        raise exception 'The submission is already associated with a canonical case'
            using errcode = 'P2V06';
    end if;
    if p_expected_submission_updated_at is not null
       and v_sub.updated_at <> p_expected_submission_updated_at then
        raise exception 'The submission was modified by another reviewer'
            using errcode = 'P2V01';
    end if;

    -- Holding the submission row lock serialises every round creator, so this
    -- check cannot race. The partial unique index remains the final backstop.
    if exists (
        select 1
          from public.institution_verification_tasks t
         where t.submission_id = p_submission_id
           and t.status in ('pending','in_review')
    ) then
        raise exception 'An active verification round already exists' using errcode = 'P2V11';
    end if;

    if v_sub.institution_id is not null then
        -- Correction round: the submission already carries an association that a
        -- human must re-examine.
        select i.official_name
          into v_name
          from public.institutions i
         where i.id = v_sub.institution_id;

        v_priority := 'high';
        v_status   := 'in_review';
        v_notes    := format('[correction-request] requester=%s at=%s',
                             v_actor,
                             to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                      || E'\n' || v_reason;
    else
        v_name := coalesce(
            nullif(btrim(v_sub.institution_name_as_submitted), ''),
            nullif(upper(btrim(v_sub.source_metadata ->> 'institution_permanent_id_as_submitted')), ''),
            'Unnamed institution');
        v_priority := case
                          when nullif(v_sub.source_metadata ->> 'institution_permanent_id_as_submitted', '') is not null
                          then 'high' else 'normal'
                      end;
        v_status   := 'pending';
        v_notes    := format('New review round requested by %s at %s: %s',
                             v_actor, now(), v_reason);
    end if;

    insert into public.institution_verification_tasks (
        submission_id, candidate_institution_id, submitted_institution_name,
        status, priority, assigned_to_user_id, resolution_notes
    ) values (
        p_submission_id, null, left(coalesce(v_name, 'Unnamed institution'), 300),
        v_status, v_priority, v_actor, v_notes
    )
    returning id into v_task_id;

    update public.submissions
       set intake_status = 'awaiting_institution_verification'
     where id = p_submission_id;

    return v_task_id;
end;
$$;

alter function public.request_institution_verification_round(uuid, text, timestamptz) owner to postgres;
revoke all on function public.request_institution_verification_round(uuid, text, timestamptz) from public;
revoke all on function public.request_institution_verification_round(uuid, text, timestamptz) from anon;
revoke all on function public.request_institution_verification_round(uuid, text, timestamptz) from service_role;
grant execute on function public.request_institution_verification_round(uuid, text, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Auto-queue on intake (Phase 2.1 integration)
--
-- Fires only for submissions that Phase 2.1 left unresolved. Phase 2.1 itself
-- performs a single INSERT and never updates a submission, so this trigger and
-- the immutability trigger below cannot break intake or its idempotent replay.
-- -----------------------------------------------------------------------------
create function public.queue_institution_verification() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_pid        text;
    v_name       text;
    v_task_name  text;
    v_priority   text;
    v_candidates uuid[];
begin
    v_pid  := nullif(upper(btrim(new.source_metadata ->> 'institution_permanent_id_as_submitted')), '');
    v_name := nullif(lower(btrim(new.institution_name_as_submitted)), '');

    v_task_name := coalesce(
        nullif(btrim(new.institution_name_as_submitted), ''),
        v_pid,
        'Unnamed institution');

    v_priority := case when v_pid is not null then 'high' else 'normal' end;

    select array_agg(distinct c.out_institution_id)
      into v_candidates
      from public.institution_match_candidates_internal(v_pid, v_name, null) c;

    insert into public.institution_verification_tasks (
        submission_id, candidate_institution_id, submitted_institution_name,
        status, priority
    ) values (
        new.id,
        case when coalesce(array_length(v_candidates, 1), 0) = 1 then v_candidates[1] else null end,
        left(v_task_name, 300),
        'pending',
        v_priority
    );

    return null;
end;
$$;

alter function public.queue_institution_verification() owner to postgres;
revoke all on function public.queue_institution_verification() from public;
revoke all on function public.queue_institution_verification() from anon;
revoke all on function public.queue_institution_verification() from authenticated;
revoke all on function public.queue_institution_verification() from service_role;

create trigger trg_queue_institution_verification
    after insert on public.submissions
    for each row
    when (new.institution_id is null
          and new.intake_status = 'awaiting_institution_verification')
    execute function public.queue_institution_verification();

-- -----------------------------------------------------------------------------
-- 8. Task guard: immutability, transitions, and the correction marker
-- -----------------------------------------------------------------------------
create function public.guard_institution_verification_task() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_old_requester   uuid;
    v_new_requester   uuid;
    v_old_first_line  text;
    v_sub_institution uuid;
begin
    if new.id <> old.id
       or new.submission_id <> old.submission_id
       or new.submitted_institution_name <> old.submitted_institution_name
       or new.created_at <> old.created_at then
        raise exception 'Identification fields of a verification task are immutable'
            using errcode = 'P2V04';
    end if;

    if old.status in ('verified','rejected') then
        raise exception 'A resolved verification task is immutable' using errcode = 'P2V04';
    end if;

    -- The correction requester marker is the authoritative record. Both the
    -- existing and the proposed value are parsed, so a duplicated, misplaced or
    -- malformed marker fails closed (P2V05) instead of being ignored.
    v_old_requester := public.correction_request_requester(old.resolution_notes);
    v_new_requester := public.correction_request_requester(new.resolution_notes);

    if v_old_requester is not null then
        v_old_first_line := split_part(old.resolution_notes, E'\n', 1);
        if position(v_old_first_line in coalesce(new.resolution_notes, '')) <> 1 then
            raise exception 'The correction request record cannot be removed or rewritten'
                using errcode = 'P2V04';
        end if;
        if v_new_requester is distinct from v_old_requester then
            raise exception 'The correction request record cannot be rewritten'
                using errcode = 'P2V04';
        end if;
    elsif v_new_requester is not null then
        -- A marker is written when the round is created, never injected later.
        raise exception 'A correction request record cannot be added after the round started'
            using errcode = 'P2V05';
    end if;

    if new.status <> old.status
       and not ((old.status = 'pending'   and new.status in ('in_review','verified','rejected'))
             or (old.status = 'in_review' and new.status in ('verified','rejected'))) then
        raise exception 'Invalid verification status transition: % -> %', old.status, new.status
            using errcode = 'P2V04';
    end if;

    if new.status in ('verified','rejected') then
        if new.reviewed_by_user_id is null or new.resolved_at is null then
            raise exception 'A resolved task requires a reviewer and a resolution time'
                using errcode = 'P2V05';
        end if;
        if new.resolution_notes is null or btrim(new.resolution_notes) = '' then
            raise exception 'A resolution reason is required' using errcode = 'P2V07';
        end if;
        if not exists (
            select 1 from public.users u
             where u.id = new.reviewed_by_user_id and u.account_status = 'active'
        ) then
            raise exception 'The reviewer must be an active user' using errcode = 'P2V05';
        end if;
    end if;

    if new.status = 'verified' then
        if new.resolved_institution_id is null then
            raise exception 'A verified task requires a resolved institution'
                using errcode = 'P2V05';
        end if;
        if not exists (
            select 1 from public.institutions i
             where i.id = new.resolved_institution_id
               and i.verification_status = 'verified'
               and i.is_active
        ) then
            raise exception 'The resolved institution must be verified and active'
                using errcode = 'P2V09';
        end if;

        -- Fail closed. Re-examining a submission that already carries an
        -- institution requires a requester record, otherwise any write path
        -- could confirm the association with no independent-review trail.
        select s.institution_id
          into v_sub_institution
          from public.submissions s
         where s.id = new.submission_id;

        if v_sub_institution is not null and v_old_requester is null then
            raise exception 'A correction round is missing its requester record'
                using errcode = 'P2V05';
        end if;

        if v_old_requester is not null and v_old_requester = new.reviewed_by_user_id then
            raise exception 'The reviewer who requested this correction cannot confirm it'
                using errcode = 'P2V14';
        end if;
    end if;

    if new.status = 'rejected' and new.resolved_institution_id is not null then
        raise exception 'A rejected task cannot carry a resolved institution'
            using errcode = 'P2V08';
    end if;

    if new.assigned_to_user_id is distinct from old.assigned_to_user_id then
        if new.assigned_to_user_id is not null and not exists (
            select 1 from public.users u
             where u.id = new.assigned_to_user_id and u.account_status = 'active'
        ) then
            raise exception 'The assignee must be an active user' using errcode = 'P2V05';
        end if;
    end if;

    return new;
end;
$$;

alter function public.guard_institution_verification_task() owner to postgres;
revoke all on function public.guard_institution_verification_task() from public;
revoke all on function public.guard_institution_verification_task() from anon;
revoke all on function public.guard_institution_verification_task() from authenticated;
revoke all on function public.guard_institution_verification_task() from service_role;

create trigger trg_guard_institution_verification_task
    before update on public.institution_verification_tasks
    for each row
    execute function public.guard_institution_verification_task();

-- -----------------------------------------------------------------------------
-- 9. Apply a verified outcome to the preserved submission
-- -----------------------------------------------------------------------------
create function public.apply_institution_verification_outcome() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_updated integer;
begin
    if new.status <> 'verified' or old.status = 'verified' then
        return null;
    end if;

    update public.submissions
       set institution_id = new.resolved_institution_id,
           intake_status  = 'awaiting_duplicate_review'
     where id = new.submission_id
       and canonical_case_id is null
       and intake_status in ('received',
                             'awaiting_institution_verification',
                             'awaiting_duplicate_review');

    get diagnostics v_updated = row_count;

    if v_updated <> 1 then
        raise exception 'The submission could not be associated with the verified institution'
            using errcode = 'P2V05';
    end if;

    return null;
end;
$$;

alter function public.apply_institution_verification_outcome() owner to postgres;
revoke all on function public.apply_institution_verification_outcome() from public;
revoke all on function public.apply_institution_verification_outcome() from anon;
revoke all on function public.apply_institution_verification_outcome() from authenticated;
revoke all on function public.apply_institution_verification_outcome() from service_role;

create trigger trg_apply_institution_verification_outcome
    after update on public.institution_verification_tasks
    for each row
    execute function public.apply_institution_verification_outcome();

-- -----------------------------------------------------------------------------
-- 9b. Canonical case creation guard (P2V10)
--
-- A canonical case must never be opened for a submission whose institution is
-- still under human review. This is an additive guard: the frozen Phase 1
-- `validate_case_creation()` trigger is untouched.
--
-- The submission row is locked first, matching the global lock order, so this
-- check cannot race with `request_institution_verification_round`, which locks
-- the same submission before inserting a round. Trigger order is alphabetical
-- (`trg_guard_...` before `trg_validate_...`), so the submission lock is always
-- taken before `validate_case_creation()` takes its institution lock.
-- -----------------------------------------------------------------------------
create function public.guard_case_creation_open_round() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_intake_status text;
begin
    if tg_op = 'UPDATE'
       and new.source_submission_id is not distinct from old.source_submission_id then
        return new;
    end if;

    select s.intake_status
      into v_intake_status
      from public.submissions s
     where s.id = new.source_submission_id
       for update;

    if not found then
        -- Let `validate_case_creation()` report the missing submission.
        return new;
    end if;

    if v_intake_status = 'awaiting_institution_verification' then
        raise exception 'A canonical case cannot be created while institution verification is open'
            using errcode = 'P2V10';
    end if;

    if exists (
        select 1
          from public.institution_verification_tasks t
         where t.submission_id = new.source_submission_id
           and t.status in ('pending','in_review')
    ) then
        raise exception 'A canonical case cannot be created while a verification round is open'
            using errcode = 'P2V10';
    end if;

    return new;
end;
$$;

alter function public.guard_case_creation_open_round() owner to postgres;
revoke all on function public.guard_case_creation_open_round() from public;
revoke all on function public.guard_case_creation_open_round() from anon;
revoke all on function public.guard_case_creation_open_round() from authenticated;
revoke all on function public.guard_case_creation_open_round() from service_role;

create trigger trg_guard_case_creation_open_round
    before insert or update on public.cases
    for each row
    execute function public.guard_case_creation_open_round();

-- -----------------------------------------------------------------------------
-- 10. Submission provenance immutability (whitelist based)
--
-- Everything except the workflow columns below is immutable. A future column is
-- protected automatically because the comparison removes only this whitelist
-- from the JSON image of the row.
-- -----------------------------------------------------------------------------
create function public.guard_submission_immutability() returns trigger
language plpgsql
set search_path = ''
as $$
declare
    c_workflow_columns constant text[] := array[
        'institution_id',
        'intake_status',
        'canonical_case_id',
        'category_id',
        'normalized_text',
        'normalization_version',
        'updated_at'
    ];
begin
    if (to_jsonb(new) - c_workflow_columns) is distinct from (to_jsonb(old) - c_workflow_columns) then
        raise exception 'Submission origin and provenance fields are immutable'
            using errcode = 'P2V13';
    end if;
    return new;
end;
$$;

alter function public.guard_submission_immutability() owner to postgres;
revoke all on function public.guard_submission_immutability() from public;
revoke all on function public.guard_submission_immutability() from anon;
revoke all on function public.guard_submission_immutability() from authenticated;
revoke all on function public.guard_submission_immutability() from service_role;

create trigger trg_guard_submission_immutability
    before update on public.submissions
    for each row
    execute function public.guard_submission_immutability();

-- -----------------------------------------------------------------------------
-- 11. Privilege reduction
-- -----------------------------------------------------------------------------
revoke all on table public.institution_verification_tasks from authenticated;
revoke all on table public.institution_verification_tasks from anon;

revoke insert, update, delete, maintain on table public.cases                from authenticated;
revoke insert, update, delete, maintain on table public.complaint_categories from authenticated;
revoke insert, update, delete, maintain on table public.duplicate_candidates from authenticated;
revoke insert, update, delete, maintain on table public.case_relationships   from authenticated;

-- -----------------------------------------------------------------------------
-- 12. Post-conditions
-- -----------------------------------------------------------------------------
do $$
declare
    v_tables    integer;
    v_result    text;
begin
    select count(*) into v_tables
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r';

    if v_tables <> 32 then
        raise exception 'Phase 2.2 must not change the application table count; found %', v_tables;
    end if;

    if has_table_privilege('authenticated', 'public.institution_verification_tasks', 'SELECT')
       or has_table_privilege('authenticated', 'public.institution_verification_tasks', 'INSERT')
       or has_table_privilege('authenticated', 'public.institution_verification_tasks', 'UPDATE')
       or has_table_privilege('authenticated', 'public.institution_verification_tasks', 'DELETE')
       or has_table_privilege('authenticated', 'public.institution_verification_tasks', 'TRUNCATE')
       or has_table_privilege('authenticated', 'public.institution_verification_tasks', 'REFERENCES')
       or has_table_privilege('authenticated', 'public.institution_verification_tasks', 'TRIGGER')
       or has_table_privilege('authenticated', 'public.institution_verification_tasks', 'MAINTAIN') then
        raise exception 'authenticated must hold no privilege on institution_verification_tasks';
    end if;

    if has_table_privilege('authenticated', 'public.cases', 'MAINTAIN')
       or has_table_privilege('authenticated', 'public.complaint_categories', 'MAINTAIN')
       or has_table_privilege('authenticated', 'public.duplicate_candidates', 'MAINTAIN')
       or has_table_privilege('authenticated', 'public.case_relationships', 'MAINTAIN')
       or has_table_privilege('authenticated', 'public.cases', 'UPDATE')
       or has_table_privilege('authenticated', 'public.complaint_categories', 'INSERT')
       or has_table_privilege('authenticated', 'public.duplicate_candidates', 'DELETE')
       or has_table_privilege('authenticated', 'public.case_relationships', 'UPDATE') then
        raise exception 'Elevated DML/MAINTAIN must be revoked on the four non-intake tables';
    end if;

    if has_function_privilege('anon', 'public.decide_institution_verification(uuid,text,uuid,text,timestamptz)', 'EXECUTE')
       or has_function_privilege('service_role', 'public.decide_institution_verification(uuid,text,uuid,text,timestamptz)', 'EXECUTE')
       or has_function_privilege('anon', 'public.request_institution_verification_round(uuid,text,timestamptz)', 'EXECUTE')
       or has_function_privilege('service_role', 'public.request_institution_verification_round(uuid,text,timestamptz)', 'EXECUTE') then
        raise exception 'Verification commands must only be executable by authenticated';
    end if;

    if not has_function_privilege('authenticated', 'public.institution_verification_task_rows(uuid,text,text,text,text,text,integer,integer)', 'EXECUTE')
       or not has_function_privilege('authenticated', 'public.institution_match_candidates(uuid)', 'EXECUTE')
       or not has_function_privilege('authenticated', 'public.institution_verification_submission_metadata(uuid)', 'EXECUTE') then
        raise exception 'The gated projections must be executable by authenticated';
    end if;

    if has_function_privilege('authenticated', 'public.institution_match_candidates_internal(text,text,integer)', 'EXECUTE') then
        raise exception 'The internal evidence function must not be callable by authenticated';
    end if;

    if has_function_privilege('authenticated', 'public.correction_request_requester(text)', 'EXECUTE')
       or has_function_privilege('anon', 'public.correction_request_requester(text)', 'EXECUTE')
       or has_function_privilege('service_role', 'public.correction_request_requester(text)', 'EXECUTE') then
        raise exception 'The correction marker parser must not be callable by an API role';
    end if;

    if not exists (
        select 1
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = 'correction_request_requester'
           and p.proowner = 'postgres'::regrole
           and 'search_path=""' = any (coalesce(p.proconfig, array[]::text[]))
    ) then
        raise exception 'correction_request_requester must be owned by postgres with an empty search_path';
    end if;

    if exists (
        select 1
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = any (array[
               'institution_verification_submission_metadata',
               'institution_match_candidates',
               'institution_verification_task_rows',
               'decide_institution_verification',
               'request_institution_verification_round',
               'queue_institution_verification',
               'guard_institution_verification_task',
               'apply_institution_verification_outcome',
               'guard_case_creation_open_round'
           ])
           and (
               p.proowner <> 'postgres'::regrole
               or p.prosecdef is not true
               or not ('search_path=""' = any (coalesce(p.proconfig, array[]::text[])))
           )
    ) then
        raise exception 'Every SECURITY DEFINER function must be owned by postgres and pin an empty search_path';
    end if;

    if not exists (
        select 1
          from pg_trigger
         where tgrelid = 'public.cases'::regclass
           and tgname = 'trg_guard_case_creation_open_round'
           and not tgisinternal
    ) then
        raise exception 'The canonical case creation guard trigger is missing';
    end if;

    if not exists (
        select 1
          from pg_trigger
         where tgrelid = 'public.institution_verification_tasks'::regclass
           and tgname = 'trg_guard_institution_verification_task'
           and not tgisinternal
    ) then
        raise exception 'The verification task guard trigger is missing';
    end if;

    v_result := pg_get_function_result(
        'public.institution_verification_task_rows(uuid,text,text,text,text,text,integer,integer)'::regprocedure);

    if position('out_submission_updated_at' in v_result) = 0 then
        raise exception 'Unexpected queue projection return type: %', v_result;
    end if;

    v_result := pg_get_function_result(
        'public.institution_verification_submission_metadata(uuid)'::regprocedure);

    if position('subject' in v_result) > 0 or position('original_text' in v_result) > 0 then
        raise exception 'The metadata projection must not expose complaint content: %', v_result;
    end if;
end
$$;

commit;

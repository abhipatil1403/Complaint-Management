-- =============================================================================
-- AICTE OneDesk - Phase 2.1 simulated complaint intake
--
-- Additive and non-destructive: no table, column, constraint, index or trigger
-- is created, altered or dropped. `public` still has exactly 32 base tables.
--
--  0. A dedicated NOLOGIN role `one_desk_intake` is the only role allowed to
--     create a submission. The public demo portals call FastAPI, never the
--     database, so the demo flags and the rate limiter cannot be bypassed with
--     the public anon key.
--  1. `authenticated` loses INSERT/UPDATE/DELETE on `submissions` and
--     `intake_channels` (SELECT is kept). No API or Data API path can
--     overwrite or delete a preserved submission after this migration.
--  2. Least-privilege SELECT policies: submission bodies require the global
--     SUBMISSION.VIEW capability; channel reference data requires an active
--     application user.
--  3. One narrow write path: public.create_demo_submission(...) SECURITY
--     DEFINER, EXECUTE only for `one_desk_intake`, with an explicit caller
--     allowlist inside the function. All validation, institution resolution
--     and idempotency happen inside PostgreSQL.
--
-- Not in this migration: attachments, institution verification tasks,
-- duplicate detection, case creation, status-vocabulary or CHECK changes.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Trusted backend role for public intake
--
-- `postgres` is the backend's own login role and is never shipped to a browser.
-- `one_desk_intake` can do exactly one thing: execute the intake function.
-- It holds no table privilege, cannot log in, and is not reachable through
-- PostgREST (which only ever assumes `anon`, `authenticated` or `service_role`).
-- -----------------------------------------------------------------------------
do $$
begin
    if not exists (select 1 from pg_catalog.pg_roles where rolname = 'one_desk_intake') then
        create role one_desk_intake nologin;
    end if;
end
$$;

-- Fail loudly rather than silently tolerating a role that was widened.
do $$
declare
    v_can_login   boolean;
    v_bypass_rls  boolean;
    v_superuser   boolean;
begin
    select rolcanlogin, rolbypassrls, rolsuper
      into v_can_login, v_bypass_rls, v_superuser
      from pg_catalog.pg_roles
     where rolname = 'one_desk_intake';

    if v_can_login or v_bypass_rls or v_superuser then
        raise exception
            'role one_desk_intake must be NOLOGIN, NOBYPASSRLS and NOSUPERUSER';
    end if;
end
$$;

grant usage on schema public to one_desk_intake;
grant one_desk_intake to postgres;

-- -----------------------------------------------------------------------------
-- 1. Remove the Data API write path on intake tables
--
-- These tables were granted SELECT/INSERT/UPDATE/DELETE by the initial schema
-- and carry no policies, so RLS denied every row but the grants still existed.
-- Phase 2.1 has exactly one writer (the definer function below); a direct
-- browser/Data API write must never be possible. MAINTAIN (PostgreSQL 17) is
-- removed as well so the Data API cannot VACUUM/ANALYZE/CLUSTER/LOCK them.
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger, maintain
    on table public.submissions, public.intake_channels
    from authenticated;

-- `anon` already holds no table privilege (Phase 1 F10); re-assert it so this
-- migration is self-contained and re-runnable.
revoke all on table public.submissions, public.intake_channels from anon;

-- -----------------------------------------------------------------------------
-- 2. Least-privilege read policies
--
-- SUBMISSION.VIEW is a global capability (D2/D15). A bureau-scoped or
-- unassigned user sees nothing, including through the Data API, because
-- has_global_permission() ignores bureau-scoped roles by construction.
-- -----------------------------------------------------------------------------
drop policy if exists phase2_submissions_select_authorized on public.submissions;
create policy phase2_submissions_select_authorized
    on public.submissions
    for select
    to authenticated
    using (public.has_global_permission('SUBMISSION.VIEW'));

drop policy if exists phase2_intake_channels_select_active on public.intake_channels;
create policy phase2_intake_channels_select_active
    on public.intake_channels
    for select
    to authenticated
    using (public.is_active_user());

-- -----------------------------------------------------------------------------
-- 3. The single write path
--
-- Authorization
--   * SECURITY DEFINER, owner postgres, `set search_path = ''`; every
--     identifier below is schema-qualified and there is no dynamic SQL.
--   * Caller allowlist: `current_setting('role')` must be exactly
--     'one_desk_intake'. Verified on PostgreSQL 17: the `role` GUC reports the
--     caller's SET ROLE value inside a SECURITY DEFINER body, while
--     `current_user` is the definer. Every other role (anon, authenticated,
--     service_role, postgres without SET ROLE, 'none') is refused before any
--     work happens, so an accidental future EXECUTE grant still cannot create a
--     submission.
--   * EXECUTE is revoked from PUBLIC/anon/authenticated/service_role and
--     granted to `one_desk_intake` only. The project's default privileges grant
--     EXECUTE on new functions to anon/authenticated/service_role, so the
--     revoke is required, not decorative.
--
-- Input validation (enforced in SQL, not only in FastAPI)
--   * channel must exist, be active, be is_simulated, and be type
--     portal|cpgrams;
--   * consent_acknowledged must be true;
--   * language allowlist en|hi (case-folded); no translation, no normalization
--     of subject or body;
--   * subject 1..200 chars, single line; body 1..20000 chars; institution name
--     <= 300; permanent ID <= 64; source_event_id <= 64; idempotency key <="128;
--   * control characters rejected (NUL and C0 minus tab/LF/CR in the body);
--   * at least one of permanent ID / institution name required;
--   * source_submitted_at may not be more than 5 minutes in the future;
--   * unknown/inactive category code is an error, never silently dropped;
--   * institution resolution is an exact match on an active, `verified`
--     aicte_permanent_id only, and fails closed (unresolved) unless exactly one
--     row matches. Name/alias matching is Phase 2.2.
--
-- Concurrency and idempotency
--   * Canonical payload = jsonb_build_object of payload_version, channel_code,
--     institution_permanent_id, institution_name_as_submitted, subject,
--     original_text, original_language, category_code, source_event_id and
--     source_submitted_at normalised to UTC with millisecond precision.
--     jsonb text output sorts keys deterministically, so the payload string is
--     stable regardless of argument order. request_hash is
--     sha256(payload::text) in hex.
--     Excluded on purpose: idempotency_key (the lookup scope, not content).
--   * When a key is supplied, transaction-scoped advisory locks are taken on
--     the sorted hash of each key scope, so two concurrent retries serialise
--     instead of racing and cannot deadlock each other.
--   * Under the lock the function pre-selects by idempotency_key or
--     source_event_id. One row + equal request_hash => replay; one row +
--     different hash => conflict (no ids returned); rows matching both keys
--     => conflict.
--   * The unique indexes submissions_idempotency_uq /
--     submissions_source_event_uq remain the final backstop. A
--     unique_violation rolls the insert back to its savepoint, re-reads and
--     classifies the same way, so a duplicate row is impossible.
--
-- Disclosure
--   * Responses contain ids, channel, reference, status and timestamps only.
--     Complaint text is never echoed, and validation failures return a field
--     name plus a code, never the submitted value.
--   * No IP address, user agent or submitter identity is stored (D9).
-- -----------------------------------------------------------------------------
create or replace function public.create_demo_submission(
    p_channel_code                    text,
    p_institution_permanent_id        text,
    p_institution_name_as_submitted   text,
    p_subject                         text,
    p_original_text                   text,
    p_original_language               text,
    p_category_code                   text,
    p_source_event_id                 text,
    p_idempotency_key                 text,
    p_source_submitted_at             timestamptz,
    p_consent_acknowledged            boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $fn$
declare
    c_max_subject     constant integer  := 200;
    c_max_text        constant integer  := 20000;
    c_max_name        constant integer  := 300;
    c_max_id          constant integer  := 64;
    c_max_event       constant integer  := 64;
    c_max_idem        constant integer  := 128;
    c_clock_skew      constant interval := interval '5 minutes';
    c_payload_version constant text     := '1';
    c_notice_version  constant text     := 'SIM-NOTICE-2026-10-29-v1';

    v_caller_role    text;
    v_channel_id     uuid;
    v_channel_code   text;
    v_channel_name   text;
    v_channel_sim    boolean;
    v_pid_raw        text;
    v_pid            text;
    v_name           text;
    v_event          text;
    v_idem           text;
    v_category_code  text;
    v_category_id    uuid;
    v_language       text;
    v_text           text;
    v_subject        text;
    v_source_at      text;
    v_match_count    integer;
    v_institution_id uuid;
    v_status         text;
    v_payload        jsonb;
    v_request_hash   text;
    v_lock_keys      bigint[];
    v_rows           integer;
    v_existing       public.submissions%rowtype;
    v_new_id         uuid;
    v_received_at    timestamptz;
    v_reference      text;
begin
    -- ---- 0. caller allowlist (defence in depth) ----------------------------
    -- The grant already excludes every browser-reachable role. If a future
    -- change ever granted EXECUTE too widely, the call still does nothing and
    -- reveals nothing. `role` is the caller's SET ROLE value; `current_user`
    -- here is the definer and is therefore not usable for this check.
    v_caller_role := pg_catalog.current_setting('role', true);
    if v_caller_role is distinct from 'one_desk_intake' then
        return pg_catalog.jsonb_build_object(
            'outcome', 'channel_unavailable',
            'code',    'INTAKE_CHANNEL_UNAVAILABLE');
    end if;

    -- ---- 1. channel --------------------------------------------------------
    select c.id, c.code, c.name, c.is_simulated
      into v_channel_id, v_channel_code, v_channel_name, v_channel_sim
      from public.intake_channels c
     where c.code = pg_catalog.upper(pg_catalog.btrim(coalesce(p_channel_code, '')))
       and c.is_active
       and c.is_simulated
       and c.channel_type in ('portal', 'cpgrams');

    if v_channel_id is null then
        return pg_catalog.jsonb_build_object(
            'outcome', 'channel_unavailable',
            'code',    'INTAKE_CHANNEL_UNAVAILABLE');
    end if;

    -- ---- 2. consent --------------------------------------------------------
    if p_consent_acknowledged is not true then
        return pg_catalog.jsonb_build_object(
            'outcome', 'validation_error',
            'code',    'CONSENT_REQUIRED',
            'field',   'consent_acknowledged');
    end if;

    -- ---- 3. language -------------------------------------------------------
    if p_original_language is null
       or pg_catalog.lower(pg_catalog.btrim(p_original_language)) not in ('en', 'hi') then
        return pg_catalog.jsonb_build_object(
            'outcome', 'validation_error',
            'code',    'UNSUPPORTED_LANGUAGE',
            'field',   'original_language');
    end if;
    v_language := pg_catalog.lower(pg_catalog.btrim(p_original_language));

    -- ---- 4. subject (stored verbatim) --------------------------------------
    v_subject := p_subject;
    if v_subject is null or pg_catalog.btrim(v_subject) = '' then
        return pg_catalog.jsonb_build_object(
            'outcome', 'validation_error',
            'code',    'SUBJECT_REQUIRED',
            'field',   'subject');
    end if;
    if pg_catalog.length(v_subject) > c_max_subject then
        return pg_catalog.jsonb_build_object(
            'outcome', 'validation_error',
            'code',    'SUBJECT_TOO_LONG',
            'field',   'subject');
    end if;
    if v_subject ~ E'[\\x01-\\x1F\\x7F]' then
        return pg_catalog.jsonb_build_object(
            'outcome', 'validation_error',
            'code',    'SUBJECT_INVALID_CHARACTERS',
            'field',   'subject');
    end if;

    -- ---- 5. complaint body (stored verbatim, never normalized) -------------
    v_text := p_original_text;
    if v_text is null or pg_catalog.btrim(v_text) = '' then
        return pg_catalog.jsonb_build_object(
            'outcome', 'validation_error',
            'code',    'TEXT_REQUIRED',
            'field',   'original_text');
    end if;
    if pg_catalog.length(v_text) > c_max_text then
        return pg_catalog.jsonb_build_object(
            'outcome', 'validation_error',
            'code',    'TEXT_TOO_LONG',
            'field',   'original_text');
    end if;
    if v_text ~ E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]' then
        return pg_catalog.jsonb_build_object(
            'outcome', 'validation_error',
            'code',    'TEXT_INVALID_CHARACTERS',
            'field',   'original_text');
    end if;

    -- ---- 6. institution identifiers ----------------------------------------
    v_pid_raw := nullif(pg_catalog.btrim(p_institution_permanent_id), '');
    if v_pid_raw is not null then
        if pg_catalog.length(v_pid_raw) > c_max_id then
            return pg_catalog.jsonb_build_object(
                'outcome', 'validation_error',
                'code',    'INSTITUTION_ID_TOO_LONG',
                'field',   'institution_permanent_id');
        end if;
        v_pid := v_pid_raw;
    end if;

    if p_institution_name_as_submitted is not null
       and pg_catalog.btrim(p_institution_name_as_submitted) <> '' then
        if pg_catalog.length(p_institution_name_as_submitted) > c_max_name then
            return pg_catalog.jsonb_build_object(
                'outcome', 'validation_error',
                'code',    'INSTITUTION_NAME_TOO_LONG',
                'field',   'institution_name_as_submitted');
        end if;
        -- stored exactly as submitted
        v_name := p_institution_name_as_submitted;
    end if;

    if v_pid is null and v_name is null then
        return pg_catalog.jsonb_build_object(
            'outcome', 'validation_error',
            'code',    'INSTITUTION_IDENTIFIER_REQUIRED',
            'field',   'institution');
    end if;

    -- ---- 7. category (optional; 0 categories are seeded in 2.1) ------------
    v_category_code := nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(p_category_code, ''))), '');
    if v_category_code is not null then
        select cat.id into v_category_id
          from public.complaint_categories cat
         where cat.code = v_category_code
           and cat.is_active;
        if v_category_id is null then
            return pg_catalog.jsonb_build_object(
                'outcome', 'validation_error',
                'code',    'UNKNOWN_CATEGORY',
                'field',   'category_code');
        end if;
    end if;

    -- ---- 8. source identity ------------------------------------------------
    v_event := nullif(pg_catalog.btrim(p_source_event_id), '');
    if v_event is not null and pg_catalog.length(v_event) > c_max_event then
        return pg_catalog.jsonb_build_object(
            'outcome', 'validation_error',
            'code',    'SOURCE_EVENT_ID_TOO_LONG',
            'field',   'source_event_id');
    end if;

    v_idem := nullif(pg_catalog.btrim(p_idempotency_key), '');
    if v_idem is not null and pg_catalog.length(v_idem) > c_max_idem then
        return pg_catalog.jsonb_build_object(
            'outcome', 'validation_error',
            'code',    'IDEMPOTENCY_KEY_TOO_LONG',
            'field',   'idempotency_key');
    end if;

    if p_source_submitted_at is not null
       and p_source_submitted_at > pg_catalog.now() + c_clock_skew then
        return pg_catalog.jsonb_build_object(
            'outcome', 'validation_error',
            'code',    'SOURCE_TIME_IN_FUTURE',
            'field',   'source_submitted_at');
    end if;

    -- Normalised once: the same string is hashed and stored, so the hash input
    -- and the preserved provenance can never drift apart.
    v_source_at := case
                       when p_source_submitted_at is null then null
                       else pg_catalog.to_char(
                                p_source_submitted_at at time zone 'UTC',
                                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                   end;

    -- ---- 9. institution resolution (exact, fail closed) --------------------
    if v_pid is not null then
        select count(*), (pg_catalog.array_agg(i.id))[1]
          into v_match_count, v_institution_id
          from public.institutions i
         where i.aicte_permanent_id = v_pid
           and i.verification_status = 'verified'
           and i.is_active;

        if v_match_count <> 1 then
            v_institution_id := null;   -- unresolved: Phase 2.2 decides
        end if;
    end if;

    v_status := case
                    when v_institution_id is null
                        then 'awaiting_institution_verification'
                    else 'awaiting_duplicate_review'
                end;

    -- ---- 10. canonical payload --------------------------------------------
    v_payload := pg_catalog.jsonb_build_object(
        'payload_version',               c_payload_version,
        'channel_code',                  v_channel_code,
        'institution_permanent_id',      v_pid,
        'institution_name_as_submitted', v_name,
        'subject',                       v_subject,
        'original_text',                 v_text,
        'original_language',             v_language,
        'category_code',                 v_category_code,
        'source_event_id',               v_event,
        'source_submitted_at',           v_source_at
    );

    v_request_hash := pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(v_payload::text, 'UTF8')), 'hex');

    -- ---- 11. serialise concurrent retries on the same identity ------------
    v_lock_keys := pg_catalog.array_remove(array[
        case when v_idem is not null then
            pg_catalog.hashtextextended('demo_intake:idem:' || v_channel_id::text || ':' || v_idem, 0)
        end,
        case when v_event is not null then
            pg_catalog.hashtextextended('demo_intake:event:' || v_channel_id::text || ':' || v_event, 0)
        end
    ], null);

    if pg_catalog.array_length(v_lock_keys, 1) is not null then
        perform pg_catalog.pg_advisory_xact_lock(s.k)
           from (select distinct k from pg_catalog.unnest(v_lock_keys) as t(k) order by k) s;
    end if;

    -- ---- 12. replay / conflict pre-check ----------------------------------
    select count(distinct s.id) into v_rows
      from public.submissions s
     where s.intake_channel_id = v_channel_id
       and (   (v_idem  is not null and s.idempotency_key = v_idem)
            or (v_event is not null and s.source_event_id  = v_event));

    if v_rows > 1 then
        return pg_catalog.jsonb_build_object(
            'outcome', 'conflict',
            'code',    'SOURCE_IDENTITY_CONFLICT');
    end if;

    if v_rows = 1 then
        select * into v_existing
          from public.submissions s
         where s.intake_channel_id = v_channel_id
           and (   (v_idem  is not null and s.idempotency_key = v_idem)
                or (v_event is not null and s.source_event_id  = v_event))
         order by s.received_at, s.id
         limit 1;

        if v_existing.source_metadata ->> 'request_hash' = v_request_hash
           and v_existing.source_metadata ->> 'payload_version' = c_payload_version then
            return pg_catalog.jsonb_build_object(
                'outcome',              'replay',
                'submission_id',        v_existing.id,
                'channel_code',         v_channel_code,
                'channel_name',         v_channel_name,
                'is_simulated',         v_channel_sim,
                'external_reference',   v_existing.external_reference,
                'intake_status',        v_existing.intake_status,
                'institution_resolved', v_existing.institution_id is not null,
                'received_at',          v_existing.received_at);
        end if;

        return pg_catalog.jsonb_build_object(
            'outcome', 'conflict',
            'code',    'IDEMPOTENCY_PAYLOAD_MISMATCH');
    end if;

    -- ---- 13. insert exactly once ------------------------------------------
    v_reference := 'SIM-' || v_channel_code || '-'
        || pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYYMMDD') || '-'
        || pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 12);

    begin
        insert into public.submissions (
            intake_channel_id,
            external_reference,
            source_event_id,
            institution_id,
            institution_name_as_submitted,
            category_id,
            subject,
            original_text,
            original_language,
            normalized_text,
            normalization_version,
            submitter_reference,
            intake_status,
            content_fingerprint,
            idempotency_key,
            source_metadata
        ) values (
            v_channel_id,
            v_reference,
            v_event,
            v_institution_id,
            v_name,
            v_category_id,
            v_subject,
            v_text,
            v_language,
            null,   -- no normalization in 2.1
            null,
            null,   -- no submitter identity is collected (D9)
            v_status,
            pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_text, 'UTF8')), 'hex'),
            v_idem,
            pg_catalog.jsonb_build_object(
                'demo',                                  true,
                'simulation_notice_version',             c_notice_version,
                'consent_acknowledged',                  true,
                'reference_origin',                      'demo_generated',
                'payload_version',                       c_payload_version,
                'request_hash',                          v_request_hash,
                'fingerprint_version',                   'sha256-v1',
                'institution_permanent_id_as_submitted', v_pid_raw,
                'source_submitted_at',                   v_source_at,
                'received_at_origin',                    'server_clock')
        )
        returning id, received_at into v_new_id, v_received_at;

    exception when unique_violation then
        -- Backstop: a concurrent writer won the race despite the advisory lock
        -- (or a unique constraint outside our keys fired).
        select * into v_existing
          from public.submissions s
         where s.intake_channel_id = v_channel_id
           and (   (v_idem  is not null and s.idempotency_key = v_idem)
                or (v_event is not null and s.source_event_id  = v_event))
         order by s.received_at, s.id
         limit 1;

        if v_existing.id is null then
            raise;
        end if;

        if v_existing.source_metadata ->> 'request_hash' = v_request_hash
           and v_existing.source_metadata ->> 'payload_version' = c_payload_version then
            return pg_catalog.jsonb_build_object(
                'outcome',              'replay',
                'submission_id',        v_existing.id,
                'channel_code',         v_channel_code,
                'channel_name',         v_channel_name,
                'is_simulated',         v_channel_sim,
                'external_reference',   v_existing.external_reference,
                'intake_status',        v_existing.intake_status,
                'institution_resolved', v_existing.institution_id is not null,
                'received_at',          v_existing.received_at);
        end if;

        return pg_catalog.jsonb_build_object(
            'outcome', 'conflict',
            'code',    'IDEMPOTENCY_PAYLOAD_MISMATCH');
    end;

    return pg_catalog.jsonb_build_object(
        'outcome',              'created',
        'submission_id',        v_new_id,
        'channel_code',         v_channel_code,
        'channel_name',         v_channel_name,
        'is_simulated',         v_channel_sim,
        'external_reference',   v_reference,
        'intake_status',        v_status,
        'institution_resolved', v_institution_id is not null,
        'received_at',          v_received_at);
end;
$fn$;

alter function public.create_demo_submission(
    text, text, text, text, text, text, text, text, text, timestamptz, boolean
) owner to postgres;

-- The initial schema's default privileges grant EXECUTE on new functions to
-- anon/authenticated/service_role. Remove every implicit grant first.
revoke all on function public.create_demo_submission(
    text, text, text, text, text, text, text, text, text, timestamptz, boolean
) from public;
revoke all on function public.create_demo_submission(
    text, text, text, text, text, text, text, text, text, timestamptz, boolean
) from anon, authenticated, service_role;

grant execute on function public.create_demo_submission(
    text, text, text, text, text, text, text, text, text, timestamptz, boolean
) to one_desk_intake;

commit;

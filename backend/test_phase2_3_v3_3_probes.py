import os
import sys
from dotenv import load_dotenv
import psycopg

load_dotenv('.env')
load_dotenv('backend/.env')

MIGRATION_0005_SQL = """
-- =============================================================================
-- Migration 0005: Phase 2.3 Duplicate Detection, Review & Case Creation (v3.3)
-- =============================================================================

-- 1. Sequence for monotonic non-cycling case numbers across calendar years
-- Note: PostgreSQL sequences are strictly monotonic and non-cycling, but are NOT guaranteed gapless
-- because aborted/rolled back transactions and system restarts advance the sequence without consuming the number.
CREATE SEQUENCE IF NOT EXISTS public.case_number_seq
    AS bigint
    INCREMENT BY 1
    MINVALUE 1
    NO CYCLE;

-- 2. Seed Permissions (Provenance-aware: Verified 0 pre-existing rows in pre-migration check)
INSERT INTO public.permissions (code, name, description, resource_type, action_type, is_active)
VALUES
    ('DUPLICATE.REVIEW', 'Review duplicate complaint candidates', 'Review and decide duplicate complaint candidate pairs', 'duplicate_candidates', 'review', true),
    ('CASE.CREATE', 'Create canonical complaint cases', 'Create new canonical complaint cases from screened submissions', 'cases', 'create', true),
    ('CASE.VIEW_INDEX', 'View cross-bureau minimal case index', 'Discover case metadata across all bureaus without detail access', 'cases', 'view_index', true),
    ('CASE.VIEW_DETAIL', 'View full case details', 'Access comprehensive case descriptions, attachments, and bureau remarks', 'cases', 'view_detail', true),
    ('SUBMISSION.REJECT', 'Reject invalid intake submissions', 'Reject submissions failing verification or duplicate checks', 'submissions', 'reject', true)
ON CONFLICT (code) DO NOTHING;

-- Map permissions to roles
-- NOTE: SUBMISSION.REJECT is strictly a global intake authority granted only to global roles (SUPER_ADMIN)
DO $$
DECLARE
    v_sa_id uuid;
    v_co_id uuid;
    v_ba_id uuid;
    v_cb_id uuid;
    v_sm_id uuid;
    v_au_id uuid;
    v_perm_rec RECORD;
BEGIN
    SELECT id INTO v_sa_id FROM public.roles WHERE code = 'SUPER_ADMIN';
    SELECT id INTO v_co_id FROM public.roles WHERE code = 'CASE_OFFICER';
    SELECT id INTO v_ba_id FROM public.roles WHERE code = 'BUREAU_ADMIN';
    SELECT id INTO v_cb_id FROM public.roles WHERE code = 'CROSS_BUREAU_COLLABORATOR';
    SELECT id INTO v_sm_id FROM public.roles WHERE code = 'SENIOR_MANAGEMENT';
    SELECT id INTO v_au_id FROM public.roles WHERE code = 'AUDITOR';

    FOR v_perm_rec IN 
        SELECT id, code FROM public.permissions 
        WHERE code IN ('DUPLICATE.REVIEW', 'CASE.CREATE', 'CASE.VIEW_INDEX', 'CASE.VIEW_DETAIL', 'SUBMISSION.REJECT')
    LOOP
        -- Super Admin (global: all capabilities including SUBMISSION.REJECT)
        IF v_sa_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id)
            VALUES (v_sa_id, v_perm_rec.id) ON CONFLICT DO NOTHING;
        END IF;

        -- Senior Management (global)
        IF v_sm_id IS NOT NULL AND v_perm_rec.code IN ('DUPLICATE.REVIEW', 'CASE.VIEW_INDEX', 'CASE.VIEW_DETAIL') THEN
            INSERT INTO public.role_permissions (role_id, permission_id)
            VALUES (v_sm_id, v_perm_rec.id) ON CONFLICT DO NOTHING;
        END IF;

        -- Case Officer (bureau-scoped: strictly no SUBMISSION.REJECT)
        IF v_co_id IS NOT NULL AND v_perm_rec.code IN ('CASE.CREATE', 'CASE.VIEW_INDEX', 'CASE.VIEW_DETAIL') THEN
            INSERT INTO public.role_permissions (role_id, permission_id)
            VALUES (v_co_id, v_perm_rec.id) ON CONFLICT DO NOTHING;
        END IF;

        -- Bureau Admin (bureau-scoped: strictly no SUBMISSION.REJECT)
        IF v_ba_id IS NOT NULL AND v_perm_rec.code IN ('CASE.CREATE', 'CASE.VIEW_INDEX', 'CASE.VIEW_DETAIL') THEN
            INSERT INTO public.role_permissions (role_id, permission_id)
            VALUES (v_ba_id, v_perm_rec.id) ON CONFLICT DO NOTHING;
        END IF;

        -- Cross-Bureau Collaborator
        IF v_cb_id IS NOT NULL AND v_perm_rec.code IN ('CASE.VIEW_INDEX', 'CASE.VIEW_DETAIL') THEN
            INSERT INTO public.role_permissions (role_id, permission_id)
            VALUES (v_cb_id, v_perm_rec.id) ON CONFLICT DO NOTHING;
        END IF;

        -- Auditor
        IF v_au_id IS NOT NULL AND v_perm_rec.code = 'CASE.VIEW_INDEX' THEN
            INSERT INTO public.role_permissions (role_id, permission_id)
            VALUES (v_au_id, v_perm_rec.id) ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
END $$;

-- 3. Database-level Invariant: Immutability of Decided Duplicate Candidates
CREATE OR REPLACE FUNCTION public.guard_duplicate_candidate_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.review_status <> 'pending' THEN
            RAISE EXCEPTION 'A decided duplicate candidate is immutable and cannot be deleted'
                USING ERRCODE = 'P2D04';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- If previously decided, no further modification is permitted
        IF OLD.review_status <> 'pending' THEN
            RAISE EXCEPTION 'A decided duplicate candidate is immutable'
                USING ERRCODE = 'P2D04';
        END IF;

        -- Submissions and candidate cases are strictly immutable foreign keys
        IF NEW.submission_id <> OLD.submission_id OR NEW.candidate_case_id <> OLD.candidate_case_id THEN
            RAISE EXCEPTION 'Candidate pair association is immutable'
                USING ERRCODE = 'P2D04';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_duplicate_candidate_immutability ON public.duplicate_candidates;
CREATE TRIGGER trg_guard_duplicate_candidate_immutability
    BEFORE UPDATE OR DELETE ON public.duplicate_candidates
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_duplicate_candidate_immutability();

-- 4. Caller-Bound Authorization Helper: can_access_case_details(p_case_id)
CREATE OR REPLACE FUNCTION public.can_access_case_details(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
    SELECT (
        EXISTS (
            SELECT 1 FROM public.users u
             WHERE u.id = public.auth_uid()
               AND u.account_status = 'active'
        )
        AND (
            -- Path A: Authorized global detail access capability
            public.has_global_permission('CASE.VIEW_DETAIL')
            OR
            (
                -- Path B: Bureau-scoped capability AND case-specific access
                public.has_permission('CASE.VIEW_DETAIL')
                AND (
                    -- B1: Active member of any currently assigned bureau
                    EXISTS (
                        SELECT 1
                          FROM public.case_bureau_assignments cba
                          JOIN public.bureau_memberships bm
                            ON bm.bureau_id = cba.bureau_id
                           AND bm.user_id = public.auth_uid()
                           AND bm.membership_status = 'active'
                           AND (bm.ended_at IS NULL OR bm.ended_at > now())
                         WHERE cba.case_id = p_case_id
                           AND cba.assignment_status = 'active'
                    )
                    OR
                    -- B2: Active, unrevoked case access grant
                    EXISTS (
                        SELECT 1 FROM public.case_access_grants cag
                         WHERE cag.case_id = p_case_id
                           AND cag.grantee_user_id = public.auth_uid()
                           AND cag.revoked_at IS NULL
                           AND (cag.expires_at IS NULL OR cag.expires_at > now())
                    )
                )
            )
        )
    );
$$;

-- 5. Candidate Generation & Screening Completion Function
CREATE OR REPLACE FUNCTION public.generate_duplicate_candidates(
    p_submission_id uuid,
    p_expected_submission_updated_at timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '15s'
SET lock_timeout TO '5s'
AS $$
DECLARE
    v_actor          uuid;
    v_sub            public.submissions%ROWTYPE;
    v_inserted       integer := 0;
    v_pending_count  integer := 0;
    v_rec            RECORD;
    v_score          numeric(4,3);
    v_signals        jsonb;
    v_has_evidence   boolean;
BEGIN
    IF p_expected_submission_updated_at IS NULL THEN
        RAISE EXCEPTION 'An optimistic concurrency token is required for the submission' USING ERRCODE = 'P2D12';
    END IF;

    -- Submissions do not carry bureau ownership; duplicate review requires global DUPLICATE.REVIEW
    IF NOT public.has_global_permission('DUPLICATE.REVIEW') THEN
        RAISE EXCEPTION 'The global DUPLICATE.REVIEW capability is required' USING ERRCODE = '42501';
    END IF;

    v_actor := public.auth_uid();
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'An authenticated caller is required' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.users u
         WHERE u.id = v_actor AND u.account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'The caller account is not active' USING ERRCODE = '42501';
    END IF;

    -- STRICT GLOBAL LOCK ORDER: Step 1 -> Lock submission FOR UPDATE
    SELECT * INTO v_sub
      FROM public.submissions
     WHERE id = p_submission_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission not found' USING ERRCODE = 'P2D02';
    END IF;

    IF v_sub.updated_at <> p_expected_submission_updated_at THEN
        RAISE EXCEPTION 'The submission was modified by another reviewer' USING ERRCODE = 'P2D01';
    END IF;

    IF v_sub.canonical_case_id IS NOT NULL OR v_sub.intake_status IN ('associated_with_case', 'rejected') THEN
        RAISE EXCEPTION 'The submission is already resolved or associated with a case' USING ERRCODE = 'P2D06';
    END IF;

    IF v_sub.institution_id IS NULL THEN
        RAISE EXCEPTION 'Submission must have a verified institution before duplicate screening' USING ERRCODE = 'P2D02';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.institution_verification_tasks t
         WHERE t.submission_id = v_sub.id
           AND t.status IN ('pending', 'in_review')
    ) THEN
        RAISE EXCEPTION 'Active institution verification or correction round is in progress' USING ERRCODE = 'P2D03';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.institutions i
         WHERE i.id = v_sub.institution_id
           AND i.is_active = true
           AND i.verification_status = 'verified'
    ) THEN
        RAISE EXCEPTION 'The associated institution is not verified and active' USING ERRCODE = 'P2D04';
    END IF;

    -- Candidate Matching Query with Concrete Evidence Thresholds
    FOR v_rec IN (
        SELECT c.id AS candidate_case_id,
               c.case_number,
               c.primary_category_id,
               c.source_submission_id,
               c.status,
               s_orig.content_fingerprint AS orig_fingerprint,
               s_orig.subject AS orig_subject
          FROM public.cases c
          JOIN public.submissions s_orig ON s_orig.id = c.source_submission_id
         WHERE c.institution_id = v_sub.institution_id
           AND (
               c.status <> 'closed'
               OR coalesce(c.closed_at, c.updated_at) >= now() - interval '60 days'
           )
           AND NOT EXISTS (
               SELECT 1 FROM public.duplicate_candidates dc
                WHERE dc.submission_id = v_sub.id
                  AND dc.candidate_case_id = c.id
                  AND dc.review_status IN ('not_duplicate', 'related', 'confirmed_duplicate')
           )
    ) LOOP
        v_has_evidence := false;
        v_score := 0.000;
        v_signals := jsonb_build_object(
            'same_institution', true,
            'lookback_eligible', true,
            'target_status', v_rec.status
        );

        IF v_sub.content_fingerprint IS NOT NULL 
           AND v_rec.orig_fingerprint IS NOT NULL 
           AND v_sub.content_fingerprint = v_rec.orig_fingerprint THEN
            v_score := 1.000;
            v_signals := v_signals || jsonb_build_object(
                'exact_fingerprint_match', true,
                'heuristic_label', 'Exact content fingerprint match'
            );
            v_has_evidence := true;
        ELSIF v_sub.category_id IS NOT NULL 
              AND v_rec.primary_category_id IS NOT NULL 
              AND v_sub.category_id = v_rec.primary_category_id THEN
            v_score := 0.900;
            v_signals := v_signals || jsonb_build_object(
                'category_match', true,
                'heuristic_label', 'Same institution and complaint category (uncalibrated rule heuristic)'
            );
            v_has_evidence := true;
        ELSIF v_sub.subject IS NOT NULL 
              AND v_rec.orig_subject IS NOT NULL 
              AND (
                  v_sub.subject ILIKE '%' || v_rec.orig_subject || '%' 
                  OR v_rec.orig_subject ILIKE '%' || v_sub.subject || '%'
              ) THEN
            v_score := 0.600;
            v_signals := v_signals || jsonb_build_object(
                'subject_overlap', true,
                'heuristic_label', 'Same institution with subject keyword overlap (uncalibrated rule heuristic)'
            );
            v_has_evidence := true;
        END IF;

        IF v_has_evidence THEN
            INSERT INTO public.duplicate_candidates (
                submission_id,
                candidate_case_id,
                similarity_score,
                matching_method,
                matching_signals,
                review_status
            ) VALUES (
                v_sub.id,
                v_rec.candidate_case_id,
                v_score,
                'rules',
                v_signals,
                'pending'
            )
            ON CONFLICT (submission_id, candidate_case_id) DO NOTHING;

            IF FOUND THEN
                v_inserted := v_inserted + 1;
            END IF;
        END IF;
    END LOOP;

    -- Screening completion check against total persisted pending candidates
    SELECT count(*) INTO v_pending_count
      FROM public.duplicate_candidates
     WHERE submission_id = v_sub.id
       AND review_status = 'pending';

    IF v_pending_count = 0 THEN
        UPDATE public.submissions
           SET intake_status = 'ready_for_case_creation',
               updated_at = now()
         WHERE id = v_sub.id;
    ELSE
        UPDATE public.submissions
           SET intake_status = 'awaiting_duplicate_review',
               updated_at = now()
         WHERE id = v_sub.id;
    END IF;

    RETURN v_inserted;
END;
$$;

-- 6. Duplicate Decision Function (with Target Case Institution & Eligibility Verification)
CREATE OR REPLACE FUNCTION public.decide_duplicate_candidate(
    p_candidate_id uuid,
    p_action text,
    p_notes text,
    p_expected_submission_updated_at timestamptz,
    p_expected_candidate_updated_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '15s'
SET lock_timeout TO '5s'
AS $$
DECLARE
    v_actor          uuid;
    v_candidate      public.duplicate_candidates%ROWTYPE;
    v_sub            public.submissions%ROWTYPE;
    v_case           public.cases%ROWTYPE;
    v_submission_id  uuid;
    v_case_id        uuid;
    v_notes          text;
    v_pending_count  integer;
BEGIN
    IF p_expected_submission_updated_at IS NULL THEN
        RAISE EXCEPTION 'An optimistic concurrency token is required for the submission' USING ERRCODE = 'P2D12';
    END IF;
    IF p_expected_candidate_updated_at IS NULL THEN
        RAISE EXCEPTION 'An optimistic concurrency token is required for the candidate' USING ERRCODE = 'P2D12';
    END IF;

    -- Submissions do not carry bureau ownership; duplicate review requires global DUPLICATE.REVIEW
    IF NOT public.has_global_permission('DUPLICATE.REVIEW') THEN
        RAISE EXCEPTION 'The global DUPLICATE.REVIEW capability is required' USING ERRCODE = '42501';
    END IF;

    v_actor := public.auth_uid();
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'An authenticated caller is required' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.users u
         WHERE u.id = v_actor AND u.account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'The caller account is not active' USING ERRCODE = '42501';
    END IF;

    IF p_action NOT IN ('confirmed_duplicate', 'not_duplicate', 'related') THEN
        RAISE EXCEPTION 'Invalid duplicate decision action: %', p_action USING ERRCODE = 'P2D05';
    END IF;

    v_notes := nullif(btrim(coalesce(p_notes, '')), '');
    IF v_notes IS NULL THEN
        RAISE EXCEPTION 'A justification reason is required for duplicate review decisions' USING ERRCODE = 'P2D07';
    END IF;

    SELECT submission_id, candidate_case_id
      INTO v_submission_id, v_case_id
      FROM public.duplicate_candidates
     WHERE id = p_candidate_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Duplicate candidate pair not found' USING ERRCODE = 'P2D02';
    END IF;

    -- STRICT LOCK ORDER: submissions -> cases -> duplicate_candidates -> institutions (SHARE)
    SELECT * INTO v_sub
      FROM public.submissions
     WHERE id = v_submission_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission not found' USING ERRCODE = 'P2D02';
    END IF;

    SELECT * INTO v_case
      FROM public.cases
     WHERE id = v_case_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target candidate case not found' USING ERRCODE = 'P2D02';
    END IF;

    SELECT * INTO v_candidate
      FROM public.duplicate_candidates
     WHERE id = p_candidate_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Duplicate candidate not found' USING ERRCODE = 'P2D02';
    END IF;

    IF v_sub.updated_at <> p_expected_submission_updated_at THEN
        RAISE EXCEPTION 'The submission was modified by another reviewer' USING ERRCODE = 'P2D01';
    END IF;
    IF v_candidate.updated_at <> p_expected_candidate_updated_at THEN
        RAISE EXCEPTION 'The candidate was modified by another reviewer' USING ERRCODE = 'P2D01';
    END IF;

    IF v_candidate.review_status <> 'pending' THEN
        RAISE EXCEPTION 'A decided duplicate candidate is immutable' USING ERRCODE = 'P2D04';
    END IF;

    IF v_sub.institution_id IS NULL THEN
        RAISE EXCEPTION 'Submission has no verified institution' USING ERRCODE = 'P2D02';
    END IF;

    -- Case Association Integrity: Target case MUST belong to submission's verified institution
    IF v_case.institution_id IS DISTINCT FROM v_sub.institution_id THEN
        RAISE EXCEPTION 'Target candidate case institution does not match submission verified institution' USING ERRCODE = 'P2D08';
    END IF;

    -- Case Association Integrity: A closed case is ineligible for duplicate association
    IF p_action IN ('confirmed_duplicate', 'related') AND v_case.status = 'closed' THEN
        RAISE EXCEPTION 'Target candidate case is closed and not eligible for association' USING ERRCODE = 'P2D08';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.institution_verification_tasks t
         WHERE t.submission_id = v_sub.id
           AND t.status IN ('pending', 'in_review')
    ) THEN
        RAISE EXCEPTION 'Active institution verification or correction round is in progress' USING ERRCODE = 'P2D03';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.institutions i
         WHERE i.id = v_sub.institution_id
           AND i.is_active = true
           AND i.verification_status = 'verified'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'The associated institution is not verified and active' USING ERRCODE = 'P2D04';
    END IF;

    IF v_sub.canonical_case_id IS NOT NULL OR v_sub.intake_status IN ('associated_with_case', 'rejected') THEN
        RAISE EXCEPTION 'The submission is already associated with a case or rejected' USING ERRCODE = 'P2D06';
    END IF;

    -- ACTION DISPATCH
    IF p_action = 'confirmed_duplicate' THEN
        UPDATE public.duplicate_candidates
           SET review_status = 'confirmed_duplicate',
               reviewed_at = now(),
               reviewer_user_id = v_actor,
               review_notes = v_notes,
               updated_at = now()
         WHERE id = v_candidate.id;

        UPDATE public.submissions
           SET canonical_case_id = v_case.id,
               intake_status = 'associated_with_case',
               updated_at = now()
         WHERE id = v_sub.id;

        -- Supersede unreviewed candidate pairs in metadata without forging reviewer decisions
        UPDATE public.duplicate_candidates
           SET matching_signals = matching_signals || jsonb_build_object(
                   'terminal_disposition', 'superseded_by_confirmed_duplicate',
                   'confirmed_candidate_id', v_candidate.id,
                   'canonical_case_id', v_case.id,
                   'superseded_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
               ),
               updated_at = now()
         WHERE submission_id = v_sub.id
           AND id <> v_candidate.id
           AND review_status = 'pending';

        INSERT INTO public.case_action_history (
            case_id,
            actor_user_id,
            action_type,
            action_description,
            previous_status,
            new_status,
            related_submission_id,
            metadata
        ) VALUES (
            v_case.id,
            v_actor,
            'duplicate_associated',
            format('Intake submission %s associated as confirmed duplicate', v_sub.id),
            v_case.status,
            v_case.status,
            v_sub.id,
            jsonb_build_object(
                'candidate_id', v_candidate.id,
                'notes', v_notes
            )
        );

    ELSIF p_action IN ('not_duplicate', 'related') THEN
        UPDATE public.duplicate_candidates
           SET review_status = p_action,
               reviewed_at = now(),
               reviewer_user_id = v_actor,
               review_notes = v_notes,
               updated_at = now()
         WHERE id = v_candidate.id;

        SELECT count(*) INTO v_pending_count
          FROM public.duplicate_candidates
         WHERE submission_id = v_sub.id
           AND review_status = 'pending'
           AND id <> v_candidate.id;

        IF v_pending_count = 0 THEN
            UPDATE public.submissions
               SET intake_status = 'ready_for_case_creation',
                   updated_at = now()
             WHERE id = v_sub.id;
        END IF;
    END IF;
END;
$$;

-- 7. Canonical Case Creation Function (with Revalidated Related Candidates)
CREATE OR REPLACE FUNCTION public.create_canonical_case(
    p_submission_id uuid,
    p_lead_bureau_id uuid,
    p_title text,
    p_description text,
    p_priority text,
    p_visibility text,
    p_expected_submission_updated_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '15s'
SET lock_timeout TO '5s'
AS $$
DECLARE
    v_actor          uuid;
    v_sub            public.submissions%ROWTYPE;
    v_lead_bureau    public.bureaus%ROWTYPE;
    v_case_id        uuid;
    v_case_number    text;
    v_title          text;
    v_desc           text;
    v_priority       text;
    v_visibility     text;
    v_pending_count  integer;
    v_related_rec    RECORD;
    v_rel_case       public.cases%ROWTYPE;
BEGIN
    IF p_expected_submission_updated_at IS NULL THEN
        RAISE EXCEPTION 'An optimistic concurrency token is required for the submission' USING ERRCODE = 'P2D12';
    END IF;

    IF NOT public.has_permission('CASE.CREATE') THEN
        RAISE EXCEPTION 'The CASE.CREATE capability is required' USING ERRCODE = '42501';
    END IF;

    v_actor := public.auth_uid();
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'An authenticated caller is required' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.users u
         WHERE u.id = v_actor AND u.account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'The caller account is not active' USING ERRCODE = '42501';
    END IF;

    IF p_lead_bureau_id IS NULL THEN
        RAISE EXCEPTION 'An explicit lead bureau must be selected' USING ERRCODE = 'P2D08';
    END IF;

    SELECT * INTO v_lead_bureau
      FROM public.bureaus
     WHERE id = p_lead_bureau_id
       AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'The specified lead bureau is not active or does not exist' USING ERRCODE = 'P2D08';
    END IF;

    -- Bureau-specific authorization:
    -- Global CASE.CREATE permission allows assigning any active bureau as lead.
    -- Otherwise, caller MUST hold active membership in p_lead_bureau_id.
    IF NOT public.has_global_permission('CASE.CREATE') THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.bureau_memberships bm
             WHERE bm.user_id = v_actor
               AND bm.bureau_id = p_lead_bureau_id
               AND bm.membership_status = 'active'
               AND (bm.ended_at IS NULL OR bm.ended_at > now())
        ) THEN
            RAISE EXCEPTION 'Caller is not an active member of the designated lead bureau' USING ERRCODE = '42501';
        END IF;
    END IF;

    v_title := nullif(btrim(coalesce(p_title, '')), '');
    IF v_title IS NULL THEN
        RAISE EXCEPTION 'Case title cannot be blank' USING ERRCODE = 'P2D07';
    END IF;

    v_desc := nullif(btrim(coalesce(p_description, '')), '');
    IF v_desc IS NULL THEN
        RAISE EXCEPTION 'Case description cannot be blank' USING ERRCODE = 'P2D07';
    END IF;

    v_priority := coalesce(p_priority, 'normal');
    IF v_priority NOT IN ('low', 'normal', 'high', 'critical') THEN
        RAISE EXCEPTION 'Invalid priority level: %', v_priority USING ERRCODE = 'P2D05';
    END IF;

    v_visibility := coalesce(p_visibility, 'restricted');
    IF v_visibility NOT IN ('restricted', 'confidential') THEN
        RAISE EXCEPTION 'Invalid visibility classification: %', v_visibility USING ERRCODE = 'P2D05';
    END IF;

    -- STRICT LOCK ORDER: submissions (FOR UPDATE) -> institutions (FOR SHARE)
    SELECT * INTO v_sub
      FROM public.submissions
     WHERE id = p_submission_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission not found' USING ERRCODE = 'P2D02';
    END IF;

    IF v_sub.updated_at <> p_expected_submission_updated_at THEN
        RAISE EXCEPTION 'The submission was modified by another reviewer' USING ERRCODE = 'P2D01';
    END IF;

    IF v_sub.canonical_case_id IS NOT NULL OR v_sub.intake_status IN ('associated_with_case', 'rejected') THEN
        RAISE EXCEPTION 'The submission is already associated with a case or rejected' USING ERRCODE = 'P2D06';
    END IF;

    IF v_sub.institution_id IS NULL THEN
        RAISE EXCEPTION 'Submission must have a verified institution' USING ERRCODE = 'P2D02';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.institution_verification_tasks t
         WHERE t.submission_id = v_sub.id
           AND t.status IN ('pending', 'in_review')
    ) THEN
        RAISE EXCEPTION 'Active institution verification or correction round is in progress' USING ERRCODE = 'P2D03';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.institutions i
         WHERE i.id = v_sub.institution_id
           AND i.is_active = true
           AND i.verification_status = 'verified'
           FOR SHARE
    ) THEN
        RAISE EXCEPTION 'The associated institution is not verified and active' USING ERRCODE = 'P2D04';
    END IF;

    IF v_sub.intake_status <> 'ready_for_case_creation' THEN
        IF v_sub.intake_status = 'awaiting_duplicate_review' THEN
            RAISE EXCEPTION 'Unreviewed duplicate candidates remain for this submission' USING ERRCODE = 'P2D10';
        ELSE
            RAISE EXCEPTION 'Duplicate screening must be completed before canonical case creation' USING ERRCODE = 'P2D11';
        END IF;
    END IF;

    SELECT count(*) INTO v_pending_count
      FROM public.duplicate_candidates
     WHERE submission_id = v_sub.id
       AND review_status = 'pending';

    IF v_pending_count > 0 THEN
        RAISE EXCEPTION 'Cannot create canonical case with % pending duplicate candidates', v_pending_count
            USING ERRCODE = 'P2D10';
    END IF;

    v_case_number := format('CASE-%s-%s', to_char(now(), 'YYYY'), lpad(nextval('public.case_number_seq')::text, 6, '0'));

    INSERT INTO public.cases (
        case_number,
        institution_id,
        primary_category_id,
        title,
        description,
        status,
        priority,
        visibility,
        source_submission_id,
        opened_at,
        created_by_user_id,
        updated_by_user_id
    ) VALUES (
        v_case_number,
        v_sub.institution_id,
        v_sub.category_id,
        v_title,
        v_desc,
        'new',
        v_priority,
        v_visibility,
        v_sub.id,
        now(),
        v_actor,
        v_actor
    )
    RETURNING id INTO v_case_id;

    INSERT INTO public.case_bureau_assignments (
        case_id,
        bureau_id,
        assignment_type,
        assignment_status,
        assigned_by_user_id,
        assigned_at
    ) VALUES (
        v_case_id,
        p_lead_bureau_id,
        'lead',
        'active',
        v_actor,
        now()
    );

    INSERT INTO public.case_action_history (
        case_id,
        actor_user_id,
        action_type,
        action_description,
        previous_status,
        new_status,
        related_submission_id,
        metadata
    ) VALUES (
        v_case_id,
        v_actor,
        'case_created',
        format('Canonical case created from submission %s', v_sub.id),
        NULL,
        'new',
        v_sub.id,
        jsonb_build_object(
            'case_number', v_case_number,
            'lead_bureau_id', p_lead_bureau_id,
            'lead_bureau_code', v_lead_bureau.code,
            'priority', v_priority,
            'visibility', v_visibility
        )
    );

    -- Link explicit 'related' candidate decisions with revalidation
    FOR v_related_rec IN (
        SELECT dc.candidate_case_id, dc.review_notes
          FROM public.duplicate_candidates dc
         WHERE dc.submission_id = v_sub.id
           AND dc.review_status = 'related'
         ORDER BY dc.candidate_case_id
    ) LOOP
        -- Revalidate target case existence
        SELECT * INTO v_rel_case
          FROM public.cases
         WHERE id = v_related_rec.candidate_case_id
           FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Target related case % not found or stale', v_related_rec.candidate_case_id USING ERRCODE = 'P2D02';
        END IF;

        -- Revalidate institution compatibility
        IF v_rel_case.institution_id IS DISTINCT FROM v_sub.institution_id THEN
            RAISE EXCEPTION 'Target related case institution % does not match canonical case institution %',
                v_rel_case.institution_id, v_sub.institution_id USING ERRCODE = 'P2D08';
        END IF;

        -- Revalidate relationship eligibility
        IF v_rel_case.status = 'closed' THEN
            RAISE EXCEPTION 'Target related case % is closed and ineligible for relationship association',
                v_rel_case.id USING ERRCODE = 'P2D08';
        END IF;

        INSERT INTO public.case_relationships (
            case_id,
            related_case_id,
            relationship_type,
            description,
            created_by_user_id
        ) VALUES (
            v_case_id,
            v_rel_case.id,
            'related',
            coalesce(v_related_rec.review_notes, 'Established during duplicate screening review'),
            v_actor
        )
        ON CONFLICT (case_id, related_case_id, relationship_type) DO NOTHING;
    END LOOP;

    UPDATE public.submissions
       SET canonical_case_id = v_case_id,
           intake_status = 'associated_with_case',
           updated_at = now()
     WHERE id = v_sub.id;

    RETURN v_case_id;
END;
$$;

-- 8. Reject Intake Submission Function (Strictly requires global SUBMISSION.REJECT)
CREATE OR REPLACE FUNCTION public.reject_intake_submission(
    p_submission_id uuid,
    p_reason text,
    p_expected_submission_updated_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET statement_timeout TO '15s'
SET lock_timeout TO '5s'
AS $$
DECLARE
    v_actor   uuid;
    v_sub     public.submissions%ROWTYPE;
    v_reason  text;
BEGIN
    IF p_expected_submission_updated_at IS NULL THEN
        RAISE EXCEPTION 'An optimistic concurrency token is required for the submission' USING ERRCODE = 'P2D12';
    END IF;

    -- Submissions have no approved bureau ownership; rejection requires global SUBMISSION.REJECT
    IF NOT public.has_global_permission('SUBMISSION.REJECT') THEN
        RAISE EXCEPTION 'Global permission SUBMISSION.REJECT is required to reject an intake submission' USING ERRCODE = '42501';
    END IF;

    v_actor := public.auth_uid();
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'An authenticated caller is required' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.users u
         WHERE u.id = v_actor AND u.account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'The caller account is not active' USING ERRCODE = '42501';
    END IF;

    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    IF v_reason IS NULL THEN
        RAISE EXCEPTION 'A justification reason is required to reject a submission' USING ERRCODE = 'P2D07';
    END IF;

    SELECT * INTO v_sub
      FROM public.submissions
     WHERE id = p_submission_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission not found' USING ERRCODE = 'P2D02';
    END IF;

    IF v_sub.updated_at <> p_expected_submission_updated_at THEN
        RAISE EXCEPTION 'The submission was modified by another reviewer' USING ERRCODE = 'P2D01';
    END IF;

    IF v_sub.canonical_case_id IS NOT NULL OR v_sub.intake_status IN ('associated_with_case', 'rejected') THEN
        RAISE EXCEPTION 'The submission is already resolved or closed' USING ERRCODE = 'P2D06';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.institution_verification_tasks t
         WHERE t.submission_id = v_sub.id
           AND t.status IN ('pending', 'in_review')
    ) THEN
        RAISE EXCEPTION 'Active institution verification or correction round is in progress' USING ERRCODE = 'P2D03';
    END IF;

    UPDATE public.submissions
       SET intake_status = 'rejected',
           updated_at = now()
     WHERE id = v_sub.id;
END;
$$;

-- 9. Duplicate Review Queue Projection (Global DUPLICATE.REVIEW required)
CREATE OR REPLACE FUNCTION public.duplicate_review_queue_rows(
    p_status text DEFAULT 'pending',
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    candidate_id uuid,
    submission_id uuid,
    candidate_case_id uuid,
    case_number text,
    institution_id uuid,
    institution_name text,
    similarity_score numeric,
    matching_method text,
    matching_signals jsonb,
    review_status text,
    reviewed_at timestamptz,
    reviewer_user_id uuid,
    review_notes text,
    candidate_created_at timestamptz,
    candidate_updated_at timestamptz,
    submission_updated_at timestamptz,
    submission_subject text,
    submission_received_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
    SELECT 
        dc.id AS candidate_id,
        dc.submission_id,
        dc.candidate_case_id,
        c.case_number,
        s.institution_id,
        i.official_name AS institution_name,
        dc.similarity_score,
        dc.matching_method,
        dc.matching_signals,
        dc.review_status,
        dc.reviewed_at,
        dc.reviewer_user_id,
        dc.review_notes,
        dc.created_at AS candidate_created_at,
        dc.updated_at AS candidate_updated_at,
        s.updated_at AS submission_updated_at,
        s.subject AS submission_subject,
        s.received_at AS submission_received_at
      FROM public.duplicate_candidates dc
      JOIN public.submissions s ON s.id = dc.submission_id
      JOIN public.cases c ON c.id = dc.candidate_case_id
      LEFT JOIN public.institutions i ON i.id = s.institution_id
     WHERE public.has_global_permission('DUPLICATE.REVIEW')
       AND EXISTS (
           SELECT 1 FROM public.users u
            WHERE u.id = public.auth_uid()
              AND u.account_status = 'active'
       )
       AND (
           p_status IS NULL 
           OR dc.review_status = p_status
       )
       AND (dc.matching_signals->>'terminal_disposition' IS NULL)
     ORDER BY dc.similarity_score DESC, dc.created_at ASC
     LIMIT coalesce(p_limit, 50)
    OFFSET coalesce(p_offset, 0);
$$;

-- 10. Duplicate Candidate Pair Detail Projection (Global DUPLICATE.REVIEW required)
CREATE OR REPLACE FUNCTION public.duplicate_candidate_detail(
    p_candidate_id uuid
)
RETURNS TABLE (
    candidate_id uuid,
    submission_id uuid,
    submission_subject text,
    submission_body text,
    submission_category_id uuid,
    submission_category_name text,
    submission_institution_id uuid,
    submission_institution_name text,
    submission_updated_at timestamptz,
    candidate_case_id uuid,
    case_number text,
    case_title text,
    case_status text,
    case_category_id uuid,
    case_category_name text,
    case_created_at timestamptz,
    case_lead_bureau_id uuid,
    case_lead_bureau_name text,
    similarity_score numeric,
    matching_method text,
    matching_signals jsonb,
    review_status text,
    reviewed_at timestamptz,
    reviewer_user_id uuid,
    review_notes text,
    candidate_created_at timestamptz,
    candidate_updated_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
    SELECT 
        dc.id AS candidate_id,
        dc.submission_id,
        s.subject AS submission_subject,
        s.original_text AS submission_body,
        s.category_id AS submission_category_id,
        sc.name AS submission_category_name,
        s.institution_id AS submission_institution_id,
        si.official_name AS submission_institution_name,
        s.updated_at AS submission_updated_at,
        c.id AS candidate_case_id,
        c.case_number,
        c.title AS case_title,
        c.status AS case_status,
        c.primary_category_id AS case_category_id,
        cc.name AS case_category_name,
        c.opened_at AS case_created_at,
        cba.bureau_id AS case_lead_bureau_id,
        b.name AS case_lead_bureau_name,
        dc.similarity_score,
        dc.matching_method,
        dc.matching_signals,
        dc.review_status,
        dc.reviewed_at,
        dc.reviewer_user_id,
        dc.review_notes,
        dc.created_at AS candidate_created_at,
        dc.updated_at AS candidate_updated_at
      FROM public.duplicate_candidates dc
      JOIN public.submissions s ON s.id = dc.submission_id
      JOIN public.cases c ON c.id = dc.candidate_case_id
      LEFT JOIN public.complaint_categories sc ON sc.id = s.category_id
      LEFT JOIN public.complaint_categories cc ON cc.id = c.primary_category_id
      LEFT JOIN public.institutions si ON si.id = s.institution_id
      LEFT JOIN public.case_bureau_assignments cba ON cba.case_id = c.id AND cba.assignment_type = 'lead'
      LEFT JOIN public.bureaus b ON b.id = cba.bureau_id
     WHERE dc.id = p_candidate_id
       AND public.has_global_permission('DUPLICATE.REVIEW')
       AND EXISTS (
           SELECT 1 FROM public.users u
            WHERE u.id = public.auth_uid()
              AND u.account_status = 'active'
       );
$$;

-- 11. Cross-Bureau Minimal Case Index Projection
CREATE OR REPLACE FUNCTION public.case_index_rows(
    p_status text DEFAULT NULL,
    p_search text DEFAULT NULL,
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    case_id uuid,
    case_number text,
    institution_id uuid,
    institution_name text,
    institution_region text,
    category_id uuid,
    category_name text,
    status text,
    priority text,
    lead_bureau_id uuid,
    lead_bureau_name text,
    lead_bureau_code text,
    opened_at timestamptz,
    closed_at timestamptz,
    can_view_details boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
    SELECT 
        c.id AS case_id,
        c.case_number,
        c.institution_id,
        i.official_name AS institution_name,
        r.name AS institution_region,
        c.primary_category_id AS category_id,
        cat.name AS category_name,
        c.status,
        c.priority,
        cba.bureau_id AS lead_bureau_id,
        b.name AS lead_bureau_name,
        b.code AS lead_bureau_code,
        c.opened_at,
        c.closed_at,
        public.can_access_case_details(c.id) AS can_view_details
      FROM public.cases c
      JOIN public.institutions i ON i.id = c.institution_id
      LEFT JOIN public.regions r ON r.id = i.region_id
      LEFT JOIN public.complaint_categories cat ON cat.id = c.primary_category_id
      LEFT JOIN public.case_bureau_assignments cba 
        ON cba.case_id = c.id 
       AND cba.assignment_type = 'lead' 
       AND cba.assignment_status = 'active'
      LEFT JOIN public.bureaus b ON b.id = cba.bureau_id
     WHERE (
         public.has_permission('CASE.VIEW_INDEX')
         OR public.has_permission('CASE.VIEW_DETAIL')
     )
       AND EXISTS (
           SELECT 1 FROM public.users u
            WHERE u.id = public.auth_uid()
              AND u.account_status = 'active'
       )
       AND (p_status IS NULL OR c.status = p_status)
       AND (
           p_search IS NULL
           OR c.case_number ILIKE '%' || p_search || '%'
           OR i.official_name ILIKE '%' || p_search || '%'
       )
     ORDER BY c.opened_at DESC
     LIMIT coalesce(p_limit, 50)
    OFFSET coalesce(p_offset, 0);
$$;

-- 12. Authorized Full Case Detail Projection
CREATE OR REPLACE FUNCTION public.case_detail_projection(
    p_case_id uuid
)
RETURNS TABLE (
    case_id uuid,
    case_number text,
    title text,
    description text,
    institution_id uuid,
    institution_name text,
    institution_code text,
    institution_region text,
    category_id uuid,
    category_name text,
    status text,
    priority text,
    visibility text,
    source_submission_id uuid,
    opened_at timestamptz,
    closed_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz,
    lead_bureau_id uuid,
    lead_bureau_name text,
    lead_bureau_code text,
    collaborating_bureaus jsonb,
    related_cases jsonb,
    action_history jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
    SELECT 
        c.id AS case_id,
        c.case_number,
        c.title,
        c.description,
        c.institution_id,
        i.official_name AS institution_name,
        i.aicte_permanent_id AS institution_code,
        r.name AS institution_region,
        c.primary_category_id AS category_id,
        cat.name AS category_name,
        c.status,
        c.priority,
        c.visibility,
        c.source_submission_id,
        c.opened_at,
        c.closed_at,
        c.created_at,
        c.updated_at,
        lead_b.id AS lead_bureau_id,
        lead_b.name AS lead_bureau_name,
        lead_b.code AS lead_bureau_code,
        coalesce(
            (
                SELECT jsonb_agg(jsonb_build_object(
                    'bureau_id', b_collab.id,
                    'bureau_name', b_collab.name,
                    'bureau_code', b_collab.code,
                    'assignment_type', cba_collab.assignment_type,
                    'assignment_status', cba_collab.assignment_status,
                    'assigned_at', cba_collab.assigned_at
                ))
                  FROM public.case_bureau_assignments cba_collab
                  JOIN public.bureaus b_collab ON b_collab.id = cba_collab.bureau_id
                 WHERE cba_collab.case_id = c.id
                   AND cba_collab.assignment_type <> 'lead'
                   AND cba_collab.assignment_status = 'active'
            ),
            '[]'::jsonb
        ) AS collaborating_bureaus,
        coalesce(
            (
                SELECT jsonb_agg(jsonb_build_object(
                    'relationship_id', cr.id,
                    'related_case_id', cr.related_case_id,
                    'related_case_number', rc.case_number,
                    'related_case_title', rc.title,
                    'relationship_type', cr.relationship_type,
                    'description', cr.description,
                    'created_at', cr.created_at
                ))
                  FROM public.case_relationships cr
                  JOIN public.cases rc ON rc.id = cr.related_case_id
                 WHERE cr.case_id = c.id
            ),
            '[]'::jsonb
        ) AS related_cases,
        coalesce(
            (
                SELECT jsonb_agg(jsonb_build_object(
                    'action_id', cah.id,
                    'action_type', cah.action_type,
                    'action_description', cah.action_description,
                    'previous_status', cah.previous_status,
                    'new_status', cah.new_status,
                    'actor_user_id', cah.actor_user_id,
                    'created_at', cah.created_at,
                    'metadata', cah.metadata
                ) ORDER BY cah.created_at DESC)
                  FROM public.case_action_history cah
                 WHERE cah.case_id = c.id
            ),
            '[]'::jsonb
        ) AS action_history
      FROM public.cases c
      JOIN public.institutions i ON i.id = c.institution_id
      LEFT JOIN public.regions r ON r.id = i.region_id
      LEFT JOIN public.complaint_categories cat ON cat.id = c.primary_category_id
      LEFT JOIN public.case_bureau_assignments cba_lead 
        ON cba_lead.case_id = c.id 
       AND cba_lead.assignment_type = 'lead'
       AND cba_lead.assignment_status = 'active'
      LEFT JOIN public.bureaus lead_b ON lead_b.id = cba_lead.bureau_id
     WHERE c.id = p_case_id
       AND public.can_access_case_details(c.id);
$$;

-- 13. Revoke all execution grants from PUBLIC and anon, grant only to authenticated
REVOKE ALL ON FUNCTION public.guard_duplicate_candidate_immutability() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_case_details(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_duplicate_candidates(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_duplicate_candidate(uuid, text, text, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_canonical_case(uuid, uuid, text, text, text, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_intake_submission(uuid, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duplicate_review_queue_rows(text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duplicate_candidate_detail(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.case_index_rows(text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.case_detail_projection(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_access_case_details(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_duplicate_candidates(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_duplicate_candidate(uuid, text, text, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_canonical_case(uuid, uuid, text, text, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_intake_submission(uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_review_queue_rows(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_candidate_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.case_index_rows(text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.case_detail_projection(uuid) TO authenticated;

-- Ensure postgres ownership
DO $$
DECLARE
    fn_name text;
    fn_names text[] := ARRAY[
        'guard_duplicate_candidate_immutability',
        'can_access_case_details',
        'generate_duplicate_candidates',
        'decide_duplicate_candidate',
        'create_canonical_case',
        'reject_intake_submission',
        'duplicate_review_queue_rows',
        'duplicate_candidate_detail',
        'case_index_rows',
        'case_detail_projection'
    ];
BEGIN
    FOREACH fn_name IN ARRAY fn_names LOOP
        EXECUTE format('ALTER FUNCTION public.%I OWNER TO postgres;', fn_name);
    END LOOP;
END $$;
"""

SAFE_ROLLBACK_SQL = """
-- =============================================================================
-- Migration 0005 Safe Rollback Script (Constrained Pre-deployment Only)
-- =============================================================================
-- Guard: If production cases exist, rollback is prohibited; forward-only recovery must be used.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.cases WHERE case_number LIKE 'CASE-%') THEN
        RAISE EXCEPTION 'CANNOT ROLLBACK MIGRATION 0005: Production cases already exist. Follow forward-only recovery policy.' USING ERRCODE = 'P2D08';
    END IF;
END $$;

DELETE FROM public.role_permissions
 WHERE permission_id IN (
     SELECT id FROM public.permissions 
      WHERE code IN ('DUPLICATE.REVIEW', 'CASE.CREATE', 'CASE.VIEW_INDEX', 'CASE.VIEW_DETAIL', 'SUBMISSION.REJECT')
 );

DELETE FROM public.permissions
 WHERE code IN ('DUPLICATE.REVIEW', 'CASE.CREATE', 'CASE.VIEW_INDEX', 'CASE.VIEW_DETAIL', 'SUBMISSION.REJECT');

DROP TRIGGER IF EXISTS trg_guard_duplicate_candidate_immutability ON public.duplicate_candidates;
DROP FUNCTION IF EXISTS public.guard_duplicate_candidate_immutability();
DROP FUNCTION IF EXISTS public.reject_intake_submission(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.create_canonical_case(uuid, uuid, text, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.decide_duplicate_candidate(uuid, text, text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.generate_duplicate_candidates(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.can_access_case_details(uuid);
DROP FUNCTION IF EXISTS public.duplicate_review_queue_rows(text, integer, integer);
DROP FUNCTION IF EXISTS public.duplicate_candidate_detail(uuid);
DROP FUNCTION IF EXISTS public.case_index_rows(text, text, integer, integer);
DROP FUNCTION IF EXISTS public.case_detail_projection(uuid);

-- Constrained drop of sequence: only if no cases exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.cases WHERE case_number LIKE 'CASE-%') THEN
        DROP SEQUENCE IF EXISTS public.case_number_seq;
    END IF;
END $$;
"""

def run_tests():
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        print("DATABASE_URL not found!")
        sys.exit(1)

    print("Connecting to live Supabase database...")
    conn = psycopg.connect(db_url, autocommit=False)
    cur = conn.cursor()

    try:
        # Pre-check: count tables
        cur.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
        pre_tables = cur.fetchone()[0]
        print(f"[PRE-CHECK] Base tables count: {pre_tables} (must be 32)")
        assert pre_tables == 32, f"Expected 32 tables, found {pre_tables}"

        # ---------------------------------------------------------------------
        # PROBE 1: ROLLBACK PROVENANCE VERIFICATION
        # ---------------------------------------------------------------------
        print("\n=== PROBE 1: ROLLBACK PROVENANCE VERIFICATION ===")
        # 1a. Pre-migration check: prove zero rows exist for Phase 2.3 permissions
        cur.execute(
            "SELECT count(*) FROM public.permissions WHERE code IN ('DUPLICATE.REVIEW', 'CASE.CREATE', 'CASE.VIEW_INDEX', 'CASE.VIEW_DETAIL', 'SUBMISSION.REJECT')"
        )
        pre_perm_count = cur.fetchone()[0]
        print(f"[1a] Pre-migration matching permissions count: {pre_perm_count} (expected 0)")
        assert pre_perm_count == 0, f"Expected 0 pre-existing permissions, found {pre_perm_count}"

        cur.execute(
            """SELECT count(*) FROM public.role_permissions rp 
               JOIN public.permissions p ON rp.permission_id = p.id 
               WHERE p.code IN ('DUPLICATE.REVIEW', 'CASE.CREATE', 'CASE.VIEW_INDEX', 'CASE.VIEW_DETAIL', 'SUBMISSION.REJECT')"""
        )
        pre_rp_count = cur.fetchone()[0]
        print(f"[1a] Pre-migration matching role_permissions count: {pre_rp_count} (expected 0)")
        assert pre_rp_count == 0

        # 1b. Apply Migration 0005 v3.3
        cur.execute(MIGRATION_0005_SQL)
        print("[1b] Applied Migration 0005 v3.3 inside transaction.")

        # Check post-migration counts
        cur.execute(
            "SELECT count(*) FROM public.permissions WHERE code IN ('DUPLICATE.REVIEW', 'CASE.CREATE', 'CASE.VIEW_INDEX', 'CASE.VIEW_DETAIL', 'SUBMISSION.REJECT')"
        )
        post_perm_count = cur.fetchone()[0]
        print(f"[1b] Post-migration matching permissions count: {post_perm_count} (expected 5)")
        assert post_perm_count == 5

        cur.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
        post_tables = cur.fetchone()[0]
        print(f"[1b] Post-migration base tables count: {post_tables} (must be 32)")
        assert post_tables == 32

        # 1c. Test safe rollback in a savepoint
        cur.execute("SAVEPOINT rollback_test;")
        cur.execute(SAFE_ROLLBACK_SQL)
        cur.execute(
            "SELECT count(*) FROM public.permissions WHERE code IN ('DUPLICATE.REVIEW', 'CASE.CREATE', 'CASE.VIEW_INDEX', 'CASE.VIEW_DETAIL', 'SUBMISSION.REJECT')"
        )
        rb_perm_count = cur.fetchone()[0]
        cur.execute(
            """SELECT count(*) FROM public.role_permissions rp 
               JOIN public.permissions p ON rp.permission_id = p.id 
               WHERE p.code IN ('DUPLICATE.REVIEW', 'CASE.CREATE', 'CASE.VIEW_INDEX', 'CASE.VIEW_DETAIL', 'SUBMISSION.REJECT')"""
        )
        rb_rp_count = cur.fetchone()[0]
        print(f"[1c] After executing SAFE_ROLLBACK_SQL: permissions={rb_perm_count}, role_permissions={rb_rp_count}")
        assert rb_perm_count == 0, "Rollback failed to remove permissions cleanly"
        assert rb_rp_count == 0, "Rollback failed to remove role_permissions cleanly"

        # Re-apply migration by reverting savepoint
        cur.execute("ROLLBACK TO SAVEPOINT rollback_test;")
        print("[1c] Successfully proved rollback returns database exactly to pre-migration 0-count baseline!")

        # ---------------------------------------------------------------------
        # SETUP TEST DATA INSIDE TRANSACTION
        # ---------------------------------------------------------------------
        cur.execute("SELECT id FROM public.intake_channels WHERE is_active = true LIMIT 1")
        channel_id = str(cur.fetchone()[0])

        # Query existing demo users
        cur.execute("SELECT id FROM public.users WHERE official_email = 'demo.super.admin@demo.invalid';")
        sa_user_id = str(cur.fetchone()[0])

        cur.execute("SELECT id FROM public.users WHERE official_email = 'demo.pgrc.officer@demo.invalid';")
        officer_user_id = str(cur.fetchone()[0])

        cur.execute("SELECT id, code FROM public.bureaus WHERE is_active = true ORDER BY code;")
        bureaus_dict = {code: str(bid) for bid, code in cur.fetchall()}
        bureau_a_id = bureaus_dict.get('PGRC', list(bureaus_dict.values())[0])
        bureau_b_id = bureaus_dict.get('RB', list(bureaus_dict.values())[1])

        cur.execute("SELECT id FROM public.institutions WHERE is_active = true AND verification_status = 'verified' LIMIT 2")
        inst_rows = cur.fetchall()
        inst_a_id = str(inst_rows[0][0])
        inst_b_id = str(inst_rows[1][0])

        # Insert test categories inside transaction
        cur.execute("""
            INSERT INTO public.complaint_categories (code, name, default_priority, is_active, display_order)
            VALUES 
                ('PROBE_CAT_1', 'Category 1', 'high', true, 1),
                ('PROBE_CAT_2', 'Category 2', 'normal', true, 2)
            RETURNING id;
        """)
        cat_id = str(cur.fetchone()[0])

        def set_auth(user_id, bureau_id=None):
            if bureau_id:
                cur.execute(
                    "SELECT set_config('request.jwt.claims', json_build_object('sub', %s::text, 'active_bureau_id', %s::text)::text, true)",
                    (str(user_id), str(bureau_id))
                )
            else:
                cur.execute(
                    "SELECT set_config('request.jwt.claims', json_build_object('sub', %s::text)::text, true)",
                    (str(user_id),)
                )

        def assert_fails_with(sql, params, expected_code):
            cur.execute("SAVEPOINT sp_neg_test;")
            try:
                cur.execute(sql, params)
                cur.execute("RELEASE SAVEPOINT sp_neg_test;")
                raise AssertionError(f"Expected failure with {expected_code}, but statement succeeded!")
            except Exception as e:
                cur.execute("ROLLBACK TO SAVEPOINT sp_neg_test;")
                err_msg = str(e)
                sqlstate = getattr(e, 'sqlstate', '')
                if expected_code not in err_msg and expected_code != sqlstate:
                    raise AssertionError(f"Expected {expected_code} in error (sqlstate={sqlstate}), got: {err_msg}")
                return f"{sqlstate}: {err_msg}"

        # ---------------------------------------------------------------------
        # PROBE 2: SUBMISSION REJECTION AUTHORIZATION
        # ---------------------------------------------------------------------
        print("\n=== PROBE 2: SUBMISSION REJECTION AUTHORIZATION ===")
        # Create test submission
        cur.execute(
            """INSERT INTO public.submissions (
                   intake_channel_id, subject, original_text, original_language,
                   institution_id, category_id, intake_status, idempotency_key
               ) VALUES (%s, 'Rejection Sub', 'Testing rejection', 'en',
                         %s, %s, 'awaiting_duplicate_review', 'idem-rej-1')
               RETURNING id, updated_at""",
            (channel_id, inst_a_id, cat_id)
        )
        sub_row = cur.fetchone()
        sub_rej_id = str(sub_row[0])
        sub_rej_updated_at = sub_row[1]

        # 2a. Negative test: Bureau Officer calls reject_intake_submission
        set_auth(officer_user_id, bureau_a_id)
        err = assert_fails_with(
            "SELECT public.reject_intake_submission(%s, 'Officer trying to reject', %s)",
            (sub_rej_id, sub_rej_updated_at),
            '42501'
        )
        print(f"[2a] Passed: Officer with bureau CASE.CREATE blocked from rejecting: {err.strip()}")

        # 2b. Positive test: Super Admin (with global SUBMISSION.REJECT) calls reject_intake_submission
        set_auth(sa_user_id)
        cur.execute(
            "SELECT public.reject_intake_submission(%s, 'Valid administrative rejection', %s)",
            (sub_rej_id, sub_rej_updated_at)
        )
        cur.execute("SELECT intake_status FROM public.submissions WHERE id = %s", (sub_rej_id,))
        rej_status = cur.fetchone()[0]
        print(f"[2b] Passed: Super Admin with global SUBMISSION.REJECT successfully rejected: intake_status={rej_status}")
        assert rej_status == 'rejected'

        # ---------------------------------------------------------------------
        # PROBE 3: CASE ASSOCIATION INTEGRITY (NEGATIVE & POSITIVE TESTS)
        # ---------------------------------------------------------------------
        print("\n=== PROBE 3: CASE ASSOCIATION INTEGRITY ===")

        # Create Source Submission for Baseline Case 1 (Institution A)
        cur.execute(
            """INSERT INTO public.submissions (
                   intake_channel_id, subject, original_text, original_language,
                   institution_id, category_id, intake_status, idempotency_key
               ) VALUES (%s, 'Source Case A1', 'Text', 'en', %s, %s, 'ready_for_case_creation', 'idem-src-a1')
               RETURNING id""",
            (channel_id, inst_a_id, cat_id)
        )
        src_a1_id = str(cur.fetchone()[0])
        cur.execute(
            """INSERT INTO public.cases (
                   case_number, institution_id, primary_category_id, title, description,
                   status, priority, visibility, source_submission_id, opened_at
               ) VALUES ('CASE-2026-TESTA1', %s, %s, 'Inst A Case 1', 'Open case at Inst A',
                         'new', 'normal', 'restricted', %s, now())
               RETURNING id""",
            (inst_a_id, cat_id, src_a1_id)
        )
        case_a_open_id = str(cur.fetchone()[0])
        cur.execute("UPDATE public.submissions SET canonical_case_id = %s, intake_status = 'associated_with_case' WHERE id = %s", (case_a_open_id, src_a1_id))

        # Create Source Submission for Baseline Case 2 (Institution A - Closed)
        cur.execute(
            """INSERT INTO public.submissions (
                   intake_channel_id, subject, original_text, original_language,
                   institution_id, category_id, intake_status, idempotency_key
               ) VALUES (%s, 'Source Case A2', 'Text', 'en', %s, %s, 'ready_for_case_creation', 'idem-src-a2')
               RETURNING id""",
            (channel_id, inst_a_id, cat_id)
        )
        src_a2_id = str(cur.fetchone()[0])
        cur.execute(
            """INSERT INTO public.cases (
                   case_number, institution_id, primary_category_id, title, description,
                   status, priority, visibility, source_submission_id, opened_at, closed_at
               ) VALUES ('CASE-2026-TESTA2', %s, %s, 'Inst A Case 2', 'Closed case at Inst A',
                         'closed', 'normal', 'restricted', %s, now(), now())
               RETURNING id""",
            (inst_a_id, cat_id, src_a2_id)
        )
        case_a_closed_id = str(cur.fetchone()[0])
        cur.execute("UPDATE public.submissions SET canonical_case_id = %s, intake_status = 'associated_with_case' WHERE id = %s", (case_a_closed_id, src_a2_id))

        # Create Source Submission for Baseline Case 3 (Institution B)
        cur.execute(
            """INSERT INTO public.submissions (
                   intake_channel_id, subject, original_text, original_language,
                   institution_id, category_id, intake_status, idempotency_key
               ) VALUES (%s, 'Source Case B1', 'Text', 'en', %s, %s, 'ready_for_case_creation', 'idem-src-b1')
               RETURNING id""",
            (channel_id, inst_b_id, cat_id)
        )
        src_b1_id = str(cur.fetchone()[0])
        cur.execute(
            """INSERT INTO public.cases (
                   case_number, institution_id, primary_category_id, title, description,
                   status, priority, visibility, source_submission_id, opened_at
               ) VALUES ('CASE-2026-TESTB1', %s, %s, 'Inst B Case 1', 'Open case at Inst B',
                         'new', 'normal', 'restricted', %s, now())
               RETURNING id""",
            (inst_b_id, cat_id, src_b1_id)
        )
        case_b_open_id = str(cur.fetchone()[0])
        cur.execute("UPDATE public.submissions SET canonical_case_id = %s, intake_status = 'associated_with_case' WHERE id = %s", (case_b_open_id, src_b1_id))

        # Create Target Submission 2 for Institution A
        cur.execute(
            """INSERT INTO public.submissions (
                   intake_channel_id, subject, original_text, original_language,
                   institution_id, category_id, intake_status, idempotency_key
               ) VALUES (%s, 'Sub 2 Subject', 'Sub 2 Body', 'en',
                         %s, %s, 'awaiting_duplicate_review', 'idem-sub-2')
               RETURNING id, updated_at""",
            (channel_id, inst_a_id, cat_id)
        )
        sub2_row = cur.fetchone()
        sub2_id = str(sub2_row[0])
        sub2_updated_at = sub2_row[1]

        # 3a. Negative Test: decide_duplicate_candidate with Mismatched Institution (Case B vs Sub 2)
        cur.execute(
            """INSERT INTO public.duplicate_candidates (
                   submission_id, candidate_case_id, similarity_score, matching_method, matching_signals, review_status
               ) VALUES (%s, %s, 0.900, 'rules', '{"category_match": true}', 'pending')
               RETURNING id, updated_at""",
            (sub2_id, case_b_open_id)
        )
        cand_b_row = cur.fetchone()
        cand_b_id = str(cand_b_row[0])
        cand_b_updated_at = cand_b_row[1]

        set_auth(sa_user_id)
        err = assert_fails_with(
            "SELECT public.decide_duplicate_candidate(%s, 'confirmed_duplicate', 'Testing mismatched inst', %s, %s)",
            (cand_b_id, sub2_updated_at, cand_b_updated_at),
            'P2D08'
        )
        print(f"[3a] Negative Test Passed: Mismatched institution blocked with P2D08: {err.strip()}")

        # 3b. Negative Test: decide_duplicate_candidate on CLOSED Case A
        cur.execute(
            """INSERT INTO public.duplicate_candidates (
                   submission_id, candidate_case_id, similarity_score, matching_method, matching_signals, review_status
               ) VALUES (%s, %s, 0.900, 'rules', '{"category_match": true}', 'pending')
               RETURNING id, updated_at""",
            (sub2_id, case_a_closed_id)
        )
        cand_closed_row = cur.fetchone()
        cand_closed_id = str(cand_closed_row[0])
        cand_closed_updated_at = cand_closed_row[1]

        err = assert_fails_with(
            "SELECT public.decide_duplicate_candidate(%s, 'confirmed_duplicate', 'Testing closed case', %s, %s)",
            (cand_closed_id, sub2_updated_at, cand_closed_updated_at),
            'P2D08'
        )
        print(f"[3b] Negative Test Passed: Closed case duplicate association blocked with P2D08: {err.strip()}")

        # 3c. Negative Test: create_canonical_case revalidation on Mismatched Institution
        # Create Submission 3 for Institution A
        cur.execute(
            """INSERT INTO public.submissions (
                   intake_channel_id, subject, original_text, original_language,
                   institution_id, category_id, intake_status, idempotency_key
               ) VALUES (%s, 'Sub 3 Subject', 'Sub 3 Body', 'en',
                         %s, %s, 'ready_for_case_creation', 'idem-sub-3')
               RETURNING id, updated_at""",
            (channel_id, inst_a_id, cat_id)
        )
        sub3_row = cur.fetchone()
        sub3_id = str(sub3_row[0])
        sub3_updated_at = sub3_row[1]

        # Insert a reviewed 'related' candidate pointing to Case B (wrong institution)
        cur.execute(
            """INSERT INTO public.duplicate_candidates (
                   submission_id, candidate_case_id, similarity_score, matching_method, matching_signals,
                   review_status, reviewed_at, reviewer_user_id, review_notes
               ) VALUES (%s, %s, 0.600, 'rules', '{"subject_overlap": true}',
                         'related', now(), %s, 'Marked related to case B')
               RETURNING id""",
            (sub3_id, case_b_open_id, sa_user_id)
        )

        err = assert_fails_with(
            "SELECT public.create_canonical_case(%s, %s, 'Sub 3 Canonical Case', 'Test desc', 'normal', 'restricted', %s)",
            (sub3_id, bureau_a_id, sub3_updated_at),
            'P2D08'
        )
        print(f"[3c] Negative Test Passed: create_canonical_case rejected related case with mismatched institution: {err.strip()}")

        # 3d. Negative Test: create_canonical_case revalidation on Stale/Non-Existent Target Case
        cur.execute(
            """INSERT INTO public.submissions (
                   intake_channel_id, subject, original_text, original_language,
                   institution_id, category_id, intake_status, idempotency_key
               ) VALUES (%s, 'Sub 4 Subject', 'Sub 4 Body', 'en',
                         %s, %s, 'ready_for_case_creation', 'idem-sub-4')
               RETURNING id, updated_at""",
            (channel_id, inst_a_id, cat_id)
        )
        sub4_row = cur.fetchone()
        sub4_id = str(sub4_row[0])
        sub4_updated_at = sub4_row[1]

        # Create temporary case, create candidate, then remove case inside subtransaction
        cur.execute("SAVEPOINT stale_case_sp;")
        cur.execute(
            """INSERT INTO public.submissions (
                   intake_channel_id, subject, original_text, original_language,
                   institution_id, category_id, intake_status, idempotency_key
               ) VALUES (%s, 'Source Temp', 'Text', 'en', %s, %s, 'ready_for_case_creation', 'idem-src-temp')
               RETURNING id""",
            (channel_id, inst_a_id, cat_id)
        )
        src_temp_id = str(cur.fetchone()[0])
        cur.execute(
            """INSERT INTO public.cases (
                   case_number, institution_id, primary_category_id, title, description,
                   status, priority, visibility, source_submission_id, opened_at
               ) VALUES ('CASE-2026-TEMP', %s, %s, 'Temp Case', 'Temp', 'new', 'normal', 'restricted', %s, now())
               RETURNING id""",
            (inst_a_id, cat_id, src_temp_id)
        )
        temp_case_id = str(cur.fetchone()[0])
        cur.execute("UPDATE public.submissions SET canonical_case_id = %s, intake_status = 'associated_with_case' WHERE id = %s", (temp_case_id, src_temp_id))
        cur.execute(
            """INSERT INTO public.duplicate_candidates (
                   submission_id, candidate_case_id, similarity_score, matching_method, matching_signals,
                   review_status, reviewed_at, reviewer_user_id, review_notes
               ) VALUES (%s, %s, 0.600, 'rules', '{"subject_overlap": true}',
                         'related', now(), %s, 'Temp related candidate')""",
            (sub4_id, temp_case_id, sa_user_id)
        )
        # Drop FK constraint temporarily inside savepoint to simulate stale dangling candidate
        cur.execute("ALTER TABLE public.duplicate_candidates DROP CONSTRAINT duplicate_candidates_candidate_case_id_fkey;")
        cur.execute("UPDATE public.submissions SET canonical_case_id = NULL, intake_status = 'ready_for_case_creation' WHERE id = %s;", (src_temp_id,))
        cur.execute("DELETE FROM public.cases WHERE id = %s;", (temp_case_id,))
        err = assert_fails_with(
            "SELECT public.create_canonical_case(%s, %s, 'Sub 4 Canonical Case', 'Test desc', 'normal', 'restricted', %s)",
            (sub4_id, bureau_a_id, sub4_updated_at),
            'P2D02'
        )
        print(f"[3d] Negative Test Passed: create_canonical_case rejected stale target case: {err.strip()}")
        cur.execute("ROLLBACK TO SAVEPOINT stale_case_sp;")

        # 3e. Negative Test: create_canonical_case revalidation on CLOSED related case
        cur.execute(
            """INSERT INTO public.submissions (
                   intake_channel_id, subject, original_text, original_language,
                   institution_id, category_id, intake_status, idempotency_key
               ) VALUES (%s, 'Sub 5 Subject', 'Sub 5 Body', 'en',
                         %s, %s, 'ready_for_case_creation', 'idem-sub-5')
               RETURNING id, updated_at""",
            (channel_id, inst_a_id, cat_id)
        )
        sub5_row = cur.fetchone()
        sub5_id = str(sub5_row[0])
        sub5_updated_at = sub5_row[1]

        cur.execute(
            """INSERT INTO public.duplicate_candidates (
                   submission_id, candidate_case_id, similarity_score, matching_method, matching_signals,
                   review_status, reviewed_at, reviewer_user_id, review_notes
               ) VALUES (%s, %s, 0.600, 'rules', '{"subject_overlap": true}',
                         'related', now(), %s, 'Related to closed case')""",
            (sub5_id, case_a_closed_id, sa_user_id)
        )

        err = assert_fails_with(
            "SELECT public.create_canonical_case(%s, %s, 'Sub 5 Canonical Case', 'Test desc', 'normal', 'restricted', %s)",
            (sub5_id, bureau_a_id, sub5_updated_at),
            'P2D08'
        )
        print(f"[3e] Negative Test Passed: create_canonical_case rejected closed related case: {err.strip()}")

        # 3f. Positive Test: Valid open case at same institution successfully links
        cur.execute(
            """INSERT INTO public.submissions (
                   intake_channel_id, subject, original_text, original_language,
                   institution_id, category_id, intake_status, idempotency_key
               ) VALUES (%s, 'Sub 6 Subject', 'Sub 6 Body', 'en',
                         %s, %s, 'ready_for_case_creation', 'idem-sub-6')
               RETURNING id, updated_at""",
            (channel_id, inst_a_id, cat_id)
        )
        sub6_row = cur.fetchone()
        sub6_id = str(sub6_row[0])
        sub6_updated_at = sub6_row[1]

        cur.execute(
            """INSERT INTO public.duplicate_candidates (
                   submission_id, candidate_case_id, similarity_score, matching_method, matching_signals,
                   review_status, reviewed_at, reviewer_user_id, review_notes
               ) VALUES (%s, %s, 0.600, 'rules', '{"subject_overlap": true}',
                         'related', now(), %s, 'Related to valid open case')""",
            (sub6_id, case_a_open_id, sa_user_id)
        )

        cur.execute(
            "SELECT public.create_canonical_case(%s, %s, 'Sub 6 Canonical Case', 'Test desc', 'normal', 'restricted', %s)",
            (sub6_id, bureau_a_id, sub6_updated_at)
        )
        new_case_id = str(cur.fetchone()[0])
        print(f"[3f] Positive Test Passed: Successfully created canonical case {new_case_id}")

        # Verify case_relationships row created
        cur.execute(
            """SELECT case_id, related_case_id, relationship_type, description 
               FROM public.case_relationships WHERE case_id = %s""",
            (new_case_id,)
        )
        rel_row = cur.fetchone()
        print(f"[3f] Verified case_relationships: {rel_row}")
        assert rel_row is not None
        assert str(rel_row[1]) == case_a_open_id
        assert rel_row[2] == 'related'

        # ---------------------------------------------------------------------
        # PROBE 4: Phase 2.2 Verification Hold & Lock Ordering Recheck
        # ---------------------------------------------------------------------
        print("\n=== PROBE 4: PHASE 2.2 VERIFICATION HOLD RECHECK ===")
        # Create a submission with an active verification task
        cur.execute(
            """INSERT INTO public.submissions (
                   intake_channel_id, subject, original_text, original_language,
                   institution_id, category_id, intake_status, idempotency_key
               ) VALUES (%s, 'Hold Subject', 'Hold Body', 'en',
                         %s, %s, 'awaiting_institution_verification', 'idem-hold-1')
               RETURNING id, updated_at""",
            (channel_id, inst_a_id, cat_id)
        )
        sub_hold_row = cur.fetchone()
        sub_hold_id = str(sub_hold_row[0])
        sub_hold_updated_at = sub_hold_row[1]

        cur.execute(
            """INSERT INTO public.institution_verification_tasks (
                   submission_id, status, submitted_institution_name
               ) VALUES (%s, 'pending', 'Hold Institution Name')""",
            (sub_hold_id,)
        )

        # Attempt candidate generation during active verification hold
        err = assert_fails_with(
            "SELECT public.generate_duplicate_candidates(%s, %s)",
            (sub_hold_id, sub_hold_updated_at),
            'P2D03'
        )
        print(f"[4a] Passed: generate_duplicate_candidates blocked during active verification hold: {err.strip()}")

        # Attempt case creation during active verification hold
        err = assert_fails_with(
            "SELECT public.create_canonical_case(%s, %s, 'Hold Case', 'Desc', 'normal', 'restricted', %s)",
            (sub_hold_id, bureau_a_id, sub_hold_updated_at),
            'P2D03'
        )
        print(f"[4b] Passed: create_canonical_case blocked during active verification hold: {err.strip()}")

        print("\nALL TARGETED PROBES PASSED PERFECTLY!")

    finally:
        print("\nRolling back all test transactions to leave database completely untouched...")
        conn.rollback()
        conn.close()
        print("Database transaction rolled back. Zero changes committed.")

if __name__ == '__main__':
    run_tests()

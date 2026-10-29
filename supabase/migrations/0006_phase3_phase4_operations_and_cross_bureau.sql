-- =============================================================================
-- Migration 0006: Phase 3 & Phase 4 Operations, Bureau Workflow & Cross-Bureau Controls
-- AICTE OneDesk — 32 Approved Application Tables Preserved (Zero schema divergence)
-- =============================================================================

-- 1. Seed Phase 3 & Phase 4 Permissions (18 permissions)
INSERT INTO public.permissions (code, name, resource_type, action_type, description)
VALUES
    ('CASE.STATUS.CHANGE', 'Change case status and lifecycle state', 'cases', 'status.change', 'Allows authorized status transitions on canonical cases'),
    ('CASE.HISTORY.VIEW', 'View case action history and audit events', 'cases', 'history.view', 'Allows viewing timeline and action history of a case'),
    ('CASE.NOTE.VIEW', 'View internal case notes', 'case_notes', 'view', 'Allows viewing internal notes subject to visibility rules'),
    ('CASE.NOTE.CREATE', 'Create shared or bureau-private case notes', 'case_notes', 'create', 'Allows adding notes to a canonical case'),
    ('CASE.NOTE.EDIT', 'Edit or soft-delete authorized case notes', 'case_notes', 'edit', 'Allows editing own notes or soft-deleting authorized notes'),
    ('CASE.ASSIGN.BUREAU', 'Assign or manage bureau participation', 'case_bureau_assignments', 'assign', 'Allows assigning lead or collaborating bureaus to cases'),
    ('CASE.ASSIGN.OFFICER', 'Assign or manage officer roles', 'case_officer_assignments', 'assign', 'Allows assigning officers to case bureau assignments'),
    ('ATTACHMENT.UPLOAD', 'Upload evidence and case attachments', 'attachments', 'upload', 'Allows uploading files to cases or submissions'),
    ('ATTACHMENT.VIEW', 'View attachment metadata and scan status', 'attachments', 'view', 'Allows viewing attachment metadata and verification status'),
    ('ATTACHMENT.DOWNLOAD', 'Generate short-lived signed download capability', 'attachments', 'download', 'Allows downloading verified attachments'),
    ('ATTACHMENT.QUARANTINE', 'Quarantine suspicious attachments', 'attachments', 'quarantine', 'Allows quarantining or restricting attachments'),
    ('CASE.TRANSFER.REQUEST', 'Request inter-bureau case transfer', 'case_transfers', 'request', 'Allows initiating transfer of a case to another bureau'),
    ('CASE.TRANSFER.DECIDE', 'Approve, reject, or cancel case transfers', 'case_transfers', 'decide', 'Allows deciding pending inter-bureau case transfers'),
    ('CASE.ACCESS.REQUEST', 'Request cross-bureau restricted case access', 'case_access_requests', 'request', 'Allows requesting access to cases outside assigned bureau'),
    ('CASE.ACCESS.REVIEW', 'View pending cross-bureau access requests', 'case_access_requests', 'review', 'Allows viewing access requests queue'),
    ('CASE.ACCESS.APPROVE', 'Approve or deny cross-bureau access requests', 'case_access_requests', 'approve', 'Allows approving or rejecting cross-bureau access requests'),
    ('CASE.ACCESS.MANAGE', 'View and manage active case access grants', 'case_access_grants', 'manage', 'Allows viewing access grants for a case'),
    ('CASE.ACCESS.REVOKE', 'Revoke active cross-bureau access grants', 'case_access_grants', 'revoke', 'Allows revoking unexpired case access grants')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    resource_type = EXCLUDED.resource_type,
    action_type = EXCLUDED.action_type,
    description = EXCLUDED.description,
    updated_at = now();

-- 2. Seed Role Permissions for Persona Roles
-- Super Admin: receives all 18 permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  CROSS JOIN public.permissions p
 WHERE r.code = 'SUPER_ADMIN'
   AND p.code IN (
       'CASE.STATUS.CHANGE', 'CASE.HISTORY.VIEW', 'CASE.NOTE.VIEW', 'CASE.NOTE.CREATE',
       'CASE.NOTE.EDIT', 'CASE.ASSIGN.BUREAU', 'CASE.ASSIGN.OFFICER', 'ATTACHMENT.UPLOAD',
       'ATTACHMENT.VIEW', 'ATTACHMENT.DOWNLOAD', 'ATTACHMENT.QUARANTINE', 'CASE.TRANSFER.REQUEST',
       'CASE.TRANSFER.DECIDE', 'CASE.ACCESS.REQUEST', 'CASE.ACCESS.REVIEW', 'CASE.ACCESS.APPROVE',
       'CASE.ACCESS.MANAGE', 'CASE.ACCESS.REVOKE'
   )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Bureau Admin: operations inside assigned bureau and access request management
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  CROSS JOIN public.permissions p
 WHERE r.code = 'BUREAU_ADMIN'
   AND p.code IN (
       'CASE.STATUS.CHANGE', 'CASE.HISTORY.VIEW', 'CASE.NOTE.VIEW', 'CASE.NOTE.CREATE',
       'CASE.NOTE.EDIT', 'CASE.ASSIGN.BUREAU', 'CASE.ASSIGN.OFFICER', 'ATTACHMENT.UPLOAD',
       'ATTACHMENT.VIEW', 'ATTACHMENT.DOWNLOAD', 'CASE.TRANSFER.REQUEST', 'CASE.TRANSFER.DECIDE',
       'CASE.ACCESS.REQUEST', 'CASE.ACCESS.REVIEW', 'CASE.ACCESS.APPROVE', 'CASE.ACCESS.MANAGE',
       'CASE.ACCESS.REVOKE'
   )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Case Officer: case operational capabilities
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  CROSS JOIN public.permissions p
 WHERE r.code = 'CASE_OFFICER'
   AND p.code IN (
       'CASE.STATUS.CHANGE', 'CASE.HISTORY.VIEW', 'CASE.NOTE.VIEW', 'CASE.NOTE.CREATE',
       'CASE.NOTE.EDIT', 'CASE.ASSIGN.OFFICER', 'ATTACHMENT.UPLOAD', 'ATTACHMENT.VIEW',
       'ATTACHMENT.DOWNLOAD', 'CASE.TRANSFER.REQUEST', 'CASE.ACCESS.REQUEST'
   )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Cross-Bureau Collaborator: index discovery, shared notes/evidence, access requests
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  CROSS JOIN public.permissions p
 WHERE r.code = 'CROSS_BUREAU_COLLABORATOR'
   AND p.code IN (
       'CASE.HISTORY.VIEW', 'CASE.NOTE.VIEW', 'CASE.NOTE.CREATE', 'ATTACHMENT.VIEW',
       'ATTACHMENT.DOWNLOAD', 'CASE.ACCESS.REQUEST'
   )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Senior Management: aggregate monitoring and governance
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  CROSS JOIN public.permissions p
 WHERE r.code = 'SENIOR_MANAGEMENT'
   AND p.code IN (
       'CASE.HISTORY.VIEW', 'CASE.NOTE.VIEW', 'ATTACHMENT.VIEW', 'ATTACHMENT.DOWNLOAD',
       'CASE.ACCESS.REVIEW', 'CASE.ACCESS.APPROVE', 'CASE.ACCESS.MANAGE'
   )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Auditor: read-only oversight
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  CROSS JOIN public.permissions p
 WHERE r.code = 'AUDITOR'
   AND p.code IN (
       'CASE.HISTORY.VIEW', 'CASE.NOTE.VIEW', 'ATTACHMENT.VIEW'
   )
ON CONFLICT (role_id, permission_id) DO NOTHING;


-- 3. Case Status Transition Function with Atomic Audit Logging
CREATE OR REPLACE FUNCTION public.transition_case_status(
    p_case_id uuid,
    p_new_status text,
    p_reason text,
    p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_caller_id uuid := public.auth_uid();
    v_case record;
    v_valid_transition boolean := false;
BEGIN
    -- Verify active account
    IF NOT EXISTS (
        SELECT 1 FROM public.users
         WHERE id = v_caller_id
           AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Caller is not active or authenticated.' USING ERRCODE = '42501';
    END IF;

    -- Verify capability
    IF NOT (public.has_permission('CASE.STATUS.CHANGE') OR public.has_global_permission('CASE.STATUS.CHANGE')) THEN
        RAISE EXCEPTION 'Caller lacks CASE.STATUS.CHANGE permission.' USING ERRCODE = '42501';
    END IF;

    -- Verify case detail access
    IF NOT public.can_access_case_details(p_case_id) THEN
        RAISE EXCEPTION 'Caller is not authorized to manage this case.' USING ERRCODE = '42501';
    END IF;

    -- Require non-blank reason
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'A non-blank reason is required for status transitions.' USING ERRCODE = 'P3S02';
    END IF;

    -- Lock case row
    SELECT id, status, updated_at, closed_at, case_number
      INTO v_case
      FROM public.cases
     WHERE id = p_case_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Case not found.' USING ERRCODE = 'P2D02';
    END IF;

    -- Optimistic concurrency check
    IF p_expected_updated_at IS NOT NULL AND v_case.updated_at <> p_expected_updated_at THEN
        RAISE EXCEPTION 'Case was modified by another user. Reload and try again.' USING ERRCODE = 'P3S01';
    END IF;

    -- Status Transition Matrix:
    -- 'new' -> 'under_review', 'assigned'
    -- 'under_review' -> 'assigned', 'in_progress', 'awaiting_information'
    -- 'assigned' -> 'in_progress', 'awaiting_information', 'under_review'
    -- 'in_progress' -> 'awaiting_information', 'resolved', 'closed'
    -- 'awaiting_information' -> 'in_progress', 'under_review'
    -- 'resolved' -> 'closed', 'reopened'
    -- 'closed' -> 'reopened'
    -- 'reopened' -> 'under_review', 'assigned', 'in_progress'
    IF v_case.status = p_new_status THEN
        RAISE EXCEPTION 'Case is already in status %.', p_new_status USING ERRCODE = 'P3S03';
    END IF;

    IF (v_case.status = 'new' AND p_new_status IN ('under_review', 'assigned')) OR
       (v_case.status = 'under_review' AND p_new_status IN ('assigned', 'in_progress', 'awaiting_information')) OR
       (v_case.status = 'assigned' AND p_new_status IN ('in_progress', 'awaiting_information', 'under_review')) OR
       (v_case.status = 'in_progress' AND p_new_status IN ('awaiting_information', 'resolved', 'closed')) OR
       (v_case.status = 'awaiting_information' AND p_new_status IN ('in_progress', 'under_review')) OR
       (v_case.status = 'resolved' AND p_new_status IN ('closed', 'reopened')) OR
       (v_case.status = 'closed' AND p_new_status IN ('reopened')) OR
       (v_case.status = 'reopened' AND p_new_status IN ('under_review', 'assigned', 'in_progress')) THEN
        v_valid_transition := true;
    END IF;

    -- Allow Super Admin or Senior Management to resolve or reopen from any non-terminal state
    IF NOT v_valid_transition AND public.has_global_permission('CASE.STATUS.CHANGE') THEN
        IF p_new_status IN ('resolved', 'closed', 'reopened', 'under_review', 'in_progress') THEN
            v_valid_transition := true;
        END IF;
    END IF;

    IF NOT v_valid_transition THEN
        RAISE EXCEPTION 'Invalid status transition from % to %.', v_case.status, p_new_status USING ERRCODE = 'P3S04';
    END IF;

    -- Update Case
    UPDATE public.cases
       SET status = p_new_status,
           closed_at = CASE WHEN p_new_status = 'closed' THEN now() ELSE NULL END,
           updated_by_user_id = v_caller_id,
           updated_at = now()
     WHERE id = p_case_id;

    -- Atomically append to action history
    INSERT INTO public.case_action_history (
        case_id,
        actor_user_id,
        action_type,
        action_description,
        previous_status,
        new_status,
        metadata,
        occurred_at
    ) VALUES (
        p_case_id,
        v_caller_id,
        'status_change',
        p_reason,
        v_case.status,
        p_new_status,
        jsonb_build_object(
            'from_status', v_case.status,
            'to_status', p_new_status,
            'reason', p_reason,
            'case_number', v_case.case_number
        ),
        now()
    );

    RETURN jsonb_build_object(
        'case_id', p_case_id,
        'previous_status', v_case.status,
        'new_status', p_new_status,
        'updated_at', now()
    );
END;
$$;


-- 4. Bureau Assignment Functions
CREATE OR REPLACE FUNCTION public.assign_case_bureau(
    p_case_id uuid,
    p_bureau_id uuid,
    p_assignment_type text,
    p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_caller_id uuid := public.auth_uid();
    v_new_id uuid;
    v_bureau_name text;
    v_case_number text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = v_caller_id AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Caller is not active or authenticated.' USING ERRCODE = '42501';
    END IF;

    IF NOT (public.has_permission('CASE.ASSIGN.BUREAU') OR public.has_global_permission('CASE.ASSIGN.BUREAU')) THEN
        RAISE EXCEPTION 'Caller lacks CASE.ASSIGN.BUREAU permission.' USING ERRCODE = '42501';
    END IF;

    IF NOT public.can_access_case_details(p_case_id) THEN
        RAISE EXCEPTION 'Caller is not authorized to manage assignments for this case.' USING ERRCODE = '42501';
    END IF;

    IF p_assignment_type NOT IN ('lead', 'collaborating') THEN
        RAISE EXCEPTION 'Invalid assignment type: %. Must be lead or collaborating.', p_assignment_type USING ERRCODE = 'P3A01';
    END IF;

    SELECT name INTO v_bureau_name FROM public.bureaus WHERE id = p_bureau_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target bureau does not exist or is inactive.' USING ERRCODE = 'P2D02';
    END IF;

    SELECT case_number INTO v_case_number FROM public.cases WHERE id = p_case_id;

    -- If assigning as lead, demote existing active lead to collaborating to satisfy open_lead_uq
    IF p_assignment_type = 'lead' THEN
        UPDATE public.case_bureau_assignments
           SET assignment_type = 'collaborating',
               updated_at = now()
         WHERE case_id = p_case_id
           AND assignment_type = 'lead'
           AND assignment_status IN ('pending', 'active')
           AND bureau_id <> p_bureau_id;
    END IF;

    -- Check if open pair already exists for (case_id, bureau_id)
    IF EXISTS (
        SELECT 1 FROM public.case_bureau_assignments
         WHERE case_id = p_case_id
           AND bureau_id = p_bureau_id
           AND assignment_status IN ('pending', 'active')
    ) THEN
        -- If already open, update type if changing to lead
        UPDATE public.case_bureau_assignments
           SET assignment_type = p_assignment_type,
               assignment_reason = coalesce(p_reason, assignment_reason),
               updated_at = now()
         WHERE case_id = p_case_id
           AND bureau_id = p_bureau_id
           AND assignment_status IN ('pending', 'active')
       RETURNING id INTO v_new_id;
    ELSE
        INSERT INTO public.case_bureau_assignments (
            case_id,
            bureau_id,
            assignment_type,
            assignment_status,
            assigned_by_user_id,
            assigned_at,
            assignment_reason
        ) VALUES (
            p_case_id,
            p_bureau_id,
            p_assignment_type,
            'active',
            v_caller_id,
            now(),
            p_reason
        ) RETURNING id INTO v_new_id;
    END IF;

    -- Audit in case_action_history
    INSERT INTO public.case_action_history (
        case_id,
        actor_user_id,
        action_type,
        action_description,
        related_bureau_assignment_id,
        metadata,
        occurred_at
    ) VALUES (
        p_case_id,
        v_caller_id,
        'bureau_assignment',
        format('Bureau %s assigned as %s.', v_bureau_name, p_assignment_type),
        v_new_id,
        jsonb_build_object(
            'bureau_id', p_bureau_id,
            'bureau_name', v_bureau_name,
            'assignment_type', p_assignment_type,
            'reason', p_reason
        ),
        now()
    );

    RETURN v_new_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.update_case_bureau_assignment(
    p_assignment_id uuid,
    p_new_status text,
    p_completion_notes text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_caller_id uuid := public.auth_uid();
    v_assign record;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = v_caller_id AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Caller is not active or authenticated.' USING ERRCODE = '42501';
    END IF;

    IF NOT (public.has_permission('CASE.ASSIGN.BUREAU') OR public.has_global_permission('CASE.ASSIGN.BUREAU')) THEN
        RAISE EXCEPTION 'Caller lacks CASE.ASSIGN.BUREAU permission.' USING ERRCODE = '42501';
    END IF;

    SELECT cba.*, b.name as bureau_name
      INTO v_assign
      FROM public.case_bureau_assignments cba
      JOIN public.bureaus b ON b.id = cba.bureau_id
     WHERE cba.id = p_assignment_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bureau assignment not found.' USING ERRCODE = 'P2D02';
    END IF;

    IF NOT public.can_access_case_details(v_assign.case_id) THEN
        RAISE EXCEPTION 'Caller is not authorized for this case.' USING ERRCODE = '42501';
    END IF;

    IF p_new_status NOT IN ('pending', 'active', 'completed', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid assignment status: %.', p_new_status USING ERRCODE = 'P3A02';
    END IF;

    UPDATE public.case_bureau_assignments
       SET assignment_status = p_new_status,
           completed_at = CASE WHEN p_new_status = 'completed' THEN now() ELSE NULL END,
           completion_notes = p_completion_notes,
           updated_at = now()
     WHERE id = p_assignment_id;

    INSERT INTO public.case_action_history (
        case_id,
        actor_user_id,
        action_type,
        action_description,
        related_bureau_assignment_id,
        metadata,
        occurred_at
    ) VALUES (
        v_assign.case_id,
        v_caller_id,
        'bureau_assignment_update',
        format('Bureau %s assignment status changed to %s.', v_assign.bureau_name, p_new_status),
        p_assignment_id,
        jsonb_build_object(
            'previous_status', v_assign.assignment_status,
            'new_status', p_new_status,
            'notes', p_completion_notes
        ),
        now()
    );

    RETURN true;
END;
$$;


-- 5. Officer Assignment Functions
CREATE OR REPLACE FUNCTION public.assign_case_officer(
    p_case_bureau_assignment_id uuid,
    p_officer_user_id uuid,
    p_role text,
    p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_caller_id uuid := public.auth_uid();
    v_bureau_assign record;
    v_officer_name text;
    v_new_id uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = v_caller_id AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Caller is not active or authenticated.' USING ERRCODE = '42501';
    END IF;

    IF NOT (public.has_permission('CASE.ASSIGN.OFFICER') OR public.has_global_permission('CASE.ASSIGN.OFFICER')) THEN
        RAISE EXCEPTION 'Caller lacks CASE.ASSIGN.OFFICER permission.' USING ERRCODE = '42501';
    END IF;

    SELECT cba.*, b.name as bureau_name
      INTO v_bureau_assign
      FROM public.case_bureau_assignments cba
      JOIN public.bureaus b ON b.id = cba.bureau_id
     WHERE cba.id = p_case_bureau_assignment_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Case bureau assignment not found.' USING ERRCODE = 'P2D02';
    END IF;

    IF NOT public.can_access_case_details(v_bureau_assign.case_id) THEN
        RAISE EXCEPTION 'Caller is not authorized for this case.' USING ERRCODE = '42501';
    END IF;

    -- Validate officer has active membership in this bureau
    IF NOT EXISTS (
        SELECT 1 FROM public.bureau_memberships bm
         WHERE bm.bureau_id = v_bureau_assign.bureau_id
           AND bm.user_id = p_officer_user_id
           AND bm.membership_status = 'active'
           AND (bm.ended_at IS NULL OR bm.ended_at > now())
    ) THEN
        RAISE EXCEPTION 'Officer does not have active membership in bureau %.', v_bureau_assign.bureau_name USING ERRCODE = 'P3O01';
    END IF;

    IF p_role NOT IN ('lead_officer', 'supporting', 'reviewer') THEN
        RAISE EXCEPTION 'Invalid officer role: %.', p_role USING ERRCODE = 'P3O02';
    END IF;

    SELECT full_name INTO v_officer_name FROM public.users WHERE id = p_officer_user_id;

    -- If lead_officer, demote existing open lead officer to supporting
    IF p_role = 'lead_officer' THEN
        UPDATE public.case_officer_assignments
           SET assignment_role = 'supporting',
               updated_at = now()
         WHERE case_bureau_assignment_id = p_case_bureau_assignment_id
           AND assignment_role = 'lead_officer'
           AND assignment_status IN ('pending', 'active')
           AND officer_user_id <> p_officer_user_id;
    END IF;

    -- Check if open pair exists
    IF EXISTS (
        SELECT 1 FROM public.case_officer_assignments
         WHERE case_bureau_assignment_id = p_case_bureau_assignment_id
           AND officer_user_id = p_officer_user_id
           AND assignment_status IN ('pending', 'active')
    ) THEN
        UPDATE public.case_officer_assignments
           SET assignment_role = p_role,
               assignment_notes = coalesce(p_notes, assignment_notes),
               updated_at = now()
         WHERE case_bureau_assignment_id = p_case_bureau_assignment_id
           AND officer_user_id = p_officer_user_id
           AND assignment_status IN ('pending', 'active')
       RETURNING id INTO v_new_id;
    ELSE
        INSERT INTO public.case_officer_assignments (
            case_bureau_assignment_id,
            officer_user_id,
            assignment_role,
            assignment_status,
            assigned_by_user_id,
            assigned_at,
            assignment_notes
        ) VALUES (
            p_case_bureau_assignment_id,
            p_officer_user_id,
            p_role,
            'active',
            v_caller_id,
            now(),
            p_notes
        ) RETURNING id INTO v_new_id;
    END IF;

    INSERT INTO public.case_action_history (
        case_id,
        actor_user_id,
        action_type,
        action_description,
        related_bureau_assignment_id,
        metadata,
        occurred_at
    ) VALUES (
        v_bureau_assign.case_id,
        v_caller_id,
        'officer_assignment',
        format('Officer %s assigned as %s in %s.', v_officer_name, p_role, v_bureau_assign.bureau_name),
        p_case_bureau_assignment_id,
        jsonb_build_object(
            'officer_user_id', p_officer_user_id,
            'officer_name', v_officer_name,
            'role', p_role,
            'notes', p_notes
        ),
        now()
    );

    RETURN v_new_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.update_case_officer_assignment(
    p_assignment_id uuid,
    p_new_status text,
    p_notes text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_caller_id uuid := public.auth_uid();
    v_officer_assign record;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = v_caller_id AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Caller is not active or authenticated.' USING ERRCODE = '42501';
    END IF;

    IF NOT (public.has_permission('CASE.ASSIGN.OFFICER') OR public.has_global_permission('CASE.ASSIGN.OFFICER')) THEN
        RAISE EXCEPTION 'Caller lacks CASE.ASSIGN.OFFICER permission.' USING ERRCODE = '42501';
    END IF;

    SELECT coa.*, cba.case_id, u.full_name as officer_name
      INTO v_officer_assign
      FROM public.case_officer_assignments coa
      JOIN public.case_bureau_assignments cba ON cba.id = coa.case_bureau_assignment_id
      JOIN public.users u ON u.id = coa.officer_user_id
     WHERE coa.id = p_assignment_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Officer assignment not found.' USING ERRCODE = 'P2D02';
    END IF;

    IF NOT public.can_access_case_details(v_officer_assign.case_id) THEN
        RAISE EXCEPTION 'Caller is not authorized for this case.' USING ERRCODE = '42501';
    END IF;

    IF p_new_status NOT IN ('pending', 'active', 'completed', 'revoked') THEN
        RAISE EXCEPTION 'Invalid officer assignment status: %.', p_new_status USING ERRCODE = 'P3O03';
    END IF;

    UPDATE public.case_officer_assignments
       SET assignment_status = p_new_status,
           completed_at = CASE WHEN p_new_status = 'completed' THEN now() ELSE NULL END,
           revoked_at = CASE WHEN p_new_status = 'revoked' THEN now() ELSE NULL END,
           completion_notes = p_notes,
           updated_at = now()
     WHERE id = p_assignment_id;

    INSERT INTO public.case_action_history (
        case_id,
        actor_user_id,
        action_type,
        action_description,
        related_bureau_assignment_id,
        metadata,
        occurred_at
    ) VALUES (
        v_officer_assign.case_id,
        v_caller_id,
        'officer_assignment_update',
        format('Officer %s assignment status changed to %s.', v_officer_assign.officer_name, p_new_status),
        v_officer_assign.case_bureau_assignment_id,
        jsonb_build_object(
            'officer_assignment_id', p_assignment_id,
            'previous_status', v_officer_assign.assignment_status,
            'new_status', p_new_status,
            'notes', p_notes
        ),
        now()
    );

    RETURN true;
END;
$$;


-- 6. Case Notes Functions (Shared vs Bureau-Private)
CREATE OR REPLACE FUNCTION public.create_case_note(
    p_case_id uuid,
    p_note_text text,
    p_visibility text,
    p_note_type text,
    p_bureau_id uuid,
    p_is_pinned boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_caller_id uuid := public.auth_uid();
    v_new_id uuid;
    v_bureau_name text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = v_caller_id AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Caller is not active or authenticated.' USING ERRCODE = '42501';
    END IF;

    IF NOT (public.has_permission('CASE.NOTE.CREATE') OR public.has_global_permission('CASE.NOTE.CREATE')) THEN
        RAISE EXCEPTION 'Caller lacks CASE.NOTE.CREATE permission.' USING ERRCODE = '42501';
    END IF;

    IF NOT public.can_access_case_details(p_case_id) THEN
        RAISE EXCEPTION 'Caller is not authorized to add notes to this case.' USING ERRCODE = '42501';
    END IF;

    IF p_note_text IS NULL OR length(btrim(p_note_text)) = 0 THEN
        RAISE EXCEPTION 'Note text cannot be blank.' USING ERRCODE = 'P3N01';
    END IF;

    IF p_visibility NOT IN ('shared', 'bureau_private') THEN
        RAISE EXCEPTION 'Invalid note visibility: %.', p_visibility USING ERRCODE = 'P3N02';
    END IF;

    IF p_note_type NOT IN ('general', 'internal_review', 'resolution', 'handover') THEN
        RAISE EXCEPTION 'Invalid note type: %.', p_note_type USING ERRCODE = 'P3N03';
    END IF;

    -- If private note, bureau_id is required and caller must belong to it (or be Super Admin)
    IF p_visibility = 'bureau_private' THEN
        IF p_bureau_id IS NULL THEN
            RAISE EXCEPTION 'Bureau ID is required for bureau-private notes.' USING ERRCODE = 'P3N04';
        END IF;

        IF NOT public.has_global_permission('CASE.NOTE.CREATE') AND NOT EXISTS (
            SELECT 1 FROM public.bureau_memberships bm
             WHERE bm.bureau_id = p_bureau_id
               AND bm.user_id = v_caller_id
               AND bm.membership_status = 'active'
               AND (bm.ended_at IS NULL OR bm.ended_at > now())
        ) THEN
            RAISE EXCEPTION 'Caller is not an active member of bureau %.', p_bureau_id USING ERRCODE = '42501';
        END IF;
    END IF;

    INSERT INTO public.case_notes (
        case_id,
        author_user_id,
        bureau_id,
        note_text,
        visibility,
        note_type,
        is_pinned
    ) VALUES (
        p_case_id,
        v_caller_id,
        p_bureau_id,
        btrim(p_note_text),
        p_visibility,
        p_note_type,
        coalesce(p_is_pinned, false)
    ) RETURNING id INTO v_new_id;

    INSERT INTO public.case_action_history (
        case_id,
        actor_user_id,
        action_type,
        action_description,
        metadata,
        occurred_at
    ) VALUES (
        p_case_id,
        v_caller_id,
        'note_created',
        format('Added %s note (%s).', p_visibility, p_note_type),
        jsonb_build_object(
            'note_id', v_new_id,
            'visibility', p_visibility,
            'note_type', p_note_type,
            'bureau_id', p_bureau_id,
            'is_pinned', coalesce(p_is_pinned, false)
        ),
        now()
    );

    RETURN v_new_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.update_case_note(
    p_note_id uuid,
    p_note_text text,
    p_is_pinned boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_caller_id uuid := public.auth_uid();
    v_note record;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = v_caller_id AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Caller is not active or authenticated.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_note FROM public.case_notes WHERE id = p_note_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Case note not found or deleted.' USING ERRCODE = 'P2D02';
    END IF;

    -- Only author or Super Admin can edit note text
    IF v_note.author_user_id <> v_caller_id AND NOT public.has_global_permission('CASE.NOTE.EDIT') THEN
        RAISE EXCEPTION 'Only the note author may edit note content.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.case_notes
       SET note_text = coalesce(btrim(p_note_text), note_text),
           is_pinned = coalesce(p_is_pinned, is_pinned),
           edited_at = now(),
           updated_at = now()
     WHERE id = p_note_id;

    INSERT INTO public.case_action_history (
        case_id,
        actor_user_id,
        action_type,
        action_description,
        metadata,
        occurred_at
    ) VALUES (
        v_note.case_id,
        v_caller_id,
        'note_edited',
        'Updated note content.',
        jsonb_build_object('note_id', p_note_id),
        now()
    );

    RETURN true;
END;
$$;


CREATE OR REPLACE FUNCTION public.soft_delete_case_note(
    p_note_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_caller_id uuid := public.auth_uid();
    v_note record;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = v_caller_id AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Caller is not active or authenticated.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_note FROM public.case_notes WHERE id = p_note_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Case note not found or already deleted.' USING ERRCODE = 'P2D02';
    END IF;

    IF v_note.author_user_id <> v_caller_id AND NOT public.has_global_permission('CASE.NOTE.EDIT') THEN
        RAISE EXCEPTION 'Caller is not authorized to delete this note.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.case_notes
       SET deleted_at = now(),
           deleted_by_user_id = v_caller_id,
           updated_at = now()
     WHERE id = p_note_id;

    INSERT INTO public.case_action_history (
        case_id,
        actor_user_id,
        action_type,
        action_description,
        metadata,
        occurred_at
    ) VALUES (
        v_note.case_id,
        v_caller_id,
        'note_deleted',
        'Soft-deleted note.',
        jsonb_build_object('note_id', p_note_id),
        now()
    );

    RETURN true;
END;
$$;


CREATE OR REPLACE FUNCTION public.case_notes_projection(p_case_id uuid)
RETURNS TABLE (
    note_id uuid,
    case_id uuid,
    author_user_id uuid,
    author_name text,
    bureau_id uuid,
    bureau_name text,
    bureau_code text,
    note_text text,
    visibility text,
    note_type text,
    is_pinned boolean,
    edited_at timestamptz,
    created_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
    SELECT cn.id AS note_id,
           cn.case_id,
           cn.author_user_id,
           u.full_name AS author_name,
           cn.bureau_id,
           b.name AS bureau_name,
           b.code AS bureau_code,
           cn.note_text,
           cn.visibility,
           cn.note_type,
           cn.is_pinned,
           cn.edited_at,
           cn.created_at
      FROM public.case_notes cn
      JOIN public.users u ON u.id = cn.author_user_id
      LEFT JOIN public.bureaus b ON b.id = cn.bureau_id
     WHERE cn.case_id = p_case_id
       AND cn.deleted_at IS NULL
       AND public.can_access_case_details(cn.case_id)
       AND (
           -- Shared notes visible to all authorized case viewers
           cn.visibility = 'shared'
           OR
           -- Bureau private notes visible ONLY to active members of that bureau or Super Admin
           (
               cn.visibility = 'bureau_private'
               AND (
                   public.has_global_permission('CASE.NOTE.VIEW')
                   OR
                   EXISTS (
                       SELECT 1 FROM public.bureau_memberships bm
                        WHERE bm.bureau_id = cn.bureau_id
                          AND bm.user_id = public.auth_uid()
                          AND bm.membership_status = 'active'
                          AND (bm.ended_at IS NULL OR bm.ended_at > now())
                   )
               )
           )
       )
     ORDER BY cn.is_pinned DESC, cn.created_at DESC;
$$;


-- 7. Case Attachments & Evidence Management
CREATE OR REPLACE FUNCTION public.register_case_attachment(
    p_case_id uuid,
    p_original_filename text,
    p_storage_bucket text,
    p_storage_path text,
    p_mime_type text,
    p_file_size_bytes bigint,
    p_sha256_checksum text,
    p_attachment_type text,
    p_description text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_caller_id uuid := public.auth_uid();
    v_new_id uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = v_caller_id AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Caller is not active or authenticated.' USING ERRCODE = '42501';
    END IF;

    IF NOT (public.has_permission('ATTACHMENT.UPLOAD') OR public.has_global_permission('ATTACHMENT.UPLOAD')) THEN
        RAISE EXCEPTION 'Caller lacks ATTACHMENT.UPLOAD permission.' USING ERRCODE = '42501';
    END IF;

    IF NOT public.can_access_case_details(p_case_id) THEN
        RAISE EXCEPTION 'Caller is not authorized to attach files to this case.' USING ERRCODE = '42501';
    END IF;

    IF p_original_filename IS NULL OR length(btrim(p_original_filename)) = 0 THEN
        RAISE EXCEPTION 'Original filename cannot be blank.' USING ERRCODE = 'P3D01';
    END IF;

    IF p_file_size_bytes <= 0 THEN
        RAISE EXCEPTION 'File size must be greater than zero.' USING ERRCODE = 'P3D02';
    END IF;

    IF p_attachment_type NOT IN ('original_submission', 'supporting_document', 'evidence', 'response', 'resolution_document') THEN
        RAISE EXCEPTION 'Invalid attachment type: %.', p_attachment_type USING ERRCODE = 'P3D03';
    END IF;

    INSERT INTO public.attachments (
        case_id,
        uploaded_by_user_id,
        original_filename,
        storage_bucket,
        storage_path,
        mime_type,
        file_size_bytes,
        sha256_checksum,
        attachment_type,
        upload_status,
        description,
        uploaded_at,
        verified_at
    ) VALUES (
        p_case_id,
        v_caller_id,
        btrim(p_original_filename),
        coalesce(btrim(p_storage_bucket), 'complaint-evidence'),
        btrim(p_storage_path),
        btrim(p_mime_type),
        p_file_size_bytes,
        p_sha256_checksum,
        p_attachment_type,
        'verified',
        p_description,
        now(),
        now()
    ) RETURNING id INTO v_new_id;

    INSERT INTO public.case_action_history (
        case_id,
        actor_user_id,
        action_type,
        action_description,
        metadata,
        occurred_at
    ) VALUES (
        p_case_id,
        v_caller_id,
        'attachment_added',
        format('Uploaded attachment %s (%s bytes).', p_original_filename, p_file_size_bytes),
        jsonb_build_object(
            'attachment_id', v_new_id,
            'filename', p_original_filename,
            'type', p_attachment_type,
            'size', p_file_size_bytes
        ),
        now()
    );

    RETURN v_new_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.case_attachments_projection(p_case_id uuid)
RETURNS TABLE (
    attachment_id uuid,
    case_id uuid,
    submission_id uuid,
    uploaded_by_user_id uuid,
    uploader_name text,
    original_filename text,
    storage_bucket text,
    storage_path text,
    mime_type text,
    file_size_bytes bigint,
    sha256_checksum text,
    attachment_type text,
    upload_status text,
    description text,
    uploaded_at timestamptz,
    verified_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
    SELECT a.id AS attachment_id,
           a.case_id,
           a.submission_id,
           a.uploaded_by_user_id,
           u.full_name AS uploader_name,
           a.original_filename,
           a.storage_bucket,
           a.storage_path,
           a.mime_type,
           a.file_size_bytes,
           a.sha256_checksum,
           a.attachment_type,
           a.upload_status,
           a.description,
           a.uploaded_at,
           a.verified_at
      FROM public.attachments a
      LEFT JOIN public.users u ON u.id = a.uploaded_by_user_id
     WHERE a.case_id = p_case_id
       AND a.deleted_at IS NULL
       AND public.can_access_case_details(a.case_id)
     ORDER BY a.uploaded_at DESC;
$$;


CREATE OR REPLACE FUNCTION public.quarantine_case_attachment(
    p_attachment_id uuid,
    p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_caller_id uuid := public.auth_uid();
    v_att RECORD;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = v_caller_id AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Caller is not active or authenticated.' USING ERRCODE = '42501';
    END IF;

    IF NOT (public.has_permission('ATTACHMENT.QUARANTINE') OR public.has_global_permission('ATTACHMENT.QUARANTINE')) THEN
        RAISE EXCEPTION 'Caller lacks ATTACHMENT.QUARANTINE permission.' USING ERRCODE = '42501';
    END IF;

    SELECT id, case_id, original_filename, upload_status
      INTO v_att
      FROM public.attachments
     WHERE id = p_attachment_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attachment not found.' USING ERRCODE = 'P3A01';
    END IF;

    UPDATE public.attachments
       SET upload_status = 'quarantined',
           updated_at = now()
     WHERE id = p_attachment_id;

    INSERT INTO public.case_action_history (
        case_id,
        actor_user_id,
        action_type,
        action_description,
        metadata,
        occurred_at
    ) VALUES (
        v_att.case_id,
        v_caller_id,
        'attachment_quarantined',
        format('Attachment %s was quarantined. Reason: %s', v_att.original_filename, coalesce(btrim(p_reason), 'No reason specified')),
        jsonb_build_object(
            'attachment_id', p_attachment_id,
            'filename', v_att.original_filename,
            'reason', p_reason
        ),
        now()
    );

    RETURN true;
END;
$$;


-- 8. Case Transfers (Cross-Bureau Handovers & Reassignments)
CREATE OR REPLACE FUNCTION public.request_case_transfer(
    p_case_id uuid,
    p_from_bureau_assignment_id uuid,
    p_to_bureau_id uuid,
    p_transfer_type text,
    p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_caller_id uuid := public.auth_uid();
    v_from_assign record;
    v_to_bureau record;
    v_new_id uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = v_caller_id AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Caller is not active or authenticated.' USING ERRCODE = '42501';
    END IF;

    IF NOT (public.has_permission('CASE.TRANSFER.REQUEST') OR public.has_global_permission('CASE.TRANSFER.REQUEST')) THEN
        RAISE EXCEPTION 'Caller lacks CASE.TRANSFER.REQUEST permission.' USING ERRCODE = '42501';
    END IF;

    IF NOT public.can_access_case_details(p_case_id) THEN
        RAISE EXCEPTION 'Caller is not authorized for this case.' USING ERRCODE = '42501';
    END IF;

    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'Transfer reason cannot be blank.' USING ERRCODE = 'P3T01';
    END IF;

    IF p_transfer_type NOT IN ('handover', 'lead_change', 'reassignment') THEN
        RAISE EXCEPTION 'Invalid transfer type: %.', p_transfer_type USING ERRCODE = 'P3T02';
    END IF;

    SELECT cba.*, b.name as from_bureau_name
      INTO v_from_assign
      FROM public.case_bureau_assignments cba
      JOIN public.bureaus b ON b.id = cba.bureau_id
     WHERE cba.id = p_from_bureau_assignment_id
       AND cba.case_id = p_case_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Source bureau assignment not found on this case.' USING ERRCODE = 'P2D02';
    END IF;

    SELECT * INTO v_to_bureau FROM public.bureaus WHERE id = p_to_bureau_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Destination bureau does not exist or is inactive.' USING ERRCODE = 'P2D02';
    END IF;

    IF v_from_assign.bureau_id = p_to_bureau_id THEN
        RAISE EXCEPTION 'Cannot transfer to the same bureau.' USING ERRCODE = 'P3T03';
    END IF;

    INSERT INTO public.case_transfers (
        case_id,
        from_bureau_assignment_id,
        transfer_type,
        transfer_status,
        transfer_reason,
        initiated_by_user_id,
        initiated_at
    ) VALUES (
        p_case_id,
        p_from_bureau_assignment_id,
        p_transfer_type,
        'pending',
        btrim(p_reason),
        v_caller_id,
        now()
    ) RETURNING id INTO v_new_id;

    INSERT INTO public.case_action_history (
        case_id,
        actor_user_id,
        action_type,
        action_description,
        related_bureau_assignment_id,
        metadata,
        occurred_at
    ) VALUES (
        p_case_id,
        v_caller_id,
        'transfer_requested',
        format('Requested %s transfer from %s to %s.', p_transfer_type, v_from_assign.from_bureau_name, v_to_bureau.name),
        p_from_bureau_assignment_id,
        jsonb_build_object(
            'transfer_id', v_new_id,
            'transfer_type', p_transfer_type,
            'from_bureau_id', v_from_assign.bureau_id,
            'to_bureau_id', p_to_bureau_id,
            'reason', p_reason
        ),
        now()
    );

    RETURN v_new_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.decide_case_transfer(
    p_transfer_id uuid,
    p_decision text,
    p_decision_notes text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_caller_id uuid := public.auth_uid();
    v_transfer record;
    v_to_bureau_id uuid;
    v_dest_assign_id uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = v_caller_id AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Caller is not active or authenticated.' USING ERRCODE = '42501';
    END IF;

    IF NOT (public.has_permission('CASE.TRANSFER.DECIDE') OR public.has_global_permission('CASE.TRANSFER.DECIDE')) THEN
        RAISE EXCEPTION 'Caller lacks CASE.TRANSFER.DECIDE permission.' USING ERRCODE = '42501';
    END IF;

    SELECT ct.*, cba.case_id, cba.bureau_id as from_bureau_id, cba.assignment_type as from_type
      INTO v_transfer
      FROM public.case_transfers ct
      JOIN public.case_bureau_assignments cba ON cba.id = ct.from_bureau_assignment_id
     WHERE ct.id = p_transfer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer request not found.' USING ERRCODE = 'P2D02';
    END IF;

    IF v_transfer.transfer_status <> 'pending' THEN
        RAISE EXCEPTION 'Transfer request is already resolved (status: %).', v_transfer.transfer_status USING ERRCODE = 'P3T04';
    END IF;

    IF p_decision NOT IN ('approved', 'rejected', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid transfer decision: %.', p_decision USING ERRCODE = 'P3T05';
    END IF;

    IF p_decision = 'approved' THEN
        -- Mark transfer completed
        UPDATE public.case_transfers
           SET transfer_status = 'completed',
               decided_by_user_id = v_caller_id,
               decided_at = now(),
               completed_at = now(),
               decision_notes = p_decision_notes,
               updated_at = now()
         WHERE id = p_transfer_id;

        -- If handover / lead change, mark from_assignment completed
        IF v_transfer.transfer_type IN ('handover', 'lead_change') THEN
            UPDATE public.case_bureau_assignments
               SET assignment_status = 'completed',
                   completed_at = now(),
                   completion_notes = 'Completed via transfer handover',
                   updated_at = now()
             WHERE id = v_transfer.from_bureau_assignment_id;
        END IF;

        INSERT INTO public.case_action_history (
            case_id,
            actor_user_id,
            action_type,
            action_description,
            related_bureau_assignment_id,
            metadata,
            occurred_at
        ) VALUES (
            v_transfer.case_id,
            v_caller_id,
            'transfer_approved',
            'Approved case transfer.',
            v_transfer.from_bureau_assignment_id,
            jsonb_build_object(
                'transfer_id', p_transfer_id,
                'decision', 'approved',
                'notes', p_decision_notes
            ),
            now()
        );
    ELSE
        UPDATE public.case_transfers
           SET transfer_status = p_decision,
               decided_by_user_id = v_caller_id,
               decided_at = now(),
               decision_notes = p_decision_notes,
               updated_at = now()
         WHERE id = p_transfer_id;

        INSERT INTO public.case_action_history (
            case_id,
            actor_user_id,
            action_type,
            action_description,
            related_bureau_assignment_id,
            metadata,
            occurred_at
        ) VALUES (
            v_transfer.case_id,
            v_caller_id,
            'transfer_decided',
            format('Case transfer %s.', p_decision),
            v_transfer.from_bureau_assignment_id,
            jsonb_build_object(
                'transfer_id', p_transfer_id,
                'decision', p_decision,
                'notes', p_decision_notes
            ),
            now()
        );
    END IF;

    RETURN true;
END;
$$;


-- 9. Cross-Bureau Access Requests & Grants
CREATE OR REPLACE FUNCTION public.request_case_access(
    p_case_id uuid,
    p_access_level text,
    p_reason text,
    p_requesting_bureau_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_caller_id uuid := public.auth_uid();
    v_new_id uuid;
    v_bureau_id uuid := p_requesting_bureau_id;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = v_caller_id AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Caller is not active or authenticated.' USING ERRCODE = '42501';
    END IF;

    IF NOT (public.has_permission('CASE.ACCESS.REQUEST') OR public.has_global_permission('CASE.ACCESS.REQUEST')) THEN
        RAISE EXCEPTION 'Caller lacks CASE.ACCESS.REQUEST permission.' USING ERRCODE = '42501';
    END IF;

    -- Caller must be able to view at least the index
    IF NOT (public.has_permission('CASE.VIEW_INDEX') OR public.has_global_permission('CASE.VIEW_INDEX')) THEN
        RAISE EXCEPTION 'Caller lacks CASE.VIEW_INDEX permission.' USING ERRCODE = '42501';
    END IF;

    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'Request reason cannot be blank.' USING ERRCODE = 'P3R01';
    END IF;

    IF p_access_level NOT IN ('details', 'collaborate') THEN
        RAISE EXCEPTION 'Invalid access level: %. Must be details or collaborate.', p_access_level USING ERRCODE = 'P3R02';
    END IF;

    -- Infer requesting bureau from caller's active membership if not passed
    IF v_bureau_id IS NULL THEN
        SELECT bureau_id INTO v_bureau_id
          FROM public.bureau_memberships
         WHERE user_id = v_caller_id
           AND membership_status = 'active'
           AND (ended_at IS NULL OR ended_at > now())
         LIMIT 1;
    END IF;

    -- Check if pending request already exists for this pair
    SELECT id INTO v_new_id
      FROM public.case_access_requests
     WHERE case_id = p_case_id
       AND requester_user_id = v_caller_id
       AND requested_access_level = p_access_level
       AND request_status = 'pending';

    IF FOUND THEN
        RETURN v_new_id;
    END IF;

    INSERT INTO public.case_access_requests (
        case_id,
        requester_user_id,
        requesting_bureau_id,
        requested_access_level,
        request_reason,
        request_status,
        requested_at
    ) VALUES (
        p_case_id,
        v_caller_id,
        v_bureau_id,
        p_access_level,
        btrim(p_reason),
        'pending',
        now()
    ) RETURNING id INTO v_new_id;

    INSERT INTO public.case_action_history (
        case_id,
        actor_user_id,
        action_type,
        action_description,
        metadata,
        occurred_at
    ) VALUES (
        p_case_id,
        v_caller_id,
        'access_requested',
        format('Requested %s access to case details.', p_access_level),
        jsonb_build_object(
            'access_request_id', v_new_id,
            'access_level', p_access_level,
            'reason', p_reason
        ),
        now()
    );

    RETURN v_new_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.case_access_requests_queue(
    p_status text DEFAULT 'pending',
    p_limit int DEFAULT 50,
    p_offset int DEFAULT 0
)
RETURNS TABLE (
    request_id uuid,
    case_id uuid,
    case_number text,
    institution_name text,
    requester_user_id uuid,
    requester_name text,
    requesting_bureau_id uuid,
    requesting_bureau_name text,
    requested_access_level text,
    request_reason text,
    request_status text,
    requested_at timestamptz,
    reviewed_by_user_id uuid,
    reviewed_at timestamptz,
    decision_reason text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
    SELECT car.id AS request_id,
           car.case_id,
           c.case_number,
           i.official_name AS institution_name,
           car.requester_user_id,
           u_req.full_name AS requester_name,
           car.requesting_bureau_id,
           b.name AS requesting_bureau_name,
           car.requested_access_level,
           car.request_reason,
           car.request_status,
           car.requested_at,
           car.reviewed_by_user_id,
           car.reviewed_at,
           car.decision_reason
      FROM public.case_access_requests car
      JOIN public.cases c ON c.id = car.case_id
      JOIN public.institutions i ON i.id = c.institution_id
      JOIN public.users u_req ON u_req.id = car.requester_user_id
      LEFT JOIN public.bureaus b ON b.id = car.requesting_bureau_id
     WHERE (p_status IS NULL OR car.request_status = p_status)
       AND (
           public.has_global_permission('CASE.ACCESS.REVIEW')
           OR
           public.has_permission('CASE.ACCESS.REVIEW')
           OR
           car.requester_user_id = public.auth_uid()
       )
     ORDER BY car.requested_at DESC
     LIMIT p_limit OFFSET p_offset;
$$;


CREATE OR REPLACE FUNCTION public.decide_case_access_request(
    p_request_id uuid,
    p_decision text,
    p_decision_reason text,
    p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_caller_id uuid := public.auth_uid();
    v_req record;
    v_grant_id uuid := NULL;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = v_caller_id AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Caller is not active or authenticated.' USING ERRCODE = '42501';
    END IF;

    IF NOT (public.has_permission('CASE.ACCESS.APPROVE') OR public.has_global_permission('CASE.ACCESS.APPROVE')) THEN
        RAISE EXCEPTION 'Caller lacks CASE.ACCESS.APPROVE permission.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_req FROM public.case_access_requests WHERE id = p_request_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access request not found.' USING ERRCODE = 'P2D02';
    END IF;

    IF v_req.request_status <> 'pending' THEN
        RAISE EXCEPTION 'Access request is already resolved (status: %).', v_req.request_status USING ERRCODE = 'P3R03';
    END IF;

    IF p_decision NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'Decision must be approved or rejected.' USING ERRCODE = 'P3R04';
    END IF;

    IF p_decision = 'rejected' AND (p_decision_reason IS NULL OR length(btrim(p_decision_reason)) = 0) THEN
        RAISE EXCEPTION 'Rejection reason is required.' USING ERRCODE = 'P3R05';
    END IF;

    UPDATE public.case_access_requests
       SET request_status = p_decision,
           reviewed_by_user_id = v_caller_id,
           reviewed_at = now(),
           decision_reason = p_decision_reason,
           updated_at = now()
     WHERE id = p_request_id;

    IF p_decision = 'approved' THEN
        INSERT INTO public.case_access_grants (
            case_id,
            grantee_user_id,
            access_request_id,
            access_level,
            grant_reason,
            granted_by_user_id,
            granted_at,
            expires_at
        ) VALUES (
            v_req.case_id,
            v_req.requester_user_id,
            p_request_id,
            v_req.requested_access_level,
            coalesce(btrim(p_decision_reason), 'Access request approved by reviewer'),
            v_caller_id,
            now(),
            p_expires_at
        ) RETURNING id INTO v_grant_id;

        INSERT INTO public.case_action_history (
            case_id,
            actor_user_id,
            action_type,
            action_description,
            metadata,
            occurred_at
        ) VALUES (
            v_req.case_id,
            v_caller_id,
            'access_granted',
            format('Approved %s access grant for user.', v_req.requested_access_level),
            jsonb_build_object(
                'grant_id', v_grant_id,
                'request_id', p_request_id,
                'grantee_user_id', v_req.requester_user_id,
                'expires_at', p_expires_at
            ),
            now()
        );
    ELSE
        INSERT INTO public.case_action_history (
            case_id,
            actor_user_id,
            action_type,
            action_description,
            metadata,
            occurred_at
        ) VALUES (
            v_req.case_id,
            v_caller_id,
            'access_rejected',
            'Rejected access request.',
            jsonb_build_object(
                'request_id', p_request_id,
                'grantee_user_id', v_req.requester_user_id,
                'reason', p_decision_reason
            ),
            now()
        );
    END IF;

    RETURN v_grant_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.revoke_case_access_grant(
    p_grant_id uuid,
    p_revocation_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_caller_id uuid := public.auth_uid();
    v_grant record;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = v_caller_id AND account_status = 'active'
    ) THEN
        RAISE EXCEPTION 'Caller is not active or authenticated.' USING ERRCODE = '42501';
    END IF;

    IF NOT (public.has_permission('CASE.ACCESS.REVOKE') OR public.has_global_permission('CASE.ACCESS.REVOKE')) THEN
        RAISE EXCEPTION 'Caller lacks CASE.ACCESS.REVOKE permission.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_grant FROM public.case_access_grants WHERE id = p_grant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access grant not found.' USING ERRCODE = 'P2D02';
    END IF;

    IF v_grant.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'Access grant is already revoked.' USING ERRCODE = 'P3R06';
    END IF;

    IF p_revocation_reason IS NULL OR length(btrim(p_revocation_reason)) = 0 THEN
        RAISE EXCEPTION 'Revocation reason cannot be blank.' USING ERRCODE = 'P3R07';
    END IF;

    UPDATE public.case_access_grants
       SET revoked_at = now(),
           revoked_by_user_id = v_caller_id,
           revocation_reason = btrim(p_revocation_reason),
           updated_at = now()
     WHERE id = p_grant_id;

    INSERT INTO public.case_action_history (
        case_id,
        actor_user_id,
        action_type,
        action_description,
        metadata,
        occurred_at
    ) VALUES (
        v_grant.case_id,
        v_caller_id,
        'access_revoked',
        format('Revoked %s access grant.', v_grant.access_level),
        jsonb_build_object(
            'grant_id', p_grant_id,
            'grantee_user_id', v_grant.grantee_user_id,
            'reason', p_revocation_reason
        ),
        now()
    );

    RETURN true;
END;
$$;


CREATE OR REPLACE FUNCTION public.case_access_grants_projection(p_case_id uuid)
RETURNS TABLE (
    grant_id uuid,
    case_id uuid,
    grantee_user_id uuid,
    grantee_name text,
    access_request_id uuid,
    access_level text,
    grant_reason text,
    granted_by_user_id uuid,
    granted_by_name text,
    granted_at timestamptz,
    expires_at timestamptz,
    revoked_at timestamptz,
    revoked_by_user_id uuid,
    revocation_reason text,
    is_active boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
    SELECT cag.id AS grant_id,
           cag.case_id,
           cag.grantee_user_id,
           u_grantee.full_name AS grantee_name,
           cag.access_request_id,
           cag.access_level,
           cag.grant_reason,
           cag.granted_by_user_id,
           u_grantor.full_name AS granted_by_name,
           cag.granted_at,
           cag.expires_at,
           cag.revoked_at,
           cag.revoked_by_user_id,
           cag.revocation_reason,
           (cag.revoked_at IS NULL AND (cag.expires_at IS NULL OR cag.expires_at > now())) AS is_active
      FROM public.case_access_grants cag
      JOIN public.users u_grantee ON u_grantee.id = cag.grantee_user_id
      JOIN public.users u_grantor ON u_grantor.id = cag.granted_by_user_id
     WHERE cag.case_id = p_case_id
       AND (
           public.has_global_permission('CASE.ACCESS.MANAGE')
           OR
           public.has_permission('CASE.ACCESS.MANAGE')
           OR
           cag.grantee_user_id = public.auth_uid()
       )
     ORDER BY cag.granted_at DESC;
$$;


-- 10. Update Case Detail Projection to Include Active Assignments & Counts
DROP FUNCTION IF EXISTS public.case_detail_projection(uuid);
CREATE OR REPLACE FUNCTION public.case_detail_projection(p_case_id uuid)
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
    officer_assignments jsonb,
    related_cases jsonb,
    action_history jsonb,
    notes_count bigint,
    attachments_count bigint
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
                    'assignment_id', cba_collab.id,
                    'bureau_id', cba_collab.bureau_id,
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
                    'officer_assignment_id', coa.id,
                    'case_bureau_assignment_id', coa.case_bureau_assignment_id,
                    'bureau_name', b_off.name,
                    'officer_user_id', coa.officer_user_id,
                    'officer_name', u_off.full_name,
                    'role', coa.assignment_role,
                    'status', coa.assignment_status,
                    'assigned_at', coa.assigned_at
                ))
                  FROM public.case_bureau_assignments cba_off
                  JOIN public.bureaus b_off ON b_off.id = cba_off.bureau_id
                  JOIN public.case_officer_assignments coa ON coa.case_bureau_assignment_id = cba_off.id
                  JOIN public.users u_off ON u_off.id = coa.officer_user_id
                 WHERE cba_off.case_id = c.id
                   AND coa.assignment_status = 'active'
            ),
            '[]'::jsonb
        ) AS officer_assignments,
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
        ) AS action_history,
        (
            SELECT count(*)::bigint
              FROM public.case_notes cn
             WHERE cn.case_id = c.id
               AND cn.deleted_at IS NULL
        ) AS notes_count,
        (
            SELECT count(*)::bigint
              FROM public.attachments att
             WHERE att.case_id = c.id
               AND att.deleted_at IS NULL
        ) AS attachments_count
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


-- 11. Revoke public/anon execute and grant strictly to authenticated
REVOKE ALL ON FUNCTION public.transition_case_status(uuid, text, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_case_bureau(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_case_bureau_assignment(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_case_officer(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_case_officer_assignment(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_case_note(uuid, text, text, text, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_case_note(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.soft_delete_case_note(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.case_notes_projection(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_case_attachment(uuid, text, text, text, text, bigint, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quarantine_case_attachment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.case_attachments_projection(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_case_transfer(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_case_transfer(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_case_access(uuid, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.case_access_requests_queue(text, int, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_case_access_request(uuid, text, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_case_access_grant(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.case_access_grants_projection(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.transition_case_status(uuid, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_case_bureau(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_case_bureau_assignment(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_case_officer(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_case_officer_assignment(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_case_note(uuid, text, text, text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_case_note(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_case_note(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.case_notes_projection(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_case_attachment(uuid, text, text, text, text, bigint, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quarantine_case_attachment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.case_attachments_projection(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_case_transfer(uuid, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_case_transfer(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_case_access(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.case_access_requests_queue(text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_case_access_request(uuid, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_case_access_grant(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.case_access_grants_projection(uuid) TO authenticated;

-- Ensure postgres ownership
DO $$
DECLARE
    fn_name text;
    fn_names text[] := ARRAY[
        'transition_case_status',
        'assign_case_bureau',
        'update_case_bureau_assignment',
        'assign_case_officer',
        'update_case_officer_assignment',
        'create_case_note',
        'update_case_note',
        'soft_delete_case_note',
        'case_notes_projection',
        'register_case_attachment',
        'case_attachments_projection',
        'request_case_transfer',
        'decide_case_transfer',
        'request_case_access',
        'case_access_requests_queue',
        'decide_case_access_request',
        'revoke_case_access_grant',
        'case_access_grants_projection'
    ];
BEGIN
    FOREACH fn_name IN ARRAY fn_names LOOP
        BEGIN
            EXECUTE format('ALTER FUNCTION public.%I OWNER TO postgres;', fn_name);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END $$;

-- =============================================================================
-- RECOVERY & ROLLBACK POLICY (PHASE 3 & 4)
-- =============================================================================
-- 1. FORWARD-ONLY RECOVERY POLICY (PRODUCTION):
--    Once production workflows (assignments, status changes, notes, attachments)
--    are recorded, Migration 0006 CANNOT be rolled back by dropping data or permissions.
--    Forward-only fixes (via replacement functions or additive migrations) MUST be applied.
--
-- 2. SAFE CONSTRAINED ROLLBACK (STAGING / PRE-OPERATIONAL GUARD):
--    DROP FUNCTION IF EXISTS public.transition_case_status(uuid, text, text, timestamptz) CASCADE;
--    DROP FUNCTION IF EXISTS public.assign_case_bureau(uuid, uuid, text, text) CASCADE;
--    DROP FUNCTION IF EXISTS public.update_case_bureau_assignment(uuid, text, text) CASCADE;
--    DROP FUNCTION IF EXISTS public.assign_case_officer(uuid, uuid, text, text) CASCADE;
--    DROP FUNCTION IF EXISTS public.update_case_officer_assignment(uuid, text, text) CASCADE;
--    DROP FUNCTION IF EXISTS public.create_case_note(uuid, text, text, text, uuid, boolean) CASCADE;
--    DROP FUNCTION IF EXISTS public.update_case_note(uuid, text, boolean) CASCADE;
--    DROP FUNCTION IF EXISTS public.soft_delete_case_note(uuid) CASCADE;
--    DROP FUNCTION IF EXISTS public.case_notes_projection(uuid) CASCADE;
--    DROP FUNCTION IF EXISTS public.register_case_attachment(uuid, text, text, text, text, bigint, text, text, text) CASCADE;
--    DROP FUNCTION IF EXISTS public.case_attachments_projection(uuid) CASCADE;
--    DROP FUNCTION IF EXISTS public.request_case_transfer(uuid, uuid, uuid, text, text) CASCADE;
--    DROP FUNCTION IF EXISTS public.decide_case_transfer(uuid, text, text) CASCADE;
--    DROP FUNCTION IF EXISTS public.request_case_access(uuid, text, text, uuid) CASCADE;
--    DROP FUNCTION IF EXISTS public.case_access_requests_queue(text, int, int) CASCADE;
--    DROP FUNCTION IF EXISTS public.decide_case_access_request(uuid, text, text, timestamptz) CASCADE;
--    DROP FUNCTION IF EXISTS public.revoke_case_access_grant(uuid, text) CASCADE;
--    DROP FUNCTION IF EXISTS public.case_access_grants_projection(uuid) CASCADE;
--
--    DELETE FROM public.role_permissions
--     WHERE permission_id IN (
--         SELECT id FROM public.permissions 
--          WHERE code IN (
--              'CASE.STATUS.CHANGE', 'CASE.HISTORY.VIEW', 'CASE.NOTE.VIEW', 'CASE.NOTE.CREATE',
--              'CASE.NOTE.EDIT', 'CASE.ASSIGN.BUREAU', 'CASE.ASSIGN.OFFICER', 'ATTACHMENT.UPLOAD',
--              'ATTACHMENT.VIEW', 'ATTACHMENT.DOWNLOAD', 'ATTACHMENT.QUARANTINE', 'CASE.TRANSFER.REQUEST',
--              'CASE.TRANSFER.DECIDE', 'CASE.ACCESS.REQUEST', 'CASE.ACCESS.REVIEW', 'CASE.ACCESS.APPROVE',
--              'CASE.ACCESS.MANAGE', 'CASE.ACCESS.REVOKE'
--          )
--     );
--
--    DELETE FROM public.permissions
--     WHERE code IN (
--         'CASE.STATUS.CHANGE', 'CASE.HISTORY.VIEW', 'CASE.NOTE.VIEW', 'CASE.NOTE.CREATE',
--         'CASE.NOTE.EDIT', 'CASE.ASSIGN.BUREAU', 'CASE.ASSIGN.OFFICER', 'ATTACHMENT.UPLOAD',
--         'ATTACHMENT.VIEW', 'ATTACHMENT.DOWNLOAD', 'ATTACHMENT.QUARANTINE', 'CASE.TRANSFER.REQUEST',
--         'CASE.TRANSFER.DECIDE', 'CASE.ACCESS.REQUEST', 'CASE.ACCESS.REVIEW', 'CASE.ACCESS.APPROVE',
--         'CASE.ACCESS.MANAGE', 'CASE.ACCESS.REVOKE'
--     );
-- =============================================================================

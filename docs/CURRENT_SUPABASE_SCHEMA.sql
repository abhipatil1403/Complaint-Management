


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."prevent_case_action_history_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
    RAISE EXCEPTION
        'Case action history is append-only: % not permitted',
        TG_OP;
END;
$$;


ALTER FUNCTION "public"."prevent_case_action_history_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_case_access_grant"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
    request_record RECORD;
BEGIN
    IF NEW.access_request_id IS NOT NULL THEN

        SELECT
            case_id,
            requester_user_id,
            requested_access_level,
            request_status,
            reviewed_by_user_id
        INTO request_record
        FROM public.case_access_requests
        WHERE id = NEW.access_request_id
        FOR SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Referenced access request does not exist';
        END IF;

        IF request_record.request_status <> 'approved' THEN
            RAISE EXCEPTION
                'Access grants require an approved request';
        END IF;

        IF request_record.case_id <> NEW.case_id THEN
            RAISE EXCEPTION
                'Grant case must match access request case';
        END IF;

        IF request_record.requester_user_id <> NEW.grantee_user_id THEN
            RAISE EXCEPTION
                'Grant user must match access requester';
        END IF;

        IF request_record.requested_access_level = 'details'
           AND NEW.access_level = 'collaborate' THEN
            RAISE EXCEPTION
                'Grant cannot exceed requested access level';
        END IF;

        IF request_record.reviewed_by_user_id
           IS DISTINCT FROM NEW.granted_by_user_id THEN
            RAISE EXCEPTION
                'Granting user must match the request approver';
        END IF;

    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_case_access_grant"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_case_creation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
    institution_is_eligible BOOLEAN;
    source_institution_id UUID;
    source_status TEXT;
    source_case_id UUID;
BEGIN
    SELECT (
        verification_status = 'verified'
        AND is_active = TRUE
    )
    INTO institution_is_eligible
    FROM public.institutions
    WHERE id = NEW.institution_id
    FOR SHARE;

    IF institution_is_eligible IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION
            'Case requires an active, verified institution';
    END IF;

    SELECT
        institution_id,
        intake_status,
        canonical_case_id
    INTO
        source_institution_id,
        source_status,
        source_case_id
    FROM public.submissions
    WHERE id = NEW.source_submission_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Source submission not found';
    END IF;

    IF source_institution_id IS DISTINCT FROM NEW.institution_id THEN
        RAISE EXCEPTION
            'Case institution must match source submission institution';
    END IF;

    IF source_status <> 'ready_for_case_creation' THEN
        RAISE EXCEPTION
            'Source submission must be ready for case creation';
    END IF;

    IF source_case_id IS NOT NULL THEN
        RAISE EXCEPTION
            'Source submission is already associated with a case';
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_case_creation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_case_deadline"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
    assignment_case_id UUID;
    policy_record RECORD;
BEGIN
    SELECT
        policy_status,
        effective_from,
        effective_until,
        response_minutes,
        resolution_minutes
    INTO policy_record
    FROM public.sla_policies
    WHERE id = NEW.sla_policy_id
    FOR SHARE;

    IF NOT FOUND
       OR policy_record.policy_status <> 'approved'
       OR policy_record.effective_from > NEW.clock_started_at
       OR (
           policy_record.effective_until IS NOT NULL
           AND policy_record.effective_until <= NEW.clock_started_at
       ) THEN
        RAISE EXCEPTION
            'Deadline requires an approved SLA policy effective at clock start';
    END IF;

    IF NEW.deadline_type = 'first_response'
       AND policy_record.response_minutes IS NULL THEN
        RAISE EXCEPTION
            'SLA policy does not define a first-response duration';
    END IF;

    IF NEW.deadline_type = 'resolution'
       AND policy_record.resolution_minutes IS NULL THEN
        RAISE EXCEPTION
            'SLA policy does not define a resolution duration';
    END IF;

    IF NEW.case_bureau_assignment_id IS NOT NULL THEN
        SELECT case_id
        INTO assignment_case_id
        FROM public.case_bureau_assignments
        WHERE id = NEW.case_bureau_assignment_id
        FOR SHARE;

        IF assignment_case_id IS DISTINCT FROM NEW.case_id THEN
            RAISE EXCEPTION
                'Deadline bureau assignment belongs to another case';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_case_deadline"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_case_escalation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
    deadline_case_id UUID;
    linked_policy_id UUID;
    rule_policy_id UUID;
    rule_enabled BOOLEAN;
BEGIN
    IF NEW.case_deadline_id IS NOT NULL THEN
        SELECT case_id, sla_policy_id
        INTO deadline_case_id, linked_policy_id
        FROM public.case_deadlines
        WHERE id = NEW.case_deadline_id
        FOR SHARE;

        IF deadline_case_id IS DISTINCT FROM NEW.case_id THEN
            RAISE EXCEPTION
                'Escalation deadline belongs to another case';
        END IF;
    END IF;

    IF NEW.escalation_rule_id IS NOT NULL THEN
        SELECT sla_policy_id, is_active
        INTO rule_policy_id, rule_enabled
        FROM public.escalation_rules
        WHERE id = NEW.escalation_rule_id
        FOR SHARE;

        IF NEW.escalation_type = 'automatic'
           AND rule_enabled IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION
                'Automatic escalation requires an active rule';
        END IF;

        IF rule_policy_id IS NOT NULL THEN
            IF NEW.case_deadline_id IS NULL
               OR linked_policy_id IS DISTINCT FROM rule_policy_id THEN
                RAISE EXCEPTION
                    'Escalation rule SLA policy must match the deadline';
            END IF;
        END IF;
    ELSIF NEW.escalation_type = 'automatic' THEN
        RAISE EXCEPTION
            'Automatic escalation requires an escalation rule';
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_case_escalation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_case_transfer"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
    source_case_id UUID;
    destination_case_id UUID;
BEGIN
    IF NEW.from_bureau_assignment_id IS NOT NULL THEN

        SELECT case_id
        INTO source_case_id
        FROM public.case_bureau_assignments
        WHERE id = NEW.from_bureau_assignment_id
        FOR SHARE;

        IF source_case_id IS DISTINCT FROM NEW.case_id THEN
            RAISE EXCEPTION
                'Source bureau assignment belongs to another case';
        END IF;

    END IF;

    IF NEW.to_bureau_assignment_id IS NOT NULL THEN

        SELECT case_id
        INTO destination_case_id
        FROM public.case_bureau_assignments
        WHERE id = NEW.to_bureau_assignment_id
        FOR SHARE;

        IF destination_case_id IS DISTINCT FROM NEW.case_id THEN
            RAISE EXCEPTION
                'Destination bureau assignment belongs to another case';
        END IF;

    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_case_transfer"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_user_role_assignment"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
    required_scope TEXT;
    role_enabled BOOLEAN;
    user_enabled BOOLEAN;
    bureau_enabled BOOLEAN;
    has_active_membership BOOLEAN;
BEGIN
    SELECT scope_type, is_active
    INTO required_scope, role_enabled
    FROM public.roles
    WHERE id = NEW.role_id
    FOR SHARE;

    IF NOT FOUND OR role_enabled IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Role must exist and be active';
    END IF;

    IF required_scope = 'global'
       AND NEW.bureau_id IS NOT NULL THEN
        RAISE EXCEPTION
            'Global roles cannot have a bureau_id';
    END IF;

    IF required_scope = 'bureau'
       AND NEW.bureau_id IS NULL THEN
        RAISE EXCEPTION
            'Bureau-scoped roles require a bureau_id';
    END IF;

    IF NEW.assignment_status = 'active' THEN
        SELECT account_status = 'active'
        INTO user_enabled
        FROM public.users
        WHERE id = NEW.user_id
        FOR SHARE;

        IF user_enabled IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION
                'Active role assignments require an active user';
        END IF;

        IF NEW.bureau_id IS NOT NULL THEN
            SELECT is_active
            INTO bureau_enabled
            FROM public.bureaus
            WHERE id = NEW.bureau_id
            FOR SHARE;

            IF bureau_enabled IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION
                    'Bureau-scoped role requires an active bureau';
            END IF;

            SELECT EXISTS (
                SELECT 1
                FROM public.bureau_memberships
                WHERE user_id = NEW.user_id
                  AND bureau_id = NEW.bureau_id
                  AND membership_status = 'active'
            )
            INTO has_active_membership;

            IF has_active_membership IS DISTINCT FROM TRUE THEN
                RAISE EXCEPTION
                    'User must have active bureau membership';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_user_role_assignment"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "submission_id" "uuid",
    "case_id" "uuid",
    "uploaded_by_user_id" "uuid",
    "original_filename" "text" NOT NULL,
    "storage_bucket" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "file_size_bytes" bigint NOT NULL,
    "sha256_checksum" "text",
    "attachment_type" "text" DEFAULT 'supporting_document'::"text" NOT NULL,
    "upload_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "description" "text",
    "source_attachment_reference" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "verified_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "deleted_by_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "attachments_bucket_not_blank" CHECK (("length"("btrim"("storage_bucket")) > 0)),
    CONSTRAINT "attachments_checksum_check" CHECK ((("sha256_checksum" IS NULL) OR ("sha256_checksum" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "attachments_deletion_check" CHECK (((("deleted_at" IS NULL) AND ("deleted_by_user_id" IS NULL)) OR (("deleted_at" IS NOT NULL) AND ("deleted_by_user_id" IS NOT NULL) AND ("deleted_at" >= "created_at")))),
    CONSTRAINT "attachments_filename_not_blank" CHECK (("length"("btrim"("original_filename")) > 0)),
    CONSTRAINT "attachments_mime_not_blank" CHECK (("length"("btrim"("mime_type")) > 0)),
    CONSTRAINT "attachments_owner_check" CHECK (((("submission_id" IS NOT NULL) AND ("case_id" IS NULL)) OR (("submission_id" IS NULL) AND ("case_id" IS NOT NULL)))),
    CONSTRAINT "attachments_path_not_blank" CHECK (("length"("btrim"("storage_path")) > 0)),
    CONSTRAINT "attachments_size_check" CHECK (("file_size_bytes" >= 0)),
    CONSTRAINT "attachments_type_check" CHECK (("attachment_type" = ANY (ARRAY['original_submission'::"text", 'supporting_document'::"text", 'evidence'::"text", 'response'::"text", 'resolution_document'::"text"]))),
    CONSTRAINT "attachments_upload_status_check" CHECK (("upload_status" = ANY (ARRAY['pending'::"text", 'uploaded'::"text", 'verified'::"text", 'failed'::"text", 'quarantined'::"text"]))),
    CONSTRAINT "attachments_verification_check" CHECK ((("upload_status" <> 'verified'::"text") OR ("verified_at" IS NOT NULL)))
);


ALTER TABLE "public"."attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bureau_memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "bureau_id" "uuid" NOT NULL,
    "membership_type" "text" DEFAULT 'member'::"text" NOT NULL,
    "membership_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bureau_memberships_active_end_check" CHECK ((("membership_status" <> 'active'::"text") OR ("ended_at" IS NULL))),
    CONSTRAINT "bureau_memberships_dates_check" CHECK ((("ended_at" IS NULL) OR ("ended_at" >= "joined_at"))),
    CONSTRAINT "bureau_memberships_primary_check" CHECK ((("is_primary" = false) OR ("membership_status" = 'active'::"text"))),
    CONSTRAINT "bureau_memberships_status_check" CHECK (("membership_status" = ANY (ARRAY['active'::"text", 'inactive'::"text"]))),
    CONSTRAINT "bureau_memberships_type_check" CHECK (("membership_type" = ANY (ARRAY['member'::"text", 'coordinator'::"text", 'head'::"text"])))
);


ALTER TABLE "public"."bureau_memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bureaus" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "parent_bureau_id" "uuid",
    "bureau_type" "text" DEFAULT 'bureau'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bureaus_code_format" CHECK (("code" = "upper"("btrim"("code")))),
    CONSTRAINT "bureaus_code_not_blank" CHECK (("length"("btrim"("code")) > 0)),
    CONSTRAINT "bureaus_display_order_check" CHECK (("display_order" >= 0)),
    CONSTRAINT "bureaus_name_not_blank" CHECK (("length"("btrim"("name")) > 0)),
    CONSTRAINT "bureaus_no_self_parent" CHECK ((("parent_bureau_id" IS NULL) OR ("parent_bureau_id" <> "id"))),
    CONSTRAINT "bureaus_type_check" CHECK (("bureau_type" = ANY (ARRAY['bureau'::"text", 'cell'::"text", 'division'::"text", 'unit'::"text"])))
);


ALTER TABLE "public"."bureaus" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_access_grants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "grantee_user_id" "uuid" NOT NULL,
    "access_request_id" "uuid",
    "access_level" "text" DEFAULT 'details'::"text" NOT NULL,
    "grant_reason" "text" NOT NULL,
    "granted_by_user_id" "uuid" NOT NULL,
    "granted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "revoked_by_user_id" "uuid",
    "revoked_at" timestamp with time zone,
    "revocation_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_access_grants_expiry_check" CHECK ((("expires_at" IS NULL) OR ("expires_at" > "granted_at"))),
    CONSTRAINT "case_access_grants_level_check" CHECK (("access_level" = ANY (ARRAY['details'::"text", 'collaborate'::"text"]))),
    CONSTRAINT "case_access_grants_reason_check" CHECK (("length"("btrim"("grant_reason")) > 0)),
    CONSTRAINT "case_access_grants_revocation_check" CHECK (((("revoked_at" IS NULL) AND ("revoked_by_user_id" IS NULL)) OR (("revoked_at" IS NOT NULL) AND ("revoked_by_user_id" IS NOT NULL) AND ("revoked_at" >= "granted_at"))))
);


ALTER TABLE "public"."case_access_grants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_access_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "requester_user_id" "uuid" NOT NULL,
    "requesting_bureau_id" "uuid",
    "requested_access_level" "text" DEFAULT 'details'::"text" NOT NULL,
    "request_reason" "text" NOT NULL,
    "request_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_by_user_id" "uuid",
    "reviewed_at" timestamp with time zone,
    "decision_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_access_requests_decision_reason_check" CHECK ((("request_status" <> 'rejected'::"text") OR (("decision_reason" IS NOT NULL) AND ("length"("btrim"("decision_reason")) > 0)))),
    CONSTRAINT "case_access_requests_level_check" CHECK (("requested_access_level" = ANY (ARRAY['details'::"text", 'collaborate'::"text"]))),
    CONSTRAINT "case_access_requests_reason_check" CHECK (("length"("btrim"("request_reason")) > 0)),
    CONSTRAINT "case_access_requests_review_check" CHECK (((("request_status" = 'pending'::"text") AND ("reviewed_at" IS NULL) AND ("reviewed_by_user_id" IS NULL)) OR (("request_status" = ANY (ARRAY['approved'::"text", 'rejected'::"text"])) AND ("reviewed_at" IS NOT NULL) AND ("reviewed_by_user_id" IS NOT NULL) AND ("reviewed_at" >= "requested_at")) OR (("request_status" = 'cancelled'::"text") AND ("reviewed_at" IS NULL) AND ("reviewed_by_user_id" IS NULL)))),
    CONSTRAINT "case_access_requests_status_check" CHECK (("request_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."case_access_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_action_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "action_type" "text" NOT NULL,
    "action_description" "text" NOT NULL,
    "previous_status" "text",
    "new_status" "text",
    "related_submission_id" "uuid",
    "related_bureau_assignment_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_action_history_action_not_blank" CHECK (("length"("btrim"("action_type")) > 0)),
    CONSTRAINT "case_action_history_description_not_blank" CHECK (("length"("btrim"("action_description")) > 0)),
    CONSTRAINT "case_action_history_metadata_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text"))
);


ALTER TABLE "public"."case_action_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_bureau_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "bureau_id" "uuid" NOT NULL,
    "assignment_type" "text" DEFAULT 'collaborating'::"text" NOT NULL,
    "assignment_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "assigned_by_user_id" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_by_user_id" "uuid",
    "accepted_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "assignment_reason" "text",
    "completion_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_bureau_assignments_acceptance_check" CHECK (((("accepted_at" IS NULL) AND ("accepted_by_user_id" IS NULL)) OR (("accepted_at" IS NOT NULL) AND ("accepted_by_user_id" IS NOT NULL)))),
    CONSTRAINT "case_bureau_assignments_completion_check" CHECK (((("assignment_status" = 'completed'::"text") AND ("completed_at" IS NOT NULL)) OR (("assignment_status" <> 'completed'::"text") AND ("completed_at" IS NULL)))),
    CONSTRAINT "case_bureau_assignments_dates_check" CHECK (((("accepted_at" IS NULL) OR ("accepted_at" >= "assigned_at")) AND (("completed_at" IS NULL) OR ("completed_at" >= "assigned_at")))),
    CONSTRAINT "case_bureau_assignments_status_check" CHECK (("assignment_status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "case_bureau_assignments_type_check" CHECK (("assignment_type" = ANY (ARRAY['lead'::"text", 'collaborating'::"text"])))
);


ALTER TABLE "public"."case_bureau_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_deadlines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "sla_policy_id" "uuid" NOT NULL,
    "case_bureau_assignment_id" "uuid",
    "deadline_type" "text" NOT NULL,
    "clock_started_at" timestamp with time zone NOT NULL,
    "due_at" timestamp with time zone NOT NULL,
    "deadline_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "completed_at" timestamp with time zone,
    "paused_at" timestamp with time zone,
    "total_paused_seconds" bigint DEFAULT 0 NOT NULL,
    "breached_at" timestamp with time zone,
    "calculation_details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_deadlines_breach_check" CHECK ((("breached_at" IS NULL) OR ("breached_at" >= "due_at"))),
    CONSTRAINT "case_deadlines_calculation_check" CHECK (("jsonb_typeof"("calculation_details") = 'object'::"text")),
    CONSTRAINT "case_deadlines_completed_check" CHECK (((("deadline_status" = 'met'::"text") AND ("completed_at" IS NOT NULL)) OR (("deadline_status" <> 'met'::"text") AND ("completed_at" IS NULL)))),
    CONSTRAINT "case_deadlines_due_check" CHECK (("due_at" > "clock_started_at")),
    CONSTRAINT "case_deadlines_pause_state_check" CHECK (((("deadline_status" = 'paused'::"text") AND ("paused_at" IS NOT NULL)) OR (("deadline_status" <> 'paused'::"text") AND ("paused_at" IS NULL)))),
    CONSTRAINT "case_deadlines_pause_total_check" CHECK (("total_paused_seconds" >= 0)),
    CONSTRAINT "case_deadlines_status_check" CHECK (("deadline_status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'met'::"text", 'breached'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "case_deadlines_type_check" CHECK (("deadline_type" = ANY (ARRAY['first_response'::"text", 'resolution'::"text"])))
);


ALTER TABLE "public"."case_deadlines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_escalations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "case_deadline_id" "uuid",
    "escalation_rule_id" "uuid",
    "escalation_level" integer DEFAULT 1 NOT NULL,
    "escalation_type" "text" DEFAULT 'automatic'::"text" NOT NULL,
    "escalation_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reason" "text" NOT NULL,
    "target_bureau_id" "uuid",
    "target_user_id" "uuid",
    "initiated_by_user_id" "uuid",
    "initiated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "acknowledged_by_user_id" "uuid",
    "acknowledged_at" timestamp with time zone,
    "resolved_by_user_id" "uuid",
    "resolved_at" timestamp with time zone,
    "resolution_notes" "text",
    "event_key" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_escalations_acknowledgment_check" CHECK (((("acknowledged_at" IS NULL) AND ("acknowledged_by_user_id" IS NULL)) OR (("acknowledged_at" IS NOT NULL) AND ("acknowledged_by_user_id" IS NOT NULL) AND ("acknowledged_at" >= "initiated_at")))),
    CONSTRAINT "case_escalations_event_key_check" CHECK ((("event_key" IS NULL) OR ("length"("btrim"("event_key")) > 0))),
    CONSTRAINT "case_escalations_level_check" CHECK (("escalation_level" >= 1)),
    CONSTRAINT "case_escalations_metadata_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text")),
    CONSTRAINT "case_escalations_reason_check" CHECK (("length"("btrim"("reason")) > 0)),
    CONSTRAINT "case_escalations_resolution_check" CHECK (((("escalation_status" = 'resolved'::"text") AND ("resolved_at" IS NOT NULL) AND ("resolved_by_user_id" IS NOT NULL)) OR (("escalation_status" <> 'resolved'::"text") AND ("resolved_at" IS NULL) AND ("resolved_by_user_id" IS NULL)))),
    CONSTRAINT "case_escalations_resolution_time_check" CHECK ((("resolved_at" IS NULL) OR ("resolved_at" >= "initiated_at"))),
    CONSTRAINT "case_escalations_status_check" CHECK (("escalation_status" = ANY (ARRAY['pending'::"text", 'notified'::"text", 'acknowledged'::"text", 'resolved'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "case_escalations_target_check" CHECK ((("target_bureau_id" IS NOT NULL) OR ("target_user_id" IS NOT NULL))),
    CONSTRAINT "case_escalations_type_check" CHECK (("escalation_type" = ANY (ARRAY['automatic'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."case_escalations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "author_user_id" "uuid" NOT NULL,
    "bureau_id" "uuid",
    "note_text" "text" NOT NULL,
    "visibility" "text" DEFAULT 'bureau_private'::"text" NOT NULL,
    "note_type" "text" DEFAULT 'general'::"text" NOT NULL,
    "is_pinned" boolean DEFAULT false NOT NULL,
    "edited_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "deleted_by_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_notes_deletion_check" CHECK (((("deleted_at" IS NULL) AND ("deleted_by_user_id" IS NULL)) OR (("deleted_at" IS NOT NULL) AND ("deleted_by_user_id" IS NOT NULL) AND ("deleted_at" >= "created_at")))),
    CONSTRAINT "case_notes_edited_at_check" CHECK ((("edited_at" IS NULL) OR ("edited_at" >= "created_at"))),
    CONSTRAINT "case_notes_private_bureau_check" CHECK ((("visibility" <> 'bureau_private'::"text") OR ("bureau_id" IS NOT NULL))),
    CONSTRAINT "case_notes_text_not_blank" CHECK (("length"("btrim"("note_text")) > 0)),
    CONSTRAINT "case_notes_type_check" CHECK (("note_type" = ANY (ARRAY['general'::"text", 'internal_review'::"text", 'resolution'::"text", 'handover'::"text"]))),
    CONSTRAINT "case_notes_visibility_check" CHECK (("visibility" = ANY (ARRAY['shared'::"text", 'bureau_private'::"text"])))
);


ALTER TABLE "public"."case_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_officer_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_bureau_assignment_id" "uuid" NOT NULL,
    "officer_user_id" "uuid" NOT NULL,
    "assignment_role" "text" DEFAULT 'supporting'::"text" NOT NULL,
    "assignment_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "assigned_by_user_id" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "assignment_notes" "text",
    "completion_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_officer_assignments_dates_check" CHECK (((("accepted_at" IS NULL) OR ("accepted_at" >= "assigned_at")) AND (("completed_at" IS NULL) OR ("completed_at" >= "assigned_at")) AND (("revoked_at" IS NULL) OR ("revoked_at" >= "assigned_at")))),
    CONSTRAINT "case_officer_assignments_pending_check" CHECK ((("assignment_status" <> 'pending'::"text") OR ("accepted_at" IS NULL))),
    CONSTRAINT "case_officer_assignments_role_check" CHECK (("assignment_role" = ANY (ARRAY['lead_officer'::"text", 'supporting'::"text", 'reviewer'::"text"]))),
    CONSTRAINT "case_officer_assignments_status_check" CHECK (("assignment_status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'completed'::"text", 'revoked'::"text"]))),
    CONSTRAINT "case_officer_assignments_terminal_check" CHECK (((("assignment_status" = 'completed'::"text") AND ("completed_at" IS NOT NULL) AND ("revoked_at" IS NULL)) OR (("assignment_status" = 'revoked'::"text") AND ("revoked_at" IS NOT NULL) AND ("completed_at" IS NULL)) OR (("assignment_status" = ANY (ARRAY['pending'::"text", 'active'::"text"])) AND ("completed_at" IS NULL) AND ("revoked_at" IS NULL))))
);


ALTER TABLE "public"."case_officer_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_relationships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "related_case_id" "uuid" NOT NULL,
    "relationship_type" "text" NOT NULL,
    "description" "text",
    "created_by_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_relationships_no_self_link" CHECK (("case_id" <> "related_case_id")),
    CONSTRAINT "case_relationships_type_check" CHECK (("relationship_type" = ANY (ARRAY['related'::"text", 'same_institution'::"text", 'follow_up'::"text", 'dependency'::"text"])))
);


ALTER TABLE "public"."case_relationships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_statuses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "status_group" "text" NOT NULL,
    "is_terminal" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "is_system_status" boolean DEFAULT true NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_statuses_code_format" CHECK (("code" = "lower"("btrim"("code")))),
    CONSTRAINT "case_statuses_code_not_blank" CHECK (("length"("btrim"("code")) > 0)),
    CONSTRAINT "case_statuses_group_check" CHECK (("status_group" = ANY (ARRAY['open'::"text", 'working'::"text", 'waiting'::"text", 'resolved'::"text", 'closed'::"text"]))),
    CONSTRAINT "case_statuses_name_not_blank" CHECK (("length"("btrim"("name")) > 0)),
    CONSTRAINT "case_statuses_order_check" CHECK (("display_order" >= 0)),
    CONSTRAINT "case_statuses_terminal_check" CHECK ((("is_terminal" = false) OR ("status_group" = ANY (ARRAY['resolved'::"text", 'closed'::"text"]))))
);


ALTER TABLE "public"."case_statuses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_transfers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_id" "uuid" NOT NULL,
    "from_bureau_assignment_id" "uuid",
    "to_bureau_assignment_id" "uuid",
    "transfer_type" "text" DEFAULT 'handover'::"text" NOT NULL,
    "transfer_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "transfer_reason" "text" NOT NULL,
    "initiated_by_user_id" "uuid" NOT NULL,
    "initiated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "decided_by_user_id" "uuid",
    "decided_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "decision_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_transfers_assignment_required" CHECK ((("from_bureau_assignment_id" IS NOT NULL) OR ("to_bureau_assignment_id" IS NOT NULL))),
    CONSTRAINT "case_transfers_completion_check" CHECK (((("transfer_status" = 'completed'::"text") AND ("completed_at" IS NOT NULL) AND ("completed_at" >= "decided_at")) OR (("transfer_status" <> 'completed'::"text") AND ("completed_at" IS NULL)))),
    CONSTRAINT "case_transfers_decision_check" CHECK (((("transfer_status" = ANY (ARRAY['pending'::"text", 'cancelled'::"text"])) AND ("decided_by_user_id" IS NULL) AND ("decided_at" IS NULL)) OR (("transfer_status" = ANY (ARRAY['approved'::"text", 'rejected'::"text", 'completed'::"text"])) AND ("decided_by_user_id" IS NOT NULL) AND ("decided_at" IS NOT NULL) AND ("decided_at" >= "initiated_at")))),
    CONSTRAINT "case_transfers_distinct_assignments" CHECK ((("from_bureau_assignment_id" IS NULL) OR ("to_bureau_assignment_id" IS NULL) OR ("from_bureau_assignment_id" <> "to_bureau_assignment_id"))),
    CONSTRAINT "case_transfers_reason_check" CHECK (("length"("btrim"("transfer_reason")) > 0)),
    CONSTRAINT "case_transfers_status_check" CHECK (("transfer_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "case_transfers_type_check" CHECK (("transfer_type" = ANY (ARRAY['handover'::"text", 'lead_change'::"text", 'reassignment'::"text"])))
);


ALTER TABLE "public"."case_transfers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "case_number" "text" NOT NULL,
    "institution_id" "uuid" NOT NULL,
    "primary_category_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "visibility" "text" DEFAULT 'restricted'::"text" NOT NULL,
    "source_submission_id" "uuid" NOT NULL,
    "opened_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp with time zone,
    "created_by_user_id" "uuid",
    "updated_by_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cases_closed_at_check" CHECK (((("status" = 'closed'::"text") AND ("closed_at" IS NOT NULL)) OR (("status" <> 'closed'::"text") AND ("closed_at" IS NULL)))),
    CONSTRAINT "cases_description_not_blank" CHECK (("length"("btrim"("description")) > 0)),
    CONSTRAINT "cases_number_not_blank" CHECK (("length"("btrim"("case_number")) > 0)),
    CONSTRAINT "cases_opened_at_check" CHECK ((("closed_at" IS NULL) OR ("closed_at" >= "opened_at"))),
    CONSTRAINT "cases_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "cases_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'under_review'::"text", 'assigned'::"text", 'in_progress'::"text", 'awaiting_information'::"text", 'resolved'::"text", 'closed'::"text", 'reopened'::"text"]))),
    CONSTRAINT "cases_title_not_blank" CHECK (("length"("btrim"("title")) > 0)),
    CONSTRAINT "cases_visibility_check" CHECK (("visibility" = ANY (ARRAY['restricted'::"text", 'confidential'::"text"])))
);


ALTER TABLE "public"."cases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."complaint_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "parent_category_id" "uuid",
    "default_priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "complaint_categories_code_format" CHECK (("code" = "upper"("btrim"("code")))),
    CONSTRAINT "complaint_categories_code_not_blank" CHECK (("length"("btrim"("code")) > 0)),
    CONSTRAINT "complaint_categories_display_order_check" CHECK (("display_order" >= 0)),
    CONSTRAINT "complaint_categories_name_not_blank" CHECK (("length"("btrim"("name")) > 0)),
    CONSTRAINT "complaint_categories_no_self_parent" CHECK ((("parent_category_id" IS NULL) OR ("parent_category_id" <> "id"))),
    CONSTRAINT "complaint_categories_priority_check" CHECK (("default_priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."complaint_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."duplicate_candidates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "candidate_case_id" "uuid" NOT NULL,
    "similarity_score" numeric(5,4) NOT NULL,
    "matching_method" "text" DEFAULT 'hybrid'::"text" NOT NULL,
    "model_version" "text",
    "matching_signals" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "review_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reviewer_user_id" "uuid",
    "review_notes" "text",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "duplicate_candidates_method_check" CHECK (("matching_method" = ANY (ARRAY['text'::"text", 'semantic'::"text", 'rules'::"text", 'hybrid'::"text"]))),
    CONSTRAINT "duplicate_candidates_review_consistency" CHECK (((("review_status" = 'pending'::"text") AND ("reviewed_at" IS NULL)) OR (("review_status" <> 'pending'::"text") AND ("reviewed_at" IS NOT NULL) AND ("reviewer_user_id" IS NOT NULL)))),
    CONSTRAINT "duplicate_candidates_score_check" CHECK ((("similarity_score" >= (0)::numeric) AND ("similarity_score" <= (1)::numeric))),
    CONSTRAINT "duplicate_candidates_signals_check" CHECK (("jsonb_typeof"("matching_signals") = 'object'::"text")),
    CONSTRAINT "duplicate_candidates_status_check" CHECK (("review_status" = ANY (ARRAY['pending'::"text", 'confirmed_duplicate'::"text", 'not_duplicate'::"text", 'related'::"text"])))
);


ALTER TABLE "public"."duplicate_candidates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."escalation_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "sla_policy_id" "uuid",
    "bureau_id" "uuid",
    "trigger_type" "text" NOT NULL,
    "trigger_offset_minutes" integer DEFAULT 0 NOT NULL,
    "escalation_level" integer DEFAULT 1 NOT NULL,
    "target_type" "text" NOT NULL,
    "target_bureau_id" "uuid",
    "target_user_id" "uuid",
    "action_type" "text" DEFAULT 'notify'::"text" NOT NULL,
    "rule_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "authority_reference" "text",
    "approved_by_user_id" "uuid",
    "approved_at" timestamp with time zone,
    "is_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "escalation_rules_action_check" CHECK (("action_type" = ANY (ARRAY['notify'::"text", 'request_review'::"text", 'recommend_reassignment'::"text"]))),
    CONSTRAINT "escalation_rules_active_check" CHECK ((("is_active" = false) OR ("rule_status" = 'approved'::"text"))),
    CONSTRAINT "escalation_rules_approval_check" CHECK ((("rule_status" = 'draft'::"text") OR (("approved_by_user_id" IS NOT NULL) AND ("approved_at" IS NOT NULL) AND ("authority_reference" IS NOT NULL) AND ("length"("btrim"("authority_reference")) > 0)))),
    CONSTRAINT "escalation_rules_at_deadline_check" CHECK ((("trigger_type" <> 'at_deadline'::"text") OR ("trigger_offset_minutes" = 0))),
    CONSTRAINT "escalation_rules_code_check" CHECK ((("length"("btrim"("code")) > 0) AND ("code" = "upper"("btrim"("code"))))),
    CONSTRAINT "escalation_rules_level_check" CHECK (("escalation_level" >= 1)),
    CONSTRAINT "escalation_rules_name_check" CHECK (("length"("btrim"("name")) > 0)),
    CONSTRAINT "escalation_rules_offset_check" CHECK (("trigger_offset_minutes" >= 0)),
    CONSTRAINT "escalation_rules_status_check" CHECK (("rule_status" = ANY (ARRAY['draft'::"text", 'approved'::"text", 'retired'::"text"]))),
    CONSTRAINT "escalation_rules_target_check" CHECK (((("target_type" = 'user'::"text") AND ("target_user_id" IS NOT NULL) AND ("target_bureau_id" IS NULL)) OR (("target_type" = 'bureau'::"text") AND ("target_bureau_id" IS NOT NULL) AND ("target_user_id" IS NULL)))),
    CONSTRAINT "escalation_rules_target_type_check" CHECK (("target_type" = ANY (ARRAY['user'::"text", 'bureau'::"text"]))),
    CONSTRAINT "escalation_rules_trigger_check" CHECK (("trigger_type" = ANY (ARRAY['before_deadline'::"text", 'at_deadline'::"text", 'after_deadline'::"text"])))
);


ALTER TABLE "public"."escalation_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."institution_aliases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "institution_id" "uuid" NOT NULL,
    "alias_name" "text" NOT NULL,
    "normalized_alias" "text" NOT NULL,
    "language_code" "text" DEFAULT 'en'::"text" NOT NULL,
    "alias_type" "text" DEFAULT 'alternate_name'::"text" NOT NULL,
    "source_type" "text" DEFAULT 'manual'::"text" NOT NULL,
    "source_reference" "text",
    "verification_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "institution_aliases_language_not_blank" CHECK (("length"("btrim"("language_code")) > 0)),
    CONSTRAINT "institution_aliases_name_not_blank" CHECK (("length"("btrim"("alias_name")) > 0)),
    CONSTRAINT "institution_aliases_normalized_format" CHECK (("normalized_alias" = "lower"("btrim"("normalized_alias")))),
    CONSTRAINT "institution_aliases_normalized_not_blank" CHECK (("length"("btrim"("normalized_alias")) > 0)),
    CONSTRAINT "institution_aliases_source_check" CHECK (("source_type" = ANY (ARRAY['manual'::"text", 'official_record'::"text", 'complaint_submission'::"text", 'import'::"text"]))),
    CONSTRAINT "institution_aliases_type_check" CHECK (("alias_type" = ANY (ARRAY['alternate_name'::"text", 'former_name'::"text", 'abbreviation'::"text", 'spelling_variant'::"text", 'submitted_name'::"text"]))),
    CONSTRAINT "institution_aliases_verification_check" CHECK (("verification_status" = ANY (ARRAY['pending'::"text", 'verified'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."institution_aliases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."institution_verification_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "candidate_institution_id" "uuid",
    "submitted_institution_name" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "resolution_notes" "text",
    "assigned_to_user_id" "uuid",
    "reviewed_by_user_id" "uuid",
    "resolved_institution_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    CONSTRAINT "institution_verification_name_check" CHECK (("length"("btrim"("submitted_institution_name")) > 0)),
    CONSTRAINT "institution_verification_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "institution_verification_resolution_check" CHECK (((("status" = ANY (ARRAY['pending'::"text", 'in_review'::"text"])) AND ("resolved_at" IS NULL) AND ("resolved_institution_id" IS NULL)) OR (("status" = 'verified'::"text") AND ("resolved_at" IS NOT NULL) AND ("resolved_institution_id" IS NOT NULL)) OR (("status" = 'rejected'::"text") AND ("resolved_at" IS NOT NULL) AND ("resolved_institution_id" IS NULL)))),
    CONSTRAINT "institution_verification_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_review'::"text", 'verified'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."institution_verification_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."institutions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "aicte_permanent_id" "text",
    "official_name" "text" NOT NULL,
    "normalized_name" "text",
    "institution_type" "text",
    "ownership_type" "text",
    "address_line1" "text",
    "address_line2" "text",
    "city" "text",
    "district" "text",
    "state_name" "text",
    "postal_code" "text",
    "region_id" "uuid",
    "contact_email" "text",
    "contact_phone" "text",
    "website_url" "text",
    "verification_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "verification_source" "text",
    "verification_reference" "text",
    "verified_by_user_id" "uuid",
    "verified_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "institutions_email_format_check" CHECK ((("contact_email" IS NULL) OR ("contact_email" ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'::"text"))),
    CONSTRAINT "institutions_name_not_blank" CHECK (("length"("btrim"("official_name")) > 0)),
    CONSTRAINT "institutions_permanent_id_not_blank" CHECK ((("aicte_permanent_id" IS NULL) OR ("length"("btrim"("aicte_permanent_id")) > 0))),
    CONSTRAINT "institutions_postal_code_check" CHECK ((("postal_code" IS NULL) OR ("postal_code" ~ '^[0-9]{6}$'::"text"))),
    CONSTRAINT "institutions_verification_status_check" CHECK (("verification_status" = ANY (ARRAY['pending'::"text", 'verified'::"text", 'rejected'::"text"]))),
    CONSTRAINT "institutions_verified_at_check" CHECK ((("verified_at" IS NULL) OR ("verification_status" = 'verified'::"text"))),
    CONSTRAINT "institutions_verified_identity_check" CHECK ((("verification_status" <> 'verified'::"text") OR (("aicte_permanent_id" IS NOT NULL) AND ("verification_source" IS NOT NULL) AND ("length"("btrim"("verification_source")) > 0) AND ("verified_at" IS NOT NULL))))
);


ALTER TABLE "public"."institutions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."intake_channels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "channel_type" "text" NOT NULL,
    "is_simulated" boolean DEFAULT true NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "requires_external_reference" boolean DEFAULT false NOT NULL,
    "configuration_reference" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "intake_channels_code_format" CHECK (("code" = "upper"("btrim"("code")))),
    CONSTRAINT "intake_channels_code_not_blank" CHECK (("length"("btrim"("code")) > 0)),
    CONSTRAINT "intake_channels_name_not_blank" CHECK (("length"("btrim"("name")) > 0)),
    CONSTRAINT "intake_channels_type_check" CHECK (("channel_type" = ANY (ARRAY['portal'::"text", 'cpgrams'::"text", 'email'::"text", 'manual'::"text", 'api'::"text"])))
);


ALTER TABLE "public"."intake_channels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "recipient_scope" "text" NOT NULL,
    "channel" "text" DEFAULT 'in_app'::"text" NOT NULL,
    "template_reference" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_rules_channel_check" CHECK (("channel" = ANY (ARRAY['in_app'::"text", 'email'::"text", 'sms'::"text"]))),
    CONSTRAINT "notification_rules_code_check" CHECK (("length"("btrim"("code")) > 0)),
    CONSTRAINT "notification_rules_event_check" CHECK (("length"("btrim"("event_type")) > 0)),
    CONSTRAINT "notification_rules_recipient_check" CHECK (("length"("btrim"("recipient_scope")) > 0))
);


ALTER TABLE "public"."notification_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "notification_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "notification_status" "text" DEFAULT 'unread'::"text" NOT NULL,
    "case_id" "uuid",
    "case_action_history_id" "uuid",
    "case_escalation_id" "uuid",
    "source_event_key" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone,
    "archived_at" timestamp with time zone,
    CONSTRAINT "notifications_archive_time_check" CHECK ((("archived_at" IS NULL) OR ("archived_at" >= "created_at"))),
    CONSTRAINT "notifications_event_key_check" CHECK ((("source_event_key" IS NULL) OR ("length"("btrim"("source_event_key")) > 0))),
    CONSTRAINT "notifications_message_check" CHECK (("length"("btrim"("message")) > 0)),
    CONSTRAINT "notifications_metadata_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text")),
    CONSTRAINT "notifications_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "notifications_read_state_check" CHECK (((("notification_status" = 'unread'::"text") AND ("read_at" IS NULL) AND ("archived_at" IS NULL)) OR (("notification_status" = 'read'::"text") AND ("read_at" IS NOT NULL) AND ("archived_at" IS NULL)) OR (("notification_status" = 'archived'::"text") AND ("archived_at" IS NOT NULL)))),
    CONSTRAINT "notifications_read_time_check" CHECK ((("read_at" IS NULL) OR ("read_at" >= "created_at"))),
    CONSTRAINT "notifications_status_check" CHECK (("notification_status" = ANY (ARRAY['unread'::"text", 'read'::"text", 'archived'::"text"]))),
    CONSTRAINT "notifications_title_check" CHECK (("length"("btrim"("title")) > 0)),
    CONSTRAINT "notifications_type_check" CHECK (("notification_type" = ANY (ARRAY['case_assigned'::"text", 'case_updated'::"text", 'case_transferred'::"text", 'case_access_requested'::"text", 'case_access_approved'::"text", 'case_access_rejected'::"text", 'deadline_approaching'::"text", 'deadline_breached'::"text", 'case_escalated'::"text", 'institution_verification'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "resource_type" "text" NOT NULL,
    "action_type" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "permissions_action_not_blank" CHECK (("length"("btrim"("action_type")) > 0)),
    CONSTRAINT "permissions_code_format" CHECK (("code" = "upper"("btrim"("code")))),
    CONSTRAINT "permissions_code_not_blank" CHECK (("length"("btrim"("code")) > 0)),
    CONSTRAINT "permissions_name_not_blank" CHECK (("length"("btrim"("name")) > 0)),
    CONSTRAINT "permissions_resource_not_blank" CHECK (("length"("btrim"("resource_type")) > 0))
);


ALTER TABLE "public"."permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."regions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "regions_code_format" CHECK (("code" = "upper"("btrim"("code")))),
    CONSTRAINT "regions_code_not_blank" CHECK (("length"("btrim"("code")) > 0)),
    CONSTRAINT "regions_name_not_blank" CHECK (("length"("btrim"("name")) > 0))
);


ALTER TABLE "public"."regions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "role_id" "uuid" NOT NULL,
    "permission_id" "uuid" NOT NULL,
    "granted_by_user_id" "uuid",
    "granted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "scope_type" "text" DEFAULT 'global'::"text" NOT NULL,
    "is_system_role" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "roles_code_format" CHECK (("code" = "upper"("btrim"("code")))),
    CONSTRAINT "roles_code_not_blank" CHECK (("length"("btrim"("code")) > 0)),
    CONSTRAINT "roles_name_not_blank" CHECK (("length"("btrim"("name")) > 0)),
    CONSTRAINT "roles_scope_check" CHECK (("scope_type" = ANY (ARRAY['global'::"text", 'bureau'::"text"])))
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sla_policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "version_number" integer DEFAULT 1 NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "category_id" "uuid",
    "bureau_id" "uuid",
    "priority" "text",
    "policy_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "response_minutes" integer,
    "resolution_minutes" integer,
    "clock_type" "text" DEFAULT 'calendar'::"text" NOT NULL,
    "pause_on_awaiting_information" boolean DEFAULT false NOT NULL,
    "effective_from" timestamp with time zone,
    "effective_until" timestamp with time zone,
    "authority_name" "text",
    "authority_reference" "text",
    "authority_document_url" "text",
    "approved_by_user_id" "uuid",
    "approved_at" timestamp with time zone,
    "created_by_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sla_policies_approval_check" CHECK ((("policy_status" = 'draft'::"text") OR (("approved_by_user_id" IS NOT NULL) AND ("approved_at" IS NOT NULL) AND ("effective_from" IS NOT NULL) AND ("authority_name" IS NOT NULL) AND ("length"("btrim"("authority_name")) > 0) AND ("authority_reference" IS NOT NULL) AND ("length"("btrim"("authority_reference")) > 0)))),
    CONSTRAINT "sla_policies_clock_check" CHECK (("clock_type" = ANY (ARRAY['calendar'::"text", 'business'::"text"]))),
    CONSTRAINT "sla_policies_code_check" CHECK ((("length"("btrim"("code")) > 0) AND ("code" = "upper"("btrim"("code"))))),
    CONSTRAINT "sla_policies_duration_check" CHECK ((("response_minutes" IS NOT NULL) OR ("resolution_minutes" IS NOT NULL))),
    CONSTRAINT "sla_policies_effective_dates_check" CHECK ((("effective_until" IS NULL) OR (("effective_from" IS NOT NULL) AND ("effective_until" > "effective_from")))),
    CONSTRAINT "sla_policies_name_check" CHECK (("length"("btrim"("name")) > 0)),
    CONSTRAINT "sla_policies_priority_check" CHECK ((("priority" IS NULL) OR ("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'critical'::"text"])))),
    CONSTRAINT "sla_policies_resolution_check" CHECK ((("resolution_minutes" IS NULL) OR ("resolution_minutes" > 0))),
    CONSTRAINT "sla_policies_response_check" CHECK ((("response_minutes" IS NULL) OR ("response_minutes" > 0))),
    CONSTRAINT "sla_policies_status_check" CHECK (("policy_status" = ANY (ARRAY['draft'::"text", 'approved'::"text", 'retired'::"text"]))),
    CONSTRAINT "sla_policies_version_check" CHECK (("version_number" >= 1))
);


ALTER TABLE "public"."sla_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "intake_channel_id" "uuid" NOT NULL,
    "external_reference" "text",
    "source_event_id" "text",
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "institution_id" "uuid",
    "institution_name_as_submitted" "text",
    "category_id" "uuid",
    "subject" "text" NOT NULL,
    "original_text" "text" NOT NULL,
    "original_language" "text" DEFAULT 'en'::"text" NOT NULL,
    "normalized_text" "text",
    "normalization_version" "text",
    "submitter_reference" "text",
    "intake_status" "text" DEFAULT 'received'::"text" NOT NULL,
    "source_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "content_fingerprint" "text",
    "idempotency_key" "text",
    "canonical_case_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "submissions_case_status_consistency" CHECK ((("intake_status" <> 'associated_with_case'::"text") OR ("canonical_case_id" IS NOT NULL))),
    CONSTRAINT "submissions_external_reference_not_blank" CHECK ((("external_reference" IS NULL) OR ("length"("btrim"("external_reference")) > 0))),
    CONSTRAINT "submissions_language_not_blank" CHECK (("length"("btrim"("original_language")) > 0)),
    CONSTRAINT "submissions_source_event_not_blank" CHECK ((("source_event_id" IS NULL) OR ("length"("btrim"("source_event_id")) > 0))),
    CONSTRAINT "submissions_source_metadata_object" CHECK (("jsonb_typeof"("source_metadata") = 'object'::"text")),
    CONSTRAINT "submissions_status_check" CHECK (("intake_status" = ANY (ARRAY['received'::"text", 'awaiting_institution_verification'::"text", 'awaiting_duplicate_review'::"text", 'ready_for_case_creation'::"text", 'associated_with_case'::"text", 'rejected'::"text"]))),
    CONSTRAINT "submissions_subject_not_blank" CHECK (("length"("btrim"("subject")) > 0)),
    CONSTRAINT "submissions_text_not_blank" CHECK (("length"("btrim"("original_text")) > 0))
);


ALTER TABLE "public"."submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_role_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "bureau_id" "uuid",
    "assignment_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "assigned_by_user_id" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "revocation_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_role_assignments_expiry_check" CHECK ((("expires_at" IS NULL) OR ("expires_at" > "assigned_at"))),
    CONSTRAINT "user_role_assignments_revocation_check" CHECK (((("assignment_status" = 'revoked'::"text") AND ("revoked_at" IS NOT NULL)) OR (("assignment_status" <> 'revoked'::"text") AND ("revoked_at" IS NULL)))),
    CONSTRAINT "user_role_assignments_revocation_time_check" CHECK ((("revoked_at" IS NULL) OR ("revoked_at" >= "assigned_at"))),
    CONSTRAINT "user_role_assignments_status_check" CHECK (("assignment_status" = ANY (ARRAY['active'::"text", 'revoked'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."user_role_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "employee_code" "text",
    "full_name" "text" NOT NULL,
    "display_name" "text",
    "official_email" "text" NOT NULL,
    "phone_number" "text",
    "designation" "text",
    "account_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "is_super_admin" boolean DEFAULT false NOT NULL,
    "last_seen_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "users_email_format_check" CHECK (("official_email" ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'::"text")),
    CONSTRAINT "users_email_not_blank" CHECK (("length"("btrim"("official_email")) > 0)),
    CONSTRAINT "users_employee_code_not_blank" CHECK ((("employee_code" IS NULL) OR ("length"("btrim"("employee_code")) > 0))),
    CONSTRAINT "users_full_name_not_blank" CHECK (("length"("btrim"("full_name")) > 0)),
    CONSTRAINT "users_status_check" CHECK (("account_status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'suspended'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bureau_memberships"
    ADD CONSTRAINT "bureau_memberships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bureaus"
    ADD CONSTRAINT "bureaus_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_access_grants"
    ADD CONSTRAINT "case_access_grants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_access_requests"
    ADD CONSTRAINT "case_access_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_action_history"
    ADD CONSTRAINT "case_action_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_bureau_assignments"
    ADD CONSTRAINT "case_bureau_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_deadlines"
    ADD CONSTRAINT "case_deadlines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_escalations"
    ADD CONSTRAINT "case_escalations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_notes"
    ADD CONSTRAINT "case_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_officer_assignments"
    ADD CONSTRAINT "case_officer_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_relationships"
    ADD CONSTRAINT "case_relationships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_relationships"
    ADD CONSTRAINT "case_relationships_unique_pair" UNIQUE ("case_id", "related_case_id", "relationship_type");



ALTER TABLE ONLY "public"."case_statuses"
    ADD CONSTRAINT "case_statuses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_transfers"
    ADD CONSTRAINT "case_transfers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_case_number_key" UNIQUE ("case_number");



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."complaint_categories"
    ADD CONSTRAINT "complaint_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."duplicate_candidates"
    ADD CONSTRAINT "duplicate_candidates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."duplicate_candidates"
    ADD CONSTRAINT "duplicate_candidates_unique_pair" UNIQUE ("submission_id", "candidate_case_id");



ALTER TABLE ONLY "public"."escalation_rules"
    ADD CONSTRAINT "escalation_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."institution_aliases"
    ADD CONSTRAINT "institution_aliases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."institution_verification_tasks"
    ADD CONSTRAINT "institution_verification_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."institutions"
    ADD CONSTRAINT "institutions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."intake_channels"
    ADD CONSTRAINT "intake_channels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_rules"
    ADD CONSTRAINT "notification_rules_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."notification_rules"
    ADD CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."regions"
    ADD CONSTRAINT "regions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_unique_pair" UNIQUE ("role_id", "permission_id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sla_policies"
    ADD CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sla_policies"
    ADD CONSTRAINT "sla_policies_unique_version" UNIQUE ("code", "version_number");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_role_assignments"
    ADD CONSTRAINT "user_role_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "attachments_case_idx" ON "public"."attachments" USING "btree" ("case_id", "created_at" DESC) WHERE (("case_id" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "attachments_checksum_idx" ON "public"."attachments" USING "btree" ("sha256_checksum") WHERE ("sha256_checksum" IS NOT NULL);



CREATE UNIQUE INDEX "attachments_storage_object_uq" ON "public"."attachments" USING "btree" ("storage_bucket", "storage_path");



CREATE INDEX "attachments_submission_idx" ON "public"."attachments" USING "btree" ("submission_id", "created_at" DESC) WHERE (("submission_id" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "attachments_upload_status_idx" ON "public"."attachments" USING "btree" ("upload_status", "created_at") WHERE ("upload_status" <> 'verified'::"text");



CREATE INDEX "attachments_uploaded_by_idx" ON "public"."attachments" USING "btree" ("uploaded_by_user_id") WHERE ("uploaded_by_user_id" IS NOT NULL);



CREATE INDEX "bureau_memberships_active_bureau_idx" ON "public"."bureau_memberships" USING "btree" ("bureau_id", "user_id") WHERE ("membership_status" = 'active'::"text");



CREATE UNIQUE INDEX "bureau_memberships_active_pair_uq" ON "public"."bureau_memberships" USING "btree" ("user_id", "bureau_id") WHERE ("membership_status" = 'active'::"text");



CREATE INDEX "bureau_memberships_bureau_idx" ON "public"."bureau_memberships" USING "btree" ("bureau_id");



CREATE UNIQUE INDEX "bureau_memberships_primary_user_uq" ON "public"."bureau_memberships" USING "btree" ("user_id") WHERE (("is_primary" = true) AND ("membership_status" = 'active'::"text"));



CREATE INDEX "bureau_memberships_user_idx" ON "public"."bureau_memberships" USING "btree" ("user_id");



CREATE INDEX "bureaus_active_name_idx" ON "public"."bureaus" USING "btree" ("display_order", "name") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "bureaus_code_uq" ON "public"."bureaus" USING "btree" ("code");



CREATE INDEX "bureaus_parent_idx" ON "public"."bureaus" USING "btree" ("parent_bureau_id");



CREATE INDEX "case_access_grants_case_idx" ON "public"."case_access_grants" USING "btree" ("case_id", "grantee_user_id");



CREATE INDEX "case_access_grants_expiry_idx" ON "public"."case_access_grants" USING "btree" ("expires_at") WHERE (("expires_at" IS NOT NULL) AND ("revoked_at" IS NULL));



CREATE INDEX "case_access_grants_grantee_idx" ON "public"."case_access_grants" USING "btree" ("grantee_user_id", "granted_at" DESC);



CREATE UNIQUE INDEX "case_access_grants_request_uq" ON "public"."case_access_grants" USING "btree" ("access_request_id") WHERE ("access_request_id" IS NOT NULL);



CREATE INDEX "case_access_grants_unrevoked_idx" ON "public"."case_access_grants" USING "btree" ("grantee_user_id", "case_id", "expires_at") WHERE ("revoked_at" IS NULL);



CREATE INDEX "case_access_requests_case_idx" ON "public"."case_access_requests" USING "btree" ("case_id", "requested_at" DESC);



CREATE INDEX "case_access_requests_pending_queue_idx" ON "public"."case_access_requests" USING "btree" ("requested_at") WHERE ("request_status" = 'pending'::"text");



CREATE UNIQUE INDEX "case_access_requests_pending_uq" ON "public"."case_access_requests" USING "btree" ("case_id", "requester_user_id", "requested_access_level", "requesting_bureau_id") NULLS NOT DISTINCT WHERE ("request_status" = 'pending'::"text");



CREATE INDEX "case_access_requests_requester_idx" ON "public"."case_access_requests" USING "btree" ("requester_user_id", "requested_at" DESC);



CREATE INDEX "case_access_requests_reviewer_idx" ON "public"."case_access_requests" USING "btree" ("reviewed_by_user_id") WHERE ("reviewed_by_user_id" IS NOT NULL);



CREATE INDEX "case_action_history_action_idx" ON "public"."case_action_history" USING "btree" ("action_type", "occurred_at" DESC);



CREATE INDEX "case_action_history_actor_idx" ON "public"."case_action_history" USING "btree" ("actor_user_id", "occurred_at" DESC);



CREATE INDEX "case_action_history_case_time_idx" ON "public"."case_action_history" USING "btree" ("case_id", "occurred_at" DESC, "id");



CREATE INDEX "case_action_history_submission_idx" ON "public"."case_action_history" USING "btree" ("related_submission_id") WHERE ("related_submission_id" IS NOT NULL);



CREATE INDEX "case_bureau_assignments_bureau_idx" ON "public"."case_bureau_assignments" USING "btree" ("bureau_id", "assignment_status", "assigned_at" DESC);



CREATE INDEX "case_bureau_assignments_case_idx" ON "public"."case_bureau_assignments" USING "btree" ("case_id");



CREATE UNIQUE INDEX "case_bureau_assignments_open_lead_uq" ON "public"."case_bureau_assignments" USING "btree" ("case_id") WHERE (("assignment_type" = 'lead'::"text") AND ("assignment_status" = ANY (ARRAY['pending'::"text", 'active'::"text"])));



CREATE UNIQUE INDEX "case_bureau_assignments_open_pair_uq" ON "public"."case_bureau_assignments" USING "btree" ("case_id", "bureau_id") WHERE ("assignment_status" = ANY (ARRAY['pending'::"text", 'active'::"text"]));



CREATE INDEX "case_bureau_assignments_pending_idx" ON "public"."case_bureau_assignments" USING "btree" ("assigned_at") WHERE ("assignment_status" = 'pending'::"text");



CREATE INDEX "case_deadlines_breached_idx" ON "public"."case_deadlines" USING "btree" ("breached_at" DESC) WHERE ("breached_at" IS NOT NULL);



CREATE INDEX "case_deadlines_bureau_assignment_idx" ON "public"."case_deadlines" USING "btree" ("case_bureau_assignment_id") WHERE ("case_bureau_assignment_id" IS NOT NULL);



CREATE INDEX "case_deadlines_case_idx" ON "public"."case_deadlines" USING "btree" ("case_id", "created_at" DESC);



CREATE INDEX "case_deadlines_due_queue_idx" ON "public"."case_deadlines" USING "btree" ("due_at") WHERE ("deadline_status" = 'active'::"text");



CREATE UNIQUE INDEX "case_deadlines_open_scope_uq" ON "public"."case_deadlines" USING "btree" ("case_id", "deadline_type", "case_bureau_assignment_id") NULLS NOT DISTINCT WHERE ("deadline_status" = ANY (ARRAY['active'::"text", 'paused'::"text"]));



CREATE INDEX "case_deadlines_policy_idx" ON "public"."case_deadlines" USING "btree" ("sla_policy_id");



CREATE INDEX "case_escalations_case_idx" ON "public"."case_escalations" USING "btree" ("case_id", "initiated_at" DESC);



CREATE INDEX "case_escalations_deadline_idx" ON "public"."case_escalations" USING "btree" ("case_deadline_id") WHERE ("case_deadline_id" IS NOT NULL);



CREATE UNIQUE INDEX "case_escalations_event_key_uq" ON "public"."case_escalations" USING "btree" ("event_key") WHERE ("event_key" IS NOT NULL);



CREATE INDEX "case_escalations_pending_idx" ON "public"."case_escalations" USING "btree" ("initiated_at") WHERE ("escalation_status" = ANY (ARRAY['pending'::"text", 'notified'::"text", 'acknowledged'::"text"]));



CREATE INDEX "case_escalations_rule_idx" ON "public"."case_escalations" USING "btree" ("escalation_rule_id") WHERE ("escalation_rule_id" IS NOT NULL);



CREATE INDEX "case_escalations_target_bureau_idx" ON "public"."case_escalations" USING "btree" ("target_bureau_id", "escalation_status") WHERE ("target_bureau_id" IS NOT NULL);



CREATE INDEX "case_escalations_target_user_idx" ON "public"."case_escalations" USING "btree" ("target_user_id", "escalation_status") WHERE ("target_user_id" IS NOT NULL);



CREATE INDEX "case_notes_author_idx" ON "public"."case_notes" USING "btree" ("author_user_id", "created_at" DESC);



CREATE INDEX "case_notes_case_time_idx" ON "public"."case_notes" USING "btree" ("case_id", "created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "case_notes_pinned_idx" ON "public"."case_notes" USING "btree" ("case_id", "created_at" DESC) WHERE (("is_pinned" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "case_notes_private_bureau_idx" ON "public"."case_notes" USING "btree" ("bureau_id", "case_id", "created_at" DESC) WHERE (("visibility" = 'bureau_private'::"text") AND ("deleted_at" IS NULL));



CREATE INDEX "case_officer_assignments_bureau_assignment_idx" ON "public"."case_officer_assignments" USING "btree" ("case_bureau_assignment_id", "assigned_at" DESC);



CREATE INDEX "case_officer_assignments_officer_idx" ON "public"."case_officer_assignments" USING "btree" ("officer_user_id", "assignment_status", "assigned_at" DESC);



CREATE UNIQUE INDEX "case_officer_assignments_open_lead_uq" ON "public"."case_officer_assignments" USING "btree" ("case_bureau_assignment_id") WHERE (("assignment_role" = 'lead_officer'::"text") AND ("assignment_status" = ANY (ARRAY['pending'::"text", 'active'::"text"])));



CREATE UNIQUE INDEX "case_officer_assignments_open_pair_uq" ON "public"."case_officer_assignments" USING "btree" ("case_bureau_assignment_id", "officer_user_id") WHERE ("assignment_status" = ANY (ARRAY['pending'::"text", 'active'::"text"]));



CREATE INDEX "case_relationships_case_idx" ON "public"."case_relationships" USING "btree" ("case_id");



CREATE INDEX "case_relationships_related_idx" ON "public"."case_relationships" USING "btree" ("related_case_id");



CREATE INDEX "case_relationships_type_idx" ON "public"."case_relationships" USING "btree" ("relationship_type");



CREATE INDEX "case_statuses_active_order_idx" ON "public"."case_statuses" USING "btree" ("display_order", "name") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "case_statuses_code_uq" ON "public"."case_statuses" USING "btree" ("code");



CREATE INDEX "case_statuses_group_idx" ON "public"."case_statuses" USING "btree" ("status_group");



CREATE INDEX "case_transfers_case_idx" ON "public"."case_transfers" USING "btree" ("case_id", "initiated_at" DESC);



CREATE INDEX "case_transfers_from_assignment_idx" ON "public"."case_transfers" USING "btree" ("from_bureau_assignment_id");



CREATE INDEX "case_transfers_initiator_idx" ON "public"."case_transfers" USING "btree" ("initiated_by_user_id");



CREATE INDEX "case_transfers_pending_idx" ON "public"."case_transfers" USING "btree" ("initiated_at") WHERE ("transfer_status" = 'pending'::"text");



CREATE INDEX "case_transfers_to_assignment_idx" ON "public"."case_transfers" USING "btree" ("to_bureau_assignment_id");



CREATE INDEX "cases_active_idx" ON "public"."cases" USING "btree" ("institution_id", "status") WHERE ("status" <> ALL (ARRAY['resolved'::"text", 'closed'::"text"]));



CREATE INDEX "cases_category_idx" ON "public"."cases" USING "btree" ("primary_category_id");



CREATE INDEX "cases_institution_idx" ON "public"."cases" USING "btree" ("institution_id", "created_at" DESC);



CREATE INDEX "cases_opened_idx" ON "public"."cases" USING "btree" ("opened_at" DESC);



CREATE INDEX "cases_priority_idx" ON "public"."cases" USING "btree" ("priority", "created_at" DESC);



CREATE INDEX "cases_source_submission_idx" ON "public"."cases" USING "btree" ("source_submission_id");



CREATE INDEX "cases_status_idx" ON "public"."cases" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "complaint_categories_active_order_idx" ON "public"."complaint_categories" USING "btree" ("display_order", "name") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "complaint_categories_code_uq" ON "public"."complaint_categories" USING "btree" ("code");



CREATE INDEX "complaint_categories_parent_idx" ON "public"."complaint_categories" USING "btree" ("parent_category_id");



CREATE INDEX "duplicate_candidates_case_idx" ON "public"."duplicate_candidates" USING "btree" ("candidate_case_id");



CREATE INDEX "duplicate_candidates_high_confidence_idx" ON "public"."duplicate_candidates" USING "btree" ("created_at" DESC) WHERE (("similarity_score" >= 0.9000) AND ("review_status" = 'pending'::"text"));



CREATE INDEX "duplicate_candidates_review_queue_idx" ON "public"."duplicate_candidates" USING "btree" ("similarity_score" DESC, "created_at") WHERE ("review_status" = 'pending'::"text");



CREATE INDEX "duplicate_candidates_submission_idx" ON "public"."duplicate_candidates" USING "btree" ("submission_id");



CREATE INDEX "escalation_rules_active_trigger_idx" ON "public"."escalation_rules" USING "btree" ("trigger_type", "escalation_level") WHERE ("is_active" = true);



CREATE INDEX "escalation_rules_bureau_idx" ON "public"."escalation_rules" USING "btree" ("bureau_id") WHERE ("bureau_id" IS NOT NULL);



CREATE UNIQUE INDEX "escalation_rules_code_uq" ON "public"."escalation_rules" USING "btree" ("code");



CREATE INDEX "escalation_rules_policy_idx" ON "public"."escalation_rules" USING "btree" ("sla_policy_id") WHERE ("sla_policy_id" IS NOT NULL);



CREATE INDEX "idx_notification_rules_event" ON "public"."notification_rules" USING "btree" ("event_type") WHERE ("is_active" = true);



CREATE INDEX "institution_aliases_institution_idx" ON "public"."institution_aliases" USING "btree" ("institution_id");



CREATE INDEX "institution_aliases_normalized_lookup_idx" ON "public"."institution_aliases" USING "btree" ("normalized_alias") WHERE (("is_active" = true) AND ("verification_status" = 'verified'::"text"));



CREATE INDEX "institution_aliases_pending_idx" ON "public"."institution_aliases" USING "btree" ("created_at") WHERE ("verification_status" = 'pending'::"text");



CREATE UNIQUE INDEX "institution_aliases_unique_identity_idx" ON "public"."institution_aliases" USING "btree" ("institution_id", "normalized_alias", "language_code", "alias_type");



CREATE UNIQUE INDEX "institution_verification_active_submission_uq" ON "public"."institution_verification_tasks" USING "btree" ("submission_id") WHERE ("status" = ANY (ARRAY['pending'::"text", 'in_review'::"text"]));



CREATE INDEX "institution_verification_assignee_idx" ON "public"."institution_verification_tasks" USING "btree" ("assigned_to_user_id") WHERE ("assigned_to_user_id" IS NOT NULL);



CREATE INDEX "institution_verification_candidate_idx" ON "public"."institution_verification_tasks" USING "btree" ("candidate_institution_id");



CREATE INDEX "institution_verification_status_idx" ON "public"."institution_verification_tasks" USING "btree" ("status", "created_at");



CREATE INDEX "institutions_active_region_idx" ON "public"."institutions" USING "btree" ("region_id", "official_name") WHERE ("is_active" = true);



CREATE INDEX "institutions_normalized_name_idx" ON "public"."institutions" USING "btree" ("normalized_name");



CREATE INDEX "institutions_official_name_idx" ON "public"."institutions" USING "btree" ("official_name");



CREATE UNIQUE INDEX "institutions_permanent_id_uq" ON "public"."institutions" USING "btree" ("aicte_permanent_id") WHERE ("aicte_permanent_id" IS NOT NULL);



CREATE INDEX "institutions_region_idx" ON "public"."institutions" USING "btree" ("region_id");



CREATE INDEX "institutions_verification_queue_idx" ON "public"."institutions" USING "btree" ("created_at") WHERE ("verification_status" = 'pending'::"text");



CREATE INDEX "intake_channels_active_idx" ON "public"."intake_channels" USING "btree" ("name") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "intake_channels_code_uq" ON "public"."intake_channels" USING "btree" ("code");



CREATE INDEX "intake_channels_type_idx" ON "public"."intake_channels" USING "btree" ("channel_type");



CREATE INDEX "notifications_case_idx" ON "public"."notifications" USING "btree" ("case_id", "created_at" DESC) WHERE ("case_id" IS NOT NULL);



CREATE INDEX "notifications_escalation_idx" ON "public"."notifications" USING "btree" ("case_escalation_id") WHERE ("case_escalation_id" IS NOT NULL);



CREATE UNIQUE INDEX "notifications_recipient_event_uq" ON "public"."notifications" USING "btree" ("recipient_user_id", "source_event_key") WHERE ("source_event_key" IS NOT NULL);



CREATE INDEX "notifications_recipient_recent_idx" ON "public"."notifications" USING "btree" ("recipient_user_id", "created_at" DESC);



CREATE INDEX "notifications_unread_idx" ON "public"."notifications" USING "btree" ("recipient_user_id", "created_at" DESC) WHERE ("notification_status" = 'unread'::"text");



CREATE INDEX "permissions_active_idx" ON "public"."permissions" USING "btree" ("name") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "permissions_code_uq" ON "public"."permissions" USING "btree" ("code");



CREATE UNIQUE INDEX "permissions_resource_action_uq" ON "public"."permissions" USING "btree" ("resource_type", "action_type");



CREATE INDEX "permissions_resource_idx" ON "public"."permissions" USING "btree" ("resource_type");



CREATE INDEX "regions_active_name_idx" ON "public"."regions" USING "btree" ("name") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "regions_code_uq" ON "public"."regions" USING "btree" ("code");



CREATE INDEX "role_permissions_permission_idx" ON "public"."role_permissions" USING "btree" ("permission_id");



CREATE INDEX "role_permissions_role_idx" ON "public"."role_permissions" USING "btree" ("role_id");



CREATE INDEX "roles_active_idx" ON "public"."roles" USING "btree" ("name") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "roles_code_uq" ON "public"."roles" USING "btree" ("code");



CREATE INDEX "roles_scope_idx" ON "public"."roles" USING "btree" ("scope_type");



CREATE INDEX "sla_policies_bureau_idx" ON "public"."sla_policies" USING "btree" ("bureau_id") WHERE ("bureau_id" IS NOT NULL);



CREATE INDEX "sla_policies_category_idx" ON "public"."sla_policies" USING "btree" ("category_id") WHERE ("category_id" IS NOT NULL);



CREATE INDEX "sla_policies_priority_idx" ON "public"."sla_policies" USING "btree" ("priority") WHERE ("priority" IS NOT NULL);



CREATE INDEX "sla_policies_status_idx" ON "public"."sla_policies" USING "btree" ("policy_status", "effective_from" DESC);



CREATE INDEX "submissions_case_idx" ON "public"."submissions" USING "btree" ("canonical_case_id") WHERE ("canonical_case_id" IS NOT NULL);



CREATE INDEX "submissions_channel_received_idx" ON "public"."submissions" USING "btree" ("intake_channel_id", "received_at" DESC);



CREATE INDEX "submissions_external_reference_idx" ON "public"."submissions" USING "btree" ("intake_channel_id", "external_reference") WHERE ("external_reference" IS NOT NULL);



CREATE INDEX "submissions_fingerprint_idx" ON "public"."submissions" USING "btree" ("content_fingerprint") WHERE ("content_fingerprint" IS NOT NULL);



CREATE UNIQUE INDEX "submissions_idempotency_uq" ON "public"."submissions" USING "btree" ("intake_channel_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "submissions_institution_received_idx" ON "public"."submissions" USING "btree" ("institution_id", "received_at" DESC);



CREATE INDEX "submissions_pending_queue_idx" ON "public"."submissions" USING "btree" ("intake_status", "received_at") WHERE ("intake_status" = ANY (ARRAY['received'::"text", 'awaiting_institution_verification'::"text", 'awaiting_duplicate_review'::"text", 'ready_for_case_creation'::"text"]));



CREATE UNIQUE INDEX "submissions_source_event_uq" ON "public"."submissions" USING "btree" ("intake_channel_id", "source_event_id") WHERE ("source_event_id" IS NOT NULL);



CREATE UNIQUE INDEX "user_role_assignments_active_scope_uq" ON "public"."user_role_assignments" USING "btree" ("user_id", "role_id", "bureau_id") NULLS NOT DISTINCT WHERE ("assignment_status" = 'active'::"text");



CREATE INDEX "user_role_assignments_bureau_idx" ON "public"."user_role_assignments" USING "btree" ("bureau_id") WHERE ("bureau_id" IS NOT NULL);



CREATE INDEX "user_role_assignments_expiry_idx" ON "public"."user_role_assignments" USING "btree" ("expires_at") WHERE (("assignment_status" = 'active'::"text") AND ("expires_at" IS NOT NULL));



CREATE INDEX "user_role_assignments_role_idx" ON "public"."user_role_assignments" USING "btree" ("role_id");



CREATE INDEX "user_role_assignments_user_idx" ON "public"."user_role_assignments" USING "btree" ("user_id");



CREATE UNIQUE INDEX "users_employee_code_uq" ON "public"."users" USING "btree" ("employee_code") WHERE ("employee_code" IS NOT NULL);



CREATE INDEX "users_full_name_idx" ON "public"."users" USING "btree" ("full_name");



CREATE UNIQUE INDEX "users_official_email_uq" ON "public"."users" USING "btree" ("lower"("btrim"("official_email")));



CREATE INDEX "users_status_idx" ON "public"."users" USING "btree" ("account_status");



CREATE INDEX "users_super_admin_idx" ON "public"."users" USING "btree" ("id") WHERE (("is_super_admin" = true) AND ("account_status" = 'active'::"text"));



CREATE OR REPLACE TRIGGER "trg_attachments_updated_at" BEFORE UPDATE ON "public"."attachments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_bureau_memberships_updated_at" BEFORE UPDATE ON "public"."bureau_memberships" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_bureaus_updated_at" BEFORE UPDATE ON "public"."bureaus" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_case_access_grants_updated_at" BEFORE UPDATE ON "public"."case_access_grants" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_case_access_requests_updated_at" BEFORE UPDATE ON "public"."case_access_requests" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_case_action_history_immutable" BEFORE DELETE OR UPDATE ON "public"."case_action_history" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_case_action_history_mutation"();



CREATE OR REPLACE TRIGGER "trg_case_bureau_assignments_updated_at" BEFORE UPDATE ON "public"."case_bureau_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_case_deadlines_updated_at" BEFORE UPDATE ON "public"."case_deadlines" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_case_escalations_updated_at" BEFORE UPDATE ON "public"."case_escalations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_case_notes_updated_at" BEFORE UPDATE ON "public"."case_notes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_case_officer_assignments_updated_at" BEFORE UPDATE ON "public"."case_officer_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_case_relationships_updated_at" BEFORE UPDATE ON "public"."case_relationships" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_case_statuses_updated_at" BEFORE UPDATE ON "public"."case_statuses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_case_transfers_updated_at" BEFORE UPDATE ON "public"."case_transfers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cases_updated_at" BEFORE UPDATE ON "public"."cases" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_complaint_categories_updated_at" BEFORE UPDATE ON "public"."complaint_categories" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_duplicate_candidates_updated_at" BEFORE UPDATE ON "public"."duplicate_candidates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_escalation_rules_updated_at" BEFORE UPDATE ON "public"."escalation_rules" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_institution_aliases_updated_at" BEFORE UPDATE ON "public"."institution_aliases" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_institution_verification_updated_at" BEFORE UPDATE ON "public"."institution_verification_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_institutions_set_updated_at" BEFORE UPDATE ON "public"."institutions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_intake_channels_updated_at" BEFORE UPDATE ON "public"."intake_channels" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_notification_rules_updated_at" BEFORE UPDATE ON "public"."notification_rules" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_notifications_updated_at" BEFORE UPDATE ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_permissions_updated_at" BEFORE UPDATE ON "public"."permissions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_regions_set_updated_at" BEFORE UPDATE ON "public"."regions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_role_permissions_updated_at" BEFORE UPDATE ON "public"."role_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_roles_updated_at" BEFORE UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sla_policies_updated_at" BEFORE UPDATE ON "public"."sla_policies" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_submissions_updated_at" BEFORE UPDATE ON "public"."submissions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_user_role_assignments_updated_at" BEFORE UPDATE ON "public"."user_role_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_validate_case_access_grant" BEFORE INSERT OR UPDATE OF "case_id", "grantee_user_id", "access_request_id", "access_level", "granted_by_user_id" ON "public"."case_access_grants" FOR EACH ROW EXECUTE FUNCTION "public"."validate_case_access_grant"();



CREATE OR REPLACE TRIGGER "trg_validate_case_creation" BEFORE INSERT ON "public"."cases" FOR EACH ROW EXECUTE FUNCTION "public"."validate_case_creation"();



CREATE OR REPLACE TRIGGER "trg_validate_case_deadline" BEFORE INSERT OR UPDATE OF "case_id", "sla_policy_id", "case_bureau_assignment_id", "deadline_type", "clock_started_at" ON "public"."case_deadlines" FOR EACH ROW EXECUTE FUNCTION "public"."validate_case_deadline"();



CREATE OR REPLACE TRIGGER "trg_validate_case_escalation" BEFORE INSERT OR UPDATE OF "case_id", "case_deadline_id", "escalation_rule_id", "escalation_type" ON "public"."case_escalations" FOR EACH ROW EXECUTE FUNCTION "public"."validate_case_escalation"();



CREATE OR REPLACE TRIGGER "trg_validate_case_transfer" BEFORE INSERT OR UPDATE OF "case_id", "from_bureau_assignment_id", "to_bureau_assignment_id" ON "public"."case_transfers" FOR EACH ROW EXECUTE FUNCTION "public"."validate_case_transfer"();



CREATE OR REPLACE TRIGGER "trg_validate_user_role_assignment" BEFORE INSERT OR UPDATE OF "user_id", "role_id", "bureau_id", "assignment_status" ON "public"."user_role_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."validate_user_role_assignment"();



ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bureau_memberships"
    ADD CONSTRAINT "bureau_memberships_bureau_fk" FOREIGN KEY ("bureau_id") REFERENCES "public"."bureaus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bureau_memberships"
    ADD CONSTRAINT "bureau_memberships_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bureaus"
    ADD CONSTRAINT "bureaus_parent_fk" FOREIGN KEY ("parent_bureau_id") REFERENCES "public"."bureaus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_access_grants"
    ADD CONSTRAINT "case_access_grants_access_request_id_fkey" FOREIGN KEY ("access_request_id") REFERENCES "public"."case_access_requests"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_access_grants"
    ADD CONSTRAINT "case_access_grants_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_access_grants"
    ADD CONSTRAINT "case_access_grants_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_access_grants"
    ADD CONSTRAINT "case_access_grants_grantee_user_id_fkey" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_access_grants"
    ADD CONSTRAINT "case_access_grants_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_access_requests"
    ADD CONSTRAINT "case_access_requests_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_access_requests"
    ADD CONSTRAINT "case_access_requests_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_access_requests"
    ADD CONSTRAINT "case_access_requests_requesting_bureau_id_fkey" FOREIGN KEY ("requesting_bureau_id") REFERENCES "public"."bureaus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_access_requests"
    ADD CONSTRAINT "case_access_requests_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_action_history"
    ADD CONSTRAINT "case_action_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_action_history"
    ADD CONSTRAINT "case_action_history_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_action_history"
    ADD CONSTRAINT "case_action_history_new_status_fkey" FOREIGN KEY ("new_status") REFERENCES "public"."case_statuses"("code") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_action_history"
    ADD CONSTRAINT "case_action_history_previous_status_fkey" FOREIGN KEY ("previous_status") REFERENCES "public"."case_statuses"("code") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_action_history"
    ADD CONSTRAINT "case_action_history_related_bureau_assignment_id_fkey" FOREIGN KEY ("related_bureau_assignment_id") REFERENCES "public"."case_bureau_assignments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_action_history"
    ADD CONSTRAINT "case_action_history_related_submission_id_fkey" FOREIGN KEY ("related_submission_id") REFERENCES "public"."submissions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_bureau_assignments"
    ADD CONSTRAINT "case_bureau_assignments_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_bureau_assignments"
    ADD CONSTRAINT "case_bureau_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_bureau_assignments"
    ADD CONSTRAINT "case_bureau_assignments_bureau_id_fkey" FOREIGN KEY ("bureau_id") REFERENCES "public"."bureaus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_bureau_assignments"
    ADD CONSTRAINT "case_bureau_assignments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_deadlines"
    ADD CONSTRAINT "case_deadlines_case_bureau_assignment_id_fkey" FOREIGN KEY ("case_bureau_assignment_id") REFERENCES "public"."case_bureau_assignments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_deadlines"
    ADD CONSTRAINT "case_deadlines_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_deadlines"
    ADD CONSTRAINT "case_deadlines_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_deadlines"
    ADD CONSTRAINT "case_deadlines_sla_policy_id_fkey" FOREIGN KEY ("sla_policy_id") REFERENCES "public"."sla_policies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_escalations"
    ADD CONSTRAINT "case_escalations_acknowledged_by_user_id_fkey" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_escalations"
    ADD CONSTRAINT "case_escalations_case_deadline_id_fkey" FOREIGN KEY ("case_deadline_id") REFERENCES "public"."case_deadlines"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_escalations"
    ADD CONSTRAINT "case_escalations_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_escalations"
    ADD CONSTRAINT "case_escalations_escalation_rule_id_fkey" FOREIGN KEY ("escalation_rule_id") REFERENCES "public"."escalation_rules"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_escalations"
    ADD CONSTRAINT "case_escalations_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_escalations"
    ADD CONSTRAINT "case_escalations_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_escalations"
    ADD CONSTRAINT "case_escalations_target_bureau_id_fkey" FOREIGN KEY ("target_bureau_id") REFERENCES "public"."bureaus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_escalations"
    ADD CONSTRAINT "case_escalations_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_notes"
    ADD CONSTRAINT "case_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_notes"
    ADD CONSTRAINT "case_notes_bureau_id_fkey" FOREIGN KEY ("bureau_id") REFERENCES "public"."bureaus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_notes"
    ADD CONSTRAINT "case_notes_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_notes"
    ADD CONSTRAINT "case_notes_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_officer_assignments"
    ADD CONSTRAINT "case_officer_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_officer_assignments"
    ADD CONSTRAINT "case_officer_assignments_case_bureau_assignment_id_fkey" FOREIGN KEY ("case_bureau_assignment_id") REFERENCES "public"."case_bureau_assignments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_officer_assignments"
    ADD CONSTRAINT "case_officer_assignments_officer_user_id_fkey" FOREIGN KEY ("officer_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_relationships"
    ADD CONSTRAINT "case_relationships_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_relationships"
    ADD CONSTRAINT "case_relationships_created_by_user_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_relationships"
    ADD CONSTRAINT "case_relationships_related_case_id_fkey" FOREIGN KEY ("related_case_id") REFERENCES "public"."cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_transfers"
    ADD CONSTRAINT "case_transfers_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_transfers"
    ADD CONSTRAINT "case_transfers_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_transfers"
    ADD CONSTRAINT "case_transfers_from_bureau_assignment_id_fkey" FOREIGN KEY ("from_bureau_assignment_id") REFERENCES "public"."case_bureau_assignments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_transfers"
    ADD CONSTRAINT "case_transfers_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."case_transfers"
    ADD CONSTRAINT "case_transfers_to_bureau_assignment_id_fkey" FOREIGN KEY ("to_bureau_assignment_id") REFERENCES "public"."case_bureau_assignments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_created_by_user_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_primary_category_id_fkey" FOREIGN KEY ("primary_category_id") REFERENCES "public"."complaint_categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_source_submission_id_fkey" FOREIGN KEY ("source_submission_id") REFERENCES "public"."submissions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_status_catalog_fk" FOREIGN KEY ("status") REFERENCES "public"."case_statuses"("code") ON UPDATE RESTRICT ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_updated_by_user_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."complaint_categories"
    ADD CONSTRAINT "complaint_categories_parent_fk" FOREIGN KEY ("parent_category_id") REFERENCES "public"."complaint_categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."duplicate_candidates"
    ADD CONSTRAINT "duplicate_candidates_candidate_case_id_fkey" FOREIGN KEY ("candidate_case_id") REFERENCES "public"."cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."duplicate_candidates"
    ADD CONSTRAINT "duplicate_candidates_reviewer_user_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."duplicate_candidates"
    ADD CONSTRAINT "duplicate_candidates_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."escalation_rules"
    ADD CONSTRAINT "escalation_rules_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."escalation_rules"
    ADD CONSTRAINT "escalation_rules_bureau_id_fkey" FOREIGN KEY ("bureau_id") REFERENCES "public"."bureaus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."escalation_rules"
    ADD CONSTRAINT "escalation_rules_sla_policy_id_fkey" FOREIGN KEY ("sla_policy_id") REFERENCES "public"."sla_policies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."escalation_rules"
    ADD CONSTRAINT "escalation_rules_target_bureau_id_fkey" FOREIGN KEY ("target_bureau_id") REFERENCES "public"."bureaus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."escalation_rules"
    ADD CONSTRAINT "escalation_rules_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."institution_aliases"
    ADD CONSTRAINT "institution_aliases_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."institution_verification_tasks"
    ADD CONSTRAINT "institution_verification_assignee_user_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."institution_verification_tasks"
    ADD CONSTRAINT "institution_verification_reviewer_user_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."institution_verification_tasks"
    ADD CONSTRAINT "institution_verification_tasks_candidate_institution_id_fkey" FOREIGN KEY ("candidate_institution_id") REFERENCES "public"."institutions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."institution_verification_tasks"
    ADD CONSTRAINT "institution_verification_tasks_resolved_institution_id_fkey" FOREIGN KEY ("resolved_institution_id") REFERENCES "public"."institutions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."institution_verification_tasks"
    ADD CONSTRAINT "institution_verification_tasks_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."institutions"
    ADD CONSTRAINT "institutions_region_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."institutions"
    ADD CONSTRAINT "institutions_verified_by_user_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_case_action_history_id_fkey" FOREIGN KEY ("case_action_history_id") REFERENCES "public"."case_action_history"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_case_escalation_id_fkey" FOREIGN KEY ("case_escalation_id") REFERENCES "public"."case_escalations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sla_policies"
    ADD CONSTRAINT "sla_policies_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sla_policies"
    ADD CONSTRAINT "sla_policies_bureau_id_fkey" FOREIGN KEY ("bureau_id") REFERENCES "public"."bureaus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sla_policies"
    ADD CONSTRAINT "sla_policies_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."complaint_categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sla_policies"
    ADD CONSTRAINT "sla_policies_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_case_fk" FOREIGN KEY ("canonical_case_id") REFERENCES "public"."cases"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_category_fk" FOREIGN KEY ("category_id") REFERENCES "public"."complaint_categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_channel_fk" FOREIGN KEY ("intake_channel_id") REFERENCES "public"."intake_channels"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_institution_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."user_role_assignments"
    ADD CONSTRAINT "user_role_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."user_role_assignments"
    ADD CONSTRAINT "user_role_assignments_bureau_id_fkey" FOREIGN KEY ("bureau_id") REFERENCES "public"."bureaus"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."user_role_assignments"
    ADD CONSTRAINT "user_role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."user_role_assignments"
    ADD CONSTRAINT "user_role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_auth_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bureau_memberships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bureaus" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_access_grants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_access_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_action_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_bureau_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_deadlines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_escalations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_officer_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_relationships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_statuses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_transfers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."complaint_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."duplicate_candidates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."escalation_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."institution_aliases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."institution_verification_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."institutions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."intake_channels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."regions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sla_policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_role_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_case_action_history_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_case_action_history_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_case_action_history_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_case_access_grant"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_case_access_grant"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_case_access_grant"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_case_creation"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_case_creation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_case_creation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_case_deadline"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_case_deadline"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_case_deadline"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_case_escalation"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_case_escalation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_case_escalation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_case_transfer"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_case_transfer"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_case_transfer"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_user_role_assignment"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_user_role_assignment"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_user_role_assignment"() TO "service_role";



GRANT ALL ON TABLE "public"."attachments" TO "service_role";



GRANT ALL ON TABLE "public"."bureau_memberships" TO "service_role";



GRANT ALL ON TABLE "public"."bureaus" TO "service_role";



GRANT ALL ON TABLE "public"."case_access_grants" TO "service_role";



GRANT ALL ON TABLE "public"."case_access_requests" TO "service_role";



GRANT ALL ON TABLE "public"."case_action_history" TO "service_role";



GRANT ALL ON TABLE "public"."case_bureau_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."case_deadlines" TO "service_role";



GRANT ALL ON TABLE "public"."case_escalations" TO "service_role";



GRANT ALL ON TABLE "public"."case_notes" TO "service_role";



GRANT ALL ON TABLE "public"."case_officer_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."case_relationships" TO "anon";
GRANT ALL ON TABLE "public"."case_relationships" TO "authenticated";
GRANT ALL ON TABLE "public"."case_relationships" TO "service_role";



GRANT ALL ON TABLE "public"."case_statuses" TO "service_role";



GRANT ALL ON TABLE "public"."case_transfers" TO "service_role";



GRANT ALL ON TABLE "public"."cases" TO "anon";
GRANT ALL ON TABLE "public"."cases" TO "authenticated";
GRANT ALL ON TABLE "public"."cases" TO "service_role";



GRANT ALL ON TABLE "public"."complaint_categories" TO "anon";
GRANT ALL ON TABLE "public"."complaint_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."complaint_categories" TO "service_role";



GRANT ALL ON TABLE "public"."duplicate_candidates" TO "anon";
GRANT ALL ON TABLE "public"."duplicate_candidates" TO "authenticated";
GRANT ALL ON TABLE "public"."duplicate_candidates" TO "service_role";



GRANT ALL ON TABLE "public"."escalation_rules" TO "service_role";



GRANT ALL ON TABLE "public"."institution_aliases" TO "anon";
GRANT ALL ON TABLE "public"."institution_aliases" TO "authenticated";
GRANT ALL ON TABLE "public"."institution_aliases" TO "service_role";



GRANT ALL ON TABLE "public"."institution_verification_tasks" TO "anon";
GRANT ALL ON TABLE "public"."institution_verification_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."institution_verification_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."institutions" TO "anon";
GRANT ALL ON TABLE "public"."institutions" TO "authenticated";
GRANT ALL ON TABLE "public"."institutions" TO "service_role";



GRANT ALL ON TABLE "public"."intake_channels" TO "anon";
GRANT ALL ON TABLE "public"."intake_channels" TO "authenticated";
GRANT ALL ON TABLE "public"."intake_channels" TO "service_role";



GRANT ALL ON TABLE "public"."notification_rules" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."permissions" TO "service_role";



GRANT ALL ON TABLE "public"."regions" TO "anon";
GRANT ALL ON TABLE "public"."regions" TO "authenticated";
GRANT ALL ON TABLE "public"."regions" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON TABLE "public"."sla_policies" TO "service_role";



GRANT ALL ON TABLE "public"."submissions" TO "anon";
GRANT ALL ON TABLE "public"."submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."submissions" TO "service_role";



GRANT ALL ON TABLE "public"."user_role_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";








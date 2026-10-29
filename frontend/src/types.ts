/** API response types, kept in step with backend/app/schemas. */

export type VerificationStatus = "pending" | "verified" | "rejected";
export type AccountStatus = "active" | "inactive" | "suspended";
export type MembershipType = "member" | "coordinator" | "head";
export type BureauType = "bureau" | "cell" | "division" | "unit";

export interface Page<T> {
  data: T[];
  page: { limit: number; next_cursor: string | null };
  request_id: string;
}

export interface MeUser {
  id: string;
  full_name: string;
  display_name: string | null;
  official_email: string;
  designation: string | null;
  employee_code: string | null;
  account_status: AccountStatus;
}

export interface MeRole {
  role_code: string;
  role_name: string;
  scope_type: "global" | "bureau";
  bureau_id: string | null;
  bureau_name: string | null;
  permissions: string[];
}

export interface MeMembership {
  bureau_id: string;
  bureau_code: string;
  bureau_name: string;
  membership_type: MembershipType;
  is_primary: boolean;
}

export interface MeResponse {
  user: MeUser;
  roles: MeRole[];
  memberships: MeMembership[];
  active_bureau_id: string | null;
  permissions: string[];
  global_permissions: string[];
  is_super_admin: boolean;
  demo_mode: boolean;
  demo_notice: string;
}

export interface Region {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface RegionRef {
  id: string;
  code: string;
  name: string;
}

export interface InstitutionSummary {
  id: string;
  aicte_permanent_id: string | null;
  official_name: string;
  verification_status: VerificationStatus;
  is_active: boolean;
  region: RegionRef | null;
}

export interface InstitutionDetail extends InstitutionSummary {
  institution_type: string | null;
  ownership_type: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  district: string | null;
  state_name: string | null;
  postal_code: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website_url: string | null;
  verification_source: string | null;
  verification_reference: string | null;
  verified_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface Alias {
  id: string;
  institution_id: string;
  alias_name: string;
  normalized_alias: string;
  language_code: string;
  alias_type: "alternate_name" | "former_name" | "abbreviation" | "spelling_variant" | "submitted_name";
  source_type: "manual" | "official_record" | "complaint_submission" | "import";
  source_reference: string | null;
  verification_status: VerificationStatus;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface Bureau {
  id: string;
  code: string;
  name: string;
  description: string | null;
  parent_bureau_id: string | null;
  bureau_type: BureauType;
  is_active: boolean;
  display_order: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface BureauMember {
  membership_id: string;
  user_id: string;
  bureau_id: string;
  full_name: string;
  official_email: string;
  designation: string | null;
  membership_type: MembershipType;
  membership_status: "active" | "inactive";
  is_primary: boolean;
  joined_at: string | null;
  ended_at: string | null;
}

export interface RoleBrief {
  role_code: string;
  role_name: string;
  scope_type: "global" | "bureau";
  bureau_id: string | null;
  bureau_name: string | null;
}

export interface UserSummary {
  id: string;
  employee_code: string | null;
  full_name: string;
  display_name: string | null;
  official_email: string;
  designation: string | null;
  account_status: AccountStatus;
  roles: RoleBrief[];
}

export interface RoleAssignmentDetail {
  id: string;
  role_code: string;
  role_name: string;
  scope_type: "global" | "bureau";
  bureau_id: string | null;
  bureau_code: string | null;
  bureau_name: string | null;
  assignment_status: "active" | "revoked" | "expired";
  assigned_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
}

export interface MembershipBrief {
  id: string;
  bureau_id: string;
  bureau_code: string;
  bureau_name: string;
  membership_type: MembershipType;
  membership_status: "active" | "inactive";
  is_primary: boolean;
  joined_at: string | null;
  ended_at: string | null;
}

export interface UserDetail extends UserSummary {
  memberships: MembershipBrief[];
  role_assignments: RoleAssignmentDetail[];
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  scope_type: "global" | "bureau";
  is_system_role: boolean;
  is_active: boolean;
  permissions: string[];
}

// ---------------------------------------------------------------------------
// Phase 2.1 — simulated intake
// ---------------------------------------------------------------------------
export type IntakeLanguage = "en" | "hi";
export type DemoPortal = "aicte" | "cpgrams";

export interface DemoChannel {
  code: string;
  name: string;
  channel_type: "portal" | "cpgrams";
  portal: DemoPortal;
  is_simulated: boolean;
}

export interface DemoInfo {
  demo_mode: boolean;
  notice: string;
  phase: string;
  demo_intake_enabled: boolean;
  channels: DemoChannel[];
  simulation_notice_version: string | null;
  simulation_notice_en: string | null;
  simulation_notice_hi: string | null;
}

export interface IntakeChannelRef {
  code: string;
  name: string;
  is_simulated: boolean;
}

export interface SubmissionInstitutionRef {
  id: string;
  aicte_permanent_id: string | null;
  official_name: string;
}

export interface SubmissionSummary {
  id: string;
  external_reference: string | null;
  source_event_id: string | null;
  channel: IntakeChannelRef;
  received_at: string;
  institution: SubmissionInstitutionRef | null;
  institution_name_as_submitted: string | null;
  subject: string;
  original_language: string;
  intake_status: string;
  canonical_case_id: string | null;
}

export interface SubmissionDetail extends SubmissionSummary {
  original_text: string;
  content_fingerprint: string | null;
  source_submitted_at: string | null;
  reference_origin: string | null;
  simulation_notice_version: string | null;
  consent_acknowledged: boolean | null;
  created_at: string;
}

export interface DemoSubmissionRequest {
  institution_permanent_id?: string | null;
  institution_name_as_submitted?: string | null;
  subject: string;
  description: string;
  language: IntakeLanguage;
  category_code?: string | null;
  source_event_id?: string | null;
  source_submitted_at?: string | null;
  consent_acknowledged: true;
}

export interface DemoSubmissionReceipt {
  outcome: "created" | "replay";
  replayed: boolean;
  submission_id: string;
  external_reference: string | null;
  intake_status: string;
  received_at: string;
  institution_resolved: boolean;
  channel: IntakeChannelRef;
  demo_notice: string;
  simulation_notice_version: string;
}

// ---------------------------------------------------------------------------
// Phase 2.2 — human institution verification
// ---------------------------------------------------------------------------
export type VerificationTaskStatus = "pending" | "in_review" | "verified" | "rejected";
export type VerificationPriority = "low" | "normal" | "high" | "critical";
export type VerificationRoundType = "new_round" | "correction";
export type VerificationAction =
  | "confirm"
  | "reject"
  | "request_information"
  | "assign_to_me"
  | "unassign";

export interface VerificationSubmissionRef {
  id: string;
  channel_code: string;
  channel_name: string;
  channel_is_simulated: boolean;
  external_reference: string | null;
  source_event_id: string | null;
  received_at: string;
  updated_at: string;
  intake_status: string;
  original_language: string;
  institution_name_as_submitted: string | null;
  submitted_permanent_id: string | null;
  institution_id: string | null;
  institution_official_name: string | null;
  institution_permanent_id: string | null;
  canonical_case_id: string | null;
}

export interface VerificationTask {
  id: string;
  status: VerificationTaskStatus;
  priority: VerificationPriority;
  submitted_institution_name: string;
  submitted_permanent_id: string | null;
  candidate_institution_id: string | null;
  candidate_count: number;
  strongest_evidence: string | null;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  resolved_institution_id: string | null;
  resolved_institution_name: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  age_days: number;
  round_type: VerificationRoundType;
  requester_user_id: string | null;
  submission: VerificationSubmissionRef;
}

export interface VerificationCandidate {
  institution_id: string;
  official_name: string;
  permanent_id: string | null;
  region_code: string | null;
  region_name: string | null;
  verification_status: string;
  is_active: boolean;
  evidence: string[];
  matched_alias_id: string | null;
  matched_alias_name: string | null;
  evidence_rank: number;
  is_eligible: boolean;
}

export interface VerificationCandidateList {
  data: VerificationCandidate[];
  request_id: string;
}

export interface VerificationDecisionPayload {
  action: VerificationAction;
  institution_id?: string | null;
  reason?: string | null;
  expected_updated_at?: string | null;
}

export interface CorrectionRoundPayload {
  reason: string;
  expected_submission_updated_at?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Phase 2.3: Duplicate Review & Canonical Cases Types                        */
/* -------------------------------------------------------------------------- */

export type DuplicateCandidateStatus = "pending" | "confirmed_duplicate" | "not_duplicate" | "related";
export type DuplicateReviewDecision = "confirmed_duplicate" | "not_duplicate" | "related";
export type CasePriority = "low" | "normal" | "high" | "critical";
export type CaseVisibility = "restricted" | "confidential";

export interface DuplicateCandidateItem {
  candidate_id: string;
  submission_id: string;
  candidate_case_id: string;
  case_number: string;
  institution_id: string | null;
  institution_name: string | null;
  similarity_score: number;
  matching_method: string;
  matching_signals: Record<string, unknown>;
  review_status: DuplicateCandidateStatus;
  reviewed_at: string | null;
  reviewer_user_id: string | null;
  review_notes: string | null;
  candidate_created_at: string;
  candidate_updated_at: string;
  submission_updated_at: string;
  submission_subject: string;
  submission_received_at: string;
}

export interface DuplicateCandidateDetail {
  candidate_id: string;
  submission_id: string;
  submission_subject: string;
  submission_body: string;
  submission_category_id: string | null;
  submission_category_name: string | null;
  submission_institution_id: string | null;
  submission_institution_name: string | null;
  submission_updated_at: string;
  candidate_case_id: string;
  case_number: string;
  case_title: string;
  case_status: string;
  case_category_id: string | null;
  case_category_name: string | null;
  case_created_at: string;
  case_lead_bureau_id: string | null;
  case_lead_bureau_name: string | null;
  similarity_score: number;
  matching_method: string;
  matching_signals: Record<string, unknown>;
  review_status: DuplicateCandidateStatus;
  reviewed_at: string | null;
  reviewer_user_id: string | null;
  review_notes: string | null;
  candidate_created_at: string;
  candidate_updated_at: string;
}

export interface CandidateScreeningRequest {
  submission_id: string;
  expected_submission_updated_at: string;
}

export interface CandidateScreeningResponse {
  inserted_count: number;
}

export interface DuplicateDecisionRequest {
  action: DuplicateReviewDecision;
  notes: string;
  expected_submission_updated_at: string;
  expected_candidate_updated_at: string;
}

export interface SubmissionRejectionRequest {
  reason: string;
  expected_submission_updated_at: string;
}

export interface CaseIndexItem {
  case_id: string;
  case_number: string;
  institution_id: string;
  institution_name: string;
  institution_region: string | null;
  category_id: string | null;
  category_name: string | null;
  status: string;
  priority: string;
  lead_bureau_id: string | null;
  lead_bureau_name: string | null;
  lead_bureau_code: string | null;
  opened_at: string;
  closed_at: string | null;
  can_view_details: boolean;
}

export interface CollaboratingBureau {
  bureau_id: string;
  bureau_name: string;
  bureau_code: string;
  assignment_type: string;
  assignment_status: string;
  assigned_at: string;
}

export interface RelatedCaseItem {
  relationship_id: string;
  related_case_id: string;
  related_case_number: string;
  related_case_title: string;
  relationship_type: string;
  description: string | null;
  created_at: string;
}

export interface CaseActionHistoryItem {
  action_id: string;
  action_type: string;
  action_description: string;
  previous_status: string | null;
  new_status: string | null;
  actor_user_id: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface OfficerAssignmentItem {
  officer_assignment_id: string;
  case_bureau_assignment_id: string;
  bureau_name: string;
  officer_user_id: string;
  officer_name: string;
  role: "lead_officer" | "supporting" | "reviewer" | string;
  status: "pending" | "active" | "completed" | "revoked" | string;
  assigned_at: string;
}

export interface CaseDetail {
  case_id: string;
  case_number: string;
  title: string;
  description: string;
  institution_id: string;
  institution_name: string;
  institution_code: string | null;
  institution_region: string | null;
  category_id: string | null;
  category_name: string | null;
  status: string;
  priority: string;
  visibility: string;
  source_submission_id: string;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  lead_bureau_id: string | null;
  lead_bureau_name: string | null;
  lead_bureau_code: string | null;
  collaborating_bureaus: CollaboratingBureau[];
  officer_assignments?: OfficerAssignmentItem[];
  related_cases: RelatedCaseItem[];
  action_history: CaseActionHistoryItem[];
  notes_count?: number;
  attachments_count?: number;
}

export interface CaseCreateRequest {
  submission_id: string;
  lead_bureau_id: string;
  title: string;
  description: string;
  priority?: CasePriority;
  visibility?: CaseVisibility;
  expected_submission_updated_at: string;
}

export interface CaseStatusTransitionPayload {
  to_status: string;
  reason: string;
  expected_updated_at?: string | null;
}

export interface CaseBureauAssignPayload {
  bureau_id: string;
  assignment_type: "lead" | "collaborating";
  reason?: string;
}

export interface CaseBureauAssignUpdatePayload {
  status: "active" | "completed" | "cancelled";
  completion_notes?: string;
}

export interface CaseOfficerAssignPayload {
  officer_user_id: string;
  role: "lead_officer" | "supporting" | "reviewer";
  notes?: string;
}

export interface CaseOfficerAssignUpdatePayload {
  status: "active" | "completed" | "revoked";
  notes?: string;
}

export interface CaseNoteItem {
  note_id: string;
  case_id: string;
  author_user_id: string;
  author_name: string;
  bureau_id: string | null;
  bureau_name: string | null;
  bureau_code: string | null;
  note_text: string;
  visibility: "shared" | "bureau_private";
  note_type: "general" | "internal_review" | "resolution" | "handover";
  is_pinned: boolean;
  edited_at: string | null;
  created_at: string;
}

export interface CaseNoteCreatePayload {
  note_text: string;
  visibility: "shared" | "bureau_private";
  note_type: "general" | "internal_review" | "resolution" | "handover";
  bureau_id?: string | null;
  is_pinned?: boolean;
}

export interface CaseNoteUpdatePayload {
  note_text: string;
  is_pinned?: boolean;
}

export interface CaseAttachmentItem {
  attachment_id: string;
  case_id: string | null;
  submission_id: string | null;
  uploaded_by_user_id: string | null;
  uploader_name: string | null;
  original_filename: string;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  file_size_bytes: number;
  sha256_checksum: string | null;
  attachment_type: string;
  upload_status: string;
  description: string | null;
  uploaded_at: string;
  verified_at: string | null;
}

export interface CaseAttachmentRegisterPayload {
  original_filename: string;
  storage_bucket?: string;
  storage_path: string;
  mime_type: string;
  file_size_bytes: number;
  sha256_checksum?: string;
  attachment_type?: string;
  description?: string;
}

export interface CaseTransferItem {
  transfer_id: string;
  case_id: string;
  from_bureau_assignment_id: string | null;
  to_bureau_assignment_id: string | null;
  transfer_type: "handover" | "lead_change" | "reassignment" | string;
  transfer_status: "pending" | "approved" | "rejected" | "completed" | "cancelled" | string;
  transfer_reason: string;
  initiated_by_user_id: string;
  initiated_at: string;
  decided_by_user_id: string | null;
  decided_at: string | null;
  completed_at: string | null;
  decision_notes: string | null;
}

export interface CaseTransferRequestPayload {
  from_bureau_assignment_id: string;
  to_bureau_id: string;
  transfer_type: "handover" | "lead_change" | "reassignment";
  reason: string;
}

export interface CaseTransferDecisionPayload {
  decision: "approved" | "rejected" | "cancelled";
  decision_notes?: string;
}

export interface CaseAccessRequestItem {
  request_id: string;
  case_id: string;
  case_number: string;
  institution_name: string;
  requester_user_id: string;
  requester_name: string;
  requesting_bureau_id: string | null;
  requesting_bureau_name: string | null;
  requested_access_level: "details" | "collaborate" | string;
  request_reason: string;
  request_status: "pending" | "approved" | "rejected" | "cancelled" | string;
  requested_at: string;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  decision_reason: string | null;
}

export interface CaseAccessRequestPayload {
  access_level: "details" | "collaborate";
  reason: string;
  requesting_bureau_id?: string | null;
}

export interface CaseAccessRequestDecisionPayload {
  decision: "approved" | "rejected";
  decision_reason: string;
  expires_at?: string | null;
}

export interface CaseAccessGrantItem {
  grant_id: string;
  case_id: string;
  grantee_user_id: string;
  grantee_name: string;
  access_request_id: string | null;
  access_level: string;
  grant_reason: string;
  granted_by_user_id: string;
  granted_by_name: string;
  granted_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  revocation_reason: string | null;
  is_active: boolean;
}

export interface CaseAccessGrantRevokePayload {
  revocation_reason: string;
}



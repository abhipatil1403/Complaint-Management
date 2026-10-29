/**
 * AICTE OneDesk — Frontend Simulation Layer Types
 *
 * Fully typed schema modeling the canonical 32-table database design and PRD v1.1
 * business workflows for local in-browser simulation.
 */

export type CaseStatus =
  | "new"
  | "under_review"
  | "assigned"
  | "in_progress"
  | "awaiting_information"
  | "resolved"
  | "closed"
  | "reopened";

export type CasePriority = "low" | "normal" | "high" | "critical";
export type CaseVisibility = "restricted" | "confidential";
export type VerificationStatus = "pending" | "verified" | "rejected";
export type IntakeChannel =
  | "aicte_portal"
  | "cpgrams"
  | "email"
  | "physical"
  | "rti";

export interface Persona {
  id: string;
  key: string;
  name: string;
  email: string;
  designation: string;
  roleName: string;
  roleCode: string;
  scopeType: "global" | "bureau";
  bureauId: string | null;
  bureauCode: string | null;
  bureauName: string | null;
  permissions: string[];
  avatarBg: string;
}

export interface SimRegion {
  id: string;
  code: string;
  name: string;
  description: string;
  is_active: boolean;
}

export interface SimBureau {
  id: string;
  code: string;
  name: string;
  description: string;
  is_active: boolean;
  lead_name: string;
  lead_email: string;
  case_count: number;
}

export interface SimBureauMember {
  id: string;
  bureau_id: string;
  user_id: string;
  full_name: string;
  email: string;
  designation: string;
  membership_type: "head" | "coordinator" | "member";
  is_active: boolean;
  assigned_cases_count: number;
}

export interface SimInstitution {
  id: string;
  aicte_permanent_id: string;
  official_name: string;
  institution_type: string;
  ownership_type: string;
  region_id: string;
  region_name: string;
  city: string;
  state: string;
  contact_email: string;
  contact_phone: string;
  website_url: string;
  verification_status: VerificationStatus;
  aliases: string[];
  is_active: boolean;
}

export interface SimCategory {
  id: string;
  code: string;
  name: string;
  description: string;
  default_priority: CasePriority;
  sla_response_hours: number;
  sla_resolution_days: number;
  assigned_bureau_code: string;
  is_active: boolean;
}

export interface SimSubmissionAttachment {
  id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  data_url?: string;
  uploaded_at: string;
}

export interface SimPublicMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  direction: "staff" | "complainant";
  body: string;
  created_at: string;
}
export interface SimSubmission {
  id: string;
  submission_number: string;
  submitter_reference?: string;
  source_metadata?: {
    public_messages?: SimPublicMessage[];
    portal_reference?: string;
  };
  tracking_code: string;
  channel: IntakeChannel;
  complainant_name: string;
  complainant_email: string;
  complainant_phone: string;
  complainant_category: string;
  institution_name_submitted: string;
  institution_permanent_id_submitted?: string;
  matched_institution_id?: string;
  institution_verified: boolean;
  category_id?: string;
  category_name?: string;
  subject: string;
  description: string;
  relief_sought?: string;
  language: "en" | "hi";
  status:
    | "received"
    | "under_verification"
    | "duplicate_review"
    | "canonical_case_created"
    | "rejected";
  canonical_case_id?: string;
  canonical_case_number?: string;
  attachments: SimSubmissionAttachment[];
  received_at: string;
  updated_at: string;
}

export interface SimVerificationTask {
  id: string;
  submission_id: string;
  submission_number: string;
  submitted_name: string;
  submitted_pid?: string;
  submitted_city?: string;
  submitted_state?: string;
  candidate_institution_id?: string;
  candidate_institution_name?: string;
  match_confidence: number;
  verification_status:
    | "pending"
    | "verified"
    | "rejected"
    | "correction_requested";
  verified_institution_id?: string;
  review_notes?: string;
  reviewer_name?: string;
  created_at: string;
  updated_at: string;
}

export interface SimDuplicateCandidate {
  id: string;
  candidate_id: string;
  submission_id: string;
  submission_number: string;
  submission_subject: string;
  submission_body: string;
  submission_institution_name: string;
  submission_received_at: string;
  candidate_case_id: string;
  case_number: string;
  case_title: string;
  case_status: CaseStatus;
  case_institution_name: string;
  similarity_score: number;
  matching_method: string;
  matching_signals: {
    institution_match: boolean;
    category_match: boolean;
    title_similarity: number;
    description_similarity: number;
    keyword_overlap: string[];
  };
  review_status:
    | "pending"
    | "confirmed_duplicate"
    | "not_duplicate"
    | "related";
  review_notes?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
}

export interface SimCaseActionHistory {
  action_id: string;
  action_type: string;
  action_description: string;
  previous_status?: string;
  new_status?: string;
  actor_name: string;
  actor_role: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface SimCaseNote {
  note_id: string;
  case_id: string;
  author_id: string;
  author_name: string;
  author_role: string;
  bureau_id?: string;
  bureau_name?: string;
  note_text: string;
  visibility: "shared" | "bureau_private";
  note_type: "general" | "internal_review" | "resolution" | "handover";
  is_pinned: boolean;
  created_at: string;
}

export interface SimCaseAttachment {
  attachment_id: string;
  case_id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  attachment_type: string;
  description?: string;
  uploaded_by_name: string;
  uploaded_at: string;
  data_url: string;
  is_quarantined: boolean;
  quarantine_reason?: string;
}

export interface SimCollaboratingBureau {
  bureau_id: string;
  bureau_code: string;
  bureau_name: string;
  assignment_type: "lead" | "collaborating";
  assignment_status: "active" | "completed" | "cancelled";
  assigned_at: string;
}

export interface SimOfficerAssignment {
  officer_assignment_id: string;
  bureau_id: string;
  bureau_name: string;
  officer_id: string;
  officer_name: string;
  role: "lead_officer" | "supporting" | "reviewer";
  status: "active" | "completed" | "revoked";
  assigned_at: string;
  notes?: string;
}

export interface SimAccessGrant {
  grant_id: string;
  case_id: string;
  case_number: string;
  grantee_bureau_id: string;
  grantee_bureau_name: string;
  grantee_user_id?: string;
  grantee_user_name?: string;
  access_level: "details" | "collaborate";
  justification: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  requested_at: string;
  granted_at?: string;
  granted_by?: string;
  expires_at?: string;
  revocation_reason?: string;
}

export interface SimCaseTransfer {
  transfer_id: string;
  case_id: string;
  case_number: string;
  from_bureau_id: string;
  from_bureau_name: string;
  to_bureau_id: string;
  to_bureau_name: string;
  transfer_type: "handover" | "lead_change" | "reassignment";
  reason: string;
  status: "pending" | "approved" | "rejected";
  requested_by: string;
  requested_at: string;
  reviewed_by?: string;
  reviewed_at?: string;
}

export interface SimEscalation {
  escalation_id: string;
  case_id: string;
  case_number: string;
  case_title: string;
  lead_bureau_name: string;
  level: 1 | 2 | 3;
  level_name: string;
  target_authority: string;
  breach_hours: number;
  reason: string;
  status: "active" | "acknowledged" | "resolved";
  triggered_at: string;
  acknowledged_at?: string;
  acknowledged_by?: string;
  resolution_notes?: string;
}

export interface SimCase {
  case_id: string;
  case_number: string;
  title: string;
  description: string;
  institution_id: string;
  institution_name: string;
  institution_code?: string;
  institution_region?: string;
  category_id: string;
  category_name: string;
  status: CaseStatus;
  priority: CasePriority;
  visibility: CaseVisibility;
  source_submission_id: string;
  source_tracking_code?: string;
  lead_bureau_id: string;
  lead_bureau_code: string;
  lead_bureau_name: string;
  opened_at: string;
  target_resolution_date: string;
  closed_at?: string;
  collaborating_bureaus: SimCollaboratingBureau[];
  officer_assignments: SimOfficerAssignment[];
  notes: SimCaseNote[];
  attachments: SimCaseAttachment[];
  action_history: SimCaseActionHistory[];
  related_cases: Array<{
    relationship_id: string;
    related_case_id: string;
    related_case_number: string;
    related_case_title: string;
    relationship_type: string;
    description?: string | null;
    created_at: string;
  }>;
  last_action_taken?: string;
  last_action_date?: string;
  next_action_required?: string;
  ai_summary?: string;
  ai_confidence_score?: number;
  ai_sentiment_urgency?: string;
  ai_suggested_next_action?: string;
  ai_detected_category?: string;
  created_at: string;
  updated_at: string;
}

export interface SimNotification {
  id: string;
  type:
    | "assignment"
    | "status_change"
    | "verification"
    | "duplicate"
    | "access_request"
    | "transfer"
    | "sla_warning"
    | "escalation"
    | "resolution"
    | "overlap_alert";
  title: string;
  message: string;
  link_to?: string;
  case_id?: string;
  bureau_id?: string;
  target_role?: string;
  target_user_id?: string;
  is_read: boolean;
  created_at: string;
}

export interface SimState {
  simulatedClock: string; // ISO string representing simulated "now"
  activePersonaKey: string;
  personas: Record<string, Persona>;
  regions: SimRegion[];
  bureaus: SimBureau[];
  bureauMembers: SimBureauMember[];
  institutions: SimInstitution[];
  categories: SimCategory[];
  submissions: SimSubmission[];
  verificationTasks: SimVerificationTask[];
  duplicateCandidates: SimDuplicateCandidate[];
  cases: SimCase[];
  accessGrants: SimAccessGrant[];
  transfers: SimCaseTransfer[];
  escalations: SimEscalation[];
  notifications: SimNotification[];
}

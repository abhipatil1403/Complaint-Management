/** Helpers and labels for Phase 2.2 human institution verification. */

import type {
  VerificationAction,
  VerificationPriority,
  VerificationRoundType,
  VerificationTaskStatus,
} from "../types";

export const TASK_STATUS_LABELS: Record<VerificationTaskStatus, string> = {
  pending: "Pending",
  in_review: "In Review",
  verified: "Verified",
  rejected: "Rejected",
};

export function taskStatusLabel(status: VerificationTaskStatus | string): string {
  return TASK_STATUS_LABELS[status as VerificationTaskStatus] ?? status.replace(/_/g, " ");
}

export const TASK_STATUS_VARIANTS: Record<
  VerificationTaskStatus,
  "neutral" | "warning" | "success" | "danger"
> = {
  pending: "warning",
  in_review: "neutral",
  verified: "success",
  rejected: "danger",
};

export const PRIORITY_LABELS: Record<VerificationPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  critical: "Critical",
};

export function priorityLabel(priority: VerificationPriority | string): string {
  return PRIORITY_LABELS[priority as VerificationPriority] ?? priority;
}

export const EVIDENCE_LABELS: Record<string, string> = {
  exact_permanent_id: "Permanent ID match (E1)",
  exact_official_name: "Exact official name match (E2)",
  exact_verified_alias: "Verified alias match (E3)",
  name_contains: "Name containment (E4 - Advisory)",
};

export function evidenceLabel(evidenceCode: string): string {
  return EVIDENCE_LABELS[evidenceCode] ?? evidenceCode.replace(/_/g, " ");
}

export const ROUND_TYPE_LABELS: Record<VerificationRoundType, string> = {
  new_round: "Initial verification",
  correction: "Correction round",
};

export function roundTypeLabel(roundType: VerificationRoundType | string): string {
  return ROUND_TYPE_LABELS[roundType as VerificationRoundType] ?? roundType.replace(/_/g, " ");
}

export const ACTION_LABELS: Record<VerificationAction, string> = {
  confirm: "Confirm association",
  reject: "Reject match (no institution)",
  request_information: "Request information / add notes",
  assign_to_me: "Assign to me",
  unassign: "Unassign",
};

/** Helpers and labels for Phase 2.3, Phase 3, and Phase 4 Cases. */

export const CASE_STATUS_LABELS: Record<string, string> = {
  new: "New",
  under_review: "Under Review",
  assigned: "Assigned",
  in_progress: "In Progress",
  awaiting_information: "Awaiting Information",
  resolved: "Resolved",
  closed: "Closed",
  reopened: "Reopened",
  // Legacy/Fallback aliases
  open: "Open",
  escalated: "Escalated",
};

export function caseStatusLabel(status: string): string {
  return CASE_STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export const CASE_STATUS_VARIANTS: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  new: "warning",
  under_review: "warning",
  assigned: "neutral",
  in_progress: "neutral",
  awaiting_information: "warning",
  resolved: "success",
  closed: "neutral",
  reopened: "danger",
  // Fallbacks
  open: "warning",
  escalated: "danger",
};

export const SEVERITY_LABELS: Record<string, string> = {
  low: "Low",
  normal: "Normal",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export function severityLabel(severity: string): string {
  return SEVERITY_LABELS[severity] ?? severity;
}

export const SEVERITY_VARIANTS: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  low: "neutral",
  normal: "neutral",
  medium: "warning",
  high: "danger",
  critical: "danger",
};

export const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  new: ["under_review", "assigned"],
  under_review: ["assigned", "in_progress", "awaiting_information"],
  assigned: ["in_progress", "awaiting_information", "under_review"],
  in_progress: ["awaiting_information", "resolved", "closed"],
  awaiting_information: ["in_progress", "under_review"],
  resolved: ["closed", "reopened"],
  closed: ["reopened"],
  reopened: ["under_review", "assigned", "in_progress"],
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

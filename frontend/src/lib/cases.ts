/** Helpers and labels for Phase 2.3 Cases. */

export const CASE_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  under_review: "Under Review",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};

export function caseStatusLabel(status: string): string {
  return CASE_STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export const CASE_STATUS_VARIANTS: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  open: "warning",
  under_review: "neutral",
  escalated: "danger",
  resolved: "success",
  closed: "neutral",
};

export const SEVERITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export function severityLabel(severity: string): string {
  return SEVERITY_LABELS[severity] ?? severity;
}

export const SEVERITY_VARIANTS: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  low: "neutral",
  medium: "warning",
  high: "danger",
  critical: "danger",
};

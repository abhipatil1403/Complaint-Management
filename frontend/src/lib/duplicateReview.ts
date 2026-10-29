/** Helpers and labels for Phase 2.3 duplicate review and canonical case creation. */

import type { DuplicateReviewDecision } from "../types";

export const DUPLICATE_STATUS_LABELS: Record<string, string> = {
  pending: "Pending Review",
  confirmed_duplicate: "Confirmed Duplicate",
  not_duplicate: "Not Duplicate",
  related: "Related Case",
  superseded: "Superseded",
};

export function duplicateStatusLabel(status: string): string {
  return DUPLICATE_STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export const DUPLICATE_STATUS_VARIANTS: Record<
  string,
  "neutral" | "warning" | "success" | "danger"
> = {
  pending: "warning",
  confirmed_duplicate: "danger",
  not_duplicate: "success",
  related: "neutral",
  superseded: "neutral",
};

export const HEURISTIC_SCORE_BADGES: Record<string, { label: string; variant: "danger" | "warning" | "neutral" }> = {
  "1.00": { label: "Rule H1: Exact Identifier (1.00)", variant: "danger" },
  "0.90": { label: "Rule H2: Subject & Period (0.90)", variant: "warning" },
  "0.60": { label: "Rule H3: Same Institution (0.60)", variant: "neutral" },
};

export function heuristicLabel(score: number): string {
  const key = score.toFixed(2);
  return HEURISTIC_SCORE_BADGES[key]?.label ?? `Heuristic Match (${score.toFixed(2)})`;
}

export const DECISION_LABELS: Record<DuplicateReviewDecision, string> = {
  confirmed_duplicate: "Confirm Duplicate (Attach to Case)",
  not_duplicate: "Mark Not Duplicate",
  related: "Mark Related Case",
};

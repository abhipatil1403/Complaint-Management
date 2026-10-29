import { describe, expect, it } from "vitest";

import {
  DECISION_LABELS,
  DUPLICATE_STATUS_LABELS,
  DUPLICATE_STATUS_VARIANTS,
  duplicateStatusLabel,
  HEURISTIC_SCORE_BADGES,
  heuristicLabel,
} from "../lib/duplicateReview";

describe("Duplicate Review helpers", () => {
  it("formats candidate review statuses accurately", () => {
    expect(duplicateStatusLabel("pending")).toBe("Pending Review");
    expect(duplicateStatusLabel("confirmed_duplicate")).toBe("Confirmed Duplicate");
    expect(duplicateStatusLabel("not_duplicate")).toBe("Not Duplicate");
    expect(duplicateStatusLabel("related")).toBe("Related Case");
    expect(duplicateStatusLabel("superseded")).toBe("Superseded");
    expect(DUPLICATE_STATUS_LABELS.pending).toBe("Pending Review");
    expect(DUPLICATE_STATUS_LABELS.related).toBe("Related Case");
    expect(DUPLICATE_STATUS_VARIANTS.pending).toBe("warning");
    expect(DUPLICATE_STATUS_VARIANTS.confirmed_duplicate).toBe("danger");
    expect(DUPLICATE_STATUS_VARIANTS.not_duplicate).toBe("success");
    expect(DUPLICATE_STATUS_VARIANTS.related).toBe("neutral");
  });

  it("formats heuristic score tiers and labels accurately", () => {
    expect(heuristicLabel(1.0)).toBe("Rule H1: Exact Identifier (1.00)");
    expect(heuristicLabel(0.9)).toBe("Rule H2: Subject & Period (0.90)");
    expect(heuristicLabel(0.6)).toBe("Rule H3: Same Institution (0.60)");
    expect(heuristicLabel(0.45)).toBe("Heuristic Match (0.45)");
    expect(HEURISTIC_SCORE_BADGES["1.00"].variant).toBe("danger");
    expect(HEURISTIC_SCORE_BADGES["0.90"].variant).toBe("warning");
    expect(HEURISTIC_SCORE_BADGES["0.60"].variant).toBe("neutral");
  });

  it("provides labels for all supported human review decisions", () => {
    expect(DECISION_LABELS.confirmed_duplicate).toContain("Confirm Duplicate");
    expect(DECISION_LABELS.not_duplicate).toBe("Mark Not Duplicate");
    expect(DECISION_LABELS.related).toBe("Mark Related Case");
  });
});

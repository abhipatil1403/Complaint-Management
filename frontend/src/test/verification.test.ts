import { describe, expect, it } from "vitest";

import {
  ACTION_LABELS,
  EVIDENCE_LABELS,
  evidenceLabel,
  PRIORITY_LABELS,
  priorityLabel,
  ROUND_TYPE_LABELS,
  roundTypeLabel,
  TASK_STATUS_LABELS,
  TASK_STATUS_VARIANTS,
  taskStatusLabel,
} from "../lib/verification";

describe("Verification helpers", () => {
  it("formats task statuses accurately", () => {
    expect(taskStatusLabel("pending")).toBe("Pending");
    expect(taskStatusLabel("in_review")).toBe("In Review");
    expect(taskStatusLabel("verified")).toBe("Verified");
    expect(taskStatusLabel("rejected")).toBe("Rejected");
    expect(TASK_STATUS_LABELS.pending).toBe("Pending");
    expect(TASK_STATUS_VARIANTS.pending).toBe("warning");
    expect(TASK_STATUS_VARIANTS.verified).toBe("success");
    expect(TASK_STATUS_VARIANTS.rejected).toBe("danger");
  });

  it("formats priority labels", () => {
    expect(priorityLabel("low")).toBe("Low");
    expect(priorityLabel("normal")).toBe("Medium");
    expect(priorityLabel("high")).toBe("High");
    expect(priorityLabel("critical")).toBe("Critical");
    expect(PRIORITY_LABELS.critical).toBe("Critical");
  });

  it("formats evidence tiers correctly", () => {
    expect(evidenceLabel("exact_permanent_id")).toBe("Permanent ID match (E1)");
    expect(evidenceLabel("exact_official_name")).toBe("Exact official name match (E2)");
    expect(evidenceLabel("exact_verified_alias")).toBe("Verified alias match (E3)");
    expect(evidenceLabel("name_contains")).toBe("Name containment (E4 - Advisory)");
    expect(EVIDENCE_LABELS.name_contains).toContain("Advisory");
  });

  it("distinguishes new rounds from correction rounds", () => {
    expect(roundTypeLabel("new_round")).toBe("Initial verification");
    expect(roundTypeLabel("correction")).toBe("Correction round");
    expect(ROUND_TYPE_LABELS.correction).toBe("Correction round");
  });

  it("provides human-readable labels for all supported decision actions", () => {
    expect(ACTION_LABELS.confirm).toBe("Confirm association");
    expect(ACTION_LABELS.reject).toBe("Reject match (no institution)");
    expect(ACTION_LABELS.request_information).toBe("Request information / add notes");
    expect(ACTION_LABELS.assign_to_me).toBe("Assign to me");
    expect(ACTION_LABELS.unassign).toBe("Unassign");
  });
});

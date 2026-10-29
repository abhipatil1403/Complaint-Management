import { describe, expect, it } from "vitest";

import {
  caseStatusLabel,
  CASE_STATUS_LABELS,
  CASE_STATUS_VARIANTS,
  formatFileSize,
  severityLabel,
  SEVERITY_LABELS,
  SEVERITY_VARIANTS,
  VALID_STATUS_TRANSITIONS,
} from "../lib/cases";

describe("Cases helpers (Phase 3 & 4)", () => {
  it("formats canonical case statuses accurately for all 8 database statuses", () => {
    expect(caseStatusLabel("new")).toBe("New");
    expect(caseStatusLabel("under_review")).toBe("Under Review");
    expect(caseStatusLabel("assigned")).toBe("Assigned");
    expect(caseStatusLabel("in_progress")).toBe("In Progress");
    expect(caseStatusLabel("awaiting_information")).toBe("Awaiting Information");
    expect(caseStatusLabel("resolved")).toBe("Resolved");
    expect(caseStatusLabel("closed")).toBe("Closed");
    expect(caseStatusLabel("reopened")).toBe("Reopened");

    expect(CASE_STATUS_LABELS.new).toBe("New");
    expect(CASE_STATUS_LABELS.closed).toBe("Closed");
    expect(CASE_STATUS_VARIANTS.new).toBe("warning");
    expect(CASE_STATUS_VARIANTS.resolved).toBe("success");
    expect(CASE_STATUS_VARIANTS.reopened).toBe("danger");
  });

  it("verifies valid status transition matrix", () => {
    expect(VALID_STATUS_TRANSITIONS.new).toContain("under_review");
    expect(VALID_STATUS_TRANSITIONS.new).toContain("assigned");
    expect(VALID_STATUS_TRANSITIONS.under_review).toContain("in_progress");
    expect(VALID_STATUS_TRANSITIONS.in_progress).toContain("resolved");
    expect(VALID_STATUS_TRANSITIONS.resolved).toContain("closed");
    expect(VALID_STATUS_TRANSITIONS.closed).toContain("reopened");
  });

  it("formats severity levels accurately", () => {
    expect(severityLabel("low")).toBe("Low");
    expect(severityLabel("normal")).toBe("Normal");
    expect(severityLabel("high")).toBe("High");
    expect(severityLabel("critical")).toBe("Critical");
    expect(SEVERITY_LABELS.critical).toBe("Critical");
    expect(SEVERITY_VARIANTS.critical).toBe("danger");
    expect(SEVERITY_VARIANTS.normal).toBe("neutral");
  });

  it("formats evidence file sizes correctly", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(1048576 * 2.5)).toBe("2.5 MB");
  });
});

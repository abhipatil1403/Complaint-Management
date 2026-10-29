import { describe, expect, it } from "vitest";

import {
  caseStatusLabel,
  CASE_STATUS_LABELS,
  CASE_STATUS_VARIANTS,
  severityLabel,
  SEVERITY_LABELS,
  SEVERITY_VARIANTS,
} from "../lib/cases";

describe("Cases helpers", () => {
  it("formats canonical case statuses accurately", () => {
    expect(caseStatusLabel("open")).toBe("Open");
    expect(caseStatusLabel("under_review")).toBe("Under Review");
    expect(caseStatusLabel("escalated")).toBe("Escalated");
    expect(caseStatusLabel("resolved")).toBe("Resolved");
    expect(caseStatusLabel("closed")).toBe("Closed");
    expect(CASE_STATUS_LABELS.open).toBe("Open");
    expect(CASE_STATUS_VARIANTS.open).toBe("warning");
    expect(CASE_STATUS_VARIANTS.escalated).toBe("danger");
    expect(CASE_STATUS_VARIANTS.resolved).toBe("success");
  });

  it("formats severity levels accurately", () => {
    expect(severityLabel("low")).toBe("Low");
    expect(severityLabel("medium")).toBe("Medium");
    expect(severityLabel("high")).toBe("High");
    expect(severityLabel("critical")).toBe("Critical");
    expect(SEVERITY_LABELS.critical).toBe("Critical");
    expect(SEVERITY_VARIANTS.critical).toBe("danger");
    expect(SEVERITY_VARIANTS.medium).toBe("warning");
  });
});

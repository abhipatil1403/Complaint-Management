import { beforeEach, describe, expect, it } from "vitest";
import { simulationStore } from "../simulation/simulationStore";
import {
  getAllOverlappingCases,
  getCaseAgeDays,
  getOverlappingCases,
  getPendingAgeingBuckets,
  getRegionDisposalStats,
} from "../simulation/selectors";

describe("SIH Problem Statement 26264 — Integrated Dashboard & Overlap Tracking", () => {
  beforeEach(() => {
    simulationStore.resetPresentationData();
  });

  it("seeds Regulation Bureau (RB) and Public Grievance Redressal Cell (PGRC)", () => {
    const state = simulationStore.getState();
    const rb = state.bureaus.find((b) => b.code === "BUR-RB");
    const pgrc = state.bureaus.find((b) => b.code === "BUR-PGRC");

    expect(rb).toBeDefined();
    expect(rb?.name).toBe("Regulation Bureau");
    expect(pgrc).toBeDefined();
    expect(pgrc?.name).toBe("Public Grievance Redressal Cell");

    // Personas check
    expect(state.personas.bureau_admin_rb).toBeDefined();
    expect(state.personas.bureau_admin_rb.bureauCode).toBe("BUR-RB");
    expect(state.personas.case_officer_pgrc).toBeDefined();
    expect(state.personas.case_officer_pgrc.bureauCode).toBe("BUR-PGRC");
  });

  it("automatically detects cross-bureau overlapping cases for the same institution (DTU)", () => {
    const state = simulationStore.getState();

    // Find the pre-seeded cases for DTU (inst-001)
    const pgrcCase = state.cases.find((c) => c.case_id === "case-009-pgrc")!;
    const rbCase = state.cases.find((c) => c.case_id === "case-010-rb")!;

    expect(pgrcCase).toBeDefined();
    expect(rbCase).toBeDefined();
    expect(pgrcCase.institution_id).toBe(rbCase.institution_id);
    expect(pgrcCase.lead_bureau_id).not.toBe(rbCase.lead_bureau_id);

    // Test getOverlappingCases selector for PGRC case
    const overlapsForPgrc = getOverlappingCases(state, pgrcCase.case_id);
    expect(overlapsForPgrc.length).toBeGreaterThan(0);
    expect(overlapsForPgrc.some((c) => c.case_id === rbCase.case_id)).toBe(true);

    // Test getOverlappingCases selector for RB case
    const overlapsForRb = getOverlappingCases(state, rbCase.case_id);
    expect(overlapsForRb.length).toBeGreaterThan(0);
    expect(overlapsForRb.some((c) => c.case_id === pgrcCase.case_id)).toBe(true);

    // Test getAllOverlappingCases
    const allOverlaps = getAllOverlappingCases(state);
    expect(allOverlaps.some((c) => c.case_id === pgrcCase.case_id)).toBe(true);
    expect(allOverlaps.some((c) => c.case_id === rbCase.case_id)).toBe(true);
  });

  it("initiates inter-bureau joint review, updating collaboration, notes, audit, and notifications", () => {
    simulationStore.switchPersona("super_admin");
    const stateBefore = simulationStore.getState();
    const caseA = stateBefore.cases.find((c) => c.case_id === "case-009-pgrc")!;
    const caseB = stateBefore.cases.find((c) => c.case_id === "case-010-rb")!;

    expect(caseA.collaborating_bureaus.some((b) => b.bureau_id === caseB.lead_bureau_id)).toBe(
      false,
    );
    expect(caseB.collaborating_bureaus.some((b) => b.bureau_id === caseA.lead_bureau_id)).toBe(
      false,
    );

    // Execute 1-click joint review initiation
    simulationStore.initiateJointReview(caseA.case_id, caseB.case_id);

    const stateAfter = simulationStore.getState();
    const updatedA = stateAfter.cases.find((c) => c.case_id === "case-009-pgrc")!;
    const updatedB = stateAfter.cases.find((c) => c.case_id === "case-010-rb")!;

    // Both cases now have reciprocal collaborating bureau assignments
    expect(updatedA.collaborating_bureaus.some((b) => b.bureau_id === caseB.lead_bureau_id)).toBe(
      true,
    );
    expect(updatedB.collaborating_bureaus.some((b) => b.bureau_id === caseA.lead_bureau_id)).toBe(
      true,
    );

    // Audit logs recorded on both cases
    expect(
      updatedA.action_history.some((a) => a.action_type === "joint_review_initiated"),
    ).toBe(true);
    expect(
      updatedB.action_history.some((a) => a.action_type === "joint_review_initiated"),
    ).toBe(true);

    // Notes added to both cases
    expect(
      updatedA.notes.some((n) => n.note_text.includes("Inter-Bureau Joint Review")),
    ).toBe(true);
    expect(
      updatedB.notes.some((n) => n.note_text.includes("Inter-Bureau Joint Review")),
    ).toBe(true);

    // Overlap alert notification dispatched
    expect(
      stateAfter.notifications.some(
        (n) => n.type === "overlap_alert" && n.case_id === caseA.case_id,
      ),
    ).toBe(true);
  });

  it("calculates pending case ageing analysis into 4 standard statutory brackets", () => {
    const state = simulationStore.getState();
    const ageing = getPendingAgeingBuckets(state);

    expect(ageing.totalActive).toBeGreaterThan(0);
    const sumBuckets =
      ageing.under7.length +
      ageing.from7to15.length +
      ageing.from15to30.length +
      ageing.over30.length;

    expect(sumBuckets).toBe(ageing.totalActive);

    // Individual case age calculation
    for (const c of ageing.under7) {
      expect(getCaseAgeDays(c, state.simulatedClock)).toBeLessThan(7);
    }
  });

  it("computes region-wise disposal reports across all regional offices", () => {
    const state = simulationStore.getState();
    const regionStats = getRegionDisposalStats(state);

    expect(regionStats.length).toBe(state.regions.length);
    for (const reg of regionStats) {
      expect(reg.regionName).toBeDefined();
      expect(reg.disposalRate).toBeGreaterThanOrEqual(0);
      expect(reg.disposalRate).toBeLessThanOrEqual(100);
      expect(reg.total).toBe(reg.active + reg.resolved);
    }
  });

  it("centralized institution profile consolidates all grievance and regulatory history", () => {
    const state = simulationStore.getState();
    const dtuCases = state.cases.filter(
      (c) =>
        c.institution_id === "inst-001" ||
        c.institution_code === "1-1002345671" ||
        c.institution_name.includes("Delhi Technological University"),
    );

    // DTU has multiple active cases across distinct bureaus (Regulation Bureau, PGRC, Approval)
    expect(dtuCases.length).toBeGreaterThanOrEqual(2);
    const bureausInvolved = new Set(dtuCases.map((c) => c.lead_bureau_code));
    expect(bureausInvolved.size).toBeGreaterThanOrEqual(2);
  });
});

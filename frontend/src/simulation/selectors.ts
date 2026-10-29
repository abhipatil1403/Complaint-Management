import { useSyncExternalStore } from "react";
import { simulationStore } from "./simulationStore";
import { canReadCase } from "./scope";
export { canReadCase, canActOnCase } from "./scope";
import type { Persona, SimCase, SimState } from "./types";

// The engine mutates records in place. Use a revision snapshot for React subscribers.
let revision = 0;
simulationStore.subscribe(() => {
  revision += 1;
});
export function useSimulationRevision() {
  return useSyncExternalStore(
    (listener) => simulationStore.subscribe(listener),
    () => revision,
  );
}
export function useSimulation() {
  useSimulationRevision();
  return simulationStore.getState();
}
export const isResolved = (c: SimCase) =>
  c.status === "resolved" || c.status === "closed";
export function visibleNotifications(state: SimState, actor: Persona) {
  return state.notifications
    .filter(
      (n) =>
        (!n.target_user_id || n.target_user_id === actor.id) &&
        (!n.target_role ||
          n.target_role === actor.roleCode ||
          n.target_role === actor.key) &&
        (!n.bureau_id ||
          actor.scopeType === "global" ||
          n.bureau_id === actor.bureauId),
    )
    .map((n) => {
      const c = state.cases.find((c) => c.case_id === n.case_id);
      return c && !canReadCase(c, actor, state)
        ? {
            ...n,
            title: `Case ${c.case_number} updated`,
            message:
              "A case-index update is available. Request access to view case content.",
          }
        : n;
    });
}
export function reporting(state: SimState, days?: number) {
  const now = Date.parse(state.simulatedClock);
  const start = days ? now - days * 86400000 : -Infinity;
  const cases = state.cases.filter(
    (c) => Date.parse(c.opened_at) >= start && Date.parse(c.opened_at) <= now,
  );
  const submissions = state.submissions.filter(
    (s) =>
      Date.parse(s.received_at) >= start && Date.parse(s.received_at) <= now,
  );
  const resolved = cases.filter(isResolved);
  const overdue = cases.filter(
    (c) => !isResolved(c) && Date.parse(c.target_resolution_date) < now,
  );
  const assessed = cases.filter((c) =>
    Number.isFinite(Date.parse(c.target_resolution_date)),
  );
  const compliant = assessed.filter(
    (c) =>
      Date.parse(c.target_resolution_date) >=
      (isResolved(c) ? Date.parse(c.closed_at || c.updated_at) : now),
  );
  const rate = assessed.length
    ? Math.round((compliant.length / assessed.length) * 100)
    : null;
  const cycle = resolved.length
    ? resolved.reduce(
        (sum, c) =>
          sum +
          Math.max(
            0,
            Date.parse(c.closed_at || c.updated_at) - Date.parse(c.opened_at),
          ),
        0,
      ) /
      resolved.length /
      86400000
    : null;
  const period = days || 30;
  const buckets = Array.from({ length: 7 }, (_, i) => {
    const from = now - period * 86400000 + (i * period * 86400000) / 7;
    const to = now - period * 86400000 + ((i + 1) * period * 86400000) / 7;
    return {
      label: new Date(from).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        timeZone: "Asia/Kolkata",
      }),
      intake: state.submissions.filter(
        (s) =>
          Date.parse(s.received_at) > from && Date.parse(s.received_at) <= to,
      ).length,
      resolved: state.cases.filter(
        (c) =>
          isResolved(c) &&
          Date.parse(c.closed_at || c.updated_at) > from &&
          Date.parse(c.closed_at || c.updated_at) <= to,
      ).length,
    };
  });
  return {
    cases,
    submissions,
    resolved,
    overdue,
    rate,
    cycle,
    buckets,
    active: cases.filter((c) => !isResolved(c)),
  };
}

/**
 * Returns any active case in a DIFFERENT lead bureau that concerns the same institution.
 * (Problem Statement 26264: Cross-Bureau Overlap Detection)
 */
export function getOverlappingCases(
  state: SimState,
  targetCaseId: string,
): SimCase[] {
  const target = state.cases.find(
    (c) => c.case_id === targetCaseId || c.case_number === targetCaseId,
  );
  if (!target || isResolved(target)) return [];

  return state.cases.filter((c) => {
    if (c.case_id === target.case_id) return false;
    if (isResolved(c)) return false;
    if (c.lead_bureau_id === target.lead_bureau_id) return false;

    // Match by institution ID or AICTE Permanent Code or matching names
    const sameInstitution =
      (Boolean(target.institution_id) && c.institution_id === target.institution_id) ||
      (Boolean(target.institution_code) && c.institution_code === target.institution_code) ||
      (Boolean(target.institution_name) &&
        c.institution_name.toLowerCase().trim() ===
          target.institution_name.toLowerCase().trim());

    return sameInstitution;
  });
}

/**
 * Returns all active cases that currently overlap with an active case from another bureau.
 */
export function getAllOverlappingCases(state: SimState): SimCase[] {
  const activeCases = state.cases.filter((c) => !isResolved(c));
  const overlappingSet = new Set<string>();

  for (const c of activeCases) {
    const overlaps = getOverlappingCases(state, c.case_id);
    if (overlaps.length > 0) {
      overlappingSet.add(c.case_id);
      for (const o of overlaps) {
        overlappingSet.add(o.case_id);
      }
    }
  }

  return activeCases.filter((c) => overlappingSet.has(c.case_id));
}

/**
 * Returns age in days from case opened_at to simulatedClock.
 */
export function getCaseAgeDays(caseItem: SimCase, clock: string): number {
  const now = Date.parse(clock);
  const opened = Date.parse(caseItem.opened_at);
  if (isNaN(opened) || isNaN(now)) return 0;
  return Math.max(0, Math.floor((now - opened) / 86400000));
}

/**
 * Government audit pending case ageing brackets (< 7 Days, 7–15 Days, 15–30 Days, > 30 Days).
 */
export function getPendingAgeingBuckets(state: SimState) {
  const clock = state.simulatedClock;
  const activeCases = state.cases.filter((c) => !isResolved(c));

  const under7: SimCase[] = [];
  const from7to15: SimCase[] = [];
  const from15to30: SimCase[] = [];
  const over30: SimCase[] = [];

  for (const c of activeCases) {
    const age = getCaseAgeDays(c, clock);
    if (age < 7) {
      under7.push(c);
    } else if (age <= 15) {
      from7to15.push(c);
    } else if (age <= 30) {
      from15to30.push(c);
    } else {
      over30.push(c);
    }
  }

  return {
    totalActive: activeCases.length,
    under7,
    from7to15,
    from15to30,
    over30,
  };
}

/**
 * Regional disposal and grievance performance statistics.
 */
export function getRegionDisposalStats(state: SimState) {
  const clock = Date.parse(state.simulatedClock);

  return state.regions.map((reg) => {
    const regCases = state.cases.filter(
      (c) =>
        c.institution_region === reg.name ||
        c.institution_region?.toLowerCase().includes(reg.code.replace("REG-", "").toLowerCase()),
    );
    const total = regCases.length;
    const resolved = regCases.filter(isResolved).length;
    const active = regCases.filter((c) => !isResolved(c)).length;
    const overdue = regCases.filter(
      (c) => !isResolved(c) && Date.parse(c.target_resolution_date) < clock,
    ).length;
    const disposalRate = total > 0 ? Math.round((resolved / total) * 100) : 100;

    return {
      regionId: reg.id,
      regionCode: reg.code,
      regionName: reg.name,
      total,
      active,
      resolved,
      overdue,
      disposalRate,
    };
  });
}

export function exportCsv(name: string, rows: unknown[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((value) => {
          const raw = String(value ?? "");
          return `"${(/^[=+@-]/.test(raw) ? "'" : "") + raw.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

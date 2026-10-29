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

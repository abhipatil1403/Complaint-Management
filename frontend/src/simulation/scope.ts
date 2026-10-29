import type { Persona, SimCase, SimState, SimSubmission } from "./types";
export function belongsToBureau(c: SimCase, bureauId: string | null) {
  return (
    !!bureauId &&
    (c.lead_bureau_id === bureauId ||
      c.collaborating_bureaus.some(
        (b) => b.bureau_id === bureauId && b.assignment_status === "active",
      ))
  );
}
export function hasBureauMembership(actor: Persona, state: SimState) {
  return (
    !!actor.bureauId &&
    state.bureauMembers.some(
      (m) =>
        m.bureau_id === actor.bureauId && m.user_id === actor.id && m.is_active,
    )
  );
}
export function isAssigned(c: SimCase, actor: Persona, state: SimState) {
  return (
    hasBureauMembership(actor, state) &&
    c.officer_assignments.some(
      (o) =>
        o.officer_id === actor.id &&
        o.bureau_id === actor.bureauId &&
        o.status === "active",
    )
  );
}
function hasGrant(c: SimCase, actor: Persona, state: SimState, write = false) {
  return state.accessGrants.some(
    (g) =>
      g.case_id === c.case_id &&
      g.status === "approved" &&
      (!write || g.access_level === "collaborate") &&
      (g.grantee_user_id
        ? g.grantee_user_id === actor.id
        : g.grantee_bureau_id === actor.bureauId &&
          hasBureauMembership(actor, state)) &&
      (!g.expires_at ||
        Date.parse(g.expires_at) > Date.parse(state.simulatedClock)),
  );
}
export function canReadCase(c: SimCase, actor: Persona, state: SimState) {
  if (!actor.permissions.includes("case.view_detail")) return false;
  if (actor.scopeType === "global") return true; // Explicit content permission, not a role-name bypass.
  if (
    actor.roleCode === "BUREAU_ADMIN" &&
    hasBureauMembership(actor, state) &&
    belongsToBureau(c, actor.bureauId)
  )
    return true;
  return isAssigned(c, actor, state) || hasGrant(c, actor, state);
}
export function canActOnCase(c: SimCase, actor: Persona, state: SimState) {
  if (!canReadCase(c, actor, state)) return false;
  if (actor.scopeType === "global") return true;
  return (
    (actor.roleCode === "BUREAU_ADMIN" &&
      hasBureauMembership(actor, state) &&
      belongsToBureau(c, actor.bureauId)) ||
    isAssigned(c, actor, state) ||
    hasGrant(c, actor, state, true)
  );
}
export function ownsSubmission(s: SimSubmission, actor: Persona) {
  return actor.roleCode === "COMPLAINANT" && s.submitter_reference === actor.id;
}
export function accessibleSubmissions(state: SimState, actor: Persona) {
  if (actor.roleCode === "COMPLAINANT")
    return state.submissions.filter((s) => ownsSubmission(s, actor));
  if (!actor.permissions.includes("submission.view")) return [];
  if (actor.scopeType === "global") return state.submissions;
  return state.submissions.filter((s) => {
    const c = state.cases.find((c) => c.case_id === s.canonical_case_id);
    if (c) return canReadCase(c, actor, state);
    return (
      actor.roleCode === "BUREAU_ADMIN" &&
      hasBureauMembership(actor, state) &&
      s.institution_verified &&
      state.categories.some(
        (category) =>
          category.id === s.category_id &&
          category.assigned_bureau_code === actor.bureauCode,
      )
    );
  });
}
export function scopedState(state: SimState, actor: Persona): SimState {
  const cases = state.cases.filter((c) => canReadCase(c, actor, state));
  const ids = new Set(cases.map((c) => c.case_id));
  const submissions =
    actor.scopeType === "global" && actor.permissions.includes("report.view")
      ? state.submissions
      : accessibleSubmissions(state, actor);
  const sourceIds = new Set(submissions.map((s) => s.id));
  return {
    ...state,
    cases,
    submissions,
    bureaus:
      actor.scopeType === "global"
        ? state.bureaus
        : state.bureaus.filter(
            (b) =>
              b.id === actor.bureauId ||
              cases.some((c) => c.lead_bureau_id === b.id),
          ),
    verificationTasks: actor.permissions.includes("institution.verify")
      ? state.verificationTasks
      : [],
    duplicateCandidates: actor.permissions.includes("duplicate.review")
      ? state.duplicateCandidates.filter((d) => sourceIds.has(d.submission_id))
      : [],
    escalations: state.escalations.filter((e) => ids.has(e.case_id)),
    transfers: state.transfers.filter((t) => ids.has(t.case_id)),
    accessGrants: state.accessGrants.filter(
      (g) => ids.has(g.case_id) || g.grantee_user_id === actor.id,
    ),
    bureauMembers:
      actor.scopeType === "global"
        ? state.bureauMembers
        : state.bureauMembers.filter((m) => m.bureau_id === actor.bureauId),
  };
}
export function landingKind(actor: Persona) {
  switch (actor.roleCode) {
    case "SUPER_ADMIN":
      return "system";
    case "BUREAU_ADMIN":
      return "bureau";
    case "CASE_OFFICER":
      return "officer";
    case "BUREAU_OFFICER":
      return "collaboration";
    case "SENIOR_MANAGEMENT":
      return "executive";
    case "AUDITOR":
      return "audit";
    case "COMPLAINANT":
      return "public";
    default:
      return actor.permissions.includes("institution.verify")
        ? "verification"
        : actor.permissions.includes("duplicate.review")
          ? "duplicates"
          : "officer";
  }
}
export function landingLabel(actor: Persona) {
  return {
    system: "System overview",
    bureau: "Bureau overview",
    officer: "My assigned work",
    collaboration: "Collaboration desk",
    executive: "Executive overview",
    audit: "Audit workspace",
    public: "My complaints",
    verification: "Verification desk",
    duplicates: "Duplicate review desk",
  }[landingKind(actor)];
}

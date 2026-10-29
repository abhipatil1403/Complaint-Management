import { Navigate, Link } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { HomePage } from "./HomePage";
import { PermissionDeniedPage } from "./PermissionDeniedPage";
import { ThroughputChart } from "../components/ThroughputChart";
import {
  useSimulation,
  reporting,
  isResolved,
  canActOnCase,
} from "../simulation/selectors";
import { landingKind, scopedState, isAssigned } from "../simulation/scope";
import type { SimCase, SimState } from "../simulation/types";

function Kpis({
  items,
}: {
  items: {
    label: string;
    value: string | number;
    to: string;
    detail: string;
  }[];
}) {
  return (
    <div className="stats-grid-4">
      {items.map((item, i) => (
        <Link
          className={`stat-card ${i === 0 ? "stat-card-hero" : ""}`}
          key={item.label}
          to={item.to}
        >
          <span className="stat-label">{item.label}</span>
          <div className="stat-value">{item.value}</div>
          <p className="stat-trend-pill">{item.detail} ↗</p>
        </Link>
      ))}
    </div>
  );
}
function CaseList({
  cases,
  state,
  empty = "No cases require action.",
}: {
  cases: SimCase[];
  state: SimState;
  empty?: string;
}) {
  return (
    <div className="role-case-list">
      {cases.length ? (
        cases.slice(0, 8).map((c) => (
          <Link key={c.case_id} to={`/cases/${c.case_id}`}>
            <div>
              <small>
                {c.case_number} · {c.lead_bureau_code}
              </small>
              <strong>{c.title}</strong>
              <span>{c.institution_name}</span>
            </div>
            <div className="role-case-status">
              <span className={`badge badge-status-${c.status}`}>
                {c.status.replace(/_/g, " ")}
              </span>
              <small>
                {isResolved(c)
                  ? "Completed"
                  : new Date(c.target_resolution_date).toLocaleDateString(
                      "en-IN",
                      {
                        day: "numeric",
                        month: "short",
                        timeZone: "Asia/Kolkata",
                      },
                    )}
                {!isResolved(c) &&
                Date.parse(c.target_resolution_date) <
                  Date.parse(state.simulatedClock)
                  ? " · Overdue"
                  : ""}
              </small>
            </div>
          </Link>
        ))
      ) : (
        <p className="empty-state">{empty}</p>
      )}
    </div>
  );
}
function Workload({ state }: { state: SimState }) {
  return (
    <div className="distribution-list">
      {state.bureauMembers
        .filter((m) => m.is_active)
        .map((m) => {
          const n = state.cases.filter(
            (c) =>
              !isResolved(c) &&
              c.officer_assignments.some(
                (o) => o.officer_id === m.user_id && o.status === "active",
              ),
          ).length;
          return (
            <Link key={m.id} to={`/cases?officer=${m.user_id}`}>
              <div className="toolbar">
                <span>{m.full_name}</span>
                <strong>{n} active</strong>
              </div>
              <progress
                max={Math.max(
                  1,
                  state.cases.filter((c) => !isResolved(c)).length,
                )}
                value={n}
              />
            </Link>
          );
        })}
    </div>
  );
}
function Activity({ state }: { state: SimState }) {
  const rows = state.cases
    .flatMap((c) =>
      c.action_history.map((a) => ({
        ...a,
        case_id: c.case_id,
        case_number: c.case_number,
      })),
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return (
    <div className="activity-list">
      {rows.slice(0, 7).map((a, i) => (
        <Link
          key={`${a.action_id}-${i}`}
          to={`/cases/${a.case_id}?tab=timeline`}
        >
          <span className="activity-dot" />
          <div>
            <strong>
              {a.case_number} · {a.action_type.replace(/_/g, " ")}
            </strong>
            <p>{a.action_description}</p>
          </div>
          <small>{a.actor_name}</small>
        </Link>
      ))}
      {!rows.length && (
        <p className="empty-state">No activity in your accessible cases.</p>
      )}
    </div>
  );
}
export function RoleLandingPage() {
  const { activePersona } = useAuth();
  switch (landingKind(activePersona)) {
    case "public":
      return <Navigate to="/portal" replace />;
    case "system":
      return <HomePage />;
    case "bureau":
      return <BureauDashboard />;
    case "executive":
      return <ExecutiveDashboard />;
    case "audit":
      return <AuditDashboard />;
    case "collaboration":
      return <CollaborationDashboard />;
    case "verification":
      return <ReviewWorkspace kind="verification" />;
    case "duplicates":
      return <ReviewWorkspace kind="duplicates" />;
    default:
      return <OfficerDashboard />;
  }
}
export function BureauDashboard() {
  const { activePersona } = useAuth();
  const raw = useSimulation();
  const state = scopedState(raw, activePersona);
  const m = reporting(state);
  const unassigned = m.active.filter(
    (c) =>
      !c.officer_assignments.some(
        (o) => o.bureau_id === activePersona.bureauId && o.status === "active",
      ),
  );
  const decisions = state.accessGrants.filter(
    (g) =>
      g.status === "pending" &&
      state.cases.some(
        (c) =>
          c.case_id === g.case_id &&
          c.lead_bureau_id === activePersona.bureauId,
      ),
  );
  const transfers = state.transfers.filter((t) => t.status === "pending");
  return (
    <section>
      <div className="page-header">
        <div>
          <div className="eyebrow">
            BUREAU ADMINISTRATION · {activePersona.bureauCode}
          </div>
          <h1>Bureau command center</h1>
          <p className="page-description">
            {activePersona.bureauName} · Ownership, staffing, and decisions for
            your bureau.
          </p>
        </div>
        <Link className="button button-primary" to="/cases">
          Manage bureau cases
        </Link>
      </div>
      <Kpis
        items={[
          {
            label: "Bureau active cases",
            value: m.active.length,
            to: "/cases?scope=active",
            detail: `${m.resolved.length} completed`,
          },
          {
            label: "Awaiting officer assignment",
            value: unassigned.length,
            to: "/cases?unassigned=true",
            detail: "Active cases without a bureau officer",
          },
          {
            label: "Overdue in your bureau",
            value: m.overdue.length,
            to: "/cases?scope=overdue",
            detail: "Configured category deadlines",
          },
          {
            label: "Pending bureau decisions",
            value: decisions.length + transfers.length,
            to: "/decisions",
            detail: `${decisions.length} access · ${transfers.length} transfers`,
          },
        ]}
      />
      <div className="dashboard-split-grid">
        <article className="card">
          <h2>Cases needing bureau action</h2>
          <CaseList
            state={state}
            cases={[...unassigned, ...m.overdue].filter(
              (c, i, a) => a.findIndex((x) => x.case_id === c.case_id) === i,
            )}
          />
        </article>
        <article className="card">
          <h2>Your officer workload</h2>
          <p className="small muted">
            Active assignments within {activePersona.bureauCode}.
          </p>
          <Workload state={state} />
        </article>
      </div>
      <div className="grid grid-2 role-workspace-columns">
        <article className="card">
          <h2>Bureau SLA</h2>
          <div className="stat-value">
            {m.rate === null ? "—" : `${m.rate}%`}
          </div>
          <p className="small muted">
            Compliance across your accessible bureau cases.
          </p>
          <Link className="text-link" to="/analytics">
            Open bureau report →
          </Link>
        </article>
        <article className="card">
          <h2>Review and routing</h2>
          <p>
            Review duplicates and prepare verified submissions for case
            creation.
          </p>
          <Link
            className="button button-secondary"
            to="/workspaces/duplicate-review"
          >
            Open duplicate review desk
          </Link>
        </article>
      </div>
    </section>
  );
}
export function OfficerDashboard() {
  const { activePersona } = useAuth();
  const raw = useSimulation();
  const state = scopedState(raw, activePersona);
  const assigned = state.cases.filter((c) => isAssigned(c, activePersona, raw));
  const active = assigned.filter((c) => !isResolved(c));
  const now = Date.parse(state.simulatedClock);
  const due = active.filter(
    (c) =>
      Date.parse(c.target_resolution_date) >= now &&
      Date.parse(c.target_resolution_date) <= now + 5 * 86400000,
  );
  return (
    <section>
      <div className="page-header">
        <div>
          <div className="eyebrow">
            CASE OFFICER · {activePersona.bureauCode}
          </div>
          <h1>My assigned work</h1>
          <p className="page-description">
            Your investigations, next actions, and evidence.{" "}
            {activePersona.bureauName}
          </p>
        </div>
        <Link
          className="button button-primary"
          to={`/cases?officer=${activePersona.id}`}
        >
          Open my case board
        </Link>
      </div>
      <Kpis
        items={[
          {
            label: "My active assignments",
            value: active.length,
            to: `/cases?scope=active&officer=${activePersona.id}`,
            detail: "Your active officer assignments",
          },
          {
            label: "Due within five days",
            value: due.length,
            to: `/cases?scope=due_soon&officer=${activePersona.id}`,
            detail: "Upcoming configured deadlines",
          },
          {
            label: "My overdue cases",
            value: active.filter(
              (c) => Date.parse(c.target_resolution_date) < now,
            ).length,
            to: `/cases?scope=overdue&officer=${activePersona.id}`,
            detail: "Prioritize follow-up",
          },
          {
            label: "Awaiting information",
            value: active.filter((c) => c.status === "awaiting_information")
              .length,
            to: `/cases?status=awaiting_information&officer=${activePersona.id}`,
            detail: "Review complainant responses",
          },
        ]}
      />
      <article className="card">
        <h2>My next actions</h2>
        <CaseList
          state={state}
          cases={[...active].sort(
            (a, b) =>
              Date.parse(a.target_resolution_date) -
              Date.parse(b.target_resolution_date),
          )}
        />
      </article>
      <div className="grid grid-2 role-workspace-columns">
        <article className="card">
          <h2>Case tools</h2>
          <p>
            Open an assigned case to update its status, add a note, upload
            evidence, or respond to the complainant.
          </p>
          <Link className="button button-secondary" to="/intake">
            My source submissions
          </Link>
        </article>
        <article className="card">
          <h2>Recent activity on my cases</h2>
          <Activity state={{ ...state, cases: assigned }} />
        </article>
      </div>
    </section>
  );
}
export function CollaborationDashboard() {
  const { activePersona } = useAuth();
  const raw = useSimulation();
  const state = scopedState(raw, activePersona);
  const grants = raw.accessGrants.filter(
    (g) =>
      g.grantee_user_id === activePersona.id ||
      (!g.grantee_user_id && g.grantee_bureau_id === activePersona.bureauId),
  );
  const now = Date.parse(raw.simulatedClock);
  const approved = grants.filter(
    (g) =>
      g.status === "approved" &&
      (!g.expires_at || Date.parse(g.expires_at) > now),
  );
  return (
    <section>
      <div className="page-header">
        <div>
          <div className="eyebrow">
            CROSS-BUREAU COLLABORATION · {activePersona.bureauCode}
          </div>
          <h1>Collaboration desk</h1>
          <p className="page-description">
            Assigned work and approved access. Restricted case content stays
            behind its access decision.
          </p>
        </div>
        <Link className="button button-primary" to="/cases?index=all">
          Find a case & request access
        </Link>
      </div>
      <Kpis
        items={[
          {
            label: "Accessible collaborations",
            value: state.cases.length,
            to: "/cases",
            detail: "Assignments and valid grants",
          },
          {
            label: "Active access grants",
            value: approved.length,
            to: "/access-requests",
            detail: "Read or collaborate scope",
          },
          {
            label: "Pending access requests",
            value: grants.filter((g) => g.status === "pending").length,
            to: "/access-requests",
            detail: "Awaiting an authorized decision",
          },
          {
            label: "Grants expiring this week",
            value: approved.filter(
              (g) =>
                g.expires_at && Date.parse(g.expires_at) <= now + 7 * 86400000,
            ).length,
            to: "/access-requests",
            detail: "Expiry is enforced by the shared store",
          },
        ]}
      />
      <article className="card">
        <h2>My collaboration cases</h2>
        <CaseList state={state} cases={state.cases} />
      </article>
      <article className="card">
        <h2>Shared actions</h2>
        <div className="stack">
          {state.cases
            .filter((c) => canActOnCase(c, activePersona, raw))
            .map((c) => (
              <Link
                className="text-link"
                key={c.case_id}
                to={`/cases/${c.case_id}?tab=notes`}
              >
                {c.case_number} · Open shared notes →
              </Link>
            ))}
        </div>
        <p className="small muted">
          A view-details grant does not permit adding notes or changing case
          content.
        </p>
      </article>
    </section>
  );
}
export function ExecutiveDashboard() {
  const { activePersona } = useAuth();
  const raw = useSimulation();
  const state = scopedState(raw, activePersona);
  const [days, setDays] = useState(30);
  const m = reporting(state);
  const period = reporting(state, days);
  const critical = m.active.filter((c) => c.priority === "critical");
  return (
    <section>
      <div className="page-header">
        <div>
          <div className="eyebrow">SENIOR MANAGEMENT / COMPETENT AUTHORITY</div>
          <h1>Executive overview</h1>
          <p className="page-description">
            Exception-led oversight of complaint trends and bureau performance.
          </p>
        </div>
        <Link className="button button-secondary" to="/analytics">
          Executive reports
        </Link>
      </div>
      <Kpis
        items={[
          {
            label: "Critical active cases",
            value: critical.length,
            to: "/cases?priority=critical&scope=active",
            detail: "Cases requiring executive attention",
          },
          {
            label: "Active escalations",
            value: state.escalations.filter((e) => e.status === "active")
              .length,
            to: "/escalations",
            detail: "Escalation oversight",
          },
          {
            label: "SLA compliance",
            value: m.rate === null ? "—" : `${m.rate}%`,
            to: "/analytics",
            detail: "Authorized system-wide aggregate",
          },
          {
            label: "Cases completed",
            value: m.resolved.length,
            to: "/cases?scope=completed",
            detail: `${m.cases.length} authorized cases overall`,
          },
        ]}
      />
      <div className="dashboard-split-grid">
        <article className="card">
          <div className="card-header-row">
            <div>
              <h2>Intake & resolution trends</h2>
              <p className="small muted">
                Actual source and completion events.
              </p>
            </div>
            <div className="pill-tabs">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  className={`pill-tab ${days === d ? "active" : ""}`}
                  onClick={() => setDays(d)}
                >
                  {d}D
                </button>
              ))}
            </div>
          </div>
          <ThroughputChart buckets={period.buckets} />
        </article>
        <article className="card">
          <h2>Bureau performance</h2>
          <div className="distribution-list">
            {state.bureaus.map((b) => {
              const cases = state.cases.filter(
                (c) => c.lead_bureau_id === b.id,
              );
              const completed = cases.filter(isResolved).length;
              return (
                <Link key={b.id} to={`/cases?leadBureau=${b.id}`}>
                  <div className="toolbar">
                    <span>{b.name}</span>
                    <strong>
                      {completed}/{cases.length} completed
                    </strong>
                  </div>
                  <progress max={Math.max(1, cases.length)} value={completed} />
                </Link>
              );
            })}
          </div>
        </article>
      </div>
      <article className="card">
        <h2>Critical case briefing</h2>
        <CaseList state={state} cases={critical} />
      </article>
    </section>
  );
}
export function AuditDashboard() {
  const { activePersona } = useAuth();
  const raw = useSimulation();
  const state = scopedState(raw, activePersona);
  const [query, setQuery] = useState("");
  const rows = state.cases.flatMap((c) =>
    c.action_history.map((a) => ({
      ...a,
      case_id: c.case_id,
      case_number: c.case_number,
    })),
  );
  const filtered = rows
    .filter((a) =>
      `${a.case_number} ${a.actor_name} ${a.action_type}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return (
    <section>
      <div className="page-header">
        <div>
          <div className="eyebrow">AUDITOR / READ-ONLY OFFICIAL</div>
          <h1>Audit workspace</h1>
          <p className="page-description">
            Authorized records and append-oriented histories. Investigation and
            administration actions are unavailable.
          </p>
        </div>
        <Link className="button button-secondary" to="/analytics">
          Read-only reports
        </Link>
      </div>
      <Kpis
        items={[
          {
            label: "Authorized case records",
            value: state.cases.length,
            to: "/cases",
            detail: "Explicit case-detail permission",
          },
          {
            label: "Recorded audit events",
            value: rows.length,
            to: "/audit-log",
            detail: "Case action history",
          },
          {
            label: "Completed records",
            value: state.cases.filter(isResolved).length,
            to: "/cases?scope=completed",
            detail: "Resolved and closed cases",
          },
          {
            label: "Accessible evidence records",
            value: state.cases.reduce((n, c) => n + c.attachments.length, 0),
            to: "/cases?hasEvidence=true",
            detail: "Subject to attachment-view permission",
          },
        ]}
      />
      <article className="card">
        <div className="toolbar">
          <h2>Case action register</h2>
          <label>
            Search audit events
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Case number, actor, or action…"
            />
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Case</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Recorded</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 50).map((a, i) => (
                <tr key={`${a.action_id}-${i}`}>
                  <td>
                    <Link to={`/cases/${a.case_id}?tab=timeline`}>
                      {a.case_number}
                    </Link>
                  </td>
                  <td>{a.action_type.replace(/_/g, " ")}</td>
                  <td>{a.actor_name}</td>
                  <td>
                    {new Date(a.created_at).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <p className="empty-state">No authorized events match this search.</p>
        )}
      </article>
    </section>
  );
}
export function ReviewWorkspace({
  kind,
}: {
  kind: "verification" | "duplicates";
}) {
  const { activePersona, has } = useAuth();
  const raw = useSimulation();
  const state = scopedState(raw, activePersona);
  if (!has(kind === "verification" ? "institution.verify" : "duplicate.review"))
    return <PermissionDeniedPage />;
  const tasks = state.verificationTasks;
  const correction = tasks.filter(
    (t) =>
      t.verification_status === "correction_requested" ||
      (t as typeof t & { requester_user_id?: string }).requester_user_id,
  );
  const candidates = state.duplicateCandidates;
  const ready = state.submissions.filter(
    (s) =>
      s.institution_verified &&
      !s.canonical_case_id &&
      s.status !== "rejected" &&
      !candidates.some(
        (d) => d.submission_id === s.id && d.review_status === "pending",
      ),
  );
  return (
    <section>
      <div className="page-header">
        <div>
          <div className="eyebrow">
            CAPABILITY WORKSPACE · {activePersona.roleName}
          </div>
          <h1>
            {kind === "verification"
              ? "Institution verification desk"
              : "Duplicate review desk"}
          </h1>
          <p className="page-description">
            {kind === "verification"
              ? "Resolve institution identity and correction tasks before ordinary case creation."
              : "Compare candidate cases, record human decisions, and prepare distinct issues for case creation."}
          </p>
        </div>
        <Link
          className="button button-primary"
          to={kind === "verification" ? "/verification" : "/duplicate-review"}
        >
          Open full queue
        </Link>
      </div>
      {kind === "verification" ? (
        <>
          <Kpis
            items={[
              {
                label: "Pending institution checks",
                value: tasks.filter((t) => t.verification_status === "pending")
                  .length,
                to: "/verification",
                detail: "Awaiting reviewer action",
              },
              {
                label: "Correction and information tasks",
                value: correction.length,
                to: "/verification?corrections=true",
                detail: "Preserve the previous decision",
              },
              {
                label: "Verified decisions",
                value: tasks.filter((t) => t.verification_status === "verified")
                  .length,
                to: "/verification?status=verified",
                detail: "Identity confirmed by a reviewer",
              },
              {
                label: "Rejected matches",
                value: tasks.filter((t) => t.verification_status === "rejected")
                  .length,
                to: "/verification?status=rejected",
                detail: "Unmatched institutions stay separate",
              },
            ]}
          />
          <article className="card">
            <h2>Institution review worklist</h2>
            <div className="role-case-list">
              {tasks
                .filter(
                  (t) =>
                    t.verification_status !== "verified" &&
                    t.verification_status !== "rejected",
                )
                .map((t) => (
                  <Link key={t.id} to={`/verification/tasks/${t.id}`}>
                    <div>
                      <small>{t.submission_number}</small>
                      <strong>{t.submitted_name}</strong>
                      <span>
                        {t.candidate_institution_name ||
                          "No suggested master match"}
                      </span>
                    </div>
                    <span className="badge badge-pending">
                      {t.verification_status.replace(/_/g, " ")}
                    </span>
                  </Link>
                ))}
            </div>
          </article>
        </>
      ) : (
        <>
          <Kpis
            items={[
              {
                label: "Pending candidate reviews",
                value: candidates.filter((d) => d.review_status === "pending")
                  .length,
                to: "/duplicate-review",
                detail: "A score never merges records",
              },
              {
                label: "High-confidence candidates",
                value: candidates.filter(
                  (d) =>
                    d.review_status === "pending" && d.similarity_score >= 0.9,
                ).length,
                to: "/duplicate-review?confidence=high",
                detail: "0.90 or higher; human review required",
              },
              {
                label: "Ready for case creation",
                value: ready.length,
                to: "/intake?ready=true",
                detail: "Verified, unlinked, reviewed submissions",
              },
              {
                label: "Recorded review decisions",
                value: candidates.filter((d) => d.review_status !== "pending")
                  .length,
                to: "/duplicate-review?status=all",
                detail: "Original source submissions retained",
              },
            ]}
          />
          <div className="grid grid-2 role-workspace-columns">
            <article className="card">
              <h2>Candidate comparisons</h2>
              <div className="role-case-list">
                {candidates
                  .filter((d) => d.review_status === "pending")
                  .map((d) => (
                    <Link
                      key={d.id}
                      to={`/duplicate-review/candidates/${d.candidate_id}`}
                    >
                      <div>
                        <small>{d.case_number}</small>
                        <strong>{d.submission_subject}</strong>
                        <span>{d.submission_institution_name}</span>
                      </div>
                      <span className="badge badge-pending">
                        {Math.round(d.similarity_score * 100)}% match
                      </span>
                    </Link>
                  ))}
              </div>
            </article>
            <article className="card">
              <h2>Distinct issues ready for routing</h2>
              <div className="role-case-list">
                {ready.map((s) => (
                  <Link
                    key={s.id}
                    to={
                      has("case.create")
                        ? `/cases?createFrom=${s.id}`
                        : `/intake/${s.id}`
                    }
                  >
                    <div>
                      <small>{s.submission_number}</small>
                      <strong>{s.subject}</strong>
                      <span>Review & create canonical case →</span>
                    </div>
                  </Link>
                ))}
                {!ready.length && (
                  <p className="empty-state">
                    Complete institution and duplicate review to release
                    submissions for case creation.
                  </p>
                )}
              </div>
            </article>
          </div>
        </>
      )}
    </section>
  );
}
export function DecisionsPage({
  accessOnly = false,
}: {
  accessOnly?: boolean;
}) {
  const { activePersona, has } = useAuth();
  const raw = useSimulation();
  const state = scopedState(raw, activePersona);
  if (!accessOnly && !has("case.access.manage") && !has("case.transfer.manage"))
    return <PermissionDeniedPage />;
  const grants = accessOnly
    ? raw.accessGrants.filter((g) => g.grantee_user_id === activePersona.id)
    : state.accessGrants.filter((g) => g.status === "pending");
  return (
    <section>
      <div className="page-header">
        <div>
          <h1>{accessOnly ? "My access requests" : "Pending decisions"}</h1>
          <p className="page-description">
            {accessOnly
              ? "Requests and grants initiated by your account."
              : "Access and transfer decisions within your authorized case scope."}
          </p>
        </div>
      </div>
      <article className="card">
        <h2>Cross-bureau access</h2>
        <div className="role-case-list">
          {grants.map((g) => (
            <Link key={g.grant_id} to={`/cases/${g.case_id}?tab=access`}>
              <div>
                <strong>{g.case_number}</strong>
                <span>
                  {g.grantee_bureau_name} · {g.access_level}
                </span>
              </div>
              <span className="badge badge-pending">
                {g.status === "approved" &&
                g.expires_at &&
                Date.parse(g.expires_at) <= Date.parse(raw.simulatedClock)
                  ? "expired"
                  : g.status}
              </span>
            </Link>
          ))}
          {!grants.length && (
            <p className="empty-state">No access requests in this view.</p>
          )}
        </div>
      </article>
      {!accessOnly && has("case.transfer.manage") && (
        <article className="card">
          <h2>Pending case transfers</h2>
          <div className="role-case-list">
            {state.transfers
              .filter((t) => t.status === "pending")
              .map((t) => (
                <Link
                  key={t.transfer_id}
                  to={`/cases/${t.case_id}?tab=transfers`}
                >
                  <div>
                    <strong>{t.case_number}</strong>
                    <span>
                      {t.from_bureau_name} → {t.to_bureau_name}
                    </span>
                  </div>
                  <span className="badge badge-pending">Review transfer</span>
                </Link>
              ))}
          </div>
        </article>
      )}
    </section>
  );
}
export function EscalationWorkspace() {
  const { activePersona } = useAuth();
  const state = scopedState(useSimulation(), activePersona);
  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Escalation oversight</h1>
          <p className="page-description">
            Authorized active escalations and overdue case records.
          </p>
        </div>
      </div>
      <article className="card">
        <h2>Active escalations</h2>
        <CaseList
          state={state}
          cases={state.cases.filter((c) =>
            state.escalations.some(
              (e) => e.case_id === c.case_id && e.status === "active",
            ),
          )}
        />
      </article>
    </section>
  );
}

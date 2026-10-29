import { useState } from "react";
import { Link } from "react-router-dom";
import { IconCircleArrow, IconDownload, IconPlus } from "../components/Icons";
import { useAuth } from "../auth/AuthProvider";
import {
  canReadCase,
  exportCsv,
  isResolved,
  reporting,
  useSimulation,
} from "../simulation/selectors";
import { scopedState } from "../simulation/scope";
import { ThroughputChart } from "../components/ThroughputChart";

export function HomePage() {
  const [days, setDays] = useState(30);
  const rawState = useSimulation();
  const { has, activePersona } = useAuth();
  const state = scopedState(rawState, activePersona);
  const metrics = reporting(state);
  const period = reporting(state, days);
  const pendingVerification = state.verificationTasks.filter(
    (t) => t.verification_status === "pending",
  ).length;
  const pendingDuplicates = state.duplicateCandidates.filter(
    (t) => t.review_status === "pending",
  ).length;
  const escalations = state.escalations.filter(
    (e) =>
      e.status === "active" &&
      state.cases.some((c) => c.case_id === e.case_id && !isResolved(c)),
  );
  const cards = [
    {
      label: "Total Complaints Received",
      value: state.submissions.length,
      caption: `${state.cases.length} canonical cases · original submissions retained`,
      path: has("submission.view") ? "/intake" : "/analytics",
    },
    {
      label: "Active Cases",
      value: metrics.active.length,
      caption: `${metrics.resolved.length} resolved or closed`,
      path: "/cases?scope=active",
    },
    {
      label: "Verification & Duplicate Review",
      value: pendingVerification + pendingDuplicates,
      caption: `${pendingVerification} verification · ${pendingDuplicates} duplicate reviews`,
      path: has("institution.verify")
        ? "/verification"
        : has("duplicate.review")
          ? "/duplicate-review"
          : "/analytics",
    },
    {
      label: "SLA Compliance",
      value: metrics.rate === null ? "—" : `${metrics.rate}%`,
      caption: `${metrics.overdue.length} overdue · assessed against configured targets`,
      path: "/analytics",
    },
  ];
  return (
    <div>
      <div className="page-header">
        <div className="page-header-info">
          <div className="eyebrow">YOUR WORKSPACE AT A GLANCE</div>
          <h1>System overview</h1>
          <p>Every complaint, every action, one clear view.</p>
        </div>
        <div className="page-header-actions">
          <button
            className="button button-secondary"
            onClick={() =>
              exportCsv("OneDesk-dashboard.csv", [
                ["Metric", "Value"],
                ...cards.map((c) => [c.label, c.value]),
              ])
            }
          >
            <IconDownload /> Export summary
          </button>
          <Link className="button button-primary" to="/demo/aicte">
            <IconPlus /> New complaint
          </Link>
        </div>
      </div>
      <div className="workspace-shortcuts">
        {has("institution.verify") && (
          <Link to="/workspaces/verification">
            Institution verification desk →
          </Link>
        )}
        {has("duplicate.review") && (
          <Link to="/workspaces/duplicate-review">Duplicate review desk →</Link>
        )}
        {has("case.access.manage") && (
          <Link to="/decisions">Pending access decisions →</Link>
        )}
        {has("escalation.manage") && (
          <Link to="/escalations">Escalation oversight →</Link>
        )}
      </div>
      <div className="stats-grid-4">
        {cards.map((c, i) => (
          <Link
            key={c.label}
            to={c.path}
            className={`stat-card ${i === 0 ? "stat-card-hero" : ""}`}
          >
            <div className="stat-card-top">
              <span className="stat-label">{c.label}</span>
              <IconCircleArrow />
            </div>
            <div className="stat-value">{c.value}</div>
            <div className="stat-trend-pill">{c.caption}</div>
          </Link>
        ))}
      </div>
      <div className="dashboard-split-grid">
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Intake & resolution</h2>
              <p className="small muted">
                Received submissions and completed cases over the last {days}{" "}
                days.
              </p>
            </div>
            <div className="pill-tabs">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  aria-pressed={days === d}
                  className={`pill-tab ${days === d ? "active" : ""}`}
                  onClick={() => setDays(d)}
                >
                  {d}D
                </button>
              ))}
            </div>
          </div>
          <ThroughputChart buckets={period.buckets} />
          <div className="chart-summary">
            <strong>{period.submissions.length}</strong> received <span>•</span>
            <strong>
              {period.buckets.reduce((n, b) => n + b.resolved, 0)}
            </strong>{" "}
            resolved
          </div>
        </section>
        <section className="card">
          <div className="card-header-row">
            <h2>Priority escalations</h2>
            <span className="badge badge-priority-critical">
              {escalations.length} active
            </span>
          </div>
          <div className="stack">
            {escalations.slice(0, 3).map((e) => (
              <Link
                className="escalation-item"
                key={e.escalation_id}
                to={`/cases/${e.case_id}`}
              >
                <div className="toolbar">
                  <strong>{e.case_number}</strong>
                  <span className="badge badge-priority-critical">
                    {e.level_name}
                  </span>
                </div>
                <p>
                  {state.cases.some(
                    (c) =>
                      c.case_id === e.case_id &&
                      canReadCase(c, activePersona, state),
                  )
                    ? e.case_title
                    : "Restricted case · request access to view"}
                </p>
                <small>
                  {Math.max(
                    1,
                    Math.ceil(
                      (Date.parse(state.simulatedClock) -
                        Date.parse(
                          state.cases.find((c) => c.case_id === e.case_id)!
                            .target_resolution_date,
                        )) /
                        86400000,
                    ),
                  )}{" "}
                  days overdue <span aria-hidden="true">↗</span>
                </small>
              </Link>
            ))}
            {!escalations.length && (
              <p className="empty-state">No active escalations.</p>
            )}
          </div>
          <Link className="text-link" to="/cases?scope=overdue">
            Review overdue cases →
          </Link>
        </section>
      </div>
      <div className="dashboard-split-grid">
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Bureau & officer workload</h2>
              <p className="small muted">Active assignments across the team.</p>
            </div>
            {has("bureau.view") && (
              <Link className="button button-secondary" to="/bureaus">
                View directory
              </Link>
            )}
          </div>
          <div className="workload-list">
            {state.bureauMembers
              .filter((m) => m.is_active)
              .slice(0, 5)
              .map((m, i) => {
                const count = state.cases.filter(
                  (c) =>
                    !isResolved(c) &&
                    c.officer_assignments.some(
                      (o) =>
                        o.officer_id === m.user_id && o.status === "active",
                    ),
                ).length;
                return (
                  <Link
                    className="workload-row"
                    key={m.id}
                    to={`/cases?officer=${m.user_id}`}
                  >
                    <span className={`officer-avatar avatar-tone-${i % 4}`}>
                      {m.full_name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <div className="workload-text">
                      <strong>{m.full_name}</strong>
                      <small>
                        {m.designation} ·{" "}
                        {state.bureaus.find((b) => b.id === m.bureau_id)?.code}
                      </small>
                    </div>
                    <div className="workload-bar-wrap">
                      <div
                        className="workload-bar-fill"
                        style={{
                          width: `${metrics.active.length ? (count / metrics.active.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="small">{count} active</span>
                  </Link>
                );
              })}
          </div>
          <p className="small muted">
            Bars show share of active cases. Officer capacity limits have not
            been configured.
          </p>
        </section>
        <section className="card gauge-meter-card">
          <h2>Resolution performance</h2>
          <p className="small muted">
            Completed cases as a share of all canonical cases.
          </p>
          <div className="gauge-svg-wrap">
            <svg
              viewBox="0 0 100 58"
              role="img"
              aria-label={`${metrics.resolved.length} of ${metrics.cases.length} cases completed`}
            >
              <path
                d="M 10 50 A 40 40 0 0 1 90 50"
                fill="none"
                stroke="#e8eeea"
                strokeWidth="11"
                strokeLinecap="round"
              />
              <path
                d="M 10 50 A 40 40 0 0 1 90 50"
                fill="none"
                stroke="#155a37"
                strokeWidth="11"
                strokeLinecap="round"
                pathLength="100"
                strokeDasharray="100"
                strokeDashoffset={
                  100 -
                  (metrics.cases.length
                    ? (metrics.resolved.length / metrics.cases.length) * 100
                    : 0)
                }
              />
            </svg>
            <div className="gauge-pct-text">
              {metrics.cases.length
                ? Math.round(
                    (metrics.resolved.length / metrics.cases.length) * 100,
                  )
                : 0}
              %
            </div>
          </div>
          <div className="gauge-caption">
            {metrics.resolved.length} completed · {metrics.active.length} active
          </div>
          <Link className="text-link" to="/analytics">
            Explore performance →
          </Link>
        </section>
      </div>
      <section className="card">
        <div className="card-header-row">
          <h2>Recent case activity</h2>
          <Link to="/cases" className="text-link">
            Open workspace →
          </Link>
        </div>
        <div className="activity-list">
          {state.cases
            .filter((c) => canReadCase(c, activePersona, state))
            .flatMap((c) =>
              c.action_history.map((a) => ({
                ...a,
                case_id: c.case_id,
                case_number: c.case_number,
              })),
            )
            .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
            .slice(0, 4)
            .map((a, i) => (
              <Link key={`${a.action_id}-${i}`} to={`/cases/${a.case_id}`}>
                <span className="activity-dot" />
                <div>
                  <strong>{a.case_number}</strong>
                  <p>{a.action_description}</p>
                </div>
                <small>{a.actor_name}</small>
              </Link>
            ))}
        </div>
      </section>
    </div>
  );
}

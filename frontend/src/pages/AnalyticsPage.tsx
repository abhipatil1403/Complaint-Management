import { useState } from "react";
import { Link } from "react-router-dom";
import { IconDownload } from "../components/Icons";
import { ThroughputChart } from "../components/ThroughputChart";
import { exportCsv, reporting, useSimulation } from "../simulation/selectors";
import { useAuth } from "../auth/AuthProvider";
import { scopedState } from "../simulation/scope";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const rawState = useSimulation();
  const { has, activePersona } = useAuth();
  const state = scopedState(rawState, activePersona);
  if (!has("report.view")) return <PermissionDeniedPage />;
  const m = reporting(state, days);
  const escalations = state.escalations.filter((e) =>
    m.cases.some((c) => c.case_id === e.case_id),
  );
  const cards = [
    ["Cases received", m.cases.length, "Canonical cases opened in period"],
    ["Cases completed", m.resolved.length, "Resolved or closed in this cohort"],
    [
      "SLA compliance",
      m.rate === null ? "—" : `${m.rate}%`,
      "Active and completed cases against targets",
    ],
    [
      "Average resolution cycle",
      m.cycle === null ? "—" : `${m.cycle.toFixed(1)} d`,
      "Elapsed calendar days for completed cases",
    ],
  ];
  return (
    <div>
      <div className="page-header">
        <div className="page-header-info">
          <div className="eyebrow">REPORTS & INSIGHTS</div>
          <h1>Analytics & SLA</h1>
          <p>Complaint trends, bureau workload, and resolution performance.</p>
        </div>
        <div className="page-header-actions">
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
          <button
            className="button button-secondary"
            onClick={() =>
              exportCsv("OneDesk-report.csv", [
                [
                  "Case number",
                  "Status",
                  "Priority",
                  "Bureau",
                  "Opened",
                  "Target",
                ],
                ...m.cases.map((c) => [
                  c.case_number,
                  c.status,
                  c.priority,
                  c.lead_bureau_code,
                  c.opened_at,
                  c.target_resolution_date,
                ]),
              ])
            }
          >
            <IconDownload />
            Export CSV
          </button>
        </div>
      </div>
      <div className="stats-grid-4">
        {cards.map(([label, value, caption]) => (
          <div className="stat-card" key={label}>
            <span className="stat-label">{label}</span>
            <div className="stat-value">{value}</div>
            <p className="small muted">{caption}</p>
          </div>
        ))}
      </div>
      <div className="dashboard-split-grid">
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Complaint throughput</h2>
              <p className="small muted">
                Actual intake and completion events over {days} days.
              </p>
            </div>
          </div>
          <ThroughputChart buckets={m.buckets} />
        </section>
        <section className="card">
          <h2>Case distribution</h2>
          <p className="small muted">Cases opened in the selected period.</p>
          <div className="distribution-list status-distribution">
            {[...new Set(state.cases.map((c) => c.status))].map((s) => {
              const count = m.cases.filter((c) => c.status === s).length;
              return (
                <Link to={`/cases?status=${s}`} key={s}>
                  <div className="toolbar">
                    <span>{s.replace(/_/g, " ")}</span>
                    <strong>{count}</strong>
                  </div>
                  <progress max={Math.max(1, m.cases.length)} value={count} />
                </Link>
              );
            })}
          </div>
        </section>
      </div>
      <div className="dashboard-split-grid">
        <section className="card">
          <h2>Bureau workload</h2>
          <p className="small muted">
            Active cases in this intake cohort. Multi-bureau cases may appear in
            more than one bureau.
          </p>
          <div className="distribution-list">
            {state.bureaus.map((b) => {
              const count = m.active.filter(
                (c) =>
                  c.lead_bureau_id === b.id ||
                  c.collaborating_bureaus.some(
                    (cb) =>
                      cb.bureau_id === b.id &&
                      cb.assignment_status === "active",
                  ),
              ).length;
              return (
                <Link key={b.id} to={`/cases?bureau=${b.id}`}>
                  <div className="toolbar">
                    <span>{b.name}</span>
                    <strong>{count} active</strong>
                  </div>
                  <progress max={Math.max(1, m.active.length)} value={count} />
                </Link>
              );
            })}
          </div>
        </section>
        <section className="card">
          <h2>SLA & escalation overview</h2>
          <div className="settings-summary">
            <div>
              <span>Overdue active cases</span>
              <strong>{m.overdue.length}</strong>
            </div>
            <div>
              <span>Active escalations</span>
              <strong>
                {escalations.filter((e) => e.status === "active").length}
              </strong>
            </div>
            <div>
              <span>Acknowledged escalations</span>
              <strong>
                {escalations.filter((e) => e.status === "acknowledged").length}
              </strong>
            </div>
            <div>
              <span>Resolved escalations</span>
              <strong>
                {escalations.filter((e) => e.status === "resolved").length}
              </strong>
            </div>
          </div>
          <Link className="button button-secondary" to="/cases?scope=overdue">
            Review overdue cases
          </Link>
          <p className="small muted metric-definition">
            Compliance compares each configured target with completion time, or
            the current application clock for active cases. No target is
            represented as an official statutory timeline.
          </p>
        </section>
      </div>
      <section className="card">
        <h2>Complaints by category</h2>
        <div className="distribution-list">
          {state.categories.map((c) => (
            <div key={c.id} className="toolbar">
              <span>{c.name}</span>
              <strong>
                {m.cases.filter((item) => item.category_id === c.id).length}
              </strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { IconDownload } from "../components/Icons";
import { ThroughputChart } from "../components/ThroughputChart";
import {
  exportCsv,
  getAllOverlappingCases,
  getPendingAgeingBuckets,
  getRegionDisposalStats,
  reporting,
  useSimulation,
} from "../simulation/selectors";
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
  const ageing = getPendingAgeingBuckets(state);
  const regionStats = getRegionDisposalStats(state);
  const overlappingCases = getAllOverlappingCases(state);
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

      {/* SIH Problem Statement 26264: Pending Case Ageing Analysis */}
      <div className="dashboard-split-grid">
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Pending Case Ageing Analysis</h2>
              <p className="small muted">
                Active case cohort categorized into statutory monitoring age brackets ({ageing.totalActive} active cases).
              </p>
            </div>
          </div>
          <div className="distribution-list">
            {[
              {
                label: "< 7 Days (Fresh Intake)",
                count: ageing.under7.length,
                color: "#10b981",
                desc: "Within initial intake and assessment window",
              },
              {
                label: "7 – 15 Days (Under Processing)",
                count: ageing.from7to15.length,
                color: "#3b82f6",
                desc: "Active bureau investigation and factual inquiry",
              },
              {
                label: "15 – 30 Days (Approaching SLA Ceiling)",
                count: ageing.from15to30.length,
                color: "#f59e0b",
                desc: "Priority review required before breach threshold",
              },
              {
                label: "> 30 Days (Critical Ageing / Overdue)",
                count: ageing.over30.length,
                color: "#ef4444",
                desc: "Immediate competent authority intervention required",
              },
            ].map((bucket) => {
              const pct =
                ageing.totalActive > 0
                  ? Math.round((bucket.count / ageing.totalActive) * 100)
                  : 0;
              return (
                <div key={bucket.label} style={{ marginBottom: "0.75rem" }}>
                  <div className="toolbar" style={{ marginBottom: "0.25rem" }}>
                    <span>
                      <strong style={{ color: bucket.color }}>● </strong>
                      {bucket.label}
                    </span>
                    <strong>
                      {bucket.count} cases ({pct}%)
                    </strong>
                  </div>
                  <div
                    style={{
                      height: "8px",
                      borderRadius: "4px",
                      background: "var(--color-border-subtle)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${pct}%`,
                        background: bucket.color,
                        borderRadius: "4px",
                      }}
                    />
                  </div>
                  <div className="small muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                    {bucket.desc}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* SIH Problem Statement 26264: Cross-Bureau Overlap Summary */}
        <section className="card">
          <div className="card-header-row">
            <div>
              <h2>Cross-Bureau Coordination Metrics</h2>
              <p className="small muted">
                Automated detection of parallel cases concerning the same institution.
              </p>
            </div>
            <span
              className="badge"
              style={{
                background: "#fef3c7",
                color: "#92400e",
                border: "1px solid #d97706",
                fontWeight: 700,
              }}
            >
              PS 26264
            </span>
          </div>

          <div className="settings-summary" style={{ marginBottom: "1.25rem" }}>
            <div>
              <span>Overlapping Cases Flagged</span>
              <strong>{overlappingCases.length}</strong>
            </div>
            <div>
              <span>Inter-Bureau Joint Reviews</span>
              <strong>
                {
                  state.cases.filter((c) =>
                    c.action_history.some(
                      (a) => a.action_type === "joint_review_initiated",
                    ),
                  ).length
                }
              </strong>
            </div>
            <div>
              <span>Bureaus Actively Coordinating</span>
              <strong>Regulation Bureau (RB) + PGRC</strong>
            </div>
            <div>
              <span>Conflicting Orders Prevented</span>
              <strong>100%</strong>
            </div>
          </div>

          <div
            style={{
              background: "#fffbeb",
              border: "1px solid #fed7aa",
              borderRadius: "var(--radius-md)",
              padding: "0.85rem",
              fontSize: "0.82rem",
              color: "#78350f",
              marginBottom: "1rem",
            }}
          >
            <strong>Single Source of Truth: </strong>
            OneDesk rule-based AI engine flags instances where RB and PGRC concurrently process grievances for the same institution (e.g. Delhi Technological University), preventing duplicate inquiries.
          </div>

          <Link
            to="/cases?search=DTU"
            className="button button-primary"
            style={{ width: "100%", justifyContent: "center" }}
          >
            Review Overlapping Case Pairs →
          </Link>
        </section>
      </div>

      {/* SIH Problem Statement 26264: Region-Wise Disposal Performance */}
      <section className="card" style={{ marginTop: "1rem" }}>
        <div className="card-header-row">
          <div>
            <h2>Region-Wise Disposal &amp; Grievance Reports</h2>
            <p className="small muted">
              Consolidated institution complaint intake, active workload, and disposal rate across AICTE Regional Offices.
            </p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Regional Office</th>
                <th>Code</th>
                <th>Total Grievances</th>
                <th>Cases Under Process</th>
                <th>Cases Disposed</th>
                <th>Overdue Cases</th>
                <th>Disposal Rate</th>
              </tr>
            </thead>
            <tbody>
              {regionStats.map((reg) => (
                <tr key={reg.regionId}>
                  <td>
                    <strong>{reg.regionName}</strong>
                  </td>
                  <td>
                    <span className="badge badge-neutral">{reg.regionCode}</span>
                  </td>
                  <td>{reg.total}</td>
                  <td>
                    <span className="badge badge-warning">{reg.active} active</span>
                  </td>
                  <td>
                    <span className="badge badge-success">{reg.resolved} disposed</span>
                  </td>
                  <td>
                    {reg.overdue > 0 ? (
                      <span className="badge badge-priority-critical">{reg.overdue} overdue</span>
                    ) : (
                      <span className="small muted">0</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <strong style={{ fontSize: "0.88rem", minWidth: "40px" }}>
                        {reg.disposalRate}%
                      </strong>
                      <div
                        style={{
                          flex: 1,
                          height: "6px",
                          borderRadius: "3px",
                          background: "var(--color-border-subtle)",
                          overflow: "hidden",
                          minWidth: "60px",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${reg.disposalRate}%`,
                            background:
                              reg.disposalRate >= 80
                                ? "#10b981"
                                : reg.disposalRate >= 50
                                  ? "#3b82f6"
                                  : "#f59e0b",
                            borderRadius: "3px",
                          }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

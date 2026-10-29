import { Link, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { ErrorPanel, Loading, PageHeader, StatusBadge } from "../components/ui";
import { formatDateTime } from "../lib/intake";
import { useResource } from "../lib/useResource";
import {
  caseStatusLabel,
  severityLabel,
} from "../lib/cases";
import type { CaseDetail } from "../types";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

export function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const { has } = useAuth();

  const { data: caseItem, loading, error, reload } = useResource<CaseDetail>(
    (has("case.view_index") || has("case.view_detail")) && caseId ? `/cases/${caseId}` : null,
  );

  if (!has("case.view_index") && !has("case.view_detail")) {
    return <PermissionDeniedPage />;
  }

  if (loading) {
    return <Loading label="Loading canonical case details..." />;
  }

  if (error || !caseItem) {
    // Check if error is 403 Forbidden due to cross-bureau privacy
    const isForbidden = (error as any)?.status === 403;

    return (
      <section>
        <PageHeader
          title="Case Detail"
          actions={
            <Link to="/cases" className="button button-quiet">
              Back to Cases
            </Link>
          }
        />
        {isForbidden ? (
          <div className="card">
            <div className="callout callout-warning">
              <h3>Restricted Case Details</h3>
              <p>
                Under AICTE Cross-Bureau Privacy Rules, you have permission to view the case index, but full complaint details, description, and action history are restricted to members of the primary or collaborating bureaus.
              </p>
              <p>
                To view this case, you must be granted temporary access or be assigned as a collaborating bureau officer.
              </p>
            </div>
          </div>
        ) : (
          <ErrorPanel error={error} title="Case not found" />
        )}
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        title={`Case ${caseItem.case_number}: ${caseItem.title}`}
        description={`Canonical case for ${caseItem.institution_name}`}
        actions={
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Link to="/cases" className="button button-quiet">
              Back to Cases
            </Link>
            <button type="button" className="button button-quiet" onClick={() => void reload()}>
              Refresh
            </button>
          </div>
        }
      />

      {/* Overview Card */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h2 style={{ margin: "0 0 0.5rem 0" }}>{caseItem.title}</h2>
            <div className="hint">
              Opened: {formatDateTime(caseItem.opened_at)} | Last updated: {formatDateTime(caseItem.updated_at)}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <StatusBadge
              value={caseItem.priority}
              label={severityLabel(caseItem.priority)}
            />
            <StatusBadge
              value={caseItem.status}
              label={caseStatusLabel(caseItem.status)}
            />
          </div>
        </div>

        <hr style={{ margin: "1rem 0", borderColor: "var(--color-border, #eee)" }} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
          <div>
            <strong>Institution</strong>
            <div>{caseItem.institution_name}</div>
            {caseItem.institution_code && (
              <small className="hint">Permanent ID: {caseItem.institution_code}</small>
            )}
          </div>
          <div>
            <strong>Lead Assigned Bureau</strong>
            <div>{caseItem.lead_bureau_name || "Unassigned"} {caseItem.lead_bureau_code ? `(${caseItem.lead_bureau_code})` : ""}</div>
          </div>
          <div>
            <strong>Source Submission</strong>
            <div>
              <Link to={`/intake/${caseItem.source_submission_id}`} className="button-link">
                View Submission
              </Link>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "1.5rem" }}>
          <strong>Description</strong>
          <div
            style={{
              marginTop: "0.5rem",
              padding: "0.75rem",
              background: "var(--color-bg-subtle, #f5f5f5)",
              borderRadius: "4px",
              whiteSpace: "pre-wrap",
            }}
          >
            {caseItem.description}
          </div>
        </div>
      </div>

      {/* Collaborating Bureaus & Related Cases Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
        {/* Collaborating Bureaus */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Collaborating Bureaus</h3>
          {caseItem.collaborating_bureaus.length === 0 ? (
            <p className="hint">No additional collaborating bureaus assigned.</p>
          ) : (
            <ul style={{ paddingLeft: "1.2rem", margin: 0 }}>
              {caseItem.collaborating_bureaus.map((b) => (
                <li key={b.bureau_id} style={{ marginBottom: "0.5rem" }}>
                  <strong>{b.bureau_name} ({b.bureau_code})</strong>
                  <div className="hint">Type: {b.assignment_type} | Assigned: {formatDateTime(b.assigned_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Related Cases */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Related Cases</h3>
          {caseItem.related_cases.length === 0 ? (
            <p className="hint">No related cases linked.</p>
          ) : (
            <ul style={{ paddingLeft: "1.2rem", margin: 0 }}>
              {caseItem.related_cases.map((rc) => (
                <li key={rc.relationship_id} style={{ marginBottom: "0.5rem" }}>
                  <Link to={`/cases/${rc.related_case_id}`}>
                    <strong>{rc.related_case_number}</strong>: {rc.related_case_title}
                  </Link>
                  <div className="hint">
                    Relation: {rc.relationship_type.replace(/_/g, " ")} | Linked: {formatDateTime(rc.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Action History / Audit Trail */}
      <div className="card">
        <h3>Action & Assignment History</h3>
        <p className="hint">Full append-only audit trail of actions taken on this canonical case.</p>
        {caseItem.action_history.length === 0 ? (
          <p className="hint">No recorded actions yet.</p>
        ) : (
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Description</th>
                  <th>Timestamp</th>
                  <th>Metadata</th>
                </tr>
              </thead>
              <tbody>
                {caseItem.action_history.map((a) => (
                  <tr key={a.action_id}>
                    <td>
                      <span className="badge badge-neutral">{a.action_type}</span>
                    </td>
                    <td>{a.action_description}</td>
                    <td>{formatDateTime(a.created_at)}</td>
                    <td>
                      <small><code>{JSON.stringify(a.metadata)}</code></small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

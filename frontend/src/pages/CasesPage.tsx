import { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from "../components/ui";
import { formatDateTime } from "../lib/intake";
import { usePagedResource } from "../lib/useResource";
import {
  caseStatusLabel,
  severityLabel,
} from "../lib/cases";
import type { CaseIndexItem, CasePriority } from "../types";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

const STATUS_FILTERS = [
  { value: "all", label: "All Cases" },
  { value: "new", label: "New" },
  { value: "open", label: "Open" },
  { value: "under_review", label: "Under Review" },
  { value: "escalated", label: "Escalated" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

export function CasesPage() {
  const { has, api } = useAuth();
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Create Case Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [sourceSubmissionId, setSourceSubmissionId] = useState("");
  const [primaryBureauId, setPrimaryBureauId] = useState("");
  const [caseTitle, setCaseTitle] = useState("");
  const [caseDescription, setCaseDescription] = useState("");
  const [priority, setPriority] = useState<CasePriority>("normal");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { items, loading, error, reload } = usePagedResource<CaseIndexItem>(
    "/cases",
    {
      status: statusFilter === "all" ? undefined : statusFilter,
      q: searchQuery.trim() || undefined,
    },
    { enabled: has("case.view_index") || has("case.view_detail") },
  );

  if (!has("case.view_index") && !has("case.view_detail")) {
    return <PermissionDeniedPage />;
  }

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceSubmissionId.trim() || !primaryBureauId.trim() || !caseTitle.trim() || !caseDescription.trim()) {
      setCreateError("Please fill in all required fields.");
      return;
    }
    setIsSubmitting(true);
    setCreateError(null);
    try {
      await api.post("/cases", {
        submission_id: sourceSubmissionId.trim(),
        lead_bureau_id: primaryBureauId.trim(),
        title: caseTitle.trim(),
        description: caseDescription.trim(),
        priority,
        visibility: "restricted",
        expected_submission_updated_at: new Date().toISOString(),
      });
      setShowCreateModal(false);
      setSourceSubmissionId("");
      setPrimaryBureauId("");
      setCaseTitle("");
      setCaseDescription("");
      await reload();
    } catch (err: any) {
      setCreateError(err?.message || "Failed to create canonical case.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section>
      <PageHeader
        title="AICTE Canonical Cases"
        description="Cross-bureau complaint monitoring index. Full complaint details are restricted to authorized bureaus."
        actions={
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="button button-quiet" onClick={() => void reload()}>
              Refresh
            </button>
            {has("case.create") && (
              <button
                type="button"
                className="button button-primary"
                onClick={() => setShowCreateModal(true)}
              >
                + Create Canonical Case
              </button>
            )}
          </div>
        }
      />

      <div className="card">
        <div className="toolbar toolbar-wrap">
          <h2>Case Index</h2>
          <label>
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Search
            <input
              type="search"
              placeholder="Case number, institution, or category"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        </div>

        {error && <ErrorPanel error={error} />}
        {loading && <Loading label="Loading canonical cases..." />}

        {!loading && !error && items.length === 0 && (
          <EmptyState
            title="No cases found"
            description="No canonical cases match your filter criteria."
          />
        )}

        {!loading && !error && items.length > 0 && (
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Case Number</th>
                  <th>Institution</th>
                  <th>Category</th>
                  <th>Lead Bureau</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Opened At</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.case_id}>
                    <td>
                      <strong>{c.case_number}</strong>
                    </td>
                    <td>{c.institution_name}</td>
                    <td>{c.category_name || "Unassigned"}</td>
                    <td>{c.lead_bureau_code || "Unassigned"}</td>
                    <td>
                      <StatusBadge
                        value={c.priority}
                        label={severityLabel(c.priority)}
                      />
                    </td>
                    <td>
                      <StatusBadge
                        value={c.status}
                        label={caseStatusLabel(c.status)}
                      />
                    </td>
                    <td>{formatDateTime(c.opened_at)}</td>
                    <td>
                      <Link to={`/cases/${c.case_id}`} className="button button-small">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal for Creating Canonical Case */}
      {showCreateModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div className="card" style={{ maxWidth: "600px", width: "90%", background: "#fff", maxHeight: "90vh", overflowY: "auto" }}>
            <h3>Create Canonical Case</h3>
            <p className="hint">
              Convert a verified, screened intake submission into a canonical AICTE case with monotonic numbering.
            </p>

            {createError && (
              <div className="callout callout-danger" style={{ marginBottom: "1rem" }}>
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateCase}>
              <div style={{ marginBottom: "0.75rem" }}>
                <label>Source Submission UUID *</label>
                <input
                  required
                  type="text"
                  placeholder="Submission UUID (must be verified & screened)"
                  value={sourceSubmissionId}
                  onChange={(e) => setSourceSubmissionId(e.target.value)}
                  style={{ width: "100%", marginTop: "0.25rem" }}
                />
              </div>

              <div style={{ marginBottom: "0.75rem" }}>
                <label>Lead Bureau UUID *</label>
                <input
                  required
                  type="text"
                  placeholder="Assigned lead bureau UUID"
                  value={primaryBureauId}
                  onChange={(e) => setPrimaryBureauId(e.target.value)}
                  style={{ width: "100%", marginTop: "0.25rem" }}
                />
              </div>

              <div style={{ marginBottom: "0.75rem" }}>
                <label>Case Title *</label>
                <input
                  required
                  type="text"
                  placeholder="Summary of the complaint issue"
                  value={caseTitle}
                  onChange={(e) => setCaseTitle(e.target.value)}
                  style={{ width: "100%", marginTop: "0.25rem" }}
                />
              </div>

              <div style={{ marginBottom: "0.75rem" }}>
                <label>Priority *</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as CasePriority)}
                  style={{ width: "100%", marginTop: "0.25rem" }}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label>Description *</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Detailed description of the case..."
                  value={caseDescription}
                  onChange={(e) => setCaseDescription(e.target.value)}
                  style={{ width: "100%", marginTop: "0.25rem" }}
                />
              </div>

              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Creating..." : "Create Case"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

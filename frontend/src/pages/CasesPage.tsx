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
  { value: "all", label: "All Statuses" },
  { value: "new", label: "New" },
  { value: "under_review", label: "Under Review" },
  { value: "assigned", label: "Assigned" },
  { value: "in_progress", label: "In Progress" },
  { value: "awaiting_information", label: "Awaiting Information" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
  { value: "reopened", label: "Reopened" },
];

const KANBAN_COLUMNS = [
  { id: "new", title: "New" },
  { id: "under_review", title: "Under Review" },
  { id: "assigned", title: "Assigned" },
  { id: "in_progress", title: "In Progress" },
  { id: "awaiting_information", title: "Awaiting Info" },
  { id: "resolved", title: "Resolved" },
  { id: "closed", title: "Closed" },
];

export function CasesPage() {
  const { has, api } = useAuth();
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "kanban">("table");

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
      search: searchQuery.trim() || undefined,
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
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <div style={{ display: "flex", border: "1px solid var(--color-border)", borderRadius: "4px", overflow: "hidden" }}>
              <button
                type="button"
                className={`button button-small ${viewMode === "table" ? "button-primary" : "button-quiet"}`}
                onClick={() => setViewMode("table")}
              >
                Table View
              </button>
              <button
                type="button"
                className={`button button-small ${viewMode === "kanban" ? "button-primary" : "button-quiet"}`}
                onClick={() => setViewMode("kanban")}
              >
                Kanban View
              </button>
            </div>
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
          <h2>Case Directory</h2>
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

        {/* Table View */}
        {!loading && !error && items.length > 0 && viewMode === "table" && (
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
                        {c.can_view_details ? "View Details" : "Request Access"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Kanban Board View */}
        {!loading && !error && items.length > 0 && viewMode === "kanban" && (
          <div style={{ display: "flex", gap: "1rem", overflowX: "auto", paddingBottom: "1rem", marginTop: "1rem" }}>
            {KANBAN_COLUMNS.map((col) => {
              const colCases = items.filter((c) => c.status === col.id);
              return (
                <div
                  key={col.id}
                  style={{
                    minWidth: "260px",
                    maxWidth: "300px",
                    background: "var(--color-surface-subtle, rgba(0,0,0,0.02))",
                    borderRadius: "6px",
                    padding: "0.75rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ margin: 0, fontSize: "0.95rem" }}>{col.title}</h3>
                    <span className="badge" style={{ fontSize: "0.8rem", padding: "0.1rem 0.5rem" }}>
                      {colCases.length}
                    </span>
                  </div>

                  {colCases.length === 0 ? (
                    <div className="hint" style={{ fontSize: "0.85rem", textAlign: "center", padding: "1rem 0" }}>
                      No cases in this stage
                    </div>
                  ) : (
                    colCases.map((c) => (
                      <div
                        key={c.case_id}
                        style={{
                          background: "var(--color-surface)",
                          borderRadius: "4px",
                          padding: "0.75rem",
                          border: "1px solid var(--color-border)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.5rem",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <strong>{c.case_number}</strong>
                          <StatusBadge value={c.priority} label={severityLabel(c.priority)} />
                        </div>
                        <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                          {c.institution_name}
                        </div>
                        <div className="hint" style={{ fontSize: "0.8rem" }}>
                          Bureau: {c.lead_bureau_code || "Unassigned"}
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.25rem" }}>
                          <Link to={`/cases/${c.case_id}`} className="button button-small" style={{ fontSize: "0.8rem" }}>
                            {c.can_view_details ? "View" : "Request"}
                          </Link>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
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
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div className="card" style={{ maxWidth: "500px", width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
            <h3>Create Canonical Case</h3>
            <p className="hint">
              Initialize a canonical case from an authorized screened submission.
            </p>

            {createError && (
              <div className="callout callout-danger" style={{ marginBottom: "1rem" }}>
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateCase}>
              <label>
                Source Submission ID
                <input
                  type="text"
                  required
                  placeholder="UUID of screened submission"
                  value={sourceSubmissionId}
                  onChange={(e) => setSourceSubmissionId(e.target.value)}
                />
              </label>

              <label>
                Lead Bureau ID
                <input
                  type="text"
                  required
                  placeholder="UUID of lead bureau"
                  value={primaryBureauId}
                  onChange={(e) => setPrimaryBureauId(e.target.value)}
                />
              </label>

              <label>
                Case Title
                <input
                  type="text"
                  required
                  placeholder="Concise summary title"
                  value={caseTitle}
                  onChange={(e) => setCaseTitle(e.target.value)}
                />
              </label>

              <label>
                Case Description
                <textarea
                  rows={4}
                  required
                  placeholder="Comprehensive case notes and facts"
                  value={caseDescription}
                  onChange={(e) => setCaseDescription(e.target.value)}
                />
              </label>

              <label>
                Priority
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as CasePriority)}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
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

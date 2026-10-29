import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import {
  IconAlertTriangle,
  IconClock,
  IconKanban,
  IconPlus,
  IconSearch,
  IconTable,
} from "../components/Icons";
import {
  useSimulation,
  isResolved,
  canReadCase,
  getOverlappingCases,
} from "../simulation/selectors";
import { scopedState, accessibleSubmissions } from "../simulation/scope";
import { simulationStore } from "../simulation/simulationStore";
import type { CasePriority, CaseStatus } from "../simulation/types";
import { severityLabel } from "../lib/cases";

const KANBAN_STAGES: Array<{ id: CaseStatus; title: string; color: string }> = [
  { id: "new", title: "New", color: "#eab308" },
  { id: "under_review", title: "Under Review", color: "#f97316" },
  { id: "assigned", title: "Assigned", color: "#3b82f6" },
  { id: "in_progress", title: "In Progress", color: "#155a37" },
  { id: "awaiting_information", title: "Awaiting Info", color: "#8b5cf6" },
  { id: "resolved", title: "Resolved", color: "#10b981" },
  { id: "reopened", title: "Reopened", color: "#b54708" },
  { id: "closed", title: "Closed", color: "#6b7280" },
];

export function CasesPage() {
  const { has, activePersona, simulatedClock } = useAuth();
  const [params] = useSearchParams();
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");
  const [filterPill, setFilterPill] = useState<
    "all" | "my_bureau" | "high_priority" | "due_soon" | "overlapping"
  >(params.get("scope") === "overlapping" ? "overlapping" : "all");
  const [selectedBureau, setSelectedBureau] = useState(
    params.get("bureau") || "all",
  );
  const [selectedRegion, setSelectedRegion] = useState(
    params.get("region") || "all",
  );
  const [selectedCategory, setSelectedCategory] = useState(
    params.get("category") || "all",
  );
  const [searchQuery, setSearchQuery] = useState(params.get("search") || "");
  const [createError, setCreateError] = useState("");

  // Create Case Modal
  const [showCreateModal, setShowCreateModal] = useState(
    Boolean(params.get("createFrom")) && has("case.create"),
  );
  const [sourceSubId, setSourceSubId] = useState(
    params.get("createFrom") || "",
  );
  const [leadBureauId, setLeadBureauId] = useState(
    activePersona.bureauId || "",
  );
  const [caseTitle, setCaseTitle] = useState(
    () =>
      accessibleSubmissions(simulationStore.getState(), activePersona).find(
        (s) => s.id === params.get("createFrom"),
      )?.subject || "",
  );
  const [caseDesc, setCaseDesc] = useState(
    () =>
      accessibleSubmissions(simulationStore.getState(), activePersona).find(
        (s) => s.id === params.get("createFrom"),
      )?.description || "",
  );
  const [priority, setPriority] = useState<CasePriority>("normal");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const state = useSimulation();

  // Filter cases
  const filteredCases = (
    params.get("index") === "all" && has("case.view_index")
      ? state.cases
      : scopedState(state, activePersona).cases
  ).filter((c) => {
    if (params.get("scope") === "completed" && !isResolved(c)) return false;
    if (
      params.get("leadBureau") &&
      c.lead_bureau_id !== params.get("leadBureau")
    )
      return false;
    if (
      params.get("scope") === "due_soon" &&
      (isResolved(c) ||
        Date.parse(c.target_resolution_date) < Date.parse(simulatedClock) ||
        Date.parse(c.target_resolution_date) >
          Date.parse(simulatedClock) + 5 * 86400000)
    )
      return false;
    if (params.get("priority") && c.priority !== params.get("priority"))
      return false;
    if (params.get("hasEvidence") === "true" && !c.attachments.length)
      return false;
    if (
      params.get("unassigned") === "true" &&
      (isResolved(c) ||
        c.officer_assignments.some(
          (o) =>
            o.status === "active" && o.bureau_id === activePersona.bureauId,
        ))
    )
      return false;
    if (params.get("scope") === "active" && isResolved(c)) return false;
    if (
      params.get("scope") === "overdue" &&
      (isResolved(c) ||
        Date.parse(c.target_resolution_date) >= Date.parse(simulatedClock))
    )
      return false;
    if (params.get("status") && c.status !== params.get("status")) return false;
    if (
      params.get("bureau") &&
      c.lead_bureau_id !== params.get("bureau") &&
      !c.collaborating_bureaus.some(
        (b) =>
          b.bureau_id === params.get("bureau") &&
          b.assignment_status === "active",
      )
    )
      return false;
    if (
      params.get("officer") &&
      !c.officer_assignments.some(
        (o) => o.officer_id === params.get("officer") && o.status === "active",
      )
    )
      return false;
    if (selectedBureau !== "all") {
      const matchBureau =
        c.lead_bureau_id === selectedBureau ||
        c.collaborating_bureaus.some(
          (cb) =>
            cb.bureau_id === selectedBureau && cb.assignment_status === "active",
        );
      if (!matchBureau) return false;
    }
    if (selectedRegion !== "all" && c.institution_region !== selectedRegion) {
      return false;
    }
    if (selectedCategory !== "all" && c.category_id !== selectedCategory) {
      return false;
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matches =
        c.case_number.toLowerCase().includes(q) ||
        (canReadCase(c, activePersona, state) &&
          c.title.toLowerCase().includes(q)) ||
        c.institution_name.toLowerCase().includes(q) ||
        (Boolean(c.institution_code) &&
          c.institution_code!.toLowerCase().includes(q)) ||
        c.category_name.toLowerCase().includes(q) ||
        c.lead_bureau_code.toLowerCase().includes(q) ||
        c.lead_bureau_name.toLowerCase().includes(q) ||
        (Boolean(c.institution_region) &&
          c.institution_region!.toLowerCase().includes(q));
      if (!matches) return false;
    }

    // Filter pills
    if (filterPill === "overlapping") {
      const overlaps = getOverlappingCases(state, c.case_id);
      if (overlaps.length === 0) return false;
    }

    if (filterPill === "my_bureau") {
      if (!activePersona.bureauId) return true;
      return (
        c.lead_bureau_id === activePersona.bureauId ||
        c.collaborating_bureaus.some(
          (cb) => cb.bureau_id === activePersona.bureauId,
        )
      );
    }

    if (filterPill === "high_priority") {
      return c.priority === "high" || c.priority === "critical";
    }

    if (filterPill === "due_soon") {
      if (c.status === "resolved" || c.status === "closed") return false;
      const now = new Date(simulatedClock).getTime();
      const target = new Date(c.target_resolution_date).getTime();
      const diff = (target - now) / (1000 * 60 * 60 * 24);
      return diff <= 5;
    }

    return true;
  });

  // Handle Create Case Form
  const handleCreateCase = (e: React.FormEvent) => {
    e.preventDefault();
    if (!caseTitle.trim() || !caseDesc.trim()) return;

    setIsSubmitting(true);
    try {
      simulationStore.createCanonicalCase({
        submission_id: sourceSubId,
        lead_bureau_id:
          leadBureauId || activePersona.bureauId || state.bureaus[0].id,
        title: caseTitle.trim(),
        description: caseDesc.trim(),
        priority,
      });
      setShowCreateModal(false);
      setCaseTitle("");
      setCaseDesc("");
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Could not create case.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper for deadline countdown
  const getRemainingTimeDisplay = (
    targetDateStr: string,
    status: CaseStatus,
  ) => {
    if (status === "resolved" || status === "closed") {
      return { text: "Disposed", isOverdue: false, isWarning: false };
    }
    const now = new Date(simulatedClock).getTime();
    const target = new Date(targetDateStr).getTime();
    const diffDays = Math.ceil((target - now) / (1000 * 60 * 60 * 24));

    if (target < now) {
      return {
        text: `${Math.max(1, Math.ceil((now - target) / 86400000))}d overdue`,
        isOverdue: true,
        isWarning: true,
      };
    }
    if (diffDays <= 2) {
      return {
        text: `In ${diffDays} day${diffDays === 1 ? "" : "s"}`,
        isOverdue: false,
        isWarning: true,
      };
    }
    return { text: `In ${diffDays} days`, isOverdue: false, isWarning: false };
  };

  return (
    <div>
      {/* Header matching Fernly Reference 01 */}
      <div className="page-header">
        <div className="page-header-info">
          <h1>Cases Workspace</h1>
          <p>Triage, assign, collaborate, and monitor complaint lifecycles.</p>
        </div>

        <div className="page-header-actions">
          {/* View toggle (Kanban vs Table) */}
          <div className="pill-tabs">
            <button
              type="button"
              className={`pill-tab ${viewMode === "kanban" ? "active" : ""}`}
              onClick={() => setViewMode("kanban")}
            >
              <IconKanban className="w-3.5 h-3.5" /> Kanban
            </button>
            <button
              type="button"
              className={`pill-tab ${viewMode === "table" ? "active" : ""}`}
              onClick={() => setViewMode("table")}
            >
              <IconTable className="w-3.5 h-3.5" /> Table
            </button>
          </div>

          {has("case.create") && (
            <button
              type="button"
              className="button button-primary"
              onClick={() => setShowCreateModal(true)}
            >
              <IconPlus className="w-4 h-4" /> New Case
            </button>
          )}
        </div>
      </div>

      {has("case.view_index") && (
        <div className="workspace-shortcuts">
          <Link
            to={params.get("index") === "all" ? "/cases" : "/cases?index=all"}
          >
            {params.get("index") === "all"
              ? "Return to my accessible cases →"
              : "Cross-bureau minimal case index →"}
          </Link>
          <span className="small muted">
            {params.get("index") === "all"
              ? "Index visibility does not grant complaint-content access."
              : "This board is filtered by your assignments and valid access."}
          </span>
        </div>
      )}
      {/* Filter Row matching Fernly 01 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.25rem",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className={`button ${filterPill === "all" ? "button-primary" : "button-secondary"}`}
            onClick={() => setFilterPill("all")}
            style={{ borderRadius: "9999px", padding: "0.35rem 0.95rem" }}
          >
            All
          </button>
          <button
            type="button"
            className={`button ${filterPill === "my_bureau" ? "button-primary" : "button-secondary"}`}
            onClick={() => setFilterPill("my_bureau")}
            style={{ borderRadius: "9999px", padding: "0.35rem 0.95rem" }}
          >
            My Bureau ({activePersona.bureauCode || "All"})
          </button>
          <button
            type="button"
            className={`button ${filterPill === "high_priority" ? "button-primary" : "button-secondary"}`}
            onClick={() => setFilterPill("high_priority")}
            style={{ borderRadius: "9999px", padding: "0.35rem 0.95rem" }}
          >
            High &amp; Critical
          </button>
          <button
            type="button"
            className={`button ${filterPill === "due_soon" ? "button-primary" : "button-secondary"}`}
            onClick={() => setFilterPill("due_soon")}
            style={{ borderRadius: "9999px", padding: "0.35rem 0.95rem" }}
          >
            Due Soon / Overdue
          </button>
          <button
            type="button"
            className={`button ${filterPill === "overlapping" ? "button-primary" : "button-secondary"}`}
            onClick={() =>
              setFilterPill(filterPill === "overlapping" ? "all" : "overlapping")
            }
            style={{
              borderRadius: "9999px",
              padding: "0.35rem 0.95rem",
              borderColor: "#d97706",
              color: filterPill === "overlapping" ? "#ffffff" : "#92400e",
              background: filterPill === "overlapping" ? "#d97706" : "#fef3c7",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
            }}
          >
            <IconAlertTriangle className="w-3.5 h-3.5" /> Overlapping Cases
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span className="small muted font-semibold">
            {filteredCases.length} case{filteredCases.length === 1 ? "" : "s"}{" "}
            shown
          </span>
        </div>
      </div>

      {/* Search and Dropdown Filter Bar (Problem Statement 26264) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "1.25rem",
          flexWrap: "wrap",
        }}
      >
        <div
          className="topbar-search"
          style={{ flex: "1 1 260px", minWidth: "220px", padding: "0.35rem 0.75rem" }}
        >
          <IconSearch className="w-3.5 h-3.5 opacity-60" />
          <input
            type="text"
            placeholder="Search by Case ID, AICTE Permanent ID (e.g. 1-1002345671), Institution, Bureau..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ fontSize: "0.82rem", width: "100%" }}
          />
        </div>

        <select
          value={selectedBureau}
          onChange={(e) => setSelectedBureau(e.target.value)}
          style={{
            fontSize: "0.82rem",
            padding: "0.4rem 0.75rem",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface-white)",
          }}
        >
          <option value="all">All Bureaus/Cells</option>
          {state.bureaus.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.code})
            </option>
          ))}
        </select>

        <select
          value={selectedRegion}
          onChange={(e) => setSelectedRegion(e.target.value)}
          style={{
            fontSize: "0.82rem",
            padding: "0.4rem 0.75rem",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface-white)",
          }}
        >
          <option value="all">All Regions</option>
          {state.regions.map((r) => (
            <option key={r.id} value={r.name}>
              {r.name}
            </option>
          ))}
        </select>

        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          style={{
            fontSize: "0.82rem",
            padding: "0.4rem 0.75rem",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface-white)",
          }}
        >
          <option value="all">All Categories</option>
          {state.categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>

        {(selectedBureau !== "all" ||
          selectedRegion !== "all" ||
          selectedCategory !== "all" ||
          filterPill !== "all" ||
          searchQuery) && (
          <button
            type="button"
            className="button button-quiet"
            style={{ fontSize: "0.78rem" }}
            onClick={() => {
              setSelectedBureau("all");
              setSelectedRegion("all");
              setSelectedCategory("all");
              setFilterPill("all");
              setSearchQuery("");
            }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* KANBAN VIEW (Fernly Reference 01) */}
      {viewMode === "kanban" ? (
        <div className="kanban-view-container">
          {KANBAN_STAGES.map((stage) => {
            const stageCases = filteredCases.filter(
              (c) => c.status === stage.id,
            );
            return (
              <div key={stage.id} className="kanban-column">
                <div className="kanban-column-header">
                  <div className="kanban-column-title-row">
                    <span
                      className="kanban-status-dot"
                      style={{ backgroundColor: stage.color }}
                    />
                    <span className="kanban-column-title">{stage.title}</span>
                  </div>
                  <span className="kanban-column-count">
                    {stageCases.length}
                  </span>
                </div>

                {stageCases.map((c) => {
                  const deadlineInfo = getRemainingTimeDisplay(
                    c.target_resolution_date,
                    c.status,
                  );
                  const overlaps = getOverlappingCases(state, c.case_id);
                  return (
                    <Link
                      key={c.case_id}
                      to={`/cases/${c.case_id}`}
                      className="kanban-card"
                    >
                      <div className="kanban-card-meta">
                        <span className={`badge badge-priority-${c.priority}`}>
                          {severityLabel(c.priority).toUpperCase()}
                        </span>
                        {overlaps.length > 0 && (
                          <span
                            className="badge"
                            style={{
                              background: "#fef3c7",
                              color: "#92400e",
                              border: "1px solid #d97706",
                              fontSize: "0.68rem",
                              fontWeight: 700,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.2rem",
                            }}
                          >
                            <IconAlertTriangle className="w-3 h-3" /> Overlap
                          </span>
                        )}
                        <span
                          className="small muted font-semibold"
                          style={{ fontSize: "0.72rem" }}
                        >
                          {c.case_number}
                        </span>
                      </div>

                      <div className="kanban-card-title">
                        {canReadCase(c, activePersona, state)
                          ? c.title
                          : "Restricted case · request access to view"}
                      </div>
                      <div className="kanban-card-inst">
                        {c.institution_name}
                        {c.institution_code ? ` · ${c.institution_code}` : ""}
                      </div>

                      {c.next_action_required && (
                        <div
                          style={{
                            fontSize: "0.72rem",
                            color: "#155a37",
                            fontWeight: 600,
                            marginTop: "0.25rem",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Next: {c.next_action_required}
                        </div>
                      )}

                      <div className="kanban-card-footer">
                        <div
                          className="kanban-card-time"
                          style={{
                            color: deadlineInfo.isOverdue
                              ? "var(--color-danger)"
                              : deadlineInfo.isWarning
                                ? "var(--color-warning)"
                                : "var(--color-text-muted)",
                            fontWeight: deadlineInfo.isWarning ? 700 : 500,
                          }}
                        >
                          <IconClock className="w-3.5 h-3.5" />
                          <span>{deadlineInfo.text}</span>
                        </div>

                        {/* Officer Avatars Stack */}
                        <div className="kanban-card-avatars">
                          {c.officer_assignments.length > 0 ? (
                            c.officer_assignments.map((oa) => (
                              <span
                                key={oa.officer_assignment_id}
                                className="avatar-stack-item"
                                style={{ backgroundColor: "#155a37" }}
                                title={`${oa.officer_name} (${oa.role})`}
                              >
                                {oa.officer_name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .slice(0, 2)
                                  .join("")}
                              </span>
                            ))
                          ) : (
                            <span
                              className="avatar-stack-item"
                              style={{ backgroundColor: "#9ca3af" }}
                              title="Unassigned"
                            >
                              ?
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}

                {stageCases.length === 0 && (
                  <div
                    style={{
                      padding: "2rem 1rem",
                      textAlign: "center",
                      color: "var(--color-text-muted)",
                      fontSize: "0.82rem",
                      border: "1px dashed var(--color-border)",
                      borderRadius: "var(--radius-lg)",
                    }}
                  >
                    No cases in this stage
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Case Number</th>
                <th>Title</th>
                <th>Institution</th>
                <th>Category</th>
                <th>Lead Bureau</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Deadline</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCases.map((c) => {
                const deadline = getRemainingTimeDisplay(
                  c.target_resolution_date,
                  c.status,
                );
                return (
                  <tr key={c.case_id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                        <Link
                          to={`/cases/${c.case_id}`}
                          style={{ fontWeight: 600 }}
                        >
                          {c.case_number}
                        </Link>
                        {getOverlappingCases(state, c.case_id).length > 0 && (
                          <span
                            className="badge"
                            title="Potential Overlapping Cases – Coordination Required"
                            style={{
                              background: "#fef3c7",
                              color: "#92400e",
                              border: "1px solid #d97706",
                              fontSize: "0.68rem",
                              fontWeight: 700,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.2rem",
                            }}
                          >
                            <IconAlertTriangle className="w-3 h-3" /> Overlap
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ maxWidth: "260px" }}>
                      <div
                        style={{
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {canReadCase(c, activePersona, state)
                          ? c.title
                          : "Restricted case · request access to view"}
                      </div>
                      {c.next_action_required && (
                        <div
                          style={{
                            fontSize: "0.72rem",
                            color: "#155a37",
                            fontWeight: 600,
                            marginTop: "0.2rem",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Next: {c.next_action_required}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.institution_name}</div>
                      <div className="small muted" style={{ fontSize: "0.74rem" }}>
                        {c.institution_code || "AICTE ID recorded"} · {c.institution_region || "Northern"}
                      </div>
                    </td>
                    <td>
                      <span className="small muted">{c.category_name}</span>
                    </td>
                    <td>
                      <span className="small font-semibold">
                        {c.lead_bureau_code}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-priority-${c.priority}`}>
                        {severityLabel(c.priority)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-status-${c.status}`}>
                        {c.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: deadline.isWarning ? 700 : 500,
                          color: deadline.isOverdue
                            ? "var(--color-danger)"
                            : deadline.isWarning
                              ? "var(--color-warning)"
                              : "inherit",
                        }}
                      >
                        {deadline.text}
                      </span>
                    </td>
                    <td>
                      <Link
                        to={`/cases/${c.case_id}`}
                        className="button button-quiet"
                        style={{
                          padding: "0.25rem 0.6rem",
                          fontSize: "0.78rem",
                        }}
                      >
                        View &rarr;
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Case Modal */}
      {showCreateModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowCreateModal(false)}
        >
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Canonical Case</h3>
              <button
                type="button"
                className="btn-icon-close"
                onClick={() => setShowCreateModal(false)}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateCase}>
              {createError && (
                <p role="alert" className="error-panel">
                  {createError}
                </p>
              )}
              <label>
                Source Submission
                <select
                  required
                  value={sourceSubId}
                  onChange={(e) => setSourceSubId(e.target.value)}
                >
                  <option value="">Select verified submission...</option>
                  {accessibleSubmissions(state, activePersona)
                    .filter(
                      (sub) =>
                        sub.institution_verified &&
                        !sub.canonical_case_id &&
                        !state.duplicateCandidates.some(
                          (d) =>
                            d.submission_id === sub.id &&
                            d.review_status === "pending",
                        ),
                    )
                    .map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.submission_number}:{" "}
                        {sub.institution_name_submitted} (
                        {sub.subject.slice(0, 40)}...)
                      </option>
                    ))}
                </select>
              </label>

              <label>
                Lead Bureau Assignment
                <select
                  value={leadBureauId}
                  onChange={(e) => setLeadBureauId(e.target.value)}
                >
                  <option value="">Select Bureau...</option>
                  {state.bureaus
                    .filter(
                      (b) =>
                        activePersona.scopeType === "global" ||
                        b.id === activePersona.bureauId,
                    )
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code}: {b.name}
                      </option>
                    ))}
                </select>
              </label>

              <label>
                Case Title
                <input
                  type="text"
                  required
                  placeholder="Enter canonical summary title..."
                  value={caseTitle}
                  onChange={(e) => setCaseTitle(e.target.value)}
                />
              </label>

              <label>
                Detailed Description &amp; Regulatory Context
                <textarea
                  rows={4}
                  required
                  placeholder="Summarize the core grievance issue, violation of APH clauses, and relief sought..."
                  value={caseDesc}
                  onChange={(e) => setCaseDesc(e.target.value)}
                />
              </label>

              <label>
                Priority
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as CasePriority)}
                >
                  <option value="low">Low</option>
                  <option value="normal">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>

              <div className="modal-footer">
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
    </div>
  );
}

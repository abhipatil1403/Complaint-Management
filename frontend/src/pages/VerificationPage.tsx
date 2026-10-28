import { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from "../components/ui";
import { formatDateTime } from "../lib/intake";
import { usePagedResource } from "../lib/useResource";
import {
  evidenceLabel,
  priorityLabel,
  roundTypeLabel,
  taskStatusLabel,
} from "../lib/verification";
import type { VerificationPriority, VerificationTask, VerificationTaskStatus } from "../types";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

const STATUS_FILTERS = [
  { value: "open", label: "Open (Pending & In Review)" },
  { value: "pending", label: "Pending" },
  { value: "in_review", label: "In Review" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All Tasks" },
];

const ASSIGNMENT_FILTERS = [
  { value: "all", label: "All assignments" },
  { value: "mine", label: "Assigned to me" },
  { value: "unassigned", label: "Unassigned only" },
];

const PRIORITY_FILTERS: Array<{ value: VerificationPriority | ""; label: string }> = [
  { value: "", label: "All priorities" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

export function VerificationPage() {
  const { has } = useAuth();
  const [statusFilter, setStatusFilter] = useState("open");
  const [assignment, setAssignment] = useState("all");
  const [priority, setPriority] = useState<VerificationPriority | "">("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState("oldest");

  const { items, loading, error, hasMore, reload, loadMore } = usePagedResource<VerificationTask>(
    "/verification/tasks",
    {
      status: statusFilter,
      assignment,
      priority: priority || undefined,
      q: searchQuery.trim() || undefined,
      sort,
    },
    { enabled: has("institution.verify") },
  );

  if (!has("institution.verify")) {
    return <PermissionDeniedPage />;
  }

  return (
    <section>
      <PageHeader
        title="Institution verification queue"
        description="Verify submitted institution identities before duplicate matching or case creation. Advisory evidence must be reviewed by an authorized officer."
        actions={
          <button type="button" className="button button-quiet" onClick={() => void reload()}>
            Refresh
          </button>
        }
      />

      <div className="callout callout-warning">
        <strong>Mandatory human review:</strong> Candidate matches and permanent ID evidence are advisory only.
        The AICTE OneDesk verification contract forbids automatic case association; an authorized reviewer
        must explicitly select the institution and record a reason.
      </div>

      <div className="card">
        <div className="toolbar toolbar-wrap">
          <h2>Verification tasks</h2>
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
            Assignment
            <select
              value={assignment}
              onChange={(event) => setAssignment(event.target.value)}
            >
              {ASSIGNMENT_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Priority
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as VerificationPriority | "")}
            >
              {PRIORITY_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Order
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="oldest">Oldest first (FIFO)</option>
              <option value="recent">Most recent first</option>
            </select>
          </label>

          <label>
            Search
            <input
              type="search"
              placeholder="Institution name..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        </div>

        <ErrorPanel error={error} />
        {loading && items.length === 0 ? <Loading /> : null}
        {!loading && !error && items.length === 0 ? (
          <EmptyState
            title="No verification tasks found"
            description="All submissions in this queue filter have been resolved or none match your criteria."
          />
        ) : null}

        {items.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Task / Submission</th>
                  <th scope="col">Submitted Institution</th>
                  <th scope="col">Round Type</th>
                  <th scope="col">Priority / Age</th>
                  <th scope="col">Evidence</th>
                  <th scope="col">Assigned To</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="align-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <div>
                        <strong>{task.submission.external_reference || "Ref pending"}</strong>
                      </div>
                      <small className="muted">{formatDateTime(task.submission.received_at)}</small>
                    </td>
                    <td>
                      <div>
                        <strong>{task.submitted_institution_name}</strong>
                      </div>
                      {task.submitted_permanent_id ? (
                        <small className="muted">Permanent ID: {task.submitted_permanent_id}</small>
                      ) : null}
                    </td>
                    <td>
                      <span className="badge badge-neutral">{roundTypeLabel(task.round_type)}</span>
                    </td>
                    <td>
                      <div>
                        <strong>{priorityLabel(task.priority)}</strong>
                      </div>
                      <small className="muted">{task.age_days}d in queue</small>
                    </td>
                    <td>
                      {task.strongest_evidence ? (
                        <div>
                          <span className="badge badge-neutral">
                            {evidenceLabel(task.strongest_evidence)}
                          </span>
                        </div>
                      ) : (
                        <small className="muted">No candidate match</small>
                      )}
                      <small className="muted">{task.candidate_count} candidate(s)</small>
                    </td>
                    <td>
                      {task.assigned_to_name || (
                        <span className="muted">Unassigned</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge
                        value={task.status}
                        label={taskStatusLabel(task.status as VerificationTaskStatus)}
                      />
                    </td>
                    <td className="align-right">
                      <Link
                        to={`/verification/tasks/${task.id}`}
                        className="button button-quiet"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {hasMore ? (
          <div className="card-actions">
            <button
              type="button"
              className="button button-quiet"
              disabled={loading}
              onClick={() => void loadMore()}
            >
              {loading ? "Loading..." : "Load more tasks"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

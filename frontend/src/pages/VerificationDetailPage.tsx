import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from "../components/ui";
import { toApiError, type ApiError } from "../lib/api";
import { formatDateTime } from "../lib/intake";
import { useResource } from "../lib/useResource";
import {
  evidenceLabel,
  priorityLabel,
  roundTypeLabel,
  taskStatusLabel,
} from "../lib/verification";
import type {
  VerificationAction,
  VerificationCandidate,
  VerificationCandidateList,
  VerificationTask,
  VerificationTaskStatus,
} from "../types";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

export function VerificationDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { api, has, me } = useAuth();

  const {
    data: task,
    loading: taskLoading,
    error: taskError,
    reload: reloadTask,
  } = useResource<VerificationTask>(
    has("institution.verify") && taskId ? `/verification/tasks/${taskId}` : null,
  );

  const {
    data: candidatesData,
    loading: candidatesLoading,
    error: candidatesError,
  } = useResource<VerificationCandidateList>(
    has("institution.verify") && task?.submission.id
      ? `/verification/submissions/${task.submission.id}/candidates`
      : null,
  );

  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string>("");
  const [selectedInstitutionName, setSelectedInstitutionName] = useState<string>("");
  const [reason, setReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Correction round state
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionLoading, setCorrectionLoading] = useState(false);
  const [correctionError, setCorrectionError] = useState<ApiError | null>(null);

  if (!has("institution.verify")) {
    return <PermissionDeniedPage />;
  }

  if (taskLoading && !task) {
    return <Loading label="Loading verification task..." />;
  }

  if (taskError && !task) {
    return <ErrorPanel error={taskError} title="Unable to load verification task" />;
  }

  if (!task) {
    return null;
  }

  const isResolved = task.status === "verified" || task.status === "rejected";
  const candidates = candidatesData?.data ?? [];
  const isAssignedToMe = task.assigned_to_user_id === me?.user.id;

  const handleSelectCandidate = (candidate: VerificationCandidate) => {
    setSelectedInstitutionId(candidate.institution_id);
    setSelectedInstitutionName(`${candidate.official_name} (${candidate.permanent_id || "No ID"})`);
  };

  const handleDecision = async (action: VerificationAction) => {
    setActionError(null);
    setActionSuccess(null);
    setActionLoading(true);

    try {
      const payload: {
        action: VerificationAction;
        institution_id?: string | null;
        reason?: string | null;
        expected_updated_at?: string;
      } = {
        action,
        expected_updated_at: task.updated_at,
      };

      if (action === "confirm") {
        if (!selectedInstitutionId) {
          throw new Error("Please select an institution to confirm.");
        }
        if (!reason.trim()) {
          throw new Error("A reason is required to confirm an institution association.");
        }
        payload.institution_id = selectedInstitutionId;
        payload.reason = reason.trim();
      } else if (action === "reject") {
        if (!reason.trim()) {
          throw new Error("A reason is required to reject an association match.");
        }
        payload.reason = reason.trim();
      } else if (action === "request_information") {
        if (!reason.trim()) {
          throw new Error("Notes or a reason are required when requesting information.");
        }
        payload.reason = reason.trim();
      }

      await api.post(`/verification/tasks/${task.id}/decision`, payload);
      setActionSuccess(`Successfully performed action: ${action}`);
      setReason("");
      await reloadTask();
    } catch (err) {
      setActionError(toApiError(err));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestCorrectionRound = async () => {
    if (!correctionReason.trim()) {
      return;
    }
    setCorrectionError(null);
    setCorrectionLoading(true);
    try {
      const result = await api.post<VerificationTask>(
        `/verification/submissions/${task.submission.id}/correction-rounds`,
        {
          reason: correctionReason.trim(),
          expected_submission_updated_at: task.submission.updated_at,
        },
      );
      setCorrectionReason("");
      navigate(`/verification/tasks/${result.id}`);
    } catch (err) {
      setCorrectionError(toApiError(err));
    } finally {
      setCorrectionLoading(false);
    }
  };

  return (
    <section>
      <PageHeader
        title={`Verification task: ${task.submitted_institution_name}`}
        description={`Submission ${task.submission.external_reference || task.submission.id}`}
        actions={
          <div className="page-actions">
            <Link to="/verification" className="button button-quiet">
              ← Back to queue
            </Link>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => void reloadTask()}
            >
              Refresh
            </button>
          </div>
        }
      />

      <div className="callout callout-info">
        <strong>Content Privacy Guaranteed:</strong> Complaint bodies and subjective text are strictly isolated
        and excluded from this queue. Only provenance, submitted institution names, and reference codes are exposed.
      </div>

      {actionSuccess ? (
        <div className="callout callout-success" role="status">
          {actionSuccess}
        </div>
      ) : null}

      <div className="detail-grid">
        {/* Task Metadata Card */}
        <div className="card">
          <h2>Task status &amp; priority</h2>
          <dl className="meta-list">
            <div>
              <dt>Status</dt>
              <dd>
                <StatusBadge
                  value={task.status}
                  label={taskStatusLabel(task.status as VerificationTaskStatus)}
                />
              </dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>
                <strong>{priorityLabel(task.priority)}</strong>
              </dd>
            </div>
            <div>
              <dt>Round Type</dt>
              <dd>
                <span className="badge badge-neutral">{roundTypeLabel(task.round_type)}</span>
              </dd>
            </div>
            <div>
              <dt>Queue Age</dt>
              <dd>{task.age_days} day(s)</dd>
            </div>
            <div>
              <dt>Assigned Reviewer</dt>
              <dd>{task.assigned_to_name || <span className="muted">Unassigned</span>}</dd>
            </div>
            <div>
              <dt>Created / Updated</dt>
              <dd>
                {formatDateTime(task.created_at)} / {formatDateTime(task.updated_at)}
              </dd>
            </div>
          </dl>

          {!isResolved ? (
            <div className="card-actions">
              {!isAssignedToMe ? (
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={actionLoading}
                  onClick={() => void handleDecision("assign_to_me")}
                >
                  Assign to me
                </button>
              ) : (
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={actionLoading}
                  onClick={() => void handleDecision("unassign")}
                >
                  Unassign
                </button>
              )}
            </div>
          ) : null}
        </div>

        {/* Provenance Card */}
        <div className="card">
          <h2>Submission provenance</h2>
          <dl className="meta-list">
            <div>
              <dt>Intake Channel</dt>
              <dd>
                {task.submission.channel_name} (<code>{task.submission.channel_code}</code>)
              </dd>
            </div>
            <div>
              <dt>External Reference</dt>
              <dd>
                <code>{task.submission.external_reference || "None"}</code>
              </dd>
            </div>
            <div>
              <dt>Received At</dt>
              <dd>{formatDateTime(task.submission.received_at)}</dd>
            </div>
            <div>
              <dt>Submitted Institution Name</dt>
              <dd>
                <strong>{task.submitted_institution_name}</strong>
              </dd>
            </div>
            <div>
              <dt>Submitted Permanent ID</dt>
              <dd>{task.submitted_permanent_id || <span className="muted">None provided</span>}</dd>
            </div>
            <div>
              <dt>Intake Status</dt>
              <dd>
                <StatusBadge value={task.submission.intake_status} />
              </dd>
            </div>
            <div>
              <dt>Current Associated Institution</dt>
              <dd>
                {task.submission.institution_official_name ? (
                  <span>
                    <strong>{task.submission.institution_official_name}</strong>{" "}
                    ({task.submission.institution_permanent_id})
                  </span>
                ) : (
                  <span className="muted">None (unresolved)</span>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Advisory Candidate Matches */}
      <div className="card">
        <div className="toolbar">
          <h2>Advisory candidate matches ({candidates.length})</h2>
          <small className="muted">
            Ranked by match confidence. Candidate matches are advisory only and must be explicitly selected.
          </small>
        </div>

        <ErrorPanel error={candidatesError} />
        {candidatesLoading && candidates.length === 0 ? <Loading label="Finding candidates..." /> : null}

        {!candidatesLoading && candidates.length === 0 ? (
          <EmptyState
            title="No automatic candidates identified"
            description="No exact permanent ID, name, or verified alias match was found in the database. You may verify manually or reject."
          />
        ) : null}

        {candidates.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {!isResolved ? <th scope="col" style={{ width: "3rem" }}>Select</th> : null}
                  <th scope="col">Institution</th>
                  <th scope="col">Permanent ID</th>
                  <th scope="col">Region</th>
                  <th scope="col">Evidence Match</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const isSelected = selectedInstitutionId === c.institution_id;
                  return (
                    <tr
                      key={c.institution_id}
                      className={isSelected ? "selected-row" : ""}
                      onClick={() => !isResolved && handleSelectCandidate(c)}
                      style={{ cursor: !isResolved ? "pointer" : "default" }}
                    >
                      {!isResolved ? (
                        <td>
                          <input
                            type="radio"
                            name="candidate_select"
                            checked={isSelected}
                            onChange={() => handleSelectCandidate(c)}
                          />
                        </td>
                      ) : null}
                      <td>
                        <strong>{c.official_name}</strong>
                        {c.matched_alias_name ? (
                          <div>
                            <small className="muted">Matched Alias: {c.matched_alias_name}</small>
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <code>{c.permanent_id || "—"}</code>
                      </td>
                      <td>{c.region_name || c.region_code || "—"}</td>
                      <td>
                        {c.evidence.map((ev) => (
                          <span key={ev} className="badge badge-neutral" style={{ marginRight: "0.25rem" }}>
                            {evidenceLabel(ev)}
                          </span>
                        ))}
                      </td>
                      <td>
                        <StatusBadge value={c.is_active ? "active" : "inactive"} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {/* Decision Interface (Active Task) */}
      {!isResolved ? (
        <div className="card">
          <h2>Verification decision</h2>
          <p className="page-description">
            To confirm an association, you must explicitly select an institution above or specify its ID, and supply a reason.
          </p>

          <ErrorPanel error={actionError} />

          <div className="form-grid">
            <label>
              Selected institution for confirmation
              <input
                type="text"
                readOnly
                placeholder="Click a candidate above to select"
                value={selectedInstitutionName || selectedInstitutionId}
              />
            </label>

            <label>
              Manual Institution UUID (if not in candidates list)
              <input
                type="text"
                placeholder="00000000-0000-0000-0000-000000000000"
                value={selectedInstitutionId}
                onChange={(e) => {
                  setSelectedInstitutionId(e.target.value.trim());
                  setSelectedInstitutionName("");
                }}
              />
            </label>

            <label>
              Decision reason / review notes (Required for Confirm, Reject &amp; Request Info)
              <textarea
                rows={4}
                placeholder="State the rationale for your decision (e.g., verified via permanent ID record or official directory)..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </div>

          <div className="card-actions" style={{ marginTop: "1rem", display: "flex", gap: "0.75rem" }}>
            <button
              type="button"
              className="button button-primary"
              disabled={actionLoading || !selectedInstitutionId || !reason.trim()}
              onClick={() => void handleDecision("confirm")}
            >
              {actionLoading ? "Processing..." : "Confirm association"}
            </button>

            <button
              type="button"
              className="button button-danger"
              disabled={actionLoading || !reason.trim()}
              onClick={() => void handleDecision("reject")}
            >
              Reject match (No match)
            </button>

            <button
              type="button"
              className="button button-quiet"
              disabled={actionLoading || !reason.trim()}
              onClick={() => void handleDecision("request_information")}
            >
              Log note / Request information
            </button>
          </div>
        </div>
      ) : null}

      {/* Resolution Details & Correction Round Option */}
      {isResolved ? (
        <div className="card">
          <h2>Resolution record</h2>
          <dl className="meta-list">
            <div>
              <dt>Final Status</dt>
              <dd>
                <StatusBadge
                  value={task.status}
                  label={taskStatusLabel(task.status as VerificationTaskStatus)}
                />
              </dd>
            </div>
            {task.resolved_institution_name ? (
              <div>
                <dt>Resolved Institution</dt>
                <dd>
                  <strong>{task.resolved_institution_name}</strong>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Resolved By</dt>
              <dd>{task.reviewed_by_name || "Authorized Reviewer"}</dd>
            </div>
            <div>
              <dt>Resolved At</dt>
              <dd>{formatDateTime(task.resolved_at)}</dd>
            </div>
            <div>
              <dt>Resolution Notes</dt>
              <dd>
                <pre className="notes-block">{task.resolution_notes || "None"}</pre>
              </dd>
            </div>
          </dl>

          {/* Option to open a correction round if institution is set and case not created */}
          {task.submission.canonical_case_id === null ? (
            <div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--color-border)", paddingTop: "1rem" }}>
              <h3>Open a correction round</h3>
              <p className="page-description">
                If the verified institution association was incorrect, you may request a correction round.
                <strong> Note:</strong> Under the independent review rule, you cannot confirm your own correction request.
              </p>

              <ErrorPanel error={correctionError} />

              <label>
                Reason for correction
                <textarea
                  rows={3}
                  placeholder="Explain why this association needs correction..."
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                />
              </label>

              <div className="card-actions" style={{ marginTop: "0.75rem" }}>
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={correctionLoading || !correctionReason.trim()}
                  onClick={() => void handleRequestCorrectionRound()}
                >
                  {correctionLoading ? "Opening round..." : "Request correction round"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

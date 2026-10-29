import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { ErrorPanel, Loading, PageHeader, StatusBadge } from "../components/ui";
import { formatDateTime } from "../lib/intake";
import { useResource } from "../lib/useResource";
import {
  DECISION_LABELS,
  duplicateStatusLabel,
  heuristicLabel,
} from "../lib/duplicateReview";
import type { DuplicateCandidateDetail, DuplicateReviewDecision } from "../types";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

export function DuplicateReviewDetailPage() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const navigate = useNavigate();
  const { has, api } = useAuth();

  const [decisionNotes, setDecisionNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [rejectReason, setRejectReason] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);

  const { data: candidate, loading, error } = useResource<DuplicateCandidateDetail>(
    has("duplicate.review") && candidateId ? `/duplicate-review/candidates/${candidateId}` : null,
  );

  if (!has("duplicate.review")) {
    return <PermissionDeniedPage />;
  }

  if (loading) {
    return <Loading label="Loading candidate details..." />;
  }

  if (error || !candidate) {
    return (
      <section>
        <PageHeader title="Duplicate Review" />
        <ErrorPanel error={error} title="Candidate not found" />
      </section>
    );
  }

  const handleMakeDecision = async (action: DuplicateReviewDecision) => {
    if (!decisionNotes.trim() || decisionNotes.trim().length < 3) {
      setActionError("Explicit justification notes (minimum 3 characters) are required for every duplicate decision.");
      return;
    }
    setIsSubmitting(true);
    setActionError(null);
    try {
      await api.post(`/duplicate-review/candidates/${candidate.candidate_id}/decide`, {
        action,
        notes: decisionNotes.trim(),
        expected_submission_updated_at: candidate.submission_updated_at,
        expected_candidate_updated_at: candidate.candidate_updated_at,
      });
      navigate("/duplicate-review");
    } catch (err: any) {
      setActionError(err?.message || "Failed to record decision.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectSubmission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectReason.trim() || rejectReason.trim().length < 3) {
      setActionError("A formal rejection reason (minimum 3 characters) is required.");
      return;
    }
    setIsSubmitting(true);
    setActionError(null);
    try {
      await api.post(`/duplicate-review/submissions/${candidate.submission_id}/reject`, {
        reason: rejectReason.trim(),
        expected_submission_updated_at: candidate.submission_updated_at,
      });
      setShowRejectModal(false);
      navigate("/duplicate-review");
    } catch (err: any) {
      setActionError(err?.message || "Failed to reject submission.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isPending = candidate.review_status === "pending";

  return (
    <section>
      <PageHeader
        title={`Candidate Review: ${candidate.case_number}`}
        description={`Evaluating submission against case ${candidate.case_number} (${candidate.submission_institution_name || "Verified Institution"})`}
        actions={
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Link to="/duplicate-review" className="button button-quiet">
              Back to Queue
            </Link>
          </div>
        }
      />

      {actionError && (
        <div className="callout callout-danger" style={{ marginBottom: "1rem" }}>
          {actionError}
        </div>
      )}

      {/* Review Status Banner */}
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <strong>Review Status: </strong>
            <StatusBadge
              value={candidate.review_status}
              label={duplicateStatusLabel(candidate.review_status)}
            />
          </div>
          <div>
            <strong>Score: </strong>
            <span>{(candidate.similarity_score * 100).toFixed(0)}% ({heuristicLabel(candidate.similarity_score)})</span>
          </div>
        </div>
        {candidate.reviewed_at && (
          <div className="hint" style={{ marginTop: "0.5rem" }}>
            Reviewed by officer on {formatDateTime(candidate.reviewed_at)}
            {candidate.review_notes && ` — Notes: "${candidate.review_notes}"`}
          </div>
        )}
      </div>

      {/* Side-by-Side Comparison Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
        {/* Left Column: Intake Submission */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Intake Submission</h3>
          <p className="hint">
            Subject: <strong>{candidate.submission_subject}</strong>
          </p>
          <div style={{ marginBottom: "0.5rem" }}>
            <strong>Verified Institution:</strong>
            <div>{candidate.submission_institution_name || "Unverified"}</div>
          </div>
          <div style={{ marginBottom: "0.5rem" }}>
            <strong>Category:</strong>
            <div>{candidate.submission_category_name || "Unassigned"}</div>
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <strong>Last Updated (Lock Check):</strong>
            <div>{formatDateTime(candidate.submission_updated_at)}</div>
          </div>
          <div>
            <strong>Submission Body:</strong>
            <div
              style={{
                marginTop: "0.5rem",
                padding: "0.75rem",
                background: "var(--color-bg-subtle, #f5f5f5)",
                borderRadius: "4px",
                whiteSpace: "pre-wrap",
                fontSize: "0.9rem",
                maxHeight: "300px",
                overflowY: "auto",
              }}
            >
              {candidate.submission_body || "No text available."}
            </div>
          </div>
        </div>

        {/* Right Column: Candidate Target Case */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <h3 style={{ marginTop: 0 }}>Candidate Canonical Case</h3>
            <span className="badge badge-neutral">{candidate.case_status}</span>
          </div>
          <p className="hint">
            Case Number: <strong>{candidate.case_number}</strong>
          </p>
          <div style={{ marginBottom: "0.5rem" }}>
            <strong>Case Title:</strong>
            <div>{candidate.case_title}</div>
          </div>
          <div style={{ marginBottom: "0.5rem" }}>
            <strong>Category:</strong>
            <div>{candidate.case_category_name || "Unassigned"}</div>
          </div>
          <div style={{ marginBottom: "0.5rem" }}>
            <strong>Lead Bureau:</strong>
            <div>{candidate.case_lead_bureau_name || "Unassigned"}</div>
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <strong>Opened:</strong>
            <div>{formatDateTime(candidate.case_created_at)}</div>
          </div>

          <div>
            <strong>Matching Signals:</strong>
            <pre
              style={{
                marginTop: "0.5rem",
                padding: "0.75rem",
                background: "var(--color-bg-subtle, #f5f5f5)",
                borderRadius: "4px",
                fontSize: "0.85rem",
                maxHeight: "150px",
                overflowY: "auto",
              }}
            >
              {JSON.stringify(candidate.matching_signals, null, 2)}
            </pre>
          </div>
        </div>
      </div>

      {/* Decision Section */}
      {isPending && (
        <div className="card">
          <h3>Record Human Review Decision</h3>
          <p className="hint">
            Select one of the three verified decision actions. Explicit justification is required.
          </p>

          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="decisionNotes">Decision Notes / Justification * (Required)</label>
            <textarea
              id="decisionNotes"
              rows={3}
              value={decisionNotes}
              onChange={(e) => setDecisionNotes(e.target.value)}
              placeholder="State the justification for duplicate confirmation, non-duplicate screening, or relationship..."
              style={{ width: "100%", marginTop: "0.25rem" }}
            />
          </div>

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className="button button-danger"
              disabled={isSubmitting}
              onClick={() => void handleMakeDecision("confirmed_duplicate")}
            >
              {DECISION_LABELS.confirmed_duplicate}
            </button>
            <button
              type="button"
              className="button button-success"
              disabled={isSubmitting}
              onClick={() => void handleMakeDecision("not_duplicate")}
            >
              {DECISION_LABELS.not_duplicate}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={isSubmitting}
              onClick={() => void handleMakeDecision("related")}
            >
              {DECISION_LABELS.related}
            </button>

            {has("submission.reject") && (
              <button
                type="button"
                className="button button-quiet"
                style={{ color: "var(--color-danger)", marginLeft: "auto" }}
                disabled={isSubmitting}
                onClick={() => setShowRejectModal(true)}
              >
                Reject Submission Entirely
              </button>
            )}
          </div>
        </div>
      )}

      {/* Reject Submission Modal */}
      {showRejectModal && (
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
          <div className="card" style={{ maxWidth: "500px", width: "90%", background: "#fff" }}>
            <h3>Reject Intake Submission</h3>
            <p className="hint">
              This will mark the intake submission as rejected with the reason recorded. This action requires global SUBMISSION.REJECT authority.
            </p>
            <form onSubmit={handleRejectSubmission}>
              <div style={{ marginBottom: "1rem" }}>
                <label>Rejection Reason *</label>
                <textarea
                  required
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="State the formal basis for rejection..."
                  style={{ width: "100%", marginTop: "0.25rem" }}
                />
              </div>
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setShowRejectModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-danger"
                  disabled={isSubmitting}
                >
                  Confirm Rejection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

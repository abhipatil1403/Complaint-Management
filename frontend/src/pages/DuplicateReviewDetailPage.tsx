import { useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { ErrorPanel, Loading, PageHeader, StatusBadge } from "../components/ui";
import { formatDateTime } from "../lib/intake";
import { useResource } from "../lib/useResource";
import { useSimulation } from "../simulation/selectors";
import {
  DECISION_LABELS,
  duplicateStatusLabel,
  heuristicLabel,
} from "../lib/duplicateReview";
import {
  analyzeDuplicateWithGemini,
  type GeminiDuplicateResult,
} from "../lib/gemini";
import type {
  DuplicateCandidateDetail,
  DuplicateReviewDecision,
} from "../types";
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

  // Link to other existing case states
  const simState = useSimulation();
  const [showLinkOtherModal, setShowLinkOtherModal] = useState(false);
  const [selectedTargetCaseId, setSelectedTargetCaseId] = useState("");
  const [otherCaseSearch, setOtherCaseSearch] = useState("");
  const [filterSameInstOnly, setFilterSameInstOnly] = useState(true);

  const [geminiDupResult, setGeminiDupResult] = useState<GeminiDuplicateResult | null>(null);
  const [isAnalyzingDup, setIsAnalyzingDup] = useState(false);

  const {
    data: candidate,
    loading,
    error,
  } = useResource<DuplicateCandidateDetail>(
    has("duplicate.review") && candidateId
      ? `/duplicate-review/candidates/${candidateId}`
      : null,
  );

  useEffect(() => {
    if (!candidate) return;
    setIsAnalyzingDup(true);
    analyzeDuplicateWithGemini(
      {
        subject: candidate.submission_subject,
        institution_name: candidate.submission_institution_name || "",
        body: candidate.submission_body || "",
        category: candidate.submission_category_name || undefined,
      },
      {
        case_number: candidate.case_number,
        title: candidate.case_title,
        institution_name: candidate.submission_institution_name || "",
        description: candidate.case_title,
        category: candidate.case_category_name || undefined,
      },
      candidate.candidate_id,
    )
      .then(setGeminiDupResult)
      .catch((e) => console.error(e))
      .finally(() => setIsAnalyzingDup(false));
  }, [candidate?.candidate_id]);

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
      setActionError(
        "Explicit justification notes (minimum 3 characters) are required for every duplicate decision.",
      );
      return;
    }
    setIsSubmitting(true);
    setActionError(null);
    try {
      await api.post(
        `/duplicate-review/candidates/${candidate.candidate_id}/decide`,
        {
          action,
          notes: decisionNotes.trim(),
          expected_submission_updated_at: candidate.submission_updated_at,
          expected_candidate_updated_at: candidate.candidate_updated_at,
        },
      );
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
      setActionError(
        "A formal rejection reason (minimum 3 characters) is required.",
      );
      return;
    }
    setIsSubmitting(true);
    setActionError(null);
    try {
      await api.post(
        `/duplicate-review/submissions/${candidate.submission_id}/reject`,
        {
          reason: rejectReason.trim(),
          expected_submission_updated_at: candidate.submission_updated_at,
        },
      );
      setShowRejectModal(false);
      navigate("/duplicate-review");
    } catch (err: any) {
      setActionError(err?.message || "Failed to reject submission.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLinkToOtherCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTargetCaseId) {
      setActionError("Please select a target case to link this submission.");
      return;
    }
    setIsSubmitting(true);
    setActionError(null);
    try {
      await api.post(`/duplicate-review/candidates/${candidate.candidate_id}/decide`, {
        action: "confirmed_duplicate",
        target_case_id: selectedTargetCaseId,
        notes: decisionNotes.trim() || `Linked to case ${selectedTargetCaseId}`,
      });
      setShowLinkOtherModal(false);
      navigate("/duplicate-review");
    } catch (err: any) {
      setActionError(err?.message || "Failed to link submission to selected case.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const eligibleOtherCases = (simState.cases || [])
    .filter((c) => {
      if (filterSameInstOnly && candidate.submission_institution_name) {
        return (
          c.institution_name.toLowerCase() ===
          candidate.submission_institution_name.toLowerCase()
        );
      }
      return true;
    })
    .filter((c) => {
      if (!otherCaseSearch.trim()) return true;
      const term = otherCaseSearch.toLowerCase();
      return (
        c.case_number.toLowerCase().includes(term) ||
        c.title.toLowerCase().includes(term) ||
        c.institution_name.toLowerCase().includes(term)
      );
    });

  const isPending =
    candidate.review_status === "pending" &&
    candidate.case_content_accessible !== false;

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
        <div
          className="callout callout-danger"
          style={{ marginBottom: "1rem" }}
        >
          {actionError}
        </div>
      )}

      {/* Review Status Banner */}
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <strong>Review Status: </strong>
            <StatusBadge
              value={candidate.review_status}
              label={duplicateStatusLabel(candidate.review_status)}
            />
          </div>
          <div>
            <strong>Score: </strong>
            <span>
              {geminiDupResult
                ? `${(geminiDupResult.similarity_score * 100).toFixed(0)}% (AI Semantic Match)`
                : `${(candidate.similarity_score * 100).toFixed(0)}% (${heuristicLabel(candidate.similarity_score)})`}
            </span>
          </div>
        </div>
        {candidate.reviewed_at && (
          <div className="hint" style={{ marginTop: "0.5rem" }}>
            Reviewed by officer on {formatDateTime(candidate.reviewed_at)}
            {candidate.review_notes && ` — Notes: "${candidate.review_notes}"`}
          </div>
        )}
      </div>

      {/* AI Semantic Duplicate Analysis Card */}
      <div
        className="card"
        style={{
          background: "linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)",
          border: "1px solid #86efac",
          boxShadow: "var(--shadow-sm)",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "0.75rem",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <div>
            <h3 className="ai-gradient-title" style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800 }}>
              AI Semantic Duplicate Assessment
            </h3>
            <p className="small muted" style={{ margin: "0.15rem 0 0 0" }}>
              AI-assisted NLP semantic comparison and factual entity cross-referencing across institutional submissions.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span
              className="badge"
              style={{
                background: "#dcfce7",
                color: "#166534",
                border: "1px solid #86efac",
                fontWeight: 700,
                fontSize: "0.78rem",
              }}
            >
              {isAnalyzingDup ? "Analyzing with AICTE Semantic Engine..." : (geminiDupResult?.modelUsed || "AICTE Semantic Engine (Active)")}
            </span>
            {geminiDupResult && (
              <span
                className="badge"
                style={{
                  background: geminiDupResult.similarity_score >= 0.85 ? "#fee2e2" : "#fef3c7",
                  color: geminiDupResult.similarity_score >= 0.85 ? "#991b1b" : "#92400e",
                  border: "1px solid #fca5a5",
                  fontWeight: 700,
                  fontSize: "0.78rem",
                }}
              >
                {Math.round(geminiDupResult.similarity_score * 100)}% Semantic Similarity ({geminiDupResult.confidence_score}% Confidence)
              </span>
            )}
          </div>
        </div>

        <div
          style={{
            background: "#ffffff",
            padding: "0.85rem 1rem",
            borderRadius: "var(--radius-md)",
            border: "1px solid #bbf7d0",
            fontSize: "0.88rem",
            lineHeight: 1.55,
            color: "var(--color-text-primary)",
            marginBottom: "0.75rem",
          }}
        >
          <strong style={{ color: "#166534" }}>AI Evaluation Rationale: </strong>
          {geminiDupResult?.rationale || "Performing deep semantic analysis of complaint facts and institution records..."}
        </div>

        {geminiDupResult && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "0.75rem", marginBottom: "0.75rem" }}>
            {geminiDupResult.matching_factors.length > 0 && (
              <div style={{ background: "#f8fafc", padding: "0.6rem 0.8rem", borderRadius: "var(--radius-sm)", border: "1px solid #e2e8f0" }}>
                <span style={{ display: "block", fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700, color: "#15803d", marginBottom: "0.25rem" }}>
                  Corroborating / Shared Factors
                </span>
                <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.8rem", color: "#334155" }}>
                  {geminiDupResult.matching_factors.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            {geminiDupResult.distinguishing_factors.length > 0 && (
              <div style={{ background: "#f8fafc", padding: "0.6rem 0.8rem", borderRadius: "var(--radius-sm)", border: "1px solid #e2e8f0" }}>
                <span style={{ display: "block", fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700, color: "#475569", marginBottom: "0.25rem" }}>
                  Distinguishing Features
                </span>
                <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.8rem", color: "#334155" }}>
                  {geminiDupResult.distinguishing_factors.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {geminiDupResult?.recommended_action && (
          <div
            style={{
              background: "#f0fdf4",
              padding: "0.65rem 0.85rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid #dcfce7",
              fontSize: "0.84rem",
              color: "#166534",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "0.5rem",
            }}
          >
            <div>
              <strong>AI Recommended Review Action: </strong>
              <span>{geminiDupResult.recommended_action}</span>
            </div>
            <button
              type="button"
              className="button button-quiet"
              style={{ fontSize: "0.78rem", color: "#155a37", textDecoration: "underline" }}
              onClick={() => setDecisionNotes(`[AI Semantic Recommendation] ${geminiDupResult.recommended_action}`)}
            >
              Insert into Decision Notes
            </button>
          </div>
        )}
      </div>

      {/* Side-by-Side Comparison Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1.5rem",
          marginBottom: "1.5rem",
        }}
      >
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
            <strong>Last updated:</strong>
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
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
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
            <ul className="match-reasons">
              {Object.entries(candidate.matching_signals).map(
                ([key, value]) => (
                  <li key={key}>
                    <strong>{key.replace(/_/g, " ")}</strong>:{" "}
                    {Array.isArray(value)
                      ? value.join(", ")
                      : typeof value === "boolean"
                        ? value
                          ? "Match"
                          : "Different"
                        : typeof value === "number"
                          ? `${Math.round(value * 100)}%`
                          : String(value)}
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>
      </div>

      {candidate.case_content_accessible === false && (
        <div className="callout callout-warning">
          The candidate is outside your case-content scope.{" "}
          <Link to={`/cases/${candidate.candidate_case_id}`}>
            Request authorized case access
          </Link>{" "}
          before recording a comparison decision.
        </div>
      )}
      {/* Decision Section */}
      {isPending && (
        <div className="card">
          <h3>Record Human Review Decision</h3>
          <p className="hint">
            Select one of the three verified decision actions. Explicit
            justification is required.
          </p>

          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="decisionNotes">
              Decision Notes / Justification * (Required)
            </label>
            <textarea
              id="decisionNotes"
              rows={3}
              value={decisionNotes}
              onChange={(e) => setDecisionNotes(e.target.value)}
              placeholder="State the justification for duplicate confirmation, non-duplicate screening, or relationship..."
              style={{ width: "100%", marginTop: "0.25rem" }}
            />
          </div>

          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
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
              className="button button-secondary"
              disabled={isSubmitting}
              onClick={() => {
                setActionError(null);
                setOtherCaseSearch("");
                setFilterSameInstOnly(true);
                setSelectedTargetCaseId("");
                setShowLinkOtherModal(true);
              }}
            >
              Link to Other Existing Case...
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
          <div
            className="card"
            style={{ maxWidth: "500px", width: "90%", background: "#fff" }}
          >
            <h3>Reject Intake Submission</h3>
            <p className="hint">
              This will mark the intake submission as rejected with the reason
              recorded. This action requires global SUBMISSION.REJECT authority.
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
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  justifyContent: "flex-end",
                }}
              >
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

      {/* Link to Other Existing Case Modal */}
      {showLinkOtherModal && (
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
          onClick={() => setShowLinkOtherModal(false)}
        >
          <div
            className="card"
            style={{ maxWidth: "600px", width: "90%", background: "#fff", maxHeight: "90vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <h3 style={{ margin: 0 }}>Link Submission to Existing Case</h3>
              <button
                type="button"
                className="button button-quiet"
                onClick={() => setShowLinkOtherModal(false)}
                style={{ fontSize: "1.2rem", lineHeight: 1 }}
              >
                &times;
              </button>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              Select a target canonical case to attach intake submission <strong>{candidate.submission_subject}</strong>.
            </p>

            <form onSubmit={handleLinkToOtherCase}>
              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
                  Search Existing Cases
                </label>
                <input
                  type="text"
                  placeholder="Search by case number, title, or institution..."
                  value={otherCaseSearch}
                  onChange={(e) => setOtherCaseSearch(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={filterSameInstOnly}
                    onChange={(e) => setFilterSameInstOnly(e.target.checked)}
                  />
                  <span>Show only cases for <strong>{candidate.submission_institution_name || "Verified Institution"}</strong></span>
                </label>
              </div>

              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
                  Select Target Canonical Case *
                </label>
                <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: "0.4rem" }}>
                  {eligibleOtherCases.length === 0 ? (
                    <p className="small muted" style={{ margin: "0.5rem" }}>No matching canonical cases found.</p>
                  ) : (
                    eligibleOtherCases.map((c) => (
                      <label
                        key={c.case_id}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "0.5rem",
                          padding: "0.45rem",
                          borderRadius: "4px",
                          background: selectedTargetCaseId === c.case_id ? "#f0fdf4" : "transparent",
                          cursor: "pointer",
                          marginBottom: "0.25rem",
                        }}
                      >
                        <input
                          type="radio"
                          name="targetCaseSelection"
                          value={c.case_id}
                          checked={selectedTargetCaseId === c.case_id}
                          onChange={(e) => setSelectedTargetCaseId(e.target.value)}
                          style={{ marginTop: "0.2rem" }}
                        />
                        <div style={{ fontSize: "0.84rem" }}>
                          <span style={{ fontWeight: 700, color: "var(--color-primary)" }}>{c.case_number}</span>
                          {" — "}
                          <span>{c.title}</span>
                          <div className="small muted">
                            {c.institution_name} &bull; {c.lead_bureau_name}
                          </div>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
                  Decision Justification Notes *
                </label>
                <textarea
                  rows={2}
                  required
                  placeholder="State the administrative justification for linking this submission..."
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setShowLinkOtherModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={isSubmitting || !selectedTargetCaseId}
                >
                  {isSubmitting ? "Linking..." : "Confirm & Link to Case"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { ErrorPanel, Loading, PageHeader, StatusBadge } from "../components/ui";
import { formatDateTime, intakeStatusLabel, languageLabel } from "../lib/intake";
import { useResource } from "../lib/useResource";
import { useSimulation } from "../simulation/selectors";
import type { SubmissionDetail } from "../types";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

export function IntakeDetailPage() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const navigate = useNavigate();
  const { has, api } = useAuth();
  const simState = useSimulation();
  const { data, loading, error, reload } = useResource<SubmissionDetail>(
    submissionId && has("submission.view") ? `/submissions/${submissionId}` : null,
  );

  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [caseSearch, setCaseSearch] = useState("");
  const [filterSameInst, setFilterSameInst] = useState(true);
  const [linkNotes, setLinkNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  if (!has("submission.view")) {
    return <PermissionDeniedPage />;
  }

  const eligibleCases = (simState.cases || [])
    .filter((c) => {
      if (filterSameInst && data?.institution?.official_name) {
        return (
          c.institution_name.toLowerCase() ===
          data.institution.official_name.toLowerCase()
        );
      }
      return true;
    })
    .filter((c) => {
      if (!caseSearch.trim()) return true;
      const term = caseSearch.toLowerCase();
      return (
        c.case_number.toLowerCase().includes(term) ||
        c.title.toLowerCase().includes(term) ||
        c.institution_name.toLowerCase().includes(term)
      );
    });

  const handleLinkSubmission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId) {
      setLinkError("Please select a target canonical case.");
      return;
    }
    setIsSubmitting(true);
    setLinkError(null);
    try {
      await api.post(`/submissions/${submissionId}/link-case`, {
        target_case_id: selectedCaseId,
        notes: linkNotes.trim() || undefined,
      });
      setShowLinkModal(false);
      await reload();
      navigate(`/cases/${selectedCaseId}`);
    } catch (err: any) {
      setLinkError(err?.message || "Failed to link submission.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section>
      <PageHeader
        title="Submission detail"
        description="Original complaint content and institution details, preserved as submitted."
        actions={
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Link to="/intake" className="button button-quiet">
              Back to the queue
            </Link>
          </div>
        }
      />

      <ErrorPanel error={error} />
      {loading ? <Loading /> : null}

      {data ? (
        <div className="grid grid-2">
          <article className="card">
            <div className="badge-row">
              <StatusBadge value={data.intake_status} label={intakeStatusLabel(data.intake_status)} />
            </div>
            <h2>{data.subject}</h2>
            <dl className="detail-list">
              <div>
                <dt>Reference</dt>
                <dd className="mono">{data.external_reference ?? "—"}</dd>
              </div>
              <div>
                <dt>Channel</dt>
                <dd>{data.channel.name}</dd>
              </div>
              <div>
                <dt>Received at</dt>
                <dd>{formatDateTime(data.received_at)}</dd>
              </div>
              <div>
                <dt>Source submitted at</dt>
                <dd>{formatDateTime(data.source_submitted_at)}</dd>
              </div>
              <div>
                <dt>Complaint language</dt>
                <dd>{languageLabel(data.original_language)}</dd>
              </div>
              <div>
                <dt>Institution as submitted</dt>
                <dd>{data.institution_name_as_submitted ?? "—"}</dd>
              </div>
              <div>
                <dt>Resolved institution</dt>
                <dd>
                  {data.institution
                    ? `${data.institution.official_name} (${data.institution.aicte_permanent_id ?? "no permanent ID"})`
                    : "Not resolved — awaiting institution verification"}
                </dd>
              </div>
              <div>
                <dt>Canonical case</dt>
                <dd>
                  {data.canonical_case_id ? (
                    <Link
                      to={`/cases/${data.canonical_case_id}`}
                      style={{ fontWeight: 700, color: "var(--color-primary)", textDecoration: "underline" }}
                    >
                      {simState.cases.find((c) => c.case_id === data.canonical_case_id)?.case_number || data.canonical_case_id} &rarr;
                    </Link>
                  ) : (
                    <span>
                      Not yet associated with a case
                      {has("case.create") && (
                        <button
                          type="button"
                          className="button button-small button-secondary"
                          style={{ marginLeft: "0.75rem", fontSize: "0.75rem", padding: "0.2rem 0.55rem" }}
                          onClick={() => {
                            setLinkError(null);
                            setCaseSearch("");
                            setFilterSameInst(true);
                            setSelectedCaseId("");
                            setLinkNotes("");
                            setShowLinkModal(true);
                          }}
                        >
                          + Link to Existing Case
                        </button>
                      )}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Source event</dt>
                <dd className="mono">{data.source_event_id ?? "—"}</dd>
              </div>
              <div>
                <dt>Reference origin</dt>
                <dd className="mono">{data.reference_origin ?? "—"}</dd>
              </div>
              <div>
                <dt>Consent recorded</dt>
                <dd>{data.consent_acknowledged ? "Yes" : "Not recorded"}</dd>
              </div>
            </dl>
          </article>

          <article className="card">
            <h2>Original complaint text</h2>
            <p className="muted small">
              Stored verbatim: no translation, trimming or normalisation was applied.
            </p>
            <pre className="complaint-text" lang={data.original_language}>
              {data.original_text}
            </pre>
            <p className="small muted">
              Content fingerprint <span className="mono">{data.content_fingerprint ?? "—"}</span>
            </p>
            <p className="small muted">
              Original submissions remain available throughout verification and duplicate review.
            </p>
          </article>
        </div>
      ) : null}

      {/* Link to Existing Case Modal */}
      {showLinkModal && (
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
          onClick={() => setShowLinkModal(false)}
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
                onClick={() => setShowLinkModal(false)}
                style={{ fontSize: "1.2rem", lineHeight: 1 }}
              >
                &times;
              </button>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              Attach submission <strong>{data?.external_reference}</strong> to an existing canonical case.
            </p>

            {linkError && (
              <div className="badge badge-priority-critical" style={{ marginBottom: "1rem", display: "block" }}>
                {linkError}
              </div>
            )}

            <form onSubmit={handleLinkSubmission}>
              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
                  Search Existing Cases
                </label>
                <input
                  type="text"
                  placeholder="Filter by case number, title, or institution..."
                  value={caseSearch}
                  onChange={(e) => setCaseSearch(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>

              {data?.institution && (
                <div style={{ marginBottom: "0.75rem" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={filterSameInst}
                      onChange={(e) => setFilterSameInst(e.target.checked)}
                    />
                    <span>Show only cases for <strong>{data.institution.official_name}</strong></span>
                  </label>
                </div>
              )}

              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
                  Select Target Canonical Case *
                </label>
                <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: "0.4rem" }}>
                  {eligibleCases.length === 0 ? (
                    <p className="small muted" style={{ margin: "0.5rem" }}>No matching cases found.</p>
                  ) : (
                    eligibleCases.map((c) => (
                      <label
                        key={c.case_id}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "0.5rem",
                          padding: "0.45rem",
                          borderRadius: "4px",
                          background: selectedCaseId === c.case_id ? "#f0fdf4" : "transparent",
                          cursor: "pointer",
                          marginBottom: "0.25rem",
                        }}
                      >
                        <input
                          type="radio"
                          name="targetCaseIntake"
                          value={c.case_id}
                          checked={selectedCaseId === c.case_id}
                          onChange={(e) => setSelectedCaseId(e.target.value)}
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
                  Linking Justification Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="State the administrative justification for linking this submission..."
                  value={linkNotes}
                  onChange={(e) => setLinkNotes(e.target.value)}
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
                  onClick={() => setShowLinkModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={isSubmitting || !selectedCaseId}
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

import { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from "../components/ui";
import { formatDateTime } from "../lib/intake";
import { usePagedResource } from "../lib/useResource";
import {
  duplicateStatusLabel,
  heuristicLabel,
} from "../lib/duplicateReview";
import type { DuplicateCandidateItem } from "../types";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

const STATUS_FILTERS = [
  { value: "pending", label: "Pending Review" },
  { value: "confirmed_duplicate", label: "Confirmed Duplicates" },
  { value: "not_duplicate", label: "Not Duplicate" },
  { value: "related", label: "Related Cases" },
  { value: "all", label: "All Candidates" },
];

export function DuplicateReviewQueuePage() {
  const { has, api } = useAuth();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [isScreening, setIsScreening] = useState(false);
  const [screeningSubmissionId, setScreeningSubmissionId] = useState("");
  const [screeningResult, setScreeningResult] = useState<string | null>(null);

  const { items, loading, error, reload } = usePagedResource<DuplicateCandidateItem>(
    "/duplicate-review/queue",
    {
      status: statusFilter,
      q: searchQuery.trim() || undefined,
    },
    { enabled: has("duplicate.review") },
  );

  if (!has("duplicate.review")) {
    return <PermissionDeniedPage />;
  }

  const handleRunScreening = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!screeningSubmissionId.trim()) return;
    setIsScreening(true);
    setScreeningResult(null);
    try {
      const res = await api.post<{ inserted_count: number }>(
        "/duplicate-review/screen",
        {
          submission_id: screeningSubmissionId.trim(),
          expected_submission_updated_at: new Date().toISOString(),
        },
      );
      setScreeningResult(`Screening complete: generated ${res.inserted_count} candidate pairs.`);
      setScreeningSubmissionId("");
      await reload();
    } catch (err: any) {
      setScreeningResult(`Error: ${err?.message || "Screening failed"}`);
    } finally {
      setIsScreening(false);
    }
  };

  return (
    <section>
      <PageHeader
        title="Duplicate Review Queue"
        description="Review suspected duplicate submissions against existing canonical cases. Match evidence is deterministic and advisory; officer judgment is required."
        actions={
          <button type="button" className="button button-quiet" onClick={() => void reload()}>
            Refresh
          </button>
        }
      />

      <div className="callout callout-info" style={{ marginBottom: "1rem" }}>
        <strong>Mandatory Human Decision:</strong> System similarity scores (1.00, 0.90, 0.60) are deterministic heuristics, never automated auto-merges. Every duplicate candidate requires human decision.
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ marginTop: 0 }}>Trigger Duplicate Screening</h3>
        <p className="hint">
          Screen a verified intake submission against canonical cases for the same institution.
        </p>
        <form onSubmit={handleRunScreening} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Submission UUID (e.g. 550e8400-...)"
            value={screeningSubmissionId}
            onChange={(e) => setScreeningSubmissionId(e.target.value)}
            style={{ width: "360px" }}
          />
          <button type="submit" className="button button-primary" disabled={isScreening}>
            {isScreening ? "Screening..." : "Screen Submission"}
          </button>
        </form>
        {screeningResult && (
          <div style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: screeningResult.startsWith("Error") ? "var(--color-danger)" : "var(--color-success)" }}>
            {screeningResult}
          </div>
        )}
      </div>

      <div className="card">
        <div className="toolbar toolbar-wrap">
          <h2>Candidate matches</h2>
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
              placeholder="Case number or institution"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
        </div>

        {error && <ErrorPanel error={error} />}
        {loading && <Loading label="Loading duplicate candidates..." />}

        {!loading && !error && items.length === 0 && (
          <EmptyState
            title="No duplicate candidates found"
            description="No candidates match the selected filters."
          />
        )}

        {!loading && !error && items.length > 0 && (
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Candidate Target Case</th>
                  <th>Submission Subject</th>
                  <th>Institution</th>
                  <th>Similarity & Heuristic</th>
                  <th>Status</th>
                  <th>Detected At</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((candidate) => (
                  <tr key={candidate.candidate_id}>
                    <td>
                      <strong>{candidate.case_number}</strong>
                    </td>
                    <td>{candidate.submission_subject}</td>
                    <td>{candidate.institution_name || "—"}</td>
                    <td>
                      <strong>{(candidate.similarity_score * 100).toFixed(0)}%</strong>
                      <div className="hint">{heuristicLabel(candidate.similarity_score)}</div>
                    </td>
                    <td>
                      <StatusBadge
                        value={candidate.review_status}
                        label={duplicateStatusLabel(candidate.review_status)}
                      />
                    </td>
                    <td>{formatDateTime(candidate.candidate_created_at)}</td>
                    <td>
                      <Link
                        to={`/duplicate-review/candidates/${candidate.candidate_id}`}
                        className="button button-small"
                      >
                        Review
                      </Link>
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

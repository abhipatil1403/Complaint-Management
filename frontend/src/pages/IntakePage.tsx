import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import {
  EmptyState,
  ErrorPanel,
  Loading,
  PageHeader,
  StatusBadge,
} from "../components/ui";
import {
  formatDateTime,
  intakeStatusLabel,
  languageLabel,
} from "../lib/intake";
import { usePagedResource } from "../lib/useResource";
import type { SubmissionSummary } from "../types";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

const STATUSES = [
  "received",
  "awaiting_institution_verification",
  "awaiting_duplicate_review",
  "ready_for_case_creation",
  "associated_with_case",
  "rejected",
];

export function IntakePage() {
  const { has } = useAuth();
  const [params] = useSearchParams();
  const [status, setStatus] = useState("");
  const [language, setLanguage] = useState("");
  const [channel, setChannel] = useState("");
  const { items, loading, error, hasMore, reload, loadMore } =
    usePagedResource<SubmissionSummary>(
      "/submissions",
      {
        intake_status: status || undefined,
        ready_only: params.get("ready") === "true" ? true : undefined,
        language: language || undefined,
        channel_code: channel || undefined,
      },
      { enabled: has("submission.view") },
    );

  if (!has("submission.view")) {
    return <PermissionDeniedPage />;
  }

  return (
    <section>
      <PageHeader
        title="Intake queue"
        description="Preserved original submissions, institution checks, and case associations."
        actions={
          <button
            type="button"
            className="button button-quiet"
            onClick={() => void reload()}
          >
            Refresh
          </button>
        }
      />

      <div className="card">
        <div className="toolbar toolbar-wrap">
          <h2>Submissions</h2>
          <label>
            Intake status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {intakeStatusLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Language
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <option value="">All languages</option>
              <option value="en">English</option>
              <option value="hi">Hindi</option>
            </select>
          </label>
          <label>
            Channel
            <select
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
            >
              <option value="">All channels</option>
              <option value="aicte_portal">AICTE Portal</option>
              <option value="cpgrams">CPGRAMS Portal</option>
            </select>
          </label>
        </div>

        <ErrorPanel error={error} />
        {loading && items.length === 0 ? <Loading /> : null}
        {!loading && !error && items.length === 0 ? (
          <EmptyState
            title="No submissions yet"
            description="Submit a complaint through the public intake portal to record a submission."
          />
        ) : null}

        {items.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Received</th>
                  <th>Channel</th>
                  <th>Subject</th>
                  <th>Institution</th>
                  <th>Language</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((submission) => (
                  <tr key={submission.id}>
                    <td className="mono">
                      <Link to={`/intake/${submission.id}`}>
                        {submission.external_reference ??
                          submission.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td>{formatDateTime(submission.received_at)}</td>
                    <td> {submission.channel.code}</td>
                    <td>
                      <Link to={`/intake/${submission.id}`}>
                        {submission.subject}
                      </Link>
                    </td>
                    <td className="muted">
                      {submission.institution?.official_name ??
                        submission.institution_name_as_submitted ??
                        "Unresolved"}
                    </td>
                    <td>{languageLabel(submission.original_language)}</td>
                    <td>
                      <StatusBadge value={submission.intake_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {hasMore ? (
          <div className="pager">
            <button
              type="button"
              className="button button-quiet"
              onClick={() => void loadMore()}
              disabled={loading}
            >
              {loading ? "Loading..." : "Load more"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

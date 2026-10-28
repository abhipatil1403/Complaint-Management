import { Link, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { ErrorPanel, Loading, PageHeader, StatusBadge } from "../components/ui";
import { formatDateTime, intakeStatusLabel, languageLabel } from "../lib/intake";
import { useResource } from "../lib/useResource";
import type { SubmissionDetail } from "../types";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

export function IntakeDetailPage() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const { has } = useAuth();
  const { data, loading, error } = useResource<SubmissionDetail>(
    submissionId && has("submission.view") ? `/submissions/${submissionId}` : null,
  );

  if (!has("submission.view")) {
    return <PermissionDeniedPage />;
  }

  return (
    <section>
      <PageHeader
        title="Submission detail"
        description="Original complaint content, preserved exactly as submitted. Access is restricted and audited by the API and PostgreSQL."
        actions={
          <Link to="/intake" className="button button-quiet">
            Back to the queue
          </Link>
        }
      />

      <div className="callout callout-warning">
        <strong>Simulated submission.</strong> This record was never sent to AICTE or CPGRAMS and no
        case exists for it.
      </div>

      <ErrorPanel error={error} />
      {loading ? <Loading /> : null}

      {data ? (
        <div className="grid grid-2">
          <article className="card">
            <div className="badge-row">
              <span className="badge badge-simulated">Simulated</span>
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
                <dd>
                  {data.channel.name} {data.channel.is_simulated ? <span className="badge badge-simulated">Simulated</span> : null}
                </dd>
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
                <dd>{data.canonical_case_id ?? "None — case creation is a later phase"}</dd>
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
              <div>
                <dt>Simulation notice</dt>
                <dd className="mono">{data.simulation_notice_version ?? "—"}</dd>
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
              Fingerprints support later duplicate review. They are not a decision and no duplicate
              candidate has been created.
            </p>
          </article>
        </div>
      ) : null}
    </section>
  );
}

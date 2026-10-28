import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";

import { PublicShell } from "../components/PublicShell";
import { ErrorPanel, Loading } from "../components/ui";
import { type ApiError, toApiError } from "../lib/api";
import {
  channelForPortal,
  createIdempotencyKey,
  currentSourceTimestamp,
  formatDateTime,
  intakeStatusLabel,
  languageLabel,
  noticeForLanguage,
  portalLabel,
  publicApi,
} from "../lib/intake";
import { useDemoInfo } from "../lib/useDemoInfo";
import type {
  DemoPortal,
  DemoSubmissionReceipt,
  DemoSubmissionRequest,
  IntakeLanguage,
} from "../types";

const EMPTY_FORM = {
  institutionName: "",
  institutionPermanentId: "",
  subject: "",
  description: "",
  language: "en" as IntakeLanguage,
  categoryCode: "",
};

export function DemoIntakePage({ portal }: { portal: DemoPortal }) {
  const { info, loading, error: infoError } = useDemoInfo();
  const [form, setForm] = useState(EMPTY_FORM);
  const [consent, setConsent] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [receipt, setReceipt] = useState<DemoSubmissionReceipt | null>(null);

  const channel = info ? channelForPortal(info.channels, portal) : undefined;
  const notice = noticeForLanguage(form.language, {
    en: info?.simulation_notice_en ?? null,
    hi: info?.simulation_notice_hi ?? null,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!channel) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: DemoSubmissionRequest = {
        institution_name_as_submitted: form.institutionName === "" ? null : form.institutionName,
        institution_permanent_id:
          form.institutionPermanentId === "" ? null : form.institutionPermanentId,
        subject: form.subject,
        description: form.description,
        language: form.language,
        category_code: form.categoryCode === "" ? null : form.categoryCode,
        source_submitted_at: currentSourceTimestamp(),
        consent_acknowledged: true,
      };
      const result = await publicApi.post<DemoSubmissionReceipt>(
        `/demo/intake/${channel.code}/submissions`,
        payload,
        { "Idempotency-Key": idempotencyKey },
      );
      setReceipt(result);
    } catch (raw) {
      setError(toApiError(raw));
    } finally {
      setBusy(false);
    }
  }

  function startAnother() {
    setForm(EMPTY_FORM);
    setConsent(false);
    setReceipt(null);
    setError(null);
    setIdempotencyKey(createIdempotencyKey());
  }

  return (
    <PublicShell>
      <div className="page-header">
        <div>
          <p className="eyebrow">Simulation — not a real complaint</p>
          <h1>{portalLabel(portal)}</h1>
          <p className="page-description">
            This form behaves like a portal submission but writes only to this project's demo
            database. Nothing is transmitted to AICTE, CPGRAMS or any government office.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/demo" className="button button-quiet">
            All demo portals
          </Link>
        </div>
      </div>

      {loading ? <Loading label="Loading the portal..." /> : null}
      <ErrorPanel error={infoError} title="The demo portal is unavailable" />

      {info && !info.demo_intake_enabled ? (
        <div className="notice-box" role="status">
          <strong>Simulated intake is disabled</strong>
          <p>The API has turned the demo intake off, so this form cannot be submitted.</p>
        </div>
      ) : null}

      {receipt ? (
        <div className="card receipt" role="status" aria-live="polite">
          <div className="badge-row">
            <span className="badge badge-simulated">Simulated</span>
            <span className="badge badge-neutral">
              {receipt.replayed ? "Replay — nothing new stored" : "Recorded"}
            </span>
          </div>
          <h2>{receipt.replayed ? "This submission was already recorded" : "Submission recorded"}</h2>
          <p>
            The original text was preserved verbatim in the demo database. No case, verification
            task or duplicate candidate was created, and nothing was sent anywhere.
          </p>
          <dl className="detail-list">
            <div>
              <dt>Simulation reference</dt>
              <dd className="mono">{receipt.external_reference ?? "—"}</dd>
            </div>
            <div>
              <dt>Channel</dt>
              <dd>
                {receipt.channel.name} <span className="badge badge-simulated">Simulated</span>
              </dd>
            </div>
            <div>
              <dt>Intake status</dt>
              <dd>{intakeStatusLabel(receipt.intake_status)}</dd>
            </div>
            <div>
              <dt>Institution resolved</dt>
              <dd>
                {receipt.institution_resolved
                  ? "Yes — awaiting duplicate review"
                  : "No — awaiting institution verification"}
              </dd>
            </div>
            <div>
              <dt>Server received at</dt>
              <dd>{formatDateTime(receipt.received_at)}</dd>
            </div>
            <div>
              <dt>Language</dt>
              <dd>{languageLabel(form.language)}</dd>
            </div>
          </dl>
          <p className="small muted mono">Notice {receipt.simulation_notice_version}</p>
          <div className="button-row">
            <button type="button" className="button button-primary" onClick={startAnother}>
              Start another submission
            </button>
            <Link to="/demo" className="button button-quiet">
              Back to the demo hub
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="notice-box notice-simulation">
            <strong>Simulation notice / सिमुलेशन सूचना</strong>
            <p lang={form.language}>{notice}</p>
            <p className="small muted">
              The notice is shown in the complaint language. Version{" "}
              <span className="mono">{info?.simulation_notice_version ?? "—"}</span>.
            </p>
          </div>

          <ErrorPanel error={error} title="The submission was not recorded" />

          {info?.demo_intake_enabled && channel ? (
            <form className="card form" onSubmit={submit}>
              <div className="grid grid-2">
                <label>
                  Institution name as submitted
                  <input
                    maxLength={300}
                    value={form.institutionName}
                    onChange={(event) =>
                      setForm({ ...form, institutionName: event.target.value })
                    }
                    placeholder="Illustrative Institute of Technology"
                  />
                  <span className="field-help">
                    Preserved exactly as typed. Name matching is not performed in this phase.
                  </span>
                </label>
                <label>
                  AICTE permanent ID (optional)
                  <input
                    maxLength={64}
                    value={form.institutionPermanentId}
                    onChange={(event) =>
                      setForm({ ...form, institutionPermanentId: event.target.value })
                    }
                    placeholder="DEMO-AICTE-0001"
                  />
                  <span className="field-help">
                    Only an exact, verified permanent ID is resolved. Unknown IDs are stored for
                    verification instead of being guessed.
                  </span>
                </label>
              </div>

              <label>
                Subject
                <input
                  required
                  maxLength={200}
                  value={form.subject}
                  onChange={(event) => setForm({ ...form, subject: event.target.value })}
                  placeholder="Short summary of the grievance"
                />
                <span className="field-help">Stored verbatim, in the original language.</span>
              </label>

              <label>
                Complaint description
                <textarea
                  required
                  rows={8}
                  maxLength={20000}
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="Describe the grievance in English or Hindi."
                />
                <span className="field-help">
                  No translation, trimming or normalisation is applied. Control characters are
                  rejected; line breaks and tabs are kept.
                </span>
              </label>

              <div className="grid grid-2">
                <label>
                  Complaint language
                  <select
                    value={form.language}
                    onChange={(event) =>
                      setForm({ ...form, language: event.target.value as IntakeLanguage })
                    }
                  >
                    <option value="en">English</option>
                    <option value="hi">हिन्दी (Hindi)</option>
                  </select>
                </label>
                <label>
                  Category code (optional)
                  <input
                    maxLength={64}
                    value={form.categoryCode}
                    onChange={(event) => setForm({ ...form, categoryCode: event.target.value })}
                    placeholder="No categories are seeded in this phase"
                  />
                  <span className="field-help">
                    An unknown category is rejected rather than silently dropped.
                  </span>
                </label>
              </div>

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                I have read the simulation notice and understand this is not a real complaint.
                / मैंने सिमुलेशन सूचना पढ़ ली है और समझता हूँ कि यह वास्तविक शिकायत नहीं है।
              </label>

              <div className="button-row">
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={busy || !consent}
                >
                  {busy ? "Recording..." : "Record simulated submission"}
                </button>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setIdempotencyKey(createIdempotencyKey())}
                  disabled={busy}
                >
                  New idempotency key
                </button>
              </div>
              <p className="small muted">
                This form reuses the idempotency key{" "}
                <span className="mono">{idempotencyKey.slice(0, 8)}…</span> so submitting the same
                content unchanged is treated as a replay instead of a duplicate. Select{" "}
                <em>New idempotency key</em> to record an intentionally separate submission.
              </p>
            </form>
          ) : null}
        </>
      )}
    </PublicShell>
  );
}

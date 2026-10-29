import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { MessageThread } from "../components/PublicCorrespondence";
import { useAuth } from "../auth/AuthProvider";
import { useSimulation } from "../simulation/selectors";
import { accessibleSubmissions } from "../simulation/scope";
import { simulationStore } from "../simulation/simulationStore";
export function ComplainantPage() {
  const { activePersona } = useAuth();
  const state = useSimulation();
  const [params] = useSearchParams();
  const [channel, setChannel] = useState("all");
  const [selected, setSelected] = useState(params.get("submission") || "");
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState("");
  if (activePersona.roleCode !== "COMPLAINANT")
    return <Navigate to="/" replace />;
  const owned = accessibleSubmissions(state, activePersona);
  const list = owned
    .filter((s) => channel === "all" || s.channel === channel)
    .sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at));
  const sub = owned.find((s) => s.id === selected);
  const caseStatus = (id?: string) =>
    state.cases.find((c) => c.case_id === id)?.status;
  const completed = owned.filter((s) =>
    ["resolved", "closed"].includes(caseStatus(s.canonical_case_id) || ""),
  ).length;
  const responses = owned.reduce(
    (n, s) =>
      n +
      (s.source_metadata?.public_messages || []).filter(
        (m) => m.direction === "staff",
      ).length,
    0,
  );
  return (
    <PublicShell>
      <section>
        <div className="page-header">
          <div>
            <div className="eyebrow">PERSONAL COMPLAINT WORKSPACE</div>
            <h1>My complaints</h1>
            <p className="page-description">
              {activePersona.name} · Filing, progress, and responses for your
              own submissions.
            </p>
          </div>
          <Link className="button button-primary" to="/demo/aicte">
            File an institution complaint
          </Link>
        </div>
        <div className="stats-grid-4">
          {[
            ["My submissions", owned.length],
            ["In progress", owned.length - completed],
            ["Completed", completed],
            ["Public responses", responses],
          ].map(([label, n]) => (
            <div className="stat-card" key={label}>
              <span className="stat-label">{label}</span>
              <div className="stat-value">{n}</div>
            </div>
          ))}
        </div>
        <div className="portal-pathways">
          <Link className="portal-choice aicte-choice" to="/demo/aicte">
            <small>INSTITUTION COMPLAINTS</small>
            <h2>AICTE OneDesk intake</h2>
            <p>
              Submit an institution concern, supporting evidence, and requested
              relief.
            </p>
            <strong>File or track →</strong>
          </Link>
          <Link className="portal-choice cpgrams-choice" to="/demo/cpgrams">
            <small>GRIEVANCE REFERRALS</small>
            <h2>CPGRAMS intake</h2>
            <p>
              Record a grievance referral and its source reference for
              centralized review.
            </p>
            <strong>File or track →</strong>
          </Link>
        </div>
        <article className="card">
          <div className="toolbar">
            <h2>Personal complaint history</h2>
            <label>
              Submission channel
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                <option value="all">Both portals</option>
                <option value="aicte_portal">AICTE OneDesk</option>
                <option value="cpgrams">CPGRAMS</option>
              </select>
            </label>
          </div>
          <div className="role-case-list">
            {list.map((s) => (
              <button
                className={`complaint-history-row ${sub?.id === s.id ? "selected" : ""}`}
                key={s.id}
                onClick={() => {
                  setSelected(s.id);
                  setNotice("");
                }}
              >
                <div>
                  <small>
                    {s.tracking_code} ·{" "}
                    {s.channel === "cpgrams" ? "CPGRAMS" : "AICTE OneDesk"}
                  </small>
                  <strong>{s.subject}</strong>
                  <span>{s.institution_name_submitted}</span>
                </div>
                <span className="badge badge-pending">
                  {(caseStatus(s.canonical_case_id) || s.status).replace(
                    /_/g,
                    " ",
                  )}
                </span>
              </button>
            ))}
            {!list.length && (
              <p className="empty-state">
                No complaints in this view. Your next submission will appear
                here.
              </p>
            )}
          </div>
        </article>
        {sub && (
          <article className="card">
            <div className="card-header-row">
              <div>
                <h2>{sub.subject}</h2>
                <p className="small muted">
                  {sub.submission_number} · {sub.tracking_code}
                </p>
              </div>
              <Link
                className="button button-secondary"
                to={`/demo/${sub.channel === "cpgrams" ? "cpgrams" : "aicte"}?tab=track&reference=${encodeURIComponent(sub.tracking_code)}`}
              >
                Track in source portal
              </Link>
            </div>
            <div className="grid grid-2">
              <div>
                <h3>Your original complaint</h3>
                <p className="complaint-text" lang={sub.language}>
                  {sub.description}
                </p>
                <p className="small muted">
                  {sub.attachments.length} original evidence file(s) retained.
                </p>
              </div>
              <div>
                <h3>Progress</h3>
                <dl className="detail-list">
                  <div>
                    <dt>Institution check</dt>
                    <dd>
                      {sub.institution_verified
                        ? "Verified"
                        : "Awaiting verification"}
                    </dd>
                  </div>
                  <div>
                    <dt>Case progress</dt>
                    <dd>
                      {(
                        caseStatus(sub.canonical_case_id) || sub.status
                      ).replace(/_/g, " ")}
                    </dd>
                  </div>
                  <div>
                    <dt>Received</dt>
                    <dd>
                      {new Date(sub.received_at).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
            <h3>Responses & additional information</h3>
            <MessageThread submission={sub} />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  simulationStore.addPublicMessage(sub.id, body);
                  setBody("");
                  setNotice("Your response has been saved for review.");
                } catch (err) {
                  setNotice(
                    err instanceof Error
                      ? err.message
                      : "Could not save response",
                  );
                }
              }}
            >
              <label>
                Your response
                <textarea
                  required
                  minLength={3}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Reply to a request or provide additional information…"
                />
              </label>
              <button className="button button-primary" type="submit">
                Send response
              </button>
            </form>
            {notice && (
              <p className="callout callout-info" role="status">
                {notice}
              </p>
            )}
          </article>
        )}
      </section>
    </PublicShell>
  );
}

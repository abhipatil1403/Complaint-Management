import { useState } from "react";
import { useSimulation } from "../simulation/selectors";
import { useAuth } from "../auth/AuthProvider";
import { simulationStore } from "../simulation/simulationStore";
import { accessibleSubmissions, canActOnCase } from "../simulation/scope";
import type { SimSubmission } from "../simulation/types";
export function MessageThread({ submission }: { submission: SimSubmission }) {
  return (
    <div className="correspondence-thread">
      {(submission.source_metadata?.public_messages || []).map((m) => (
        <article className={`public-message ${m.direction}`} key={m.id}>
          <div className="toolbar">
            <strong>
              {m.direction === "staff" ? "OneDesk response" : m.sender_name}
            </strong>
            <time>
              {new Date(m.created_at).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
              })}
            </time>
          </div>
          <p>{m.body}</p>
        </article>
      ))}
      {!submission.source_metadata?.public_messages?.length && (
        <p className="empty-state">
          No public correspondence yet. Internal notes are never included here.
        </p>
      )}
    </div>
  );
}
export function PublicCorrespondence({ caseId }: { caseId: string }) {
  const { activePersona, has } = useAuth();
  const state = useSimulation();
  const submissions = accessibleSubmissions(state, activePersona).filter(
    (s) => s.canonical_case_id === caseId,
  );
  const [selected, setSelected] = useState("");
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState("");
  const sub = submissions.find((s) => s.id === selected) || submissions[0];
  if (!has("submission.view")) return null;
  return (
    <article className="card">
      <h2>Complainant correspondence</h2>
      <p className="small muted">
        Messages sent here are visible to the submitter. Use Internal notes for
        bureau deliberations.
      </p>
      {sub ? (
        <>
          <label>
            Original submission
            <select
              value={sub.id}
              onChange={(e) => {
                setSelected(e.target.value);
                setNotice("");
              }}
            >
              {submissions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.submission_number} · {s.complainant_name}
                </option>
              ))}
            </select>
          </label>
          <MessageThread submission={sub} />
          {has("case.note.create") &&
            state.cases.some(
              (c) =>
                c.case_id === caseId && canActOnCase(c, activePersona, state),
            ) && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  try {
                    simulationStore.addPublicMessage(sub.id, body);
                    setBody("");
                    setNotice("Response published to the complainant.");
                  } catch (err) {
                    setNotice(
                      err instanceof Error
                        ? err.message
                        : "Could not publish response",
                    );
                  }
                }}
              >
                <label>
                  Public response
                  <textarea
                    required
                    minLength={3}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Write only information approved for the complainant…"
                  />
                </label>
                <button className="button button-primary" type="submit">
                  Publish response
                </button>
              </form>
            )}
          {notice && (
            <p role="status" className="callout callout-info">
              {notice}
            </p>
          )}
        </>
      ) : (
        <p className="empty-state">
          No source submissions are accessible for this case.
        </p>
      )}
    </article>
  );
}

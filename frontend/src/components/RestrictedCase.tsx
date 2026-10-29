import { useState } from "react";
import { Link } from "react-router-dom";
import { useSimulation } from "../simulation/selectors";
import { simulationStore } from "../simulation/simulationStore";
import { useAuth } from "../auth/AuthProvider";
export function RestrictedCase({
  caseId,
  caseNumber,
}: {
  caseId: string;
  caseNumber: string;
}) {
  const { activePersona } = useAuth();
  const state = useSimulation();
  const [reason, setReason] = useState("");
  const [level, setLevel] = useState<"details" | "collaborate">("details");
  const [error, setError] = useState("");
  const pending = state.accessGrants.find(
    (g) =>
      g.case_id === caseId &&
      g.grantee_user_id === activePersona.id &&
      g.status === "pending",
  );
  return (
    <section>
      <div className="page-header">
        <div>
          <h1>{caseNumber}</h1>
          <p className="page-description">Restricted case workspace</p>
        </div>
        <Link className="button button-secondary" to="/cases">
          Back to case index
        </Link>
      </div>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            simulationStore.requestAccess(caseId, level, reason.trim());
            setError("");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Request failed");
          }
        }}
      >
        <h2>Request cross-bureau access</h2>
        <p>
          Your case-index permission shows that this case exists. Its content
          requires approval from an authorized manager.
        </p>
        {pending ? (
          <p className="callout callout-info" role="status">
            Your {pending.access_level} access request is pending review.
          </p>
        ) : (
          <>
            <label>
              Access scope
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as typeof level)}
              >
                <option value="details">View details</option>
                <option value="collaborate">Collaborate</option>
              </select>
            </label>
            <label>
              Justification
              <textarea
                required
                minLength={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button className="button button-primary" type="submit">
              Request access
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}

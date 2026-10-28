import { Link } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";

export function PermissionDeniedPage() {
  const { me } = useAuth();
  return (
    <div className="card narrow">
      <span className="badge badge-rejected">403</span>
      <h1>Capability not granted</h1>
      <p>
        Your role does not include the capability required for this page
        {me?.active_bureau_id ? " in the selected bureau context" : ""}. Switching the bureau
        context may change what is available if you hold a bureau-scoped role.
      </p>
      <p className="muted small">
        Authorization is enforced again by the API and by PostgreSQL policies; hiding a control in
        the interface is not a security boundary.
      </p>
      <Link className="button button-primary" to="/">
        Return to start
      </Link>
    </div>
  );
}

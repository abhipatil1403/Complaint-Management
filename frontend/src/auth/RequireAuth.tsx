import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "./AuthProvider";
import { DemoBanner } from "../components/DemoBanner";
import { ErrorPanel, Loading } from "../components/ui";
import { NoProfilePage } from "../pages/NoProfilePage";

export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === "loading" && !auth.me) {
    return (
      <div className="gate">
        <Loading label="Checking your session and capabilities..." />
      </div>
    );
  }

  if (auth.status === "signed_out") {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }

  if (auth.status === "no_profile") {
    return <NoProfilePage />;
  }

  if (auth.status === "error") {
    return (
      <div className="gate">
        <DemoBanner />
        <div className="card">
          <ErrorPanel error={auth.error} title="AICTE OneDesk cannot start" />
          <p className="muted">
            The interface is available, but no profile could be loaded. An administrator must
            provision an account before access is possible.
          </p>
        </div>
      </div>
    );
  }

  return <Outlet />;
}

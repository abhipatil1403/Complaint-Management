import { Link } from "react-router-dom";
import type { ReactNode } from "react";

import { RoleSwitcher } from "./RoleSwitcher";
import { useAuth } from "../auth/AuthProvider";

/** Chrome for the public simulated portals. Deliberately louder than the app. */
export function PublicShell({ children }: { children: ReactNode }) {
  const { status, me, has, activePersona } = useAuth();
  const signedIn = status === "ready" && Boolean(me);

  return (
    <div className="public-shell">
      <header className="public-header">
        <Link to="/demo" className="brand">
          <span className="brand-mark" aria-hidden="true">
            OD
          </span>
          <span>
            <strong>AICTE OneDesk</strong>
            <small>Institution Complaint Management</small>
          </span>
        </Link>

        <nav className="public-nav" aria-label="Portals">
          <Link to="/demo/aicte" className="nav-link">
            AICTE Portal
          </Link>
          <Link to="/demo/cpgrams" className="nav-link">
            CPGRAMS Portal
          </Link>
          {signedIn ? (
            <>
              {has("submission.view") ? (
                <Link to="/intake" className="nav-link">
                  Intake queue
                </Link>
              ) : null}
              {(has("case.view_index") || has("case.view_detail")) && (
                <Link to="/" className="button button-quiet">
                  Dashboard
                </Link>
              )}
              {activePersona.roleCode === "COMPLAINANT" && (
                <Link to="/portal" className="nav-link">
                  My complaints
                </Link>
              )}
              <RoleSwitcher />
            </>
          ) : (
            <Link to="/sign-in" className="button button-quiet">
              Staff sign in
            </Link>
          )}
        </nav>
      </header>

      <main className="public-main">{children}</main>

      <footer className="app-footer">
        <span>
          AICTE OneDesk — Institution Grievance Monitoring & Redressal Platform
        </span>
        <span>Track your complaint using the reference on your receipt.</span>
      </footer>
    </div>
  );
}

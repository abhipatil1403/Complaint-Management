import { Link } from "react-router-dom";
import type { ReactNode } from "react";

import { useAuth } from "../auth/AuthProvider";

/** Chrome for the public simulated portals. Deliberately louder than the app. */
export function PublicShell({ children }: { children: ReactNode }) {
  const { status, me, has } = useAuth();
  const signedIn = status === "ready" && Boolean(me);

  return (
    <div className="public-shell">
      <div className="simulation-strip" role="status">
        <strong>Simulation only</strong>
        <span>
          These portals are a demonstration. They are not connected to AICTE or CPGRAMS and no real
          complaint is filed.
        </span>
      </div>

      <header className="public-header">
        <Link to="/demo" className="brand">
          <span className="brand-mark" aria-hidden="true">
            OD
          </span>
          <span>
            <strong>AICTE OneDesk</strong>
            <small>Simulated complaint intake</small>
          </span>
        </Link>

        <nav className="public-nav" aria-label="Demo">
          <Link to="/demo/aicte" className="nav-link">
            AICTE demo
          </Link>
          <Link to="/demo/cpgrams" className="nav-link">
            CPGRAMS demo
          </Link>
          {signedIn ? (
            <>
              {has("submission.view") ? (
                <Link to="/intake" className="nav-link">
                  Intake queue
                </Link>
              ) : null}
              <Link to="/" className="button button-quiet">
                Dashboard
              </Link>
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
        <span>Demonstrator only. Illustrative demo data; not an official AICTE service.</span>
        <span>Submissions are preserved unmodified in the demo database.</span>
      </footer>
    </div>
  );
}

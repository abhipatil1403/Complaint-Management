import { Link, NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { BureauSwitcher } from "./BureauSwitcher";
import { DemoBanner } from "./DemoBanner";

export function AppShell() {
  const { me, has, signOut } = useAuth();

  const navigation = [
    { to: "/verification", label: "Verification", visible: has("institution.verify") },
    { to: "/intake", label: "Intake", visible: has("submission.view") },
    { to: "/institutions", label: "Institutions", visible: has("institution.view") },
    { to: "/bureaus", label: "Bureaus", visible: has("bureau.view") },
    { to: "/regions", label: "Regions", visible: has("region.view") },
    {
      to: "/administration",
      label: "Administration",
      visible: has("user.view") || has("role.view"),
    },
    { to: "/demo", label: "Demo portals", visible: true },
  ].filter((item) => item.visible);

  return (
    <div className="app-shell">
      <DemoBanner />
      <header className="app-header">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            OD
          </span>
          <span>
            <strong>AICTE OneDesk</strong>
            <small>Complaint monitoring — Phase 2.2</small>
          </span>
        </Link>

        <nav className="app-nav" aria-label="Primary">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="header-actions">
          <BureauSwitcher />
          <div className="signed-in">
            <span className="signed-in-name">{me?.user.full_name}</span>
            <span className="signed-in-role">
              {me?.roles.map((role) => role.role_name).join(", ") || "No role"}
            </span>
          </div>
          <button type="button" className="button button-quiet" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <footer className="app-footer">
        <span>Demonstrator only. Illustrative demo data; not an official AICTE service.</span>
        <span>Phase 2.2 — human institution verification &amp; identification queue.</span>
      </footer>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { simulationStore } from "../simulation/simulationStore";
import {
  IconAdministration,
  IconAnalytics,
  IconBell,
  IconBureaus,
  IconCases,
  IconDuplicate,
  IconInstitutions,
  IconIntake,
  IconRegions,
  IconShield,
  IconVerification,
} from "./Icons";
import { NotificationDrawer } from "./NotificationDrawer";
import { GlobalSearch } from "./GlobalSearch";
import { BureauSwitcher } from "./BureauSwitcher";
import { useSimulation, visibleNotifications } from "../simulation/selectors";
import { landingLabel, scopedState } from "../simulation/scope";
import { RoleSwitcher } from "./RoleSwitcher";

export function AppShell() {
  const { has, signOut, activePersona } = useAuth();
  const location = useLocation();
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [showBadge, setShowBadge] = useState(true);
  useEffect(() => {
    const load = () => {
      try {
        const prefs = JSON.parse(
          localStorage.getItem(`onedesk-preferences-${activePersona.id}`) ||
            "{}",
        );
        setShowBadge(prefs.notifications !== false);
        document.documentElement.dataset.compact = String(
          prefs.compact === true,
        );
      } catch {
        setShowBadge(true);
      }
    };
    load();
    window.addEventListener("onedesk-preferences", load);
    return () => window.removeEventListener("onedesk-preferences", load);
  }, [activePersona.id]);

  const rawState = useSimulation();
  const state = scopedState(rawState, activePersona);
  const pendingVerifications = state.verificationTasks.filter(
    (t) => t.verification_status === "pending",
  ).length;
  const pendingDuplicates = state.duplicateCandidates.filter(
    (d) => d.review_status === "pending",
  ).length;
  const unreadNotifications = visibleNotifications(
    rawState,
    simulationStore.getActivePersona(),
  ).filter((n) => !n.is_read).length;

  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {/* Floating Left Sidebar */}
      <aside className="app-sidebar" aria-label="Main Navigation">
        <div>
          {/* Logo & Brand Header */}
          <div className="sidebar-header">
            <Link to="/" className="sidebar-brand">
              <div className="brand-icon-box">
                <IconShield className="w-5 h-5" />
              </div>
              <div className="brand-text-col">
                <span className="brand-title">AICTE OneDesk</span>
                <span className="brand-subtitle">Grievance Redressal</span>
              </div>
            </Link>
          </div>

          {/* Navigation Links */}
          <div className="sidebar-scroll">
            <div className="sidebar-section-title">Core Operations</div>
            <ul className="sidebar-nav">
              <li>
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) =>
                    `sidebar-link ${isActive ? "active" : ""}`
                  }
                >
                  <span className="opacity-80">
                    <IconShield className="w-4 h-4" />
                  </span>
                  <span>{landingLabel(activePersona)}</span>
                </NavLink>
              </li>

              {(has("case.view_index") || has("case.view_detail")) && (
                <li>
                  <NavLink
                    to="/cases"
                    className={({ isActive }) =>
                      `sidebar-link ${isActive ? "active" : ""}`
                    }
                  >
                    <span className="opacity-80">
                      <IconCases className="w-4 h-4" />
                    </span>
                    <span>Cases</span>
                    <span className="sidebar-link-badge">
                      {state.cases.length}
                    </span>
                  </NavLink>
                </li>
              )}

              {has("institution.verify") && (
                <li>
                  <NavLink
                    to="/workspaces/verification"
                    className={({ isActive }) =>
                      `sidebar-link ${isActive ? "active" : ""}`
                    }
                  >
                    <span className="opacity-80">
                      <IconVerification className="w-4 h-4" />
                    </span>
                    <span>Verification desk</span>
                    {pendingVerifications > 0 && (
                      <span className="sidebar-link-badge">
                        {pendingVerifications}
                      </span>
                    )}
                  </NavLink>
                </li>
              )}

              {has("duplicate.review") && (
                <li>
                  <NavLink
                    to="/workspaces/duplicate-review"
                    className={({ isActive }) =>
                      `sidebar-link ${isActive ? "active" : ""}`
                    }
                  >
                    <span className="opacity-80">
                      <IconDuplicate className="w-4 h-4" />
                    </span>
                    <span>Duplicate review desk</span>
                    {pendingDuplicates > 0 && (
                      <span className="sidebar-link-badge">
                        {pendingDuplicates}
                      </span>
                    )}
                  </NavLink>
                </li>
              )}

              {has("submission.view") && (
                <li>
                  <NavLink
                    to="/intake"
                    className={({ isActive }) =>
                      `sidebar-link ${isActive ? "active" : ""}`
                    }
                  >
                    <span className="opacity-80">
                      <IconIntake className="w-4 h-4" />
                    </span>
                    <span>
                      {activePersona.roleCode === "CASE_OFFICER"
                        ? "Assigned submissions"
                        : "Intake queue"}
                    </span>
                  </NavLink>
                </li>
              )}

              {has("report.view") && (
                <li>
                  <NavLink
                    to="/analytics"
                    className={({ isActive }) =>
                      `sidebar-link ${isActive ? "active" : ""}`
                    }
                  >
                    <span className="opacity-80">
                      <IconAnalytics className="w-4 h-4" />
                    </span>
                    <span>Analytics &amp; SLA</span>
                  </NavLink>
                </li>
              )}
            </ul>

            {(has("case.access.manage") || has("case.transfer.manage")) && (
              <NavLink to="/decisions" className="sidebar-link">
                <IconVerification />
                <span>Pending decisions</span>
              </NavLink>
            )}
            {activePersona.bureauId && (
              <NavLink to="/access-requests" className="sidebar-link">
                <IconShield />
                <span>My access requests</span>
              </NavLink>
            )}
            {has("escalation.manage") && (
              <NavLink to="/escalations" className="sidebar-link">
                <IconAnalytics />
                <span>Escalations</span>
              </NavLink>
            )}
            {activePersona.roleCode === "AUDITOR" && (
              <NavLink to="/audit-log" className="sidebar-link">
                <IconCases />
                <span>Audit register</span>
              </NavLink>
            )}
            <div className="sidebar-section-title">Reference &amp; Admin</div>
            <ul className="sidebar-nav">
              {has("institution.view") && (
                <li>
                  <NavLink
                    to="/institutions"
                    className={({ isActive }) =>
                      `sidebar-link ${isActive ? "active" : ""}`
                    }
                  >
                    <span className="opacity-80">
                      <IconInstitutions className="w-4 h-4" />
                    </span>
                    <span>Institutions</span>
                  </NavLink>
                </li>
              )}

              {has("bureau.view") && (
                <li>
                  <NavLink
                    to="/bureaus"
                    className={({ isActive }) =>
                      `sidebar-link ${isActive ? "active" : ""}`
                    }
                  >
                    <span className="opacity-80">
                      <IconBureaus className="w-4 h-4" />
                    </span>
                    <span>Bureaus</span>
                  </NavLink>
                </li>
              )}

              {has("region.view") && (
                <li>
                  <NavLink
                    to="/regions"
                    className={({ isActive }) =>
                      `sidebar-link ${isActive ? "active" : ""}`
                    }
                  >
                    <span className="opacity-80">
                      <IconRegions className="w-4 h-4" />
                    </span>
                    <span>Regions</span>
                  </NavLink>
                </li>
              )}

              {(has("user.view") || has("role.view")) && (
                <li>
                  <NavLink
                    to="/administration"
                    className={({ isActive }) =>
                      `sidebar-link ${isActive ? "active" : ""}`
                    }
                  >
                    <span className="opacity-80">
                      <IconAdministration className="w-4 h-4" />
                    </span>
                    <span>Administration</span>
                  </NavLink>
                </li>
              )}
            </ul>

            <div className="sidebar-section-title">Public Intake Portals</div>
            <ul className="sidebar-nav">
              <li>
                <NavLink
                  to="/demo/aicte"
                  className={({ isActive }) =>
                    `sidebar-link ${isActive ? "active" : ""}`
                  }
                >
                  <IconInstitutions />
                  <span>AICTE Web Portal</span>
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/demo/cpgrams"
                  className={({ isActive }) =>
                    `sidebar-link ${isActive ? "active" : ""}`
                  }
                >
                  <IconIntake />
                  <span>CPGRAMS Portal</span>
                </NavLink>
              </li>
            </ul>
          </div>
        </div>

        <div className="sidebar-bottom">
          <NavLink to="/settings" className="sidebar-link">
            <IconAdministration /> Settings
          </NavLink>
          <NavLink to="/help" className="sidebar-link">
            <IconShield /> Help center
          </NavLink>
          <button className="sidebar-link" onClick={() => void signOut()}>
            ↪ Sign out
          </button>
        </div>
      </aside>

      {/* Main Content Column */}
      <div className="app-main-wrapper">
        {/* Floating Topbar */}
        <header className="app-topbar">
          {/* Quick Search */}
          <GlobalSearch key={location.pathname} />
          {/* Interactive Tools */}
          <div className="topbar-actions">
            <BureauSwitcher />
            {/* Notification Bell */}
            <button
              type="button"
              className="btn-icon-topbar"
              onClick={() => setIsNotifOpen(true)}
              aria-label="View notifications"
            >
              <IconBell className="w-4 h-4" />
              {showBadge && unreadNotifications > 0 && (
                <span className="topbar-badge">{unreadNotifications}</span>
              )}
            </button>

            {/* Persona / Role Switcher Pill */}
            <RoleSwitcher />
          </div>
        </header>

        {/* Page Content Surface */}
        <main id="main-content" className="app-content-surface" tabIndex={-1}>
          {activePersona.bureauId && (
            <div className="bureau-context-label">
              {activePersona.bureauCode} · {activePersona.bureauName}
            </div>
          )}
          <Outlet key={activePersona.key} />
        </main>
      </div>

      {/* Slide-over Notification Center */}
      <NotificationDrawer
        isOpen={isNotifOpen}
        onClose={() => setIsNotifOpen(false)}
      />
    </div>
  );
}

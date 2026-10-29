import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
type Preferences = { notifications: boolean; compact: boolean };
function read(key: string): Preferences {
  try {
    return (
      JSON.parse(localStorage.getItem(key) || "null") || {
        notifications: true,
        compact: false,
      }
    );
  } catch {
    return { notifications: true, compact: false };
  }
}
export function SettingsPage() {
  const { activePersona } = useAuth();
  const key = `onedesk-preferences-${activePersona.id}`;
  const [tab, setTab] = useState("Profile");
  const [saved, setSaved] = useState(() => read(key));
  const [draft, setDraft] = useState(saved);
  const [notice, setNotice] = useState("");
  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="page-description">
            Your account, notifications, and workspace preferences.
          </p>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="card settings-nav" aria-label="Settings sections">
          {["Profile", "Notifications", "Appearance"].map((t) => (
            <button
              key={t}
              className={`button ${tab === t ? "active" : ""}`}
              onClick={() => {
                setTab(t);
                setNotice("");
              }}
            >
              {t}
            </button>
          ))}
        </nav>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              localStorage.setItem(key, JSON.stringify(draft));
              setSaved(draft);
              document.documentElement.dataset.compact = String(draft.compact);
              window.dispatchEvent(new Event("onedesk-preferences"));
              setNotice("Preferences saved.");
            } catch {
              setNotice(
                "Could not save preferences. Browser storage may be full.",
              );
            }
          }}
        >
          <h2>{tab}</h2>
          {tab === "Profile" ? (
            <>
              <div className="toolbar">
                <span className="officer-avatar">
                  {activePersona.name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <p className="small muted">
                  Account information is managed by your administrator.
                </p>
              </div>
              <div className="form-grid">
                <label>
                  Full name
                  <input value={activePersona.name} readOnly />
                </label>
                <label>
                  Email
                  <input value={activePersona.email} readOnly />
                </label>
                <label>
                  Role
                  <input value={activePersona.roleName} readOnly />
                </label>
                <label>
                  Bureau
                  <input
                    value={activePersona.bureauName || "Organisation-wide"}
                    readOnly
                  />
                </label>
                <label>
                  Designation
                  <input value={activePersona.designation} readOnly />
                </label>
                <label>
                  Time zone
                  <input value="India Standard Time · Asia/Kolkata" readOnly />
                </label>
              </div>
            </>
          ) : tab === "Notifications" ? (
            <>
              <p>
                Control notification badges in this workspace. Your notification
                history is always available.
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.notifications}
                  onChange={(e) =>
                    setDraft({ ...draft, notifications: e.target.checked })
                  }
                />
                Show unread notification badges
              </label>
            </>
          ) : (
            <>
              <p>Choose how much information fits on the screen.</p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.compact}
                  onChange={(e) =>
                    setDraft({ ...draft, compact: e.target.checked })
                  }
                />
                Compact table rows
              </label>
            </>
          )}
          {tab !== "Profile" && (
            <div className="modal-footer">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setDraft(saved);
                  setNotice("Unsaved changes discarded.");
                }}
              >
                Discard
              </button>
              <button className="button button-primary" type="submit">
                Save changes
              </button>
            </div>
          )}
          {notice && (
            <p role="status" className="callout callout-info">
              {notice}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}

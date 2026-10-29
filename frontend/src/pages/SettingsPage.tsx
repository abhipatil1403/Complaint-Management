import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  getGeminiApiKey,
  setGeminiApiKey,
  hasGeminiApiKey,
  testGeminiApiKey,
} from "../lib/gemini";
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
  const [apiKeyInput, setApiKeyInput] = useState(() => getGeminiApiKey());
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTestingKey, setIsTestingKey] = useState(false);
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
          {["Profile", "Notifications", "Appearance", "AI Engine & Gemini API"].map((t) => (
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
          ) : tab === "AI Engine & Gemini API" ? (
            <>
              <p>
                AICTE OneDesk uses Google Gemini AI (gemini-2.0-flash) for automated complaint triage, 
                statutory entity extraction, AICTE Approval Process Handbook (APH) compliance checks, 
                and inter-bureau conflict mitigation.
              </p>
              <div className="form-grid" style={{ marginBottom: "1rem" }}>
                <label style={{ gridColumn: "1 / -1" }}>
                  Google Gemini API Key
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem", flexWrap: "wrap" }}>
                    <input
                      type="password"
                      placeholder="AIzaSy..."
                      value={apiKeyInput}
                      onChange={(e) => {
                        setApiKeyInput(e.target.value);
                        setTestResult(null);
                      }}
                      style={{ flex: 1, minWidth: "240px", fontFamily: "monospace" }}
                    />
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={!apiKeyInput.trim() || isTestingKey}
                      onClick={async () => {
                        setIsTestingKey(true);
                        setTestResult(null);
                        const res = await testGeminiApiKey(apiKeyInput.trim());
                        setTestResult(res);
                        setIsTestingKey(false);
                      }}
                    >
                      {isTestingKey ? "Testing..." : "Test Connection"}
                    </button>
                    {apiKeyInput && (
                      <button
                        type="button"
                        className="button button-quiet"
                        onClick={() => {
                          setApiKeyInput("");
                          setGeminiApiKey("");
                          setTestResult(null);
                          setNotice("Gemini API key cleared. Reverted to local rule engine.");
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <span className="small muted">
                    Stored securely in your local browser storage. You can generate a free API key at{" "}
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
                      Google AI Studio
                    </a>.
                  </span>
                </label>
              </div>

              {testResult && (
                <div
                  className={`callout ${testResult.success ? "callout-success" : "callout-error"}`}
                  style={{
                    background: testResult.success ? "#f0fdf4" : "#fef2f2",
                    border: `1px solid ${testResult.success ? "#86efac" : "#fca5a5"}`,
                    color: testResult.success ? "#166534" : "#991b1b",
                    padding: "0.75rem",
                    borderRadius: "var(--radius-md)",
                    marginBottom: "1rem",
                  }}
                >
                  {testResult.message}
                </div>
              )}

              <div
                style={{
                  background: hasGeminiApiKey() ? "#f0fdf4" : "#f8fafc",
                  border: `1px solid ${hasGeminiApiKey() ? "#86efac" : "var(--color-border)"}`,
                  padding: "0.85rem",
                  borderRadius: "var(--radius-md)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "0.75rem",
                }}
              >
                <div>
                  <strong style={{ color: hasGeminiApiKey() ? "#166534" : "inherit" }}>
                    Status: {hasGeminiApiKey() ? "Live Gemini AI Active" : "Deterministic Engine (No Key Set)"}
                  </strong>
                  <p className="small muted" style={{ margin: "0.2rem 0 0 0" }}>
                    {hasGeminiApiKey()
                      ? "Real-time AI triage queries Google Gemini 2.0 Flash."
                      : "Using built-in AICTE-Norms-v2.4 dynamic legal heuristics."}
                  </p>
                </div>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => {
                    setGeminiApiKey(apiKeyInput.trim());
                    setNotice("Gemini API key saved successfully.");
                  }}
                >
                  Save API Key
                </button>
              </div>
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
          {tab !== "Profile" && tab !== "AI Engine & Gemini API" && (
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

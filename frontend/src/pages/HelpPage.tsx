import { useState } from "react";
import { Link } from "react-router-dom";
const topics = [
  [
    "Submitting complaints",
    "Open a public intake portal, enter the institution and original complaint details, and attach relevant evidence. Save the tracking reference displayed on the receipt.",
  ],
  [
    "Tracking complaints",
    "Use Track complaint in the public portal and enter your tracking reference. The record reflects institution verification, duplicate review, and the linked case status.",
  ],
  [
    "Institution verification",
    "Authorized reviewers compare submitted institution details with master records. Confirm the institution with a reason, reject an invalid match, or request a correction before a canonical case can be created.",
  ],
  [
    "Duplicate review",
    "A similarity score identifies a candidate for human review. Compare the original submission with the candidate case and record a duplicate, related, or distinct decision. A high score never merges records automatically.",
  ],
  [
    "Case assignments",
    "Open the Assignments tab of a case. Authorized managers can add collaborating bureaus and assign officers with active membership of the selected bureau. Historical assignments remain in the timeline.",
  ],
  [
    "SLA deadlines",
    "The case workspace displays the configured category target. Reporting uses the application clock and the recorded target date. Sample configuration is not an official AICTE policy; verify policy versions before operational use.",
  ],
  [
    "Escalations",
    "Overdue cases generate escalation records according to configured thresholds. Authorized users can acknowledge an escalation with remarks. Resolving a case updates its lifecycle and reporting.",
  ],
  [
    "Bureau transfers",
    "Use Transfers in the case workspace to request a lead bureau handover and provide a reason. An authorized approver reviews the request. Approved transfers retain assignment and action history.",
  ],
  [
    "Permissions and cross-bureau access",
    "Case-index access does not grant complaint-content access. Request access with a justification in the case workspace. An authorized manager may grant or revoke access. Bureau-private notes remain restricted to their bureau.",
  ],
  [
    "Attachments and evidence",
    "Upload a supported file from the Attachments tab. You can preview supported document formats and download the original file. Quarantined files cannot be previewed or downloaded.",
  ],
];
export function HelpPage() {
  const [q, setQ] = useState("");
  const filtered = topics.filter((t) =>
    t.join(" ").toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <section>
      <div className="page-header">
        <div>
          <h1>Help center</h1>
          <p className="page-description">
            Guidance for every step of the complaint lifecycle.
          </p>
        </div>
      </div>
      <div className="help-hero">
        <h2>How can we help?</h2>
        <p>Find answers about intake, case work, and collaboration.</p>
        <input
          aria-label="Search help articles"
          placeholder="Search help topics…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="dashboard-split-grid">
        <div className="card help-faq">
          <h2>Frequently asked</h2>
          {filtered.map(([title, body]) => (
            <details key={title}>
              <summary>{title}</summary>
              <p>{body}</p>
            </details>
          ))}
          {!filtered.length && (
            <p className="empty-state">
              No matching topics. Try “verification” or “access”.
            </p>
          )}
        </div>
        <aside className="card">
          <h2>Quick links</h2>
          <div className="stack">
            <Link className="button button-secondary" to="/demo/aicte">
              Submit or track a complaint
            </Link>
            <Link className="button button-secondary" to="/cases">
              Open case workspace
            </Link>
            <Link className="button button-secondary" to="/settings">
              Account settings
            </Link>
          </div>
          <h3 style={{ marginTop: 24 }}>Keyboard shortcuts</h3>
          <div className="settings-summary">
            <div>
              <kbd>Ctrl / Cmd + K</kbd>
              <span>Global search</span>
            </div>
            <div>
              <kbd>Esc</kbd>
              <span>Close search or dialog</span>
            </div>
            <div>
              <kbd>Tab</kbd>
              <span>Next control</span>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

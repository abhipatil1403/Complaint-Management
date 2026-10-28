import { Link } from "react-router-dom";

import { PublicShell } from "../components/PublicShell";
import { ErrorPanel, Loading } from "../components/ui";
import { PORTAL_PATHS } from "../lib/intake";
import { useDemoInfo } from "../lib/useDemoInfo";

export function DemoHomePage() {
  const { info, loading, error } = useDemoInfo();

  return (
    <PublicShell>
      <section className="demo-hero">
        <p className="eyebrow">Simulation — not a government service</p>
        <h1>Simulated complaint intake</h1>
        <p>
          Phase 2.1 demonstrates how a complaint submitted through the AICTE portal or CPGRAMS
          would enter AICTE OneDesk. Every submission is stored as submitted, in its original
          language, and is never forwarded to any external system.
        </p>
        <p className="callout callout-warning">
          <strong>Do not submit a real grievance.</strong> These pages are a product demonstration.
          Anything entered is kept only in this project's demo database. No acknowledgement is
          issued and no action is taken.
        </p>
      </section>

      {loading ? <Loading label="Loading the demo portals..." /> : null}
      <ErrorPanel error={error} title="The demo portals are unavailable" />

      {info && !info.demo_intake_enabled ? (
        <div className="notice-box" role="status">
          <strong>Simulated intake is disabled</strong>
          <p>
            The API has turned the demo intake off. Enable <code>DEMO_INTAKE_ENABLED</code> to use
            the simulated portals.
          </p>
        </div>
      ) : null}

      {info?.demo_intake_enabled ? (
        <div className="grid grid-2 section">
          {info.channels.map((channel) => (
            <article key={channel.code} className="card portal-card">
              <div className="badge-row">
                <span className="badge badge-simulated">Simulated</span>
                <span className="badge badge-neutral mono">{channel.code}</span>
              </div>
              <h2>{channel.name}</h2>
              <p className="muted">
                {channel.portal === "aicte"
                  ? "Step into the role of an institution submitting a grievance through the AICTE portal."
                  : "Step into the role of a citizen submitting a grievance through CPGRAMS."}
              </p>
              <p className="small muted">
                No login is required. The API rate-limits submissions per client and the database
                only accepts the dedicated intake role.
              </p>
              <Link to={PORTAL_PATHS[channel.portal]} className="button button-primary">
                Open the {channel.portal === "aicte" ? "AICTE" : "CPGRAMS"} demo
              </Link>
            </article>
          ))}
        </div>
      ) : null}

      <div className="card section">
        <h2>What this phase does</h2>
        <ul className="check-list">
          <li>Preserves the submitted subject, description and language exactly as entered.</li>
          <li>Generates a clearly marked simulation reference and records an intake status.</li>
          <li>Never creates a case, never merges duplicates and never contacts an external system.</li>
          <li>
            Keeps complaint text restricted: staff need the explicit <code>submission.view</code>{" "}
            capability, checked by the API and by row-level security.
          </li>
        </ul>
        <p className="muted small">
          Institution verification, duplicate review, case creation, assignments, SLA tracking and
          notifications are later phases.
        </p>
      </div>

      {info ? (
        <div className="card section">
          <h2>Simulation notices</h2>
          <p className="small muted mono">{info.simulation_notice_version}</p>
          <div className="grid grid-2">
            <div>
              <h3>English</h3>
              <p>{info.simulation_notice_en}</p>
            </div>
            <div lang="hi">
              <h3>हिन्दी</h3>
              <p>{info.simulation_notice_hi}</p>
            </div>
          </div>
        </div>
      ) : null}
    </PublicShell>
  );
}

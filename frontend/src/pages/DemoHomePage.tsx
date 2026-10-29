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
        <p className="eyebrow">Public Grievance Ingestion Gateway</p>
        <h1>Complaint Intake & Tracking Portal</h1>
        <p>
          Lodge institutional grievances through official intake channels into AICTE OneDesk.
          Every submission is preserved in its original language, securely verified, and tracked
          through canonical case resolution.
        </p>
      </section>

      {loading ? <Loading label="Loading the intake portals..." /> : null}
      <ErrorPanel error={error} title="The intake portals are unavailable" />

      {info?.demo_intake_enabled ? (
        <div className="grid grid-2 section">
          {info.channels.map((channel) => (
            <article key={channel.code} className="card portal-card">
              <div className="badge-row">
                <span className="badge badge-success">Active Channel</span>
                <span className="badge badge-neutral mono">{channel.code}</span>
              </div>
              <h2>{channel.name}</h2>
              <p className="muted">
                {channel.portal === "aicte"
                  ? "Lodge a formal institution grievance via the direct AICTE Central Portal."
                  : "Ingest public grievances forwarded via the national CPGRAMS grievance mechanism."}
              </p>
              <p className="small muted">
                Generates a permanent tracking reference with instant status querying and attachment verification.
              </p>
              <Link to={PORTAL_PATHS[channel.portal]} className="button button-primary">
                Open {channel.portal === "aicte" ? "AICTE Portal" : "CPGRAMS Ingestion"}
              </Link>
            </article>
          ))}
        </div>
      ) : null}

      <div className="card section">
        <h2>End-to-End Redressal Governance</h2>
        <ul className="check-list">
          <li>Preserves the submitted subject, description and language exactly as entered.</li>
          <li>Instant tracking code generation with public status inspection.</li>
          <li>Mandatory human institution verification queue before canonical case linkage.</li>
          <li>Deterministic duplicate detection with advisory similarity scoring.</li>
          <li>Multi-bureau collaboration, immutable action logs, and automated SLA breach escalation.</li>
        </ul>
      </div>

      {info ? (
        <div className="card section">
          <h2>Official Disclosures & Policies</h2>
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

import { Link } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { PageHeader, StatusBadge } from "../components/ui";
import { formatResource, groupPermissionsByResource, membershipName } from "../lib/access";

const PHASE_NOTES = [
  "Identity comes from Supabase Auth; there is no separate password system.",
  "Capabilities are resolved from role grants and re-checked by FastAPI and PostgreSQL.",
  "Reference data is deactivated rather than deleted so history stays intact.",
  "Bureau-scoped capabilities only apply while that bureau is the active context.",
  "Phase 2.1 intake preserves the original subject, text and language exactly as submitted.",
  "Only the dedicated intake database role can create a submission; browsers cannot.",
];

export function HomePage() {
  const { me, isSuperAdmin, has } = useAuth();

  if (!me) {
    return null;
  }

  const activeBureau = membershipName(me, me.active_bureau_id);
  const capabilities = groupPermissionsByResource(me.permissions);
  const globalCapabilities = groupPermissionsByResource(me.global_permissions);

  const shortcuts = [
    {
      to: "/intake",
      title: "Intake queue",
      description: "Review preserved submissions from the simulated portals.",
      visible: has("submission.view"),
    },
    {
      to: "/institutions",
      title: "Institutions",
      description: "Search master data, aliases and verification evidence.",
      visible: has("institution.view"),
    },
    {
      to: "/bureaus",
      title: "Bureaus",
      description: "Review bureau structure and active memberships.",
      visible: has("bureau.view"),
    },
    {
      to: "/regions",
      title: "Regions",
      description: "Maintain the reference list used to group institutions.",
      visible: has("region.view"),
    },
    {
      to: "/administration",
      title: "Administration",
      description: "Review authorized users, role grants and the role catalogue.",
      visible: has("user.view") || has("role.view"),
    },
  ].filter((item) => item.visible);

  return (
    <section>
      <PageHeader
        title={`Welcome, ${me.user.display_name || me.user.full_name}`}
        description="Phase 2.1 adds simulated complaint intake and submission preservation. Case, duplicate and SLA workflows arrive in later phases."
      />

      <div className="grid grid-3">
        <article className="card">
          <h2>Identity</h2>
          <dl className="detail-list">
            <div>
              <dt>Official email</dt>
              <dd>{me.user.official_email}</dd>
            </div>
            <div>
              <dt>Designation</dt>
              <dd>{me.user.designation ?? "—"}</dd>
            </div>
            <div>
              <dt>Employee code</dt>
              <dd>{me.user.employee_code ?? "—"}</dd>
            </div>
            <div>
              <dt>Account status</dt>
              <dd>
                <StatusBadge value={me.user.account_status} />
              </dd>
            </div>
          </dl>
          <p className="muted small">
            {me.is_super_admin
              ? "This account holds the global Super Admin role. It does not bypass restricted case content."
              : "Access is limited to the capabilities granted by the roles below."}
          </p>
        </article>

        <article className="card">
          <h2>Roles and scope</h2>
          {me.roles.length === 0 ? (
            <p className="muted">No active role grant. Reference data and cases stay hidden.</p>
          ) : (
            <ul className="stack">
              {me.roles.map((role) => (
                <li key={`${role.role_code}-${role.bureau_id ?? "global"}`} className="stack-item">
                  <div>
                    <strong>{role.role_name}</strong>
                    <div className="muted small mono">{role.role_code}</div>
                  </div>
                  <div className="stack-meta">
                    <StatusBadge value={role.scope_type} />
                    <span className="muted small">
                      {role.scope_type === "global"
                        ? "Organisation-wide"
                        : role.bureau_name ?? "Bureau"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {isSuperAdmin ? (
            <p className="muted small">is_super_admin is derived from the global SUPER_ADMIN role.</p>
          ) : null}
        </article>

        <article className="card">
          <h2>Bureau context</h2>
          {me.memberships.length === 0 ? (
            <p className="muted">
              No bureau membership. Only global capabilities apply to this account.
            </p>
          ) : (
            <>
              <p>
                Active context: <strong>{activeBureau ?? "None selected"}</strong>
              </p>
              <ul className="stack">
                {me.memberships.map((membership) => (
                  <li key={membership.bureau_id} className="stack-item">
                    <div>
                      <strong>
                        {membership.bureau_code} — {membership.bureau_name}
                      </strong>
                      <div className="muted small">
                        {membership.membership_type}
                        {membership.is_primary ? " · primary" : ""}
                      </div>
                    </div>
                    {me.active_bureau_id === membership.bureau_id ? (
                      <StatusBadge value="active" label="in context" />
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="muted small">
                Use the bureau switcher in the header. The API validates the membership and
                PostgreSQL applies only that bureau's grants.
              </p>
            </>
          )}
        </article>
      </div>

      {shortcuts.length > 0 ? (
        <div className="section">
          <h2>Available in this phase</h2>
          <div className="grid grid-4">
            {shortcuts.map((shortcut) => (
              <Link key={shortcut.to} to={shortcut.to} className="card link-card">
                <strong>{shortcut.title}</strong>
                <span className="muted small">{shortcut.description}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-2 section">
        <article className="card">
          <h2>Capabilities in the active context</h2>
          {capabilities.length === 0 ? (
            <p className="muted">No capability is granted in this context.</p>
          ) : (
            <table className="compact-table">
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {capabilities.map((group) => (
                  <tr key={group.resource}>
                    <td>{formatResource(group.resource)}</td>
                    <td className="mono small">{group.actions.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">
            Effective list for {activeBureau ?? "the global context"}. Switching bureau reloads
            this list from the API.
          </p>
        </article>

        <article className="card">
          <h2>Global capabilities</h2>
          {globalCapabilities.length === 0 ? (
            <p className="muted">No organisation-wide capability.</p>
          ) : (
            <ul className="tag-list">
              {globalCapabilities.map((group) => (
                <li key={group.resource} className="tag">
                  <span>{formatResource(group.resource)}</span>
                  <span className="mono small">{group.actions.join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">
            Administration routes require a global capability. A bureau-scoped grant never enables
            user or role administration.
          </p>
        </article>
      </div>

      <article className="card section">
        <h2>Simulated intake</h2>
        <p>
          Two demonstration portals feed the intake queue. Neither is connected to AICTE or CPGRAMS,
          and no submission leaves this project.
        </p>
        <div className="link-row">
          <Link to="/demo/aicte" className="button button-quiet">
            AICTE demo portal
          </Link>
          <Link to="/demo/cpgrams" className="button button-quiet">
            CPGRAMS demo portal
          </Link>
        </div>
        <p className="muted small">
          Submissions wait in <strong>awaiting institution verification</strong> or{" "}
          <strong>awaiting duplicate review</strong>. No case is created automatically and no
          duplicate is merged.
        </p>
      </article>

      <article className="card section">
        <h2>Scope of this build</h2>
        <ul className="check-list">
          {PHASE_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <p className="muted small">
          Demonstration only. Every seeded record is illustrative and no real complaint is filed or
          tracked. Later phases add institution verification, duplicate review, cases, assignments
          and SLA tracking.
        </p>
      </article>
    </section>
  );
}

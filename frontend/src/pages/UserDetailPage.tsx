import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useSimulation, isResolved } from "../simulation/selectors";
import { PermissionDeniedPage } from "./PermissionDeniedPage";
import { NotFoundPage } from "./NotFoundPage";
export function UserDetailPage() {
  const { has } = useAuth();
  const { userId } = useParams();
  const state = useSimulation();
  if (!has("user.view")) return <PermissionDeniedPage />;
  const user = Object.values(state.personas).find((p) => p.id === userId);
  const member = state.bureauMembers.find((m) => m.user_id === userId);
  if (!user && !member) return <NotFoundPage />;
  const name = user?.name || member!.full_name;
  const cases = state.cases.filter((c) =>
    c.officer_assignments.some(
      (a) => a.officer_id === userId && a.status === "active",
    ),
  );
  return (
    <section>
      <div className="page-header">
        <div>
          <h1>{name}</h1>
          <p className="page-description">
            {user?.designation || member?.designation}
          </p>
        </div>
        <Link className="button button-secondary" to="/administration">
          Back to directory
        </Link>
      </div>
      <div className="grid grid-2">
        <article className="card">
          <h2>Officer profile</h2>
          <dl className="detail-list">
            <div>
              <dt>Email</dt>
              <dd>{user?.email || member?.email}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{user?.roleName || member?.membership_type}</dd>
            </div>
            <div>
              <dt>Bureau</dt>
              <dd>
                {user?.bureauName ||
                  state.bureaus.find((b) => b.id === member?.bureau_id)?.name ||
                  "Organisation-wide"}
              </dd>
            </div>
            <div>
              <dt>Active case workload</dt>
              <dd>{cases.filter((c) => !isResolved(c)).length}</dd>
            </div>
          </dl>
          <Link className="text-link" to={`/cases?officer=${userId}`}>
            View assigned cases →
          </Link>
        </article>
        <article className="card">
          <h2>Assigned capabilities</h2>
          <ul className="tag-list">
            {user?.permissions.map((p) => (
              <li key={p} className="tag">
                {p}
              </li>
            ))}
          </ul>
          <p className="small muted">
            Identity provisioning and role changes are managed through the
            authorised account administration system.
          </p>
        </article>
      </div>
    </section>
  );
}

import { useSimulation, isResolved } from "../simulation/selectors";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import {
  EmptyState,
  ErrorPanel,
  Loading,
  PageHeader,
  StatusBadge,
} from "../components/ui";
import { usePagedResource, useResource } from "../lib/useResource";
import type { Role, UserSummary } from "../types";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

type Tab = "users" | "roles";

export function AdministrationPage() {
  const { has } = useAuth();
  const state = useSimulation();
  const [officerQuery, setOfficerQuery] = useState("");
  const canViewUsers = has("user.view");
  const canViewRoles = has("role.view");
  const [tab, setTab] = useState<Tab>(canViewUsers ? "users" : "roles");

  if (!canViewUsers && !canViewRoles) {
    return <PermissionDeniedPage />;
  }

  return (
    <section>
      <PageHeader
        title="Officers & administration"
        description="Authorized users, role grants and the role catalogue. Administration requires an organisation-wide capability, never a bureau-scoped one."
      />

      {canViewUsers && (
        <section>
          <label>
            Search officers
            <input
              value={officerQuery}
              onChange={(e) => setOfficerQuery(e.target.value)}
              placeholder="Name, bureau, or designation…"
            />
          </label>
          <div className="officer-grid">
            {state.bureauMembers
              .filter(
                (m) =>
                  m.is_active &&
                  `${m.full_name} ${m.designation} ${state.bureaus.find((b) => b.id === m.bureau_id)?.name}`
                    .toLowerCase()
                    .includes(officerQuery.toLowerCase()),
              )
              .map((m, i) => {
                const assigned = state.cases.filter((c) =>
                  c.officer_assignments.some(
                    (a) => a.officer_id === m.user_id && a.status === "active",
                  ),
                );
                return (
                  <article className="card officer-card" key={m.id}>
                    <span className={`officer-avatar avatar-tone-${i % 4}`}>
                      {m.full_name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <h3>{m.full_name}</h3>
                    <p>{m.designation}</p>
                    <span className="badge badge-active">
                      {state.bureaus.find((b) => b.id === m.bureau_id)?.code}
                    </span>
                    <div className="toolbar">
                      <span>
                        <strong>
                          {assigned.filter((c) => !isResolved(c)).length}
                        </strong>{" "}
                        active
                      </span>
                      <span>
                        <strong>{assigned.filter(isResolved).length}</strong>{" "}
                        completed
                      </span>
                    </div>
                    <Link
                      className="button button-secondary"
                      to={`/cases?officer=${m.user_id}`}
                    >
                      Assigned cases
                    </Link>{" "}
                    <Link
                      className="button button-primary"
                      to={`/administration/users/${m.user_id}`}
                    >
                      Profile
                    </Link>
                  </article>
                );
              })}
          </div>
        </section>
      )}
      <div className="tabs" role="tablist" aria-label="Administration sections">
        {canViewUsers ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "users"}
            className={tab === "users" ? "tab active" : "tab"}
            onClick={() => setTab("users")}
          >
            Users
          </button>
        ) : null}
        {canViewRoles ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "roles"}
            className={tab === "roles" ? "tab active" : "tab"}
            onClick={() => setTab("roles")}
          >
            Role catalogue
          </button>
        ) : null}
      </div>

      {tab === "users" && canViewUsers ? (
        <UsersPanel canViewRoles={canViewRoles} />
      ) : null}
      {tab === "roles" && canViewRoles ? <RolesPanel /> : null}
    </section>
  );
}

function UsersPanel({ canViewRoles }: { canViewRoles: boolean }) {
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const users = usePagedResource<UserSummary>("/users", {
    q: query || undefined,
    account_status: status || undefined,
  });

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(searchDraft.trim());
  }

  return (
    <div className="card">
      <div className="toolbar toolbar-wrap">
        <h2>Authorized users</h2>
        <form className="toolbar toolbar-wrap" onSubmit={search}>
          <label>
            Search
            <input
              value={searchDraft}
              maxLength={120}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Name or email"
            />
          </label>
          <label>
            Account status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </label>
          <button type="submit" className="button">
            Search
          </button>
        </form>
      </div>

      <p className="muted small">
        Accounts are linked to an AICTE OneDesk profile. An administrator
        provisions officer identities and manages bureau role grants here.
        {!canViewRoles
          ? " Your role can review users but not the role catalogue."
          : null}
      </p>

      <ErrorPanel error={users.error} />
      {users.loading && users.items.length === 0 ? <Loading /> : null}
      {!users.loading && !users.error && users.items.length === 0 ? (
        <EmptyState title="No users match" />
      ) : null}

      {users.items.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Officer</th>
                <th>Email</th>
                <th>Employee code</th>
                <th>Roles</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.items.map((user) => (
                <tr key={user.id}>
                  <td>
                    <Link to={`/administration/users/${user.id}`}>
                      {user.full_name}
                    </Link>
                    {user.designation ? (
                      <div className="muted small">{user.designation}</div>
                    ) : null}
                  </td>
                  <td>{user.official_email}</td>
                  <td className="mono">{user.employee_code ?? "—"}</td>
                  <td>
                    {user.roles.length === 0 ? (
                      <span className="muted">None</span>
                    ) : (
                      <ul className="tag-list">
                        {user.roles.map((role) => (
                          <li
                            key={`${role.role_code}-${role.bureau_id ?? "global"}`}
                            className="tag"
                          >
                            {role.role_code}
                            {role.bureau_id ? (
                              <span className="muted small">
                                {" "}
                                ({role.bureau_name})
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    <StatusBadge value={user.account_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {users.hasMore ? (
        <div className="pager">
          <button
            type="button"
            className="button button-quiet"
            onClick={() => void users.loadMore()}
            disabled={users.loading}
          >
            {users.loading ? "Loading..." : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RolesPanel() {
  const roles = useResource<Role[]>("/roles");

  if (roles.loading && !roles.data) {
    return <Loading label="Loading role catalogue..." />;
  }

  return (
    <div className="card">
      <div className="toolbar">
        <h2>Role catalogue</h2>
        <button
          type="button"
          className="button button-quiet"
          onClick={() => void roles.reload()}
        >
          Refresh
        </button>
      </div>
      <ErrorPanel error={roles.error} />

      {roles.data && roles.data.length === 0 ? (
        <EmptyState title="No roles in the catalogue" />
      ) : null}

      {roles.data && roles.data.length > 0 ? (
        <div className="stack">
          {roles.data.map((role) => (
            <article key={role.id} className="role-card">
              <div className="role-card-head">
                <div>
                  <h3>{role.name}</h3>
                  <div className="mono small muted">{role.code}</div>
                </div>
                <div className="badge-row">
                  <StatusBadge value={role.scope_type} />
                  <StatusBadge value={role.is_active ? "active" : "inactive"} />
                  {role.is_system_role ? (
                    <span className="badge badge-neutral">system</span>
                  ) : null}
                </div>
              </div>
              {role.description ? (
                <p className="muted">{role.description}</p>
              ) : null}
              <div>
                <span className="small muted">
                  Capabilities ({role.permissions.length})
                </span>
                <ul className="tag-list">
                  {role.permissions.map((permission) => (
                    <li key={permission} className="tag mono small">
                      {permission}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

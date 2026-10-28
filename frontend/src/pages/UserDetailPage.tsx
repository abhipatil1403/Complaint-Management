import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import {
  EmptyState,
  ErrorPanel,
  Loading,
  PageHeader,
  StatusBadge,
  formatDate,
} from "../components/ui";
import { toApiError, type ApiError } from "../lib/api";
import { useResource } from "../lib/useResource";
import type { AccountStatus, Role, UserDetail } from "../types";
import { NotFoundPage } from "./NotFoundPage";

export function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  if (!userId) {
    return <NotFoundPage />;
  }
  return <UserDetailContent userId={userId} />;
}

function UserDetailContent({ userId }: { userId: string }) {
  const { has } = useAuth();
  const user = useResource<UserDetail>(`/users/${userId}`);
  const canManage = has("user.manage");

  if (user.loading && !user.data) {
    return <Loading label="Loading user..." />;
  }

  if (user.error) {
    return (
      <div className="card">
        <ErrorPanel error={user.error} title="The user could not be loaded" />
        <Link className="button button-quiet" to="/administration">
          Back to administration
        </Link>
      </div>
    );
  }

  if (!user.data) {
    return <NotFoundPage />;
  }

  const data = user.data;
  const activeMemberships = data.memberships.filter(
    (membership) => membership.membership_status === "active",
  );

  return (
    <section>
      <PageHeader
        title={data.display_name || data.full_name}
        description={data.official_email}
        actions={
          <Link className="button button-quiet" to="/administration">
            Back to administration
          </Link>
        }
      />

      <div className="badge-row">
        <StatusBadge value={data.account_status} />
        <span className="mono small muted">{data.id}</span>
      </div>

      <div className="grid grid-2">
        <article className="card">
          <h2>Profile</h2>
          <dl className="detail-list">
            <div>
              <dt>Full name</dt>
              <dd>{data.full_name}</dd>
            </div>
            <div>
              <dt>Display name</dt>
              <dd>{data.display_name ?? "—"}</dd>
            </div>
            <div>
              <dt>Designation</dt>
              <dd>{data.designation ?? "—"}</dd>
            </div>
            <div>
              <dt>Employee code</dt>
              <dd className="mono">{data.employee_code ?? "—"}</dd>
            </div>
            <div>
              <dt>Account status</dt>
              <dd>
                <StatusBadge value={data.account_status} />
              </dd>
            </div>
          </dl>
          <p className="muted small">
            Identity is owned by Supabase Auth. This profile is the AICTE OneDesk record linked to
            that identity.
          </p>
        </article>

        <article className="card">
          <h2>Bureau memberships</h2>
          {data.memberships.length === 0 ? (
            <EmptyState title="No bureau membership" />
          ) : (
            <div className="table-wrap">
              <table className="compact-table">
                <thead>
                  <tr>
                    <th>Bureau</th>
                    <th>Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.memberships.map((membership) => (
                    <tr key={membership.id}>
                      <td>
                        {membership.bureau_code} — {membership.bureau_name}
                        {membership.is_primary ? (
                          <span className="muted small"> · primary</span>
                        ) : null}
                      </td>
                      <td>{membership.membership_type}</td>
                      <td>
                        <StatusBadge value={membership.membership_status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">
            Memberships are added and ended from the bureau detail page. A bureau-scoped role grant
            requires an active membership first.
          </p>
        </article>
      </div>

      {canManage ? (
        <div className="grid grid-2">
          <ProfileForm key={data.full_name} user={data} onSaved={user.reload} />
          <AccountStatusCard user={data} onChanged={user.reload} />
        </div>
      ) : null}

      <RoleAssignmentsSection
        user={data}
        canManage={canManage}
        activeMemberships={activeMemberships}
        onChanged={user.reload}
      />
    </section>
  );
}

function ProfileForm({ user, onSaved }: { user: UserDetail; onSaved: () => Promise<void> }) {
  const { api } = useAuth();
  const [form, setForm] = useState({
    full_name: user.full_name,
    display_name: user.display_name ?? "",
    employee_code: user.employee_code ?? "",
    designation: user.designation ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch(`/users/${user.id}`, {
        full_name: form.full_name.trim(),
        display_name: form.display_name.trim() || null,
        employee_code: form.employee_code.trim() || null,
        designation: form.designation.trim() || null,
      });
      await onSaved();
      setSaved(true);
    } catch (raw) {
      setError(toApiError(raw));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card">
      <h2>Edit profile</h2>
      <form className="form" onSubmit={save}>
        <label>
          Full name
          <input
            required
            minLength={2}
            maxLength={200}
            value={form.full_name}
            onChange={(event) => setForm({ ...form, full_name: event.target.value })}
          />
        </label>
        <label>
          Display name
          <input
            maxLength={200}
            value={form.display_name}
            onChange={(event) => setForm({ ...form, display_name: event.target.value })}
          />
        </label>
        <label>
          Employee code
          <input
            maxLength={64}
            value={form.employee_code}
            onChange={(event) => setForm({ ...form, employee_code: event.target.value })}
          />
        </label>
        <label>
          Designation
          <input
            maxLength={120}
            value={form.designation}
            onChange={(event) => setForm({ ...form, designation: event.target.value })}
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? "Saving..." : "Save profile"}
          </button>
          {saved ? <span className="success-text">Saved.</span> : null}
        </div>
      </form>
      <ErrorPanel error={error} title="The profile was not saved" />
    </article>
  );
}

function AccountStatusCard({
  user,
  onChanged,
}: {
  user: UserDetail;
  onChanged: () => Promise<void>;
}) {
  const { api, me } = useAuth();
  const [busy, setBusy] = useState<AccountStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const isSelf = me?.user.id === user.id;

  async function change(status: AccountStatus) {
    setBusy(status);
    setError(null);
    try {
      await api.post(`/users/${user.id}/account-status`, { account_status: status });
      await onChanged();
    } catch (raw) {
      setError(toApiError(raw));
    } finally {
      setBusy(null);
    }
  }

  const options: Array<{ status: AccountStatus; label: string }> = [
    { status: "active", label: "Activate" },
    { status: "inactive", label: "Deactivate" },
    { status: "suspended", label: "Suspend" },
  ];

  return (
    <article className="card">
      <h2>Account status</h2>
      <p className="muted small">
        Accounts are never deleted. Deactivation blocks API access while preserving attribution and
        history.
      </p>
      <div className="button-row">
        {options.map((option) => (
          <button
            key={option.status}
            type="button"
            className={
              option.status === "active" ? "button button-primary" : "button button-quiet"
            }
            disabled={
              busy !== null ||
              user.account_status === option.status ||
              (isSelf && option.status !== "active")
            }
            onClick={() => void change(option.status)}
          >
            {busy === option.status ? "Saving..." : option.label}
          </button>
        ))}
      </div>
      {isSelf ? (
        <p className="muted small">You cannot deactivate or suspend your own account.</p>
      ) : null}
      <ErrorPanel error={error} title="The account status was not changed" />
    </article>
  );
}

function RoleAssignmentsSection({
  user,
  canManage,
  activeMemberships,
  onChanged,
}: {
  user: UserDetail;
  canManage: boolean;
  activeMemberships: UserDetail["memberships"];
  onChanged: () => Promise<void>;
}) {
  const { api, has } = useAuth();
  const canViewRoles = has("role.view");
  const roles = useResource<Role[]>(canViewRoles ? "/roles" : null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function revoke(assignmentId: string) {
    setBusyId(assignmentId);
    setError(null);
    try {
      await api.post(`/role-assignments/${assignmentId}/revoke`, {
        reason: reason.trim(),
      });
      setRevokingId(null);
      setReason("");
      await onChanged();
    } catch (raw) {
      setError(toApiError(raw));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card section">
      <div className="toolbar">
        <h2>Role grants</h2>
        <button type="button" className="button button-quiet" onClick={() => void onChanged()}>
          Refresh
        </button>
      </div>

      <p className="muted small">
        Every grant records who assigned it and when. Revocation records a reason and preserves the
        assignment row. The schema has no separate audit table, so grant and revoke events are also
        written to structured API logs.
      </p>

      {canManage ? (
        <AssignRoleForm
          user={user}
          roles={roles.data}
          activeMemberships={activeMemberships}
          onAssigned={onChanged}
        />
      ) : null}

      <ErrorPanel error={error} title="The role change failed" />
      {canViewRoles ? <ErrorPanel error={roles.error} /> : null}

      {user.role_assignments.length === 0 ? (
        <EmptyState
          title="No role grants"
          description="Without a role grant this account can authenticate but cannot read authorised data."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Scope</th>
                <th>Status</th>
                <th>Assigned</th>
                <th>Expires</th>
                <th>Ended</th>
                {canManage ? <th aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {user.role_assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <td>
                    {assignment.role_name}
                    <div className="mono small muted">{assignment.role_code}</div>
                  </td>
                  <td>
                    <StatusBadge value={assignment.scope_type} />
                    {assignment.bureau_name ? (
                      <div className="muted small">{assignment.bureau_name}</div>
                    ) : null}
                  </td>
                  <td>
                    <StatusBadge value={assignment.assignment_status} />
                  </td>
                  <td>{formatDate(assignment.assigned_at)}</td>
                  <td>{formatDate(assignment.expires_at)}</td>
                  <td>
                    {formatDate(assignment.revoked_at)}
                    {assignment.revocation_reason ? (
                      <div className="muted small">{assignment.revocation_reason}</div>
                    ) : null}
                  </td>
                  {canManage ? (
                    <td className="row-actions">
                      {assignment.assignment_status !== "active" ? null : revokingId ===
                        assignment.id ? (
                        <div className="inline-form">
                          <input
                            required
                            minLength={3}
                            maxLength={500}
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder="Revocation reason"
                          />
                          <button
                            type="button"
                            className="button button-danger"
                            disabled={busyId === assignment.id || reason.trim().length < 3}
                            onClick={() => void revoke(assignment.id)}
                          >
                            {busyId === assignment.id ? "Revoking..." : "Confirm"}
                          </button>
                          <button
                            type="button"
                            className="button button-quiet"
                            onClick={() => {
                              setRevokingId(null);
                              setReason("");
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="button button-quiet"
                          onClick={() => {
                            setRevokingId(assignment.id);
                            setReason("");
                          }}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AssignRoleForm({
  user,
  roles,
  activeMemberships,
  onAssigned,
}: {
  user: UserDetail;
  roles: Role[] | null;
  activeMemberships: UserDetail["memberships"];
  onAssigned: () => Promise<void>;
}) {
  const { api } = useAuth();
  const [roleCode, setRoleCode] = useState("");
  const [bureauId, setBureauId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);

  const selectedRole = roles?.find((role) => role.code === roleCode) ?? null;
  const requiresBureau = selectedRole ? selectedRole.scope_type === "bureau" : Boolean(bureauId);
  const noMembership = requiresBureau && activeMemberships.length === 0;
  const disabled =
    busy ||
    user.account_status !== "active" ||
    roleCode.trim().length < 2 ||
    (selectedRole !== null && selectedRole.scope_type === "bureau" && !bureauId) ||
    noMembership;

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.post(`/users/${user.id}/role-assignments`, {
        role_code: roleCode.trim(),
        bureau_id: requiresBureau ? bureauId || null : null,
        expires_at: expiresAt ? new Date(`${expiresAt}T23:59:59Z`).toISOString() : null,
      });
      setRoleCode("");
      setBureauId("");
      setExpiresAt("");
      await onAssigned();
      setSaved(true);
    } catch (raw) {
      setError(toApiError(raw));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form form-row inset-form" onSubmit={assign}>
      <label className="grow">
        Role
        {roles ? (
          <select required value={roleCode} onChange={(event) => setRoleCode(event.target.value)}>
            <option value="">Select a role</option>
            {roles.map((role) => (
              <option key={role.id} value={role.code}>
                {role.name} ({role.code}) — {role.scope_type}
              </option>
            ))}
          </select>
        ) : (
          <input
            required
            minLength={2}
            maxLength={64}
            value={roleCode}
            onChange={(event) => setRoleCode(event.target.value.toUpperCase())}
            placeholder="ROLE_CODE"
            className="mono"
          />
        )}
      </label>
      <label>
        Bureau
        <select
          value={bureauId}
          onChange={(event) => setBureauId(event.target.value)}
          disabled={selectedRole?.scope_type === "global"}
        >
          <option value="">Not bureau-scoped</option>
          {activeMemberships.map((membership) => (
            <option key={membership.bureau_id} value={membership.bureau_id}>
              {membership.bureau_code} — {membership.bureau_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Expires
        <input
          type="date"
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
        />
      </label>
      <button type="submit" className="button button-primary" disabled={disabled}>
        {busy ? "Granting..." : "Grant role"}
      </button>
      <div className="span-full">
        {user.account_status !== "active" ? (
          <p className="muted small">Role grants require an active account.</p>
        ) : null}
        {noMembership ? (
          <p className="muted small">
            This user has no active bureau membership, so a bureau-scoped role cannot be granted.
          </p>
        ) : null}
        {saved ? <p className="success-text">Role granted.</p> : null}
        <ErrorPanel error={error} title="The role was not granted" />
      </div>
    </form>
  );
}

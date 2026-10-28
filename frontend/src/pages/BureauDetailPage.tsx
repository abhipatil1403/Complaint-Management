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
import { usePagedResource, useResource } from "../lib/useResource";
import type { Bureau, BureauMember, MembershipType, UserSummary } from "../types";
import { NotFoundPage } from "./NotFoundPage";

export function BureauDetailPage() {
  const { bureauId } = useParams<{ bureauId: string }>();
  if (!bureauId) {
    return <NotFoundPage />;
  }
  return <BureauDetailContent bureauId={bureauId} />;
}

function BureauDetailContent({ bureauId }: { bureauId: string }) {
  const { me, has } = useAuth();
  const bureau = useResource<Bureau>(`/bureaus/${bureauId}`);
  const canManage = has("bureau.manage");

  if (bureau.loading && !bureau.data) {
    return <Loading label="Loading bureau..." />;
  }

  if (bureau.error) {
    return (
      <div className="card">
        <ErrorPanel error={bureau.error} title="The bureau could not be loaded" />
        <Link className="button button-quiet" to="/bureaus">
          Back to bureaus
        </Link>
      </div>
    );
  }

  if (!bureau.data) {
    return <NotFoundPage />;
  }

  const data = bureau.data;
  const isActiveContext = me?.active_bureau_id === bureauId;
  const globalMembersView = me?.global_permissions.includes("bureau.members.view") ?? false;
  const canViewMembers = globalMembersView || (isActiveContext && has("bureau.members.view"));
  const canManageMembers =
    (me?.global_permissions.includes("bureau.members.manage") ?? false) ||
    (isActiveContext && has("bureau.members.manage"));

  return (
    <section>
      <PageHeader
        title={data.name}
        description={`${data.bureau_type} · code ${data.code}`}
        actions={
          <Link className="button button-quiet" to="/bureaus">
            Back to list
          </Link>
        }
      />

      <div className="badge-row">
        <StatusBadge value={data.is_active ? "active" : "inactive"} />
        {isActiveContext ? <span className="badge badge-active">active context</span> : null}
      </div>

      <div className="grid grid-2">
        <article className="card">
          <h2>Bureau detail</h2>
          <dl className="detail-list">
            <div>
              <dt>Code</dt>
              <dd className="mono">{data.code}</dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{data.name}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{data.bureau_type}</dd>
            </div>
            <div>
              <dt>Display order</dt>
              <dd>{data.display_order}</dd>
            </div>
            <div>
              <dt>Parent bureau</dt>
              <dd className="mono small">{data.parent_bureau_id ?? "—"}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(data.created_at)}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{formatDate(data.updated_at)}</dd>
            </div>
          </dl>
          <p className="muted">{data.description ?? "No description recorded."}</p>
        </article>

        <article className="card">
          <h2>What this scope means</h2>
          <ul className="check-list">
            <li>
              A bureau-scoped role grant only applies while this bureau is the active context in the
              header.
            </li>
            <li>
              Cross-bureau case-index visibility is separate from access to restricted case content.
            </li>
            <li>
              Membership changes end a membership with a timestamp; records are never deleted.
            </li>
          </ul>
          {!canViewMembers ? (
            <p className="muted small">
              The membership list is limited to this bureau's active context or to an
              organisation-wide membership capability.
            </p>
          ) : null}
        </article>
      </div>

      {canManage ? <BureauEditForm key={data.updated_at ?? data.id} bureau={data} /> : null}

      {canViewMembers ? (
        <BureauMembersSection bureauId={bureauId} canManage={canManageMembers} />
      ) : null}
    </section>
  );
}

function BureauEditForm({ bureau }: { bureau: Bureau }) {
  const { api } = useAuth();
  const parents = usePagedResource<Bureau>("/bureaus", { include_inactive: true });
  const [form, setForm] = useState({
    code: bureau.code,
    name: bureau.name,
    description: bureau.description ?? "",
    bureau_type: bureau.bureau_type,
    display_order: String(bureau.display_order),
    parent_bureau_id: bureau.parent_bureau_id ?? "",
    is_active: bureau.is_active,
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
      await api.patch<Bureau>(`/bureaus/${bureau.id}`, {
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        bureau_type: form.bureau_type,
        display_order: Number(form.display_order),
        parent_bureau_id: form.parent_bureau_id || null,
        is_active: form.is_active,
      });
      setSaved(true);
    } catch (raw) {
      setError(toApiError(raw));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Edit bureau</h2>
      <form className="form form-grid" onSubmit={save}>
        <label>
          Code
          <input
            required
            minLength={2}
            maxLength={32}
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value })}
          />
        </label>
        <label className="span-2">
          Name
          <input
            required
            maxLength={200}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <label>
          Type
          <select
            value={form.bureau_type}
            onChange={(event) =>
              setForm({ ...form, bureau_type: event.target.value as Bureau["bureau_type"] })
            }
          >
            <option value="bureau">Bureau</option>
            <option value="cell">Cell</option>
            <option value="division">Division</option>
            <option value="unit">Unit</option>
          </select>
        </label>
        <label>
          Display order
          <input
            type="number"
            min={0}
            max={1000}
            value={form.display_order}
            onChange={(event) => setForm({ ...form, display_order: event.target.value })}
          />
        </label>
        <label>
          Parent bureau
          <select
            value={form.parent_bureau_id}
            onChange={(event) => setForm({ ...form, parent_bureau_id: event.target.value })}
          >
            <option value="">None</option>
            {parents.items
              .filter((candidate) => candidate.id !== bureau.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.code} — {candidate.name}
                </option>
              ))}
          </select>
        </label>
        <label className="span-2">
          Description
          <input
            maxLength={1000}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </label>
        <label className="checkbox span-2">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
          />
          Active bureau
        </label>
        <div className="form-actions span-2">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? "Saving..." : "Save changes"}
          </button>
          {saved ? <span className="success-text">Saved.</span> : null}
        </div>
      </form>
      <ErrorPanel error={error} title="The bureau was not saved" />
    </div>
  );
}

function BureauMembersSection({
  bureauId,
  canManage,
}: {
  bureauId: string;
  canManage: boolean;
}) {
  const { api } = useAuth();
  const members = usePagedResource<BureauMember>(`/bureaus/${bureauId}/members`, {
    include_inactive: canManage ? true : undefined,
  });
  const [endingId, setEndingId] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function endMembership(membershipId: string) {
    setBusyId(membershipId);
    setError(null);
    try {
      await api.post<BureauMember>(`/bureau-memberships/${membershipId}/end`);
      setEndingId(null);
      await members.reload();
    } catch (raw) {
      setError(toApiError(raw));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card section">
      <div className="toolbar">
        <h2>Memberships</h2>
        <button
          type="button"
          className="button button-quiet"
          onClick={() => void members.reload()}
        >
          Refresh
        </button>
      </div>

      {canManage ? <MembershipForm bureauId={bureauId} onCreated={members.reload} /> : null}

      <ErrorPanel error={error} title="The membership change failed" />
      <ErrorPanel error={members.error} />

      {members.loading && members.items.length === 0 ? <Loading /> : null}
      {!members.loading && !members.error && members.items.length === 0 ? (
        <EmptyState title="No memberships recorded" />
      ) : null}

      {members.items.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Officer</th>
                <th>Email</th>
                <th>Membership</th>
                <th>Primary</th>
                <th>Status</th>
                <th>Joined</th>
                {canManage ? <th aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {members.items.map((member) => (
                <tr key={member.membership_id}>
                  <td>
                    {member.full_name}
                    {member.designation ? (
                      <div className="muted small">{member.designation}</div>
                    ) : null}
                  </td>
                  <td>{member.official_email}</td>
                  <td>{member.membership_type}</td>
                  <td>{member.is_primary ? "Yes" : "No"}</td>
                  <td>
                    <StatusBadge value={member.membership_status} />
                  </td>
                  <td>{formatDate(member.joined_at)}</td>
                  {canManage ? (
                    <td className="row-actions">
                      {member.membership_status !== "active" ? null : endingId ===
                        member.membership_id ? (
                        <>
                          <button
                            type="button"
                            className="button button-danger"
                            disabled={busyId === member.membership_id}
                            onClick={() => void endMembership(member.membership_id)}
                          >
                            {busyId === member.membership_id ? "Ending..." : "Confirm end"}
                          </button>
                          <button
                            type="button"
                            className="button button-quiet"
                            onClick={() => setEndingId(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="button button-quiet"
                          onClick={() => setEndingId(member.membership_id)}
                        >
                          End membership
                        </button>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {members.hasMore ? (
        <div className="pager">
          <button
            type="button"
            className="button button-quiet"
            onClick={() => void members.loadMore()}
            disabled={members.loading}
          >
            {members.loading ? "Loading..." : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MembershipForm({
  bureauId,
  onCreated,
}: {
  bureauId: string;
  onCreated: () => Promise<void>;
}) {
  const { api, has } = useAuth();
  const canListUsers = has("user.view");
  const users = usePagedResource<UserSummary>(
    "/users",
    { account_status: "active" },
    { enabled: canListUsers },
  );
  const [userId, setUserId] = useState("");
  const [membershipType, setMembershipType] = useState<MembershipType>("member");
  const [isPrimary, setIsPrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post<BureauMember>("/bureau-memberships", {
        user_id: userId,
        bureau_id: bureauId,
        membership_type: membershipType,
        is_primary: isPrimary,
      });
      setUserId("");
      setIsPrimary(false);
      await onCreated();
    } catch (raw) {
      setError(toApiError(raw));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form form-row inset-form" onSubmit={add}>
      <label className="grow">
        Officer
        {canListUsers ? (
          <select required value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">Select an active user</option>
            {users.items.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name} — {user.official_email}
              </option>
            ))}
          </select>
        ) : (
          <input
            required
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="User UUID"
            className="mono"
          />
        )}
      </label>
      <label>
        Membership
        <select
          value={membershipType}
          onChange={(event) => setMembershipType(event.target.value as MembershipType)}
        >
          <option value="member">Member</option>
          <option value="coordinator">Coordinator</option>
          <option value="head">Head</option>
        </select>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={isPrimary}
          onChange={(event) => setIsPrimary(event.target.checked)}
        />
        Primary
      </label>
      <button type="submit" className="button button-primary" disabled={busy}>
        {busy ? "Adding..." : "Add membership"}
      </button>
      <div className="span-full">
        <ErrorPanel error={error} title="The membership was not added" />
        {canListUsers ? <ErrorPanel error={users.error} /> : null}
      </div>
    </form>
  );
}

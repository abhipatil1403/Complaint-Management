import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from "../components/ui";
import { toApiError, type ApiError } from "../lib/api";
import { usePagedResource } from "../lib/useResource";
import type { Bureau } from "../types";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

export function BureausPage() {
  const { api, has } = useAuth();
  const navigate = useNavigate();
  const canManage = has("bureau.manage");
  const [includeInactive, setIncludeInactive] = useState(false);

  const bureaus = usePagedResource<Bureau>("/bureaus", {
    include_inactive: canManage && includeInactive ? true : undefined,
  });

  const [form, setForm] = useState({
    code: "",
    name: "",
    bureau_type: "bureau",
    display_order: "0",
    description: "",
    parent_bureau_id: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  if (!has("bureau.view")) {
    return <PermissionDeniedPage />;
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<Bureau>("/bureaus", {
        code: form.code.trim(),
        name: form.name.trim(),
        bureau_type: form.bureau_type,
        display_order: Number(form.display_order),
        description: form.description.trim() || null,
        parent_bureau_id: form.parent_bureau_id || null,
        is_active: true,
      });
      setForm({
        code: "",
        name: "",
        bureau_type: "bureau",
        display_order: "0",
        description: "",
        parent_bureau_id: "",
      });
      navigate(`/bureaus/${created.id}`);
    } catch (raw) {
      setError(toApiError(raw));
    } finally {
      setBusy(false);
    }
  }

  const nameById = new Map(bureaus.items.map((bureau) => [bureau.id, bureau.name]));

  return (
    <section>
      <PageHeader
        title="Bureaus"
        description="Organisational units used to scope case work. A bureau is deactivated rather than deleted."
        actions={
          <button
            type="button"
            className="button button-quiet"
            onClick={() => void bureaus.reload()}
          >
            Refresh
          </button>
        }
      />

      {canManage ? (
        <div className="card">
          <h2>Add a bureau</h2>
          <form className="form form-grid" onSubmit={create}>
            <label>
              Code
              <input
                required
                minLength={2}
                maxLength={32}
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
                placeholder="RB"
              />
            </label>
            <label className="span-2">
              Name
              <input
                required
                maxLength={200}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Regional Bureau"
              />
            </label>
            <label>
              Type
              <select
                value={form.bureau_type}
                onChange={(event) => setForm({ ...form, bureau_type: event.target.value })}
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
                {bureaus.items.map((bureau) => (
                  <option key={bureau.id} value={bureau.id}>
                    {bureau.code} — {bureau.name}
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
            <div className="form-actions span-2">
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? "Saving..." : "Create bureau"}
              </button>
            </div>
          </form>
          <ErrorPanel error={error} title="The bureau was not created" />
        </div>
      ) : null}

      <div className="card">
        <div className="toolbar">
          <h2>Bureau list</h2>
          {canManage ? (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(event) => setIncludeInactive(event.target.checked)}
              />
              Include inactive
            </label>
          ) : null}
        </div>

        <ErrorPanel error={bureaus.error} />
        {bureaus.loading && bureaus.items.length === 0 ? <Loading /> : null}
        {!bureaus.loading && !bureaus.error && bureaus.items.length === 0 ? (
          <EmptyState title="No bureaus found" />
        ) : null}

        {bureaus.items.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Parent</th>
                  <th>Order</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {bureaus.items.map((bureau) => (
                  <tr key={bureau.id}>
                    <td className="mono">{bureau.code}</td>
                    <td>
                      <Link to={`/bureaus/${bureau.id}`}>{bureau.name}</Link>
                    </td>
                    <td>{bureau.bureau_type}</td>
                    <td>
                      {bureau.parent_bureau_id
                        ? nameById.get(bureau.parent_bureau_id) ?? "—"
                        : "—"}
                    </td>
                    <td>{bureau.display_order}</td>
                    <td>
                      <StatusBadge value={bureau.is_active ? "active" : "inactive"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {bureaus.hasMore ? (
          <div className="pager">
            <button
              type="button"
              className="button button-quiet"
              onClick={() => void bureaus.loadMore()}
              disabled={bureaus.loading}
            >
              {bureaus.loading ? "Loading..." : "Load more"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

import { useState } from "react";
import type { FormEvent } from "react";

import { PermissionDeniedPage } from "./PermissionDeniedPage";
import { useAuth } from "../auth/AuthProvider";
import { EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from "../components/ui";
import { toApiError, type ApiError } from "../lib/api";
import { usePagedResource } from "../lib/useResource";
import type { Region } from "../types";

const EMPTY_FORM = { code: "", name: "", description: "" };

export function RegionsPage() {
  const { api, has } = useAuth();
  const canManage = has("region.manage");
  const [includeInactive, setIncludeInactive] = useState(false);
  const { items, loading, error, hasMore, reload, loadMore } = usePagedResource<Region>("/regions", {
    include_inactive: includeInactive ? true : undefined,
  });

  const [form, setForm] = useState(EMPTY_FORM);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  if (!has("region.view")) {
    return <PermissionDeniedPage />;
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await api.post<Region>("/regions", {
        code: form.code,
        name: form.name,
        description: form.description.trim() || null,
      });
      setForm(EMPTY_FORM);
      await reload();
    } catch (raw) {
      setActionError(toApiError(raw));
    } finally {
      setBusy(false);
    }
  }

  async function setActive(region: Region, isActive: boolean) {
    setActionError(null);
    try {
      await api.patch<Region>(`/regions/${region.id}`, { is_active: isActive });
      await reload();
    } catch (raw) {
      setActionError(toApiError(raw));
    }
  }

  return (
    <section>
      <PageHeader
        title="Regions"
        description="Reference data used to group institutions. Records are deactivated, never deleted."
        actions={
          <button type="button" className="button button-quiet" onClick={() => void reload()}>
            Refresh
          </button>
        }
      />

      {canManage ? (
        <div className="card">
          <h2>Add a region</h2>
          <form className="form form-row" onSubmit={create}>
            <label>
              Code
              <input
                required
                minLength={2}
                maxLength={32}
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
                placeholder="WEST"
              />
            </label>
            <label>
              Name
              <input
                required
                maxLength={200}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Western Region"
              />
            </label>
            <label className="grow">
              Description
              <input
                maxLength={1000}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </label>
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? "Saving..." : "Create region"}
            </button>
          </form>
        </div>
      ) : null}

      <ErrorPanel error={actionError} title="The change was not saved" />

      <div className="card">
        <div className="toolbar">
          <h2>Region list</h2>
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

        <ErrorPanel error={error} />
        {loading && items.length === 0 ? <Loading /> : null}
        {!loading && !error && items.length === 0 ? (
          <EmptyState title="No regions found" />
        ) : null}

        {items.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Status</th>
                  {canManage ? <th aria-label="Actions" /> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((region) => (
                  <tr key={region.id}>
                    <td className="mono">{region.code}</td>
                    <td>{region.name}</td>
                    <td className="muted">{region.description ?? "—"}</td>
                    <td>
                      <StatusBadge value={region.is_active ? "active" : "inactive"} />
                    </td>
                    {canManage ? (
                      <td className="row-actions">
                        <button
                          type="button"
                          className="button button-quiet"
                          onClick={() => void setActive(region, !region.is_active)}
                        >
                          {region.is_active ? "Deactivate" : "Reactivate"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {hasMore ? (
          <div className="pager">
            <button
              type="button"
              className="button button-quiet"
              onClick={() => void loadMore()}
              disabled={loading}
            >
              {loading ? "Loading..." : "Load more"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

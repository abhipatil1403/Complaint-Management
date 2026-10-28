import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from "../components/ui";
import { toApiError, type ApiError } from "../lib/api";
import { usePagedResource } from "../lib/useResource";
import type { InstitutionDetail, InstitutionSummary, Region } from "../types";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

interface InstitutionForm {
  official_name: string;
  aicte_permanent_id: string;
  institution_type: string;
  ownership_type: string;
  city: string;
  state_name: string;
  region_id: string;
  contact_email: string;
  verification_status: "pending" | "verified";
  verification_source: string;
}

const EMPTY_FORM: InstitutionForm = {
  official_name: "",
  aicte_permanent_id: "",
  institution_type: "",
  ownership_type: "",
  city: "",
  state_name: "",
  region_id: "",
  contact_email: "",
  verification_status: "pending",
  verification_source: "",
};

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function InstitutionsPage() {
  const { api, has } = useAuth();
  const navigate = useNavigate();
  const canManage = has("institution.manage");

  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [regionId, setRegionId] = useState("");
  const [verificationStatus, setVerificationStatus] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);

  const regions = usePagedResource<Region>("/regions");
  const institutions = usePagedResource<InstitutionSummary>("/institutions", {
    q: query || undefined,
    region_id: regionId || undefined,
    verification_status: verificationStatus || undefined,
    is_active: includeInactive ? undefined : true,
  });

  const [form, setForm] = useState<InstitutionForm>(EMPTY_FORM);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  if (!has("institution.view")) {
    return <PermissionDeniedPage />;
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      const created = await api.post<InstitutionDetail>("/institutions", {
        official_name: form.official_name.trim(),
        aicte_permanent_id: nullable(form.aicte_permanent_id),
        institution_type: nullable(form.institution_type),
        ownership_type: nullable(form.ownership_type),
        city: nullable(form.city),
        state_name: nullable(form.state_name),
        region_id: form.region_id || null,
        contact_email: nullable(form.contact_email),
        verification_status: form.verification_status,
        verification_source: nullable(form.verification_source),
        is_active: true,
      });
      setForm(EMPTY_FORM);
      navigate(`/institutions/${created.id}`);
    } catch (raw) {
      setActionError(toApiError(raw));
    } finally {
      setBusy(false);
    }
  }

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(searchDraft.trim());
  }

  return (
    <section>
      <PageHeader
        title="Institutions"
        description="Institution master data, permanent identifiers and verification state. Records are never hard-deleted."
        actions={
          <button
            type="button"
            className="button button-quiet"
            onClick={() => void institutions.reload()}
          >
            Refresh
          </button>
        }
      />

      {canManage ? (
        <div className="card">
          <h2>Add an institution</h2>
          <p className="muted small">
            A normal canonical case is only created after an institution is verified. Creating a
            record here does not verify it.
          </p>
          <form className="form form-grid" onSubmit={create}>
            <label className="span-2">
              Official name
              <input
                required
                minLength={2}
                maxLength={300}
                value={form.official_name}
                onChange={(event) => setForm({ ...form, official_name: event.target.value })}
                placeholder="Example Institute of Technology"
              />
            </label>
            <label>
              AICTE Permanent ID
              <input
                maxLength={64}
                value={form.aicte_permanent_id}
                onChange={(event) => setForm({ ...form, aicte_permanent_id: event.target.value })}
                placeholder="1-12345678"
              />
            </label>
            <label>
              Institution type
              <input
                maxLength={80}
                value={form.institution_type}
                onChange={(event) => setForm({ ...form, institution_type: event.target.value })}
                placeholder="Engineering"
              />
            </label>
            <label>
              Ownership type
              <input
                maxLength={80}
                value={form.ownership_type}
                onChange={(event) => setForm({ ...form, ownership_type: event.target.value })}
                placeholder="Private unaided"
              />
            </label>
            <label>
              Region
              <select
                value={form.region_id}
                onChange={(event) => setForm({ ...form, region_id: event.target.value })}
              >
                <option value="">Unassigned</option>
                {regions.items.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.code} — {region.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              City
              <input
                maxLength={120}
                value={form.city}
                onChange={(event) => setForm({ ...form, city: event.target.value })}
              />
            </label>
            <label>
              State
              <input
                maxLength={120}
                value={form.state_name}
                onChange={(event) => setForm({ ...form, state_name: event.target.value })}
              />
            </label>
            <label>
              Contact email
              <input
                type="email"
                maxLength={254}
                value={form.contact_email}
                onChange={(event) => setForm({ ...form, contact_email: event.target.value })}
              />
            </label>
            <label>
              Verification state
              <select
                value={form.verification_status}
                onChange={(event) =>
                  setForm({
                    ...form,
                    verification_status: event.target.value as "pending" | "verified",
                  })
                }
              >
                <option value="pending">Pending verification</option>
                <option value="verified">Verified with evidence</option>
              </select>
            </label>
            {form.verification_status === "verified" ? (
              <label className="span-2">
                Verification source
                <input
                  required
                  maxLength={200}
                  value={form.verification_source}
                  onChange={(event) =>
                    setForm({ ...form, verification_source: event.target.value })
                  }
                  placeholder="AICTE approved-institution record, accessed 2026-10-28"
                />
              </label>
            ) : null}
            <div className="form-actions span-2">
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? "Saving..." : "Create institution"}
              </button>
            </div>
          </form>
          <ErrorPanel error={actionError} title="The institution was not created" />
        </div>
      ) : null}

      <div className="card">
        <form className="toolbar toolbar-wrap" onSubmit={applySearch}>
          <label className="grow">
            Search
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Name or AICTE Permanent ID"
              maxLength={120}
            />
          </label>
          <label>
            Region
            <select value={regionId} onChange={(event) => setRegionId(event.target.value)}>
              <option value="">All regions</option>
              {regions.items.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Verification
            <select
              value={verificationStatus}
              onChange={(event) => setVerificationStatus(event.target.value)}
            >
              <option value="">Any state</option>
              <option value="pending">Pending</option>
              <option value="verified">Verified</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.target.checked)}
            />
            Include inactive
          </label>
          <button type="submit" className="button">
            Search
          </button>
          {query ? (
            <button
              type="button"
              className="button button-quiet"
              onClick={() => {
                setSearchDraft("");
                setQuery("");
              }}
            >
              Clear
            </button>
          ) : null}
        </form>

        <ErrorPanel error={institutions.error} />
        {institutions.loading && institutions.items.length === 0 ? <Loading /> : null}
        {!institutions.loading && !institutions.error && institutions.items.length === 0 ? (
          <EmptyState
            title="No institutions match"
            description="Adjust the search or region filter. Inactive records are hidden by default."
          />
        ) : null}

        {institutions.items.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Official name</th>
                  <th>AICTE Permanent ID</th>
                  <th>Region</th>
                  <th>Verification</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {institutions.items.map((institution) => (
                  <tr key={institution.id}>
                    <td>
                      <Link to={`/institutions/${institution.id}`}>{institution.official_name}</Link>
                    </td>
                    <td className="mono">{institution.aicte_permanent_id ?? "—"}</td>
                    <td>{institution.region ? `${institution.region.code}` : "—"}</td>
                    <td>
                      <StatusBadge value={institution.verification_status} />
                    </td>
                    <td>
                      <StatusBadge value={institution.is_active ? "active" : "inactive"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {institutions.hasMore ? (
          <div className="pager">
            <button
              type="button"
              className="button button-quiet"
              onClick={() => void institutions.loadMore()}
              disabled={institutions.loading}
            >
              {institutions.loading ? "Loading..." : "Load more"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

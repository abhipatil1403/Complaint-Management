import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { IconAlertTriangle } from "../components/Icons";
import {
  EmptyState,
  ErrorPanel,
  Loading,
  PageHeader,
  StatusBadge,
  formatDate,
} from "../components/ui";
import { caseStatusLabel, severityLabel } from "../lib/cases";
import { useSimulation, isResolved } from "../simulation/selectors";
import type { SimCase } from "../simulation/types";
import { toApiError, type ApiError } from "../lib/api";
import { usePagedResource, useResource } from "../lib/useResource";
import type {
  Alias,
  InstitutionDetail,
  Region,
  VerificationStatus,
} from "../types";
import { NotFoundPage } from "./NotFoundPage";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function InstitutionDetailPage() {
  const { has } = useAuth();
  const { institutionId } = useParams<{ institutionId: string }>();
  if (!has("institution.view")) {
    return <PermissionDeniedPage />;
  }
  if (!institutionId) {
    return <NotFoundPage />;
  }
  return <InstitutionDetailContent key={institutionId} institutionId={institutionId} />;
}

function InstitutionDetailContent({ institutionId }: { institutionId: string }) {
  const { has } = useAuth();
  const institution = useResource<InstitutionDetail>(`/institutions/${institutionId}`);
  const regions = usePagedResource<Region>("/regions");

  if (institution.loading && !institution.data) {
    return <Loading label="Loading institution..." />;
  }

  if (institution.error) {
    return (
      <div className="card">
        <ErrorPanel error={institution.error} title="The institution could not be loaded" />
        <Link className="button button-quiet" to="/institutions">
          Back to institutions
        </Link>
      </div>
    );
  }

  if (!institution.data) {
    return <NotFoundPage />;
  }

  const data = institution.data;
  const simState = useSimulation();
  const institutionCases = simState.cases.filter(
    (c) =>
      c.institution_id === institutionId ||
      (Boolean(data.aicte_permanent_id) && c.institution_code === data.aicte_permanent_id) ||
      c.institution_name.toLowerCase().trim() === data.official_name.toLowerCase().trim(),
  );

  return (
    <section>
      <PageHeader
        title={data.official_name}
        description={
          data.aicte_permanent_id
            ? `AICTE Permanent ID ${data.aicte_permanent_id}`
            : "No AICTE Permanent ID recorded"
        }
        actions={
          <Link className="button button-quiet" to="/institutions">
            Back to list
          </Link>
        }
      />

      <div className="badge-row">
        <StatusBadge value={data.verification_status} />
        <StatusBadge value={data.is_active ? "active" : "inactive"} />
        {data.region ? <span className="badge badge-neutral">{data.region.code}</span> : null}
      </div>

      <div className="grid grid-2">
        <article className="card">
          <h2>Master data</h2>
          <dl className="detail-list">
            <div>
              <dt>Region</dt>
              <dd>{data.region ? `${data.region.code} — ${data.region.name}` : "—"}</dd>
            </div>
            <div>
              <dt>Institution type</dt>
              <dd>{data.institution_type ?? "—"}</dd>
            </div>
            <div>
              <dt>Ownership</dt>
              <dd>{data.ownership_type ?? "—"}</dd>
            </div>
            <div>
              <dt>City</dt>
              <dd>{data.city ?? "—"}</dd>
            </div>
            <div>
              <dt>District</dt>
              <dd>{data.district ?? "—"}</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{data.state_name ?? "—"}</dd>
            </div>
            <div>
              <dt>Postal code</dt>
              <dd>{data.postal_code ?? "—"}</dd>
            </div>
            <div>
              <dt>Contact email</dt>
              <dd>{data.contact_email ?? "—"}</dd>
            </div>
            <div>
              <dt>Contact phone</dt>
              <dd>{data.contact_phone ?? "—"}</dd>
            </div>
            <div>
              <dt>Website</dt>
              <dd>
                {data.website_url ? (
                  <a href={data.website_url} rel="noreferrer noopener" target="_blank">
                    {data.website_url}
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
        </article>

        <article className="card">
          <h2>Verification evidence</h2>
          <dl className="detail-list">
            <div>
              <dt>Status</dt>
              <dd>
                <StatusBadge value={data.verification_status} />
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{data.verification_source ?? "—"}</dd>
            </div>
            <div>
              <dt>Reference</dt>
              <dd>{data.verification_reference ?? "—"}</dd>
            </div>
            <div>
              <dt>Verified at</dt>
              <dd>{formatDate(data.verified_at)}</dd>
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
          <p className="muted small">
            Verification requires an AICTE Permanent ID and a recorded source. The API rejects a
            verification transition that lacks either.
          </p>
        </article>
      </div>

      {has("institution.manage") ? (
        <InstitutionEditForm
          key={data.id}
          institution={data}
          regions={regions.items}
          onSaved={institution.reload}
        />
      ) : null}

      {/* Centralized Institution Profile: Consolidated Complaint & Case History (Problem Statement 26264) */}
      <InstitutionCaseHistorySection
        cases={institutionCases}
        institutionName={data.official_name}
      />

      <AliasSection institutionId={institutionId} />
    </section>
  );
}

function InstitutionCaseHistorySection({
  cases,
  institutionName,
}: {
  cases: SimCase[];
  institutionName: string;
}) {
  const activeCount = cases.filter((c) => !isResolved(c)).length;
  const resolvedCount = cases.filter(isResolved).length;

  // Detect cross-bureau overlap for this institution
  const activeBureaus = [
    ...new Set(
      cases
        .filter((c) => !isResolved(c))
        .map((c) => `${c.lead_bureau_name} (${c.lead_bureau_code})`),
    ),
  ];
  const hasCrossBureauOverlap = activeBureaus.length > 1;

  return (
    <div className="card" style={{ marginTop: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>
            Consolidated Grievance &amp; Regulatory History
          </h2>
          <p className="small muted" style={{ margin: "0.25rem 0 0" }}>
            Cross-bureau record of all complaints, inquiries, and regulatory actions associated with {institutionName}.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <span className="badge badge-neutral">Total: {cases.length}</span>
          <span className="badge badge-warning">Active: {activeCount}</span>
          <span className="badge badge-success">Disposed: {resolvedCount}</span>
        </div>
      </div>

      {hasCrossBureauOverlap && (
        <div
          style={{
            background: "#fffbeb",
            border: "1.5px solid #d97706",
            borderRadius: "var(--radius-lg)",
            padding: "0.85rem 1rem",
            marginBottom: "1.25rem",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              background: "#fef3c7",
              border: "1px solid #f59e0b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <IconAlertTriangle className="w-4 h-4" style={{ color: "#d97706" }} />
          </div>
          <div>
            <strong style={{ color: "#92400e", fontSize: "0.92rem", display: "block" }}>
              Potential Overlapping Cases – Coordination Required
            </strong>
            <span style={{ color: "#78350f", fontSize: "0.82rem" }}>
              Active parallel inquiries are currently open across multiple Bureaus/Cells ({activeBureaus.join(", ")}).
              Inter-bureau synchronization is active to avoid duplicate notices.
            </span>
          </div>
        </div>
      )}

      {cases.length === 0 ? (
        <EmptyState
          title="No complaints or regulatory cases recorded"
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Case Number</th>
                <th>Title / Issue</th>
                <th>Category</th>
                <th>Lead Bureau / Cell</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Assigned Officer</th>
                <th>Date Received</th>
                <th>Target Disposal</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const leadOfficer = c.officer_assignments.find(
                  (o) => o.status === "active",
                );
                return (
                  <tr key={c.case_id}>
                    <td>
                      <Link
                        to={`/cases/${c.case_id}`}
                        style={{
                          fontWeight: 700,
                          color: "#155a37",
                          textDecoration: "underline",
                        }}
                      >
                        {c.case_number}
                      </Link>
                    </td>
                    <td>
                      <strong style={{ fontSize: "0.88rem", display: "block" }}>
                        {c.title}
                      </strong>
                    </td>
                    <td>
                      <span className="small muted">{c.category_name}</span>
                    </td>
                    <td>
                      <span className="badge badge-neutral" style={{ fontSize: "0.74rem" }}>
                        {c.lead_bureau_code}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-neutral" style={{ fontSize: "0.74rem" }}>
                        {caseStatusLabel(c.status)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-priority-${c.priority}`} style={{ fontSize: "0.74rem" }}>
                        {severityLabel(c.priority)}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: "0.82rem" }}>
                        {leadOfficer?.officer_name || "Unassigned"}
                      </span>
                    </td>
                    <td className="small muted">{formatDate(c.opened_at)}</td>
                    <td className="small muted">{formatDate(c.target_resolution_date)}</td>
                    <td>
                      <Link
                        to={`/cases/${c.case_id}`}
                        className="button button-quiet"
                        style={{ fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface EditFormState {
  official_name: string;
  aicte_permanent_id: string;
  institution_type: string;
  ownership_type: string;
  city: string;
  state_name: string;
  region_id: string;
  contact_email: string;
  website_url: string;
  is_active: boolean;
  verification_status: VerificationStatus;
  verification_source: string;
}

function toEditForm(institution: InstitutionDetail): EditFormState {
  return {
    official_name: institution.official_name,
    aicte_permanent_id: institution.aicte_permanent_id ?? "",
    institution_type: institution.institution_type ?? "",
    ownership_type: institution.ownership_type ?? "",
    city: institution.city ?? "",
    state_name: institution.state_name ?? "",
    region_id: institution.region?.id ?? "",
    contact_email: institution.contact_email ?? "",
    website_url: institution.website_url ?? "",
    is_active: institution.is_active,
    verification_status: institution.verification_status,
    verification_source: institution.verification_source ?? "",
  };
}

function InstitutionEditForm({
  institution,
  regions,
  onSaved,
}: {
  institution: InstitutionDetail;
  regions: Region[];
  onSaved: () => Promise<void>;
}) {
  const { api } = useAuth();
  const [form, setForm] = useState<EditFormState>(() => toEditForm(institution));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);

  const alreadyDecided = institution.verification_status !== "pending";
  const verified = institution.verification_status === "verified";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);

    const payload: Record<string, unknown> = {
      official_name: form.official_name.trim(),
      institution_type: nullable(form.institution_type),
      ownership_type: nullable(form.ownership_type),
      city: nullable(form.city),
      state_name: nullable(form.state_name),
      region_id: form.region_id || null,
      contact_email: nullable(form.contact_email),
      website_url: nullable(form.website_url),
      is_active: form.is_active,
    };

    if (!verified) {
      payload.aicte_permanent_id = nullable(form.aicte_permanent_id);
      payload.verification_source = nullable(form.verification_source);
    }

    if (!alreadyDecided && form.verification_status !== "pending") {
      payload.verification_status = form.verification_status;
    }

    try {
      await api.patch<InstitutionDetail>(`/institutions/${institution.id}`, payload);
      await onSaved();
      setSaved(true);
    } catch (raw) {
      setError(toApiError(raw));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Edit master data</h2>
      <form className="form form-grid" onSubmit={save}>
        <label className="span-2">
          Official name
          <input
            required
            minLength={2}
            maxLength={300}
            value={form.official_name}
            onChange={(event) => setForm({ ...form, official_name: event.target.value })}
          />
        </label>
        <label>
          AICTE Permanent ID
          <input
            maxLength={64}
            value={form.aicte_permanent_id}
            onChange={(event) => setForm({ ...form, aicte_permanent_id: event.target.value })}
            disabled={verified}
          />
        </label>
        <label>
          Institution type
          <input
            maxLength={80}
            value={form.institution_type}
            onChange={(event) => setForm({ ...form, institution_type: event.target.value })}
          />
        </label>
        <label>
          Ownership type
          <input
            maxLength={80}
            value={form.ownership_type}
            onChange={(event) => setForm({ ...form, ownership_type: event.target.value })}
          />
        </label>
        <label>
          Region
          <select
            value={form.region_id}
            onChange={(event) => setForm({ ...form, region_id: event.target.value })}
          >
            <option value="">Unassigned</option>
            {regions.map((region) => (
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
          Website
          <input
            maxLength={500}
            value={form.website_url}
            onChange={(event) => setForm({ ...form, website_url: event.target.value })}
          />
        </label>

        {alreadyDecided ? (
          <div className="span-2 callout">
            <strong>Verification is final for this record.</strong>
            <p className="muted small">
              This institution is already {institution.verification_status}. A later phase needs an
              approved re-verification workflow; this build does not invent one.
            </p>
          </div>
        ) : (
          <label>
            Verification decision
            <select
              value={form.verification_status}
              onChange={(event) =>
                setForm({
                  ...form,
                  verification_status: event.target.value as VerificationStatus,
                })
              }
            >
              <option value="pending">Keep pending</option>
              <option value="verified">Mark verified</option>
              <option value="rejected">Mark rejected</option>
            </select>
          </label>
        )}

        {!verified ? (
          <label>
            Verification source
            <input
              maxLength={200}
              value={form.verification_source}
              onChange={(event) =>
                setForm({ ...form, verification_source: event.target.value })
              }
              placeholder="Recorded evidence for a verification decision"
            />
          </label>
        ) : null}

        <label className="checkbox span-2">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
          />
          Active institution record
        </label>

        <div className="form-actions span-2">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? "Saving..." : "Save changes"}
          </button>
          {saved ? <span className="success-text">Saved.</span> : null}
        </div>
      </form>
      <ErrorPanel error={error} title="The change was not saved" />
    </div>
  );
}

function AliasSection({ institutionId }: { institutionId: string }) {
  const { api, has } = useAuth();
  const canManage = has("institution.alias.manage");
  const aliases = usePagedResource<Alias>("/institution-aliases", {
    institution_id: institutionId,
    include_inactive: canManage ? true : undefined,
  });

  const [form, setForm] = useState({
    alias_name: "",
    alias_type: "alternate_name",
    source_type: "manual",
    source_reference: "",
    language_code: "en",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post<Alias>(`/institutions/${institutionId}/aliases`, {
        alias_name: form.alias_name.trim(),
        alias_type: form.alias_type,
        source_type: form.source_type,
        source_reference: nullable(form.source_reference),
        language_code: form.language_code.trim() || "en",
      });
      setForm({
        alias_name: "",
        alias_type: "alternate_name",
        source_type: "manual",
        source_reference: "",
        language_code: "en",
      });
      await aliases.reload();
    } catch (raw) {
      setError(toApiError(raw));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="section">
      <div className="card">
        <h2>Institution names and aliases</h2>
        <p className="muted small">
          Original submission text is preserved. Aliases support duplicate review without silently
          merging institutions.
        </p>

        {canManage ? (
          <form className="form form-grid" onSubmit={create}>
            <label>
              Alias name
              <input
                required
                maxLength={300}
                value={form.alias_name}
                onChange={(event) => setForm({ ...form, alias_name: event.target.value })}
              />
            </label>
            <label>
              Alias type
              <select
                value={form.alias_type}
                onChange={(event) => setForm({ ...form, alias_type: event.target.value })}
              >
                <option value="alternate_name">Alternate name</option>
                <option value="former_name">Former name</option>
                <option value="abbreviation">Abbreviation</option>
                <option value="spelling_variant">Spelling variant</option>
                <option value="submitted_name">Submitted name</option>
              </select>
            </label>
            <label>
              Source type
              <select
                value={form.source_type}
                onChange={(event) => setForm({ ...form, source_type: event.target.value })}
              >
                <option value="manual">Manual</option>
                <option value="official_record">Official record</option>
                <option value="complaint_submission">Complaint submission</option>
                <option value="import">Import</option>
              </select>
            </label>
            <label>
              Source reference
              <input
                required={form.source_type !== "manual"}
                maxLength={300}
                value={form.source_reference}
                onChange={(event) => setForm({ ...form, source_reference: event.target.value })}
                placeholder={
                  form.source_type === "manual"
                    ? "Optional for manual entries"
                    : "Required for this provenance"
                }
              />
            </label>
            <label>
              Language code
              <input
                maxLength={10}
                value={form.language_code}
                onChange={(event) => setForm({ ...form, language_code: event.target.value })}
              />
            </label>
            <div className="form-actions">
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? "Saving..." : "Add alias"}
              </button>
            </div>
          </form>
        ) : null}

        <ErrorPanel error={error} title="The alias was not added" />
        <ErrorPanel error={aliases.error} />

        {aliases.loading && aliases.items.length === 0 ? <Loading /> : null}
        {!aliases.loading && !aliases.error && aliases.items.length === 0 ? (
          <EmptyState title="No aliases recorded" />
        ) : null}

        {aliases.items.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Alias</th>
                  <th>Normalized</th>
                  <th>Type</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {aliases.items.map((alias) => (
                  <tr key={alias.id}>
                    <td>{alias.alias_name}</td>
                    <td className="mono small">{alias.normalized_alias}</td>
                    <td>{alias.alias_type.replace(/_/g, " ")}</td>
                    <td>
                      <span>{alias.source_type.replace(/_/g, " ")}</span>
                      {alias.source_reference ? (
                        <div className="muted small">{alias.source_reference}</div>
                      ) : null}
                    </td>
                    <td>
                      <StatusBadge value={alias.verification_status} />
                    </td>
                    <td>{formatDate(alias.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {aliases.hasMore ? (
          <div className="pager">
            <button
              type="button"
              className="button button-quiet"
              onClick={() => void aliases.loadMore()}
              disabled={aliases.loading}
            >
              {aliases.loading ? "Loading..." : "Load more"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

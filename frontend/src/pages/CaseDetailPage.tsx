import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { EmptyState, Loading, PageHeader, StatusBadge } from "../components/ui";
import { formatDateTime } from "../lib/intake";
import { useResource } from "../lib/useResource";
import {
  caseStatusLabel,
  formatFileSize,
  severityLabel,
  VALID_STATUS_TRANSITIONS,
} from "../lib/cases";
import type {
  CaseAttachmentItem,
  CaseDetail,
  CaseNoteItem,
  CaseAccessGrantItem,
  Bureau,
  BureauMember,
} from "../types";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

type ActiveTab = "overview" | "assignments" | "timeline" | "notes" | "attachments" | "transfers" | "access";

export function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const { has, api } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");

  // Primary resource
  const { data: caseItem, loading, error, reload } = useResource<CaseDetail>(
    (has("case.view_index") || has("case.view_detail")) && caseId ? `/cases/${caseId}` : null,
  );

  // Sub-resources (loaded when tabs are active)
  const { data: notes, reload: reloadNotes } = useResource<CaseNoteItem[]>(
    has("case.note.view") && caseId && activeTab === "notes" ? `/cases/${caseId}/notes` : null,
  );

  const { data: attachments, reload: reloadAttachments } = useResource<CaseAttachmentItem[]>(
    has("attachment.view") && caseId && activeTab === "attachments" ? `/cases/${caseId}/attachments` : null,
  );

  const { data: accessGrants, reload: reloadGrants } = useResource<CaseAccessGrantItem[]>(
    has("case.access.manage") && caseId && activeTab === "access" ? `/cases/${caseId}/access-grants` : null,
  );

  const { data: bureaus } = useResource<Bureau[]>(
    has("bureau.view") ? "/bureaus" : null,
  );

  // Modal States
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<"shared" | "bureau_private">("shared");
  const [noteType, setNoteType] = useState<"general" | "internal_review" | "resolution" | "handover">("general");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const [showAssignBureauModal, setShowAssignBureauModal] = useState(false);
  const [selectedBureauId, setSelectedBureauId] = useState("");
  const [assignType, setAssignType] = useState<"lead" | "collaborating">("collaborating");
  const [assignReason, setAssignReason] = useState("");
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const [showAssignOfficerModal, setShowAssignOfficerModal] = useState(false);
  const [targetBureauAssignId, setTargetBureauAssignId] = useState("");
  const [targetBureauId, setTargetBureauId] = useState("");
  const [officerUserId, setOfficerUserId] = useState("");
  const [officerRole, setOfficerRole] = useState<"lead_officer" | "supporting" | "reviewer">("supporting");
  const [officerNotes, setOfficerNotes] = useState("");
  const [officerSubmitting, setOfficerSubmitting] = useState(false);
  const [officerError, setOfficerError] = useState<string | null>(null);

  const { data: bureauMembers } = useResource<BureauMember[]>(
    targetBureauId ? `/bureaus/${targetBureauId}/members` : null,
  );

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferFromAssignId, setTransferFromAssignId] = useState("");
  const [transferToBureauId, setTransferToBureauId] = useState("");
  const [transferType, setTransferType] = useState<"handover" | "lead_change" | "reassignment">("handover");
  const [transferReason, setTransferReason] = useState("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  const [showAccessModal, setShowAccessModal] = useState(false);
  const [accessLevel, setAccessLevel] = useState<"details" | "collaborate">("details");
  const [accessReason, setAccessReason] = useState("");
  const [accessSubmitting, setAccessSubmitting] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  const [showAttachmentModal, setShowAttachmentModal] = useState(false);
  const [attachFilename, setAttachFilename] = useState("");
  const [attachType, setAttachType] = useState("supporting_document");
  const [attachDescription, setAttachDescription] = useState("");
  const [attachSubmitting, setAttachSubmitting] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  if (!has("case.view_index") && !has("case.view_detail")) {
    return <PermissionDeniedPage />;
  }

  if (loading) {
    return <Loading label="Loading canonical case details..." />;
  }

  if (error || !caseItem) {
    return (
      <section>
        <PageHeader
          title="Case Access Control"
          actions={
            <Link to="/cases" className="button button-quiet">
              Back to Cases
            </Link>
          }
        />
        <div className="card">
          <div className="callout callout-warning">
            <h3>Restricted Case Content</h3>
            <p>
              Under AICTE Least-Privilege & Cross-Bureau Privacy Policy, complete complaint details, internal notes, and attachments are restricted to members of the assigned bureaus or holders of active access grants.
            </p>
            <p style={{ marginTop: "1rem" }}>
              If you require access to this case for cross-bureau coordination, you can submit an access request below.
            </p>
            {has("case.access.request") && (
              <button
                type="button"
                className="button button-primary"
                style={{ marginTop: "1rem" }}
                onClick={() => setShowAccessModal(true)}
              >
                Request Cross-Bureau Access
              </button>
            )}
          </div>
        </div>

        {/* Access Request Modal */}
        {showAccessModal && (
          <div style={modalBackdropStyle}>
            <div className="card" style={modalCardStyle}>
              <h3>Request Case Access</h3>
              <p className="hint">
                Submit an auditable request to view or collaborate on Case #{caseId?.slice(0, 8)}.
              </p>
              {accessError && <div className="callout callout-danger" style={{ marginBottom: "1rem" }}>{accessError}</div>}
              <form onSubmit={async (e) => {
                e.preventDefault();
                setAccessSubmitting(true);
                setAccessError(null);
                try {
                  await api.post(`/cases/${caseId}/access-requests`, {
                    access_level: accessLevel,
                    reason: accessReason.trim(),
                  });
                  setShowAccessModal(false);
                  setAccessReason("");
                  alert("Access request submitted successfully.");
                } catch (err: any) {
                  setAccessError(err?.message || "Failed to submit access request.");
                } finally {
                  setAccessSubmitting(false);
                }
              }}>
                <label>
                  Requested Scope
                  <select value={accessLevel} onChange={(e) => setAccessLevel(e.target.value as any)}>
                    <option value="details">Full Case Details (Read-only)</option>
                    <option value="collaborate">Collaborate (Add notes & evidence)</option>
                  </select>
                </label>
                <label>
                  Official Justification
                  <textarea
                    rows={4}
                    required
                    placeholder="Explain why your bureau requires access to this case..."
                    value={accessReason}
                    onChange={(e) => setAccessReason(e.target.value)}
                  />
                </label>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                  <button type="button" className="button button-quiet" onClick={() => setShowAccessModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="button button-primary" disabled={accessSubmitting}>
                    {accessSubmitting ? "Submitting..." : "Submit Request"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </section>
    );
  }

  // Permitted next status transitions
  const permittedStatuses = VALID_STATUS_TRANSITIONS[caseItem.status] ?? [];

  const handleStatusTransition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStatus) return;
    setStatusSubmitting(true);
    setStatusError(null);
    try {
      await api.post(`/cases/${caseItem.case_id}/status-transitions`, {
        to_status: newStatus,
        reason: statusReason.trim(),
        expected_updated_at: caseItem.updated_at,
      });
      setShowStatusModal(false);
      setNewStatus("");
      setStatusReason("");
      await reload();
    } catch (err: any) {
      setStatusError(err?.message || "Failed to transition status.");
    } finally {
      setStatusSubmitting(false);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    setNoteSubmitting(true);
    setNoteError(null);
    try {
      await api.post(`/cases/${caseItem.case_id}/notes`, {
        note_text: noteText.trim(),
        visibility: noteVisibility,
        note_type: noteType,
        bureau_id: noteVisibility === "bureau_private" ? caseItem.lead_bureau_id : null,
      });
      setShowNoteModal(false);
      setNoteText("");
      await reloadNotes();
      await reload();
    } catch (err: any) {
      setNoteError(err?.message || "Failed to create note.");
    } finally {
      setNoteSubmitting(false);
    }
  };

  const handleAssignBureau = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBureauId) return;
    setAssignSubmitting(true);
    setAssignError(null);
    try {
      await api.post(`/cases/${caseItem.case_id}/bureau-assignments`, {
        bureau_id: selectedBureauId,
        assignment_type: assignType,
        reason: assignReason.trim() || undefined,
      });
      setShowAssignBureauModal(false);
      setSelectedBureauId("");
      setAssignReason("");
      await reload();
    } catch (err: any) {
      setAssignError(err?.message || "Failed to assign bureau.");
    } finally {
      setAssignSubmitting(false);
    }
  };

  const handleAssignOfficer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetBureauAssignId || !officerUserId) return;
    setOfficerSubmitting(true);
    setOfficerError(null);
    try {
      await api.post(`/bureau-assignments/${targetBureauAssignId}/officer-assignments`, {
        officer_user_id: officerUserId,
        role: officerRole,
        notes: officerNotes.trim() || undefined,
      });
      setShowAssignOfficerModal(false);
      setOfficerUserId("");
      setOfficerNotes("");
      await reload();
    } catch (err: any) {
      setOfficerError(err?.message || "Failed to assign officer.");
    } finally {
      setOfficerSubmitting(false);
    }
  };

  const handleRequestTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferFromAssignId || !transferToBureauId || !transferReason.trim()) return;
    setTransferSubmitting(true);
    setTransferError(null);
    try {
      await api.post(`/cases/${caseItem.case_id}/transfers`, {
        from_bureau_assignment_id: transferFromAssignId,
        to_bureau_id: transferToBureauId,
        transfer_type: transferType,
        reason: transferReason.trim(),
      });
      setShowTransferModal(false);
      setTransferReason("");
      await reload();
    } catch (err: any) {
      setTransferError(err?.message || "Failed to request transfer.");
    } finally {
      setTransferSubmitting(false);
    }
  };

  const handleUploadAttachment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attachFilename.trim()) return;
    setAttachSubmitting(true);
    setAttachError(null);
    try {
      await api.post(`/cases/${caseItem.case_id}/attachments`, {
        original_filename: attachFilename.trim(),
        storage_bucket: "complaint-evidence",
        storage_path: `cases/${caseItem.case_id}/${Date.now()}_${attachFilename.trim().replace(/\s+/g, "_")}`,
        mime_type: "application/pdf",
        file_size_bytes: 1024 * 142,
        attachment_type: attachType,
        description: attachDescription.trim() || undefined,
      });
      setShowAttachmentModal(false);
      setAttachFilename("");
      setAttachDescription("");
      await reloadAttachments();
      await reload();
    } catch (err: any) {
      setAttachError(err?.message || "Failed to upload attachment.");
    } finally {
      setAttachSubmitting(false);
    }
  };

  return (
    <section>
      <PageHeader
        title={`Case ${caseItem.case_number}: ${caseItem.title}`}
        description={`Canonical case for ${caseItem.institution_name}`}
        actions={
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <Link to="/cases" className="button button-quiet">
              Back to Cases
            </Link>
            {has("case.status.change") && permittedStatuses.length > 0 && (
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  setNewStatus(permittedStatuses[0]);
                  setShowStatusModal(true);
                }}
              >
                Change Status
              </button>
            )}
            <button type="button" className="button button-quiet" onClick={() => void reload()}>
              Refresh
            </button>
          </div>
        }
      />

      {/* Primary Header Card */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h2 style={{ margin: "0 0 0.5rem 0" }}>{caseItem.title}</h2>
            <div className="hint">
              Institution: <strong>{caseItem.institution_name}</strong> | Category: {caseItem.category_name || "General"} | Region: {caseItem.institution_region || "N/A"}
            </div>
            <div className="hint" style={{ marginTop: "0.25rem" }}>
              Opened: {formatDateTime(caseItem.opened_at)} | Last updated: {formatDateTime(caseItem.updated_at)}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <StatusBadge
              value={caseItem.priority}
              label={severityLabel(caseItem.priority)}
            />
            <StatusBadge
              value={caseItem.status}
              label={caseStatusLabel(caseItem.status)}
            />
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div style={{ display: "flex", gap: "0.5rem", borderBottom: "1px solid var(--color-border)", marginBottom: "1.5rem", overflowX: "auto" }}>
        <button
          type="button"
          className={`button ${activeTab === "overview" ? "button-primary" : "button-quiet"}`}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          className={`button ${activeTab === "assignments" ? "button-primary" : "button-quiet"}`}
          onClick={() => setActiveTab("assignments")}
        >
          Bureau & Officers ({caseItem.collaborating_bureaus.length + 1})
        </button>
        <button
          type="button"
          className={`button ${activeTab === "timeline" ? "button-primary" : "button-quiet"}`}
          onClick={() => setActiveTab("timeline")}
        >
          Timeline & History ({caseItem.action_history.length})
        </button>
        <button
          type="button"
          className={`button ${activeTab === "notes" ? "button-primary" : "button-quiet"}`}
          onClick={() => setActiveTab("notes")}
        >
          Internal Notes {caseItem.notes_count ? `(${caseItem.notes_count})` : ""}
        </button>
        <button
          type="button"
          className={`button ${activeTab === "attachments" ? "button-primary" : "button-quiet"}`}
          onClick={() => setActiveTab("attachments")}
        >
          Evidence & Attachments {caseItem.attachments_count ? `(${caseItem.attachments_count})` : ""}
        </button>
        <button
          type="button"
          className={`button ${activeTab === "transfers" ? "button-primary" : "button-quiet"}`}
          onClick={() => setActiveTab("transfers")}
        >
          Transfers
        </button>
        <button
          type="button"
          className={`button ${activeTab === "access" ? "button-primary" : "button-quiet"}`}
          onClick={() => setActiveTab("access")}
        >
          Access Grants
        </button>
      </div>

      {/* Tab 1: Overview */}
      {activeTab === "overview" && (
        <div style={{ display: "grid", gap: "1.5rem" }}>
          <div className="card">
            <h3>Complaint Description</h3>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, marginTop: "0.5rem" }}>
              {caseItem.description}
            </div>
          </div>

          <div className="card">
            <h3>Institution & Routing Summary</h3>
            <dl className="grid-2col" style={{ marginTop: "1rem" }}>
              <dt>Institution Name</dt>
              <dd><strong>{caseItem.institution_name}</strong></dd>
              <dt>AICTE ID</dt>
              <dd>{caseItem.institution_code || "Pending Verification"}</dd>
              <dt>Region</dt>
              <dd>{caseItem.institution_region || "Unassigned"}</dd>
              <dt>Lead Bureau</dt>
              <dd>{caseItem.lead_bureau_name ? `${caseItem.lead_bureau_name} (${caseItem.lead_bureau_code})` : "Unassigned"}</dd>
              <dt>Collaborating Bureaus</dt>
              <dd>
                {caseItem.collaborating_bureaus.length > 0
                  ? caseItem.collaborating_bureaus.map((b) => b.bureau_code).join(", ")
                  : "None"}
              </dd>
              <dt>Source Submission ID</dt>
              <dd><code>{caseItem.source_submission_id}</code></dd>
            </dl>
          </div>

          {caseItem.related_cases.length > 0 && (
            <div className="card">
              <h3>Related Cases</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Case Number</th>
                    <th>Title</th>
                    <th>Relationship</th>
                    <th>Linked At</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {caseItem.related_cases.map((rc) => (
                    <tr key={rc.relationship_id}>
                      <td><strong>{rc.related_case_number}</strong></td>
                      <td>{rc.related_case_title}</td>
                      <td><StatusBadge value="neutral" label={rc.relationship_type} /></td>
                      <td>{formatDateTime(rc.created_at)}</td>
                      <td>
                        <Link to={`/cases/${rc.related_case_id}`} className="button button-small">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Assignments */}
      {activeTab === "assignments" && (
        <div style={{ display: "grid", gap: "1.5rem" }}>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3>Bureau Assignments</h3>
              {has("case.assign.bureau") && (
                <button
                  type="button"
                  className="button button-small button-primary"
                  onClick={() => setShowAssignBureauModal(true)}
                >
                  + Add Bureau Assignment
                </button>
              )}
            </div>

            <table className="table">
              <thead>
                <tr>
                  <th>Bureau</th>
                  <th>Assignment Type</th>
                  <th>Status</th>
                  <th>Assigned Date</th>
                  <th>Officers</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {caseItem.lead_bureau_id && (
                  <tr>
                    <td>
                      <strong>{caseItem.lead_bureau_name}</strong> ({caseItem.lead_bureau_code})
                    </td>
                    <td><StatusBadge value="warning" label="Lead Bureau" /></td>
                    <td><StatusBadge value="success" label="Active" /></td>
                    <td>{formatDateTime(caseItem.opened_at)}</td>
                    <td>
                      {caseItem.officer_assignments?.filter(o => o.bureau_name === caseItem.lead_bureau_name).map(o => (
                        <div key={o.officer_assignment_id} style={{ fontSize: "0.85rem" }}>
                          <strong>{o.officer_name}</strong> ({o.role.replace(/_/g, " ")})
                        </div>
                      )) || "None assigned"}
                    </td>
                    <td>
                      {has("case.assign.officer") && (
                        <button
                          type="button"
                          className="button button-small button-quiet"
                          onClick={() => {
                            setTargetBureauAssignId(caseItem.lead_bureau_id!);
                            setTargetBureauId(caseItem.lead_bureau_id!);
                            setShowAssignOfficerModal(true);
                          }}
                        >
                          Assign Officer
                        </button>
                      )}
                    </td>
                  </tr>
                )}

                {caseItem.collaborating_bureaus.map((cb) => (
                  <tr key={cb.bureau_id}>
                    <td>
                      <strong>{cb.bureau_name}</strong> ({cb.bureau_code})
                    </td>
                    <td><StatusBadge value="neutral" label="Collaborating" /></td>
                    <td><StatusBadge value="success" label={cb.assignment_status} /></td>
                    <td>{formatDateTime(cb.assigned_at)}</td>
                    <td>
                      {caseItem.officer_assignments?.filter(o => o.bureau_name === cb.bureau_name).map(o => (
                        <div key={o.officer_assignment_id} style={{ fontSize: "0.85rem" }}>
                          <strong>{o.officer_name}</strong> ({o.role.replace(/_/g, " ")})
                        </div>
                      )) || "None assigned"}
                    </td>
                    <td>
                      {has("case.assign.officer") && (
                        <button
                          type="button"
                          className="button button-small button-quiet"
                          onClick={() => {
                            setTargetBureauAssignId(cb.bureau_id);
                            setTargetBureauId(cb.bureau_id);
                            setShowAssignOfficerModal(true);
                          }}
                        >
                          Assign Officer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Timeline & History */}
      {activeTab === "timeline" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h3>Action & Audit History</h3>
            <span className="hint">Immutable append-only chronological log</span>
          </div>

          {caseItem.action_history.length === 0 ? (
            <EmptyState title="No recorded actions" description="No actions have been logged for this case." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {caseItem.action_history.map((act) => (
                <div
                  key={act.action_id}
                  style={{
                    padding: "0.75rem 1rem",
                    borderLeft: "3px solid var(--color-primary)",
                    background: "var(--color-surface-subtle, rgba(0,0,0,0.02))",
                    borderRadius: "0 6px 6px 0",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
                    <strong>{act.action_type.replace(/_/g, " ").toUpperCase()}</strong>
                    <span className="hint">{formatDateTime(act.created_at)}</span>
                  </div>
                  <div style={{ marginTop: "0.25rem" }}>{act.action_description}</div>
                  {act.previous_status && act.new_status && (
                    <div style={{ marginTop: "0.25rem", fontSize: "0.85rem" }} className="hint">
                      Transition: <code>{act.previous_status}</code> → <code>{act.new_status}</code>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Internal Notes */}
      {activeTab === "notes" && (
        <div style={{ display: "grid", gap: "1.5rem" }}>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <div>
                <h3 style={{ margin: 0 }}>Internal Case Notes</h3>
                <span className="hint">Shared across assigned bureaus or private to bureau</span>
              </div>
              {has("case.note.create") && (
                <button
                  type="button"
                  className="button button-primary button-small"
                  onClick={() => setShowNoteModal(true)}
                >
                  + Add Note
                </button>
              )}
            </div>

            {!notes || notes.length === 0 ? (
              <EmptyState title="No notes recorded" description="Add shared notes for cross-bureau coordination or private notes for bureau members." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {notes.map((note) => (
                  <div
                    key={note.note_id}
                    style={{
                      padding: "1rem",
                      border: note.is_pinned ? "1px solid var(--color-warning)" : "1px solid var(--color-border)",
                      borderRadius: "6px",
                      background: note.is_pinned ? "rgba(234, 179, 8, 0.05)" : "var(--color-surface)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                      <div>
                        <strong>{note.author_name}</strong>
                        {note.bureau_name && <span className="hint"> ({note.bureau_code})</span>}
                        <span style={{ margin: "0 0.5rem" }}>•</span>
                        <span className="hint">{formatDateTime(note.created_at)}</span>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        <StatusBadge
                          value={note.visibility === "shared" ? "success" : "warning"}
                          label={note.visibility === "shared" ? "Shared" : `Private: ${note.bureau_code || "Bureau"}`}
                        />
                        <StatusBadge value="neutral" label={note.note_type.replace(/_/g, " ")} />
                        {note.is_pinned && <span title="Pinned Note">📌</span>}
                        {has("case.note.edit") && (
                          <button
                            type="button"
                            className="button button-small button-quiet"
                            onClick={async () => {
                              if (confirm("Soft delete this note?")) {
                                await api.delete(`/cases/${caseItem.case_id}/notes/${note.note_id}`);
                                await reloadNotes();
                              }
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{note.note_text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 5: Attachments */}
      {activeTab === "attachments" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <h3 style={{ margin: 0 }}>Evidence & Case Attachments</h3>
              <span className="hint">Verified secure attachments stored in private buckets</span>
            </div>
            {has("attachment.upload") && (
              <button
                type="button"
                className="button button-primary button-small"
                onClick={() => setShowAttachmentModal(true)}
              >
                + Attach Evidence
              </button>
            )}
          </div>

          {!attachments || attachments.length === 0 ? (
            <EmptyState title="No attachments found" description="Upload supporting documents, evidence, or resolution orders." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Status</th>
                  <th>Uploaded By</th>
                  <th>Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {attachments.map((att) => (
                  <tr key={att.attachment_id}>
                    <td>
                      <strong>📄 {att.original_filename}</strong>
                      {att.description && <div className="hint" style={{ fontSize: "0.8rem" }}>{att.description}</div>}
                    </td>
                    <td><StatusBadge value="neutral" label={att.attachment_type.replace(/_/g, " ")} /></td>
                    <td>{formatFileSize(att.file_size_bytes)}</td>
                    <td><StatusBadge value="success" label={att.upload_status} /></td>
                    <td>{att.uploader_name || "System Intake"}</td>
                    <td>{formatDateTime(att.uploaded_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="button button-small button-quiet"
                        onClick={() => alert(`Simulated secure download for ${att.original_filename}. Signed token issued.`)}
                      >
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 6: Transfers */}
      {activeTab === "transfers" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <h3 style={{ margin: 0 }}>Inter-Bureau Case Transfers</h3>
              <span className="hint">Transfer case lead or handover responsibility to another bureau</span>
            </div>
            {has("case.transfer.request") && (
              <button
                type="button"
                className="button button-primary button-small"
                onClick={() => {
                  if (caseItem.lead_bureau_id) {
                    setTransferFromAssignId(caseItem.lead_bureau_id);
                  }
                  setShowTransferModal(true);
                }}
              >
                + Request Case Transfer
              </button>
            )}
          </div>
          <p className="hint">
            Case transfer maintains full historical integrity. Past assignment history and notes remain attributed to the source bureau.
          </p>
        </div>
      )}

      {/* Tab 7: Access Grants */}
      {activeTab === "access" && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <h3 style={{ margin: 0 }}>Cross-Bureau Access Grants</h3>
              <span className="hint">Explicit time-bounded or permanent access grants to this case</span>
            </div>
          </div>

          {!accessGrants || accessGrants.length === 0 ? (
            <EmptyState title="No external access grants" description="This case has no active cross-bureau guest access grants." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Grantee</th>
                  <th>Level</th>
                  <th>Granted By</th>
                  <th>Granted At</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {accessGrants.map((ag) => (
                  <tr key={ag.grant_id}>
                    <td><strong>{ag.grantee_name}</strong></td>
                    <td><StatusBadge value="neutral" label={ag.access_level} /></td>
                    <td>{ag.granted_by_name}</td>
                    <td>{formatDateTime(ag.granted_at)}</td>
                    <td>
                      <StatusBadge
                        value={ag.is_active ? "success" : "danger"}
                        label={ag.is_active ? "Active" : "Revoked"}
                      />
                    </td>
                    <td>
                      {ag.is_active && has("case.access.revoke") && (
                        <button
                          type="button"
                          className="button button-small button-quiet"
                          onClick={async () => {
                            const reason = prompt("Enter revocation reason:");
                            if (reason) {
                              await api.post(`/access-grants/${ag.grant_id}/revoke`, { revocation_reason: reason });
                              await reloadGrants();
                            }
                          }}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Status Transition Modal */}
      {showStatusModal && (
        <div style={modalBackdropStyle}>
          <div className="card" style={modalCardStyle}>
            <h3>Transition Case Status</h3>
            <p className="hint">
              Current status: <strong>{caseStatusLabel(caseItem.status)}</strong>.
            </p>
            {statusError && <div className="callout callout-danger" style={{ marginBottom: "1rem" }}>{statusError}</div>}
            <form onSubmit={handleStatusTransition}>
              <label>
                New Status
                <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                  {permittedStatuses.map((st) => (
                    <option key={st} value={st}>
                      {caseStatusLabel(st)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Transition Remarks / Justification
                <textarea
                  rows={3}
                  required
                  placeholder="Explain why this status transition is being made..."
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                />
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                <button type="button" className="button button-quiet" onClick={() => setShowStatusModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={statusSubmitting}>
                  {statusSubmitting ? "Updating..." : "Execute Transition"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Note Modal */}
      {showNoteModal && (
        <div style={modalBackdropStyle}>
          <div className="card" style={modalCardStyle}>
            <h3>Add Internal Case Note</h3>
            {noteError && <div className="callout callout-danger" style={{ marginBottom: "1rem" }}>{noteError}</div>}
            <form onSubmit={handleAddNote}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <label>
                  Visibility
                  <select value={noteVisibility} onChange={(e) => setNoteVisibility(e.target.value as any)}>
                    <option value="shared">Shared (All Assigned Bureaus)</option>
                    <option value="bureau_private">Bureau-Private (My Bureau Only)</option>
                  </select>
                </label>
                <label>
                  Note Type
                  <select value={noteType} onChange={(e) => setNoteType(e.target.value as any)}>
                    <option value="general">General</option>
                    <option value="internal_review">Internal Review</option>
                    <option value="resolution">Resolution</option>
                    <option value="handover">Handover</option>
                  </select>
                </label>
              </div>
              <label>
                Note Content
                <textarea
                  rows={4}
                  required
                  placeholder="Enter detailed internal observations, instructions or meeting records..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                <button type="button" className="button button-quiet" onClick={() => setShowNoteModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={noteSubmitting}>
                  {noteSubmitting ? "Saving..." : "Save Note"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Bureau Modal */}
      {showAssignBureauModal && (
        <div style={modalBackdropStyle}>
          <div className="card" style={modalCardStyle}>
            <h3>Assign Bureau to Case</h3>
            {assignError && <div className="callout callout-danger" style={{ marginBottom: "1rem" }}>{assignError}</div>}
            <form onSubmit={handleAssignBureau}>
              <label>
                Select Bureau
                <select value={selectedBureauId} onChange={(e) => setSelectedBureauId(e.target.value)} required>
                  <option value="">-- Choose Bureau --</option>
                  {bureaus?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Assignment Role
                <select value={assignType} onChange={(e) => setAssignType(e.target.value as any)}>
                  <option value="collaborating">Collaborating Bureau</option>
                  <option value="lead">Lead Bureau</option>
                </select>
              </label>
              <label>
                Assignment Reason
                <textarea
                  rows={3}
                  placeholder="Specify coordination reason..."
                  value={assignReason}
                  onChange={(e) => setAssignReason(e.target.value)}
                />
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                <button type="button" className="button button-quiet" onClick={() => setShowAssignBureauModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={assignSubmitting}>
                  {assignSubmitting ? "Assigning..." : "Confirm Assignment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Officer Modal */}
      {showAssignOfficerModal && (
        <div style={modalBackdropStyle}>
          <div className="card" style={modalCardStyle}>
            <h3>Assign Bureau Officer</h3>
            {officerError && <div className="callout callout-danger" style={{ marginBottom: "1rem" }}>{officerError}</div>}
            <form onSubmit={handleAssignOfficer}>
              <label>
                Select Officer
                <select value={officerUserId} onChange={(e) => setOfficerUserId(e.target.value)} required>
                  <option value="">-- Choose Officer --</option>
                  {bureauMembers?.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name} ({m.official_email})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Officer Role
                <select value={officerRole} onChange={(e) => setOfficerRole(e.target.value as any)}>
                  <option value="lead_officer">Lead Responsible Officer</option>
                  <option value="supporting">Supporting Officer</option>
                  <option value="reviewer">Reviewer</option>
                </select>
              </label>
              <label>
                Assignment Notes
                <textarea
                  rows={3}
                  placeholder="Instructions or scope for officer..."
                  value={officerNotes}
                  onChange={(e) => setOfficerNotes(e.target.value)}
                />
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                <button type="button" className="button button-quiet" onClick={() => setShowAssignOfficerModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={officerSubmitting}>
                  {officerSubmitting ? "Assigning..." : "Assign Officer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Case Transfer Modal */}
      {showTransferModal && (
        <div style={modalBackdropStyle}>
          <div className="card" style={modalCardStyle}>
            <h3>Request Case Transfer</h3>
            {transferError && <div className="callout callout-danger" style={{ marginBottom: "1rem" }}>{transferError}</div>}
            <form onSubmit={handleRequestTransfer}>
              <label>
                Destination Bureau
                <select value={transferToBureauId} onChange={(e) => setTransferToBureauId(e.target.value)} required>
                  <option value="">-- Choose Target Bureau --</option>
                  {bureaus?.filter(b => b.id !== caseItem.lead_bureau_id).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Transfer Type
                <select value={transferType} onChange={(e) => setTransferType(e.target.value as any)}>
                  <option value="handover">Handover (Complete transfer of ownership)</option>
                  <option value="lead_change">Lead Change (Make target bureau lead)</option>
                  <option value="reassignment">Reassignment (Workload redistribution)</option>
                </select>
              </label>
              <label>
                Transfer Justification
                <textarea
                  rows={3}
                  required
                  placeholder="Explain why this case is being transferred..."
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                />
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                <button type="button" className="button button-quiet" onClick={() => setShowTransferModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={transferSubmitting}>
                  {transferSubmitting ? "Submitting..." : "Submit Transfer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Attachment Modal */}
      {showAttachmentModal && (
        <div style={modalBackdropStyle}>
          <div className="card" style={modalCardStyle}>
            <h3>Attach Case Evidence</h3>
            {attachError && <div className="callout callout-danger" style={{ marginBottom: "1rem" }}>{attachError}</div>}
            <form onSubmit={handleUploadAttachment}>
              <label>
                Document Filename
                <input
                  type="text"
                  required
                  placeholder="e.g., AICTE_Inspection_Report_2026.pdf"
                  value={attachFilename}
                  onChange={(e) => setAttachFilename(e.target.value)}
                />
              </label>
              <label>
                Attachment Classification
                <select value={attachType} onChange={(e) => setAttachType(e.target.value)}>
                  <option value="supporting_document">Supporting Document</option>
                  <option value="evidence">Evidence</option>
                  <option value="response">Institution Response</option>
                  <option value="resolution_document">Resolution Document</option>
                </select>
              </label>
              <label>
                Description (Optional)
                <input
                  type="text"
                  placeholder="Brief note about the contents of this file..."
                  value={attachDescription}
                  onChange={(e) => setAttachDescription(e.target.value)}
                />
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                <button type="button" className="button button-quiet" onClick={() => setShowAttachmentModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={attachSubmitting}>
                  {attachSubmitting ? "Uploading..." : "Upload & Register"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0, 0, 0, 0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: "1rem",
};

const modalCardStyle: React.CSSProperties = {
  maxWidth: "540px",
  width: "100%",
  maxHeight: "90vh",
  overflowY: "auto",
};

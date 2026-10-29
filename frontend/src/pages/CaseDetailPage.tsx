import { PublicCorrespondence } from "../components/PublicCorrespondence";
import { PdfPreview } from "../components/PdfPreview";
import {
  canActOnCase,
  canReadCase,
  getOverlappingCases,
  useSimulation,
} from "../simulation/selectors";
import { RestrictedCase } from "../components/RestrictedCase";
import { useState, useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import {
  analyzeCaseWithGemini,
  getGeminiApiKey,
  setGeminiApiKey,
  hasGeminiApiKey,
  type GeminiAnalysisResult,
} from "../lib/gemini";
import {
  IconAlertTriangle,
  IconBot,
  IconCheck,
  IconClock,
  IconClose,
  IconDownload,
  IconPaperclip,
  IconPlus,
  IconHistory,
} from "../components/Icons";
import { EmptyState, Loading } from "../components/ui";
import {
  caseStatusLabel,
  formatFileSize,
  severityLabel,
  VALID_STATUS_TRANSITIONS,
} from "../lib/cases";
import { formatDateTime } from "../lib/intake";
import { useResource } from "../lib/useResource";
import { simulationStore } from "../simulation/simulationStore";
import type { CaseDetail, CaseNoteItem } from "../types";
import { PermissionDeniedPage } from "./PermissionDeniedPage";

type ActiveTab =
  | "overview"
  | "assignments"
  | "timeline"
  | "notes"
  | "attachments"
  | "transfers"
  | "access"
  | "correspondence";

export function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const { has: hasPermission, api, simulatedClock, activePersona } = useAuth();
  const simState = useSimulation();
  const rawCase = simState.cases.find((c) => c.case_id === caseId);
  const has = (p: string) =>
    hasPermission(p) &&
    (!rawCase ||
      ![
        "case.status.change",
        "case.note.create",
        "case.note.delete",
        "case.assign.bureau",
        "case.assign.officer",
        "attachment.upload",
        "attachment.quarantine",
        "case.transfer.manage",
        "case.access.manage",
      ].includes(p) ||
      canActOnCase(rawCase, activePersona, simState));
  const [tabParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<ActiveTab>(() =>
    [
      "overview",
      "assignments",
      "timeline",
      "notes",
      "attachments",
      "transfers",
      "access",
      "correspondence",
    ].includes(tabParams.get("tab") || "")
      ? (tabParams.get("tab") as ActiveTab)
      : "overview",
  );

  // Primary resource
  const {
    data: caseItem,
    loading,
    error,
    reload,
  } = useResource<CaseDetail>(
    (has("case.view_index") || has("case.view_detail")) && caseId
      ? `/cases/${caseId}`
      : null,
  );

  // Sub-resources
  const { data: notes, reload: reloadNotes } = useResource<CaseNoteItem[]>(
    has("case.note.view") && caseId && activeTab === "notes"
      ? `/cases/${caseId}/notes`
      : null,
  );

  const { data: attachments, reload: reloadAttachments } = useResource<any[]>(
    has("attachment.view") && caseId && activeTab === "attachments"
      ? `/cases/${caseId}/attachments`
      : null,
  );

  const { data: accessGrants, reload: reloadGrants } = useResource<any[]>(
    caseId && activeTab === "access" ? `/cases/${caseId}/access-grants` : null,
  );

  // Modal States
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<
    "shared" | "bureau_private"
  >("shared");
  const [noteType, setNoteType] = useState<
    "general" | "internal_review" | "resolution" | "handover"
  >("general");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const [showAssignBureauModal, setShowAssignBureauModal] = useState(false);
  const [selectedBureauId, setSelectedBureauId] = useState("");
  const assignType: "lead" | "collaborating" = "collaborating";
  const [assignReason, setAssignReason] = useState("");

  // Gemini AI States
  const [geminiAnalysis, setGeminiAnalysis] = useState<GeminiAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyInput, setKeyInput] = useState(() => getGeminiApiKey());
  const [keyNotice, setKeyNotice] = useState("");

  useEffect(() => {
    if (!caseItem) return;
    const overlapping = getOverlappingCases(simState, caseItem.case_id);
    analyzeCaseWithGemini(caseItem as any, overlapping, simState.submissions).then(setGeminiAnalysis);
  }, [caseItem?.case_id]);

  const handleRunAiAnalysis = async () => {
    if (!caseItem) return;
    setIsAnalyzing(true);
    try {
      const overlapping = getOverlappingCases(simState, caseItem.case_id);
      const res = await analyzeCaseWithGemini(caseItem as any, overlapping, simState.submissions);
      setGeminiAnalysis(res);
    } finally {
      setIsAnalyzing(false);
    }
  };
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const [showAssignOfficerModal, setShowAssignOfficerModal] = useState(false);
  const [targetBureauAssignId, setTargetBureauAssignId] = useState("");
  const [, setTargetBureauId] = useState("");
  const [officerUserId, setOfficerUserId] = useState("");
  const [officerRole, setOfficerRole] = useState<
    "lead_officer" | "supporting" | "reviewer"
  >("supporting");
  const [officerNotes, setOfficerNotes] = useState("");
  const [officerSubmitting, setOfficerSubmitting] = useState(false);
  const [officerError, setOfficerError] = useState<string | null>(null);

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferToBureauId, setTransferToBureauId] = useState("");
  const [transferType, setTransferType] = useState<
    "handover" | "lead_change" | "reassignment"
  >("handover");
  const [transferReason, setTransferReason] = useState("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  const [showAccessModal, setShowAccessModal] = useState(false);
  const [accessLevel, setAccessLevel] = useState<"details" | "collaborate">(
    "details",
  );
  const [accessReason, setAccessReason] = useState("");
  const [accessSubmitting, setAccessSubmitting] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  // Attachment Modal & Real File Upload
  const [showAttachmentModal, setShowAttachmentModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileDataUrl, setSelectedFileDataUrl] = useState<string>("");
  const [attachType, setAttachType] = useState("supporting_document");
  const [attachDescription, setAttachDescription] = useState("");
  const [attachSubmitting, setAttachSubmitting] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  // Attachment Preview Modal
  const [previewAttachment, setPreviewAttachment] = useState<any | null>(null);

  if (!has("case.view_index") && !has("case.view_detail")) {
    return <PermissionDeniedPage />;
  }

  if (rawCase && !canReadCase(rawCase, activePersona, simState))
    return (
      <RestrictedCase
        caseId={rawCase.case_id}
        caseNumber={rawCase.case_number}
      />
    );

  if (loading && !caseItem) {
    return <Loading label="Loading canonical case record..." />;
  }

  if (error || !caseItem) {
    return (
      <EmptyState
        title="Case Not Found"
        description="The requested canonical case could not be located."
      />
    );
  }

  const collaboratingBureaus = caseItem.collaborating_bureaus || [];
  const officerAssignments = caseItem.officer_assignments || [];
  const actionHistory = caseItem.action_history || [];
  const permittedStatuses =
    VALID_STATUS_TRANSITIONS[caseItem.status as any] || [];

  // Active escalation check
  const state = simulationStore.getState();
  const activeEscalation = state.escalations.find(
    (e) => e.case_id === caseItem.case_id && e.status !== "resolved",
  );

  // SLA calculations
  const now = new Date(simulatedClock).getTime();
  const targetDate = new Date(
    (caseItem as any).target_resolution_date || caseItem.opened_at,
  ).getTime();
  const diffDays = Math.ceil((targetDate - now) / (1000 * 60 * 60 * 24));
  const isOverdue =
    targetDate < now &&
    caseItem.status !== "resolved" &&
    caseItem.status !== "closed";
  const isAtRisk =
    diffDays >= 0 &&
    diffDays <= 3 &&
    caseItem.status !== "resolved" &&
    caseItem.status !== "closed";

  // Handlers
  const handleStatusTransition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStatus) return;
    setStatusSubmitting(true);
    setStatusError(null);
    try {
      await api.post(`/cases/${caseItem.case_id}/status-transitions`, {
        to_status: newStatus,
        reason: statusReason.trim() || "Status updated by authorized officer",
      });
      setShowStatusModal(false);
      setStatusReason("");
      await reload();
    } catch (err: any) {
      setStatusError(err?.message || "Failed to update case status.");
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
      });
      setShowNoteModal(false);
      setNoteText("");
      await reloadNotes();
      await reload();
    } catch (err: any) {
      setNoteError(err?.message || "Failed to add note.");
    } finally {
      setNoteSubmitting(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!window.confirm("Remove this case note?")) return;
    try {
      await api.delete(`/cases/${caseItem.case_id}/notes/${noteId}`);
      await reloadNotes();
      await reload();
    } catch (err: any) {
      alert(err?.message || "Failed to delete note.");
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
    if (!officerUserId || !targetBureauAssignId) return;
    setOfficerSubmitting(true);
    setOfficerError(null);
    try {
      await api.post(
        `/bureau-assignments/${targetBureauAssignId}/officer-assignments`,
        {
          case_id: caseItem.case_id,
          officer_user_id: officerUserId,
          role: officerRole,
          notes: officerNotes.trim() || undefined,
        },
      );
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
    if (!transferToBureauId || !transferReason.trim()) return;
    setTransferSubmitting(true);
    setTransferError(null);
    try {
      await api.post(`/cases/${caseItem.case_id}/transfers`, {
        to_bureau_id: transferToBureauId,
        transfer_type: transferType,
        reason: transferReason.trim(),
      });
      setShowTransferModal(false);
      setTransferToBureauId("");
      setTransferReason("");
      await reload();
    } catch (err: any) {
      setTransferError(err?.message || "Failed to request transfer.");
    } finally {
      setTransferSubmitting(false);
    }
  };

  const handleRequestAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessReason.trim()) return;
    setAccessSubmitting(true);
    setAccessError(null);
    try {
      await api.post(`/cases/${caseItem.case_id}/access-requests`, {
        access_level: accessLevel,
        justification: accessReason.trim(),
      });
      setShowAccessModal(false);
      setAccessReason("");
      await reloadGrants();
      await reload();
    } catch (err: any) {
      setAccessError(err?.message || "Failed to request access.");
    } finally {
      setAccessSubmitting(false);
    }
  };

  // Real File Upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      setAttachError("File size exceeds the 25 MB upload limit.");
      return;
    }

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      setSelectedFileDataUrl(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleUploadAttachment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !selectedFileDataUrl) {
      setAttachError("Please select a file to upload.");
      return;
    }

    setAttachSubmitting(true);
    setAttachError(null);
    try {
      await api.post(`/cases/${caseItem.case_id}/attachments`, {
        original_filename: selectedFile.name,
        mime_type: selectedFile.type || "application/octet-stream",
        file_size_bytes: selectedFile.size,
        data_url: selectedFileDataUrl,
        attachment_type: attachType,
        description: attachDescription.trim() || undefined,
      });
      setShowAttachmentModal(false);
      setSelectedFile(null);
      setSelectedFileDataUrl("");
      setAttachDescription("");
      await reloadAttachments();
      await reload();
    } catch (err: any) {
      setAttachError(err?.message || "Failed to upload attachment.");
    } finally {
      setAttachSubmitting(false);
    }
  };

  const handleDownloadAttachment = async (att: any) => {
    if (att.is_quarantined) {
      alert(
        `Download blocked: File "${att.filename || att.original_filename}" is quarantined for security review.`,
      );
      return;
    }

    if (!att.data_url) {
      alert(
        "The original file is unavailable in this browser. Upload it again to restore access.",
      );
      return;
    }
    const payload = await fetch(att.data_url).then((response) =>
      response.blob(),
    );
    const downloadUrl = URL.createObjectURL(payload);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download =
      att.filename || att.original_filename || "evidence_document.pdf";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  };

  const handleQuarantine = (att: any) => {
    const reason = prompt(
      "Specify reason for quarantining this attachment (malware risk, illegible scan, privacy violation):",
    );
    if (reason && reason.trim()) {
      simulationStore.quarantineAttachment(
        caseItem.case_id,
        att.attachment_id,
        reason.trim(),
      );
      reloadAttachments();
    }
  };

  return (
    <div className="case-workspace">
      {/* Header with Title and Transition CTA */}
      <div className="page-header">
        <div className="page-header-info">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              marginBottom: "0.25rem",
            }}
          >
            <Link to="/cases" className="small muted">
              &larr; Back to Cases
            </Link>
            <span className="small muted">/</span>
            <span className="small font-semibold">{caseItem.case_number}</span>
          </div>
          <h1>{caseItem.title}</h1>
          <p>{caseItem.institution_name}</p>
        </div>

        <div className="page-header-actions">
          {has("case.status.change") && permittedStatuses.length > 0 && (
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setNewStatus(permittedStatuses[0]);
                setShowStatusModal(true);
              }}
            >
              Update Status &rarr;
            </button>
          )}

          {activeEscalation &&
            activeEscalation.status === "active" &&
            has("escalation.manage") && (
              <button
                type="button"
                className="button button-danger"
                onClick={() => {
                  const notes = prompt(
                    "Enter escalation acknowledgement remarks:",
                  );
                  if (notes) {
                    simulationStore.acknowledgeEscalation(
                      activeEscalation.escalation_id,
                      notes,
                    );
                    reload();
                  }
                }}
              >
                Acknowledge Escalation
              </button>
            )}
        </div>
      </div>

      {/* Case Overview Summary Hero Card */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div
          className="case-summary-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "1rem",
            borderBottom: "1px solid var(--color-border-subtle)",
            paddingBottom: "1.25rem",
            marginBottom: "1.25rem",
          }}
        >
          <div>
            <span className="small muted">Status</span>
            <div style={{ marginTop: "0.25rem" }}>
              <span className={`badge badge-status-${caseItem.status}`}>
                {caseStatusLabel(caseItem.status)}
              </span>
            </div>
          </div>

          <div>
            <span className="small muted">Priority</span>
            <div style={{ marginTop: "0.25rem" }}>
              <span className={`badge badge-priority-${caseItem.priority}`}>
                {severityLabel(caseItem.priority)}
              </span>
            </div>
          </div>

          <div>
            <span className="small muted">Lead Bureau</span>
            <div
              style={{
                fontWeight: 600,
                fontSize: "0.92rem",
                marginTop: "0.25rem",
              }}
            >
              {caseItem.lead_bureau_name} ({caseItem.lead_bureau_code})
            </div>
          </div>

          <div>
            <span className="small muted">SLA Target &amp; Countdown</span>
            <div
              style={{
                fontWeight: 700,
                fontSize: "0.92rem",
                marginTop: "0.25rem",
                color: isOverdue
                  ? "var(--color-danger)"
                  : isAtRisk
                    ? "var(--color-warning)"
                    : "var(--color-accent)",
                display: "flex",
                alignItems: "center",
                gap: "0.35rem",
              }}
            >
              <IconClock className="w-4 h-4" />
              {caseItem.status === "closed" || caseItem.status === "resolved"
                ? "Completed"
                : isOverdue
                  ? `${Math.max(1, Math.ceil((now - targetDate) / 86400000))} days overdue`
                  : isAtRisk
                    ? `At Risk (${diffDays}d remaining)`
                    : `${diffDays} days remaining`}
            </div>
          </div>
        </div>

        {/* Active Escalation Warning Banner */}
        {activeEscalation && (
          <div
            style={{
              background: "var(--color-danger-soft)",
              border: "1px solid var(--color-danger-border)",
              borderRadius: "var(--radius-md)",
              padding: "0.85rem 1rem",
              marginBottom: "1rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}
            >
              <IconAlertTriangle className="w-5 h-5 text-danger" />
              <div>
                <strong style={{ color: "var(--color-danger)" }}>
                  Active Escalation: {activeEscalation.level_name} (
                  {activeEscalation.target_authority})
                </strong>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.8rem",
                    color: "var(--color-danger)",
                  }}
                >
                  {activeEscalation.reason}
                </p>
              </div>
            </div>
            <span className="badge badge-priority-critical">
              LEVEL {activeEscalation.level}
            </span>
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "0.82rem",
            color: "var(--color-text-secondary)",
          }}
        >
          <div>
            Institution Code:{" "}
            <strong>{caseItem.institution_code || "Not recorded"}</strong> ·
            Region: {caseItem.institution_region || "Northern"}
          </div>
          <div>
            Opened: {formatDateTime(caseItem.opened_at)} · Last Action:{" "}
            {formatDateTime(caseItem.last_action_date || caseItem.updated_at)}
          </div>
        </div>

        {/* Action Movement Summary (Problem Statement 26264) */}
        <div
          style={{
            marginTop: "0.85rem",
            paddingTop: "0.85rem",
            borderTop: "1px solid var(--color-border)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "0.85rem",
            fontSize: "0.85rem",
          }}
        >
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
            <span
              className="badge badge-neutral"
              style={{ fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700 }}
            >
              Last Action Taken
            </span>
            <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>
              {caseItem.last_action_taken || "Case created in bureau workflow queue"}
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
            <span
              className="badge"
              style={{
                fontSize: "0.72rem",
                textTransform: "uppercase",
                fontWeight: 700,
                background: "#fef3c7",
                color: "#92400e",
                border: "1px solid #f59e0b",
              }}
            >
              Next Action Required
            </span>
            <span style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>
              {caseItem.next_action_required || "Complete initial document review and officer assignment"}
            </span>
          </div>
        </div>
      </div>

      {/* Cross-Bureau Overlap Detection Banner (SIH Problem Statement 26264) */}
      {(() => {
        const overlappingCases = getOverlappingCases(simState, caseItem.case_id);
        const duplicateMatch = simState.duplicateCandidates.find(
          (d) => d.candidate_case_id === caseItem.case_id || d.submission_id === caseItem.source_submission_id,
        );

        if (overlappingCases.length === 0 && !duplicateMatch) return null;

        return (
          <div
            className="card"
            style={{
              marginBottom: "1.5rem",
              border: "1.5px solid #d97706",
              background: "#fffbeb",
              boxShadow: "0 2px 8px rgba(217, 119, 6, 0.12)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "1rem",
                marginBottom: "0.75rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "50%",
                    background: "#fef3c7",
                    border: "1px solid #f59e0b",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <IconAlertTriangle className="w-5 h-5" style={{ color: "#d97706" }} />
                </div>
                <div>
                  <h3
                    style={{
                      color: "#92400e",
                      fontSize: "1.05rem",
                      margin: 0,
                      fontWeight: 700,
                    }}
                  >
                    Potential Overlapping Cases – Coordination Required
                  </h3>
                  <p
                    style={{
                      color: "#78350f",
                      fontSize: "0.85rem",
                      margin: "0.2rem 0 0 0",
                    }}
                  >
                    AICTE OneDesk inter-bureau intelligence identified active parallel
                    investigation on <strong>{caseItem.institution_name}</strong> (AICTE Permanent ID:{" "}
                    <strong>{caseItem.institution_code || "PID-VERIFIED"}</strong>) across multiple Bureaus/Cells.
                    Joint coordination is required to prevent conflicting orders and duplicate proceedings.
                  </p>
                </div>
              </div>
              <span
                className="badge"
                style={{
                  background: "#fef3c7",
                  color: "#92400e",
                  border: "1px solid #d97706",
                  fontWeight: 700,
                }}
              >
                {overlappingCases.length} OVERLAPPING {overlappingCases.length === 1 ? "CASE" : "CASES"}
              </span>
            </div>

            {duplicateMatch && (
              <div
                style={{
                  background: "#ffffff",
                  border: "1px dashed #f59e0b",
                  borderRadius: "var(--radius-md)",
                  padding: "0.75rem 1rem",
                  marginBottom: "0.75rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  fontSize: "0.85rem",
                }}
              >
                <div>
                  <strong style={{ color: "#92400e" }}>Linked Duplicate Submission Candidate: </strong>
                  <span>{duplicateMatch.submission_subject} ({duplicateMatch.submission_number})</span>
                  <span className="badge badge-warning" style={{ marginLeft: "0.5rem", fontSize: "0.72rem" }}>
                    {Math.round(duplicateMatch.similarity_score * 100)}% Match ({duplicateMatch.matching_method || "Heuristic Match"})
                  </span>
                </div>
                <Link
                  to={`/duplicate-review/candidates/${duplicateMatch.candidate_id}`}
                  className="text-link"
                  style={{ fontSize: "0.82rem", fontWeight: 600 }}
                >
                  View Side-by-Side Signal Match →
                </Link>
              </div>
            )}

            <div
              style={{
                display: "grid",
                gap: "0.75rem",
                marginTop: "0.5rem",
              }}
            >
              {overlappingCases.map((otherCase) => {
                const isJointReviewActive =
                  caseItem.collaborating_bureaus?.some(
                    (b) => b.bureau_id === otherCase.lead_bureau_id,
                  ) ||
                  otherCase.collaborating_bureaus?.some(
                    (b) => b.bureau_id === caseItem.lead_bureau_id,
                  );

                return (
                  <div
                    key={otherCase.case_id}
                    style={{
                      background: "#ffffff",
                      border: "1px solid #fed7aa",
                      borderRadius: "var(--radius-lg)",
                      padding: "1rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "1rem",
                    }}
                  >
                    <div style={{ flex: "1 1 300px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          marginBottom: "0.35rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <Link
                          to={`/cases/${otherCase.case_id}`}
                          style={{
                            fontWeight: 700,
                            fontSize: "0.92rem",
                            color: "#1d4ed8",
                            textDecoration: "underline",
                          }}
                        >
                          {otherCase.case_number}
                        </Link>
                        <span className="badge badge-neutral" style={{ fontSize: "0.72rem" }}>
                          {otherCase.lead_bureau_name} ({otherCase.lead_bureau_code})
                        </span>
                        <span className={`badge badge-priority-${otherCase.priority}`}>
                          {severityLabel(otherCase.priority)}
                        </span>
                        <span className="badge badge-neutral">
                          {caseStatusLabel(otherCase.status)}
                        </span>
                      </div>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: "0.88rem",
                          color: "var(--color-text-primary)",
                          marginBottom: "0.25rem",
                        }}
                      >
                        {otherCase.title}
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "var(--color-text-secondary)", marginBottom: "0.25rem" }}>
                        Category: {otherCase.category_name} · Opened:{" "}
                        {formatDateTime(otherCase.opened_at)}
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "#b45309", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                        <span>Overlap basis:</span>
                        <strong>Same Institution ({caseItem.institution_code || "AICTE Permanent ID Match"}) concurrently active across {caseItem.lead_bureau_code} &amp; {otherCase.lead_bureau_code}</strong>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <Link
                        to={`/cases/${otherCase.case_id}`}
                        className="button button-quiet"
                        style={{ fontSize: "0.82rem" }}
                      >
                        Inspect Case →
                      </Link>
                      {isJointReviewActive ? (
                        <span
                          className="badge"
                          style={{
                            background: "#ecfdf5",
                            color: "#065f46",
                            border: "1px solid #10b981",
                            fontWeight: 600,
                            padding: "0.45rem 0.75rem",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.3rem",
                          }}
                        >
                          <IconCheck className="w-3.5 h-3.5" /> Joint Review Active
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="button button-primary"
                          style={{
                            fontSize: "0.82rem",
                            background: "#155a37",
                          }}
                          onClick={() => {
                            simulationStore.initiateJointReview(caseItem.case_id, otherCase.case_id);
                            reload();
                          }}
                        >
                          Initiate Joint Review
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Pill Tabs Navigation */}
      <div className="pill-tabs case-tabs" style={{ marginBottom: "1.5rem" }}>
        <button
          type="button"
          className={`pill-tab ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          className={`pill-tab ${activeTab === "assignments" ? "active" : ""}`}
          onClick={() => setActiveTab("assignments")}
        >
          Officers &amp; Bureaus (
          {officerAssignments.length + collaboratingBureaus.length})
        </button>
        <button
          type="button"
          className={`pill-tab ${activeTab === "timeline" ? "active" : ""}`}
          onClick={() => setActiveTab("timeline")}
        >
          Timeline &amp; Audit ({actionHistory.length})
        </button>
        <button
          type="button"
          className={`pill-tab ${activeTab === "notes" ? "active" : ""}`}
          onClick={() => setActiveTab("notes")}
        >
          Internal Notes ({caseItem.notes_count || 0})
        </button>
        <button
          type="button"
          className={`pill-tab ${activeTab === "attachments" ? "active" : ""}`}
          onClick={() => setActiveTab("attachments")}
        >
          Evidence &amp; Attachments ({caseItem.attachments_count || 0})
        </button>
        <button
          type="button"
          className={`pill-tab ${activeTab === "transfers" ? "active" : ""}`}
          onClick={() => setActiveTab("transfers")}
        >
          Transfers
        </button>
        <button
          type="button"
          className={`pill-tab ${activeTab === "access" ? "active" : ""}`}
          onClick={() => setActiveTab("access")}
        >
          Cross-Bureau Grants
        </button>
        {has("submission.view") && (
          <button
            type="button"
            className={`pill-tab ${activeTab === "correspondence" ? "active" : ""}`}
            onClick={() => setActiveTab("correspondence")}
          >
            Complainant correspondence
          </button>
        )}
      </div>

      {activeTab === "correspondence" && has("submission.view") && (
        <PublicCorrespondence caseId={caseItem.case_id} />
      )}
      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <>
          {/* AI Case Triage & Regulatory Synopsis Card (Innovation Expected - Problem Statement 26264) */}
          <div
            className="card"
            style={{
              background: "linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)",
              border: "1px solid #86efac",
              boxShadow: "var(--shadow-sm)",
              marginBottom: "1.25rem",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.85rem",
                flexWrap: "wrap",
                gap: "0.5rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "var(--radius-md)",
                    background: "#dcfce7",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <IconBot className="w-5 h-5" style={{ color: "#166534" }} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.05rem", color: "#166534" }}>
                    AI Case Triage &amp; Regulatory Synopsis
                  </h3>
                  <p className="small muted" style={{ margin: "0.15rem 0 0 0" }}>
                    Smart NLP entity extraction, rule-based cross-referencing, and inter-bureau coordination assistance.
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <span
                  className="badge"
                  style={{
                    background: geminiAnalysis?.isLiveGemini ? "#dbeafe" : "#dcfce7",
                    color: geminiAnalysis?.isLiveGemini ? "#1e40af" : "#166534",
                    border: `1px solid ${geminiAnalysis?.isLiveGemini ? "#93c5fd" : "#86efac"}`,
                    fontWeight: 700,
                    fontSize: "0.78rem",
                  }}
                >
                  {geminiAnalysis?.modelUsed || (hasGeminiApiKey() ? "Google Gemini 2.0 Flash (Live)" : "AICTE-Norms-v2.4")}
                </span>
                <span
                  className="badge"
                  style={{
                    background: (geminiAnalysis?.priority || caseItem.priority) === "critical" ? "#fee2e2" : "#fef3c7",
                    color: (geminiAnalysis?.priority || caseItem.priority) === "critical" ? "#991b1b" : "#92400e",
                    border: "1px solid #fca5a5",
                    fontSize: "0.78rem",
                    fontWeight: 700,
                  }}
                >
                  {geminiAnalysis?.urgency_rating || (caseItem.priority === "critical" ? "Critical Urgency" : "High Urgency")}
                </span>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={isAnalyzing}
                  onClick={handleRunAiAnalysis}
                  style={{ fontSize: "0.78rem", padding: "0.3rem 0.65rem" }}
                >
                  {isAnalyzing ? "Analyzing..." : "Re-run Triage"}
                </button>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setShowKeyModal(true)}
                  style={{ fontSize: "0.78rem", padding: "0.3rem 0.5rem", color: "#166534" }}
                >
                  {hasGeminiApiKey() ? "Gemini Key Configured" : "+ Add Gemini API Key"}
                </button>
              </div>
            </div>

            <div
              style={{
                background: "#ffffff",
                padding: "1rem",
                borderRadius: "var(--radius-md)",
                border: "1px solid #bbf7d0",
                fontSize: "0.88rem",
                lineHeight: 1.6,
                color: "var(--color-text-primary)",
                marginBottom: "0.85rem",
              }}
            >
              <strong style={{ color: "#166534" }}>Automated Finding: </strong>
              {geminiAnalysis?.synopsis ||
                caseItem.ai_summary ||
                "Rule engine identified potential statutory non-compliance. Cross-referenced AICTE permanent institution repository and parallel cell registries."}
            </div>

            {/* Extracted Norms and Entities */}
            {geminiAnalysis && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: "0.75rem",
                  marginBottom: "0.85rem",
                }}
              >
                {geminiAnalysis.statutory_clauses?.length > 0 && (
                  <div
                    style={{
                      background: "#f8fafc",
                      padding: "0.65rem 0.85rem",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        fontSize: "0.72rem",
                        textTransform: "uppercase",
                        fontWeight: 700,
                        color: "#475569",
                        marginBottom: "0.35rem",
                      }}
                    >
                      Statutory Clauses &amp; AICTE Regulations
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      {geminiAnalysis.statutory_clauses.map((clause, idx) => (
                        <span
                          key={idx}
                          className="badge"
                          style={{
                            background: "#ecfdf5",
                            color: "#065f46",
                            border: "1px solid #a7f3d0",
                            fontSize: "0.72rem",
                          }}
                        >
                          {clause}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {geminiAnalysis.extracted_entities?.length > 0 && (
                  <div
                    style={{
                      background: "#f8fafc",
                      padding: "0.65rem 0.85rem",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        fontSize: "0.72rem",
                        textTransform: "uppercase",
                        fontWeight: 700,
                        color: "#475569",
                        marginBottom: "0.35rem",
                      }}
                    >
                      Extracted Named Entities &amp; Citations
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      {geminiAnalysis.extracted_entities.map((ent, idx) => (
                        <span
                          key={idx}
                          className="badge"
                          style={{
                            background: "#eff6ff",
                            color: "#1e40af",
                            border: "1px solid #bfdbfe",
                            fontSize: "0.72rem",
                          }}
                        >
                          {ent}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Overlap Mitigation Action if present */}
            {geminiAnalysis?.overlap_action && (
              <div
                style={{
                  background: "#fffbeb",
                  border: "1px solid #fcd34d",
                  borderRadius: "var(--radius-sm)",
                  padding: "0.65rem 0.85rem",
                  marginBottom: "0.85rem",
                  fontSize: "0.82rem",
                  color: "#92400e",
                  lineHeight: 1.5,
                }}
              >
                <strong>Inter-Bureau Conflict Mitigation: </strong>
                {geminiAnalysis.overlap_action}
              </div>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#f0fdf4",
                padding: "0.85rem 1rem",
                borderRadius: "var(--radius-md)",
                border: "1px solid #dcfce7",
                flexWrap: "wrap",
                gap: "0.75rem",
              }}
            >
              <div>
                <span
                  className="small muted"
                  style={{
                    display: "block",
                    fontSize: "0.72rem",
                    textTransform: "uppercase",
                    fontWeight: 700,
                    color: "#166534",
                  }}
                >
                  Suggested Next Action Required
                </span>
                <strong style={{ fontSize: "0.9rem", color: "#155a37" }}>
                  {geminiAnalysis?.suggested_action ||
                    caseItem.ai_suggested_next_action ||
                    caseItem.next_action_required ||
                    "Serve regulatory directive to Principal within 3 working days"}
                </strong>
              </div>
              {has("case.note.create") && (
                <button
                  type="button"
                  className="button button-secondary"
                  style={{
                    fontSize: "0.82rem",
                    borderColor: "#86efac",
                    color: "#166534",
                    background: "#ffffff",
                  }}
                  onClick={() => {
                    setNoteText(
                      `[AI Recommended Action] ${geminiAnalysis?.suggested_action || caseItem.ai_suggested_next_action || caseItem.next_action_required || "Serve regulatory directive"}`,
                    );
                    setShowNoteModal(true);
                  }}
                >
                  + Record as Official Note
                </button>
              )}
            </div>
          </div>

          <div className="case-overview-grid">
          <div className="card">
            <h3 style={{ marginBottom: "0.75rem" }}>
              Grievance Statement &amp; Facts
            </h3>
            <div
              style={{
                background: "var(--color-canvas)",
                padding: "1.25rem",
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--color-border)",
                whiteSpace: "pre-wrap",
                lineHeight: 1.6,
                fontSize: "0.92rem",
                color: "var(--color-text-primary)",
              }}
            >
              {caseItem.description}
            </div>

            <h4 style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>
              Category Classification
            </h4>
            <p className="small muted">
              Category: {caseItem.category_name}. Target:{" "}
              {formatDateTime((caseItem as any).target_resolution_date)}.
            </p>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: "0.75rem" }}>Institutional Profile</h3>
            <dl
              className="detail-list"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              <div>
                <dt className="small muted">Official Name</dt>
                <dd style={{ fontWeight: 600 }}>{caseItem.institution_name}</dd>
              </div>
              <div>
                <dt className="small muted">AICTE Permanent ID</dt>
                <dd className="mono">
                  {caseItem.institution_code || "Not recorded"}
                </dd>
              </div>
              <div>
                <dt className="small muted">Regional Office</dt>
                <dd>
                  {caseItem.institution_region || "Northern Regional Office"}
                </dd>
              </div>
            </dl>

            <div
              style={{
                marginTop: "1.5rem",
                paddingTop: "1rem",
                borderTop: "1px solid var(--color-border-subtle)",
              }}
            >
              <span className="small muted">Intake Source</span>
              <p style={{ margin: "0.25rem 0 0", fontWeight: 600 }}>
                {caseItem.source_submission_id}
              </p>
            </div>
          </div>
        </div>
        </>
      )}

      {/* TAB 2: ASSIGNMENTS */}
      {activeTab === "assignments" && (
        <div className="card">
          <div className="card-header-row">
            <div>
              <h3 className="card-title">Assigned Officers &amp; Bureaus</h3>
              <p className="small muted">
                Workload ownership and cross-bureau assignments.
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className="button button-secondary"
                disabled={!has("case.assign.bureau")}
                onClick={() => setShowAssignBureauModal(true)}
              >
                + Add Collaborating Bureau
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={!has("case.assign.officer")}
                onClick={() => {
                  setTargetBureauAssignId(caseItem.lead_bureau_id || "");
                  setTargetBureauId(caseItem.lead_bureau_id || "");
                  if (has("case.assign.officer"))
                    setShowAssignOfficerModal(true);
                }}
              >
                + Assign Officer
              </button>
            </div>
          </div>

          <h4 style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>
            Officer Assignments
          </h4>
          {officerAssignments.length === 0 ? (
            <p className="small muted">
              No officer has been designated as lead investigator yet.
            </p>
          ) : (
            <table className="data-table" style={{ marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th>Officer</th>
                  <th>Bureau</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Assigned Date</th>
                </tr>
              </thead>
              <tbody>
                {officerAssignments.map((oa) => (
                  <tr key={oa.officer_assignment_id}>
                    <td>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.6rem",
                        }}
                      >
                        <span
                          className="persona-avatar-circle small"
                          style={{ backgroundColor: "#155a37" }}
                        >
                          {oa.officer_name
                            .split(" ")
                            .map((n) => n[0])
                            .slice(0, 2)
                            .join("")}
                        </span>
                        <strong>{oa.officer_name}</strong>
                      </div>
                    </td>
                    <td>{oa.bureau_name}</td>
                    <td>
                      <span className="badge badge-priority-normal">
                        {oa.role.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-status-resolved">
                        {oa.status}
                      </span>
                    </td>
                    <td>{formatDateTime(oa.assigned_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h4 style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>
            Involved Bureaus
          </h4>
          <table className="data-table">
            <thead>
              <tr>
                <th>Bureau</th>
                <th>Role</th>
                <th>Status</th>
                <th>Assigned Date</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>
                    {caseItem.lead_bureau_name} ({caseItem.lead_bureau_code})
                  </strong>
                </td>
                <td>
                  <span className="badge badge-priority-high">Lead Bureau</span>
                </td>
                <td>
                  <span className="badge badge-status-resolved">Active</span>
                </td>
                <td>{formatDateTime(caseItem.opened_at)}</td>
              </tr>
              {collaboratingBureaus.map((cb) => (
                <tr key={cb.bureau_id}>
                  <td>
                    {cb.bureau_name} ({cb.bureau_code})
                  </td>
                  <td>
                    <span className="badge badge-priority-normal">
                      Collaborating
                    </span>
                  </td>
                  <td>
                    <span className="badge badge-status-assigned">
                      {cb.assignment_status}
                    </span>
                  </td>
                  <td>{formatDateTime(cb.assigned_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 3: TIMELINE & AUDIT LOG */}
      {activeTab === "timeline" && (
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: "1.25rem" }}>
            Immutable Action History &amp; Audit Trail
          </h3>

          <ol
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            {actionHistory.map((act) => (
              <li
                key={act.action_id}
                style={{
                  display: "flex",
                  gap: "1rem",
                  paddingBottom: "1rem",
                  borderBottom: "1px solid var(--color-border-subtle)",
                }}
              >
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    background: "var(--color-accent-soft)",
                    color: "var(--color-accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <IconHistory className="w-4 h-4" />
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "0.25rem",
                    }}
                  >
                    <strong style={{ fontSize: "0.88rem" }}>
                      {act.action_description}
                    </strong>
                    <span className="small muted">
                      {formatDateTime(act.created_at)}
                    </span>
                  </div>
                  <div className="small muted">
                    Performed by:{" "}
                    <strong>
                      {(act as any).actor_name || "Authorized Official"}
                    </strong>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* TAB 4: NOTES */}
      {activeTab === "notes" && (
        <div className="card">
          <div className="card-header-row">
            <div>
              <h3 className="card-title">Case Notes &amp; Observations</h3>
              <p className="small muted">
                Shared observations and bureau-private deliberations.
              </p>
            </div>
            {has("case.note.create") && (
              <button
                type="button"
                className="button button-primary"
                onClick={() => setShowNoteModal(true)}
              >
                <IconPlus className="w-4 h-4" /> Add Note
              </button>
            )}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
              marginTop: "1rem",
            }}
          >
            {notes && notes.length > 0 ? (
              notes.map((n) => (
                <div
                  key={n.note_id}
                  style={{
                    background:
                      n.visibility === "bureau_private"
                        ? "#fef3c7"
                        : "var(--color-surface-white)",
                    border: `1px solid ${n.visibility === "bureau_private" ? "#fde68a" : "var(--color-border)"}`,
                    borderRadius: "var(--radius-lg)",
                    padding: "1.1rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "0.5rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      <strong>{n.author_name}</strong>
                      <span className="small muted">
                        ({n.bureau_name || "Approval Bureau"})
                      </span>
                      <span
                        className={`badge ${n.visibility === "bureau_private" ? "badge-priority-high" : "badge-priority-normal"}`}
                      >
                        {n.visibility === "bureau_private"
                          ? "Bureau Private"
                          : "Shared"}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      <span className="small muted">
                        {formatDateTime(n.created_at)}
                      </span>
                      {has("case.note.delete") && (
                        <button
                          type="button"
                          className="button button-quiet"
                          style={{
                            padding: "0.2rem 0.4rem",
                            fontSize: "0.75rem",
                            color: "var(--color-danger)",
                          }}
                          onClick={() => handleDeleteNote(n.note_id)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.5,
                      fontSize: "0.88rem",
                    }}
                  >
                    {n.note_text}
                  </div>
                </div>
              ))
            ) : (
              <p className="small muted">No internal notes added yet.</p>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: EVIDENCE & ATTACHMENTS (REAL BROWSER PERSISTENCE & PREVIEW) */}
      {activeTab === "attachments" && (
        <div className="card">
          <div className="card-header-row">
            <div>
              <h3 className="card-title">
                Evidence &amp; Uploaded Attachments
              </h3>
              <p className="small muted">
                Original supporting files with preview and download.
              </p>
            </div>
            {has("attachment.upload") && (
              <button
                type="button"
                className="button button-primary"
                onClick={() => setShowAttachmentModal(true)}
              >
                <IconPaperclip className="w-4 h-4" /> Upload Document
              </button>
            )}
          </div>

          <table className="data-table" style={{ marginTop: "1rem" }}>
            <thead>
              <tr>
                <th>Document Filename</th>
                <th>Classification</th>
                <th>File Size</th>
                <th>Uploaded By</th>
                <th>Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {attachments && attachments.length > 0 ? (
                attachments.map((att) => (
                  <tr key={att.attachment_id}>
                    <td>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        <IconPaperclip className="w-4 h-4 text-accent" />
                        <div>
                          <strong>
                            {att.filename || att.original_filename}
                          </strong>
                          {att.description && (
                            <div className="small muted">{att.description}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-priority-normal">
                        {(att.attachment_type || "Evidence").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td>
                      {formatFileSize(
                        att.file_size_bytes || att.file_size || 1024 * 50,
                      )}
                    </td>
                    <td>{att.uploaded_by_name || "Officer"}</td>
                    <td>{formatDateTime(att.uploaded_at)}</td>
                    <td>
                      {att.is_quarantined ? (
                        <span className="badge badge-priority-critical">
                          QUARANTINED
                        </span>
                      ) : (
                        <span className="badge badge-status-resolved">
                          Available
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.4rem" }}>
                        <button
                          type="button"
                          className="button button-secondary"
                          style={{
                            padding: "0.25rem 0.6rem",
                            fontSize: "0.75rem",
                          }}
                          onClick={() => setPreviewAttachment(att)}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          className="button button-quiet"
                          style={{
                            padding: "0.25rem 0.6rem",
                            fontSize: "0.75rem",
                          }}
                          onClick={() => handleDownloadAttachment(att)}
                          disabled={att.is_quarantined}
                        >
                          <IconDownload className="w-3.5 h-3.5" /> Download
                        </button>
                        {!att.is_quarantined &&
                          has("attachment.quarantine") && (
                            <button
                              type="button"
                              className="button button-quiet"
                              style={{
                                padding: "0.25rem 0.5rem",
                                fontSize: "0.72rem",
                                color: "var(--color-danger)",
                              }}
                              onClick={() => handleQuarantine(att)}
                            >
                              Quarantine
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      textAlign: "center",
                      padding: "2rem",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    No attachments uploaded for this case yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 6: TRANSFERS */}
      {activeTab === "transfers" && (
        <div className="card">
          <div className="card-header-row">
            <div>
              <h3 className="card-title">Case Ownership Transfers</h3>
              <p className="small muted">
                Formal handover of lead bureau responsibility.
              </p>
            </div>
            {has("case.transfer.manage") && (
              <button
                type="button"
                className="button button-primary"
                onClick={() => setShowTransferModal(true)}
              >
                + Request Case Transfer
              </button>
            )}
          </div>

          <table className="data-table" style={{ marginTop: "1rem" }}>
            <thead>
              <tr>
                <th>From Bureau</th>
                <th>To Bureau</th>
                <th>Type</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Requested Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {state.transfers
                .filter((t) => t.case_id === caseItem.case_id)
                .map((trf) => (
                  <tr key={trf.transfer_id}>
                    <td>{trf.from_bureau_name}</td>
                    <td>
                      <strong>{trf.to_bureau_name}</strong>
                    </td>
                    <td>
                      <span className="badge badge-priority-normal">
                        {trf.transfer_type}
                      </span>
                    </td>
                    <td style={{ maxWidth: "240px" }}>{trf.reason}</td>
                    <td>
                      <span
                        className={`badge ${trf.status === "approved" ? "badge-status-resolved" : "badge-priority-high"}`}
                      >
                        {trf.status}
                      </span>
                    </td>
                    <td>{formatDateTime(trf.requested_at)}</td>
                    <td>
                      {trf.status === "pending" &&
                        has("case.transfer.manage") && (
                          <button
                            className="button button-quiet"
                            onClick={() => {
                              const reason = prompt(
                                "Reason for declining this transfer:",
                              );
                              if (reason?.trim()) {
                                simulationStore.rejectTransfer(
                                  trf.transfer_id,
                                  reason,
                                );
                                void reload();
                              }
                            }}
                          >
                            Decline
                          </button>
                        )}
                      {trf.status === "pending" &&
                        has("case.transfer.manage") && (
                          <button
                            type="button"
                            className="button button-primary"
                            style={{
                              padding: "0.25rem 0.6rem",
                              fontSize: "0.75rem",
                            }}
                            onClick={() => {
                              simulationStore.approveTransfer(trf.transfer_id);
                              reload();
                            }}
                          >
                            Approve Transfer
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              {state.transfers.filter((t) => t.case_id === caseItem.case_id)
                .length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      textAlign: "center",
                      padding: "2rem",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    No bureau transfers requested for this case.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 7: CROSS-BUREAU ACCESS GRANTS */}
      {activeTab === "access" && (
        <div className="card">
          <div className="card-header-row">
            <div>
              <h3 className="card-title">Cross-Bureau Access Grants</h3>
              <p className="small muted">
                Time-bound visibility and collaboration access for outside
                bureaus.
              </p>
            </div>
            {activePersona.bureauId && (
              <button
                type="button"
                className="button button-primary"
                onClick={() => setShowAccessModal(true)}
              >
                + Request Cross-Bureau Access
              </button>
            )}
          </div>

          <table className="data-table" style={{ marginTop: "1rem" }}>
            <thead>
              <tr>
                <th>Requesting Bureau</th>
                <th>Requested By</th>
                <th>Scope</th>
                <th>Justification</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {accessGrants && accessGrants.length > 0 ? (
                accessGrants.map((ag) => (
                  <tr key={ag.grant_id}>
                    <td>
                      <strong>{ag.grantee_bureau_name}</strong>
                    </td>
                    <td>{ag.grantee_user_name || "Officer"}</td>
                    <td>
                      <span className="badge badge-priority-normal">
                        {ag.access_level}
                      </span>
                    </td>
                    <td style={{ maxWidth: "220px" }}>{ag.justification}</td>
                    <td>
                      <span
                        className={`badge ${ag.status === "approved" ? "badge-status-resolved" : ag.status === "revoked" ? "badge-status-closed" : "badge-priority-high"}`}
                      >
                        {ag.status}
                      </span>
                    </td>
                    <td>
                      {ag.expires_at
                        ? formatDateTime(ag.expires_at)
                        : "30 days from grant"}
                    </td>
                    <td>
                      {ag.status === "pending" && has("case.access.manage") && (
                        <button
                          className="button button-quiet"
                          onClick={() => {
                            const reason = prompt(
                              "Reason for denying this access request:",
                            );
                            if (reason?.trim()) {
                              simulationStore.rejectAccess(ag.grant_id, reason);
                              void reloadGrants();
                            }
                          }}
                        >
                          Deny
                        </button>
                      )}
                      {ag.status === "pending" && has("case.access.manage") && (
                        <button
                          type="button"
                          className="button button-primary"
                          style={{
                            padding: "0.25rem 0.6rem",
                            fontSize: "0.75rem",
                          }}
                          onClick={() => {
                            simulationStore.approveAccess(ag.grant_id);
                            reloadGrants();
                          }}
                        >
                          Approve Grant
                        </button>
                      )}
                      {ag.status === "approved" &&
                        has("case.access.manage") && (
                          <button
                            type="button"
                            className="button button-quiet"
                            style={{
                              padding: "0.25rem 0.6rem",
                              fontSize: "0.75rem",
                              color: "var(--color-danger)",
                            }}
                            onClick={() => {
                              const reason = prompt(
                                "Specify revocation reason:",
                              );
                              if (reason) {
                                simulationStore.revokeAccess(
                                  ag.grant_id,
                                  reason,
                                );
                                reloadGrants();
                              }
                            }}
                          >
                            Revoke
                          </button>
                        )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      textAlign: "center",
                      padding: "2rem",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    No cross-bureau access requests found for this case.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL 1: STATUS TRANSITION */}
      {showStatusModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowStatusModal(false)}
        >
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Execute Status Transition</h3>
              <button
                type="button"
                className="btn-icon-close"
                onClick={() => setShowStatusModal(false)}
              >
                <IconClose className="w-4 h-4" />
              </button>
            </div>
            {statusError && (
              <div className="badge badge-priority-critical">{statusError}</div>
            )}
            <form onSubmit={handleStatusTransition}>
              <label>
                Permitted Target Status
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                >
                  {permittedStatuses.map((st) => (
                    <option key={st} value={st}>
                      {caseStatusLabel(st)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reason for status change
                <textarea
                  rows={3}
                  required
                  placeholder="Record mandatory rationale for this status update..."
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                />
              </label>
              <div className="modal-footer">
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setShowStatusModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={statusSubmitting}
                >
                  {statusSubmitting ? "Updating..." : "Execute Status Change"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD NOTE */}
      {showNoteModal && (
        <div className="modal-backdrop" onClick={() => setShowNoteModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Case Note</h3>
              <button
                type="button"
                className="btn-icon-close"
                onClick={() => setShowNoteModal(false)}
              >
                <IconClose className="w-4 h-4" />
              </button>
            </div>
            {noteError && (
              <div
                className="badge badge-priority-critical"
                style={{ margin: "0.5rem 1.5rem" }}
              >
                {noteError}
              </div>
            )}
            <form onSubmit={handleAddNote}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "1rem",
                }}
              >
                <label>
                  Visibility Scope
                  <select
                    value={noteVisibility}
                    onChange={(e) => setNoteVisibility(e.target.value as any)}
                  >
                    <option value="shared">
                      Shared (All Assigned Bureaus)
                    </option>
                    <option
                      disabled={!activePersona.bureauId}
                      value="bureau_private"
                    >
                      Bureau-Private (My Bureau Only)
                    </option>
                  </select>
                </label>
                <label>
                  Note Type
                  <select
                    value={noteType}
                    onChange={(e) => setNoteType(e.target.value as any)}
                  >
                    <option value="general">General</option>
                    <option value="internal_review">Internal Review</option>
                    <option value="resolution">Resolution Order</option>
                    <option value="handover">Handover</option>
                  </select>
                </label>
              </div>
              <label>
                Note Content
                <textarea
                  rows={4}
                  required
                  placeholder="Record observations, directives, or inspection findings..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
              </label>
              <div className="modal-footer">
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setShowNoteModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={noteSubmitting}
                >
                  {noteSubmitting ? "Saving..." : "Save Note"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: UPLOAD ATTACHMENT */}
      {showAttachmentModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowAttachmentModal(false)}
        >
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Upload Evidence Attachment</h3>
              <button
                type="button"
                className="btn-icon-close"
                onClick={() => setShowAttachmentModal(false)}
              >
                <IconClose className="w-4 h-4" />
              </button>
            </div>
            {attachError && (
              <div className="badge badge-priority-critical">{attachError}</div>
            )}
            <form onSubmit={handleUploadAttachment}>
              <label>
                Select File (PDF, PNG, JPG, DOCX, TXT)
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.txt"
                  required
                  onChange={handleFileChange}
                />
              </label>
              {selectedFile && (
                <div
                  className="small muted"
                  style={{ marginBottom: "0.75rem" }}
                >
                  Selected: <strong>{selectedFile.name}</strong> (
                  {formatFileSize(selectedFile.size)})
                </div>
              )}
              <label>
                Classification
                <select
                  value={attachType}
                  onChange={(e) => setAttachType(e.target.value)}
                >
                  <option value="supporting_document">
                    Supporting Document
                  </option>
                  <option value="inspection_report">Inspection Report</option>
                  <option value="show_cause_notice">Show Cause Notice</option>
                  <option value="institution_reply">
                    Institution Response
                  </option>
                  <option value="resolution_order">Resolution Order</option>
                </select>
              </label>
              <label>
                Description
                <input
                  type="text"
                  placeholder="Brief summary of document..."
                  value={attachDescription}
                  onChange={(e) => setAttachDescription(e.target.value)}
                />
              </label>
              <div className="modal-footer">
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setShowAttachmentModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={attachSubmitting}
                >
                  {attachSubmitting ? "Uploading..." : "Save Attachment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PREVIEW MODAL */}
      {previewAttachment && (
        <div
          className="modal-backdrop"
          onClick={() => setPreviewAttachment(null)}
        >
          <div
            className="modal-dialog"
            style={{ width: "800px", maxHeight: "85vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>
                Document Preview:{" "}
                {previewAttachment.filename ||
                  previewAttachment.original_filename}
              </h3>
              <button
                type="button"
                className="btn-icon-close"
                onClick={() => setPreviewAttachment(null)}
              >
                <IconClose className="w-4 h-4" />
              </button>
            </div>
            <div
              style={{
                height: "450px",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#f8fafc",
                borderRadius: "var(--radius-lg)",
              }}
            >
              {previewAttachment.mime_type?.startsWith("image/") ? (
                <img
                  src={previewAttachment.data_url}
                  alt={previewAttachment.filename}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                  }}
                />
              ) : previewAttachment.mime_type?.startsWith("text/") ? (
                <iframe
                  sandbox=""
                  src={previewAttachment.data_url}
                  title="Text evidence preview"
                  style={{ width: "100%", height: "100%", border: 0 }}
                />
              ) : previewAttachment.mime_type === "application/pdf" ? (
                <PdfPreview source={previewAttachment.data_url} />
              ) : (
                <div style={{ padding: "2rem", textAlign: "center" }}>
                  <IconPaperclip
                    className="w-12 h-12 text-accent"
                    style={{ margin: "0 auto 1rem" }}
                  />
                  <p>
                    <strong>
                      {previewAttachment.filename ||
                        previewAttachment.original_filename}
                    </strong>
                  </p>
                  <p className="small muted">
                    Binary document (
                    {formatFileSize(previewAttachment.file_size || 1024 * 50)})
                  </p>
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => handleDownloadAttachment(previewAttachment)}
                  >
                    Download to View
                  </button>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="button button-quiet"
                onClick={() => setPreviewAttachment(null)}
              >
                Close Preview
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => handleDownloadAttachment(previewAttachment)}
              >
                <IconDownload className="w-4 h-4" /> Download File
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: ASSIGN OFFICER */}
      {showAssignOfficerModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowAssignOfficerModal(false)}
        >
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Assign Officer</h3>
              <button
                type="button"
                className="btn-icon-close"
                onClick={() => setShowAssignOfficerModal(false)}
              >
                <IconClose className="w-4 h-4" />
              </button>
            </div>
            {officerError && (
              <div
                className="badge badge-priority-critical"
                style={{ margin: "0.5rem 1.5rem" }}
              >
                {officerError}
              </div>
            )}
            <form onSubmit={handleAssignOfficer}>
              <label>
                Assignment bureau
                <select
                  value={targetBureauAssignId}
                  onChange={(e) => {
                    setTargetBureauAssignId(e.target.value);
                    setOfficerUserId("");
                  }}
                >
                  {[
                    caseItem.lead_bureau_id,
                    ...collaboratingBureaus
                      .filter((b) => b.assignment_status === "active")
                      .map((b) => b.bureau_id),
                  ]
                    .filter((id, i, all) => all.indexOf(id) === i)
                    .map((id) => (
                      <option value={id || ""} key={id}>
                        {state.bureaus.find((b) => b.id === id)?.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Select Officer
                <select
                  value={officerUserId}
                  onChange={(e) => setOfficerUserId(e.target.value)}
                  required
                >
                  <option value="">-- Choose Officer --</option>
                  {state.bureauMembers
                    .filter(
                      (m) =>
                        m.is_active && m.bureau_id === targetBureauAssignId,
                    )
                    .map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.full_name} ({m.designation}) —{" "}
                        {
                          state.cases.filter(
                            (c) =>
                              c.status !== "closed" &&
                              c.status !== "resolved" &&
                              c.officer_assignments.some(
                                (o) =>
                                  o.officer_id === m.user_id &&
                                  o.status === "active",
                              ),
                          ).length
                        }{" "}
                        active cases
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Officer Role
                <select
                  value={officerRole}
                  onChange={(e) => setOfficerRole(e.target.value as any)}
                >
                  <option value="lead_officer">Lead Responsible Officer</option>
                  <option value="supporting">Supporting Officer</option>
                  <option value="reviewer">Reviewer</option>
                </select>
              </label>
              <label>
                Directives &amp; Scope
                <textarea
                  rows={3}
                  placeholder="Instructions for the investigation..."
                  value={officerNotes}
                  onChange={(e) => setOfficerNotes(e.target.value)}
                />
              </label>
              <div className="modal-footer">
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setShowAssignOfficerModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={officerSubmitting}
                >
                  {officerSubmitting ? "Assigning..." : "Confirm Assignment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: ASSIGN BUREAU */}
      {showAssignBureauModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowAssignBureauModal(false)}
        >
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Collaborating Bureau</h3>
              <button
                type="button"
                className="btn-icon-close"
                onClick={() => setShowAssignBureauModal(false)}
              >
                <IconClose className="w-4 h-4" />
              </button>
            </div>
            {assignError && (
              <div
                className="badge badge-priority-critical"
                style={{ margin: "0.5rem 1.5rem" }}
              >
                {assignError}
              </div>
            )}
            <form onSubmit={handleAssignBureau}>
              <label>
                Bureau
                <select
                  value={selectedBureauId}
                  onChange={(e) => setSelectedBureauId(e.target.value)}
                  required
                >
                  <option value="">-- Choose Bureau --</option>
                  {state.bureaus.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code}: {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Coordination Rationale
                <textarea
                  rows={3}
                  placeholder="Explain why this bureau's review is required..."
                  value={assignReason}
                  onChange={(e) => setAssignReason(e.target.value)}
                />
              </label>
              <div className="modal-footer">
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setShowAssignBureauModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={assignSubmitting}
                >
                  {assignSubmitting ? "Assigning..." : "Assign Bureau"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 6: TRANSFER */}
      {showTransferModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowTransferModal(false)}
        >
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Request Case Transfer</h3>
              <button
                type="button"
                className="btn-icon-close"
                onClick={() => setShowTransferModal(false)}
              >
                <IconClose className="w-4 h-4" />
              </button>
            </div>
            {transferError && (
              <div
                className="badge badge-priority-critical"
                style={{ margin: "0.5rem 1.5rem" }}
              >
                {transferError}
              </div>
            )}
            <form onSubmit={handleRequestTransfer}>
              <label>
                Destination Bureau
                <select
                  value={transferToBureauId}
                  onChange={(e) => setTransferToBureauId(e.target.value)}
                  required
                >
                  <option value="">-- Choose Target Bureau --</option>
                  {state.bureaus
                    .filter((b) => b.id !== caseItem.lead_bureau_id)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code}: {b.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Transfer Type
                <select
                  value={transferType}
                  onChange={(e) => setTransferType(e.target.value as any)}
                >
                  <option value="handover">
                    Handover (Complete transfer of ownership)
                  </option>
                  <option value="lead_change">Lead Change</option>
                  <option value="reassignment">Reassignment</option>
                </select>
              </label>
              <label>
                Justification
                <textarea
                  rows={3}
                  required
                  placeholder="Explain why this case should be transferred..."
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                />
              </label>
              <div className="modal-footer">
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setShowTransferModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={transferSubmitting}
                >
                  {transferSubmitting
                    ? "Submitting..."
                    : "Submit Transfer Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 7: CROSS BUREAU ACCESS REQUEST */}
      {showAccessModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowAccessModal(false)}
        >
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Request Cross-Bureau Access</h3>
              <button
                type="button"
                className="btn-icon-close"
                onClick={() => setShowAccessModal(false)}
              >
                <IconClose className="w-4 h-4" />
              </button>
            </div>
            {accessError && (
              <div
                className="badge badge-priority-critical"
                style={{ margin: "0.5rem 1.5rem" }}
              >
                {accessError}
              </div>
            )}
            <form onSubmit={handleRequestAccess}>
              <label>
                Requested Access Level
                <select
                  value={accessLevel}
                  onChange={(e) => setAccessLevel(e.target.value as any)}
                >
                  <option value="details">View Details (Read-only)</option>
                  <option value="collaborate">
                    Collaborate (Read and Add Actions/Notes)
                  </option>
                </select>
              </label>
              <label>
                Justification
                <textarea
                  rows={3}
                  required
                  placeholder="Explain why your bureau requires access to this case..."
                  value={accessReason}
                  onChange={(e) => setAccessReason(e.target.value)}
                />
              </label>
              <div className="modal-footer">
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setShowAccessModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={accessSubmitting}
                >
                  {accessSubmitting ? "Submitting..." : "Submit Access Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 8: GEMINI API KEY CONFIGURATION */}
      {showKeyModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowKeyModal(false)}
        >
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Configure Google Gemini API Key</h3>
              <button
                type="button"
                className="btn-icon-close"
                onClick={() => setShowKeyModal(false)}
              >
                <IconClose className="w-4 h-4" />
              </button>
            </div>
            <div style={{ padding: "1rem 1.5rem" }}>
              <p className="small muted" style={{ marginTop: 0 }}>
                Enter your Google Gemini API key to activate live generative triage, legal entity extraction, and regulatory synopses powered by Google Gemini 2.0 Flash.
              </p>
              <label style={{ display: "block", marginBottom: "1rem" }}>
                API Key
                <input
                  type="password"
                  placeholder="AIzaSy..."
                  value={keyInput}
                  onChange={(e) => {
                    setKeyInput(e.target.value);
                    setKeyNotice("");
                  }}
                  style={{ width: "100%", fontFamily: "monospace", marginTop: "0.25rem" }}
                />
                <span className="small muted">
                  Key is saved locally in browser storage. Obtain a key at{" "}
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
                    Google AI Studio
                  </a>.
                </span>
              </label>

              {keyNotice && (
                <div className="callout callout-info" style={{ marginBottom: "1rem", fontSize: "0.85rem" }}>
                  {keyNotice}
                </div>
              )}

              <div className="modal-footer" style={{ padding: 0 }}>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => {
                    setKeyInput("");
                    setGeminiApiKey("");
                    setKeyNotice("API Key removed. Reverted to built-in dynamic legal engine.");
                  }}
                >
                  Clear Key
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setShowKeyModal(false)}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={async () => {
                    setGeminiApiKey(keyInput.trim());
                    setShowKeyModal(false);
                    await handleRunAiAnalysis();
                  }}
                >
                  Save &amp; Run Live Triage
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

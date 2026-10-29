import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  IconCheck,
  IconClock,
  IconPaperclip,
  IconSearch,
} from "../components/Icons";
import { useAuth } from "../auth/AuthProvider";
import { storeBinaryFile } from "../simulation/storage";
import { PublicShell } from "../components/PublicShell";
import { useSimulation } from "../simulation/selectors";
import { simulationStore } from "../simulation/simulationStore";
import type { IntakeChannel, SimSubmission } from "../simulation/types";
import type { DemoPortal } from "../types";

export function DemoIntakePage({ portal }: { portal: DemoPortal }) {
  const { has, activePersona } = useAuth();
  const [params] = useSearchParams();
  const personal = activePersona.roleCode === "COMPLAINANT";
  const channel: IntakeChannel =
    portal === "cpgrams" ? "cpgrams" : "aicte_portal";
  const state = useSimulation();

  const [activeTab, setActiveTab] = useState<"submit" | "track">(
    params.get("tab") === "track" ? "track" : "submit",
  );

  // Form State
  const [complainantName, setComplainantName] = useState(
    personal ? activePersona.name : "",
  );
  const [complainantEmail, setComplainantEmail] = useState(
    personal ? activePersona.email : "",
  );
  const [complainantPhone, setComplainantPhone] = useState("");
  const [complainantCategory, setComplainantCategory] = useState("Student");

  const [institutionName, setInstitutionName] = useState("");
  const [institutionPid, setInstitutionPid] = useState("");
  const [categoryId, setCategoryId] = useState(state.categories[0]?.id || "");
  const [subject, setSubject] = useState("");
  const [portalReference, setPortalReference] = useState("");
  const [description, setDescription] = useState("");
  const [reliefSought, setReliefSought] = useState("");
  const [consent, setConsent] = useState(false);
  const [language, setLanguage] = useState<"en" | "hi">("en");

  // File Attachment
  const [attachedFiles, setAttachedFiles] = useState<
    Array<{
      filename: string;
      mime_type: string;
      file_size: number;
      data_url?: string;
    }>
  >([]);

  // Submission Result
  const [receipt, setReceipt] = useState<SimSubmission | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Track Status State
  const [trackQuery, setTrackQuery] = useState(params.get("reference") || "");
  const [trackedSubmission, setTrackedSubmission] =
    useState<SimSubmission | null>(
      () =>
        state.submissions.find(
          (s) =>
            s.channel === channel &&
            s.tracking_code === params.get("reference"),
        ) || null,
    );
  const [trackSearched, setTrackSearched] = useState(
    Boolean(params.get("reference")),
  );

  // Handle Institution Preset Select
  const handleSelectPresetInstitution = (instId: string) => {
    const inst = state.institutions.find((i) => i.id === instId);
    if (inst) {
      setInstitutionName(inst.official_name);
      setInstitutionPid(inst.aicte_permanent_id);
    }
  };

  // Handle File Upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.size > 25 * 1024 * 1024) {
        setSubmitError("Each file must be 25 MB or smaller.");
        continue;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        setAttachedFiles((prev) => [
          ...prev,
          {
            filename: f.name,
            mime_type: f.type || "application/octet-stream",
            file_size: f.size,
            data_url: event.target?.result as string,
          },
        ]);
      };
      reader.readAsDataURL(f);
    }
  };

  // Submit Complaint
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!institutionName.trim() || !subject.trim() || !description.trim())
      return;

    setIsSubmitting(true);
    try {
      const savedFiles = await Promise.all(
        attachedFiles.map(async (file) => {
          if (!file.data_url)
            throw new Error("Wait for the file to finish loading.");
          const id = crypto.randomUUID();
          await storeBinaryFile(id, file.data_url);
          return { ...file, data_url: `idb:${id}` };
        }),
      );
      const sub = simulationStore.submitComplaint({
        channel,
        complainant_name: complainantName.trim(),
        complainant_email: complainantEmail.trim(),
        complainant_phone: complainantPhone.trim(),
        complainant_category: complainantCategory,
        institution_name: institutionName.trim(),
        institution_permanent_id: institutionPid.trim() || undefined,
        category_id: categoryId,
        subject,
        description,
        language,
        relief_sought: reliefSought.trim() || undefined,
        attachments: savedFiles,
        portal_reference:
          channel === "cpgrams"
            ? portalReference.trim() || undefined
            : undefined,
      });

      setReceipt(sub);
      setTrackedSubmission(sub);
      setSubmitError("");
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Could not save the complaint.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Tracking Search
  const handleTrackSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setTrackSearched(true);
    const q = trackQuery.trim().toLowerCase();
    const found = state.submissions.find(
      (s) =>
        s.channel === channel &&
        (s.tracking_code.toLowerCase() === q ||
          s.submission_number.toLowerCase() === q ||
          (channel === "cpgrams" &&
            s.source_metadata?.portal_reference?.toLowerCase() === q) ||
          (s.canonical_case_number &&
            s.canonical_case_number.toLowerCase() === q)),
    );
    setTrackedSubmission(found || null);
  };

  const trackedCase = state.cases.find(
    (c) => c.case_id === trackedSubmission?.canonical_case_id,
  );
  return (
    <PublicShell>
      <div
        style={{ maxWidth: "900px", margin: "0 auto", paddingBottom: "2rem" }}
      >
        {/* Top Portal Banner */}
        <div
          style={{
            background:
              channel === "cpgrams"
                ? "linear-gradient(135deg, #1e3a8a 0%, #172554 100%)"
                : "linear-gradient(135deg, #155a37 0%, #0d3a23 100%)",
            color: "white",
            borderRadius: "var(--radius-xl)",
            padding: "2rem 2.25rem",
            marginBottom: "1.75rem",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "1rem",
            }}
          >
            <div>
              <span
                style={{
                  fontSize: "0.74rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: channel === "cpgrams" ? "#93c5fd" : "#86efac",
                  display: "block",
                  marginBottom: "0.25rem",
                }}
              >
                {channel === "cpgrams"
                  ? "AICTE OneDesk · CPGRAMS intake"
                  : "AICTE OneDesk · Institution grievances"}
              </span>
              <h1
                style={{
                  color: "white",
                  fontSize: "1.65rem",
                  marginBottom: "0.35rem",
                }}
              >
                {channel === "cpgrams"
                  ? "CPGRAMS Complaint Intake"
                  : "AICTE OneDesk Public Grievance Portal"}
              </h1>
              <p
                style={{
                  color: "rgba(255, 255, 255, 0.85)",
                  margin: 0,
                  fontSize: "0.9rem",
                }}
              >
                Lodge a grievance against an AICTE-approved institution with
                instant tracking code.
              </p>
            </div>

            <div
              className="pill-tabs"
              style={{
                background: "rgba(255, 255, 255, 0.15)",
                border: "none",
              }}
            >
              <button
                type="button"
                className={`pill-tab ${activeTab === "submit" ? "active" : ""}`}
                onClick={() => setActiveTab("submit")}
                style={{ color: "white" }}
              >
                Lodge Grievance
              </button>
              <button
                type="button"
                className={`pill-tab ${activeTab === "track" ? "active" : ""}`}
                onClick={() => setActiveTab("track")}
                style={{ color: "white" }}
              >
                Track Status
              </button>
            </div>
          </div>
        </div>

        <section
          className={`portal-experience ${channel === "cpgrams" ? "cpgrams-experience" : "aicte-experience"}`}
        >
          <h2>
            {channel === "cpgrams"
              ? "Grievance referral & source tracking"
              : "Institution complaint & evidence"}
          </h2>
          <p>
            {channel === "cpgrams"
              ? "Record the originating grievance reference where available. OneDesk preserves the CPGRAMS source while institution verification and human duplicate review happen in the common intake system."
              : "Describe the institution issue in your original language. Institution checks, evidence, and requested relief accompany your complaint into the review queue."}
          </p>
          <div className="portal-process">
            <span>
              {channel === "cpgrams"
                ? "1 · Record referral"
                : "1 · Describe institution issue"}
            </span>
            <span>2 · Verify institution</span>
            <span>
              {channel === "cpgrams"
                ? "3 · Track referral progress"
                : "3 · Review & route complaint"}
            </span>
          </div>
        </section>
        {/* VIEW 1: SUBMIT COMPLAINT FORM */}
        {activeTab === "submit" && (
          <>
            {receipt ? (
              /* Confirmation Receipt Screen */
              <div
                className="card"
                style={{ textAlign: "center", padding: "2.5rem 2rem" }}
              >
                <div
                  style={{
                    width: "60px",
                    height: "60px",
                    borderRadius: "50%",
                    background: "var(--color-success-soft)",
                    color: "var(--color-success)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 1.25rem",
                  }}
                >
                  <IconCheck className="w-8 h-8" />
                </div>

                <h2 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
                  {channel === "cpgrams"
                    ? "Grievance referral recorded"
                    : "Institution complaint received"}
                </h2>
                <p
                  className="small muted"
                  style={{ maxWidth: "540px", margin: "0 auto 1.5rem" }}
                >
                  Your complaint is saved in this OneDesk workspace. No filing
                  has been sent to an external AICTE or CPGRAMS service.
                </p>

                <div
                  style={{
                    background: "var(--color-canvas)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-xl)",
                    padding: "1.5rem",
                    maxWidth: "460px",
                    margin: "0 auto 2rem",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "0.75rem",
                    }}
                  >
                    <span className="small muted">Tracking Reference</span>
                    <strong
                      style={{
                        fontSize: "1.1rem",
                        color: "var(--color-accent)",
                      }}
                    >
                      {receipt.tracking_code}
                    </strong>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "0.75rem",
                    }}
                  >
                    <span className="small muted">Submission Number</span>
                    <span className="mono font-semibold">
                      {receipt.submission_number}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "0.75rem",
                    }}
                  >
                    <span className="small muted">Target Institution</span>
                    <strong>{receipt.institution_name_submitted}</strong>
                  </div>
                  <div
                    style={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <span className="small muted">Initial Status</span>
                    <span className="badge badge-priority-normal">
                      {receipt.institution_verified
                        ? "Under Duplicate Review"
                        : "Pending Verification"}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    justifyContent: "center",
                  }}
                >
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => {
                      setActiveTab("track");
                      setTrackQuery(receipt.tracking_code);
                      setTrackedSubmission(receipt);
                      setTrackSearched(true);
                    }}
                  >
                    <IconSearch className="w-4 h-4" /> Track Complaint Status
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      setReceipt(null);
                      setSubject("");
                      setDescription("");
                      setAttachedFiles([]);
                    }}
                  >
                    + Lodge Another Grievance
                  </button>
                </div>
              </div>
            ) : (
              /* Submission Form */
              <div className="card">
                <form onSubmit={handleSubmit}>
                  {submitError && (
                    <p role="alert" className="error-panel">
                      {submitError}
                    </p>
                  )}
                  <label>
                    Complaint language
                    <select
                      value={language}
                      onChange={(e) =>
                        setLanguage(e.target.value as typeof language)
                      }
                    >
                      <option value="en">English</option>
                      <option value="hi">हिन्दी</option>
                    </select>
                  </label>
                  {channel === "cpgrams" && (
                    <label>
                      Originating grievance reference (optional)
                      <input
                        value={portalReference}
                        onChange={(e) => setPortalReference(e.target.value)}
                        placeholder="Enter the source reference supplied with this referral"
                      />
                    </label>
                  )}
                  <h3
                    style={{
                      marginBottom: "1.25rem",
                      paddingBottom: "0.75rem",
                      borderBottom: "1px solid var(--color-border-subtle)",
                    }}
                  >
                    1. Complainant Identification
                  </h3>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "1rem",
                    }}
                  >
                    <label>
                      Full Name
                      <input
                        type="text"
                        required
                        readOnly={personal}
                        value={complainantName}
                        onChange={(e) => setComplainantName(e.target.value)}
                      />
                    </label>
                    <label>
                      Email Address
                      <input
                        type="email"
                        required
                        readOnly={personal}
                        value={complainantEmail}
                        onChange={(e) => setComplainantEmail(e.target.value)}
                      />
                    </label>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "1rem",
                    }}
                  >
                    <label>
                      Mobile Number
                      <input
                        type="tel"
                        required
                        value={complainantPhone}
                        onChange={(e) => setComplainantPhone(e.target.value)}
                      />
                    </label>
                    <label>
                      Complainant Category
                      <select
                        value={complainantCategory}
                        onChange={(e) => setComplainantCategory(e.target.value)}
                      >
                        <option value="Student">
                          Student (Enrolled / Aspirant)
                        </option>
                        <option value="Parent">Parent / Guardian</option>
                        <option value="Faculty">
                          Faculty / Non-Teaching Staff
                        </option>
                        <option value="Citizen">Citizen / RTI Activist</option>
                        <option value="Alumni">Alumni</option>
                      </select>
                    </label>
                  </div>

                  <h3
                    style={{
                      marginTop: "1.75rem",
                      marginBottom: "1.25rem",
                      paddingBottom: "0.75rem",
                      borderBottom: "1px solid var(--color-border-subtle)",
                    }}
                  >
                    2. Institution Details
                  </h3>

                  <div style={{ marginBottom: "0.85rem" }}>
                    <span
                      className="small muted"
                      style={{ display: "block", marginBottom: "0.35rem" }}
                    >
                      Quick Select from AICTE Master Catalog (or type below):
                    </span>
                    <div
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        flexWrap: "wrap",
                      }}
                    >
                      {state.institutions.slice(0, 4).map((inst) => (
                        <button
                          key={inst.id}
                          type="button"
                          className="button button-quiet"
                          style={{
                            border: "1px solid var(--color-border)",
                            fontSize: "0.75rem",
                            padding: "0.25rem 0.65rem",
                          }}
                          onClick={() => handleSelectPresetInstitution(inst.id)}
                        >
                          {inst.official_name.split("(")[0].trim()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 1fr",
                      gap: "1rem",
                    }}
                  >
                    <label>
                      Institution Name (as known/advertised)
                      <input
                        type="text"
                        required
                        placeholder="e.g. Delhi Technological University"
                        value={institutionName}
                        onChange={(e) => setInstitutionName(e.target.value)}
                      />
                    </label>
                    <label>
                      AICTE Permanent ID (if known)
                      <input
                        type="text"
                        placeholder="e.g. 1-1002345671"
                        value={institutionPid}
                        onChange={(e) => setInstitutionPid(e.target.value)}
                      />
                    </label>
                  </div>

                  <h3
                    style={{
                      marginTop: "1.75rem",
                      marginBottom: "1.25rem",
                      paddingBottom: "0.75rem",
                      borderBottom: "1px solid var(--color-border-subtle)",
                    }}
                  >
                    3. Grievance Statement &amp; Evidence
                  </h3>

                  <label>
                    Grievance Category
                    <select
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      required
                    >
                      {state.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Grievance Title / Subject
                    <input
                      type="text"
                      required
                      placeholder="Brief headline of the grievance..."
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </label>

                  <label>
                    Comprehensive Description &amp; Events
                    <textarea
                      rows={4}
                      required
                      placeholder="Provide specific dates, departments, names, and regulatory violations..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </label>

                  <label>
                    Specific Relief Sought
                    <input
                      type="text"
                      placeholder="e.g. Refund of caution money Rs 45,000 / Return of original certificates"
                      value={reliefSought}
                      onChange={(e) => setReliefSought(e.target.value)}
                    />
                  </label>

                  {/* File Upload */}
                  <div style={{ marginTop: "1rem", marginBottom: "1.25rem" }}>
                    <label>
                      Supporting Evidence Attachments (PDF, Receipts,
                      Screenshots)
                      <input
                        type="file"
                        multiple
                        accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                        onChange={handleFileChange}
                      />
                    </label>
                    {attachedFiles.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          gap: "0.5rem",
                          flexWrap: "wrap",
                          marginTop: "0.5rem",
                        }}
                      >
                        {attachedFiles.map((f, idx) => (
                          <span
                            key={idx}
                            className="badge badge-priority-normal"
                          >
                            <IconPaperclip className="w-3.5 h-3.5" />
                            {f.filename} ({Math.round(f.file_size / 1024)} KB)
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <label
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: "0.6rem",
                      marginTop: "1.25rem",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      required
                    />
                    <span>
                      I confirm that these details are accurate to my knowledge
                      and agree to their processing in this OneDesk workspace.
                    </span>
                  </label>

                  <div
                    style={{
                      marginTop: "1.5rem",
                      display: "flex",
                      justifyContent: "flex-end",
                    }}
                  >
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={isSubmitting || !consent}
                      style={{
                        padding: "0.65rem 1.75rem",
                        fontSize: "0.95rem",
                      }}
                    >
                      {isSubmitting
                        ? "Saving complaint..."
                        : channel === "cpgrams"
                          ? "Record grievance referral"
                          : "Submit institution complaint"}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </>
        )}

        {/* VIEW 2: TRACK GRIEVANCE STATUS */}
        {activeTab === "track" && (
          <div className="card">
            <h3 style={{ marginBottom: "0.5rem" }}>
              {channel === "cpgrams"
                ? "Track a grievance referral"
                : "Track your institution complaint"}
            </h3>
            <p className="small muted" style={{ marginBottom: "1.25rem" }}>
              {channel === "cpgrams"
                ? "Find the OneDesk processing status using your originating grievance reference, CPGRAMS intake number, or OneDesk tracking code."
                : "Enter the tracking code or AICTE submission number from your complaint receipt."}
            </p>

            <form
              onSubmit={handleTrackSearch}
              style={{ display: "flex", gap: "0.75rem", marginBottom: "2rem" }}
            >
              <input
                type="text"
                aria-label={
                  channel === "cpgrams"
                    ? "Referral or tracking reference"
                    : "Complaint tracking reference"
                }
                placeholder={
                  channel === "cpgrams"
                    ? "Originating reference or OneDesk code..."
                    : "AICTE tracking code or submission number..."
                }
                value={trackQuery}
                onChange={(e) => setTrackQuery(e.target.value)}
                required
                style={{ flex: 1 }}
              />
              <button type="submit" className="button button-primary">
                <IconSearch className="w-4 h-4" />{" "}
                {channel === "cpgrams" ? "Find referral" : "Check Status"}
              </button>
            </form>

            {/* Tracking Result Card */}
            {trackedSubmission ? (
              <div
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-xl)",
                  padding: "1.5rem",
                  background: "var(--color-surface)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: "1rem",
                  }}
                >
                  <div>
                    <span className="small muted">Grievance Reference</span>
                    <h4
                      style={{
                        fontSize: "1.2rem",
                        color: "var(--color-accent)",
                        margin: "0.2rem 0",
                      }}
                    >
                      {trackedSubmission.tracking_code}
                    </h4>
                    <span className="mono small muted">
                      {trackedSubmission.submission_number}
                    </span>
                  </div>
                  <span className="badge badge-status-assigned">
                    {(trackedCase?.status || trackedSubmission.status)
                      .replace(/_/g, " ")
                      .toUpperCase()}
                  </span>
                </div>

                {channel === "cpgrams" && (
                  <div className="callout callout-info">
                    <strong>
                      Originating grievance reference:{" "}
                      {trackedSubmission.source_metadata?.portal_reference ||
                        "Not supplied"}
                    </strong>
                    <p className="small">
                      This is the referral's progress inside OneDesk. The
                      originating portal retains its own reference and
                      processing record.
                    </p>
                  </div>
                )}
                {/* Status Timeline Bar */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: "0.5rem",
                    margin: "1.5rem 0",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      padding: "0.75rem",
                      background: "#edfcf2",
                      border: "1px solid #a6f4c5",
                      borderRadius: "var(--radius-md)",
                    }}
                  >
                    <IconCheck
                      className="w-4 h-4 text-success"
                      style={{ margin: "0 auto 0.25rem" }}
                    />
                    <strong style={{ fontSize: "0.78rem", display: "block" }}>
                      1.{" "}
                      {channel === "cpgrams"
                        ? "Referral recorded"
                        : "Complaint received"}
                    </strong>
                    <span className="small muted">Preserved exactly</span>
                  </div>
                  <div
                    style={{
                      padding: "0.75rem",
                      background: trackedSubmission.institution_verified
                        ? "#edfcf2"
                        : "#fef3c7",
                      border: `1px solid ${trackedSubmission.institution_verified ? "#a6f4c5" : "#fedf89"}`,
                      borderRadius: "var(--radius-md)",
                    }}
                  >
                    <IconCheck
                      className="w-4 h-4 text-success"
                      style={{ margin: "0 auto 0.25rem" }}
                    />
                    <strong style={{ fontSize: "0.78rem", display: "block" }}>
                      2. Verification
                    </strong>
                    <span className="small muted">
                      {trackedSubmission.institution_verified
                        ? "Verified"
                        : "Pending"}
                    </span>
                  </div>
                  <div
                    style={{
                      padding: "0.75rem",
                      background: trackedSubmission.canonical_case_number
                        ? "#edfcf2"
                        : "#f1f5f9",
                      border: `1px solid ${trackedSubmission.canonical_case_number ? "#a6f4c5" : "#e2e8f0"}`,
                      borderRadius: "var(--radius-md)",
                    }}
                  >
                    <IconCheck
                      className="w-4 h-4 text-success"
                      style={{ margin: "0 auto 0.25rem" }}
                    />
                    <strong style={{ fontSize: "0.78rem", display: "block" }}>
                      3.{" "}
                      {channel === "cpgrams"
                        ? "Internal routing"
                        : "Case review"}
                    </strong>
                    <span className="small muted">
                      {trackedSubmission.canonical_case_number || "In Queue"}
                    </span>
                  </div>
                  <div
                    style={{
                      padding: "0.75rem",
                      background: trackedSubmission.canonical_case_number
                        ? "#edfcf2"
                        : "#f1f5f9",
                      border: `1px solid ${trackedSubmission.canonical_case_number ? "#a6f4c5" : "#e2e8f0"}`,
                      borderRadius: "var(--radius-md)",
                    }}
                  >
                    <IconClock
                      className="w-4 h-4 text-accent"
                      style={{ margin: "0 auto 0.25rem" }}
                    />
                    <strong style={{ fontSize: "0.78rem", display: "block" }}>
                      4. Bureau Redressal
                    </strong>
                    <span className="small muted">
                      {trackedCase
                        ? trackedCase.status.replace(/_/g, " ")
                        : "Not started"}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "1rem",
                    marginTop: "1rem",
                  }}
                >
                  <div>
                    <span className="small muted">Target Institution:</span>
                    <div style={{ fontWeight: 600 }}>
                      {trackedSubmission.institution_name_submitted}
                    </div>
                  </div>
                  <div>
                    <span className="small muted">Subject:</span>
                    <div style={{ fontWeight: 600 }}>
                      {trackedSubmission.subject}
                    </div>
                  </div>
                </div>

                {trackedSubmission.canonical_case_id &&
                  (has("case.view_index") || has("case.view_detail")) && (
                    <div
                      style={{
                        marginTop: "1.25rem",
                        paddingTop: "1rem",
                        borderTop: "1px solid var(--color-border-subtle)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span className="small muted">
                        Internal Case ID:{" "}
                        <strong>
                          {trackedSubmission.canonical_case_number}
                        </strong>
                      </span>
                      <Link
                        to={`/cases/${trackedSubmission.canonical_case_id}`}
                        className="button button-quiet"
                        style={{ fontSize: "0.82rem" }}
                      >
                        View in Internal Workspace &rarr;
                      </Link>
                    </div>
                  )}
              </div>
            ) : trackSearched ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "2rem",
                  color: "var(--color-text-muted)",
                }}
              >
                No complaint found matching &quot;{trackQuery}&quot;. Please
                verify the tracking code.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </PublicShell>
  );
}

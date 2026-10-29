import {
  accessibleSubmissions,
  canActOnCase,
  canReadCase,
  ownsSubmission,
} from "./scope";
/**
 * AICTE OneDesk — Central Simulation Store & Business Logic Engine
 *
 * Implements deterministic execution of all PRD v1.1 workflows completely
 * within the frontend without network dependencies.
 */

import { VALID_STATUS_TRANSITIONS } from "../lib/cases";
import {
  clearStoredState,
  getInitialState,
  getPristineSeedState,
  saveState,
  storeBinaryFile,
} from "./storage";
import type {
  CasePriority,
  CaseStatus,
  IntakeChannel,
  Persona,
  SimAccessGrant,
  SimCase,
  SimCaseAttachment,
  SimCaseNote,
  SimCaseTransfer,
  SimDuplicateCandidate,
  SimEscalation,
  SimState,
  SimSubmission,
  SimSubmissionAttachment,
  SimVerificationTask,
} from "./types";

type Listener = () => void;

class SimulationEngine {
  private state: SimState;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = getInitialState();
  }

  public getState(): SimState {
    return this.state;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    saveState(this.state);
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error("Simulation listener error:", err);
      }
    }
  }

  public addPublicMessage(submissionId: string, body: string): void {
    const actor = this.getActivePersona();
    const sub = this.state.submissions.find((s) => s.id === submissionId);
    if (!sub || !body.trim())
      throw new Error("Select a complaint and enter a response.");
    const c = this.state.cases.find((c) => c.case_id === sub.canonical_case_id);
    const personal = ownsSubmission(sub, actor);
    if (
      !personal &&
      (!c ||
        !actor.permissions.includes("submission.view") ||
        !actor.permissions.includes("case.note.create") ||
        !canActOnCase(c, actor, this.state))
    )
      throw new Error("You cannot publish a response to this complaint.");
    const message = {
      id: crypto.randomUUID(),
      sender_id: actor.id,
      sender_name: actor.name,
      direction: personal ? ("complainant" as const) : ("staff" as const),
      body: body.trim(),
      created_at: this.state.simulatedClock,
    };
    sub.source_metadata = {
      ...sub.source_metadata,
      public_messages: [
        ...(sub.source_metadata?.public_messages || []),
        message,
      ],
    };
    sub.updated_at = this.state.simulatedClock;
    c?.action_history.unshift({
      action_id: crypto.randomUUID(),
      action_type: "public_correspondence",
      action_description: personal
        ? "Complainant supplied additional information."
        : "A response was published to the complainant.",
      actor_name: actor.name,
      actor_role: actor.roleName,
      created_at: this.state.simulatedClock,
    });
    this.state.notifications.unshift({
      id: crypto.randomUUID(),
      type: "status_change",
      title: personal
        ? "Complainant response received"
        : "A response is available",
      message: personal
        ? "Review the complaint correspondence."
        : "Open My complaints to read your response.",
      case_id: personal ? c?.case_id : undefined,
      target_user_id: personal ? undefined : sub.submitter_reference,
      bureau_id: personal ? c?.lead_bureau_id : undefined,
      target_role: personal && !c ? "SUPER_ADMIN" : undefined,
      link_to:
        personal && c
          ? `/cases/${c.case_id}`
          : personal
            ? `/intake/${sub.id}`
            : "/portal",
      is_read: false,
      created_at: this.state.simulatedClock,
    });
    this.notify();
  }

  public persistChanges(): void {
    this.notify();
  }

  public getActivePersona(): Persona {
    return (
      this.state.personas[this.state.activePersonaKey] ||
      this.state.personas.super_admin
    );
  }

  public switchPersona(personaKey: string): void {
    if (this.state.personas[personaKey]) {
      this.state.activePersonaKey = personaKey;
      this.notify();
    }
  }

  public resetPresentationData(): void {
    clearStoredState();
    this.state = getPristineSeedState();
    this.notify();
  }

  // =========================================================================
  // SIMULATED CLOCK & SLA ENGINE
  // =========================================================================

  public advanceSimulatedClock(days: number): void {
    const current = new Date(this.state.simulatedClock);
    current.setDate(current.getDate() + days);
    this.state.simulatedClock = current.toISOString();
    this.evaluateSlaAndEscalations();
    this.notify();
  }

  public resetSimulatedClock(): void {
    this.state.simulatedClock = "2026-10-29T10:00:00.000Z";
    this.evaluateSlaAndEscalations();
    this.notify();
  }

  public evaluateSlaAndEscalations(): void {
    const nowTime = new Date(this.state.simulatedClock).getTime();

    for (const c of this.state.cases) {
      if (c.status === "resolved" || c.status === "closed") {
        continue;
      }

      const targetTime = new Date(c.target_resolution_date).getTime();
      const diffHours = Math.round((nowTime - targetTime) / (1000 * 60 * 60));

      if (diffHours > 0) {
        // Breached deadline! Check if escalation exists
        const existingEsc = this.state.escalations.find(
          (e) => e.case_id === c.case_id && e.status !== "resolved",
        );

        let targetLevel: 1 | 2 | 3 = 1;
        let levelName = "Bureau Head Level";
        let targetAuth = "Bureau Head";

        if (diffHours > 168) {
          // > 7 days
          targetLevel = 3;
          levelName = "Chairman AICTE Level";
          targetAuth = "Chairman, AICTE";
        } else if (diffHours > 48) {
          // > 48 hours
          targetLevel = 2;
          levelName = "Advisor / Member Secretary Level";
          targetAuth = "Member Secretary, AICTE";
        }

        if (existingEsc) {
          existingEsc.breach_hours = diffHours;
          existingEsc.level = targetLevel;
          existingEsc.level_name = levelName;
          existingEsc.target_authority = targetAuth;
        } else {
          const newEsc: SimEscalation = {
            escalation_id: `esc-auto-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            case_id: c.case_id,
            case_number: c.case_number,
            case_title: c.title,
            lead_bureau_name: c.lead_bureau_name,
            level: targetLevel,
            level_name: levelName,
            target_authority: targetAuth,
            breach_hours: diffHours,
            reason: `SLA resolution deadline breached by ${Math.round(diffHours / 24)} days. Automatic escalation initiated.`,
            status: "active",
            triggered_at: this.state.simulatedClock,
          };
          this.state.escalations.unshift(newEsc);

          // Add notification
          this.state.notifications.unshift({
            id: `notif-esc-${Date.now()}`,
            type: "escalation",
            title: `SLA Breach Escalation: ${c.case_number}`,
            message: `Case ${c.case_number} has escalated to ${levelName} due to ${Math.round(diffHours / 24)} days delay.`,
            case_id: c.case_id,
            link_to: `/cases/${c.case_id}`,
            bureau_id: c.lead_bureau_id,
            is_read: false,
            created_at: this.state.simulatedClock,
          });
        }
      }
    }
  }

  // =========================================================================
  // SUBMISSIONS & INTAKE WORKFLOW
  // =========================================================================

  public submitComplaint(data: {
    channel: IntakeChannel;
    complainant_name: string;
    complainant_email: string;
    complainant_phone: string;
    complainant_category: string;
    institution_name: string;
    institution_permanent_id?: string;
    category_id?: string;
    subject: string;
    description: string;
    relief_sought?: string;
    language?: "en" | "hi";
    portal_reference?: string;
    attachments?: Array<{
      filename: string;
      mime_type: string;
      file_size: number;
      data_url?: string;
    }>;
  }): SimSubmission {
    const timestamp = this.state.simulatedClock;
    const prefix = data.channel === "cpgrams" ? "DEMO-CPGRAMS" : "DEMO-AICTE";
    const subNum = `${prefix}-${new Date(timestamp).getFullYear()}-${String(
      this.state.submissions.length + 101,
    ).padStart(6, "0")}`;
    let trkCode: string;
    do {
      trkCode = `TRK-${Math.floor(1000 + Math.random() * 9000)}`;
    } while (this.state.submissions.some((s) => s.tracking_code === trkCode));

    // Try institution matching
    let matchedInst = this.state.institutions.find(
      (inst) =>
        data.institution_permanent_id &&
        inst.aicte_permanent_id.trim().toLowerCase() ===
          data.institution_permanent_id.trim().toLowerCase(),
    );

    if (!matchedInst && data.institution_name) {
      const q = data.institution_name.trim().toLowerCase();
      matchedInst = this.state.institutions.find(
        (inst) =>
          inst.official_name.toLowerCase() === q ||
          inst.aliases.some((a) => a.toLowerCase() === q),
      );
    }

    const isVerified = Boolean(
      matchedInst &&
        matchedInst.is_active &&
        matchedInst.verification_status === "verified",
    );

    const category =
      this.state.categories.find((c) => c.id === data.category_id) ||
      this.state.categories[0];

    const submissionAttachments: SimSubmissionAttachment[] = (
      data.attachments || []
    ).map((att, idx) => ({
      id: `att-sub-${Date.now()}-${idx}`,
      filename: att.filename,
      mime_type: att.mime_type,
      file_size: att.file_size,
      data_url: att.data_url,
      uploaded_at: timestamp,
    }));

    const submission: SimSubmission = {
      id: `sub-${crypto.randomUUID()}`,
      submission_number: subNum,
      tracking_code: trkCode,
      channel: data.channel,
      submitter_reference:
        this.getActivePersona().roleCode === "COMPLAINANT"
          ? this.getActivePersona().id
          : undefined,
      source_metadata: data.portal_reference
        ? { portal_reference: data.portal_reference }
        : {},
      complainant_name: data.complainant_name,
      complainant_email: data.complainant_email,
      complainant_phone: data.complainant_phone,
      complainant_category: data.complainant_category || "Citizen",
      institution_name_submitted: data.institution_name,
      institution_permanent_id_submitted: data.institution_permanent_id,
      matched_institution_id: matchedInst?.id,
      institution_verified: isVerified,
      category_id: category.id,
      category_name: category.name,
      subject: data.subject,
      description: data.description,
      relief_sought: data.relief_sought,
      language: data.language || "en",
      status: isVerified ? "duplicate_review" : "under_verification",
      attachments: submissionAttachments,
      received_at: timestamp,
      updated_at: timestamp,
    };

    this.state.submissions.unshift(submission);

    // If institution not verified, create a verification task
    if (!isVerified) {
      const task: SimVerificationTask = {
        id: `ver-task-${Date.now()}`,
        submission_id: submission.id,
        submission_number: submission.submission_number,
        submitted_name: data.institution_name,
        submitted_pid: data.institution_permanent_id,
        candidate_institution_id: matchedInst?.id,
        candidate_institution_name: matchedInst?.official_name,
        match_confidence: matchedInst ? 0.75 : 0.2,
        verification_status: "pending",
        review_notes: matchedInst
          ? `Candidate match found: ${matchedInst.official_name}. Requires human verification.`
          : "Unmatched institution name submitted. Review required against AICTE master list.",
        created_at: timestamp,
        updated_at: timestamp,
      };
      this.state.verificationTasks.unshift(task);

      this.state.notifications.unshift({
        id: `notif-ver-${Date.now()}`,
        type: "verification",
        title: "New Institution Verification Task",
        message: `Submission ${submission.submission_number} requires verification for "${data.institution_name}".`,
        link_to: `/verification/tasks/${task.id}`,
        target_role: "SUPER_ADMIN",
        is_read: false,
        created_at: timestamp,
      });
    } else {
      // Verified: check for duplicates
      this.checkAndFlagDuplicates(submission);
    }

    this.notify();
    return submission;
  }

  // =========================================================================
  // INSTITUTION VERIFICATION
  // =========================================================================

  public decideVerificationTask(
    taskId: string,
    decision: "verified" | "rejected" | "correction_requested",
    matchedInstitutionId?: string,
    notes?: string,
  ): void {
    const task = this.state.verificationTasks.find((t) => t.id === taskId);
    if (!task) return;

    const actor = this.getActivePersona();
    const timestamp = this.state.simulatedClock;

    if (
      decision === "verified" &&
      !this.state.institutions.some(
        (i) =>
          i.id === matchedInstitutionId &&
          i.is_active &&
          i.verification_status === "verified",
      )
    )
      throw new Error("Select a verified, active institution.");
    task.verification_status = decision;
    task.reviewer_name = actor.name;
    task.review_notes = notes || `Decision: ${decision}`;
    task.verified_institution_id = matchedInstitutionId;
    task.updated_at = timestamp;

    const submission = this.state.submissions.find(
      (s) => s.id === task.submission_id,
    );
    if (submission) {
      if (decision === "verified") {
        submission.institution_verified = true;
        submission.matched_institution_id = matchedInstitutionId;
        submission.status = "duplicate_review";
        submission.updated_at = timestamp;
        this.checkAndFlagDuplicates(submission);
      } else if (decision === "rejected") {
        submission.status = "rejected";
        submission.updated_at = timestamp;
      }
    }

    this.state.notifications.unshift({
      id: `notif-decide-ver-${Date.now()}`,
      type: "status_change",
      title: `Institution Verification ${decision.toUpperCase()}`,
      message: `Task ${task.submission_number} marked as ${decision} by ${actor.name}.`,
      link_to: `/verification/tasks/${taskId}`,
      is_read: false,
      created_at: timestamp,
    });

    this.notify();
  }

  // =========================================================================
  // DUPLICATE DETECTION & REVIEW
  // =========================================================================

  public screenSubmission(id: string): number {
    const submission = this.state.submissions.find((s) => s.id === id);
    if (!submission || !submission.institution_verified)
      throw new Error("Select a verified submission.");
    if (submission.canonical_case_id)
      throw new Error("This submission already belongs to a case.");
    const before = this.state.duplicateCandidates.length;
    this.checkAndFlagDuplicates(submission);
    this.notify();
    return this.state.duplicateCandidates.length - before;
  }

  private checkAndFlagDuplicates(submission: SimSubmission): void {
    const timestamp = this.state.simulatedClock;
    const subWords = new Set(
      `${submission.subject} ${submission.description}`
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );

    for (const c of this.state.cases) {
      if (Date.parse(timestamp) - Date.parse(c.opened_at) > 60 * 86400000)
        continue;
      if (
        this.state.duplicateCandidates.some(
          (d) =>
            d.submission_id === submission.id &&
            d.candidate_case_id === c.case_id,
        )
      )
        continue;
      if (c.institution_id === submission.matched_institution_id) {
        const caseWords = new Set(
          `${c.title} ${c.description}`
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, "")
            .split(/\s+/)
            .filter((w) => w.length > 3),
        );

        let overlap = 0;
        const matchingTokens: string[] = [];
        for (const w of subWords) {
          if (caseWords.has(w)) {
            overlap++;
            if (matchingTokens.length < 5) matchingTokens.push(w);
          }
        }

        const similarity = Math.min(
          0.95,
          Number(
            (0.5 + (overlap / Math.max(subWords.size, 1)) * 0.5).toFixed(2),
          ),
        );

        if (similarity >= 0.65) {
          const candidate: SimDuplicateCandidate = {
            id: `dup-${crypto.randomUUID()}`,
            candidate_id: `dup-${crypto.randomUUID()}`,
            submission_id: submission.id,
            submission_number: submission.submission_number,
            submission_subject: submission.subject,
            submission_body: submission.description,
            submission_institution_name: submission.institution_name_submitted,
            submission_received_at: submission.received_at,
            candidate_case_id: c.case_id,
            case_number: c.case_number,
            case_title: c.title,
            case_status: c.status,
            case_institution_name: c.institution_name,
            similarity_score: similarity,
            matching_method: "semantic_keyword_overlap",
            matching_signals: {
              institution_match: true,
              category_match: c.category_id === submission.category_id,
              title_similarity: similarity,
              description_similarity: similarity,
              keyword_overlap: matchingTokens,
            },
            review_status: "pending",
            created_at: timestamp,
          };
          this.state.duplicateCandidates.unshift(candidate);

          this.state.notifications.unshift({
            id: `notif-dup-${Date.now()}`,
            type: "duplicate",
            title: "Potential Duplicate Case Detected",
            message: `Submission ${submission.submission_number} has ${Math.round(similarity * 100)}% match with ${c.case_number}.`,
            link_to: `/duplicate-review/candidates/${candidate.candidate_id}`,
            target_role: "BUREAU_ADMIN",
            is_read: false,
            created_at: timestamp,
          });
        }
      }
    }
  }

  public decideDuplicate(
    candidateId: string,
    decision: "confirmed_duplicate" | "not_duplicate" | "related",
    notes?: string,
  ): void {
    const candidate = this.state.duplicateCandidates.find(
      (d) => d.id === candidateId || d.candidate_id === candidateId,
    );
    if (!candidate) throw new Error("Duplicate candidate not found");
    if (candidate.review_status !== "pending")
      throw new Error("This candidate has already been reviewed.");

    const actor = this.getActivePersona();
    if (
      !actor.permissions.includes("duplicate.review") ||
      !accessibleSubmissions(this.state, actor).some(
        (s) => s.id === candidate.submission_id,
      )
    )
      throw new Error(
        "Duplicate review is restricted to authorized submissions.",
      );
    const timestamp = this.state.simulatedClock;

    const linkedSubmission = this.state.submissions.find(
      (s) => s.id === candidate.submission_id,
    );
    if (
      linkedSubmission?.canonical_case_id &&
      linkedSubmission.canonical_case_id !== candidate.candidate_case_id
    )
      throw new Error(
        "This submission already belongs to another canonical case.",
      );
    const reviewTarget = this.state.cases.find(
      (c) => c.case_id === candidate.candidate_case_id,
    );
    if (!reviewTarget || !canReadCase(reviewTarget, actor, this.state))
      throw new Error(
        "Candidate case content is restricted; request access before recording a review decision.",
      );
    candidate.review_status = decision;
    candidate.review_notes = notes || `Decided: ${decision}`;
    candidate.reviewed_by = actor.name;
    candidate.reviewed_at = timestamp;

    const targetCase = this.state.cases.find(
      (c) => c.case_id === candidate.candidate_case_id,
    );
    const submission = this.state.submissions.find(
      (s) => s.id === candidate.submission_id,
    );

    if (decision === "confirmed_duplicate" && targetCase && submission) {
      submission.status = "canonical_case_created";
      submission.canonical_case_id = targetCase.case_id;
      submission.canonical_case_number = targetCase.case_number;

      targetCase.action_history.unshift({
        action_id: `act-${Date.now()}`,
        action_type: "duplicate_linked",
        action_description: `Submission ${submission.submission_number} confirmed as duplicate and linked.`,
        actor_name: actor.name,
        actor_role: actor.roleName,
        created_at: timestamp,
      });
    } else if (decision === "related" && targetCase && submission) {
      targetCase.related_cases.push({
        relationship_id: `rel-${Date.now()}`,
        related_case_id: submission.id,
        related_case_number: submission.submission_number,
        related_case_title: submission.subject,
        relationship_type: "related_submission",
        created_at: timestamp,
      });
    }

    this.notify();
  }

  // =========================================================================
  // CANONICAL CASE CREATION & WORKSPACE
  // =========================================================================

  public createCanonicalCase(data: {
    submission_id: string;
    lead_bureau_id: string;
    title: string;
    description: string;
    priority?: CasePriority;
  }): SimCase {
    const actor = this.getActivePersona();
    const timestamp = this.state.simulatedClock;

    const submission = this.state.submissions.find(
      (s) => s.id === data.submission_id,
    );
    if (!actor.permissions.includes("case.create"))
      throw new Error("You cannot create canonical cases.");
    if (
      !submission ||
      !submission.institution_verified ||
      !submission.matched_institution_id
    )
      throw new Error(
        "Verify the source submission institution before creating a case.",
      );
    if (
      actor.scopeType !== "global" &&
      (data.lead_bureau_id !== actor.bureauId ||
        !accessibleSubmissions(this.state, actor).some(
          (s) => s.id === submission.id,
        ))
    )
      throw new Error(
        "Create cases only from your bureau's eligible submissions and route them to your bureau.",
      );
    if (submission.canonical_case_id)
      throw new Error("This submission already belongs to a canonical case.");
    if (
      this.state.duplicateCandidates.some(
        (d) =>
          d.submission_id === submission.id && d.review_status === "pending",
      )
    )
      throw new Error(
        "Complete all duplicate reviews before creating a new case.",
      );
    if (
      !this.state.bureaus.some(
        (b) => b.id === data.lead_bureau_id && b.is_active,
      )
    )
      throw new Error("Select an active lead bureau.");

    const bureau =
      this.state.bureaus.find((b) => b.id === data.lead_bureau_id) ||
      this.state.bureaus[0];
    const inst =
      this.state.institutions.find(
        (i) => i.id === submission?.matched_institution_id,
      ) || this.state.institutions[0];
    const category =
      this.state.categories.find((cat) => cat.id === submission?.category_id) ||
      this.state.categories[0];

    const caseCount = this.state.cases.length + 89;
    const caseNumber = `CASE-2026-${String(caseCount).padStart(6, "0")}`;

    const targetDate = new Date(timestamp);
    targetDate.setDate(
      targetDate.getDate() + (category.sla_resolution_days || 15),
    );

    const caseId = `case-${crypto.randomUUID()}`;
    const newCase: SimCase = {
      case_id: caseId,
      case_number: caseNumber,
      title: data.title,
      description: data.description,
      institution_id: inst.id,
      institution_name: inst.official_name,
      institution_code: inst.aicte_permanent_id,
      institution_region: inst.region_name,
      category_id: category.id,
      category_name: category.name,
      status: "new",
      priority: data.priority || category.default_priority || "normal",
      visibility: "restricted",
      source_submission_id: data.submission_id,
      source_tracking_code: submission?.tracking_code,
      lead_bureau_id: bureau.id,
      lead_bureau_code: bureau.code,
      lead_bureau_name: bureau.name,
      opened_at: timestamp,
      target_resolution_date: targetDate.toISOString(),
      collaborating_bureaus: [],
      officer_assignments: [],
      notes: [],
      attachments: (submission?.attachments || []).map((att) => ({
        attachment_id: `att-case-${Date.now()}-${att.id}`,
        case_id: caseId,
        filename: att.filename,
        mime_type: att.mime_type,
        file_size: att.file_size,
        attachment_type: "initial_evidence",
        description: "Transferred from intake submission",
        uploaded_by_name: submission?.complainant_name || "Complainant",
        uploaded_at: timestamp,
        data_url:
          att.data_url ||
          "data:text/plain;base64,U2FtcGxlIGF0dGFjaG1lbnQgZGF0YQ==",
        is_quarantined: false,
      })),
      action_history: [
        {
          action_id: `act-${Date.now()}`,
          action_type: "case_created",
          action_description: `Canonical case ${caseNumber} created from submission ${submission?.submission_number || data.submission_id}.`,
          new_status: "new",
          actor_name: actor.name,
          actor_role: actor.roleName,
          created_at: timestamp,
        },
      ],
      related_cases: [],
      created_at: timestamp,
      updated_at: timestamp,
    };

    if (submission) {
      submission.status = "canonical_case_created";
      submission.canonical_case_id = newCase.case_id;
      submission.canonical_case_number = newCase.case_number;
    }

    bureau.case_count++;

    this.state.cases.unshift(newCase);

    this.state.notifications.unshift({
      id: `notif-case-created-${Date.now()}`,
      type: "assignment",
      title: `Canonical Case Created: ${caseNumber}`,
      message: `New case ${caseNumber} assigned to ${bureau.name}.`,
      case_id: newCase.case_id,
      link_to: `/cases/${newCase.case_id}`,
      bureau_id: bureau.id,
      is_read: false,
      created_at: timestamp,
    });

    this.notify();
    return newCase;
  }

  // =========================================================================
  // CASE STATUS TRANSITIONS
  // =========================================================================

  public transitionCaseStatus(
    caseId: string,
    toStatus: CaseStatus,
    reason: string,
  ): void {
    const c = this.state.cases.find((item) => item.case_id === caseId);
    if (!c) throw new Error("Case not found");

    const validNext = VALID_STATUS_TRANSITIONS[c.status] || [];
    if (!validNext.includes(toStatus)) {
      throw new Error(
        `Invalid status transition from ${c.status} to ${toStatus}`,
      );
    }

    const actor = this.getActivePersona();
    const timestamp = this.state.simulatedClock;
    const prevStatus = c.status;

    if (!actor.permissions.includes("case.status.change"))
      throw new Error("You cannot change case status.");
    if (!reason.trim())
      throw new Error("Provide a reason for the status change.");
    c.status = toStatus;
    c.updated_at = timestamp;

    if (toStatus === "resolved" || toStatus === "closed") {
      if (toStatus === "resolved" || !c.closed_at) c.closed_at = timestamp;
    } else if (toStatus === "reopened") {
      c.closed_at = undefined;
    }

    c.action_history.unshift({
      action_id: `act-${Date.now()}`,
      action_type: "status_transition",
      action_description: `Status changed from ${prevStatus} to ${toStatus}. Reason: ${reason}`,
      previous_status: prevStatus,
      new_status: toStatus,
      actor_name: actor.name,
      actor_role: actor.roleName,
      created_at: timestamp,
    });

    if (toStatus === "resolved" || toStatus === "closed") {
      this.state.escalations
        .filter((e) => e.case_id === caseId && e.status !== "resolved")
        .forEach((e) => {
          e.status = "resolved";
          e.resolution_notes = reason;
        });
    }
    this.state.notifications.unshift({
      id: `notif-trans-${Date.now()}`,
      type: "status_change",
      title: `Case ${c.case_number} status updated to ${toStatus.replace(/_/g, " ").toUpperCase()}`,
      message: `${actor.name} transitioned case ${c.case_number}. Reason: ${reason}`,
      case_id: c.case_id,
      link_to: `/cases/${c.case_id}`,
      is_read: false,
      created_at: timestamp,
    });

    this.notify();
  }

  // =========================================================================
  // ASSIGNMENTS
  // =========================================================================

  public assignBureau(
    caseId: string,
    bureauId: string,
    assignmentType: "lead" | "collaborating",
    reason?: string,
  ): void {
    const c = this.state.cases.find((item) => item.case_id === caseId);
    if (!c) throw new Error("Case not found");

    const bureau = this.state.bureaus.find((b) => b.id === bureauId);
    if (!bureau) throw new Error("Bureau not found");

    const actor = this.getActivePersona();
    if (
      !actor.permissions.includes("case.assign.bureau") ||
      !canActOnCase(c, actor, this.state)
    )
      throw new Error(
        "This case action is restricted to authorized assignments or grants.",
      );
    const timestamp = this.state.simulatedClock;

    if (assignmentType === "lead") {
      c.lead_bureau_id = bureau.id;
      c.lead_bureau_code = bureau.code;
      c.lead_bureau_name = bureau.name;
    } else {
      const existing = c.collaborating_bureaus.find(
        (cb) => cb.bureau_id === bureau.id,
      );
      if (!existing) {
        c.collaborating_bureaus.push({
          bureau_id: bureau.id,
          bureau_code: bureau.code,
          bureau_name: bureau.name,
          assignment_type: "collaborating",
          assignment_status: "active",
          assigned_at: timestamp,
        });
      }
    }

    c.action_history.unshift({
      action_id: `act-${Date.now()}`,
      action_type: "bureau_assignment",
      action_description: `Assigned ${bureau.name} as ${assignmentType} bureau.${reason ? ` Reason: ${reason}` : ""}`,
      actor_name: actor.name,
      actor_role: actor.roleName,
      created_at: timestamp,
    });

    this.notify();
  }

  public assignOfficer(
    caseId: string,
    bureauId: string,
    officerId: string,
    role: "lead_officer" | "supporting" | "reviewer",
    notes?: string,
  ): void {
    const c = this.state.cases.find((item) => item.case_id === caseId);
    if (!c) throw new Error("Case not found");

    const member = this.state.bureauMembers.find(
      (m) => m.user_id === officerId && m.bureau_id === bureauId && m.is_active,
    );
    if (!member)
      throw new Error(
        "Officer must have an active membership in the selected bureau.",
      );
    if (
      c.officer_assignments.some(
        (o) =>
          o.officer_id === officerId &&
          o.bureau_id === bureauId &&
          o.status === "active",
      )
    )
      throw new Error(
        "Officer already has an active assignment in this bureau.",
      );
    const officerName = member ? member.full_name : "Case Officer";
    const bureau =
      this.state.bureaus.find((b) => b.id === bureauId) ||
      this.state.bureaus[0];

    const actor = this.getActivePersona();
    if (
      !actor.permissions.includes("case.assign.officer") ||
      !canActOnCase(c, actor, this.state)
    )
      throw new Error(
        "This case action is restricted to authorized assignments or grants.",
      );
    const timestamp = this.state.simulatedClock;

    c.officer_assignments.unshift({
      officer_assignment_id: `oa-${crypto.randomUUID()}`,
      bureau_id: bureau.id,
      bureau_name: bureau.name,
      officer_id: officerId,
      officer_name: officerName,
      role,
      status: "active",
      assigned_at: timestamp,
      notes,
    });

    if (c.status === "new") {
      c.status = "assigned";
    }

    if (member) {
      member.assigned_cases_count++;
    }

    c.action_history.unshift({
      action_id: `act-${Date.now()}`,
      action_type: "officer_assignment",
      action_description: `Assigned ${officerName} as ${role.replace(/_/g, " ")}.`,
      actor_name: actor.name,
      actor_role: actor.roleName,
      created_at: timestamp,
    });

    this.state.notifications.unshift({
      id: `notif-oa-${Date.now()}`,
      type: "assignment",
      title: `Assigned to Case ${c.case_number}`,
      message: `You have been assigned as ${role.replace(/_/g, " ")} on case ${c.case_number}.`,
      case_id: c.case_id,
      link_to: `/cases/${c.case_id}`,
      target_user_id: officerId,
      is_read: false,
      created_at: timestamp,
    });

    this.notify();
  }

  // =========================================================================
  // NOTES & ATTACHMENTS
  // =========================================================================

  public addNote(
    caseId: string,
    text: string,
    visibility: "shared" | "bureau_private" = "shared",
    noteType:
      | "general"
      | "internal_review"
      | "resolution"
      | "handover" = "general",
  ): SimCaseNote {
    const c = this.state.cases.find((item) => item.case_id === caseId);
    if (!c) throw new Error("Case not found");

    const actor = this.getActivePersona();
    if (
      !actor.permissions.includes("case.note.create") ||
      !canActOnCase(c, actor, this.state)
    )
      throw new Error(
        "This case action is restricted to authorized assignments or grants.",
      );
    const timestamp = this.state.simulatedClock;

    if (visibility === "bureau_private" && !actor.bureauId)
      throw new Error(
        "Select a bureau account to create a bureau-private note.",
      );
    const note: SimCaseNote = {
      note_id: `note-${crypto.randomUUID()}`,
      case_id: c.case_id,
      author_id: actor.id,
      author_name: actor.name,
      author_role: actor.roleName,
      bureau_id: actor.bureauId || undefined,
      bureau_name: actor.bureauName || undefined,
      note_text: text,
      visibility,
      note_type: noteType,
      is_pinned: false,
      created_at: timestamp,
    };

    c.notes.unshift(note);

    c.action_history.unshift({
      action_id: `act-${Date.now()}`,
      action_type: "note_added",
      action_description: `Added ${visibility} note (${noteType}).`,
      actor_name: actor.name,
      actor_role: actor.roleName,
      created_at: timestamp,
    });

    this.notify();
    return note;
  }

  public deleteNote(caseId: string, noteId: string): void {
    const c = this.state.cases.find((item) => item.case_id === caseId);
    if (!c) return;

    c.notes = c.notes.filter((n) => n.note_id !== noteId);
    this.notify();
  }

  public async addAttachment(
    caseId: string,
    file: {
      filename: string;
      mime_type: string;
      file_size: number;
      data_url: string;
      description?: string;
      attachment_type?: string;
    },
  ): Promise<SimCaseAttachment> {
    const c = this.state.cases.find((item) => item.case_id === caseId);
    if (!c) throw new Error("Case not found");

    const actor = this.getActivePersona();
    const timestamp = this.state.simulatedClock;
    const attachmentId = `att-bin-${crypto.randomUUID()}`;

    // Store in IndexedDB/sessionStorage for persistent binary recall
    await storeBinaryFile(attachmentId, file.data_url);

    const att: SimCaseAttachment = {
      attachment_id: attachmentId,
      case_id: c.case_id,
      filename: file.filename,
      mime_type: file.mime_type,
      file_size: file.file_size,
      attachment_type: file.attachment_type || "evidence_document",
      description: file.description,
      uploaded_by_name: actor.name,
      uploaded_at: timestamp,
      data_url: file.data_url,
      is_quarantined: false,
    };

    c.attachments.unshift(att);

    c.action_history.unshift({
      action_id: `act-${Date.now()}`,
      action_type: "attachment_uploaded",
      action_description: `Uploaded evidence attachment: ${file.filename} (${Math.round(file.file_size / 1024)} KB).`,
      actor_name: actor.name,
      actor_role: actor.roleName,
      created_at: timestamp,
    });

    this.notify();
    return att;
  }

  public quarantineAttachment(
    caseId: string,
    attachmentId: string,
    reason: string,
  ): void {
    const c = this.state.cases.find((item) => item.case_id === caseId);
    if (!c) return;

    const att = c.attachments.find((a) => a.attachment_id === attachmentId);
    if (att) {
      att.is_quarantined = true;
      att.quarantine_reason = reason;
      this.notify();
    }
  }

  // =========================================================================
  // CROSS-BUREAU ACCESS & TRANSFERS
  // =========================================================================

  public requestAccess(
    caseId: string,
    accessLevel: "details" | "collaborate",
    justification: string,
  ): SimAccessGrant {
    const c = this.state.cases.find((item) => item.case_id === caseId);
    if (!c) throw new Error("Case not found");

    const actor = this.getActivePersona();
    const timestamp = this.state.simulatedClock;

    if (!actor.bureauId || !justification.trim())
      throw new Error("A bureau account and justification are required.");
    if (
      this.state.accessGrants.some(
        (g) =>
          g.case_id === caseId &&
          g.grantee_user_id === actor.id &&
          g.status === "pending",
      )
    )
      throw new Error("An access request is already pending.");
    const grant: SimAccessGrant = {
      grant_id: `grant-${crypto.randomUUID()}`,
      case_id: c.case_id,
      case_number: c.case_number,
      grantee_bureau_id: actor.bureauId || "bur-002-pap",
      grantee_bureau_name:
        actor.bureauName || "Policy & Academic Planning Bureau",
      grantee_user_id: actor.id,
      grantee_user_name: actor.name,
      access_level: accessLevel,
      justification,
      status: "pending",
      requested_at: timestamp,
    };

    this.state.accessGrants.unshift(grant);

    this.state.notifications.unshift({
      id: `notif-access-req-${Date.now()}`,
      type: "access_request",
      title: `Access Requested for ${c.case_number}`,
      message: `${actor.name} (${actor.bureauName}) requested ${accessLevel} access: ${justification}`,
      case_id: c.case_id,
      link_to: `/cases/${c.case_id}`,
      bureau_id: c.lead_bureau_id,
      is_read: false,
      created_at: timestamp,
    });

    this.notify();
    return grant;
  }

  public approveAccess(grantId: string): void {
    if (!this.getActivePersona().permissions.includes("case.access.manage"))
      throw new Error("You cannot perform this action.");
    const grant = this.state.accessGrants.find((g) => g.grant_id === grantId);
    if (!grant) return;

    const actor = this.getActivePersona();
    const timestamp = this.state.simulatedClock;
    const expires = new Date(timestamp);
    expires.setDate(expires.getDate() + 30);

    grant.status = "approved";
    grant.granted_by = actor.name;
    grant.granted_at = timestamp;
    grant.expires_at = expires.toISOString();

    const c = this.state.cases.find((item) => item.case_id === grant.case_id);
    if (c) {
      c.action_history.unshift({
        action_id: `act-${Date.now()}`,
        action_type: "access_granted",
        action_description: `Approved 30-day cross-bureau ${grant.access_level} access for ${grant.grantee_bureau_name}.`,
        actor_name: actor.name,
        actor_role: actor.roleName,
        created_at: timestamp,
      });
    }

    this.state.notifications.unshift({
      id: `notif-access-appr-${Date.now()}`,
      type: "access_request",
      title: "Cross-Bureau Access Approved",
      message: `${actor.name} approved access for case ${grant.case_number}.`,
      case_id: grant.case_id,
      link_to: `/cases/${grant.case_id}`,
      target_user_id: grant.grantee_user_id,
      is_read: false,
      created_at: timestamp,
    });

    this.notify();
  }

  public rejectAccess(grantId: string, reason: string): void {
    if (!this.getActivePersona().permissions.includes("case.access.manage"))
      throw new Error("You cannot decide access requests.");
    const grant = this.state.accessGrants.find((g) => g.grant_id === grantId);
    if (!grant || grant.status !== "pending" || !reason.trim())
      throw new Error("A pending request and decision reason are required.");
    grant.status = "rejected";
    grant.revocation_reason = reason;
    const c = this.state.cases.find((c) => c.case_id === grant.case_id);
    c?.action_history.unshift({
      action_id: crypto.randomUUID(),
      action_type: "access_denied",
      action_description: `Access denied for ${grant.grantee_bureau_name}: ${reason}`,
      actor_name: this.getActivePersona().name,
      actor_role: this.getActivePersona().roleName,
      created_at: this.state.simulatedClock,
    });
    this.notify();
  }

  public revokeAccess(grantId: string, reason: string): void {
    if (!this.getActivePersona().permissions.includes("case.access.manage"))
      throw new Error("You cannot perform this action.");
    const grant = this.state.accessGrants.find((g) => g.grant_id === grantId);
    if (!grant) return;

    grant.status = "revoked";
    grant.revocation_reason = reason;
    this.state.cases
      .find((c) => c.case_id === grant.case_id)
      ?.action_history.unshift({
        action_id: crypto.randomUUID(),
        action_type: "access_revoked",
        action_description: `Access revoked for ${grant.grantee_bureau_name}: ${reason}`,
        actor_name: this.getActivePersona().name,
        actor_role: this.getActivePersona().roleName,
        created_at: this.state.simulatedClock,
      });
    this.notify();
  }

  public requestTransfer(
    caseId: string,
    toBureauId: string,
    transferType: "handover" | "lead_change" | "reassignment",
    reason: string,
  ): SimCaseTransfer {
    const c = this.state.cases.find((item) => item.case_id === caseId);
    if (!c) throw new Error("Case not found");

    const toBureau = this.state.bureaus.find((b) => b.id === toBureauId);
    if (!toBureau) throw new Error("Destination bureau not found");

    const actor = this.getActivePersona();
    const timestamp = this.state.simulatedClock;

    const trf: SimCaseTransfer = {
      transfer_id: `trf-${crypto.randomUUID()}`,
      case_id: c.case_id,
      case_number: c.case_number,
      from_bureau_id: c.lead_bureau_id,
      from_bureau_name: c.lead_bureau_name,
      to_bureau_id: toBureau.id,
      to_bureau_name: toBureau.name,
      transfer_type: transferType,
      reason,
      status: "pending",
      requested_by: actor.name,
      requested_at: timestamp,
    };

    this.state.transfers.unshift(trf);

    this.state.notifications.unshift({
      id: `notif-trf-req-${Date.now()}`,
      type: "transfer",
      title: `Transfer Requested for ${c.case_number}`,
      message: `${actor.name} proposed transfer of ${c.case_number} to ${toBureau.name}. Reason: ${reason}`,
      case_id: c.case_id,
      link_to: `/cases/${c.case_id}`,
      bureau_id: toBureau.id,
      is_read: false,
      created_at: timestamp,
    });

    this.notify();
    return trf;
  }

  public rejectTransfer(transferId: string, reason: string): void {
    if (!this.getActivePersona().permissions.includes("case.transfer.manage"))
      throw new Error("You cannot decide transfer requests.");
    const transfer = this.state.transfers.find(
      (t) => t.transfer_id === transferId,
    );
    if (!transfer || transfer.status !== "pending" || !reason.trim())
      throw new Error("A pending transfer and decision reason are required.");
    transfer.status = "rejected";
    transfer.reviewed_by = this.getActivePersona().name;
    transfer.reviewed_at = this.state.simulatedClock;
    this.state.cases
      .find((c) => c.case_id === transfer.case_id)
      ?.action_history.unshift({
        action_id: crypto.randomUUID(),
        action_type: "transfer_denied",
        action_description: `Transfer denied: ${reason}`,
        actor_name: this.getActivePersona().name,
        actor_role: this.getActivePersona().roleName,
        created_at: this.state.simulatedClock,
      });
    this.notify();
  }

  public approveTransfer(transferId: string): void {
    if (!this.getActivePersona().permissions.includes("case.transfer.manage"))
      throw new Error("You cannot perform this action.");
    const trf = this.state.transfers.find((t) => t.transfer_id === transferId);
    if (!trf) return;

    const actor = this.getActivePersona();
    const timestamp = this.state.simulatedClock;

    trf.status = "approved";
    trf.reviewed_by = actor.name;
    trf.reviewed_at = timestamp;

    const c = this.state.cases.find((item) => item.case_id === trf.case_id);
    if (c) {
      const fromBureau = this.state.bureaus.find(
        (b) => b.id === trf.from_bureau_id,
      );
      const toBureau = this.state.bureaus.find(
        (b) => b.id === trf.to_bureau_id,
      );

      if (
        !c.collaborating_bureaus.some((b) => b.bureau_id === trf.from_bureau_id)
      )
        c.collaborating_bureaus.push({
          bureau_id: trf.from_bureau_id,
          bureau_code: fromBureau?.code || "",
          bureau_name: trf.from_bureau_name,
          assignment_type: "lead",
          assignment_status: "completed",
          assigned_at: c.opened_at,
        });
      c.officer_assignments
        .filter(
          (o) => o.bureau_id === trf.from_bureau_id && o.status === "active",
        )
        .forEach((o) => {
          o.status = "completed";
        });
      c.lead_bureau_id = trf.to_bureau_id;
      c.lead_bureau_name = trf.to_bureau_name;
      c.lead_bureau_code = toBureau?.code || "BUR";

      if (fromBureau)
        fromBureau.case_count = Math.max(0, fromBureau.case_count - 1);
      if (toBureau) toBureau.case_count++;

      c.action_history.unshift({
        action_id: `act-${Date.now()}`,
        action_type: "case_transferred",
        action_description: `Lead ownership transferred from ${trf.from_bureau_name} to ${trf.to_bureau_name}.`,
        actor_name: actor.name,
        actor_role: actor.roleName,
        created_at: timestamp,
      });
    }

    this.notify();
  }

  public initiateJointReview(caseIdA: string, caseIdB: string): void {
    const actor = this.getActivePersona();
    const timestamp = this.state.simulatedClock;

    const caseA = this.state.cases.find(
      (c) => c.case_id === caseIdA || c.case_number === caseIdA,
    );
    const caseB = this.state.cases.find(
      (c) => c.case_id === caseIdB || c.case_number === caseIdB,
    );

    if (!caseA || !caseB)
      throw new Error("Both cases must exist to initiate joint review.");

    // Add Bureau B as collaborator on Case A if not already present
    if (
      !caseA.collaborating_bureaus.some(
        (b) => b.bureau_id === caseB.lead_bureau_id,
      )
    ) {
      caseA.collaborating_bureaus.push({
        bureau_id: caseB.lead_bureau_id,
        bureau_code: caseB.lead_bureau_code,
        bureau_name: caseB.lead_bureau_name,
        assignment_type: "collaborating",
        assignment_status: "active",
        assigned_at: timestamp,
      });
      caseA.action_history.unshift({
        action_id: `act-joint-${Date.now()}-1`,
        action_type: "joint_review_initiated",
        action_description: `Inter-bureau joint review initiated with ${caseB.lead_bureau_name} (${caseB.case_number}) for coordinated action on ${caseA.institution_name}.`,
        actor_name: actor.name,
        actor_role: actor.roleName,
        created_at: timestamp,
      });
      caseA.notes.unshift({
        note_id: `note-joint-${Date.now()}-1`,
        case_id: caseA.case_id,
        author_id: actor.id,
        author_name: actor.name,
        author_role: actor.roleName,
        bureau_id: actor.bureauId || caseA.lead_bureau_id,
        bureau_name: actor.bureauName || caseA.lead_bureau_name,
        note_text: `Inter-Bureau Joint Review initiated under SIH Problem Statement 26264. Harmonizing regulatory inquiries with ${caseB.lead_bureau_name} (${caseB.case_number}).`,
        visibility: "shared",
        note_type: "internal_review",
        is_pinned: true,
        created_at: timestamp,
      });
      caseA.updated_at = timestamp;
    }

    // Add Bureau A as collaborator on Case B if not already present
    if (
      !caseB.collaborating_bureaus.some(
        (b) => b.bureau_id === caseA.lead_bureau_id,
      )
    ) {
      caseB.collaborating_bureaus.push({
        bureau_id: caseA.lead_bureau_id,
        bureau_code: caseA.lead_bureau_code,
        bureau_name: caseA.lead_bureau_name,
        assignment_type: "collaborating",
        assignment_status: "active",
        assigned_at: timestamp,
      });
      caseB.action_history.unshift({
        action_id: `act-joint-${Date.now()}-2`,
        action_type: "joint_review_initiated",
        action_description: `Inter-bureau joint review initiated with ${caseA.lead_bureau_name} (${caseA.case_number}) for coordinated action on ${caseB.institution_name}.`,
        actor_name: actor.name,
        actor_role: actor.roleName,
        created_at: timestamp,
      });
      caseB.notes.unshift({
        note_id: `note-joint-${Date.now()}-2`,
        case_id: caseB.case_id,
        author_id: actor.id,
        author_name: actor.name,
        author_role: actor.roleName,
        bureau_id: actor.bureauId || caseB.lead_bureau_id,
        bureau_name: actor.bureauName || caseB.lead_bureau_name,
        note_text: `Inter-Bureau Joint Review initiated under SIH Problem Statement 26264. Harmonizing regulatory inquiries with ${caseA.lead_bureau_name} (${caseA.case_number}).`,
        visibility: "shared",
        note_type: "internal_review",
        is_pinned: true,
        created_at: timestamp,
      });
      caseB.updated_at = timestamp;
    }

    // Add inter-case links in related_cases if not already present
    if (
      !caseA.related_cases.some((r) => r.related_case_id === caseB.case_id)
    ) {
      caseA.related_cases.push({
        relationship_id: `rel-${Date.now()}-1`,
        related_case_id: caseB.case_id,
        related_case_number: caseB.case_number,
        related_case_title: caseB.title,
        relationship_type: "overlapping_investigation",
        created_at: timestamp,
      });
    }
    if (
      !caseB.related_cases.some((r) => r.related_case_id === caseA.case_id)
    ) {
      caseB.related_cases.push({
        relationship_id: `rel-${Date.now()}-2`,
        related_case_id: caseA.case_id,
        related_case_number: caseA.case_number,
        related_case_title: caseA.title,
        relationship_type: "overlapping_investigation",
        created_at: timestamp,
      });
    }

    // Post notification
    this.state.notifications.unshift({
      id: `notif-joint-${Date.now()}`,
      type: "overlap_alert",
      title: `Inter-Bureau Joint Review Active: ${caseA.institution_name}`,
      message: `Active coordination initiated between ${caseA.lead_bureau_name} (${caseA.case_number}) and ${caseB.lead_bureau_name} (${caseB.case_number}) to avoid duplicate or conflicting orders.`,
      case_id: caseA.case_id,
      link_to: `/cases/${caseA.case_id}`,
      is_read: false,
      created_at: timestamp,
    });

    this.notify();
  }

  // =========================================================================
  // NOTIFICATIONS
  // =========================================================================

  public markNotificationRead(id: string): void {
    const notif = this.state.notifications.find((n) => n.id === id);
    if (notif) {
      notif.is_read = true;
      this.notify();
    }
  }

  public markAllNotificationsRead(): void {
    for (const n of this.state.notifications) {
      n.is_read = true;
    }
    this.notify();
  }

  // =========================================================================
  // ESCALATIONS
  // =========================================================================

  public acknowledgeEscalation(escalationId: string, notes?: string): void {
    const esc = this.state.escalations.find(
      (e) => e.escalation_id === escalationId,
    );
    if (!esc) return;

    const actor = this.getActivePersona();
    esc.status = "acknowledged";
    esc.acknowledged_by = actor.name;
    esc.acknowledged_at = this.state.simulatedClock;
    if (notes) esc.resolution_notes = notes;
    this.notify();
  }

  public resolveEscalation(escalationId: string, notes: string): void {
    const esc = this.state.escalations.find(
      (e) => e.escalation_id === escalationId,
    );
    if (!esc) return;

    esc.status = "resolved";
    esc.resolution_notes = notes;
    this.notify();
  }
}

export const simulationStore = new SimulationEngine();

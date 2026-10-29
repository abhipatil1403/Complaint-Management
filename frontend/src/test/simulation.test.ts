import { beforeEach, describe, expect, it } from "vitest";

import { simulationStore } from "../simulation/simulationStore";
import { handleSimulatedRequest } from "../simulation/apiHandler";
import type { MeResponse, Page, CaseIndexItem, InstitutionSummary } from "../types";
import type { SimBureau, SimCase } from "../simulation/types";

describe("Simulation Store & Business Logic", () => {
  beforeEach(() => {
    simulationStore.resetPresentationData();
  });

  describe("Store Initialization & Seeding", () => {
    it("initializes with complete pre-seeded data", () => {
      const state = simulationStore.getState();
      expect(state.institutions.length).toBeGreaterThanOrEqual(8);
      expect(state.bureaus.length).toBeGreaterThanOrEqual(5);
      expect(state.cases.length).toBeGreaterThanOrEqual(8);
      expect(Object.keys(state.personas).length).toBeGreaterThanOrEqual(7);
      expect(state.activePersonaKey).toBe("super_admin");
    });

    it("supports switching active persona and returns correct capabilities", () => {
      simulationStore.switchPersona("case_officer");
      let persona = simulationStore.getActivePersona();
      expect(persona.roleCode).toBe("CASE_OFFICER");
      expect(persona.email).toBe("officer.singh@aicte.gov.in");

      simulationStore.switchPersona("complainant");
      persona = simulationStore.getActivePersona();
      expect(persona.roleCode).toBe("COMPLAINANT");
    });
  });

  describe("Public Complaint Submission & Tracking", () => {
    it("submits complaint with verified institution and generates tracking code", () => {
      const submission = simulationStore.submitComplaint({
        channel: "aicte_portal",
        complainant_name: "Dr. A. Sharma",
        complainant_email: "a.sharma@example.edu",
        complainant_phone: "+91-9876543210",
        complainant_category: "Faculty",
        institution_name: "Delhi Technological University",
        institution_permanent_id: "1-1002345671",
        category_id: "cat-fee-01",
        subject: "Excess tuition fee charged beyond approved AICTE ceiling",
        description: "The institute has charged Rs. 45,000 extra under unauthorized heads.",
        relief_sought: "Full refund of excess fee",
        attachments: [{ filename: "fee_receipt.pdf", mime_type: "application/pdf", file_size: 1048576 }],
      });

      expect(submission.submission_number).toMatch(/^DEMO-AICTE-2026-\d{6}$/);
      expect(submission.tracking_code).toMatch(/^TRK-\d{4}$/);
      expect(submission.institution_verified).toBe(true);
      expect(submission.status).toBe("duplicate_review");
      expect(submission.attachments.length).toBe(1);

      // Verify submission is in state
      const found = simulationStore.getState().submissions.find((s) => s.id === submission.id);
      expect(found).toBeDefined();
      expect(found?.subject).toBe("Excess tuition fee charged beyond approved AICTE ceiling");
    });

    it("submits complaint with unverified institution and queues verification task", () => {
      const submission = simulationStore.submitComplaint({
        channel: "cpgrams",
        complainant_name: "Sunil Verma",
        complainant_email: "sunil.v@example.com",
        complainant_phone: "+91-9811223344",
        complainant_category: "Citizen",
        institution_name: "New Unaffiliated Technical Institute, Meerut",
        category_id: "cat-rag-01",
        subject: "Severe ragging reported in first-year hostel block C",
        description: "Hostel wardens failed to take action despite repeated written complaints.",
      });

      expect(submission.submission_number).toMatch(/^DEMO-CPGRAMS-2026-\d{6}$/);
      expect(submission.status).toBe("under_verification");
      expect(submission.institution_verified).toBe(false);

      // Check verification queue
      const state = simulationStore.getState();
      const task = state.verificationTasks.find((t) => t.submission_id === submission.id);
      expect(task).toBeDefined();
      expect(task?.verification_status).toBe("pending");
      expect(task?.submitted_name).toBe("New Unaffiliated Technical Institute, Meerut");
    });
  });

  describe("Institution Verification Workflow", () => {
    it("confirms institution match, updates submission, and flags duplicate review", () => {
      const state = simulationStore.getState();
      const pendingTask = state.verificationTasks.find((t) => t.verification_status === "pending");
      expect(pendingTask).toBeDefined();

      simulationStore.decideVerificationTask(
        pendingTask!.id,
        "verified",
        "inst-003",
        "Verified against State Directorate database records.",
      );

      const updatedTask = simulationStore.getState().verificationTasks.find((t) => t.id === pendingTask!.id);
      expect(updatedTask?.verification_status).toBe("verified");
      expect(updatedTask?.verified_institution_id).toBe("inst-003");

      const updatedSubmission = simulationStore.getState().submissions.find((s) => s.id === pendingTask!.submission_id);
      expect(updatedSubmission?.institution_verified).toBe(true);
      expect(updatedSubmission?.status).toBe("duplicate_review");
    });

    it("rejects invalid institution submission", () => {
      const state = simulationStore.getState();
      const pendingTask = state.verificationTasks.find((t) => t.verification_status === "pending");
      expect(pendingTask).toBeDefined();

      simulationStore.decideVerificationTask(
        pendingTask!.id,
        "rejected",
        undefined,
        "Fictitious institution name. No registration on record.",
      );

      const updatedTask = simulationStore.getState().verificationTasks.find((t) => t.id === pendingTask!.id);
      expect(updatedTask?.verification_status).toBe("rejected");

      const updatedSubmission = simulationStore.getState().submissions.find((s) => s.id === pendingTask!.submission_id);
      expect(updatedSubmission?.status).toBe("rejected");
    });
  });

  describe("Duplicate Detection & Decisions", () => {
    it("records duplicate decision and links candidate correctly", () => {
      const state = simulationStore.getState();
      const candidate = state.duplicateCandidates.find((c) => c.review_status === "pending");
      expect(candidate).toBeDefined();

      simulationStore.decideDuplicate(
        candidate!.id,
        "confirmed_duplicate",
        "Exact match to existing case",
      );

      const updated = simulationStore.getState().duplicateCandidates.find((c) => c.id === candidate!.id);
      expect(updated?.review_status).toBe("confirmed_duplicate");
      expect(updated?.review_notes).toBe("Exact match to existing case");
    });
  });

  describe("Canonical Case Creation & SLA Policies", () => {
    it("creates canonical case with category-specific SLA deadlines", () => {
      const state = simulationStore.getState();
      const submission = simulationStore.submitComplaint({channel:"aicte_portal",complainant_name:"Test Citizen",complainant_email:"test@example.test",complainant_phone:"",complainant_category:"Citizen",institution_name:state.institutions[0].official_name,institution_permanent_id:state.institutions[0].aicte_permanent_id,subject:"Unique accessibility pathway obstruction",description:"Wheelchair entry remains blocked by permanent fencing."});
      state.duplicateCandidates.filter(d=>d.submission_id===submission.id && d.review_status==="pending").forEach(d=>simulationStore.decideDuplicate(d.id,"not_duplicate","Distinct issue confirmed"));

      const newCase = simulationStore.createCanonicalCase({
        submission_id: submission.id,
        lead_bureau_id: "bur-001-appr",
        title: "Immediate intervention required: Hostel Ragging Incident",
        description: "Severe ragging complaint forwarded from intake.",
        priority: "critical",
      });

      expect(newCase.case_number).toMatch(/^CASE-2026-\d{6}$/);
      expect(newCase.status).toBe("new");
      expect(newCase.priority).toBe("critical");
      expect(newCase.lead_bureau_id).toBe("bur-001-appr");

      // Verify immutable action history records case creation
      expect(newCase.action_history.length).toBeGreaterThanOrEqual(1);
      expect(newCase.action_history[0].action_type).toBe("case_created");
    });
  });

  describe("Case Status Transitions & Immutable History", () => {
    it("allows valid forward status transitions", () => {
      const state = simulationStore.getState();
      const newCase = state.cases.find((c) => c.status === "new");
      expect(newCase).toBeDefined();
      const caseId = newCase!.case_id;

      // new -> under_review
      simulationStore.transitionCaseStatus(caseId, "under_review", "Initial scrutiny started");
      let currentCase = simulationStore.getState().cases.find((c) => c.case_id === caseId);
      expect(currentCase?.status).toBe("under_review");

      // under_review -> assigned
      simulationStore.transitionCaseStatus(caseId, "assigned", "Assigned to scrutiny panel");
      currentCase = simulationStore.getState().cases.find((c) => c.case_id === caseId);
      expect(currentCase?.status).toBe("assigned");

      // assigned -> in_progress
      simulationStore.transitionCaseStatus(caseId, "in_progress", "Investigation actively ongoing");
      currentCase = simulationStore.getState().cases.find((c) => c.case_id === caseId);
      expect(currentCase?.status).toBe("in_progress");

      // in_progress -> awaiting_information
      simulationStore.transitionCaseStatus(caseId, "awaiting_information", "Awaiting response from Principal");
      currentCase = simulationStore.getState().cases.find((c) => c.case_id === caseId);
      expect(currentCase?.status).toBe("awaiting_information");

      // awaiting_information -> in_progress
      simulationStore.transitionCaseStatus(caseId, "in_progress", "Principal submitted clarification");
      currentCase = simulationStore.getState().cases.find((c) => c.case_id === caseId);
      expect(currentCase?.status).toBe("in_progress");

      // in_progress -> resolved
      simulationStore.transitionCaseStatus(caseId, "resolved", "Directives issued and fee refunded");
      currentCase = simulationStore.getState().cases.find((c) => c.case_id === caseId);
      expect(currentCase?.status).toBe("resolved");

      // resolved -> closed
      simulationStore.transitionCaseStatus(caseId, "closed", "Final closure approved by Bureau Head");
      currentCase = simulationStore.getState().cases.find((c) => c.case_id === caseId);
      expect(currentCase?.status).toBe("closed");

      // Action history must record all transitions
      expect(currentCase?.action_history.length).toBeGreaterThanOrEqual(7);
    });

    it("rejects invalid status transitions", () => {
      const state = simulationStore.getState();
      const newCase = state.cases.find((c) => c.status === "new");
      expect(newCase).toBeDefined();

      // Direct transition from new -> closed is forbidden
      expect(() => {
        simulationStore.transitionCaseStatus(newCase!.case_id, "closed", "Attempt illegal jump");
      }).toThrow(/Invalid status transition/);
    });
  });

  describe("Notes & Cross-Bureau Visibility", () => {
    it("records shared and bureau-private notes", () => {
      const kase = simulationStore.getState().cases[0];

      // Add shared note
      const sharedNote = simulationStore.addNote(kase.case_id, "Public inquiry response noted.", "shared");
      expect(sharedNote.visibility).toBe("shared");

      // Private notes require a bureau-scoped author.
      simulationStore.switchPersona("bureau_admin");
      const privateNote = simulationStore.addNote(kase.case_id, "Confidential vigilance tip received.", "bureau_private");
      expect(privateNote.visibility).toBe("bureau_private");

      const currentCase = simulationStore.getState().cases.find((c) => c.case_id === kase.case_id);
      expect(currentCase?.notes.some((n) => n.note_id === sharedNote.note_id)).toBe(true);
      expect(currentCase?.notes.some((n) => n.note_id === privateNote.note_id)).toBe(true);
    });
  });

  describe("Assignments & Bureau Collaboration", () => {
    it("assigns lead and collaborating bureaus", () => {
      const kase = simulationStore.getState().cases[0];

      simulationStore.assignBureau(
        kase.case_id,
        "bur-002-pap",
        "collaborating",
        "Policy bureau requested for regulatory interpretation",
      );

      const currentCase = simulationStore.getState().cases.find((c) => c.case_id === kase.case_id);
      expect(currentCase?.collaborating_bureaus.some((b) => b.bureau_id === "bur-002-pap")).toBe(true);
    });

    it("assigns case officer to bureau assignment", () => {
      const kase = simulationStore.getState().cases[0];
      const leadBureauId = kase.lead_bureau_id;

      simulationStore.assignOfficer(
        kase.case_id,
        leadBureauId,
        "usr-003-caseofficer",
        "lead_officer",
        "Assigned as primary investigating officer",
      );

      const currentCase = simulationStore.getState().cases.find((c) => c.case_id === kase.case_id);
      expect(currentCase?.officer_assignments.some((o) => o.officer_id === "usr-003-caseofficer")).toBe(true);
    });
  });

  describe("Cross-Bureau Access Grants & Case Transfers", () => {
    it("requests and approves cross-bureau case access", () => {
      const kase = simulationStore.getState().cases[0];

      simulationStore.switchPersona("collaborator");
      const grant = simulationStore.requestAccess(
        kase.case_id,
        "details",
        "Audit verification requires temporary access to case attachments",
      );

      expect(grant.status).toBe("pending");

      // Approve access from an authorized manager account.
      simulationStore.switchPersona("super_admin");
      simulationStore.approveAccess(grant.grant_id);
      const approved = simulationStore.getState().accessGrants.find((g) => g.grant_id === grant.grant_id);
      expect(approved?.status).toBe("approved");
    });

    it("initiates and approves bureau transfer", () => {
      const kase = simulationStore.getState().cases[0];

      const transfer = simulationStore.requestTransfer(
        kase.case_id,
        "bur-002-pap",
        "handover",
        "Jurisdiction pertains to Policy and Academic Planning Bureau",
      );

      expect(transfer.status).toBe("pending");
      expect(transfer.to_bureau_id).toBe("bur-002-pap");

      // Approve transfer
      simulationStore.approveTransfer(transfer.transfer_id);
      const updatedTransfer = simulationStore.getState().transfers.find((t) => t.transfer_id === transfer.transfer_id);
      expect(updatedTransfer?.status).toBe("approved");

      const updatedCase = simulationStore.getState().cases.find((c) => c.case_id === kase.case_id);
      expect(updatedCase?.lead_bureau_id).toBe("bur-002-pap");
    });
  });

  describe("Simulated Clock, SLA Countdown & Automatic Escalations", () => {
    it("advances clock by days and triggers escalations for breached cases", () => {
      const initialClock = new Date(simulationStore.getState().simulatedClock).getTime();

      // Advance clock by 15 days
      simulationStore.advanceSimulatedClock(15);

      const advancedClock = new Date(simulationStore.getState().simulatedClock).getTime();
      const diffDays = Math.round((advancedClock - initialClock) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(15);

      // Check that escalations exist
      const escalations = simulationStore.getState().escalations;
      expect(escalations.length).toBeGreaterThanOrEqual(1);

      // Check that notifications were dispatched
      const notifications = simulationStore.getState().notifications;
      expect(notifications.some((n) => n.title.includes("SLA") || n.title.includes("Escalation"))).toBe(true);
    });

    it("resets simulated clock to baseline", () => {
      simulationStore.advanceSimulatedClock(10);
      simulationStore.resetSimulatedClock();
      const clock = simulationStore.getState().simulatedClock;
      expect(clock).toBe("2026-10-29T10:00:00.000Z");
    });
  });

  describe("Simulated API Router (handleSimulatedRequest)", () => {
    it("handles GET /me with active persona details", async () => {
      const response = await handleSimulatedRequest<MeResponse>({
        method: "GET",
        path: "/me",
      });
      expect(response).toBeDefined();
      expect(response.user).toBeDefined();
      expect(response.user.official_email).toBe("superadmin@aicte.gov.in");
      expect(response.permissions.includes("case.create")).toBe(true);
    });

    it("handles GET /cases with pagination and filters", async () => {
      const response = await handleSimulatedRequest<Page<CaseIndexItem>>({
        method: "GET",
        path: "/cases?status=open&limit=10",
      });
      expect(response).toBeDefined();
      expect(Array.isArray(response.data)).toBe(true);
      expect(typeof response.page.limit).toBe("number");
    });

    it("handles GET /institutions", async () => {
      const response = await handleSimulatedRequest<Page<InstitutionSummary>>({
        method: "GET",
        path: "/institutions",
      });
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data.length).toBeGreaterThanOrEqual(8);
    });

    it("handles GET /bureaus", async () => {
      const response = await handleSimulatedRequest<SimBureau[]>({
        method: "GET",
        path: "/bureaus",
      });
      expect(Array.isArray(response)).toBe(true);
      expect(response.length).toBeGreaterThanOrEqual(5);
    });

    it("handles POST /cases/:id/status-transitions", async () => {
      const kase = simulationStore.getState().cases.find((c) => c.status === "new");
      expect(kase).toBeDefined();

      const response = await handleSimulatedRequest<SimCase>({
        method: "POST",
        path: `/cases/${kase!.case_id}/status-transitions`,
        body: {
          to_status: "under_review",
          reason: "API transition test",
        },
      });

      expect(response.status).toBe("under_review");
    });
  });
});

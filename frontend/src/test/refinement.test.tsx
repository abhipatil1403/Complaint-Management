import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { simulationStore } from "../simulation/simulationStore";
import { handleSimulatedRequest } from "../simulation/apiHandler";
import {
  canActOnCase,
  canReadCase,
  isResolved,
  reporting,
} from "../simulation/selectors";
import { getInitialState } from "../simulation/storage";
import { HelpPage } from "../pages/HelpPage";
import { SettingsPage } from "../pages/SettingsPage";
import { HomePage } from "../pages/HomePage";
import { CasesPage } from "../pages/CasesPage";
import { GlobalSearch } from "../components/GlobalSearch";
vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    activePersona: simulationStore.getActivePersona(),
    has: (p: string) =>
      simulationStore.getActivePersona().permissions.includes(p),
    simulatedClock: simulationStore.getState().simulatedClock,
  }),
}));
function freshSubmission() {
  const state = simulationStore.getState();
  const inst = state.institutions[0];
  return simulationStore.submitComplaint({
    channel: "aicte_portal",
    complainant_name: "Test Citizen",
    complainant_email: "test@example.test",
    complainant_phone: "",
    complainant_category: "Citizen",
    institution_name: inst.official_name,
    institution_permanent_id: inst.aicte_permanent_id,
    subject: "Accessible pathway blocked",
    description:
      "Original Hindi पाठ remains unchanged. Wheelchair route blocked by fencing.",
    language: "hi",
  });
}
function freshCase() {
  const sub = freshSubmission();
  simulationStore
    .getState()
    .duplicateCandidates.filter(
      (d) => d.submission_id === sub.id && d.review_status === "pending",
    )
    .forEach((d) =>
      simulationStore.decideDuplicate(d.id, "not_duplicate", "Distinct issue"),
    );
  return simulationStore.createCanonicalCase({
    submission_id: sub.id,
    lead_bureau_id: simulationStore.getState().bureaus[0].id,
    title: sub.subject,
    description: sub.description,
  });
}
beforeEach(() => {
  cleanup();
  localStorage.clear();
  simulationStore.resetPresentationData();
});
describe("Refinement regressions", () => {
  it("counts submissions separately from cases and filters actual reporting periods", () => {
    const state = simulationStore.getState();
    expect(reporting(state).submissions.length).toBe(state.submissions.length);
    freshSubmission();
    expect(reporting(state, 7).submissions.length).toBeGreaterThan(0);
    expect(reporting(state, 7).cases.length).toBeLessThanOrEqual(
      reporting(state, 90).cases.length,
    );
  });
  it("rejects unverified case creation and a second canonical association", () => {
    expect(() =>
      simulationStore.createCanonicalCase({
        submission_id: "sub-002",
        lead_bureau_id: "bur-001-appr",
        title: "Invalid",
        description: "Invalid",
      }),
    ).toThrow(/Verify/);
    const c = freshCase();
    expect(() =>
      simulationStore.createCanonicalCase({
        submission_id: c.source_submission_id,
        lead_bureau_id: c.lead_bureau_id,
        title: "Duplicate",
        description: "Duplicate",
      }),
    ).toThrow(/already belongs/);
  });
  it("preserves Unicode and state across storage reload and account switches", () => {
    const sub = freshSubmission();
    simulationStore.switchPersona("case_officer");
    expect(
      getInitialState().submissions.find((s) => s.id === sub.id)?.description,
    ).toBe(sub.description);
    expect(
      getInitialState().submissions.find((s) => s.id === sub.id)?.language,
    ).toBe("hi");
  });
  it("keeps cross-bureau content restricted until approval and removes access on revoke", async () => {
    const state = simulationStore.getState();
    const c = state.cases.find(
      (c) =>
        c.lead_bureau_id !== state.personas.collaborator.bureauId &&
        !c.collaborating_bureaus.some(
          (b) => b.bureau_id === state.personas.collaborator.bureauId,
        ),
    )!;
    simulationStore.switchPersona("collaborator");
    await expect(
      handleSimulatedRequest({ method: "GET", path: `/cases/${c.case_id}` }),
    ).rejects.toThrow(/restricted/);
    const g = simulationStore.requestAccess(
      c.case_id,
      "details",
      "Review overlap",
    );
    simulationStore.switchPersona("super_admin");
    simulationStore.approveAccess(g.grant_id);
    expect(canReadCase(c, state.personas.collaborator, state)).toBe(true);
    simulationStore.revokeAccess(g.grant_id, "Review complete");
    expect(canReadCase(c, state.personas.collaborator, state)).toBe(false);
  });
  it("filters private notes from approved readers in another bureau", async () => {
    const c = freshCase();
    simulationStore.switchPersona("bureau_admin");
    simulationStore.addNote(c.case_id, "Private review", "bureau_private");
    simulationStore.addNote(c.case_id, "Shared update", "shared");
    simulationStore.switchPersona("collaborator");
    const grant = simulationStore.requestAccess(
      c.case_id,
      "details",
      "Read shared notes",
    );
    simulationStore.switchPersona("super_admin");
    simulationStore.approveAccess(grant.grant_id);
    simulationStore.switchPersona("collaborator");
    const notes = await handleSimulatedRequest<any[]>({
      method: "GET",
      path: `/cases/${c.case_id}/notes`,
    });
    expect(notes.map((n) => n.note_text)).toEqual(["Shared update"]);
  });
  it("assigns only valid members and preserves case transfer history", () => {
    const c = freshCase();
    const state = simulationStore.getState();
    const m = state.bureauMembers.find(
      (m) => m.bureau_id === c.lead_bureau_id,
    )!;
    simulationStore.assignOfficer(
      c.case_id,
      c.lead_bureau_id,
      m.user_id,
      "lead_officer",
    );
    expect(() =>
      simulationStore.assignOfficer(
        c.case_id,
        state.bureaus[1].id,
        m.user_id,
        "supporting",
      ),
    ).toThrow(/membership/);
    const trf = simulationStore.requestTransfer(
      c.case_id,
      state.bureaus[1].id,
      "handover",
      "Correct bureau scope",
    );
    simulationStore.approveTransfer(trf.transfer_id);
    expect(c.lead_bureau_id).toBe(state.bureaus[1].id);
    expect(
      c.action_history.some((a) => a.action_type === "case_transferred"),
    ).toBe(true);
    expect(c.officer_assignments.length).toBe(1);
  });
  it("resolves escalation records and reports late resolved cases as breached", () => {
    const c = simulationStore
      .getState()
      .cases.find((c) => c.status === "in_progress")!;
    simulationStore.advanceSimulatedClock(90);
    simulationStore.transitionCaseStatus(
      c.case_id,
      "resolved",
      "Investigation complete",
    );
    expect(isResolved(c)).toBe(true);
    expect(
      simulationStore
        .getState()
        .escalations.filter((e) => e.case_id === c.case_id)
        .every((e) => e.status === "resolved"),
    ).toBe(true);
    expect(reporting(simulationStore.getState()).rate).toBeLessThan(100);
  });
  it("does not return fake success for unsupported actions", async () => {
    await expect(
      handleSimulatedRequest({
        method: "POST",
        path: "/unsupported",
        body: {},
      }),
    ).rejects.toThrow(/not supported/);
  });
  it("renders correct dashboard total without presentation controls", () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    const card = screen.getByRole("link", {
      name: /Total Complaints Received/,
    });
    expect(card.textContent).toContain(
      String(simulationStore.getState().submissions.length),
    );
    expect(screen.queryByText(/14%|Statutory SLAs|SIH 2026/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "7D" }));
    expect(screen.getByText(/over the last 7 days/)).toBeTruthy();
  });
  it("includes reopened cases in Kanban and applies URL scope", () => {
    render(
      <MemoryRouter initialEntries={["/cases?scope=overdue"]}>
        <CasesPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Reopened")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: /CASE-2026/ });
    expect(links.length).toBe(
      reporting(simulationStore.getState()).overdue.length,
    );
  });
  it("searches institutions and case records", async () => {
    render(
      <MemoryRouter>
        <GlobalSearch />
      </MemoryRouter>,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Delhi" } });
    expect(
      await screen.findByRole("button", { name: /Institution.*Delhi/ }),
    ).toBeTruthy();
    fireEvent.change(input, { target: { value: "CASE-2026-000088" } });
    expect(
      await screen.findByRole("button", { name: /Case.*CASE-2026-000088/ }),
    ).toBeTruthy();
  });
  it("searches relevant help and expands answers", () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Search help articles"), {
      target: { value: "Duplicate review" },
    });
    expect(
      screen.getByText("Duplicate review", { selector: "summary" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByText("Duplicate review", { selector: "summary" }),
    );
    expect(screen.getByText(/A similarity score identifies/)).toBeTruthy();
  });
  it("saves and discards real workspace preferences", async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(
        JSON.parse(
          localStorage.getItem(
            `onedesk-preferences-${simulationStore.getActivePersona().id}`,
          )!,
        ).notifications,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      false,
    );
  });
  it("rejects ambiguous partial institution names instead of auto-verifying", () => {
    const sub = simulationStore.submitComplaint({
      channel: "aicte_portal",
      complainant_name: "QA",
      complainant_email: "qa@example.test",
      complainant_phone: "",
      complainant_category: "Citizen",
      institution_name: "Institute",
      subject: "Review identity",
      description: "Ambiguous institution name",
    });
    expect(sub.institution_verified).toBe(false);
    expect(sub.status).toBe("under_verification");
  });
  it("has a preserved source record for every seeded case", () => {
    const state = simulationStore.getState();
    for (const c of state.cases)
      expect(
        state.submissions.some(
          (s) =>
            s.id === c.source_submission_id &&
            s.canonical_case_id === c.case_id,
        ),
      ).toBe(true);
  });
  it("enforces read-only grants and expiry", () => {
    const c = freshCase();
    const state = simulationStore.getState();
    simulationStore.switchPersona("collaborator");
    const grant = simulationStore.requestAccess(
      c.case_id,
      "details",
      "Review only",
    );
    simulationStore.switchPersona("super_admin");
    simulationStore.approveAccess(grant.grant_id);
    expect(canReadCase(c, state.personas.collaborator, state)).toBe(true);
    expect(canActOnCase(c, state.personas.collaborator, state)).toBe(false);
    simulationStore.advanceSimulatedClock(31);
    expect(canReadCase(c, state.personas.collaborator, state)).toBe(false);
  });
  it("records denial and preserves transfer ownership when declined", () => {
    const c = freshCase();
    simulationStore.switchPersona("collaborator");
    const grant = simulationStore.requestAccess(
      c.case_id,
      "details",
      "Check overlap",
    );
    simulationStore.switchPersona("super_admin");
    simulationStore.rejectAccess(
      grant.grant_id,
      "Outside current investigation scope",
    );
    expect(grant.status).toBe("rejected");
    const initial = c.lead_bureau_id;
    const transfer = simulationStore.requestTransfer(
      c.case_id,
      simulationStore.getState().bureaus[1].id,
      "handover",
      "Review ownership",
    );
    simulationStore.rejectTransfer(
      transfer.transfer_id,
      "Lead bureau retains responsibility",
    );
    expect(transfer.status).toBe("rejected");
    expect(c.lead_bureau_id).toBe(initial);
    expect(
      c.action_history.some((a) => a.action_type === "transfer_denied"),
    ).toBe(true);
  });
  it("loads uploaded binary evidence from persistent storage after refresh", async () => {
    const c = freshCase();
    const data = "data:text/plain;base64,VGVzdCBldmlkZW5jZQ==";
    const att = await simulationStore.addAttachment(c.case_id, {
      filename: "evidence.txt",
      mime_type: "text/plain",
      file_size: 13,
      data_url: data,
    });
    const persisted = getInitialState();
    expect(
      persisted.cases.find((item) => item.case_id === c.case_id)?.attachments[0]
        .data_url,
    ).toBe("");
    att.data_url = "";
    const loaded = await handleSimulatedRequest<any[]>({
      method: "GET",
      path: `/cases/${c.case_id}/attachments`,
    });
    expect(loaded[0].data_url).toBe(data);
  });
});

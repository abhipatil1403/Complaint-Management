import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { simulationStore } from "../simulation/simulationStore";
import {
  accessibleSubmissions,
  scopedState,
  canReadCase,
} from "../simulation/scope";
import { handleSimulatedRequest } from "../simulation/apiHandler";
import { getInitialState } from "../simulation/storage";
import { RoleLandingPage, ReviewWorkspace } from "../pages/RoleLandingPage";
import { ComplainantPage } from "../pages/ComplainantPage";
import { AppShell } from "../components/AppShell";
import { DemoIntakePage } from "../pages/DemoIntakePage";
import { PublicCorrespondence } from "../components/PublicCorrespondence";
import type { SimSubmission } from "../simulation/types";
vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => {
    const actor = simulationStore.getActivePersona();
    return {
      status: "ready",
      me: {
        user: { id: actor.id },
        memberships: [],
        permissions: actor.permissions,
      },
      activePersona: actor,
      personas: simulationStore.getState().personas,
      has: (p: string) => actor.permissions.includes(p),
      simulatedClock: simulationStore.getState().simulatedClock,
      signOut: vi.fn(),
      switchPersona: (key: string) => simulationStore.switchPersona(key),
      selectBureau: vi.fn(),
    };
  },
}));
beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  simulationStore.resetPresentationData();
});
function routeShell() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="portal" element={<ComplainantPage />} />
        <Route element={<AppShell />}>
          <Route index element={<RoleLandingPage />} />
          <Route
            path="workspaces/verification"
            element={<ReviewWorkspace kind="verification" />}
          />
          <Route
            path="workspaces/duplicate-review"
            element={<ReviewWorkspace kind="duplicates" />}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
function submit(channel: "aicte_portal" | "cpgrams") {
  const state = simulationStore.getState();
  return simulationStore.submitComplaint({
    channel,
    complainant_name: "Rahul Verma",
    complainant_email: "rahul.verma@example.com",
    complainant_phone: "",
    complainant_category: "Student",
    institution_name: "Unresolved fixture institution",
    category_id: state.categories[0].id,
    subject: `${channel} wheelchair pathway accessibility fixture`,
    description:
      "Original complaint text: access ramp obstructed by a permanent barrier.",
    portal_reference: channel === "cpgrams" ? "REF-QA-2026-91" : undefined,
  });
}
function reviewAndCreate(sub: SimSubmission) {
  simulationStore.switchPersona("super_admin");
  const state = simulationStore.getState();
  const task = state.verificationTasks.find((t) => t.submission_id === sub.id)!;
  simulationStore.decideVerificationTask(
    task.id,
    "verified",
    state.institutions[0].id,
    "Identity confirmed from the submitted institution reference.",
  );
  state.duplicateCandidates
    .filter((d) => d.submission_id === sub.id && d.review_status === "pending")
    .forEach((d) =>
      simulationStore.decideDuplicate(
        d.id,
        "not_duplicate",
        "Independent accessibility issue.",
      ),
    );
  simulationStore.switchPersona("bureau_admin");
  return simulationStore.createCanonicalCase({
    submission_id: sub.id,
    lead_bureau_id: state.personas.bureau_admin.bureauId!,
    title: sub.subject,
    description: sub.description,
  });
}
describe("Approved personas and role-specific workspaces", () => {
  it.each([
    ["super_admin", "System overview"],
    ["bureau_admin", "Bureau command center"],
    ["case_officer", "My assigned work"],
    ["collaborator", "Collaboration desk"],
    ["senior_mgmt", "Executive overview"],
    ["auditor", "Audit workspace"],
    ["complainant", "My complaints"],
  ])("opens the distinct %s landing", (key, title) => {
    simulationStore.switchPersona(key);
    routeShell();
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
  });
  it("switches accounts to a different landing and navigation without resetting records", async () => {
    routeShell();
    const before = simulationStore.getState().submissions.map((s) => s.id);
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    fireEvent.click(screen.getByRole("button", { name: /Vikram Singh/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "My assigned work" }),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole("link", { name: "Administration" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Analytics & SLA" })).toBeNull();
    expect(simulationStore.getState().submissions.map((s) => s.id)).toEqual(
      before,
    );
  });
  it("keeps the seven-persona roster and existing permission arrays unchanged", () => {
    const state = simulationStore.getState();
    const roles = Object.values(state.personas).map((p) => [
      p.roleCode,
      [...p.permissions],
    ]);
    for (const key of Object.keys(state.personas)) {
      simulationStore.switchPersona(key);
      scopedState(state, simulationStore.getActivePersona());
    }
    expect(Object.keys(state.personas).length).toBeGreaterThanOrEqual(7);
    expect(
      Object.values(state.personas).map((p) => [p.roleCode, p.permissions]),
    ).toEqual(roles);
  });
  it("scopes officers to assignments and bureau admins to their active bureau", async () => {
    const state = simulationStore.getState();
    const actor = state.personas.case_officer;
    const scoped = scopedState(state, actor);
    expect(scoped.cases.length).toBeGreaterThan(0);
    expect(scoped.cases.length).toBeLessThan(state.cases.length);
    expect(
      scoped.cases.every((c) =>
        c.officer_assignments.some(
          (o) => o.officer_id === actor.id && o.status === "active",
        ),
      ),
    ).toBe(true);
    const unassigned = state.cases.find(
      (c) =>
        c.lead_bureau_id === actor.bureauId &&
        !c.officer_assignments.some((o) => o.officer_id === actor.id),
    )!;
    expect(canReadCase(unassigned, actor, state)).toBe(false);
    expect(canReadCase(unassigned, state.personas.bureau_admin, state)).toBe(
      true,
    );
    simulationStore.switchPersona("case_officer");
    await expect(
      handleSimulatedRequest({
        method: "GET",
        path: `/cases/${unassigned.case_id}`,
      }),
    ).rejects.toThrow(/restricted/);
    const sources = await handleSimulatedRequest<any>({
      method: "GET",
      path: "/submissions",
    });
    expect(
      sources.data.every((s: any) =>
        scoped.cases.some((c) => c.case_id === s.canonical_case_id),
      ),
    ).toBe(true);
  });
  it("does not grant content access just because an actor is called Super Admin", () => {
    const state = simulationStore.getState();
    const actor = {
      ...state.personas.super_admin,
      permissions: ["report.view", "case.view_index"],
    };
    expect(canReadCase(state.cases[0], actor, state)).toBe(false);
  });
  it("removes work when active bureau membership ends", () => {
    const state = simulationStore.getState();
    const actor = state.personas.case_officer;
    state.bureauMembers
      .filter((m) => m.user_id === actor.id)
      .forEach((m) => (m.is_active = false));
    expect(scopedState(state, actor).cases).toHaveLength(0);
  });
  it("opens verification and duplicate responsibilities using existing capabilities", () => {
    render(
      <MemoryRouter>
        <ReviewWorkspace kind="verification" />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Institution verification desk" }),
    ).toBeTruthy();
    cleanup();
    simulationStore.switchPersona("bureau_admin");
    render(
      <MemoryRouter>
        <ReviewWorkspace kind="duplicates" />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "Duplicate review desk" }),
    ).toBeTruthy();
    cleanup();
    simulationStore.switchPersona("case_officer");
    render(
      <MemoryRouter>
        <ReviewWorkspace kind="verification" />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole("heading", { name: "Institution verification desk" }),
    ).toBeNull();
  });
});
describe("Both public portals use the same scoped processing engine", () => {
  it.each(["aicte_portal", "cpgrams"] as const)(
    "routes %s from personal history into intake, bureau, and officer work",
    async (channel) => {
      simulationStore.switchPersona("complainant");
      const sub = submit(channel);
      const state = simulationStore.getState();
      expect(sub.submitter_reference).toBe(state.personas.complainant.id);
      expect(
        accessibleSubmissions(state, state.personas.complainant).some(
          (s) => s.id === sub.id,
        ),
      ).toBe(true);
      expect(
        accessibleSubmissions(state, state.personas.bureau_admin).some(
          (s) => s.id === sub.id,
        ),
      ).toBe(false);
      simulationStore.switchPersona("super_admin");
      const intake = await handleSimulatedRequest<any>({
        method: "GET",
        path: `/submissions?channel_code=${channel}`,
      });
      expect(intake.data.some((s: any) => s.id === sub.id)).toBe(true);
      const c = reviewAndCreate(sub);
      expect(canReadCase(c, state.personas.bureau_admin, state)).toBe(true);
      expect(canReadCase(c, state.personas.case_officer, state)).toBe(false);
      simulationStore.assignOfficer(
        c.case_id,
        c.lead_bureau_id,
        state.personas.case_officer.id,
        "lead_officer",
      );
      expect(canReadCase(c, state.personas.case_officer, state)).toBe(true);
      simulationStore.switchPersona("case_officer");
      const officerCases = await handleSimulatedRequest<any>({
        method: "GET",
        path: "/cases",
      });
      expect(
        officerCases.data.some((row: any) => row.case_id === c.case_id),
      ).toBe(true);
      expect(
        getInitialState().submissions.find((s) => s.id === sub.id)
          ?.canonical_case_id,
      ).toBe(c.case_id);
      expect(sub.channel).toBe(channel);
    },
  );
  it("shows personal history by submitter identity rather than guessed email", () => {
    simulationStore.switchPersona("complainant");
    const own = submit("aicte_portal");
    simulationStore.switchPersona("super_admin");
    const impersonated = submit("cpgrams");
    simulationStore.switchPersona("complainant");
    const ownList = accessibleSubmissions(
      simulationStore.getState(),
      simulationStore.getActivePersona(),
    );
    expect(ownList.some((s) => s.id === own.id)).toBe(true);
    expect(ownList.some((s) => s.id === impersonated.id)).toBe(false);
    render(
      <MemoryRouter>
        <ComplainantPage />
      </MemoryRouter>,
    );
    expect(screen.queryByText(impersonated.tracking_code)).toBeNull();
  });
  it("keeps public responses separate from private case notes", () => {
    simulationStore.switchPersona("complainant");
    const sub = submit("aicte_portal");
    const state = simulationStore.getState();
    const c = reviewAndCreate(sub);
    simulationStore.assignOfficer(
      c.case_id,
      c.lead_bureau_id,
      state.personas.case_officer.id,
      "lead_officer",
    );
    simulationStore.switchPersona("case_officer");
    simulationStore.addNote(
      c.case_id,
      "PRIVATE INVESTIGATION ONLY",
      "bureau_private",
    );
    simulationStore.addPublicMessage(
      sub.id,
      "Please provide a photo of the blocked pathway.",
    );
    simulationStore.switchPersona("complainant");
    simulationStore.addPublicMessage(
      sub.id,
      "The evidence is attached to my original submission.",
    );
    expect(
      sub.source_metadata?.public_messages?.map((m) => m.direction),
    ).toEqual(["staff", "complainant"]);
    expect(() =>
      simulationStore.addPublicMessage("sub-002", "Unauthorized response"),
    ).toThrow(/cannot publish/);
    render(
      <MemoryRouter initialEntries={[`/portal?submission=${sub.id}`]}>
        <ComplainantPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("Please provide a photo of the blocked pathway."),
    ).toBeTruthy();
    expect(screen.queryByText("PRIVATE INVESTIGATION ONLY")).toBeNull();
    expect(
      screen.queryByRole("link", { name: /Internal Workspace/ }),
    ).toBeNull();
  });
  it("lets an assigned officer publish correspondence through the case workspace", () => {
    simulationStore.switchPersona("complainant");
    const sub = submit("aicte_portal");
    const c = reviewAndCreate(sub);
    const officer = simulationStore.getState().personas.case_officer;
    simulationStore.assignOfficer(
      c.case_id,
      c.lead_bureau_id,
      officer.id,
      "lead_officer",
    );
    simulationStore.switchPersona("case_officer");
    render(
      <MemoryRouter>
        <PublicCorrespondence caseId={c.case_id} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Public response" }), {
      target: {
        value: "The assigned officer has reviewed the additional information.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish response" }));
    expect(sub.source_metadata?.public_messages?.[0].body).toContain(
      "assigned officer",
    );
  });
  it("makes source portals distinct and prevents cross-channel reference lookup", () => {
    simulationStore.switchPersona("complainant");
    const sub = submit("aicte_portal");
    render(
      <MemoryRouter
        initialEntries={[
          `/demo/cpgrams?tab=track&reference=${sub.tracking_code}`,
        ]}
      >
        <DemoIntakePage portal="cpgrams" />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", {
        name: "Grievance referral & source tracking",
      }),
    ).toBeTruthy();
    expect(screen.queryByText(sub.subject, { exact: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lodge Grievance" }));
    expect(
      screen.getByLabelText("Originating grievance reference (optional)"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Record grievance referral" }),
    ).toBeTruthy();
  });
});

it("tracks a CPGRAMS referral by its originating reference", () => {
  simulationStore.switchPersona("complainant");
  const sub = submit("cpgrams");
  render(
    <MemoryRouter>
      <DemoIntakePage portal="cpgrams" />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Track Status" }));
  fireEvent.change(
    screen.getByRole("textbox", { name: "Referral or tracking reference" }),
    { target: { value: "REF-QA-2026-91" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Find referral" }));
  expect(screen.getByText(sub.subject, { exact: true })).toBeTruthy();
  expect(
    screen.getByText("Originating grievance reference: REF-QA-2026-91"),
  ).toBeTruthy();
});

it("rejects direct assignment and note mutations outside the actor's scope", () => {
  simulationStore.switchPersona("bureau_admin");
  const state = simulationStore.getState();
  const actor = simulationStore.getActivePersona();
  const restricted = state.cases.find((c) => !canReadCase(c, actor, state))!;
  expect(() =>
    simulationStore.addNote(restricted.case_id, "Unauthorized note"),
  ).toThrow(/restricted/);
  expect(() =>
    simulationStore.assignOfficer(
      restricted.case_id,
      actor.bureauId!,
      state.personas.case_officer.id,
      "lead_officer",
    ),
  ).toThrow(/restricted/);
  simulationStore.switchPersona("auditor");
  expect(() =>
    simulationStore.addNote(state.cases[0].case_id, "Unauthorized audit note"),
  ).toThrow(/restricted/);
});

it("redacts out-of-bureau candidate content while retaining its minimal case index", async () => {
  simulationStore.switchPersona("bureau_admin");
  const state = simulationStore.getState();
  const actor = simulationStore.getActivePersona();
  const target = state.cases.find((c) => !canReadCase(c, actor, state))!;
  const source = accessibleSubmissions(state, actor)[0];
  const candidate = {
    ...state.duplicateCandidates[0],
    id: "cross-review",
    candidate_id: "cross-review",
    submission_id: source.id,
    candidate_case_id: target.case_id,
    case_number: target.case_number,
    case_title: target.title,
  };
  state.duplicateCandidates.push(candidate);
  const detail = await handleSimulatedRequest<any>({
    method: "GET",
    path: "/duplicate-review/candidates/cross-review",
  });
  expect(detail.case_content_accessible).toBe(false);
  expect(detail.case_number).toBe(target.case_number);
  expect(detail.case_title).toBe("Restricted case content");
  expect(detail.matching_signals.keyword_overlap).toEqual([]);
  const queue = await handleSimulatedRequest<any>({
    method: "GET",
    path: "/duplicate-review/candidates",
  });
  expect(
    queue.data.find((d: any) => d.candidate_id === "cross-review").case_title,
  ).toBe("Restricted case content");
});

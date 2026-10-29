/**
 * AICTE OneDesk — Simulated API Dispatcher
 *
 * Intercepts requests destined for the FastAPI backend and provides 100% faithful,
 * type-compliant responses directly from the local SimulationStore.
 */

import { accessibleSubmissions } from "./scope";
import { getBinaryFile } from "./storage";
import { canActOnCase, canReadCase, visibleNotifications } from "./selectors";
import { simulationStore } from "./simulationStore";
import type {
  CaseIndexItem,
  InstitutionDetail,
  InstitutionSummary,
  MeResponse,
  Page,
} from "../types";
import type { CaseStatus } from "./types";

interface RequestParams {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: any;
  bureauId?: string | null;
}

export async function handleSimulatedRequest<T>(
  params: RequestParams,
): Promise<T> {
  const { method, path, body } = params;
  const state = simulationStore.getState();
  const actor = simulationStore.getActivePersona();

  // Strip query string for path matching
  const [pathname, queryString] = path.split("?");
  const query = new URLSearchParams(queryString || "");

  const requirePermission = (permission: string) => {
    if (!actor.permissions.includes(permission))
      throw new Error("You do not have permission for this action.");
  };
  const casePath = pathname.match(/^\/cases\/([^/]+)/);
  if (casePath) {
    const c = state.cases.find((c) => c.case_id === casePath[1]);
    const requestOnly = pathname.endsWith("/access-requests");
    if (c && method !== "GET" && !requestOnly && !canActOnCase(c, actor, state))
      throw new Error("This case grant is read-only.");
    if (c && !requestOnly && !canReadCase(c, actor, state))
      throw new Error(
        "Case content is restricted. Request cross-bureau access from the case index.",
      );
  }

  if (pathname.startsWith("/verification/tasks"))
    requirePermission("institution.verify");
  if (pathname.startsWith("/duplicate-review/queue"))
    requirePermission("duplicate.review");
  if (pathname.startsWith("/duplicate-review/candidates"))
    requirePermission("duplicate.review");
  if (pathname.startsWith("/institutions"))
    requirePermission("institution.view");
  if (pathname.startsWith("/bureaus")) requirePermission("bureau.view");
  if (pathname.startsWith("/regions")) requirePermission("region.view");
  if (method !== "GET") {
    if (pathname.endsWith("/status-transitions"))
      requirePermission("case.status.change");
    if (pathname.endsWith("/bureau-assignments"))
      requirePermission("case.assign.bureau");
    if (pathname.endsWith("/officer-assignments"))
      requirePermission("case.assign.officer");
    if (pathname.endsWith("/notes")) requirePermission("case.note.create");
    if (pathname.endsWith("/attachments"))
      requirePermission("attachment.upload");
  }
  if (pathname.startsWith("/verification/"))
    requirePermission("institution.verify");
  if (pathname.startsWith("/duplicate-review/"))
    requirePermission("duplicate.review");
  // Simulated latency for realism (50ms)
  await new Promise((r) => setTimeout(r, 40));

  // Reference administration uses the same persisted local records as case workflows.
  const referenceMatch = pathname.match(
    /^\/(institutions|bureaus|regions)(?:\/([^/]+))?$/,
  );
  if (referenceMatch && (method === "POST" || method === "PATCH")) {
    const [, kind, id] = referenceMatch;
    requirePermission(
      kind === "institutions"
        ? "institution.manage"
        : kind === "bureaus"
          ? "bureau.manage"
          : "region.manage",
    );
    const records: any[] =
      state[kind as "institutions" | "bureaus" | "regions"];
    let record = id ? records.find((r) => r.id === id) : null;
    if (id && !record) throw new Error("Record not found");
    if (!id) {
      const name = body.official_name || body.name;
      if (!name?.trim()) throw new Error("A name is required.");
      if (
        records.some((r) =>
          kind === "institutions"
            ? body.aicte_permanent_id &&
              r.aicte_permanent_id === body.aicte_permanent_id
            : r.code.toLowerCase() === body.code?.toLowerCase(),
        )
      )
        throw new Error("That identifier is already in use.");
      record = {
        id: crypto.randomUUID(),
        is_active: true,
        created_at: state.simulatedClock,
        ...(kind === "institutions"
          ? {
              aliases: [],
              city: "",
              state: "",
              region_id: "",
              region_name: "",
              contact_email: "",
              contact_phone: "",
              website_url: "",
              institution_type: "",
              ownership_type: "",
              aicte_permanent_id: "",
              verification_status: "pending",
            }
          : kind === "bureaus"
            ? {
                bureau_type: "bureau",
                display_order: 0,
                parent_bureau_id: null,
                lead_name: "",
                lead_email: "",
                case_count: 0,
              }
            : { description: "" }),
      };
      records.push(record);
    }
    Object.assign(record, body, { updated_at: state.simulatedClock });
    if (kind === "institutions") {
      if (body.state_name !== undefined) record.state = body.state_name;
      const region = state.regions.find((r) => r.id === record.region_id);
      record.region_name = region?.name || "";
    }
    simulationStore.persistChanges();
    return record as T;
  }
  const aliasCreate = pathname.match(/^\/institutions\/([^/]+)\/aliases$/);
  if (method === "POST" && aliasCreate) {
    requirePermission("institution.manage");
    const inst = state.institutions.find((i) => i.id === aliasCreate[1]);
    if (!inst) throw new Error("Institution not found");
    if (!body.alias_name?.trim()) throw new Error("Enter an alias");
    if (inst.aliases.includes(body.alias_name.trim()))
      throw new Error("Alias already exists");
    inst.aliases.push(body.alias_name.trim());
    simulationStore.persistChanges();
    return {
      id: `alias-${inst.id}-${inst.aliases.length - 1}`,
      institution_id: inst.id,
      ...body,
    } as T;
  }
  if (method === "POST" && pathname === "/bureau-memberships") {
    requirePermission("bureau.manage");
    const user = Object.values(state.personas).find(
      (p) => p.id === body.user_id,
    );
    if (
      !user ||
      !state.bureaus.some((b) => b.id === body.bureau_id && b.is_active)
    )
      throw new Error("Select an active user and bureau.");
    if (
      state.bureauMembers.some(
        (m) =>
          m.user_id === user.id &&
          m.bureau_id === body.bureau_id &&
          m.is_active,
      )
    )
      throw new Error("An active membership already exists.");
    const member = {
      id: crypto.randomUUID(),
      bureau_id: body.bureau_id,
      user_id: user.id,
      full_name: user.name,
      email: user.email,
      designation: user.designation,
      membership_type: body.membership_type || "member",
      is_active: true,
      assigned_cases_count: 0,
    };
    state.bureauMembers.push(member);
    simulationStore.persistChanges();
    return member as T;
  }
  const membershipEnd = pathname.match(/^\/bureau-memberships\/([^/]+)\/end$/);
  if (method === "POST" && membershipEnd) {
    requirePermission("bureau.manage");
    const member = state.bureauMembers.find((m) => m.id === membershipEnd[1]);
    if (!member) throw new Error("Membership not found");
    member.is_active = false;
    simulationStore.persistChanges();
    return member as T;
  }
  const page = (data: unknown[]) => ({
    data,
    page: { limit: data.length, next_cursor: null },
    request_id: "local",
  });
  const statusMap: Record<string, string> = {
    under_verification: "awaiting_institution_verification",
    duplicate_review: "awaiting_duplicate_review",
    canonical_case_created: "associated_with_case",
  };
  const submissionView = (s: (typeof state.submissions)[number]) => ({
    ...s,
    external_reference: s.submission_number,
    source_event_id: s.id,
    channel: {
      code: s.channel,
      name: s.channel === "cpgrams" ? "CPGRAMS" : "AICTE Portal",
      is_simulated: true,
    },
    institution:
      state.institutions.find((i) => i.id === s.matched_institution_id) || null,
    institution_name_as_submitted: s.institution_name_submitted,
    original_language: s.language,
    intake_status:
      s.status !== "rejected" &&
      s.institution_verified &&
      !s.canonical_case_id &&
      !state.duplicateCandidates.some(
        (d) => d.submission_id === s.id && d.review_status === "pending",
      )
        ? "ready_for_case_creation"
        : statusMap[s.status] || s.status,
    original_text: s.description,
    content_fingerprint: null,
    source_submitted_at: s.received_at,
    reference_origin: s.channel,
    simulation_notice_version: null,
    consent_acknowledged: true,
    created_at: s.received_at,
  });
  if (method === "GET" && pathname === "/submissions") {
    requirePermission("submission.view");
    const items = accessibleSubmissions(state, actor)
      .map(submissionView)
      .filter(
        (s) =>
          (query.get("ready_only") !== "true" ||
            (s.institution_verified &&
              !s.canonical_case_id &&
              s.status !== "rejected" &&
              !state.duplicateCandidates.some(
                (d) =>
                  d.submission_id === s.id && d.review_status === "pending",
              ))) &&
          (!query.get("intake_status") ||
            s.intake_status === query.get("intake_status")) &&
          (!query.get("language") ||
            s.original_language === query.get("language")) &&
          (!query.get("channel_code") ||
            s.channel.code === query.get("channel_code")),
      );
    return page(items) as T;
  }
  const subMatch = pathname.match(/^\/submissions\/([^/]+)$/);
  if (method === "GET" && subMatch) {
    requirePermission("submission.view");
    const sub = accessibleSubmissions(state, actor).find(
      (s) => s.id === subMatch[1],
    );
    if (!sub) throw new Error("Submission not found");
    return submissionView(sub) as T;
  }
  if (method === "GET" && pathname === "/demo/info")
    return {
      demo_intake_enabled: true,
      channels: [
        { code: "aicte_portal", name: "AICTE Portal", portal: "aicte" },
        { code: "cpgrams", name: "CPGRAMS Portal", portal: "cpgrams" },
      ],
    } as T;
  const userView = (p: typeof actor) => ({
    id: p.id,
    full_name: p.name,
    display_name: p.name,
    official_email: p.email,
    designation: p.designation,
    employee_code: p.id,
    account_status: "active",
    memberships: p.bureauId
      ? [
          {
            bureau_id: p.bureauId,
            bureau_code: p.bureauCode,
            bureau_name: p.bureauName,
            membership_type: "member",
            is_primary: true,
          },
        ]
      : [],
    roles: [
      {
        role_code: p.roleCode,
        role_name: p.roleName,
        bureau_id: p.bureauId,
        bureau_name: p.bureauName,
        scope_type: p.scopeType,
        permissions: p.permissions,
      },
    ],
    permissions: p.permissions,
    created_at: state.simulatedClock,
    updated_at: state.simulatedClock,
  });
  if (method === "GET" && pathname === "/users") {
    requirePermission("user.view");
    const q = (query.get("q") || "").toLowerCase();
    return page(
      Object.values(state.personas)
        .filter(
          (p) =>
            (!q || `${p.name} ${p.email}`.toLowerCase().includes(q)) &&
            (!query.get("account_status") ||
              query.get("account_status") === "active"),
        )
        .map(userView),
    ) as T;
  }
  const userMatch = pathname.match(/^\/users\/([^/]+)$/);
  if (method === "GET" && userMatch) {
    requirePermission("user.view");
    const p = Object.values(state.personas).find((p) => p.id === userMatch[1]);
    if (!p) throw new Error("User not found");
    return userView(p) as T;
  }
  if (method === "GET" && pathname === "/roles") {
    requirePermission("role.view");
    return Object.values(state.personas).map((p) => ({
      id: p.key,
      code: p.roleCode,
      name: p.roleName,
      scope_type: p.scopeType,
      is_active: true,
      is_system_role: true,
      description: p.designation,
      permissions: p.permissions,
    })) as T;
  }

  // -------------------------------------------------------------------------
  // /me
  // -------------------------------------------------------------------------
  if (method === "GET" && pathname === "/me") {
    const me: MeResponse = {
      user: {
        id: actor.id,
        full_name: actor.name,
        display_name: actor.name.split(" ")[0],
        official_email: actor.email,
        designation: actor.designation,
        employee_code: `AICTE-${actor.id.slice(-4).toUpperCase()}`,
        account_status: "active",
      },
      roles: [
        {
          role_code: actor.roleCode,
          role_name: actor.roleName,
          scope_type: actor.scopeType,
          bureau_id: actor.bureauId,
          bureau_name: actor.bureauName,
          permissions: actor.permissions,
        },
      ],
      memberships: actor.bureauId
        ? [
            {
              bureau_id: actor.bureauId,
              bureau_code: actor.bureauCode || "BUR",
              bureau_name: actor.bureauName || "Bureau",
              membership_type: actor.key === "bureau_admin" ? "head" : "member",
              is_primary: true,
            },
          ]
        : [],
      active_bureau_id: actor.bureauId,
      permissions: actor.permissions,
      global_permissions: actor.scopeType === "global" ? actor.permissions : [],
      is_super_admin: actor.key === "super_admin",
      demo_mode: false,
      demo_notice: "",
    };
    return me as unknown as T;
  }

  // -------------------------------------------------------------------------
  // /cases
  // -------------------------------------------------------------------------
  if (method === "GET" && pathname === "/cases") {
    if (
      !actor.permissions.includes("case.view_index") &&
      !actor.permissions.includes("case.view_detail")
    )
      throw new Error("Case-index permission is required.");
    let list =
      query.get("index") === "all"
        ? [...state.cases]
        : state.cases.filter((c) => canReadCase(c, actor, state));

    const statusParam = query.get("status");
    if (statusParam && statusParam !== "all") {
      list = list.filter((c) => c.status === statusParam);
    }

    const bureauParam = query.get("bureau_id");
    if (bureauParam && bureauParam !== "all") {
      list = list.filter(
        (c) =>
          c.lead_bureau_id === bureauParam ||
          c.collaborating_bureaus.some((cb) => cb.bureau_id === bureauParam),
      );
    }

    const priorityParam = query.get("priority");
    if (priorityParam && priorityParam !== "all") {
      list = list.filter((c) => c.priority === priorityParam);
    }

    const searchParam = query.get("search")?.toLowerCase().trim();
    if (searchParam) {
      list = list.filter(
        (c) =>
          c.case_number.toLowerCase().includes(searchParam) ||
          (canReadCase(c, actor, state) &&
            c.title.toLowerCase().includes(searchParam)) ||
          c.institution_name.toLowerCase().includes(searchParam),
      );
    }

    const items: CaseIndexItem[] = list.map((c) => ({
      case_id: c.case_id as any,
      case_number: c.case_number,
      institution_id: c.institution_id as any,
      institution_name: c.institution_name,
      institution_region: c.institution_region ?? null,
      category_id: c.category_id as any,
      category_name: c.category_name,
      status: c.status,
      priority: c.priority,
      lead_bureau_id: c.lead_bureau_id as any,
      lead_bureau_name: c.lead_bureau_name,
      lead_bureau_code: c.lead_bureau_code,
      opened_at: c.opened_at,
      closed_at: c.closed_at ?? null,
      can_view_details: canReadCase(c, actor, state),
    }));

    const page: Page<CaseIndexItem> = {
      data: items,
      page: { limit: 50, next_cursor: null },
      request_id: `req-${Date.now()}`,
    };
    return page as unknown as T;
  }

  // Case details: GET /cases/:id
  const caseDetailMatch = pathname.match(/^\/cases\/([^/]+)$/);
  if (method === "GET" && caseDetailMatch) {
    const caseId = caseDetailMatch[1];
    const c = state.cases.find(
      (item) => item.case_id === caseId || item.case_number === caseId,
    );
    if (!c) throw new Error("Case not found");

    const detail = {
      ...c,
      attachments: [],
      notes: actor.permissions.includes("case.note.view")
        ? c.notes.filter(
            (n) =>
              n.visibility === "shared" ||
              n.bureau_id === actor.bureauId ||
              actor.scopeType === "global",
          )
        : [],
      notes_count: c.notes.length,
      attachments_count: c.attachments.length,
    };
    return detail as unknown as T;
  }

  // POST /cases (create case)
  if (method === "POST" && pathname === "/cases") {
    const created = simulationStore.createCanonicalCase({
      submission_id: body.submission_id,
      lead_bureau_id: body.lead_bureau_id,
      title: body.title,
      description: body.description,
      priority: body.priority,
    });
    return created as unknown as T;
  }

  // POST /cases/:id/status-transitions
  const statusTransMatch = pathname.match(
    /^\/cases\/([^/]+)\/status-transitions$/,
  );
  if (method === "POST" && statusTransMatch) {
    const caseId = statusTransMatch[1];
    simulationStore.transitionCaseStatus(
      caseId,
      body.to_status as CaseStatus,
      body.reason || "Status transition requested",
    );
    const updated = state.cases.find((c) => c.case_id === caseId);
    return updated as unknown as T;
  }

  // Notes: GET /cases/:id/notes
  const caseNotesMatch = pathname.match(/^\/cases\/([^/]+)\/notes$/);
  if (method === "GET" && caseNotesMatch) {
    const caseId = caseNotesMatch[1];
    const c = state.cases.find((item) => item.case_id === caseId);
    requirePermission("case.note.view");
    const notes = (c?.notes || []).filter(
      (n) =>
        n.visibility === "shared" ||
        n.bureau_id === actor.bureauId ||
        actor.scopeType === "global",
    );
    return notes as unknown as T;
  }

  // POST /cases/:id/notes
  if (method === "POST" && caseNotesMatch) {
    const caseId = caseNotesMatch[1];
    const createdNote = simulationStore.addNote(
      caseId,
      body.note_text,
      body.visibility || "shared",
      body.note_type || "general",
    );
    return createdNote as unknown as T;
  }

  // DELETE /cases/:id/notes/:note_id
  const deleteNoteMatch = pathname.match(/^\/cases\/([^/]+)\/notes\/([^/]+)$/);
  if (method === "DELETE" && deleteNoteMatch) {
    const [, caseId, noteId] = deleteNoteMatch;
    simulationStore.deleteNote(caseId, noteId);
    return { success: true } as unknown as T;
  }

  // Attachments: GET /cases/:id/attachments
  const caseAttachMatch = pathname.match(/^\/cases\/([^/]+)\/attachments$/);
  if (method === "GET" && caseAttachMatch) {
    const caseId = caseAttachMatch[1];
    const c = state.cases.find((item) => item.case_id === caseId);
    requirePermission("attachment.view");
    const attachments = await Promise.all(
      (c?.attachments || []).map(async (a) => ({
        ...a,
        data_url: a.is_quarantined
          ? ""
          : a.data_url?.startsWith("idb:")
            ? (await getBinaryFile(a.data_url.slice(4))) || ""
            : a.data_url || (await getBinaryFile(a.attachment_id)) || "",
      })),
    );
    return attachments as unknown as T;
  }

  // POST /cases/:id/attachments
  if (method === "POST" && caseAttachMatch) {
    const caseId = caseAttachMatch[1];
    const createdAtt = await simulationStore.addAttachment(caseId, {
      filename: body.original_filename || body.filename || "evidence.pdf",
      mime_type: body.mime_type || "application/pdf",
      file_size: body.file_size_bytes || body.file_size || 1024 * 100,
      data_url:
        body.data_url || "data:application/pdf;base64,JVBERi0xLjQKJcTl8uXr...",
      description: body.description,
      attachment_type: body.attachment_type || "evidence_document",
    });
    return createdAtt as unknown as T;
  }

  // POST /cases/:id/bureau-assignments
  const bureauAssignMatch = pathname.match(
    /^\/cases\/([^/]+)\/bureau-assignments$/,
  );
  if (method === "POST" && bureauAssignMatch) {
    const caseId = bureauAssignMatch[1];
    simulationStore.assignBureau(
      caseId,
      body.bureau_id,
      body.assignment_type || "collaborating",
      body.reason,
    );
    return { success: true } as unknown as T;
  }

  // POST /bureau-assignments/:id/officer-assignments
  const officerAssignMatch = pathname.match(
    /^\/bureau-assignments\/([^/]+)\/officer-assignments$/,
  );
  if (method === "POST" && officerAssignMatch) {
    const bureauAssignId = officerAssignMatch[1];
    // Find case containing this or match active case
    const targetCase = body.case_id
      ? state.cases.find((c) => c.case_id === body.case_id)
      : state.cases.find((c) =>
          c.collaborating_bureaus.some((cb) => cb.bureau_id === bureauAssignId),
        ) ||
        state.cases.find((c) => c.lead_bureau_id === bureauAssignId) ||
        undefined;
    if (!targetCase)
      throw new Error("Select the case for this officer assignment.");

    simulationStore.assignOfficer(
      targetCase.case_id,
      bureauAssignId,
      body.officer_user_id,
      body.role || "supporting",
      body.notes,
    );
    return { success: true } as unknown as T;
  }

  // POST /cases/:id/transfers
  const caseTransferMatch = pathname.match(/^\/cases\/([^/]+)\/transfers$/);
  if (method === "POST" && caseTransferMatch) {
    const caseId = caseTransferMatch[1];
    const trf = simulationStore.requestTransfer(
      caseId,
      body.to_bureau_id,
      body.transfer_type || "handover",
      body.reason,
    );
    return trf as unknown as T;
  }

  // Access requests: POST /cases/:id/access-requests
  const accessReqMatch = pathname.match(/^\/cases\/([^/]+)\/access-requests$/);
  if (method === "POST" && accessReqMatch) {
    const caseId = accessReqMatch[1];
    const grant = simulationStore.requestAccess(
      caseId,
      body.access_level || "details",
      body.justification,
    );
    return grant as unknown as T;
  }

  // GET /cases/:id/access-grants
  const accessGrantsMatch = pathname.match(/^\/cases\/([^/]+)\/access-grants$/);
  if (method === "GET" && accessGrantsMatch) {
    const caseId = accessGrantsMatch[1];
    const grants = state.accessGrants.filter((g) => g.case_id === caseId);
    return grants as unknown as T;
  }

  // POST /access-grants/:id/revoke
  const revokeGrantMatch = pathname.match(/^\/access-grants\/([^/]+)\/revoke$/);
  if (method === "POST" && revokeGrantMatch) {
    const grantId = revokeGrantMatch[1];
    simulationStore.revokeAccess(
      grantId,
      body?.revocation_reason || "Revoked by user",
    );
    return { success: true } as unknown as T;
  }

  // Case relationships / linking: POST /cases/:id/relationships or /cases/:id/link
  const caseLinkMatch = pathname.match(
    /^\/cases\/([^/]+)\/(?:relationships|link)$/,
  );
  if (method === "POST" && caseLinkMatch) {
    const caseId = caseLinkMatch[1];
    const relatedCaseId = body.related_case_id || body.target_case_id;
    if (!relatedCaseId) throw new Error("Target case ID is required to link cases.");
    const relType = body.relationship_type || "same_institution";
    const desc = body.description || body.notes;
    const result = simulationStore.linkCases(caseId, relatedCaseId, relType, desc);
    return result.caseA as unknown as T;
  }

  // Submission linking to existing case: POST /submissions/:id/link-case
  const subLinkMatch = pathname.match(
    /^\/(?:submissions|duplicate-review\/submissions)\/([^/]+)\/link-case$/,
  );
  if (method === "POST" && subLinkMatch) {
    const subId = subLinkMatch[1];
    const targetCaseId = body.case_id || body.target_case_id;
    if (!targetCaseId) throw new Error("Target case ID is required.");
    const notes = body.notes || body.justification;
    const result = simulationStore.linkSubmissionToCase(subId, targetCaseId, notes);
    return result as unknown as T;
  }

  // -------------------------------------------------------------------------
  // /verification/tasks
  // -------------------------------------------------------------------------
  if (method === "GET" && pathname === "/verification/tasks") {
    const formatted = state.verificationTasks.map((t) => {
      const sub =
        state.submissions.find((s) => s.id === t.submission_id) ||
        state.submissions[0];
      return {
        id: t.id,
        status:
          t.verification_status === "verified"
            ? "verified"
            : t.verification_status === "rejected"
              ? "rejected"
              : (t as any).assigned_to_user_id
                ? "in_review"
                : "pending",
        priority: "normal",
        submitted_institution_name: t.submitted_name,
        submitted_permanent_id: t.submitted_pid || null,
        candidate_institution_id: t.candidate_institution_id || null,
        candidate_count: 1,
        strongest_evidence: t.candidate_institution_id
          ? "exact_or_alias_match"
          : "unmatched_text",
        assigned_to_user_id: (t as any).assigned_to_user_id || null,
        assigned_to_name: (t as any).assigned_to_name || null,
        reviewed_by_user_id: null,
        reviewed_by_name: t.reviewer_name || null,
        resolved_institution_id: t.verified_institution_id || null,
        resolved_institution_name: t.candidate_institution_name || null,
        resolution_notes: t.review_notes || null,
        resolved_at: t.updated_at,
        created_at: t.created_at,
        updated_at: t.updated_at,
        age_days: 1,
        round_type: "new_round",
        requester_user_id: null,
        submission: {
          id: sub?.id || t.submission_id,
          channel_code: sub?.channel || "aicte_portal",
          channel_name:
            sub?.channel === "cpgrams" ? "CPGRAMS Portal" : "AICTE Portal",
          channel_is_simulated: true,
          external_reference: sub?.submission_number || t.submission_number,
          source_event_id: null,
          received_at: sub?.received_at || t.created_at,
          updated_at: sub?.updated_at || t.updated_at,
          intake_status: sub?.status || "under_verification",
          original_language: "en",
          institution_name_as_submitted: t.submitted_name,
          submitted_permanent_id: t.submitted_pid || null,
          institution_id: t.candidate_institution_id || null,
          institution_official_name: t.candidate_institution_name || null,
          institution_permanent_id: t.submitted_pid || null,
          canonical_case_id: null,
        },
      };
    });

    const page: Page<any> = {
      data: formatted
        .filter((t) => {
          if (
            query.get("corrections_only") === "true" &&
            !state.verificationTasks.some(
              (raw) =>
                raw.id === t.id &&
                (raw.verification_status === "correction_requested" ||
                  (raw as any).requester_user_id),
            )
          )
            return false;
          const status = query.get("status");
          const q = (query.get("q") || "").toLowerCase();
          return (
            (!status ||
              status === "all" ||
              (status === "open"
                ? t.status === "pending" || t.status === "in_review"
                : t.status === status)) &&
            (!query.get("priority") || t.priority === query.get("priority")) &&
            (query.get("assignment") !== "mine" ||
              t.assigned_to_user_id === actor.id) &&
            (query.get("assignment") !== "unassigned" ||
              !t.assigned_to_user_id) &&
            (!q ||
              `${t.submitted_institution_name} ${t.submission.external_reference}`
                .toLowerCase()
                .includes(q))
          );
        })
        .sort(
          (a, b) =>
            (query.get("sort") === "newest" ? -1 : 1) *
            (Date.parse(a.created_at) - Date.parse(b.created_at)),
        ),
      page: { limit: 50, next_cursor: null },
      request_id: `req-${Date.now()}`,
    };
    return page as unknown as T;
  }

  const verTaskDetailMatch = pathname.match(/^\/verification\/tasks\/([^/]+)$/);
  if (method === "GET" && verTaskDetailMatch) {
    const taskId = verTaskDetailMatch[1];
    const task = state.verificationTasks.find((t) => t.id === taskId);
    if (!task) throw new Error("Verification task not found");

    const sub =
      state.submissions.find((s) => s.id === task.submission_id) ||
      state.submissions[0];
    const formattedTask = {
      id: task.id,
      status:
        task.verification_status === "verified"
          ? "verified"
          : task.verification_status === "rejected"
            ? "rejected"
            : (task as any).assigned_to_user_id
              ? "in_review"
              : "pending",
      priority: "normal",
      submitted_institution_name: task.submitted_name,
      submitted_permanent_id: task.submitted_pid || null,
      candidate_institution_id: task.candidate_institution_id || null,
      candidate_count: 1,
      strongest_evidence: task.candidate_institution_id
        ? "exact_or_alias_match"
        : "unmatched_text",
      assigned_to_user_id: (task as any).assigned_to_user_id || null,
      assigned_to_name: (task as any).assigned_to_name || null,
      reviewed_by_user_id: null,
      reviewed_by_name: task.reviewer_name || null,
      resolved_institution_id: task.verified_institution_id || null,
      resolved_institution_name: task.candidate_institution_name || null,
      resolution_notes: task.review_notes || null,
      resolved_at: task.updated_at,
      created_at: task.created_at,
      updated_at: task.updated_at,
      age_days: 1,
      round_type: "new_round",
      requester_user_id: null,
      submission: {
        id: sub?.id || task.submission_id,
        channel_code: sub?.channel || "aicte_portal",
        channel_name:
          sub?.channel === "cpgrams" ? "CPGRAMS Portal" : "AICTE Portal",
        channel_is_simulated: true,
        external_reference: sub?.submission_number || task.submission_number,
        source_event_id: null,
        received_at: sub?.received_at || task.created_at,
        updated_at: sub?.updated_at || task.updated_at,
        intake_status: sub?.status || "under_verification",
        original_language: "en",
        institution_name_as_submitted: task.submitted_name,
        submitted_permanent_id: task.submitted_pid || null,
        institution_id: task.candidate_institution_id || null,
        institution_official_name: task.candidate_institution_name || null,
        institution_permanent_id: task.submitted_pid || null,
        canonical_case_id: null,
      },
    };
    return formattedTask as unknown as T;
  }

  // GET /verification/submissions/:id/candidates
  const verSubCandidatesMatch = pathname.match(
    /^\/verification\/submissions\/([^/]+)\/candidates$/,
  );
  if (method === "GET" && verSubCandidatesMatch) {
    const matchTask = state.verificationTasks.find(
      (t) => t.submission_id === verSubCandidatesMatch[1],
    );
    const candidates = [...state.institutions]
      .sort(
        (a, b) =>
          Number(b.id === matchTask?.candidate_institution_id) -
          Number(a.id === matchTask?.candidate_institution_id),
      )
      .map((inst) => ({
        institution_id: inst.id,
        official_name: inst.official_name,
        permanent_id: inst.aicte_permanent_id,
        region_code: inst.region_id,
        region_name: inst.region_name,
        verification_status: inst.verification_status,
        is_active: inst.is_active,
        evidence: ["master_record"],
        matched_alias_id: null,
        matched_alias_name: inst.aliases[0] || null,
        evidence_rank: inst.id === matchTask?.candidate_institution_id ? 1 : 3,
        is_eligible: inst.is_active && inst.verification_status === "verified",
      }));
    return { data: candidates } as unknown as T;
  }

  const verDecisionMatch = pathname.match(
    /^\/verification\/tasks\/([^/]+)\/decision$/,
  );
  if (method === "POST" && verDecisionMatch) {
    const taskId = verDecisionMatch[1];
    const task = state.verificationTasks.find((t) => t.id === taskId);
    if (!task) throw new Error("Verification task not found");
    const editable = task as typeof task & {
      assigned_to_user_id?: string;
      assigned_to_name?: string;
    };
    if (body.action === "assign_to_me" || body.action === "unassign") {
      editable.assigned_to_user_id =
        body.action === "assign_to_me" ? actor.id : undefined;
      editable.assigned_to_name =
        body.action === "assign_to_me" ? actor.name : undefined;
      task.updated_at = state.simulatedClock;
      simulationStore.persistChanges();
    } else {
      if (!body.reason?.trim()) throw new Error("Provide a review reason.");
      if (
        body.action === "confirm" &&
        (task as any).requester_user_id === actor.id
      )
        throw new Error(
          "Another reviewer must confirm this correction request.",
        );
      simulationStore.decideVerificationTask(
        taskId,
        body.action === "reject"
          ? "rejected"
          : body.action === "request_information"
            ? "correction_requested"
            : "verified",
        body.institution_id,
        body.reason,
      );
    }
    return { success: true } as unknown as T;
  }

  const correctionRound = pathname.match(
    /^\/verification\/submissions\/([^/]+)\/correction-rounds$/,
  );
  if (method === "POST" && correctionRound) {
    requirePermission("institution.verify");
    const sub = state.submissions.find((s) => s.id === correctionRound[1]);
    if (!sub || sub.canonical_case_id)
      throw new Error("Correction requires an unlinked submission.");
    const task = state.verificationTasks.find(
      (t) => t.submission_id === sub.id,
    );
    if (!task) throw new Error("Verification task not found");
    task.verification_status = "pending";
    (task as any).requester_user_id = actor.id;
    task.review_notes = body.reason;
    sub.institution_verified = false;
    sub.status = "under_verification";
    task.updated_at = state.simulatedClock;
    simulationStore.persistChanges();
    return { id: task.id } as T;
  }
  if (method === "POST" && pathname === "/duplicate-review/screen") {
    requirePermission("duplicate.review");
    return {
      inserted_count: simulationStore.screenSubmission(body.submission_id),
    } as T;
  }
  const verCorrectionMatch = pathname.match(
    /^\/verification\/tasks\/([^/]+)\/correction-round$/,
  );
  if (method === "POST" && verCorrectionMatch) {
    const taskId = verCorrectionMatch[1];
    simulationStore.decideVerificationTask(
      taskId,
      "correction_requested",
      undefined,
      body.reason || "Additional clarification requested from complainant",
    );
    return { success: true } as unknown as T;
  }

  // -------------------------------------------------------------------------
  // /duplicate-review/candidates
  // -------------------------------------------------------------------------
  if (
    method === "GET" &&
    (pathname === "/duplicate-review/candidates" ||
      pathname === "/duplicate-review/queue")
  ) {
    const page: Page<any> = {
      data: state.duplicateCandidates
        .filter((d) =>
          accessibleSubmissions(state, actor).some(
            (s) => s.id === d.submission_id,
          ),
        )
        .filter(
          (d) =>
            (query.get("confidence") !== "high" || d.similarity_score >= 0.9) &&
            (!query.get("status") ||
              query.get("status") === "all" ||
              d.review_status === query.get("status")) &&
            (!query.get("q") ||
              `${d.case_number} ${d.submission_number} ${d.submission_subject}`
                .toLowerCase()
                .includes(query.get("q")!.toLowerCase())),
        )
        .map((d) => ({
          ...d,
          case_title: state.cases.some(
            (c) =>
              c.case_id === d.candidate_case_id && canReadCase(c, actor, state),
          )
            ? d.case_title
            : "Restricted case content",
          matching_signals: {
            ...d.matching_signals,
            keyword_overlap: state.cases.some(
              (c) =>
                c.case_id === d.candidate_case_id &&
                canReadCase(c, actor, state),
            )
              ? d.matching_signals.keyword_overlap
              : [],
          },
          institution_name: d.submission_institution_name,
          institution_id: state.submissions.find(
            (s) => s.id === d.submission_id,
          )?.matched_institution_id,
          candidate_created_at: d.created_at,
          matching_heuristic: d.matching_method,
          submission_institution_verified: state.submissions.find(
            (s) => s.id === d.submission_id,
          )?.institution_verified,
          submission_updated_at: state.submissions.find(
            (s) => s.id === d.submission_id,
          )?.updated_at,
          candidate_updated_at: d.reviewed_at || d.created_at,
        })),
      page: { limit: 50, next_cursor: null },
      request_id: `req-${Date.now()}`,
    };
    return page as unknown as T;
  }

  const dupCandidateMatch = pathname.match(
    /^\/duplicate-review\/candidates\/([^/]+)$/,
  );
  if (method === "GET" && dupCandidateMatch) {
    const candidateId = dupCandidateMatch[1];
    const cand = state.duplicateCandidates.find(
      (c) => c.id === candidateId || c.candidate_id === candidateId,
    );
    if (!cand) throw new Error("Duplicate candidate not found");
    if (
      !accessibleSubmissions(state, actor).some(
        (s) => s.id === cand.submission_id,
      )
    )
      throw new Error("This duplicate candidate is outside your review scope.");

    const target = state.cases.find(
      (c) => c.case_id === cand.candidate_case_id,
    );
    const contentAccessible = !!target && canReadCase(target, actor, state);
    const detail = {
      ...cand,
      case_content_accessible: contentAccessible,
      case_title: contentAccessible
        ? cand.case_title
        : "Restricted case content",
      matching_signals: contentAccessible
        ? cand.matching_signals
        : { ...cand.matching_signals, keyword_overlap: [] },
      submission_updated_at:
        cand.submission_received_at || state.simulatedClock,
      candidate_updated_at: cand.created_at || state.simulatedClock,
      matching_heuristic: cand.matching_method || "semantic_cluster",
      submission_category_name:
        state.submissions.find((s) => s.id === cand.submission_id)
          ?.category_name || "Uncategorized",
      case_category_name:
        state.cases.find((c) => c.case_id === cand.candidate_case_id)
          ?.category_name || "Uncategorized",
      candidate_created_at: cand.created_at,
      case_created_at: state.cases.find(
        (c) => c.case_id === cand.candidate_case_id,
      )?.opened_at,
      case_lead_bureau_name: state.cases.find(
        (c) => c.case_id === cand.candidate_case_id,
      )?.lead_bureau_name,
      candidate_case_title: contentAccessible
        ? cand.case_title
        : "Restricted case content",
      candidate_institution_name: cand.case_institution_name,
    };
    return detail as unknown as T;
  }

  const dupDecideMatch = pathname.match(
    /^\/duplicate-review\/candidates\/([^/]+)\/decide$/,
  );
  if (method === "POST" && dupDecideMatch) {
    const candidateId = dupDecideMatch[1];
    if (body.target_case_id) {
      const cand = state.duplicateCandidates.find(
        (c) => c.id === candidateId || c.candidate_id === candidateId,
      );
      if (cand) {
        simulationStore.linkSubmissionToCase(
          cand.submission_id,
          body.target_case_id,
          body.review_notes || body.notes,
        );
        return { success: true } as unknown as T;
      }
    }
    simulationStore.decideDuplicate(
      candidateId,
      body.action || body.decision,
      body.review_notes || body.notes,
    );
    return { success: true } as unknown as T;
  }

  const rejectSubMatch = pathname.match(
    /^\/duplicate-review\/submissions\/([^/]+)\/reject$/,
  );
  if (method === "POST" && rejectSubMatch) {
    const subId = rejectSubMatch[1];
    const sub = accessibleSubmissions(state, actor).find((s) => s.id === subId);
    if (!sub) throw new Error("This submission is outside your review scope.");
    if (sub) {
      sub.status = "rejected";
      sub.updated_at = state.simulatedClock;
      simulationStore.persistChanges();
    }
    return { success: true } as unknown as T;
  }

  // -------------------------------------------------------------------------
  // /institutions
  // -------------------------------------------------------------------------
  if (method === "GET" && pathname === "/institutions") {
    const q = (query.get("q") || "").toLowerCase();
    const items: InstitutionSummary[] = state.institutions
      .filter(
        (i) =>
          (!q ||
            `${i.official_name} ${i.aicte_permanent_id}`
              .toLowerCase()
              .includes(q)) &&
          (!query.get("region_id") || i.region_id === query.get("region_id")) &&
          (!query.get("verification_status") ||
            i.verification_status === query.get("verification_status")) &&
          (query.get("is_active") !== "true" || i.is_active),
      )
      .map((i) => ({
        id: i.id,
        aicte_permanent_id: i.aicte_permanent_id,
        official_name: i.official_name,
        verification_status: i.verification_status,
        is_active: i.is_active,
        region: {
          id: i.region_id,
          code: i.region_id.toUpperCase(),
          name: i.region_name,
        },
      }));

    const page: Page<InstitutionSummary> = {
      data: items,
      page: { limit: 50, next_cursor: null },
      request_id: `req-${Date.now()}`,
    };
    return page as unknown as T;
  }

  const instDetailMatch = pathname.match(/^\/institutions\/([^/]+)$/);
  if (method === "GET" && instDetailMatch) {
    const instId = instDetailMatch[1];
    const inst = state.institutions.find((i) => i.id === instId);
    if (!inst) throw new Error("Institution not found");

    const detail: InstitutionDetail = {
      id: inst.id,
      aicte_permanent_id: inst.aicte_permanent_id,
      official_name: inst.official_name,
      verification_status: inst.verification_status,
      is_active: inst.is_active,
      region: {
        id: inst.region_id,
        code: inst.region_id.toUpperCase(),
        name: inst.region_name,
      },
      institution_type: inst.institution_type,
      ownership_type: inst.ownership_type,
      address_line1: `${inst.city}, ${inst.state}`,
      address_line2: null,
      city: inst.city,
      district: inst.city,
      state_name: inst.state,
      postal_code: "110001",
      contact_email: inst.contact_email,
      contact_phone: inst.contact_phone,
      website_url: inst.website_url,
      verification_source: "AICTE Portal",
      verification_reference: inst.aicte_permanent_id,
      verified_at: "2026-01-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-10-25T00:00:00.000Z",
    };
    return detail as unknown as T;
  }

  const instAliasesMatch = pathname.match(/^\/institutions\/([^/]+)\/aliases$/);
  if (method === "GET" && instAliasesMatch) {
    const instId = instAliasesMatch[1];
    const inst = state.institutions.find((i) => i.id === instId);
    const aliases = (inst?.aliases || []).map((name, idx) => ({
      id: `alias-${instId}-${idx}`,
      institution_id: instId,
      alias_name: name,
      alias_type: "alternate_name",
      source_type: "manual",
      source_reference: null,
      language_code: "en",
      verification_status: "verified",
      is_active: true,
      created_at: state.simulatedClock,
      updated_at: state.simulatedClock,
    }));
    return aliases as unknown as T;
  }

  // -------------------------------------------------------------------------
  // /bureaus
  // -------------------------------------------------------------------------
  if (method === "GET" && pathname === "/bureaus") {
    return state.bureaus
      .filter((b) => query.get("include_inactive") === "true" || b.is_active)
      .map((b, i) => ({
        bureau_type: "bureau",
        parent_bureau_id: null,
        display_order: i,
        created_at: state.simulatedClock,
        updated_at: state.simulatedClock,
        ...b,
      })) as unknown as T;
  }

  const bureauDetailMatch = pathname.match(/^\/bureaus\/([^/]+)$/);
  if (method === "GET" && bureauDetailMatch) {
    const bureauId = bureauDetailMatch[1];
    const b = state.bureaus.find(
      (item) => item.id === bureauId || item.code === bureauId,
    );
    if (!b) throw new Error("Bureau not found");
    return {
      bureau_type: "bureau",
      parent_bureau_id: null,
      display_order: 0,
      created_at: state.simulatedClock,
      updated_at: state.simulatedClock,
      ...b,
    } as unknown as T;
  }

  const bureauMembersMatch = pathname.match(/^\/bureaus\/([^/]+)\/members$/);
  if (method === "GET" && bureauMembersMatch) {
    const bureauId = bureauMembersMatch[1];
    const members = state.bureauMembers.filter((m) => m.bureau_id === bureauId);
    return members
      .filter((m) => query.get("include_inactive") === "true" || m.is_active)
      .map((m) => ({
        ...m,
        membership_id: m.id,
        official_email: m.email,
        membership_status: m.is_active ? "active" : "inactive",
        is_primary: true,
        joined_at: null,
        ended_at: null,
      })) as unknown as T;
  }

  // -------------------------------------------------------------------------
  // /regions
  // -------------------------------------------------------------------------
  if (method === "GET" && pathname === "/regions") {
    return state.regions.filter(
      (r) => query.get("include_inactive") === "true" || r.is_active,
    ) as unknown as T;
  }

  // -------------------------------------------------------------------------
  // /intake/submissions & /demo/submissions
  // -------------------------------------------------------------------------
  if (method === "GET" && pathname === "/intake/submissions") {
    const page: Page<any> = {
      data: state.submissions,
      page: { limit: 50, next_cursor: null },
      request_id: `req-${Date.now()}`,
    };
    return page as unknown as T;
  }

  if (
    method === "POST" &&
    (pathname === "/demo/submissions" || pathname === "/intake/submissions")
  ) {
    const sub = simulationStore.submitComplaint({
      channel: body.channel || "aicte_portal",
      complainant_name: body.complainant_name || actor.name,
      complainant_email: body.complainant_email || actor.email,
      complainant_phone: body.complainant_phone || "+91-9876543210",
      complainant_category: body.complainant_category || "Citizen",
      institution_name:
        body.institution_name_as_submitted || body.institution_name,
      institution_permanent_id: body.institution_permanent_id,
      category_id: body.category_id,
      subject: body.subject,
      description: body.description,
      relief_sought: body.relief_sought,
      attachments: body.attachments,
    });
    return {
      submission_id: sub.id,
      submission_number: sub.submission_number,
      tracking_code: sub.tracking_code,
      channel: sub.channel,
      status: sub.status,
      received_at: sub.received_at,
    } as unknown as T;
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------
  if (method === "GET" && pathname === "/notifications") {
    return visibleNotifications(state, actor) as unknown as T;
  }

  const notifReadMatch = pathname.match(/^\/notifications\/([^/]+)\/read$/);
  if (method === "POST" && notifReadMatch) {
    simulationStore.markNotificationRead(notifReadMatch[1]);
    return { success: true } as unknown as T;
  }

  if (method === "POST" && pathname === "/notifications/read-all") {
    simulationStore.markAllNotificationsRead();
    return { success: true } as unknown as T;
  }

  // -------------------------------------------------------------------------
  // Escalations
  // -------------------------------------------------------------------------
  if (method === "GET" && pathname === "/escalations") {
    return state.escalations as unknown as T;
  }

  const escAckMatch = pathname.match(/^\/escalations\/([^/]+)\/acknowledge$/);
  if (method === "POST" && escAckMatch) {
    simulationStore.acknowledgeEscalation(escAckMatch[1], body?.notes);
    return { success: true } as unknown as T;
  }

  const escResMatch = pathname.match(/^\/escalations\/([^/]+)\/resolve$/);
  if (method === "POST" && escResMatch) {
    simulationStore.resolveEscalation(
      escResMatch[1],
      body?.notes || "Resolved by authority",
    );
    return { success: true } as unknown as T;
  }

  throw new Error(`This action is not supported: ${method} ${pathname}`);
}

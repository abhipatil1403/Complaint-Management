"""Phase 1 authorization model.

Permissions are stored in PostgreSQL as UPPERCASE codes because the physical
schema enforces ``code = upper(btrim(code))``. The API exposes the lowercase
dotted form used by docs/Api_document.md (for example ``institution.view``).
"""

from __future__ import annotations

# --- Permission catalogue (single source of truth for Phase 1) -----------

REGION_VIEW = "region.view"
REGION_MANAGE = "region.manage"

INSTITUTION_VIEW = "institution.view"
INSTITUTION_MANAGE = "institution.manage"
INSTITUTION_ALIAS_VIEW = "institution.alias.view"
INSTITUTION_ALIAS_MANAGE = "institution.alias.manage"

BUREAU_VIEW = "bureau.view"
BUREAU_MANAGE = "bureau.manage"
BUREAU_MEMBERS_VIEW = "bureau.members.view"
BUREAU_MEMBERS_MANAGE = "bureau.members.manage"

USER_VIEW = "user.view"
USER_MANAGE = "user.manage"
ROLE_VIEW = "role.view"
ROLE_MANAGE = "role.manage"

PHASE1_PERMISSIONS: dict[str, dict[str, str]] = {
    REGION_VIEW: {"name": "View regions", "resource_type": "region", "action_type": "view"},
    REGION_MANAGE: {"name": "Manage regions", "resource_type": "region", "action_type": "manage"},
    INSTITUTION_VIEW: {
        "name": "View institutions",
        "resource_type": "institution",
        "action_type": "view",
    },
    INSTITUTION_MANAGE: {
        "name": "Manage institutions",
        "resource_type": "institution",
        "action_type": "manage",
    },
    INSTITUTION_ALIAS_VIEW: {
        "name": "View institution aliases",
        "resource_type": "institution.alias",
        "action_type": "view",
    },
    INSTITUTION_ALIAS_MANAGE: {
        "name": "Manage institution aliases",
        "resource_type": "institution.alias",
        "action_type": "manage",
    },
    BUREAU_VIEW: {"name": "View bureaus", "resource_type": "bureau", "action_type": "view"},
    BUREAU_MANAGE: {"name": "Manage bureaus", "resource_type": "bureau", "action_type": "manage"},
    BUREAU_MEMBERS_VIEW: {
        "name": "View bureau members",
        "resource_type": "bureau.members",
        "action_type": "view",
    },
    BUREAU_MEMBERS_MANAGE: {
        "name": "Manage bureau members",
        "resource_type": "bureau.members",
        "action_type": "manage",
    },
    USER_VIEW: {"name": "View authorized users", "resource_type": "user", "action_type": "view"},
    USER_MANAGE: {"name": "Manage users, role grants and memberships", "resource_type": "user", "action_type": "manage"},
    ROLE_VIEW: {"name": "View role catalogue", "resource_type": "role", "action_type": "view"},
    ROLE_MANAGE: {"name": "Manage role catalogue", "resource_type": "role", "action_type": "manage"},
}

# Persona roles from PRD section 7.1.
SUPER_ADMIN = "SUPER_ADMIN"
BUREAU_ADMIN = "BUREAU_ADMIN"
CASE_OFFICER = "CASE_OFFICER"
CROSS_BUREAU_COLLABORATOR = "CROSS_BUREAU_COLLABORATOR"
SENIOR_MANAGEMENT = "SENIOR_MANAGEMENT"
AUDITOR = "AUDITOR"

ROLE_DEFINITIONS: dict[str, dict[str, object]] = {
    SUPER_ADMIN: {
        "name": "Super Admin",
        "scope_type": "global",
        "description": "Manages reference data, authorized users and memberships. Restricted case content still requires an explicit permission.",
        "permissions": [
            REGION_VIEW,
            REGION_MANAGE,
            INSTITUTION_VIEW,
            INSTITUTION_MANAGE,
            INSTITUTION_ALIAS_VIEW,
            INSTITUTION_ALIAS_MANAGE,
            BUREAU_VIEW,
            BUREAU_MANAGE,
            BUREAU_MEMBERS_VIEW,
            BUREAU_MEMBERS_MANAGE,
            USER_VIEW,
            USER_MANAGE,
            ROLE_VIEW,
            ROLE_MANAGE,
        ],
    },
    BUREAU_ADMIN: {
        "name": "Bureau Administrator",
        "scope_type": "bureau",
        "description": "Administers work inside one bureau. Membership-management delegation is not defined in Phase 1, so it stays read-only for staff.",
        "permissions": [
            REGION_VIEW,
            INSTITUTION_VIEW,
            INSTITUTION_ALIAS_VIEW,
            BUREAU_VIEW,
            BUREAU_MEMBERS_VIEW,
        ],
    },
    CASE_OFFICER: {
        "name": "Case Officer",
        "scope_type": "bureau",
        "description": "Works assigned case tasks within a bureau.",
        "permissions": [
            REGION_VIEW,
            INSTITUTION_VIEW,
            INSTITUTION_ALIAS_VIEW,
            BUREAU_VIEW,
            BUREAU_MEMBERS_VIEW,
        ],
    },
    CROSS_BUREAU_COLLABORATOR: {
        "name": "Cross-bureau collaborator",
        "scope_type": "bureau",
        "description": "Sees the minimal case index outside the home bureau and may request access.",
        "permissions": [
            REGION_VIEW,
            INSTITUTION_VIEW,
            INSTITUTION_ALIAS_VIEW,
            BUREAU_VIEW,
            BUREAU_MEMBERS_VIEW,
        ],
    },
    SENIOR_MANAGEMENT: {
        "name": "Senior Management / Competent Authority",
        "scope_type": "global",
        "description": "Reviews authorized aggregate information; restricted details remain permission-controlled.",
        "permissions": [
            REGION_VIEW,
            INSTITUTION_VIEW,
            INSTITUTION_ALIAS_VIEW,
            BUREAU_VIEW,
        ],
    },
    AUDITOR: {
        "name": "Auditor / Read-only official",
        "scope_type": "global",
        "description": "Read-only access to authorized reference data and history.",
        "permissions": [
            REGION_VIEW,
            INSTITUTION_VIEW,
            INSTITUTION_ALIAS_VIEW,
            BUREAU_VIEW,
        ],
    },
}


# --- Phase 2.1 intake capability -----------------------------------------
# Kept separate from PHASE1_PERMISSIONS: Phase 1's catalogue is frozen, and the
# intake capability is granted to Super Admin only, as an explicit grant.
SUBMISSION_VIEW = "submission.view"

PHASE2_PERMISSIONS: dict[str, dict[str, str]] = {
    SUBMISSION_VIEW: {
        "name": "View intake submissions",
        "resource_type": "submission",
        "action_type": "view",
    },
}

PHASE2_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    SUPER_ADMIN: (SUBMISSION_VIEW,),
}


# --- Phase 2.2 institution verification capability ----------------------
# Kept separate from both earlier catalogues: Phase 1 and Phase 2.1 stay frozen.
# The capability only reaches the human verification queue; it never grants
# access to complaint content.
INSTITUTION_VERIFY = "institution.verify"

PHASE2_VERIFICATION_PERMISSIONS: dict[str, dict[str, str]] = {
    INSTITUTION_VERIFY: {
        "name": "Verify submitted institution identity",
        "resource_type": "institution",
        "action_type": "verify",
    },
}

PHASE2_VERIFICATION_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    SUPER_ADMIN: (INSTITUTION_VERIFY,),
}


# --- Phase 2.3 duplicate review and canonical case creation capabilities ---
DUPLICATE_REVIEW = "duplicate.review"
CASE_CREATE = "case.create"
CASE_VIEW_INDEX = "case.view_index"
CASE_VIEW_DETAIL = "case.view_detail"
SUBMISSION_REJECT = "submission.reject"

PHASE2_DUPLICATE_PERMISSIONS: dict[str, dict[str, str]] = {
    DUPLICATE_REVIEW: {
        "name": "Review duplicate complaint candidates",
        "resource_type": "duplicate_candidates",
        "action_type": "review",
    },
    CASE_CREATE: {
        "name": "Create canonical complaint cases",
        "resource_type": "cases",
        "action_type": "create",
    },
    CASE_VIEW_INDEX: {
        "name": "View cross-bureau minimal case index",
        "resource_type": "cases",
        "action_type": "view_index",
    },
    CASE_VIEW_DETAIL: {
        "name": "View full case details",
        "resource_type": "cases",
        "action_type": "view_detail",
    },
    SUBMISSION_REJECT: {
        "name": "Reject invalid intake submissions",
        "resource_type": "submissions",
        "action_type": "reject",
    },
}

PHASE2_DUPLICATE_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    SUPER_ADMIN: (DUPLICATE_REVIEW, CASE_CREATE, CASE_VIEW_INDEX, CASE_VIEW_DETAIL, SUBMISSION_REJECT),
    SENIOR_MANAGEMENT: (DUPLICATE_REVIEW, CASE_VIEW_INDEX, CASE_VIEW_DETAIL),
    CASE_OFFICER: (CASE_CREATE, CASE_VIEW_INDEX, CASE_VIEW_DETAIL),
    BUREAU_ADMIN: (CASE_CREATE, CASE_VIEW_INDEX, CASE_VIEW_DETAIL),
    CROSS_BUREAU_COLLABORATOR: (CASE_VIEW_INDEX, CASE_VIEW_DETAIL),
    AUDITOR: (CASE_VIEW_INDEX,),
}


# --- Phase 3 & 4 Operations and Cross-Bureau Controls Capabilities ---
CASE_STATUS_CHANGE = "case.status.change"
CASE_HISTORY_VIEW = "case.history.view"
CASE_NOTE_VIEW = "case.note.view"
CASE_NOTE_CREATE = "case.note.create"
CASE_NOTE_EDIT = "case.note.edit"
CASE_ASSIGN_BUREAU = "case.assign.bureau"
CASE_ASSIGN_OFFICER = "case.assign.officer"
ATTACHMENT_UPLOAD = "attachment.upload"
ATTACHMENT_VIEW = "attachment.view"
ATTACHMENT_DOWNLOAD = "attachment.download"
ATTACHMENT_QUARANTINE = "attachment.quarantine"
CASE_TRANSFER_REQUEST = "case.transfer.request"
CASE_TRANSFER_DECIDE = "case.transfer.decide"
CASE_ACCESS_REQUEST = "case.access.request"
CASE_ACCESS_REVIEW = "case.access.review"
CASE_ACCESS_APPROVE = "case.access.approve"
CASE_ACCESS_MANAGE = "case.access.manage"
CASE_ACCESS_REVOKE = "case.access.revoke"

PHASE3_PHASE4_PERMISSIONS: dict[str, dict[str, str]] = {
    CASE_STATUS_CHANGE: {
        "name": "Change case status and lifecycle state",
        "resource_type": "cases",
        "action_type": "status.change",
    },
    CASE_HISTORY_VIEW: {
        "name": "View case action history and audit events",
        "resource_type": "cases",
        "action_type": "history.view",
    },
    CASE_NOTE_VIEW: {
        "name": "View internal case notes",
        "resource_type": "case_notes",
        "action_type": "view",
    },
    CASE_NOTE_CREATE: {
        "name": "Create shared or bureau-private case notes",
        "resource_type": "case_notes",
        "action_type": "create",
    },
    CASE_NOTE_EDIT: {
        "name": "Edit or soft-delete authorized case notes",
        "resource_type": "case_notes",
        "action_type": "edit",
    },
    CASE_ASSIGN_BUREAU: {
        "name": "Assign or manage bureau participation",
        "resource_type": "case_bureau_assignments",
        "action_type": "assign",
    },
    CASE_ASSIGN_OFFICER: {
        "name": "Assign or manage officer roles",
        "resource_type": "case_officer_assignments",
        "action_type": "assign",
    },
    ATTACHMENT_UPLOAD: {
        "name": "Upload evidence and case attachments",
        "resource_type": "attachments",
        "action_type": "upload",
    },
    ATTACHMENT_VIEW: {
        "name": "View attachment metadata and scan status",
        "resource_type": "attachments",
        "action_type": "view",
    },
    ATTACHMENT_DOWNLOAD: {
        "name": "Generate short-lived signed download capability",
        "resource_type": "attachments",
        "action_type": "download",
    },
    ATTACHMENT_QUARANTINE: {
        "name": "Quarantine suspicious attachments",
        "resource_type": "attachments",
        "action_type": "quarantine",
    },
    CASE_TRANSFER_REQUEST: {
        "name": "Request inter-bureau case transfer",
        "resource_type": "case_transfers",
        "action_type": "request",
    },
    CASE_TRANSFER_DECIDE: {
        "name": "Approve, reject, or cancel case transfers",
        "resource_type": "case_transfers",
        "action_type": "decide",
    },
    CASE_ACCESS_REQUEST: {
        "name": "Request cross-bureau restricted case access",
        "resource_type": "case_access_requests",
        "action_type": "request",
    },
    CASE_ACCESS_REVIEW: {
        "name": "View pending cross-bureau access requests",
        "resource_type": "case_access_requests",
        "action_type": "review",
    },
    CASE_ACCESS_APPROVE: {
        "name": "Approve or deny cross-bureau access requests",
        "resource_type": "case_access_requests",
        "action_type": "approve",
    },
    CASE_ACCESS_MANAGE: {
        "name": "View and manage active case access grants",
        "resource_type": "case_access_grants",
        "action_type": "manage",
    },
    CASE_ACCESS_REVOKE: {
        "name": "Revoke active cross-bureau access grants",
        "resource_type": "case_access_grants",
        "action_type": "revoke",
    },
}

PHASE3_PHASE4_ROLE_GRANTS: dict[str, tuple[str, ...]] = {
    SUPER_ADMIN: (
        CASE_STATUS_CHANGE, CASE_HISTORY_VIEW, CASE_NOTE_VIEW, CASE_NOTE_CREATE,
        CASE_NOTE_EDIT, CASE_ASSIGN_BUREAU, CASE_ASSIGN_OFFICER, ATTACHMENT_UPLOAD,
        ATTACHMENT_VIEW, ATTACHMENT_DOWNLOAD, ATTACHMENT_QUARANTINE, CASE_TRANSFER_REQUEST,
        CASE_TRANSFER_DECIDE, CASE_ACCESS_REQUEST, CASE_ACCESS_REVIEW, CASE_ACCESS_APPROVE,
        CASE_ACCESS_MANAGE, CASE_ACCESS_REVOKE,
    ),
    BUREAU_ADMIN: (
        CASE_STATUS_CHANGE, CASE_HISTORY_VIEW, CASE_NOTE_VIEW, CASE_NOTE_CREATE,
        CASE_NOTE_EDIT, CASE_ASSIGN_BUREAU, CASE_ASSIGN_OFFICER, ATTACHMENT_UPLOAD,
        ATTACHMENT_VIEW, ATTACHMENT_DOWNLOAD, CASE_TRANSFER_REQUEST, CASE_TRANSFER_DECIDE,
        CASE_ACCESS_REQUEST, CASE_ACCESS_REVIEW, CASE_ACCESS_APPROVE, CASE_ACCESS_MANAGE,
        CASE_ACCESS_REVOKE,
    ),
    CASE_OFFICER: (
        CASE_STATUS_CHANGE, CASE_HISTORY_VIEW, CASE_NOTE_VIEW, CASE_NOTE_CREATE,
        CASE_NOTE_EDIT, CASE_ASSIGN_OFFICER, ATTACHMENT_UPLOAD, ATTACHMENT_VIEW,
        ATTACHMENT_DOWNLOAD, CASE_TRANSFER_REQUEST, CASE_ACCESS_REQUEST,
    ),
    CROSS_BUREAU_COLLABORATOR: (
        CASE_HISTORY_VIEW, CASE_NOTE_VIEW, CASE_NOTE_CREATE, ATTACHMENT_VIEW,
        ATTACHMENT_DOWNLOAD, CASE_ACCESS_REQUEST,
    ),
    SENIOR_MANAGEMENT: (
        CASE_HISTORY_VIEW, CASE_NOTE_VIEW, ATTACHMENT_VIEW, ATTACHMENT_DOWNLOAD,
        CASE_ACCESS_REVIEW, CASE_ACCESS_APPROVE, CASE_ACCESS_MANAGE,
    ),
    AUDITOR: (
        CASE_HISTORY_VIEW, CASE_NOTE_VIEW, ATTACHMENT_VIEW,
    ),
}


def to_db_code(api_code: str) -> str:
    return api_code.strip().upper()


def to_api_code(db_code: str) -> str:
    return db_code.strip().lower()



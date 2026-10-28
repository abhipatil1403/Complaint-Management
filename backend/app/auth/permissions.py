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


def to_db_code(api_code: str) -> str:
    return api_code.strip().upper()


def to_api_code(db_code: str) -> str:
    return db_code.strip().lower()

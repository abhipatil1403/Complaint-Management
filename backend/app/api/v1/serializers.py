"""Response shaping helpers.

Field-level shaping keeps index-style payloads small and avoids leaking fields
that the caller has no business need for.
"""

from __future__ import annotations

from typing import Any, Mapping


def region_payload(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "code": row["code"],
        "name": row["name"],
        "description": row.get("description"),
        "is_active": row["is_active"],
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _region_ref(row: Mapping[str, Any]) -> dict[str, Any] | None:
    if not row.get("region_id") or not row.get("region_code"):
        return None
    return {"id": row["region_id"], "code": row["region_code"], "name": row["region_name"]}


def institution_summary(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "aicte_permanent_id": row.get("aicte_permanent_id"),
        "official_name": row["official_name"],
        "verification_status": row["verification_status"],
        "is_active": row["is_active"],
        "region": _region_ref(row),
    }


def institution_detail(row: Mapping[str, Any]) -> dict[str, Any]:
    payload = institution_summary(row)
    payload.update(
        {
            "institution_type": row.get("institution_type"),
            "ownership_type": row.get("ownership_type"),
            "address_line1": row.get("address_line1"),
            "address_line2": row.get("address_line2"),
            "city": row.get("city"),
            "district": row.get("district"),
            "state_name": row.get("state_name"),
            "postal_code": row.get("postal_code"),
            "contact_email": row.get("contact_email"),
            "contact_phone": row.get("contact_phone"),
            "website_url": row.get("website_url"),
            "verification_source": row.get("verification_source"),
            "verification_reference": row.get("verification_reference"),
            "verified_at": row.get("verified_at"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
        }
    )
    return payload


def submission_channel(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "code": row["channel_code"],
        "name": row["channel_name"],
        "is_simulated": bool(row["channel_is_simulated"]),
    }


def _institution_ref(row: Mapping[str, Any]) -> dict[str, Any] | None:
    if not row.get("institution_id") or not row.get("official_name"):
        return None
    return {
        "id": row["institution_id"],
        "aicte_permanent_id": row.get("aicte_permanent_id"),
        "official_name": row["official_name"],
    }


def submission_summary(row: Mapping[str, Any]) -> dict[str, Any]:
    """Queue/index shape.

    ``original_text`` is deliberately absent: complaint bodies are only
    returned by the authorized detail endpoint.
    """
    return {
        "id": row["id"],
        "external_reference": row.get("external_reference"),
        "source_event_id": row.get("source_event_id"),
        "channel": submission_channel(row),
        "received_at": row["received_at"],
        "institution": _institution_ref(row),
        "institution_name_as_submitted": row.get("institution_name_as_submitted"),
        "subject": row["subject"],
        "original_language": row["original_language"],
        "intake_status": row["intake_status"],
        "canonical_case_id": row.get("canonical_case_id"),
    }


def submission_detail(row: Mapping[str, Any]) -> dict[str, Any]:
    payload = submission_summary(row)
    metadata = row.get("source_metadata") or {}
    payload.update(
        {
            "original_text": row["original_text"],
            "content_fingerprint": row.get("content_fingerprint"),
            "source_submitted_at": metadata.get("source_submitted_at"),
            "reference_origin": metadata.get("reference_origin"),
            "simulation_notice_version": metadata.get("simulation_notice_version"),
            "consent_acknowledged": metadata.get("consent_acknowledged"),
            "created_at": row["created_at"],
        }
    )
    return payload


def verification_task_payload(row: Mapping[str, Any]) -> dict[str, Any]:
    """Queue/detail shape for one verification task.

    Contains provenance and workflow metadata only. Complaint subject and body
    text are never selected by the underlying projection.
    """
    return {
        "id": row["out_task_id"],
        "status": row["out_status"],
        "priority": row["out_priority"],
        "submitted_institution_name": row["out_submitted_institution_name"],
        "submitted_permanent_id": row["out_submitted_permanent_id"],
        "candidate_institution_id": row["out_candidate_institution_id"],
        "candidate_count": row["out_candidate_count"] or 0,
        "strongest_evidence": row["out_strongest_evidence"],
        "assigned_to_user_id": row["out_assigned_to_user_id"],
        "assigned_to_name": row["out_assigned_to_name"],
        "reviewed_by_user_id": row["out_reviewed_by_user_id"],
        "reviewed_by_name": row["out_reviewed_by_name"],
        "resolved_institution_id": row["out_resolved_institution_id"],
        "resolved_institution_name": row["out_resolved_institution_name"],
        "resolution_notes": row["out_resolution_notes"],
        "resolved_at": row["out_resolved_at"],
        "created_at": row["out_created_at"],
        "updated_at": row["out_updated_at"],
        "age_days": row["out_age_days"],
        "round_type": row["out_round_type"],
        "requester_user_id": row["out_requester_user_id"],
        "submission": {
            "id": row["out_submission_id"],
            "channel_code": row["out_channel_code"],
            "channel_name": row["out_channel_name"],
            "channel_is_simulated": bool(row["out_channel_is_simulated"]),
            "external_reference": row["out_external_reference"],
            "source_event_id": row["out_source_event_id"],
            "received_at": row["out_received_at"],
            "updated_at": row["out_submission_updated_at"],
            "intake_status": row["out_intake_status"],
            "original_language": row["out_original_language"],
            "institution_name_as_submitted": row["out_institution_name_as_submitted"],
            "submitted_permanent_id": row["out_submitted_permanent_id"],
            "institution_id": row["out_submission_institution_id"],
            "institution_official_name": row["out_submission_institution_name"],
            "institution_permanent_id": row["out_submission_institution_permanent_id"],
            "canonical_case_id": row["out_canonical_case_id"],
        },
    }


def verification_candidate_payload(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "institution_id": row["out_institution_id"],
        "official_name": row["out_official_name"],
        "permanent_id": row["out_permanent_id"],
        "region_code": row["out_region_code"],
        "region_name": row["out_region_name"],
        "verification_status": row["out_verification_status"],
        "is_active": bool(row["out_is_active"]),
        "evidence": list(row["out_evidence"] or []),
        "matched_alias_id": row["out_matched_alias_id"],
        "matched_alias_name": row["out_matched_alias_name"],
        "evidence_rank": row["out_evidence_rank"],
        "is_eligible": bool(row["out_is_eligible"]),
    }


def bureau_payload(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "code": row["code"],
        "name": row["name"],
        "description": row.get("description"),
        "parent_bureau_id": row.get("parent_bureau_id"),
        "bureau_type": row["bureau_type"],
        "is_active": row["is_active"],
        "display_order": row["display_order"],
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def bureau_member_payload(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "membership_id": row["membership_id"],
        "user_id": row["user_id"],
        "bureau_id": row["bureau_id"],
        "full_name": row["full_name"],
        "official_email": row["official_email"],
        "designation": row.get("designation"),
        "membership_type": row["membership_type"],
        "membership_status": row["membership_status"],
        "is_primary": row["is_primary"],
        "joined_at": row.get("joined_at"),
        "ended_at": row.get("ended_at"),
    }


def user_summary(row: Mapping[str, Any], roles: list[Mapping[str, Any]]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "employee_code": row.get("employee_code"),
        "full_name": row["full_name"],
        "display_name": row.get("display_name"),
        "official_email": row["official_email"],
        "designation": row.get("designation"),
        "account_status": row["account_status"],
        "roles": [
            {
                "role_code": role["role_code"],
                "role_name": role["role_name"],
                "scope_type": role["scope_type"],
                "bureau_id": role.get("bureau_id"),
                "bureau_name": role.get("bureau_name"),
            }
            for role in roles
        ],
    }

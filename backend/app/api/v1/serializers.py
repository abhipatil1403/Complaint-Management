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

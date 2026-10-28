"""Bounded pagination helpers.

The API document allows a documented offset scheme for the initial MVP; the
cursor is an opaque string over a bounded integer offset.
"""

from __future__ import annotations

from typing import Any

from app.core.errors import ApiError

DEFAULT_LIMIT = 25
MAX_LIMIT = 100


def validate_limit(limit: int) -> int:
    if limit < 1 or limit > MAX_LIMIT:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            f"limit must be between 1 and {MAX_LIMIT}.",
            details=[{"field": "limit", "issue": f"Must be between 1 and {MAX_LIMIT}"}],
        )
    return limit


def decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        offset = int(cursor)
    except (TypeError, ValueError) as exc:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "The pagination cursor is not valid.",
            details=[{"field": "cursor", "issue": "Must be a cursor returned by this API"}],
        ) from exc
    if offset < 0:
        raise ApiError(422, "VALIDATION_ERROR", "The pagination cursor is not valid.")
    return offset


def page_response(
    rows: list[dict[str, Any]],
    *,
    limit: int,
    offset: int,
    request_id: str,
) -> dict[str, Any]:
    has_more = len(rows) > limit
    data = rows[:limit]
    next_cursor = str(offset + limit) if has_more else None
    return {
        "data": data,
        "page": {"limit": limit, "next_cursor": next_cursor},
        "request_id": request_id,
    }

"""Pagination contract tests (bounded limits, opaque offset cursor)."""

from __future__ import annotations

import pytest

from app.api.pagination import MAX_LIMIT, decode_cursor, page_response, validate_limit
from app.core.errors import ApiError


@pytest.mark.parametrize("limit", [1, 25, MAX_LIMIT])
def test_valid_limits_are_returned_unchanged(limit: int) -> None:
    assert validate_limit(limit) == limit


@pytest.mark.parametrize("limit", [0, -1, MAX_LIMIT + 1])
def test_out_of_range_limits_are_rejected(limit: int) -> None:
    with pytest.raises(ApiError) as excinfo:
        validate_limit(limit)
    assert excinfo.value.status_code == 422
    assert excinfo.value.code == "VALIDATION_ERROR"


@pytest.mark.parametrize("cursor,expected", [(None, 0), ("", 0), ("0", 0), ("25", 25)])
def test_valid_cursors_decode_to_offsets(cursor, expected: int) -> None:
    assert decode_cursor(cursor) == expected


@pytest.mark.parametrize("cursor", ["not-a-number", "-5", "1.5"])
def test_invalid_cursors_are_rejected(cursor: str) -> None:
    with pytest.raises(ApiError) as excinfo:
        decode_cursor(cursor)
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_full_page_reports_no_next_cursor() -> None:
    rows = [{"id": index} for index in range(25)]
    body = page_response(rows, limit=25, offset=0, request_id="req_1")
    assert len(body["data"]) == 25
    assert body["page"] == {"limit": 25, "next_cursor": None}
    assert body["request_id"] == "req_1"


def test_extra_row_marks_another_page_and_is_trimmed() -> None:
    rows = [{"id": index} for index in range(26)]
    body = page_response(rows, limit=25, offset=50, request_id="req_2")
    assert len(body["data"]) == 25
    assert body["page"]["next_cursor"] == "75"
    assert body["data"][-1]["id"] == 24


def test_empty_page_has_no_cursor() -> None:
    body = page_response([], limit=10, offset=0, request_id="req_3")
    assert body["data"] == []
    assert body["page"]["next_cursor"] is None

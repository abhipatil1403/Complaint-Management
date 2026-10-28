"""Phase 2.1 simulated intake service.

Responsibilities kept out of the endpoint:

* demo flags (both must be enabled),
* the in-memory per-IP rate limit,
* mapping the database function's outcome to an API response,
* consistent, content-free error messages.

The database function is the security boundary. This module only adds
convenience and denial-of-service limits; it can never widen access.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from collections import deque
from typing import Any, Callable, Mapping

from app.core.config import Settings
from app.core.errors import ApiError
from app.db.session import Database
from app.repositories import intake as repo
from app.schemas.intake import DemoSubmissionCreate

logger = logging.getLogger("aicte_onedesk.intake")

# The two simulated channels. The live tests assert that these match the seed.
DEMO_CHANNELS: tuple[dict[str, str], ...] = (
    {"code": "AICTE_SIM", "name": "Simulated AICTE portal", "channel_type": "portal", "portal": "aicte"},
    {
        "code": "CPGRAMS_SIM",
        "name": "Simulated CPGRAMS intake",
        "channel_type": "cpgrams",
        "portal": "cpgrams",
    },
)

SIMULATION_NOTICE_VERSION = "SIM-NOTICE-2026-10-29-v1"

SIMULATION_NOTICE_EN = (
    "Simulation notice — this is not a real complaint portal. This page is a demonstration of "
    "AICTE OneDesk. Do not submit a real grievance here. Anything you enter is stored only in this "
    "project's demo database. It is not sent to AICTE, to CPGRAMS or to any government office, no "
    "acknowledgement is issued, and no action will be taken on it. Do not enter personal data, "
    "confidential information, or the details of a real complaint."
)

SIMULATION_NOTICE_HI = (
    "सिमुलेशन सूचना — यह वास्तविक शिकायत पोर्टल नहीं है। यह पृष्ठ AICTE OneDesk का केवल प्रदर्शन है। "
    "कृपया यहाँ कोई वास्तविक शिकायत दर्ज न करें। आप जो भी लिखते हैं वह केवल इस परियोजना के डेमो "
    "डेटाबेस में संग्रहीत होता है। यह AICTE, CPGRAMS या किसी सरकारी कार्यालय को नहीं भेजा जाता, "
    "कोई पावती जारी नहीं होती और उस पर कोई कार्रवाई नहीं की जाएगी। कृपया व्यक्तिगत डेटा, गोपनीय "
    "जानकारी या किसी वास्तविक शिकायत का विवरण दर्ज न करें।"
)

# Database validation code -> (field, message). Messages never repeat content.
_VALIDATION_ERRORS: dict[str, tuple[str, str]] = {
    "CONSENT_REQUIRED": (
        "consent_acknowledged",
        "The simulation notice must be acknowledged before submitting.",
    ),
    "UNSUPPORTED_LANGUAGE": ("language", "Only English (en) and Hindi (hi) are supported."),
    "SUBJECT_REQUIRED": ("subject", "A complaint subject is required."),
    "SUBJECT_TOO_LONG": ("subject", "The subject must be 200 characters or fewer."),
    "SUBJECT_INVALID_CHARACTERS": ("subject", "The subject contains characters that are not allowed."),
    "TEXT_REQUIRED": ("description", "A complaint description is required."),
    "TEXT_TOO_LONG": ("description", "The description must be 20000 characters or fewer."),
    "TEXT_INVALID_CHARACTERS": (
        "description",
        "The description contains control characters that are not allowed.",
    ),
    "INSTITUTION_ID_TOO_LONG": (
        "institution_permanent_id",
        "The institution identifier must be 64 characters or fewer.",
    ),
    "INSTITUTION_NAME_TOO_LONG": (
        "institution_name_as_submitted",
        "The institution name must be 300 characters or fewer.",
    ),
    "INSTITUTION_IDENTIFIER_REQUIRED": (
        "institution",
        "Provide an institution permanent ID or an institution name.",
    ),
    "UNKNOWN_CATEGORY": ("category_code", "That complaint category is not available."),
    "SOURCE_EVENT_ID_TOO_LONG": (
        "source_event_id",
        "The source event reference must be 64 characters or fewer.",
    ),
    "IDEMPOTENCY_KEY_TOO_LONG": (
        "idempotency_key",
        "The Idempotency-Key header must be 128 characters or fewer.",
    ),
    "SOURCE_TIME_IN_FUTURE": (
        "source_submitted_at",
        "The submission time cannot be in the future.",
    ),
}


class SlidingWindowRateLimiter:
    """Small, process-local limiter.

    Deliberately not a durable control: the demo runs as a single API process.
    A multi-process deployment needs a shared store, which is out of Phase 2.1
    scope and documented as a limitation.
    """

    def __init__(
        self,
        limit: int,
        window_seconds: int,
        *,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = 2048,
    ) -> None:
        self._limit = max(1, limit)
        self._window = max(1, window_seconds)
        self._clock = clock
        self._max_keys = max_keys
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str) -> int:
        """Record one attempt. Returns 0 when allowed, else Retry-After seconds."""
        now = self._clock()
        cutoff = now - self._window
        with self._lock:
            bucket = self._events.get(key)
            if bucket is None:
                if len(self._events) >= self._max_keys:
                    self._prune(cutoff)
                bucket = deque()
                self._events[key] = bucket
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= self._limit:
                retry_after = bucket[0] + self._window - now
                return max(1, int(math.ceil(retry_after)))
            bucket.append(now)
            return 0

    def _prune(self, cutoff: float) -> None:
        stale = [key for key, bucket in self._events.items() if not bucket or bucket[-1] <= cutoff]
        for key in stale:
            self._events.pop(key, None)

    def reset(self) -> None:
        with self._lock:
            self._events.clear()


class DemoIntakeService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self.limiter = SlidingWindowRateLimiter(
            settings.demo_intake_rate_limit, settings.demo_intake_rate_window_seconds
        )

    @property
    def enabled(self) -> bool:
        return bool(self._settings.demo_mode and self._settings.demo_intake_enabled)

    def check_rate(self, client_ip: str, channel_code: str) -> None:
        retry_after = self.limiter.hit(f"{client_ip}|{channel_code.upper()}")
        if retry_after:
            raise ApiError(
                429,
                "RATE_LIMITED",
                "Too many simulated submissions from this client. Try again shortly.",
                headers={"Retry-After": str(retry_after)},
            )

    async def submit(
        self,
        database: Database,
        *,
        channel_code: str,
        payload: DemoSubmissionCreate,
        idempotency_key: str | None,
        client_ip: str,
        request_id: str = "req_unavailable",
    ) -> tuple[dict[str, Any], bool]:
        if not self.enabled:
            raise ApiError(
                404,
                "INTAKE_DISABLED",
                "The simulated intake portals are disabled.",
            )

        self.check_rate(client_ip, channel_code)

        async with database.session(role=self._settings.demo_intake_role) as conn:
            result = await repo.create_submission(
                conn,
                channel_code=channel_code,
                institution_permanent_id=payload.institution_permanent_id,
                institution_name_as_submitted=payload.institution_name_as_submitted,
                subject=payload.subject,
                description=payload.description,
                language=payload.language,
                category_code=payload.category_code,
                source_event_id=payload.source_event_id,
                idempotency_key=idempotency_key,
                source_submitted_at=payload.source_submitted_at,
            )

        return self._to_receipt(result, request_id=request_id)

    def _to_receipt(
        self, result: Mapping[str, Any], *, request_id: str
    ) -> tuple[dict[str, Any], bool]:
        outcome = result.get("outcome")

        if outcome in {"created", "replay"}:
            logger.info(
                "intake outcome=%s request_id=%s submission_id=%s status=%s channel=%s",
                outcome,
                request_id,
                result.get("submission_id"),
                result.get("intake_status"),
                result.get("channel_code"),
            )
            receipt = {
                "outcome": outcome,
                "replayed": outcome == "replay",
                "submission_id": result["submission_id"],
                "external_reference": result.get("external_reference"),
                "intake_status": result["intake_status"],
                "received_at": result["received_at"],
                "institution_resolved": bool(result.get("institution_resolved")),
                "channel": {
                    "code": result["channel_code"],
                    "name": result["channel_name"],
                    "is_simulated": bool(result.get("is_simulated")),
                },
                "demo_notice": SIMULATION_NOTICE_EN,
                "simulation_notice_version": SIMULATION_NOTICE_VERSION,
            }
            return receipt, outcome == "replay"

        if outcome == "conflict":
            code = result.get("code") or "IDEMPOTENCY_CONFLICT"
            logger.info(
                "intake conflict request_id=%s code=%s channel=%s", request_id, code, result.get("channel_code")
            )
            raise ApiError(
                409,
                "IDEMPOTENCY_CONFLICT",
                "This Idempotency-Key or source event was already used with different content.",
                details=[{"field": "idempotency_key", "issue": code}],
            )

        if outcome == "channel_unavailable":
            raise ApiError(
                404,
                "INTAKE_CHANNEL_UNAVAILABLE",
                "The simulated intake channel is not available.",
            )

        if outcome == "validation_error":
            code = result.get("code") or "VALIDATION_ERROR"
            field, message = _VALIDATION_ERRORS.get(
                code, ("request", "The submission did not pass validation.")
            )
            raise ApiError(
                422,
                "VALIDATION_ERROR",
                message,
                details=[{"field": field, "issue": message}],
            )

        # Unknown outcome must fail closed; it is a server defect, not a client error.
        logger.error("intake unknown outcome request_id=%s", request_id)
        raise ApiError(503, "INTAKE_UNAVAILABLE", "The simulated intake service is unavailable.")

"""FastAPI dependencies for authentication and authorization."""

from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncIterator, Callable
from uuid import UUID

from fastapi import Depends, Request
from psycopg import AsyncConnection

from app.auth.principal import Principal
from app.auth.service import IdentityError, IdentityService
from app.core.config import Settings
from app.core.errors import ApiError
from app.core.security import TokenVerifier, TokenVerificationError
from app.db.session import Database

ACTIVE_BUREAU_HEADER = "X-Active-Bureau"


@dataclass
class RequestContext:
    principal: Principal
    active_bureau_id: UUID | None
    conn: AsyncConnection
    request_id: str

    def require_permission(self, api_code: str) -> None:
        if not self.principal.has_permission(api_code, self.active_bureau_id):
            raise ApiError(
                403,
                "FORBIDDEN",
                f"The '{api_code}' capability is required for this operation.",
            )


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _verifier(request: Request) -> TokenVerifier:
    return request.app.state.token_verifier


def _database(request: Request) -> Database:
    return request.app.state.db


def _identity_service(request: Request) -> IdentityService:
    return request.app.state.identity_service


def _bearer_token(request: Request) -> str:
    header = request.headers.get("authorization") or request.headers.get("Authorization")
    if not header:
        raise ApiError(401, "MISSING_TOKEN", "An Authorization: Bearer <access_token> header is required.")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise ApiError(401, "MISSING_TOKEN", "A Bearer access token is required.")
    return token.strip()


def _active_bureau_id(request: Request) -> UUID | None:
    raw = request.headers.get(ACTIVE_BUREAU_HEADER)
    if not raw:
        return None
    try:
        return UUID(raw.strip())
    except ValueError as exc:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "The active bureau context is not a valid identifier.",
            details=[{"field": ACTIVE_BUREAU_HEADER, "issue": "Must be a UUID"}],
        ) from exc


async def get_request_context(request: Request) -> AsyncIterator[RequestContext]:
    token = _bearer_token(request)
    try:
        claims = _verifier(request).verify(token)
    except TokenVerificationError as exc:
        raise ApiError(401, exc.code, exc.message) from exc

    try:
        user_id = UUID(claims.subject)
    except ValueError as exc:
        raise ApiError(401, "INVALID_TOKEN", "The access token subject is not a valid user identifier.") from exc

    active_bureau_id = _active_bureau_id(request)
    database = _database(request)
    identity_service = _identity_service(request)

    # Publish the validated bureau context so PostgreSQL policies apply the same
    # scoping decision as the API (bureau-scoped grants cannot leak elsewhere).
    db_claims = dict(claims.as_db_claims())
    if active_bureau_id is not None:
        db_claims["active_bureau_id"] = str(active_bureau_id)

    async with database.session(db_claims) as conn:
        try:
            principal = await identity_service.load(conn, user_id)
        except IdentityError as exc:
            raise ApiError(403, exc.code, exc.message) from exc

        if active_bureau_id is not None and not principal.is_member(active_bureau_id):
            raise ApiError(
                403,
                "BUREAU_CONTEXT_DENIED",
                "The selected bureau context is not an active membership of the caller.",
            )

        yield RequestContext(
            principal=principal,
            active_bureau_id=active_bureau_id,
            conn=conn,
            request_id=getattr(request.state, "request_id", "req_unavailable"),
        )


def require_permission(api_code: str) -> Callable[..., RequestContext]:
    """Dependency factory: authenticate, then require one capability.

    Capabilities granted by a bureau-scoped role only apply when that bureau is
    the caller's active context, so switching bureaus never merges permissions.
    """

    async def dependency(
        ctx: RequestContext = Depends(get_request_context),
    ) -> RequestContext:
        ctx.require_permission(api_code)
        return ctx

    return dependency


def require_global_permission(api_code: str) -> Callable[..., RequestContext]:
    """Require a capability granted by a *global* role assignment.

    Identity administration (users, role grants) is an organisation-wide
    capability. A bureau-scoped grant must never be enough to enumerate or
    modify every authorized user, whatever the active bureau context is.
    """

    async def dependency(
        ctx: RequestContext = Depends(get_request_context),
    ) -> RequestContext:
        if api_code not in ctx.principal.global_permissions:
            raise ApiError(
                403,
                "GLOBAL_CAPABILITY_REQUIRED",
                f"The '{api_code}' capability must be granted globally for this operation.",
            )
        return ctx

    return dependency


def require_any_permission(*api_codes: str) -> Callable[..., RequestContext]:
    async def dependency(
        ctx: RequestContext = Depends(get_request_context),
    ) -> RequestContext:
        if not any(ctx.principal.has_permission(code, ctx.active_bureau_id) for code in api_codes):
            raise ApiError(
                403,
                "FORBIDDEN",
                "None of the capabilities required for this operation are granted.",
            )
        return ctx

    return dependency

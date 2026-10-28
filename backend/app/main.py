"""FastAPI application factory.

Security posture:
* Supabase Auth tokens are verified (signature, issuer, audience, expiry).
* Every authenticated request runs under PostgreSQL RLS as ``authenticated``.
* Service-role credentials and database URLs stay on the server.
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from psycopg import errors as pg_errors

from app.api.v1.router import api_router
from app.auth.service import IdentityService
from app.core.config import Settings, get_settings
from app.core.errors import ApiError, error_response
from app.core.security import TokenVerifier
from app.db.session import Database, DatabaseNotConfigured
from app.services.intake import DemoIntakeService

import sys
if sys.platform == "win32":
    import asyncio
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("aicte_onedesk.app")


def _request_id_from(request: Request) -> str:
    supplied = request.headers.get("X-Request-ID")
    if supplied:
        candidate = supplied.strip()[:64]
        if candidate and all(char.isalnum() or char in "-_." for char in candidate):
            return candidate
    return f"req_{uuid.uuid4().hex[:16]}"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        database: Database = app.state.db
        try:
            await database.open()
            logger.info("database pool opened")
        except DatabaseNotConfigured as exc:
            # The API still starts so health/readiness can report the problem
            # instead of crash-looping; authenticated routes return 503.
            logger.warning("database not configured: %s", exc)
        except Exception as exc:  # pragma: no cover - depends on external service
            logger.error("database pool could not be opened: %s", type(exc).__name__)
        try:
            yield
        finally:
            await database.close()

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description=(
            "AICTE OneDesk - Phase 2.2 adds the human institution-verification "
            "queue on top of the Phase 2.1 simulated intake. Nothing entered here "
            "is sent to AICTE, CPGRAMS or any government office, and the demo "
            "portals are not real complaint channels."
        ),
        docs_url="/docs" if settings.app_env != "production" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.app_env != "production" else None,
        lifespan=lifespan,
    )

    app.state.settings = settings
    app.state.db = Database(
        settings.database_url if settings.database_url else None,
        min_size=settings.db_pool_min_size,
        max_size=settings.db_pool_max_size,
        rls_role=settings.db_rls_role,
    )
    app.state.token_verifier = TokenVerifier(settings)
    app.state.identity_service = IdentityService()
    app.state.intake_service = DemoIntakeService(settings)

    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_credentials=False,
            allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
            allow_headers=[
                "Authorization",
                "Content-Type",
                "X-Request-ID",
                "X-Active-Bureau",
                "Idempotency-Key",
            ],
            expose_headers=["X-Request-ID", "Retry-After"],
        )

    @app.middleware("http")
    async def request_context_middleware(request: Request, call_next):
        request.state.request_id = _request_id_from(request)
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    # -- error handling --------------------------------------------------
    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_response(
            request,
            exc.status_code,
            exc.code,
            exc.message,
            exc.details,
            headers=exc.headers or None,
        )

    @app.exception_handler(DatabaseNotConfigured)
    async def handle_db_missing(request: Request, exc: DatabaseNotConfigured) -> JSONResponse:
        logger.error("database unavailable: %s", exc)
        return error_response(
            request,
            503,
            "DATABASE_UNAVAILABLE",
            "The service database is not available.",
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        details = []
        for error in exc.errors():
            location = [str(item) for item in error.get("loc", []) if item not in ("body", "query", "header")]
            details.append(
                {
                    "field": ".".join(location) or "request",
                    "issue": error.get("msg", "Invalid value"),
                }
            )
        return error_response(
            request, 422, "VALIDATION_ERROR", "One or more fields are invalid.", details
        )

    @app.exception_handler(pg_errors.UniqueViolation)
    async def handle_unique(request: Request, exc: pg_errors.UniqueViolation) -> JSONResponse:
        logger.info("unique constraint rejected a request: %s", exc.diag.constraint_name)
        return error_response(
            request,
            409,
            "CONFLICT",
            "The request conflicts with an existing record.",
        )

    @app.exception_handler(pg_errors.ForeignKeyViolation)
    async def handle_fk(request: Request, exc: pg_errors.ForeignKeyViolation) -> JSONResponse:
        return error_response(
            request, 422, "REFERENCE_ERROR", "A referenced record does not exist."
        )

    @app.exception_handler(pg_errors.CheckViolation)
    async def handle_check(request: Request, exc: pg_errors.CheckViolation) -> JSONResponse:
        logger.info("check constraint rejected a request: %s", exc.diag.constraint_name)
        return error_response(
            request,
            422,
            "VALIDATION_ERROR",
            "A data validation rule rejected the request.",
            details=[{"field": exc.diag.constraint_name or "constraint", "issue": "Not satisfied"}],
        )

    @app.exception_handler(pg_errors.RaiseException)
    async def handle_rule(request: Request, exc: pg_errors.RaiseException) -> JSONResponse:
        return error_response(
            request,
            422,
            "RULE_VIOLATION",
            exc.diag.message_primary or "A business rule rejected the request.",
        )

    @app.exception_handler(pg_errors.InsufficientPrivilege)
    async def handle_privilege(
        request: Request, exc: pg_errors.InsufficientPrivilege
    ) -> JSONResponse:
        logger.warning("database privilege denial: %s", type(exc).__name__)
        return error_response(
            request, 403, "DB_PERMISSION_DENIED", "The database policy denied this operation."
        )

    @app.exception_handler(pg_errors.Error)
    async def handle_db_error(request: Request, exc: pg_errors.Error) -> JSONResponse:
        logger.error("database error: %s", type(exc).__name__)
        return error_response(
            request, 500, "DATABASE_ERROR", "The request could not be completed."
        )

    app.include_router(api_router, prefix=settings.api_v1_prefix)

    # -- OpenAPI bearer scheme -------------------------------------------
    def custom_openapi() -> dict:
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(
            title=app.title,
            version=app.version,
            description=app.description,
            routes=app.routes,
        )
        schema.setdefault("components", {}).setdefault("securitySchemes", {})["bearerAuth"] = {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "Supabase Auth access token.",
        }
        public_paths = {
            "/api/v1/health/live",
            "/api/v1/health/ready",
            "/api/v1/demo/info",
            "/api/v1/demo/intake/{channel_code}/submissions",
        }
        for path, operations in schema.get("paths", {}).items():
            if path in public_paths:
                continue
            for operation in operations.values():
                if isinstance(operation, dict):
                    operation.setdefault("security", [{"bearerAuth": []}])
        app.openapi_schema = schema
        return schema

    app.openapi = custom_openapi  # type: ignore[method-assign]
    return app


app = create_app()

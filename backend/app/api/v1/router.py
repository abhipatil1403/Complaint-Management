"""Versioned API router."""

from fastapi import APIRouter

from app.api.v1 import (
    admin,
    bureaus,
    cases,
    duplicate_review,
    institutions,
    intake,
    me,
    regions,
    system,
    verification,
)

api_router = APIRouter()
api_router.include_router(system.router)
api_router.include_router(intake.router)
api_router.include_router(verification.router)
api_router.include_router(duplicate_review.router)
api_router.include_router(cases.router)
api_router.include_router(cases.operations_router)
api_router.include_router(me.router)
api_router.include_router(regions.router)
api_router.include_router(institutions.router)
api_router.include_router(bureaus.router)
api_router.include_router(admin.router)


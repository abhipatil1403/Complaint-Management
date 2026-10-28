"""Versioned API router."""

from fastapi import APIRouter

from app.api.v1 import admin, bureaus, institutions, intake, me, regions, system

api_router = APIRouter()
api_router.include_router(system.router)
api_router.include_router(intake.router)
api_router.include_router(me.router)
api_router.include_router(regions.router)
api_router.include_router(institutions.router)
api_router.include_router(bureaus.router)
api_router.include_router(admin.router)

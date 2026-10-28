"""Unauthenticated-safe system endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.schemas.identity import DemoChannelInfo, DemoInfo
from app.services.intake import (
    DEMO_CHANNELS,
    SIMULATION_NOTICE_EN,
    SIMULATION_NOTICE_HI,
    SIMULATION_NOTICE_VERSION,
)

logger = logging.getLogger("aicte_onedesk.system")
router = APIRouter(tags=["system"])


@router.get("/health/live", summary="Process liveness")
async def health_live() -> dict:
    return {"status": "ok"}


@router.get("/health/ready", summary="Readiness and dependency status")
async def health_ready(request: Request) -> JSONResponse:
    database = request.app.state.db
    ready = await database.ready()
    payload = {
        "status": "ready" if ready else "degraded",
        "checks": {"database": "ok" if ready else "unavailable"},
    }
    return JSONResponse(status_code=200 if ready else 503, content=payload)


@router.get("/demo/info", response_model=DemoInfo, summary="Demo-mode notice and feature flags")
async def demo_info(request: Request) -> DemoInfo:
    settings = request.app.state.settings
    intake_enabled = bool(settings.demo_mode and settings.demo_intake_enabled)
    return DemoInfo(
        demo_mode=settings.demo_mode,
        notice=settings.demo_banner_text,
        demo_intake_enabled=intake_enabled,
        channels=[DemoChannelInfo(**channel) for channel in DEMO_CHANNELS] if intake_enabled else [],
        simulation_notice_version=SIMULATION_NOTICE_VERSION,
        simulation_notice_en=SIMULATION_NOTICE_EN,
        simulation_notice_hi=SIMULATION_NOTICE_HI,
    )

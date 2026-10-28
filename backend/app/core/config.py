"""Application configuration.

All secrets are read from the environment. The browser bundle is never given a
service-role key, database URL or JWT secret; only the Vite anon key is public.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "AICTE OneDesk API"
    app_env: str = "local"
    api_v1_prefix: str = "/api/v1"
    demo_mode: bool = True
    demo_banner_text: str = "Illustrative Demo Data - simulated environment"

    # --- Supabase Auth token verification -------------------------------
    supabase_url: str | None = None
    supabase_jwt_secret: str | None = None
    supabase_jwks_url: str | None = None
    supabase_jwt_audience: str = "authenticated"
    supabase_jwt_issuer: str | None = None
    supabase_jwt_algorithms: str = "RS256,ES256,HS256"
    supabase_allowed_token_roles: str = "authenticated"

    # --- Database -------------------------------------------------------
    # Server-side only. Never exposed to the frontend.
    database_url: str | None = None
    db_pool_min_size: int = 1
    db_pool_max_size: int = 5
    db_connect_timeout: int = 10
    # Session role used for every authenticated request so PostgreSQL RLS is
    # applied to the caller rather than bypassed by a table-owner connection.
    db_rls_role: str = "authenticated"

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    request_id_header: str = "X-Request-ID"

    @field_validator("supabase_url", mode="after")
    @classmethod
    def _strip_trailing_slash(cls, value: str | None) -> str | None:
        return value.rstrip("/") if value else value

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def jwks_url(self) -> str | None:
        if self.supabase_jwks_url:
            return self.supabase_jwks_url
        if self.supabase_url:
            return f"{self.supabase_url}/auth/v1/.well-known/jwks.json"
        return None

    @property
    def issuer(self) -> str | None:
        if self.supabase_jwt_issuer:
            return self.supabase_jwt_issuer
        if self.supabase_url:
            return f"{self.supabase_url}/auth/v1"
        return None

    @property
    def algorithm_list(self) -> list[str]:
        return [item.strip().upper() for item in self.supabase_jwt_algorithms.split(",") if item.strip()]

    @property
    def allowed_token_roles(self) -> set[str]:
        return {item.strip() for item in self.supabase_allowed_token_roles.split(",") if item.strip()}

    def require_database(self) -> str:
        if not self.database_url:
            raise RuntimeError(
                "DATABASE_URL is not configured. The API needs a server-side database "
                "connection; it is never supplied to the browser."
            )
        return self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()

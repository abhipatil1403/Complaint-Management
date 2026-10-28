"""Database access with PostgreSQL RLS applied to the calling user.

Every authenticated request runs inside a transaction that:

1. publishes the verified JWT claims as ``request.jwt.claims`` (used by the
   ``public.auth_uid()`` / ``public.has_permission()`` helper functions), and
2. switches to the non-privileged ``authenticated`` role so row level security
   is enforced by PostgreSQL as well as by FastAPI.

A table-owner or service-role connection must never be used to serve a request
on behalf of a browser user.
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Mapping

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

_SWITCHABLE_ROLES = {"authenticated", "anon", "one_desk_intake"}


class DatabaseNotConfigured(RuntimeError):
    pass


class Database:
    def __init__(
        self,
        dsn: str | None,
        *,
        min_size: int = 1,
        max_size: int = 5,
        rls_role: str = "authenticated",
        statement_timeout_ms: int = 15000,
    ) -> None:
        self._dsn = dsn
        self._min_size = min_size
        self._max_size = max_size
        self._rls_role = rls_role
        self._statement_timeout_ms = statement_timeout_ms
        self._pool: AsyncConnectionPool | None = None

    # -- lifecycle -------------------------------------------------------
    async def open(self) -> None:
        if not self._dsn:
            raise DatabaseNotConfigured(
                "DATABASE_URL is not configured; the API cannot start without a server-side database connection."
            )
        if self._rls_role not in _SWITCHABLE_ROLES:
            raise DatabaseNotConfigured(
                f"DB_RLS_ROLE must be one of {sorted(_SWITCHABLE_ROLES)}; got {self._rls_role!r}."
            )
        self._pool = AsyncConnectionPool(
            conninfo=self._dsn,
            min_size=self._min_size,
            max_size=self._max_size,
            open=False,
            kwargs={
                "row_factory": dict_row,
                "options": f"-c statement_timeout={self._statement_timeout_ms}",
                "application_name": "aicte-onedesk-api",
            },
        )
        await self._pool.open(wait=True, timeout=20)

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    @property
    def configured(self) -> bool:
        return bool(self._dsn)

    @property
    def connected(self) -> bool:
        return self._pool is not None

    def _require_pool(self) -> AsyncConnectionPool:
        if self._pool is None:
            raise DatabaseNotConfigured("The database pool is not open.")
        return self._pool

    # -- sessions --------------------------------------------------------
    @asynccontextmanager
    async def session(
        self,
        claims: Mapping[str, Any] | None = None,
        *,
        role: str | None = None,
    ) -> AsyncIterator[AsyncConnection]:
        """Yield a connection scoped to one transaction.

        ``claims`` must only contain data taken from a verified access token.

        ``role`` switches to an explicit allowlisted role instead of the
        default RLS role. The public intake path uses it to become
        ``one_desk_intake``: that role holds EXECUTE on one insert-only
        function and no table privilege at all. The owner role is never used to
        serve a request.
        """
        pool = self._require_pool()
        if role is not None and role not in _SWITCHABLE_ROLES:
            raise DatabaseNotConfigured(
                f"Refusing to switch to role {role!r}; allowed: {sorted(_SWITCHABLE_ROLES)}."
            )
        async with pool.connection() as conn:
            async with conn.transaction():
                if claims is not None:
                    await self._apply_caller_context(conn, claims)
                if role is not None:
                    # Role name comes from the allowlist above, never from
                    # request data.
                    await conn.execute(f"set local role {role}")
                yield conn

    async def _apply_caller_context(
        self, conn: AsyncConnection, claims: Mapping[str, Any]
    ) -> None:
        payload = json.dumps(dict(claims), separators=(",", ":"))
        await conn.execute(
            "select set_config('request.jwt.claims', %s, true)", (payload,)
        )
        # Role name comes from an allowlist, never from request data.
        await conn.execute(f"set local role {self._rls_role}")

    async def ready(self) -> bool:
        if self._pool is None:
            return False
        try:
            async with self._pool.connection() as conn:
                await conn.execute("select 1")
            return True
        except Exception:  # pragma: no cover - depends on external service
            return False

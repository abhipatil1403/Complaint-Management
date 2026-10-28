"""Provision illustrative demo identities for AICTE OneDesk Phase 1.

Creates Supabase Auth users (the only authentication system) and links them to
public.users, bureau memberships and role grants. Idempotent: re-running
updates the demo profiles instead of duplicating them.

Required environment (never commit these values):

    SUPABASE_URL                 e.g. https://<project-ref>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY    server-side only; used for the Auth admin API
    DATABASE_URL                 server-side PostgreSQL connection string
    DEMO_PASSWORD                shared password for the demo accounts (>= 12 chars)
    ALLOW_DEMO_SEED=true         explicit opt-in so this cannot run by accident

Optional:

    DEMO_PREFIX                  email local-part prefix (default "demo.")

Usage (from the repository root, with backend dependencies installed):

    python scripts/seed_demo_users.py
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass

import httpx
import psycopg


@dataclass(frozen=True)
class Persona:
    local_part: str
    full_name: str
    employee_code: str
    designation: str
    role_code: str | None
    bureau_code: str | None
    membership_type: str = "member"
    account_status: str = "active"


PERSONAS: tuple[Persona, ...] = (
    Persona("super.admin", "Demo Super Admin", "DEMO-0001", "System administrator", "SUPER_ADMIN", None),
    Persona("rb.admin", "Demo RB Administrator", "DEMO-0002", "Bureau administrator", "BUREAU_ADMIN", "RB"),
    Persona("pgrc.officer", "Demo PGRC Officer", "DEMO-0003", "Case officer", "CASE_OFFICER", "PGRC"),
    Persona(
        "collaborator",
        "Demo Cross-bureau Collaborator",
        "DEMO-0004",
        "Coordinator",
        "CROSS_BUREAU_COLLABORATOR",
        "RB",
    ),
    Persona("senior", "Demo Senior Management", "DEMO-0005", "Director", "SENIOR_MANAGEMENT", None),
    Persona("auditor", "Demo Auditor", "DEMO-0006", "Auditor", "AUDITOR", None),
    # Deliberately inactive: proves that a valid sign-in without an active
    # profile is still refused by the API.
    Persona(
        "inactive",
        "Demo Inactive Account",
        "DEMO-0007",
        "Former staff",
        None,
        None,
        account_status="inactive",
    ),
)


class SeedError(RuntimeError):
    pass


def _required_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise SeedError(f"{name} is required.")
    return value


def _persona_email(persona: Persona, prefix: str) -> str:
    return f"{prefix}{persona.local_part}@demo.invalid"


def _find_auth_user(client: httpx.Client, email: str) -> dict | None:
    for page in range(1, 21):
        response = client.get("/auth/v1/admin/users", params={"page": page, "per_page": 200})
        if response.status_code != 200:
            raise SeedError(
                f"Auth admin API refused the user listing (HTTP {response.status_code})."
            )
        payload = response.json()
        users = payload.get("users") if isinstance(payload, dict) else payload
        users = users or []
        for user in users:
            if (user.get("email") or "").lower() == email.lower():
                return user
        if len(users) < 200:
            return None
    return None


def _ensure_auth_user(client: httpx.Client, email: str, password: str, full_name: str) -> str:
    existing = _find_auth_user(client, email)
    if existing is not None:
        return str(existing["id"])

    response = client.post(
        "/auth/v1/admin/users",
        json={
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"full_name": full_name, "demo": True},
        },
    )
    if response.status_code not in (200, 201):
        raise SeedError(
            f"Could not create Auth user {email} (HTTP {response.status_code}): "
            f"{response.text[:300]}"
        )
    payload = response.json()
    user = payload.get("user", payload)
    if not user.get("id"):
        raise SeedError(f"Auth API did not return an id for {email}.")
    return str(user["id"])


def _upsert_profile(conn: psycopg.Connection, user_id: str, persona: Persona, email: str) -> None:
    conn.execute(
        """
        insert into public.users (
            id, employee_code, full_name, official_email, designation, account_status
        ) values (%s, %s, %s, %s, %s, %s)
        on conflict (id) do update
            set employee_code = excluded.employee_code,
                full_name     = excluded.full_name,
                official_email = excluded.official_email,
                designation   = excluded.designation,
                account_status = excluded.account_status,
                updated_at    = now()
        """,
        (
            user_id,
            persona.employee_code,
            persona.full_name,
            email,
            persona.designation,
            persona.account_status,
        ),
    )


def _upsert_membership(conn: psycopg.Connection, user_id: str, persona: Persona) -> None:
    if persona.bureau_code is None:
        return
    cursor = conn.execute(
        """
        insert into public.bureau_memberships (
            user_id, bureau_id, membership_type, membership_status, is_primary
        )
        select %s, b.id, %s, 'active', true
          from public.bureaus b
         where b.code = %s
        on conflict (user_id, bureau_id) where membership_status = 'active'
        do update
            set membership_type = excluded.membership_type,
                is_primary      = true,
                updated_at      = now()
        returning id
        """,
        (user_id, persona.membership_type, persona.bureau_code),
    )
    if cursor.fetchone() is None:
        raise SeedError(
            f"Bureau {persona.bureau_code!r} not found; run supabase/seed/phase1_identity_seed.sql first."
        )


def _upsert_role_grant(
    conn: psycopg.Connection, user_id: str, persona: Persona, granted_by: str | None
) -> None:
    if persona.role_code is None:
        return

    role = conn.execute(
        "select id, scope_type from public.roles where code = %s and is_active",
        (persona.role_code,),
    ).fetchone()
    if role is None:
        raise SeedError(
            f"Role {persona.role_code!r} not found; run supabase/seed/phase1_identity_seed.sql first."
        )
    role_id, scope_type = role

    bureau_id: str | None = None
    if scope_type == "bureau":
        if persona.bureau_code is None:
            raise SeedError(f"{persona.role_code} requires a bureau membership.")
        bureau = conn.execute(
            "select id from public.bureaus where code = %s and is_active",
            (persona.bureau_code,),
        ).fetchone()
        if bureau is None:
            raise SeedError(f"Bureau {persona.bureau_code!r} is not active.")
        bureau_id = str(bureau[0])

    existing = conn.execute(
        """
        select 1
          from public.user_role_assignments
         where user_id = %s
           and role_id = %s
           and bureau_id is not distinct from %s
           and assignment_status = 'active'
        """,
        (user_id, role_id, bureau_id),
    ).fetchone()
    if existing is not None:
        return

    conn.execute(
        """
        insert into public.user_role_assignments (
            user_id, role_id, bureau_id, assignment_status, assigned_by_user_id
        ) values (%s, %s, %s, 'active', %s)
        """,
        (user_id, role_id, bureau_id, granted_by),
    )


def main() -> int:
    if (os.getenv("ALLOW_DEMO_SEED") or "").lower() not in {"1", "true", "yes"}:
        print("Refusing to run: set ALLOW_DEMO_SEED=true to acknowledge this is demo data.", file=sys.stderr)
        return 2

    try:
        supabase_url = _required_env("SUPABASE_URL").rstrip("/")
        service_key = _required_env("SUPABASE_SERVICE_ROLE_KEY")
        database_url = _required_env("DATABASE_URL")
        password = _required_env("DEMO_PASSWORD")
        if len(password) < 12:
            raise SeedError("DEMO_PASSWORD must be at least 12 characters.")
    except SeedError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2

    prefix = (os.getenv("DEMO_PREFIX") or "demo.").strip()
    emails = {persona.local_part: _persona_email(persona, prefix) for persona in PERSONAS}

    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    created: dict[str, str] = {}
    with httpx.Client(base_url=supabase_url, headers=headers, timeout=30.0) as client:
        for persona in PERSONAS:
            email = emails[persona.local_part]
            try:
                created[persona.local_part] = _ensure_auth_user(
                    client, email, password, persona.full_name
                )
            except (SeedError, httpx.HTTPError) as exc:
                print(f"Auth provisioning failed for {email}: {exc}", file=sys.stderr)
                return 1

    try:
        with psycopg.connect(database_url) as conn:
            with conn.transaction():
                for persona in PERSONAS:
                    user_id = created[persona.local_part]
                    _upsert_profile(conn, user_id, persona, emails[persona.local_part])

                granted_by = created["super.admin"]
                for persona in PERSONAS:
                    user_id = created[persona.local_part]
                    _upsert_membership(conn, user_id, persona)
                    _upsert_role_grant(conn, user_id, persona, granted_by)

                for persona in PERSONAS:
                    if persona.role_code is None:
                        continue
                    row = conn.execute(
                        """
                        select u.account_status,
                               r.code as role_code,
                               b.code as bureau_code,
                               bm.membership_status
                          from public.users u
                          join public.user_role_assignments ura
                            on ura.user_id = u.id and ura.assignment_status = 'active'
                          join public.roles r on r.id = ura.role_id
                          left join public.bureaus b on b.id = ura.bureau_id
                          left join public.bureau_memberships bm
                            on bm.user_id = u.id
                           and bm.bureau_id = ura.bureau_id
                           and bm.membership_status = 'active'
                         where u.id = %s and r.code = %s
                        """,
                        (created[persona.local_part], persona.role_code),
                    ).fetchone()
                    if row is None:
                        raise SeedError(
                            f"{emails[persona.local_part]} did not receive role {persona.role_code}."
                        )
                    if persona.bureau_code is not None and row[3] != "active":
                        raise SeedError(
                            f"{emails[persona.local_part]} has no active membership in "
                            f"{persona.bureau_code}."
                        )
    except (SeedError, psycopg.Error) as exc:
        print(f"Database provisioning failed: {exc}", file=sys.stderr)
        return 1

    print("Demo identities are ready (passwords are never printed).")
    print(f"  Supabase project: {supabase_url}")
    print(f"  Email pattern:    {prefix}<persona>@demo.invalid")
    print("  Personas:")
    for persona in PERSONAS:
        scope = persona.bureau_code or "global"
        role = persona.role_code or "no role"
        print(
            f"    {emails[persona.local_part]:32} {role:26} {scope:6} {persona.account_status}"
        )
    print("  Sign in through the frontend; the API reads the role grants above.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

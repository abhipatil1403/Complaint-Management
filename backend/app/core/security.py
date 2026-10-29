"""Supabase Auth access-token verification.

The FastAPI service validates the JWT signature, issuer, audience and expiry.
It never merely decodes the token, and it never stores passwords.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

import jwt
from jwt import PyJWKClient

from app.core.config import Settings


class TokenVerificationError(Exception):
    """Raised when an access token cannot be trusted."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class TokenClaims:
    subject: str
    email: str | None
    role: str | None
    claims: Mapping[str, Any]

    def as_db_claims(self) -> dict[str, Any]:
        """Claims passed to PostgreSQL for RLS evaluation."""
        return dict(self.claims)


class TokenVerifier:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._jwks_client: PyJWKClient | None = None
        self._algorithms = settings.algorithm_list

    # -- internals -------------------------------------------------------
    def _signing_key(self, token: str) -> Any:
        jwks_url = self._settings.jwks_url
        if jwks_url and any(algo != "HS256" for algo in self._algorithms):
            if self._jwks_client is None:
                self._jwks_client = PyJWKClient(jwks_url, cache_keys=True, lifespan=300)
            try:
                signing_key = self._jwks_client.get_signing_key_from_jwt(token)
            except jwt.PyJWKClientError as exc:  # pragma: no cover - network dependent
                raise TokenVerificationError(
                    "TOKEN_VERIFICATION_UNAVAILABLE",
                    "The authentication key could not be loaded.",
                ) from exc
            return signing_key.key

        secret = self._settings.supabase_jwt_secret
        if not secret:
            raise TokenVerificationError(
                "TOKEN_VERIFICATION_UNAVAILABLE",
                "Token verification is not configured on the server.",
            )
        return secret

    # -- public ----------------------------------------------------------
    def verify(self, token: str) -> TokenClaims:
        if not token or token.count(".") != 2:
            raise TokenVerificationError("INVALID_TOKEN", "A valid access token is required.")

        algorithms = list(self._algorithms)
        if self._settings.supabase_jwt_secret and algorithms == ["HS256"]:
            key = self._settings.supabase_jwt_secret
        else:
            key = self._signing_key(token)

        try:
            payload = jwt.decode(
                token,
                key,
                algorithms=algorithms,
                audience=self._settings.supabase_jwt_audience or None,
                issuer=self._settings.issuer,
                options={
                    "require": ["exp", "sub"],
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_aud": bool(self._settings.supabase_jwt_audience),
                    "verify_iat": False,
                },
            )
        except jwt.ExpiredSignatureError as exc:
            raise TokenVerificationError("TOKEN_EXPIRED", "The access token has expired.") from exc
        except jwt.InvalidAudienceError as exc:
            raise TokenVerificationError("INVALID_TOKEN", "The access token audience is not accepted.") from exc
        except jwt.InvalidIssuerError as exc:
            raise TokenVerificationError("INVALID_TOKEN", "The access token issuer is not accepted.") from exc
        except jwt.InvalidSignatureError as exc:
            raise TokenVerificationError("INVALID_TOKEN", "The access token signature is invalid.") from exc
        except jwt.DecodeError as exc:
            raise TokenVerificationError("INVALID_TOKEN", "The access token could not be decoded.") from exc
        except jwt.PyJWTError as exc:
            raise TokenVerificationError("INVALID_TOKEN", "The access token is not valid.") from exc

        subject = payload.get("sub")
        if not isinstance(subject, str) or not subject:
            raise TokenVerificationError("INVALID_TOKEN", "The access token has no subject.")

        role = payload.get("role")
        allowed_roles = self._settings.allowed_token_roles
        if allowed_roles and role not in allowed_roles:
            # service_role and anon tokens must never be accepted as a person.
            raise TokenVerificationError("INVALID_TOKEN", "The access token role is not accepted.")

        email = payload.get("email")
        return TokenClaims(
            subject=subject,
            email=email if isinstance(email, str) else None,
            role=role if isinstance(role, str) else None,
            claims=payload,
        )

"""Access-token verification tests (SEC-001, API section 2)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.core.config import Settings
from app.core.security import TokenVerifier, TokenVerificationError

SECRET = "unit-test-secret"


def _settings(**overrides) -> Settings:
    base = {
        "app_env": "test",
        "supabase_jwt_secret": SECRET,
        "supabase_jwt_audience": "authenticated",
        "supabase_url": None,
        "supabase_jwks_url": None,
        "supabase_allowed_token_roles": "authenticated",
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)


def _token(payload: dict, *, secret: str = SECRET) -> str:
    return jwt.encode(payload, secret, algorithm="HS256")


def _payload(**overrides) -> dict:
    payload = {
        "sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "aud": "authenticated",
        "role": "authenticated",
        "email": "demo@demo.invalid",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
    }
    payload.update(overrides)
    return payload


def test_valid_token_is_accepted() -> None:
    verifier = TokenVerifier(_settings())
    claims = verifier.verify(_token(_payload()))
    assert claims.subject == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    assert claims.role == "authenticated"
    assert claims.email == "demo@demo.invalid"


def test_expired_token_is_rejected() -> None:
    verifier = TokenVerifier(_settings())
    expired = _token(_payload(exp=datetime.now(timezone.utc) - timedelta(seconds=5)))
    with pytest.raises(TokenVerificationError) as excinfo:
        verifier.verify(expired)
    assert excinfo.value.code == "TOKEN_EXPIRED"


def test_wrong_audience_is_rejected() -> None:
    verifier = TokenVerifier(_settings())
    with pytest.raises(TokenVerificationError) as excinfo:
        verifier.verify(_token(_payload(aud="another-app")))
    assert excinfo.value.code == "INVALID_TOKEN"


def test_wrong_signature_is_rejected() -> None:
    verifier = TokenVerifier(_settings())
    with pytest.raises(TokenVerificationError) as excinfo:
        verifier.verify(_token(_payload(), secret="not-the-secret"))
    assert excinfo.value.code == "INVALID_TOKEN"


def test_service_role_token_is_rejected() -> None:
    verifier = TokenVerifier(_settings())
    with pytest.raises(TokenVerificationError) as excinfo:
        verifier.verify(_token(_payload(role="service_role")))
    assert excinfo.value.code == "INVALID_TOKEN"


def test_token_without_subject_is_rejected() -> None:
    verifier = TokenVerifier(_settings())
    payload = _payload()
    payload.pop("sub")
    with pytest.raises(TokenVerificationError) as excinfo:
        verifier.verify(_token(payload))
    assert excinfo.value.code == "INVALID_TOKEN"


def test_malformed_token_is_rejected() -> None:
    verifier = TokenVerifier(_settings())
    with pytest.raises(TokenVerificationError) as excinfo:
        verifier.verify("not-a-jwt")
    assert excinfo.value.code == "INVALID_TOKEN"


def test_missing_verification_configuration_fails_closed() -> None:
    verifier = TokenVerifier(
        _settings(supabase_jwt_secret=None, supabase_url=None, supabase_jwks_url=None)
    )
    with pytest.raises(TokenVerificationError) as excinfo:
        verifier.verify(_token(_payload()))
    assert excinfo.value.code == "TOKEN_VERIFICATION_UNAVAILABLE"

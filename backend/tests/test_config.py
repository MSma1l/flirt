"""Teste pentru guard-ul de producție din Settings (B3)."""
import pytest
from pydantic import ValidationError

from app.core.config import Settings

# RO: chei PEM „reale" nu sunt necesare — guard-ul verifică doar că nu-s goale.
_FAKE_PRIV = "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----"
_FAKE_PUB = "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----"


def test_production_defaults_raise():
    """Prod + default-uri nesigure (parolă 'change_me', chei goale) → ValidationError."""
    with pytest.raises(ValidationError):
        Settings(
            environment="production",
            postgres_password="change_me",
            jwt_private_key="",
            jwt_public_key="",
            database_url="",
        )


def test_production_real_values_ok():
    """Prod + valori reale → instanțiere reușită.

    Guard-ul întărit cere și integrări în modul 'live' (nu 'stub'), debug oprit
    și CORS fără wildcard — le furnizăm explicit aici.
    """
    s = Settings(
        environment="production",
        postgres_password="a-strong-secret",
        jwt_private_key=_FAKE_PRIV,
        jwt_public_key=_FAKE_PUB,
        database_url="",
        social_auth_mode="live",
        otp_mode="live",
        billing_provider="stripe",
        face_verify_provider="rekognition",
        storage_provider="s3",
        push_provider="expo",
        debug=False,
        cors_origins="https://app.flirt.example",
    )
    assert s.environment == "production"


def test_development_defaults_ok():
    """Dev cu default-uri → guard-ul nu blochează."""
    s = Settings(environment="development")
    assert s.environment == "development"

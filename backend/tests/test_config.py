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


def _prod_kwargs(**overrides):
    """Configurație de producție COMPLETĂ și validă (baseline pentru teste).

    Guard-ul cere: integrări în modul 'live' (nu 'stub'), CHEILE cerute de fiecare
    provider ales, debug oprit, CORS fără wildcard, GEO real cu User-Agent propriu.
    """
    kwargs = dict(
        environment="production",
        postgres_password="a-strong-secret",
        jwt_private_key=_FAKE_PRIV,
        jwt_public_key=_FAKE_PUB,
        database_url="",
        social_auth_mode="live",
        google_client_id="123.apps.googleusercontent.com",
        apple_client_id="md.flirt.app",
        otp_mode="live",
        redis_url="redis://redis:6379/0",
        twilio_account_sid="AC_test",
        twilio_auth_token="tok_test",
        twilio_from="+37312345678",
        billing_provider="stripe",
        stripe_secret_key="sk_test",
        face_verify_provider="rekognition",
        storage_provider="s3",
        s3_bucket="flirt-media",
        s3_region="eu-central-1",
        aws_access_key_id="AKIA_test",
        aws_secret_access_key="secret_test",
        push_provider="expo",
        geo_provider="nominatim",
        geo_user_agent="FLIRT/1.0 (contact@flirt.md)",
        debug=False,
        cors_origins="https://app.flirt.example",
    )
    kwargs.update(overrides)
    return kwargs


def test_production_real_values_ok():
    """Prod + configurație completă și validă → instanțiere reușită."""
    s = Settings(**_prod_kwargs())
    assert s.environment == "production"


def test_production_rejects_live_provider_without_keys():
    """Regresie: `live`/`s3` cu chei GOALE trecea guardul și crăpa abia la primul
    upload, în producție, pe utilizatori reali. Acum e refuzat la pornire."""
    with pytest.raises(ValidationError) as exc:
        Settings(**_prod_kwargs(s3_bucket="", aws_access_key_id=""))
    msg = str(exc.value)
    assert "S3_BUCKET" in msg and "AWS_ACCESS_KEY_ID" in msg


def test_production_rejects_stub_geocoder():
    """Regresie: GEO_PROVIDER lipsea din guard, deci producția putea porni tăcut
    cu geocoderul stub (~20 orașe hardcodate) → raza de căutare și factorul de
    distanță din Compatibility Score deveneau inoperante, fără nicio eroare."""
    with pytest.raises(ValidationError) as exc:
        Settings(**_prod_kwargs(geo_provider="stub"))
    assert "GEO_PROVIDER" in str(exc.value)


def test_development_defaults_ok():
    """Dev cu default-uri → guard-ul nu blochează."""
    s = Settings(environment="development")
    assert s.environment == "development"

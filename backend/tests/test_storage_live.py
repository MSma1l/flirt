"""Teste pentru storage-ul LIVE S3 — boto3 este MOCK-uit (fără chei/rețea).

Verificăm că `S3Storage.save` cheamă `put_object` cu bucket/cheie corecte și
întoarce URL-ul public așteptat, iar `delete` cheamă `delete_object`.
"""
import boto3
import pytest

from app.services import storage
from app.services.storage import S3Storage, build_photo_key, get_storage


class _FakeS3Client:
    """Client S3 fals: înregistrează apelurile fără a atinge rețeaua."""

    def __init__(self):
        self.put_calls: list[dict] = []
        self.delete_calls: list[dict] = []

    def put_object(self, **kwargs):
        self.put_calls.append(kwargs)
        return {"ETag": "fake-etag"}

    def delete_object(self, **kwargs):
        self.delete_calls.append(kwargs)
        return {}


@pytest.fixture
def fake_s3(monkeypatch):
    """Monkeypatch `boto3.client` → client fals; configurează settings S3."""
    fake = _FakeS3Client()
    monkeypatch.setattr(boto3, "client", lambda *a, **k: fake)

    # Configurare S3 din settings (fără hardcodare în cod).
    monkeypatch.setattr(storage.settings, "storage_provider", "s3")
    monkeypatch.setattr(storage.settings, "s3_bucket", "flirt-media")
    monkeypatch.setattr(storage.settings, "s3_region", "eu-central-1")
    monkeypatch.setattr(storage.settings, "aws_access_key_id", "AKIA_TEST")
    monkeypatch.setattr(storage.settings, "aws_secret_access_key", "SECRET_TEST")
    return fake


def test_get_storage_returns_s3(fake_s3):
    """`get_storage()` întoarce S3Storage când providerul e 's3'."""
    assert isinstance(get_storage(), S3Storage)


@pytest.mark.asyncio
async def test_s3_save_calls_put_object_and_returns_public_url(fake_s3):
    """`save` cheamă put_object cu cheia sigură dată și întoarce URL-ul public."""
    key = build_photo_key("prof-123", "image/jpeg")
    url = await S3Storage().save(key, b"binary-bytes", "image/jpeg")

    # Un singur apel put_object.
    assert len(fake_s3.put_calls) == 1
    call = fake_s3.put_calls[0]
    assert call["Bucket"] == "flirt-media"
    assert call["Body"] == b"binary-bytes"
    # ContentType forțat server-side din allowlist (nu din input arbitrar).
    assert call["ContentType"] == "image/jpeg"
    assert call["Key"] == key

    # URL-ul public are forma standard S3 și corespunde cheii.
    assert url == (
        f"https://flirt-media.s3.eu-central-1.amazonaws.com/{key}"
    )


@pytest.mark.asyncio
async def test_build_photo_key_is_safe(fake_s3):
    """`build_photo_key` folosește uuid + ext din content-type (fără filename)."""
    key = build_photo_key("prof-123", "image/png")
    assert key.startswith("photos/prof-123/")
    assert key.endswith(".png")


@pytest.mark.asyncio
async def test_build_photo_key_rejects_disallowed_content_type(fake_s3):
    """`build_photo_key` refuză (ValueError) un content-type nepermis."""
    with pytest.raises(ValueError):
        build_photo_key("prof-123", "text/html")


@pytest.mark.asyncio
async def test_s3_delete_calls_delete_object_with_derived_key(fake_s3):
    """`delete` derivă cheia din URL și cheamă delete_object."""
    url = "https://flirt-media.s3.eu-central-1.amazonaws.com/photos/abc/poza.jpg"
    await S3Storage().delete(url)

    assert len(fake_s3.delete_calls) == 1
    call = fake_s3.delete_calls[0]
    assert call["Bucket"] == "flirt-media"
    assert call["Key"] == "photos/abc/poza.jpg"


@pytest.mark.asyncio
async def test_s3_delete_rejects_foreign_host(fake_s3):
    """`delete` NU șterge nimic pentru un URL din afara host-ului nostru."""
    await S3Storage().delete("https://evil.example/photos/victim/secret.jpg")
    assert fake_s3.delete_calls == []


@pytest.mark.asyncio
async def test_s3_delete_rejects_key_outside_photos(fake_s3):
    """`delete` refuză chei în afara namespace-ului `photos/` (ex. backups/)."""
    url = "https://flirt-media.s3.eu-central-1.amazonaws.com/backups/db.sql"
    await S3Storage().delete(url)
    assert fake_s3.delete_calls == []

"""Teste pentru verificarea facială — boto3/Rekognition este MOCK-uit (fără chei).

Acoperă: stub (True, 99), Rekognition cu similaritate peste/sub prag și
endpoint-ul `/profiles/verify-face` în modul stub.
"""
import boto3
import pytest

from app.core.config import settings
from app.services import face_verify
from app.services.face_verify import (
    RekognitionFaceVerifier,
    StubFaceVerifier,
    get_face_verifier,
)

API = "/api/v1"


# --- Stub --------------------------------------------------------------------
@pytest.mark.asyncio
async def test_stub_face_verifier_returns_true_99():
    """`StubFaceVerifier.compare` întoarce (True, 99.0) fără rețea."""
    verified, score = await StubFaceVerifier().compare(b"selfie", ["url1"])
    assert verified is True
    assert score == 99.0


def test_get_face_verifier_stub_default():
    """`get_face_verifier()` întoarce StubFaceVerifier implicit."""
    assert isinstance(get_face_verifier(), StubFaceVerifier)


# --- Rekognition (mock) ------------------------------------------------------
class _FakeBody:
    def read(self):
        return b"reference-image-bytes"


class _FakeS3Client:
    def get_object(self, **kwargs):
        return {"Body": _FakeBody()}


class _FakeRekognitionClient:
    def __init__(self, similarity):
        self._similarity = similarity
        self.compare_calls: list[dict] = []

    def compare_faces(self, **kwargs):
        self.compare_calls.append(kwargs)
        # Rekognition întoarce FaceMatches cu scorul de similaritate.
        return {"FaceMatches": [{"Similarity": self._similarity}]}


def _patch_boto3(monkeypatch, similarity):
    """Monkeypatch `boto3.client` → fake S3 + fake Rekognition după serviciu."""
    rek = _FakeRekognitionClient(similarity)

    def _fake_client(service, *args, **kwargs):
        if service == "rekognition":
            return rek
        if service == "s3":
            return _FakeS3Client()
        raise AssertionError(f"Serviciu neașteptat: {service}")

    monkeypatch.setattr(boto3, "client", _fake_client)
    # Configurare AWS din settings (fără hardcodare în cod).
    monkeypatch.setattr(face_verify.settings, "s3_bucket", "flirt-media")
    monkeypatch.setattr(face_verify.settings, "s3_region", "eu-central-1")
    monkeypatch.setattr(face_verify.settings, "aws_access_key_id", "AKIA_TEST")
    monkeypatch.setattr(face_verify.settings, "aws_secret_access_key", "SECRET_TEST")
    return rek


@pytest.mark.asyncio
async def test_rekognition_high_similarity_verified(monkeypatch):
    """Similaritate 95 (≥ prag) → verified True."""
    rek = _patch_boto3(monkeypatch, similarity=95.0)
    ref = "https://flirt-media.s3.eu-central-1.amazonaws.com/photos/a/ref.jpg"

    verified, score = await RekognitionFaceVerifier().compare(b"selfie", [ref])
    assert verified is True
    assert score == 95.0
    assert len(rek.compare_calls) == 1
    assert rek.compare_calls[0]["SourceImage"] == {"Bytes": b"selfie"}


@pytest.mark.asyncio
async def test_rekognition_low_similarity_not_verified(monkeypatch):
    """Similaritate 50 (< prag) → verified False."""
    _patch_boto3(monkeypatch, similarity=50.0)
    ref = "https://flirt-media.s3.eu-central-1.amazonaws.com/photos/a/ref.jpg"

    verified, score = await RekognitionFaceVerifier().compare(b"selfie", [ref])
    assert verified is False
    assert score == 50.0
    assert score < settings.face_match_threshold


@pytest.mark.asyncio
async def test_rekognition_no_reference_photos(monkeypatch):
    """Fără poze de referință → (False, 0.0), fără apel la rețea."""
    _patch_boto3(monkeypatch, similarity=95.0)
    verified, score = await RekognitionFaceVerifier().compare(b"selfie", [])
    assert verified is False
    assert score == 0.0


# --- Endpoint (stub) ---------------------------------------------------------
def _extract_token(payload: dict) -> str | None:
    if isinstance(payload, dict):
        for key in ("access_token", "accessToken", "token"):
            if isinstance(payload.get(key), str):
                return payload[key]
    return None


async def _auth_headers(client) -> dict[str, str]:
    body = {"email": "face@example.com", "password": "Str0ng-Passw0rd!"}
    resp = await client.post(f"{API}/auth/register", json=body)
    assert resp.status_code in (200, 201), resp.text
    token = _extract_token(resp.json())
    assert token
    return {"Authorization": f"Bearer {token}"}


def _valid_anketa() -> dict:
    return {
        "name": "Ivan",
        "birth_date": "2000-01-01",
        "gender": "male",
        "height_cm": 180,
        "city": "Chișinău",
        "languages": ["ru"],
        "dating_statuses": ["serious"],
        "interests": ["sport"],
        "photos": ["https://cdn.flirt.local/photos/x/a.jpg"],
    }


@pytest.mark.asyncio
async def test_verify_face_endpoint_stub_sets_verified(client, db_session):
    """`/profiles/verify-face` în stub → verified True + Profile.verified True."""
    import uuid

    from sqlalchemy import select

    from app.models.profile import Profile
    from app.models.user import User

    headers = await _auth_headers(client)
    # Creează anketa (cu cel puțin o poză de referință).
    resp = await client.put(f"{API}/profiles/me", json=_valid_anketa(), headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["verified"] is False

    # Apel verificare facială (body JSON simplu — stub).
    resp = await client.post(f"{API}/profiles/verify-face", json={}, headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["verified"] is True
    assert data["similarity"] == 99.0

    # Persistat în DB: Profile.verified devine True.
    me = await client.get(f"{API}/auth/me", headers=headers)
    user_id = uuid.UUID(me.json()["id"])
    result = await db_session.execute(
        select(Profile).where(Profile.user_id == user_id)
    )
    profile = result.scalar_one()
    assert profile.verified is True

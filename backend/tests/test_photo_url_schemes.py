"""URL-uri de poză: `http` acceptat DOAR în dev (storage local pe LAN), `https`
mereu; producția rămâne strict `https`.

Regresie pentru pozele „EDIT-PROOF": storage-ul local pe LAN servește fără TLS
(`http://192.168.x.x:8008`), deci pozele conturilor de test trebuie să treacă
validarea `PUT /profiles/me` în dev — dar fără a slăbi producția.
"""
from datetime import date

import pytest
from pydantic import ValidationError

from app.schemas.profile import AnketaIn
from app.services import storage
from app.services.storage import allowed_schemes, key_from_own_url

# Storage local pe LAN (host din STORAGE_PUBLIC_BASE_URL, path /media).
LOCAL_BASE = "http://192.168.2.54:8008/media"
LOCAL_HTTP = "http://192.168.2.54:8008/media/photos/abc/x.jpg"
LOCAL_HTTPS = "https://192.168.2.54:8008/media/photos/abc/x.jpg"


def _anketa(photos: list[str]) -> AnketaIn:
    return AnketaIn(
        name="Test",
        birth_date=date(1990, 1, 1),
        gender="male",
        height_cm=180,
        city="Chișinău",
        languages=["ro"],
        interests=["music"],
        photos=photos,
    )


@pytest.fixture
def local_lan(monkeypatch):
    """Configurează storage-ul local pe LAN (host + path servit static)."""
    monkeypatch.setattr(storage.settings, "storage_base_url", LOCAL_BASE)


def test_dev_accepts_http_local_url(local_lan, monkeypatch):
    monkeypatch.setattr(storage.settings, "environment", "development")
    # allowed_schemes include http în dev
    assert allowed_schemes() == {"https", "http"}
    # Validarea de schemă din AnketaIn trece cu URL http local.
    ank = _anketa([LOCAL_HTTP])
    assert ank.photos == [LOCAL_HTTP]
    # Gate-ul de namespace (folosit și de service/upsert) acceptă http-ul local.
    assert key_from_own_url(LOCAL_HTTP, "abc") == "photos/abc/x.jpg"


def test_dev_still_rejects_foreign_host(local_lan, monkeypatch):
    monkeypatch.setattr(storage.settings, "environment", "development")
    with pytest.raises(ValidationError):
        _anketa(["http://evil.example.com/media/photos/abc/x.jpg"])


def test_production_rejects_http(local_lan, monkeypatch):
    monkeypatch.setattr(storage.settings, "environment", "production")
    # Producție: doar https.
    assert allowed_schemes() == {"https"}
    with pytest.raises(ValidationError):
        _anketa([LOCAL_HTTP])
    # key_from_own_url respinge http-ul în producție (scheme allowlist).
    assert key_from_own_url(LOCAL_HTTP, "abc") is None


def test_production_accepts_https(local_lan, monkeypatch):
    monkeypatch.setattr(storage.settings, "environment", "production")
    ank = _anketa([LOCAL_HTTPS])
    assert ank.photos == [LOCAL_HTTPS]

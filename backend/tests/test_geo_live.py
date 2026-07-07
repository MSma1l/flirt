"""Teste pentru geocoderele LIVE (Google + Mapbox) — TZ 7.

Nu folosesc chei reale și nu ating rețeaua: monkeypatch pe `httpx.AsyncClient.get`
returnează răspunsuri fabricate. Acoperă: succes (coordonate), răspuns gol (None)
și eroare HTTP (None, fără excepție propagată). Plus `distance_km_between` cu un
geocoder live mock-uit pe două orașe (distanță > 0).
"""
import httpx
import pytest

from app.services import geo


class _FakeResponse:
    """Răspuns HTTP fals: `json()` întoarce payload-ul, `raise_for_status()` opțional crapă."""

    def __init__(self, payload: dict, status_ok: bool = True) -> None:
        self._payload = payload
        self._status_ok = status_ok

    def raise_for_status(self) -> None:
        if not self._status_ok:
            # Simulează un 4xx/5xx ca httpx real.
            raise httpx.HTTPStatusError(
                "boom", request=httpx.Request("GET", "https://example.test"), response=None
            )

    def json(self) -> dict:
        return self._payload


def _patch_get(monkeypatch, *, payload=None, exc=None, status_ok=True):
    """Înlocuiește `httpx.AsyncClient.get` cu o coroutine care întoarce un răspuns fals.

    `exc` != None => get-ul ridică excepția (simulează timeout/rețea picată).
    """

    async def _fake_get(self, url, *args, **kwargs):  # noqa: ANN001
        if exc is not None:
            raise exc
        return _FakeResponse(payload or {}, status_ok=status_ok)

    monkeypatch.setattr(httpx.AsyncClient, "get", _fake_get)


# --- Google ------------------------------------------------------------------
async def test_google_geocode_success(monkeypatch):
    """Google: `results[0].geometry.location` => (lat, lng)."""
    payload = {
        "results": [
            {"geometry": {"location": {"lat": 47.0105, "lng": 28.8638}}}
        ]
    }
    _patch_get(monkeypatch, payload=payload)
    coord = await geo.GoogleGeocoder(api_key="test").geocode("Chișinău", "Ștefan cel Mare")
    assert coord == (47.0105, 28.8638)


async def test_google_geocode_empty_returns_none(monkeypatch):
    """Google: `results: []` => None."""
    _patch_get(monkeypatch, payload={"results": []})
    coord = await geo.GoogleGeocoder(api_key="test").geocode("Necunoscutopol")
    assert coord is None


async def test_google_geocode_http_error_returns_none(monkeypatch):
    """Google: eroare HTTP (raise_for_status) => None, fără excepție propagată."""
    _patch_get(monkeypatch, payload={"results": []}, status_ok=False)
    coord = await geo.GoogleGeocoder(api_key="test").geocode("Chișinău")
    assert coord is None


async def test_google_geocode_network_error_returns_none(monkeypatch):
    """Google: rețea picată (get ridică) => None."""
    _patch_get(monkeypatch, exc=httpx.ConnectError("down"))
    coord = await geo.GoogleGeocoder(api_key="test").geocode("Chișinău")
    assert coord is None


# --- Mapbox ------------------------------------------------------------------
async def test_mapbox_geocode_success(monkeypatch):
    """Mapbox: `features[0].center = [lng, lat]` => (lat, lng)."""
    payload = {"features": [{"center": [28.8638, 47.0105]}]}
    _patch_get(monkeypatch, payload=payload)
    coord = await geo.MapboxGeocoder(api_key="test").geocode("Chișinău")
    assert coord == (47.0105, 28.8638)


async def test_mapbox_geocode_empty_returns_none(monkeypatch):
    """Mapbox: `features: []` => None."""
    _patch_get(monkeypatch, payload={"features": []})
    coord = await geo.MapboxGeocoder(api_key="test").geocode("Necunoscutopol")
    assert coord is None


async def test_mapbox_geocode_http_error_returns_none(monkeypatch):
    """Mapbox: eroare HTTP => None, fără excepție propagată."""
    _patch_get(monkeypatch, payload={"features": []}, status_ok=False)
    coord = await geo.MapboxGeocoder(api_key="test").geocode("Chișinău")
    assert coord is None


# --- get_geocoder() selectează providerul LIVE -------------------------------
def test_get_geocoder_selects_live_providers(monkeypatch):
    """`get_geocoder()` întoarce clasa corectă după `settings.geo_provider`."""
    monkeypatch.setattr(geo.settings, "geo_provider", "google")
    monkeypatch.setattr(geo.settings, "geo_api_key", "test")
    assert isinstance(geo.get_geocoder(), geo.GoogleGeocoder)

    monkeypatch.setattr(geo.settings, "geo_provider", "mapbox")
    assert isinstance(geo.get_geocoder(), geo.MapboxGeocoder)


# --- distance_km_between cu geocoder live mock-uit ---------------------------
async def test_distance_km_between_with_live_google(monkeypatch):
    """Distanță între două orașe folosind Google mock-uit => > 0."""
    # Fiecare apel de geocode întoarce coordonate diferite după orașul cerut.
    coords = {
        "Chișinău": {"lat": 47.0105, "lng": 28.8638},
        "București": {"lat": 44.4268, "lng": 26.1025},
    }

    async def _fake_get(self, url, *args, **kwargs):  # noqa: ANN001
        address = kwargs.get("params", {}).get("address", "")
        # Alege orașul potrivit din adresa cerută (city e ultima parte).
        for city, loc in coords.items():
            if city in address:
                return _FakeResponse({"results": [{"geometry": {"location": loc}}]})
        return _FakeResponse({"results": []})

    monkeypatch.setattr(httpx.AsyncClient, "get", _fake_get)
    monkeypatch.setattr(geo.settings, "geo_provider", "google")
    monkeypatch.setattr(geo.settings, "geo_api_key", "test")

    dist = await geo.distance_km_between("Chișinău", None, "București", None)
    assert dist is not None
    assert dist > 0

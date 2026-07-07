"""Geolocație / geocoding (TZ 7) — schelet cu implementare STUB.

Gata de „chei reale": comută `settings.geo_provider` pe 'google'/'mapbox' și
setează `settings.geo_api_key`. Deocamdată doar STUB (fără rețea), plus funcția
pură `haversine_km` folosită pentru distanțe.
"""
from __future__ import annotations

import math
from typing import Protocol

import httpx

from app.core.config import settings

# --- Constante rețea pentru providerii LIVE ----------------------------------
# Endpoint-urile publice de geocoding + timeout implicit (secunde).
GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
MAPBOX_GEOCODE_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places"
HTTP_TIMEOUT_S = 10.0

# --- Constante geo -----------------------------------------------------------
EARTH_RADIUS_KM = 6371.0088  # raza medie a Pământului (IUGG)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distanța ortodromică (haversine) în km între două puncte (grade decimale).

    Funcție PURĂ, fără I/O. Robustă la ordinea argumentelor (simetrică).
    """
    # Convertim gradele în radiani.
    rlat1, rlon1, rlat2, rlon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    dlat = rlat2 - rlat1
    dlon = rlon2 - rlon1
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.asin(min(1.0, math.sqrt(a)))
    return EARTH_RADIUS_KM * c


class Geocoder(Protocol):
    """Contractul unui geocoder: oraș (+ stradă opțională) -> (lat, lng) | None."""

    async def geocode(
        self, city: str, street: str | None = None
    ) -> tuple[float, float] | None:
        """Întoarce coordonatele (lat, lng) sau None dacă locul e necunoscut."""
        ...


# --- Dicționar de orașe uzuale (lat, lng) pentru STUB ------------------------
# Coordonate aproximative ale centrelor. Cheile sunt casefold-uite la lookup.
_STUB_CITIES: dict[str, tuple[float, float]] = {
    "chișinău": (47.0105, 28.8638),
    "chisinau": (47.0105, 28.8638),
    "bălți": (47.7615, 27.9291),
    "balti": (47.7615, 27.9291),
    "tiraspol": (46.8403, 29.6433),
    "cahul": (45.9083, 28.1944),
    "comrat": (46.2917, 28.6564),
    "bucurești": (44.4268, 26.1025),
    "bucuresti": (44.4268, 26.1025),
    "iași": (47.1585, 27.6014),
    "iasi": (47.1585, 27.6014),
    "cluj": (46.7712, 23.6236),
    "cluj-napoca": (46.7712, 23.6236),
    "timișoara": (45.7489, 21.2087),
    "timisoara": (45.7489, 21.2087),
    "constanța": (44.1598, 28.6348),
    "constanta": (44.1598, 28.6348),
    "brașov": (45.6580, 25.6012),
    "brasov": (45.6580, 25.6012),
    "moscova": (55.7558, 37.6173),
    "kiev": (50.4501, 30.5234),
    "odesa": (46.4825, 30.7233),
    "odessa": (46.4825, 30.7233),
}


def _normalize_city(city: str | None) -> str:
    """Normalizează numele orașului pentru lookup (trim + casefold)."""
    return (city or "").strip().casefold()


class StubGeocoder:
    """Geocoder STUB: rezolvă din dicționar, NU face rețea.

    Orașele necunoscute întorc None (contract respectat). Strada e ignorată în
    stub (nu schimbă rezultatul), dar rămâne în semnătură pentru providerul real.
    """

    async def geocode(
        self, city: str, street: str | None = None
    ) -> tuple[float, float] | None:
        return _STUB_CITIES.get(_normalize_city(city))


def _build_query(city: str, street: str | None = None) -> str:
    """Compune un șir de căutare din stradă (opțional) + oraș.

    Ex.: ("București", "Calea Victoriei") -> "Calea Victoriei, București".
    Fără stradă rămâne doar orașul. Trim pe fiecare parte, ignoră părțile goale.
    """
    parts = [p.strip() for p in (street, city) if p and p.strip()]
    return ", ".join(parts)


class GoogleGeocoder:
    """Geocoder LIVE peste Google Geocoding API.

    Citește cheia din `settings.geo_api_key`. Robust la erori: orice problemă de
    rețea/HTTP/parse întoarce None (nu propagă excepția, ca să nu cadă app-ul).
    """

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    async def geocode(
        self, city: str, street: str | None = None
    ) -> tuple[float, float] | None:
        query = _build_query(city, street)
        if not query:
            return None
        params = {"address": query, "key": self._api_key}
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_S) as http:
                resp = await http.get(GOOGLE_GEOCODE_URL, params=params)
                resp.raise_for_status()
                data = resp.json()
        except Exception:
            # Orice eroare (timeout, HTTP != 2xx, JSON invalid) => rezultat absent.
            return None
        results = (data or {}).get("results") or []
        if not results:
            return None
        location = (results[0].get("geometry") or {}).get("location") or {}
        lat = location.get("lat")
        lng = location.get("lng")
        if lat is None or lng is None:
            return None
        return (float(lat), float(lng))


class MapboxGeocoder:
    """Geocoder LIVE peste Mapbox Geocoding API (mapbox.places).

    Citește cheia din `settings.geo_api_key`. Mapbox întoarce coordonatele ca
    `center = [lng, lat]` — le rearanjăm în (lat, lng). Robust la erori => None.
    """

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    async def geocode(
        self, city: str, street: str | None = None
    ) -> tuple[float, float] | None:
        query = _build_query(city, street)
        if not query:
            return None
        # Interogarea intră în path-ul URL; o encodăm ca segment sigur.
        from urllib.parse import quote

        url = f"{MAPBOX_GEOCODE_URL}/{quote(query)}.json"
        params = {"access_token": self._api_key}
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_S) as http:
                resp = await http.get(url, params=params)
                resp.raise_for_status()
                data = resp.json()
        except Exception:
            return None
        features = (data or {}).get("features") or []
        if not features:
            return None
        center = features[0].get("center") or []
        # center = [lng, lat]; avem nevoie de exact două valori numerice.
        if len(center) < 2:
            return None
        lng, lat = center[0], center[1]
        if lat is None or lng is None:
            return None
        return (float(lat), float(lng))


def get_geocoder() -> Geocoder:
    """Alege implementarea de geocoder după `settings.geo_provider`.

    'stub' (implicit) => StubGeocoder (fără rețea). 'google'/'mapbox' => clientul
    LIVE corespunzător, care citește cheia din `settings.geo_api_key`.
    """
    provider = (settings.geo_provider or "stub").strip().lower()
    if provider == "stub":
        return StubGeocoder()
    if provider == "google":
        return GoogleGeocoder(api_key=settings.geo_api_key)
    if provider == "mapbox":
        return MapboxGeocoder(api_key=settings.geo_api_key)
    raise NotImplementedError(
        f"Provider de geocoding necunoscut: '{provider}' "
        f"(valori valide: 'stub' | 'google' | 'mapbox')."
    )


# --- Cache simplu de geocoding pe oraș (memoizare la nivel de modul) ---------
# RO: multe cartele din feed împart același oraș; re-geocodarea per candidat e
# risipă (și, la provider LIVE, un vector de DoS/cost). Memoizăm rezultatul pe
# (oraș, stradă) normalizate. IMPORTANT: în producție acest cache ar trebui să
# fie Redis (partajat între workeri, cu TTL); aici un dict de proces e suficient.
_GEOCODE_CACHE: dict[str, tuple[float, float] | None] = {}


def clear_geocode_cache() -> None:
    """Golește cache-ul de geocoding (util în teste / la schimbarea providerului)."""
    _GEOCODE_CACHE.clear()


async def geocode_cached(
    city: str, street: str | None = None
) -> tuple[float, float] | None:
    """Geocodează cu memoizare pe (oraș, stradă) normalizate.

    Rezultatul (inclusiv `None` pentru orașe necunoscute) e cache-uit ca să nu
    re-lovim providerul pentru aceeași adresă. RO: în prod → Redis cu TTL.
    """
    key = f"{_normalize_city(city)}|{_normalize_city(street)}"
    if key in _GEOCODE_CACHE:
        return _GEOCODE_CACHE[key]
    geocoder = get_geocoder()
    coord = await geocoder.geocode(city, street)
    _GEOCODE_CACHE[key] = coord
    return coord


async def distance_km_between(
    city_a: str,
    street_a: str | None,
    city_b: str,
    street_b: str | None,
) -> int | None:
    """Distanța rotunjită (km) între două adrese, sau None dacă nu se poate.

    Geocodează ambele locuri (prin cache) și aplică `haversine_km`. Dacă vreunul
    nu poate fi geocodat (oraș necunoscut), întoarce None — apelantul tratează
    absența.
    """
    coord_a = await geocode_cached(city_a, street_a)
    coord_b = await geocode_cached(city_b, street_b)
    if coord_a is None or coord_b is None:
        return None
    return round(haversine_km(coord_a[0], coord_a[1], coord_b[0], coord_b[1]))

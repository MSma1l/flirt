"""Geolocație / geocoding (TZ 7) — STUB + provideri LIVE.

Providerul se alege din `settings.geo_provider`:
  - 'nominatim' → OpenStreetMap, GRATUIT, FĂRĂ cheie API și fără card (default
    recomandat în producție). Cere doar un `User-Agent` identificabil
    (`settings.geo_user_agent`), conform policy-ului Nominatim.
  - 'google' / 'mapbox' → provideri comerciali, cer `settings.geo_api_key`.
  - 'stub' → dicționar local de orașe, fără rețea (doar dev/teste).

Plus funcția pură `haversine_km` folosită pentru distanțe.
"""
from __future__ import annotations

import math
from collections.abc import Iterable
from typing import Protocol

import httpx

from app.core.config import settings

# --- Constante rețea pentru providerii LIVE ----------------------------------
# Endpoint-urile publice de geocoding + timeout implicit (secunde).
GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
MAPBOX_GEOCODE_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places"
# Nominatim: path-ul de căutare se lipește peste `settings.geo_base_url`
# (implicit https://nominatim.openstreetmap.org) — self-hosting-ul rămâne posibil.
NOMINATIM_SEARCH_PATH = "/search"
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


def normalize_city(city: str | None) -> str:
    """Normalizează numele orașului pentru lookup/cache (trim + casefold)."""
    return (city or "").strip().casefold()


# Alias intern păstrat pentru compatibilitate cu apelurile existente din modul.
_normalize_city = normalize_city


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


class NominatimGeocoder:
    """Geocoder LIVE peste Nominatim (OpenStreetMap) — GRATUIT, FĂRĂ cheie API.

    De ce el e default-ul de producție: nu cere cont, cheie sau card bancar, iar
    datele (OSM) acoperă bine orașele din TZ. Singura obligație e de policy, nu
    tehnică: un `User-Agent` identificabil (aplicație + contact) — îl luăm din
    `settings.geo_user_agent`. Un UA gol/anonim poate duce la blocare de către
    operatorul serviciului.

    Rate limit: max ~1 req/s pe instanța publică. NU facem throttling explicit:
    apelurile trec prin `geocode_cached`, care memoizează pe (oraș, stradă) —
    numărul de orașe distincte e mic, deci traficul real rămâne sub limită.

    Robust la erori: orice problemă de rețea/HTTP/parse întoarce None (nu propagă
    excepția, ca feed-ul să nu cadă din cauza geocodării).
    """

    def __init__(self, base_url: str, user_agent: str) -> None:
        # `rstrip('/')` ca să nu producem `//search` la lipirea path-ului.
        self._base_url = (base_url or "").rstrip("/")
        self._user_agent = user_agent

    async def geocode(
        self, city: str, street: str | None = None
    ) -> tuple[float, float] | None:
        query = _build_query(city, street)
        if not query or not self._base_url:
            return None
        url = f"{self._base_url}{NOMINATIM_SEARCH_PATH}"
        params = {"q": query, "format": "jsonv2", "limit": 1}
        # RO: User-Agent OBLIGATORIU (cerință de policy Nominatim).
        headers = {"User-Agent": self._user_agent}
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_S) as http:
                resp = await http.get(url, params=params, headers=headers)
                resp.raise_for_status()
                data = resp.json()
        except Exception:
            return None
        # Răspunsul e o LISTĂ de rezultate; `limit=1` ⇒ ne interesează primul.
        if not isinstance(data, list) or not data:
            return None
        first = data[0] or {}
        lat = first.get("lat")
        lon = first.get("lon")
        if lat is None or lon is None:
            return None
        try:
            # Nominatim întoarce lat/lon ca STRING-uri ("47.0105") → float.
            return (float(lat), float(lon))
        except (TypeError, ValueError):
            return None


def get_geocoder() -> Geocoder:
    """Alege implementarea de geocoder după `settings.geo_provider`.

    'stub' (implicit în dev) => StubGeocoder (fără rețea).
    'nominatim' => OpenStreetMap, gratuit, fără cheie (recomandat în producție).
    'google'/'mapbox' => clientul LIVE corespunzător, cu `settings.geo_api_key`.
    """
    provider = (settings.geo_provider or "stub").strip().lower()
    if provider == "stub":
        return StubGeocoder()
    if provider == "nominatim":
        return NominatimGeocoder(
            base_url=settings.geo_base_url,
            user_agent=settings.geo_user_agent,
        )
    if provider == "google":
        return GoogleGeocoder(api_key=settings.geo_api_key)
    if provider == "mapbox":
        return MapboxGeocoder(api_key=settings.geo_api_key)
    raise NotImplementedError(
        f"Provider de geocoding necunoscut: '{provider}' "
        f"(valori valide: 'stub' | 'nominatim' | 'google' | 'mapbox')."
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


async def geocode_cities_cached(
    cities: Iterable[str | None], max_lookups: int | None = None
) -> dict[str, tuple[float, float] | None]:
    """Geocodează un set de orașe DISTINCTE, cu cache + PLAFON de apeluri noi.

    Întoarce `{oraș_normalizat: (lat, lng) | None}`. Folosit de feed pentru a
    scora distanța TUTUROR candidaților fără a face un apel de rețea per candidat:

    - deduplicăm pe oraș (numărul de orașe distincte e mic, chiar și la 500 de
      candidați scanați);
    - orașele deja în cache sunt GRATIS (nu consumă din plafon);
    - doar orașele NEcache-uite consumă din `max_lookups`
      (implicit `settings.geo_max_lookups_per_request`). Peste plafon nu mai
      lovim providerul: orașele rămase primesc `None` (⇒ scor de distanță neutru,
      nu o eroare). Asta închide vectorul de DoS/cost pe providerul LIVE.
    """
    budget = (
        settings.geo_max_lookups_per_request if max_lookups is None else max_lookups
    )
    out: dict[str, tuple[float, float] | None] = {}
    for city in cities:
        key = normalize_city(city)
        if not key or key in out:
            continue
        cache_key = f"{key}|"  # aceeași cheie ca `geocode_cached(city, None)`
        if cache_key in _GEOCODE_CACHE:
            out[key] = _GEOCODE_CACHE[cache_key]  # cache hit: gratis
            continue
        if budget <= 0:
            out[key] = None  # plafon atins: NU mai facem rețea în cererea asta
            continue
        budget -= 1
        out[key] = await geocode_cached(city or "", None)
    return out


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

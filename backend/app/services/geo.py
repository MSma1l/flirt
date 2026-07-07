"""Geolocație / geocoding (TZ 7) — schelet cu implementare STUB.

Gata de „chei reale": comută `settings.geo_provider` pe 'google'/'mapbox' și
setează `settings.geo_api_key`. Deocamdată doar STUB (fără rețea), plus funcția
pură `haversine_km` folosită pentru distanțe.
"""
from __future__ import annotations

import math
from typing import Protocol

from app.core.config import settings

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


def get_geocoder() -> Geocoder:
    """Alege implementarea de geocoder după `settings.geo_provider`.

    Momentan doar 'stub'. Pentru 'google'/'mapbox' ridicăm NotImplementedError
    până când cheile + clientul real sunt adăugate mai jos.
    """
    provider = (settings.geo_provider or "stub").strip().lower()
    if provider == "stub":
        return StubGeocoder()
    # === Punct de extindere pentru providerul REAL ==========================
    # Aici se adaugă geocoderele de producție. Ele vor citi cheia din
    # `settings.geo_api_key` și vor face request-uri HTTP (async) la API-ul lor:
    #
    #   if provider == "google":
    #       return GoogleGeocoder(api_key=settings.geo_api_key)
    #   if provider == "mapbox":
    #       return MapboxGeocoder(api_key=settings.geo_api_key)
    #
    # ========================================================================
    if provider in ("google", "mapbox"):
        raise NotImplementedError(
            f"Providerul de geocoding '{provider}' nu e încă implementat: "
            f"setează cheile (geo_api_key) și adaugă clientul real în geo.py."
        )
    raise NotImplementedError(
        f"Provider de geocoding necunoscut: '{provider}' "
        f"(valori valide: 'stub' | 'google' | 'mapbox')."
    )


async def distance_km_between(
    city_a: str,
    street_a: str | None,
    city_b: str,
    street_b: str | None,
) -> int | None:
    """Distanța rotunjită (km) între două adrese, sau None dacă nu se poate.

    Geocodează ambele locuri și aplică `haversine_km`. Dacă vreunul nu poate fi
    geocodat (oraș necunoscut), întoarce None — apelantul tratează absența.
    """
    geocoder = get_geocoder()
    coord_a = await geocoder.geocode(city_a, street_a)
    coord_b = await geocoder.geocode(city_b, street_b)
    if coord_a is None or coord_b is None:
        return None
    return round(haversine_km(coord_a[0], coord_a[1], coord_b[0], coord_b[1]))

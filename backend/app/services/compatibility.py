"""Algoritmul de compatibilitate (Compatibility Score) — TZ 4.6.

Funcție pură, fără DB: primește două profiluri + seturile lor de interese
(slug-uri) și întoarce un scor întreg 0–100.

Ponderile sunt CONSTANTE la începutul fișierului ca să poată fi mutate ușor în
config / remote-config mai târziu, fără release (TZ 4.6).
"""
from __future__ import annotations

import math

from app.core.config import settings
from app.models.profile import Profile

# --- Ponderi factori (sumă = 1.0) — TZ 4.6 -----------------------------------
# Valorile provin din config (fără hardcodare); default-urile din `settings`
# păstrează comportamentul numeric istoric.

# --- Valori neutre / placeholder pentru factori încă neimplementați ----------
NEUTRAL_HUMOR = 0.5      # când lipsește vectorul de umor la cel puțin unul
BEHAVIOR_NEUTRAL = 0.5   # istoricul comportamental nu e încă disponibil

# --- Placeholder limbi -------------------------------------------------------
# GATE dur: fără nicio limbă comună, factorul limbă e puternic penalizat.
LANGUAGES_NO_COMMON = 0.0


def _jaccard(a: set[str], b: set[str]) -> float:
    """Indicele Jaccard: |A∩B| / |A∪B|. Ambele goale → 0.0 (nimic în comun)."""
    if not a and not b:
        return 0.0
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


def _as_set(value) -> set[str]:
    """Normalizează o listă (posibil None) la un set de string-uri curate."""
    if not value:
        return set()
    return {str(v) for v in value if v is not None and str(v).strip()}


def _status_overlap(a: Profile, b: Profile) -> float:
    """Suprapunerea statusurilor de cunoștință, proporțional (Jaccard)."""
    return _jaccard(_as_set(a.dating_statuses), _as_set(b.dating_statuses))


def _humor_similarity(a: Profile, b: Profile) -> float:
    """Cosinus între vectorii de umor; neutru dacă lipsește la vreunul (TZ 4.6)."""
    va = a.humor_vector if isinstance(a.humor_vector, dict) else None
    vb = b.humor_vector if isinstance(b.humor_vector, dict) else None
    if not va or not vb:
        return NEUTRAL_HUMOR

    # Aliniem pe cheile comune; dacă nu există chei comune → neutru.
    keys = set(va) & set(vb)
    if not keys:
        return NEUTRAL_HUMOR

    dot = 0.0
    na = 0.0
    nb = 0.0
    for k in keys:
        try:
            xa = float(va[k])
            xb = float(vb[k])
        except (TypeError, ValueError):
            continue
        dot += xa * xb
        na += xa * xa
        nb += xb * xb
    if na <= 0 or nb <= 0:
        return NEUTRAL_HUMOR
    cos = dot / (math.sqrt(na) * math.sqrt(nb))
    # Clamp în [0, 1] (umorul are componente ne-negative în mod normal).
    return max(0.0, min(1.0, cos))


def _distance_score(distance_km: float | None) -> float:
    """Proximitate pe DISTANȚA REALĂ (km), descrescătoare liniar (TZ 4.6/7).

    Formula: `max(0.0, 1.0 - d / decay_km)`, cu `decay_km` din config
    (`COMPAT_DISTANCE_DECAY_KM`, fără hardcodare):

        d = 0 km        → 1.0  (același loc: scorul MAXIM e acum atins-abil corect)
        d = decay_km/2  → 0.5
        d ≥ decay_km    → 0.0  (prea departe: factorul nu mai aduce nimic)

    Înlocuiește vechiul placeholder binar (același oraș = 1.0, alt oraș = 0.4),
    care dădea IDENTIC 0.4 pentru Chișinău↔Bălți (~127 km) și Chișinău↔Moscova
    (~1100 km). Acum funcția e strict descrescătoare în d până la `decay_km`:
    mai aproape ⇒ scor mai mare.

    `distance_km is None` (oraș negeocodabil, provider indisponibil, plafon de
    lookup atins) ⇒ valoare NEUTRĂ din config (`COMPAT_DISTANCE_NEUTRAL`): nu
    penalizăm și nu premiem un candidat pentru care pur și simplu nu știm.
    """
    if distance_km is None:
        return _clamp01(settings.compat_distance_neutral)

    decay_km = settings.compat_distance_decay_km
    if decay_km <= 0:
        # Config degenerată: fără rază de decădere, doar distanța 0 mai punctează.
        return 1.0 if distance_km <= 0 else 0.0
    return _clamp01(1.0 - (max(0.0, float(distance_km)) / decay_km))


def _clamp01(value: float) -> float:
    """Limitează o valoare în intervalul [0, 1] (siguranță la config aiurea)."""
    return max(0.0, min(1.0, float(value)))


def _languages_score(a: Profile, b: Profile) -> float:
    """Limbi comune. GATE: fără nicio limbă comună → penalizare maximă (0.0).

    Cu ≥1 limbă comună, scorul crește proporțional cu numărul de limbi comune
    raportat la limbile celui cu mai puține (bonus pentru mai multe comune).
    """
    la = _as_set(a.languages)
    lb = _as_set(b.languages)
    common = la & lb
    if not common:
        return LANGUAGES_NO_COMMON
    smaller = min(len(la), len(lb)) or 1
    return min(1.0, len(common) / smaller)


def compute_compatibility(
    a: Profile,
    b: Profile,
    a_interests: set[str],
    b_interests: set[str],
    distance_km: float | None = None,
) -> int:
    """Scorul de compatibilitate 0–100 între profilurile `a` și `b` (TZ 4.6).

    Rămâne o funcție PURĂ (fără I/O): distanța reală se calculează în afară
    (`feed_service`, prin geocoding cache-uit) și se injectează aici ca
    `distance_km`. `None` ⇒ factorul de distanță ia valoarea neutră din config,
    deci apelanții care nu au geocoding (ex. lista de chat-uri) rămân valizi.

    Robust la câmpuri lipsă/None: fiecare factor se degradează la o valoare
    neutră sau placeholder documentat.
    """
    interests = _jaccard(_as_set(a_interests), _as_set(b_interests))
    status = _status_overlap(a, b)
    humor = _humor_similarity(a, b)
    distance = _distance_score(distance_km)
    languages = _languages_score(a, b)
    behavior = BEHAVIOR_NEUTRAL

    score = (
        settings.compat_w_interests * interests
        + settings.compat_w_status * status
        + settings.compat_w_humor * humor
        + settings.compat_w_distance * distance
        + settings.compat_w_languages * languages
        + settings.compat_w_behavior * behavior
    )

    # Normalizat 0–100, rotunjit la procent întreg (clamp de siguranță).
    return max(0, min(100, round(score * 100)))

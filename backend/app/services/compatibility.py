"""Algoritmul de compatibilitate (Compatibility Score) — TZ 4.6.

Funcție pură, fără DB: primește două profiluri + seturile lor de interese
(slug-uri) și întoarce un scor întreg 0–100.

Ponderile sunt CONSTANTE la începutul fișierului ca să poată fi mutate ușor în
config / remote-config mai târziu, fără release (TZ 4.6).
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

from app.core.config import settings
from app.models.profile import Profile

# --- Ponderi factori (sumă = 1.0) — TZ 4.6 -----------------------------------
# Valorile provin din config (fără hardcodare); default-urile din `settings`
# păstrează comportamentul numeric istoric.

# --- Valori neutre / placeholder pentru factori încă neimplementați ----------
NEUTRAL_HUMOR = 0.5      # când lipsește vectorul de umor la cel puțin unul

# --- Semnal comportamental (comportament, 10% din scor) ----------------------
# Înlocuiește vechea constantă neutră cu un scor REAL, calculat din semnale deja
# disponibile fără migrație nouă: recența activității (`users.last_active_at`) și
# statutul de profil verificat (`profiles.verified`). Monoton și mărginit în
# [0, 1]:
#   - mai recent activ ⇒ scor mai mare (userii „vii" merită expunere);
#   - profil verificat ⇒ mic bonus de încredere (împinge scorul spre 1).
# Fără date de activitate cădem elegant pe neutru (0.5): nici premiu, nici
# penalizare pentru un cont despre care nu știm nimic.
BEHAVIOR_NEUTRAL = 0.5   # fallback când nu avem semnale (rând legacy, apelant fără date)
# Peste acest orizont recența nu mai contribuie (scor de recență 0). Ales în
# același ordin de mărime ca `feed_max_inactive_days` (30): un cont la limita de
# inactivitate are recență ~0, unul activ azi ~1.
BEHAVIOR_ACTIVITY_DECAY_DAYS = 30.0
# Bonus de încredere pentru profil verificat: împinge proporțional spre 1 fără
# să depășească plafonul (un cont verificat NU poate „sări" peste 1.0).
BEHAVIOR_VERIFIED_BONUS = 0.15

# --- Placeholder limbi -------------------------------------------------------
# Limba NU mai e un gate DUR la retrieval (feed_service nu mai exclude profilurile
# fără limbă comună — pool mai larg). A rămas un semnal SOFT de ranking: fără nicio
# limbă comună factorul limbă e 0.0, deci acei candidați sunt clasați mai jos, dar
# rămân vizibili. Cei cu limbă comună sunt astfel prioritizați prin scor, nu prin
# excludere.
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


def behavior_score(
    last_active_at: datetime | None,
    verified: bool = False,
    now: datetime | None = None,
) -> float:
    """Semnal comportamental în [0, 1] din recența activității + verificare.

    Funcție PURĂ (fără I/O): apelantul (`feed_service`) injectează
    `last_active_at` (`users.last_active_at`) și `verified` (`profiles.verified`),
    ambele deja citite în retrieval — zero query-uri în plus, fără N+1. Fără
    migrație/coloane noi.

    - `last_active_at is None` (rând legacy, fără date) ⇒ pornim de la neutru 0.5;
    - altfel recența = `max(0, 1 − zile_de_la_activitate / DECAY)`, strict
      descrescătoare în timp (activ azi ⇒ ~1, la limita de inactivitate ⇒ ~0);
    - `verified` împinge scorul proporțional spre 1 (`s + bonus·(1−s)`), monoton
      și mărginit — un profil verificat nu poate depăși 1.0.
    """
    if last_active_at is None:
        score = BEHAVIOR_NEUTRAL
    else:
        now = now or datetime.now(timezone.utc)
        la = last_active_at
        if la.tzinfo is None:  # rânduri persistate naiv → interpretate ca UTC
            la = la.replace(tzinfo=timezone.utc)
        days = max(0.0, (now - la).total_seconds() / 86400.0)
        if BEHAVIOR_ACTIVITY_DECAY_DAYS <= 0:
            # Config degenerată: doar „activ chiar acum" mai punctează.
            score = 1.0 if days <= 0 else 0.0
        else:
            score = _clamp01(1.0 - days / BEHAVIOR_ACTIVITY_DECAY_DAYS)
    if verified:
        score = score + BEHAVIOR_VERIFIED_BONUS * (1.0 - score)
    return _clamp01(score)


def compute_compatibility(
    a: Profile,
    b: Profile,
    a_interests: set[str],
    b_interests: set[str],
    distance_km: float | None = None,
    behavior: float | None = None,
) -> int:
    """Scorul de compatibilitate 0–100 între profilurile `a` și `b` (TZ 4.6).

    Rămâne o funcție PURĂ (fără I/O): distanța reală se calculează în afară
    (`feed_service`, prin geocoding cache-uit) și se injectează aici ca
    `distance_km`. `None` ⇒ factorul de distanță ia valoarea neutră din config,
    deci apelanții care nu au geocoding (ex. lista de chat-uri) rămân valizi.

    `behavior` (∈ [0, 1]) e semnalul comportamental deja calculat de apelant cu
    `behavior_score` (recența activității + verificare). `None` ⇒ neutru 0.5,
    deci apelanții care nu au datele de activitate la îndemână (ex. lista de
    match-uri) rămân valizi și neschimbați numeric.

    Robust la câmpuri lipsă/None: fiecare factor se degradează la o valoare
    neutră sau placeholder documentat.
    """
    interests = _jaccard(_as_set(a_interests), _as_set(b_interests))
    status = _status_overlap(a, b)
    humor = _humor_similarity(a, b)
    distance = _distance_score(distance_km)
    languages = _languages_score(a, b)
    behavior = BEHAVIOR_NEUTRAL if behavior is None else _clamp01(behavior)

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

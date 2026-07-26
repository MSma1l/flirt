"""Unit teste pentru algoritmul de compatibilitate (funcție pură, fără DB)."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.models.profile import Profile
from app.services import compatibility as C
from app.services.compatibility import behavior_score, compute_compatibility


def _profile(**kw) -> Profile:
    """Construiește un Profile în memorie (fără DB) cu valori implicite sănătoase."""
    defaults = dict(
        name="X",
        birth_date=date(1990, 1, 1),
        gender="male",
        height_cm=180,
        city="Chișinău",
        languages=["ru", "ro"],
        dating_statuses=["serious"],
        humor_vector=None,
        photos=[],
    )
    defaults.update(kw)
    p = Profile()
    for k, v in defaults.items():
        setattr(p, k, v)
    return p


# --- Jaccard -----------------------------------------------------------------
def test_jaccard_both_empty_is_zero():
    assert C._jaccard(set(), set()) == 0.0


def test_jaccard_identical_is_one():
    assert C._jaccard({"a", "b"}, {"a", "b"}) == 1.0


def test_jaccard_partial_overlap():
    # |∩|=1, |∪|=3 → 1/3
    assert abs(C._jaccard({"a", "b"}, {"b", "c"}) - (1 / 3)) < 1e-9


def test_as_set_filters_none_and_blank():
    assert C._as_set(["a", None, "  ", "b"]) == {"a", "b"}
    assert C._as_set(None) == set()


# --- Factorul limbă (GATE) ---------------------------------------------------
def test_languages_gate_zero_when_no_common():
    a = _profile(languages=["ru"])
    b = _profile(languages=["en"])
    assert C._languages_score(a, b) == 0.0


def test_languages_score_proportional_to_smaller():
    a = _profile(languages=["ru", "ro", "en"])
    b = _profile(languages=["ru", "ro"])
    # 2 comune / min(3,2)=2 → 1.0
    assert C._languages_score(a, b) == 1.0


def test_languages_partial():
    a = _profile(languages=["ru", "en"])
    b = _profile(languages=["ru"])
    # 1 comună / min(2,1)=1 → 1.0
    assert C._languages_score(a, b) == 1.0


# --- Umor --------------------------------------------------------------------
def test_humor_missing_vector_is_neutral():
    a = _profile(humor_vector=None)
    b = _profile(humor_vector={"sarcasm": 1.0})
    assert C._humor_similarity(a, b) == C.NEUTRAL_HUMOR


def test_humor_no_common_keys_is_neutral():
    a = _profile(humor_vector={"dark": 1.0})
    b = _profile(humor_vector={"memes": 1.0})
    assert C._humor_similarity(a, b) == C.NEUTRAL_HUMOR


def test_humor_identical_vectors_cosine_one():
    v = {"sarcasm": 0.5, "memes": 0.5}
    a = _profile(humor_vector=dict(v))
    b = _profile(humor_vector=dict(v))
    assert abs(C._humor_similarity(a, b) - 1.0) < 1e-9


def test_humor_non_numeric_values_skipped_returns_neutral():
    a = _profile(humor_vector={"sarcasm": "nu-i numar"})
    b = _profile(humor_vector={"sarcasm": "nici asta"})
    # Toate valorile nevalide → na/nb = 0 → neutru.
    assert C._humor_similarity(a, b) == C.NEUTRAL_HUMOR


def test_humor_zero_vector_is_neutral():
    a = _profile(humor_vector={"sarcasm": 0.0})
    b = _profile(humor_vector={"sarcasm": 0.0})
    assert C._humor_similarity(a, b) == C.NEUTRAL_HUMOR


# --- Distanță ----------------------------------------------------------------
def test_distance_zero_km_is_max():
    assert C._distance_score(0.0) == 1.0


def test_distance_is_strictly_decreasing():
    """Regresie: vechiul scor binar dădea IDENTIC 0.4 la 127 km și la 1100 km."""
    decay = settings.compat_distance_decay_km
    near = C._distance_score(decay * 0.1)
    mid = C._distance_score(decay * 0.5)
    far = C._distance_score(decay * 0.9)
    assert near > mid > far
    assert mid == pytest.approx(0.5)


def test_distance_beyond_decay_is_zero():
    assert C._distance_score(settings.compat_distance_decay_km * 2) == 0.0


def test_distance_unknown_is_neutral():
    """Oraș negeocodabil: nu penalizăm și nu premiem — valoare neutră din config."""
    assert C._distance_score(None) == settings.compat_distance_neutral


# --- Status overlap ----------------------------------------------------------
def test_status_overlap_uses_jaccard():
    a = _profile(dating_statuses=["serious", "friendship"])
    b = _profile(dating_statuses=["serious"])
    # 1/2
    assert C._status_overlap(a, b) == 0.5


# --- Scor final --------------------------------------------------------------
def test_compute_score_in_range_and_int():
    a = _profile()
    b = _profile()
    score = compute_compatibility(a, b, {"sport"}, {"sport"})
    assert isinstance(score, int)
    assert 0 <= score <= 100


def test_compute_score_clamped_0_100():
    # Profiluri identice și maximizate → scor ridicat, dar ≤ 100.
    a = _profile(city="Chișinău", languages=["ru"], humor_vector={"x": 1.0})
    b = _profile(city="Chișinău", languages=["ru"], humor_vector={"x": 1.0})
    score = compute_compatibility(a, b, {"sport", "music"}, {"sport", "music"})
    assert 0 <= score <= 100


def test_compute_score_robust_to_none_fields():
    a = _profile(languages=None, dating_statuses=None, city=None, humor_vector=None)
    b = _profile(languages=None, dating_statuses=None, city=None, humor_vector=None)
    score = compute_compatibility(a, b, set(), set())
    assert 0 <= score <= 100


def test_language_gate_lowers_score():
    """Fără limbă comună, scorul e mai mic decât cu limbă comună (restul egal)."""
    common = compute_compatibility(
        _profile(languages=["ru"]), _profile(languages=["ru"]), {"sport"}, {"sport"}
    )
    no_common = compute_compatibility(
        _profile(languages=["ru"]), _profile(languages=["en"]), {"sport"}, {"sport"}
    )
    assert no_common < common


# --- Semnal comportamental (recența activității + verificare) -----------------
_NOW = datetime(2026, 7, 24, 12, 0, tzinfo=timezone.utc)


def test_behavior_none_last_active_is_neutral():
    """Fără date de activitate (rând legacy) → cădem elegant pe neutru 0.5."""
    assert behavior_score(None, now=_NOW) == C.BEHAVIOR_NEUTRAL


def test_behavior_recent_beats_stale():
    """Monoton în recență: activ acum > activ acum o săptămână > la limita decay."""
    fresh = behavior_score(_NOW, now=_NOW)
    week = behavior_score(_NOW - timedelta(days=7), now=_NOW)
    stale = behavior_score(
        _NOW - timedelta(days=C.BEHAVIOR_ACTIVITY_DECAY_DAYS), now=_NOW
    )
    assert fresh > week > stale
    assert fresh == pytest.approx(1.0)
    assert stale == pytest.approx(0.0)


def test_behavior_in_unit_interval_beyond_decay():
    """Peste orizontul de decay recența e 0, nu negativă (clamp)."""
    val = behavior_score(
        _NOW - timedelta(days=C.BEHAVIOR_ACTIVITY_DECAY_DAYS * 3), now=_NOW
    )
    assert val == pytest.approx(0.0)


def test_behavior_verified_pushes_up_without_exceeding_one():
    """Profil verificat împinge scorul spre 1, monoton și mărginit."""
    base = behavior_score(_NOW - timedelta(days=10), now=_NOW, verified=False)
    boosted = behavior_score(_NOW - timedelta(days=10), now=_NOW, verified=True)
    assert boosted > base
    assert boosted <= 1.0
    # Verificat pe un cont deja activ acum nu poate depăși 1.0.
    assert behavior_score(_NOW, now=_NOW, verified=True) == pytest.approx(1.0)


def test_behavior_naive_datetime_treated_as_utc():
    """Un `last_active_at` naiv (fără tz) nu aruncă, e interpretat ca UTC."""
    naive = _NOW.replace(tzinfo=None)
    assert behavior_score(naive, now=_NOW) == pytest.approx(1.0)


def test_compute_score_behavior_varies_with_activity():
    """Scorul final crește când ținta e activă recent (restul factorilor egal)."""
    a = _profile()
    b = _profile()
    active = compute_compatibility(
        a, b, {"sport"}, {"sport"}, behavior=behavior_score(_NOW, now=_NOW)
    )
    inactive = compute_compatibility(
        a,
        b,
        {"sport"},
        {"sport"},
        behavior=behavior_score(
            _NOW - timedelta(days=C.BEHAVIOR_ACTIVITY_DECAY_DAYS), now=_NOW
        ),
    )
    assert active > inactive


def test_compute_score_behavior_none_is_neutral_default():
    """`behavior=None` păstrează comportamentul numeric istoric (neutru 0.5)."""
    a = _profile()
    b = _profile()
    default = compute_compatibility(a, b, {"sport"}, {"sport"})
    explicit_neutral = compute_compatibility(
        a, b, {"sport"}, {"sport"}, behavior=C.BEHAVIOR_NEUTRAL
    )
    assert default == explicit_neutral

"""Unit teste pentru profile_service — validări anketă, poze, verify_face."""
from datetime import date

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.core.security import hash_password
from app.models.profile import Profile
from app.models.user import User
from app.schemas.profile import AnketaIn
from app.services import profile_service as PS

_ADULT_YEAR = date.today().year - 25


async def _make_user(db, email="p@example.com") -> User:
    user = User(email=email, password_hash=hash_password("Str0ng-Passw0rd!"))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


def _anketa(**kw) -> AnketaIn:
    base = dict(
        name="Ion",
        birth_date=date(_ADULT_YEAR, 1, 1),
        gender="male",
        height_cm=180,
        city="Chișinău",
        languages=["ru", "ro"],
        about="Salut.",
        dating_statuses=["serious"],
        interests=["sport", "travel"],
        photos=[],
    )
    base.update(kw)
    return AnketaIn(**base)


# --- Referință / seed --------------------------------------------------------
@pytest.mark.asyncio
async def test_seed_interests_is_idempotent(db_session):
    await PS.seed_interests(db_session)
    await PS.seed_interests(db_session)  # a doua oară nu dublează
    ref = await PS.get_reference(db_session)
    slugs = [i.slug for i in ref.interests]
    assert len(slugs) == len(set(slugs)) == len(PS.INTERESTS_CATALOG)


@pytest.mark.asyncio
async def test_get_profile_out_none_when_missing(db_session):
    user = await _make_user(db_session)
    assert await PS.get_profile_out(db_session, user) is None


# --- Upsert: succes ----------------------------------------------------------
@pytest.mark.asyncio
async def test_upsert_creates_then_updates(db_session):
    user = await _make_user(db_session)
    out = await PS.upsert_anketa(db_session, user, _anketa(name="Ion"))
    assert out.name == "Ion"
    assert out.completed is True
    # Anketa e completă, dar FĂRĂ poze → gate-ul de onboarding rămâne închis.
    # (vezi `test_profile_completed_*` mai jos pentru contractul complet)
    assert user.profile_completed is False
    assert set(out.interests) == {"sport", "travel"}

    # Update: schimbă numele + interesele (înlocuire completă M2M).
    out2 = await PS.upsert_anketa(
        db_session, user, _anketa(name="Ionel", interests=["music"])
    )
    assert out2.name == "Ionel"
    assert out2.interests == ["music"]


# --- Upsert: validări (422) --------------------------------------------------
@pytest.mark.asyncio
async def test_upsert_invalid_gender_422(db_session):
    user = await _make_user(db_session)
    with pytest.raises(HTTPException) as exc:
        await PS.upsert_anketa(db_session, user, _anketa(gender="dragon"))
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_upsert_underage_422(db_session):
    user = await _make_user(db_session)
    young = date.today().year - (settings.min_registration_age - 1)
    with pytest.raises(HTTPException) as exc:
        await PS.upsert_anketa(
            db_session, user, _anketa(birth_date=date(young, 1, 1))
        )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_upsert_no_language_422(db_session):
    user = await _make_user(db_session)
    with pytest.raises(HTTPException) as exc:
        await PS.upsert_anketa(db_session, user, _anketa(languages=["  ", ""]))
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_upsert_no_valid_interest_422(db_session):
    user = await _make_user(db_session)
    with pytest.raises(HTTPException) as exc:
        await PS.upsert_anketa(
            db_session, user, _anketa(interests=["inexistent-slug"])
        )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_upsert_invalid_statuses_filtered_out(db_session):
    """Statusurile necunoscute sunt filtrate, cele valide păstrate."""
    user = await _make_user(db_session)
    out = await PS.upsert_anketa(
        db_session, user, _anketa(dating_statuses=["serious", "bogus"])
    )
    assert out.dating_statuses == ["serious"]


# --- Poze --------------------------------------------------------------------
@pytest.mark.asyncio
async def test_add_photo_requires_profile_404(db_session):
    user = await _make_user(db_session)
    with pytest.raises(HTTPException) as exc:
        await PS.add_photo(
            db_session, user, filename="x.jpg", content=b"x",
            content_type="image/jpeg", url="https://cdn/x.jpg",
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_add_photo_and_max_limit(db_session):
    user = await _make_user(db_session)
    await PS.upsert_anketa(db_session, user, _anketa())

    # Adaugă până la max.
    for i in range(settings.max_photos):
        photos = await PS.add_photo(
            db_session, user, filename=f"{i}.jpg", content=b"x",
            content_type="image/jpeg", url=f"https://cdn/{i}.jpg",
        )
    assert len(photos) == settings.max_photos

    # Peste max → 422.
    with pytest.raises(HTTPException) as exc:
        await PS.add_photo(
            db_session, user, filename="over.jpg", content=b"x",
            content_type="image/jpeg", url="https://cdn/over.jpg",
        )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_remove_photo_missing_url_404(db_session):
    user = await _make_user(db_session)
    await PS.upsert_anketa(db_session, user, _anketa())
    with pytest.raises(HTTPException) as exc:
        await PS.remove_photo(db_session, user, "https://cdn/does-not-exist.jpg")
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_add_then_remove_photo(db_session):
    user = await _make_user(db_session)
    await PS.upsert_anketa(db_session, user, _anketa())
    await PS.add_photo(
        db_session, user, filename="a.jpg", content=b"x",
        content_type="image/jpeg", url="https://cdn/a.jpg",
    )
    left = await PS.remove_photo(db_session, user, "https://cdn/a.jpg")
    assert "https://cdn/a.jpg" not in left


@pytest.mark.asyncio
async def test_reorder_photos_wrong_set_422(db_session):
    user = await _make_user(db_session)
    await PS.upsert_anketa(db_session, user, _anketa())
    await PS.add_photo(
        db_session, user, filename="a.jpg", content=b"x",
        content_type="image/jpeg", url="https://cdn/a.jpg",
    )
    await PS.add_photo(
        db_session, user, filename="b.jpg", content=b"x",
        content_type="image/jpeg", url="https://cdn/b.jpg",
    )
    with pytest.raises(HTTPException) as exc:
        # Lipsește b, apare c → mulțime diferită.
        await PS.reorder_photos(db_session, user, ["https://cdn/a.jpg", "https://cdn/c.jpg"])
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_reorder_photos_ok(db_session):
    user = await _make_user(db_session)
    await PS.upsert_anketa(db_session, user, _anketa())
    await PS.add_photo(
        db_session, user, filename="a.jpg", content=b"x",
        content_type="image/jpeg", url="https://cdn/a.jpg",
    )
    await PS.add_photo(
        db_session, user, filename="b.jpg", content=b"x",
        content_type="image/jpeg", url="https://cdn/b.jpg",
    )
    new_order = await PS.reorder_photos(
        db_session, user, ["https://cdn/b.jpg", "https://cdn/a.jpg"]
    )
    assert new_order == ["https://cdn/b.jpg", "https://cdn/a.jpg"]


# --- verify_face -------------------------------------------------------------
@pytest.mark.asyncio
async def test_verify_face_requires_profile_404(db_session):
    user = await _make_user(db_session)
    with pytest.raises(HTTPException) as exc:
        await PS.verify_face(db_session, user, b"selfie-bytes")
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_verify_face_stub_sets_verified(db_session):
    user = await _make_user(db_session)
    await PS.upsert_anketa(db_session, user, _anketa())
    result = await PS.verify_face(db_session, user, b"selfie-bytes")
    # Providerul stub întoarce mereu (True, 99.0).
    assert result.verified is True
    assert result.similarity == 99.0
    # Persistat pe profil.
    out = await PS.get_profile_out(db_session, user)
    assert out.verified is True


# --- Gate de onboarding: profile_completed depinde de poze -------------------
# Regresie (audit UX): anketa se marca `profile_completed=True` NECONDIȚIONAT de
# poze. Dacă uploadul primei poze pica, la restart `hydrate()` citea adevărul de
# pe server și `AuthGuard` arunca userul în feed cu un profil fără nicio poză.
@pytest.mark.asyncio
async def test_profile_completed_false_without_photos(db_session):
    """(a) Anketă salvată fără poze → `profile_completed` rămâne False."""
    user = await _make_user(db_session, "gate-a@example.com")
    out = await PS.upsert_anketa(db_session, user, _anketa())
    assert out.completed is True  # anketa în sine e completă
    assert user.profile_completed is False  # dar gate-ul rămâne închis


@pytest.mark.asyncio
async def test_profile_completed_true_after_first_photo(db_session):
    """(b) După prima poză → `profile_completed` devine True."""
    user = await _make_user(db_session, "gate-b@example.com")
    await PS.upsert_anketa(db_session, user, _anketa())
    assert user.profile_completed is False

    await PS.add_photo(
        db_session, user, filename="a.jpg", content=b"x",
        content_type="image/jpeg", url="https://cdn/a.jpg",
    )
    assert user.profile_completed is True


@pytest.mark.asyncio
async def test_profile_completed_false_after_removing_last_photo(db_session):
    """(c) După ștergerea ULTIMEI poze → `profile_completed` redevine False."""
    user = await _make_user(db_session, "gate-c@example.com")
    await PS.upsert_anketa(db_session, user, _anketa())
    await PS.add_photo(
        db_session, user, filename="a.jpg", content=b"x",
        content_type="image/jpeg", url="https://cdn/a.jpg",
    )
    await PS.add_photo(
        db_session, user, filename="b.jpg", content=b"x",
        content_type="image/jpeg", url="https://cdn/b.jpg",
    )
    assert user.profile_completed is True

    # Mai rămâne o poză → peste prag, gate-ul stă deschis.
    await PS.remove_photo(db_session, user, "https://cdn/b.jpg")
    assert user.profile_completed is True

    # Ultima poză → sub prag, userul e trimis înapoi în onboarding.
    await PS.remove_photo(db_session, user, "https://cdn/a.jpg")
    assert user.profile_completed is False


@pytest.mark.asyncio
async def test_profile_completed_true_when_anketa_saved_with_photos(db_session):
    """(d) Anketă salvată de un user care are deja poze → True imediat."""
    user = await _make_user(db_session, "gate-d@example.com")
    await PS.upsert_anketa(db_session, user, _anketa())

    profile = await PS._get_profile_or_404(db_session, user)
    # URL în namespace-ul propriu — altfel `upsert_anketa` respinge poza (422).
    url = f"{settings.storage_base_url}/photos/{profile.id}/pic.jpg"
    await PS.add_photo(
        db_session, user, filename="pic.jpg", content=b"x",
        content_type="image/jpeg", url=url,
    )
    assert user.profile_completed is True

    # Re-salvarea anketei (cu pozele retrimise) NU închide gate-ul.
    out = await PS.upsert_anketa(db_session, user, _anketa(photos=[url]))
    assert out.photos == [url]
    assert user.profile_completed is True


@pytest.mark.asyncio
async def test_profile_completed_uses_min_photos_from_settings(db_session):
    """Pragul vine din `settings.min_photos`, nu dintr-o constantă hardcodată."""
    user = await _make_user(db_session, "gate-min@example.com")
    await PS.upsert_anketa(db_session, user, _anketa())
    profile = await PS._get_profile_or_404(db_session, user)

    # Sub prag → False; exact la prag → True, oricare ar fi valoarea din config.
    profile.photos = [f"https://cdn/{i}.jpg" for i in range(settings.min_photos - 1)]
    PS._sync_profile_completed(user, profile)
    assert user.profile_completed is False

    profile.photos = [f"https://cdn/{i}.jpg" for i in range(settings.min_photos)]
    PS._sync_profile_completed(user, profile)
    assert user.profile_completed is True

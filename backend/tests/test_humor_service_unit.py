"""Unit teste pentru humor_service — quiz, vector, submit, 404."""
from datetime import date

import pytest
from fastapi import HTTPException

from app.core.security import hash_password
from app.models.profile import Profile
from app.models.user import User
from app.schemas.humor import HumorAnswer
from app.services import humor_service as H

_ADULT_YEAR = date.today().year - 25


async def _make_user(db, email) -> User:
    user = User(email=email, password_hash=hash_password("Str0ng-Passw0rd!"))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_profile(db, user) -> None:
    db.add(
        Profile(
            user_id=user.id, name="A", birth_date=date(_ADULT_YEAR, 1, 1),
            gender="male", height_cm=180, city="Chișinău", languages=["ru"],
            dating_statuses=["serious"], photos=[],
        )
    )
    await db.commit()


def test_get_quiz_returns_all_types():
    cards = H.get_quiz()
    assert len(cards) == len(H.HUMOR_TYPES)
    assert {c.type for c in cards} == set(H.HUMOR_TYPES)


def test_build_vector_uniform_when_no_funny():
    answers = [HumorAnswer(card_id="c1", funny=False)]
    vector = H._build_vector(answers)
    assert abs(sum(vector.values()) - 1.0) < 1e-9
    # Toate egale.
    assert len(set(round(v, 6) for v in vector.values())) == 1


def test_build_vector_weighted_by_funny():
    answers = [
        HumorAnswer(card_id="c1", funny=True),   # sarcasm
        HumorAnswer(card_id="c2", funny=True),   # dark
        HumorAnswer(card_id="c3", funny=False),  # memes (ignorat)
    ]
    vector = H._build_vector(answers)
    assert abs(sum(vector.values()) - 1.0) < 1e-9
    assert vector["sarcasm"] == 0.5
    assert vector["dark"] == 0.5
    assert vector["memes"] == 0.0


def test_build_vector_ignores_unknown_card():
    answers = [HumorAnswer(card_id="does-not-exist", funny=True)]
    vector = H._build_vector(answers)
    # Niciun card cunoscut amuzant → uniform.
    assert abs(sum(vector.values()) - 1.0) < 1e-9


@pytest.mark.asyncio
async def test_submit_requires_profile_404(db_session):
    user = await _make_user(db_session, "h1@example.com")
    with pytest.raises(HTTPException) as exc:
        await H.submit_quiz(db_session, user, [HumorAnswer(card_id="c1", funny=True)])
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_submit_persists_vector(db_session):
    user = await _make_user(db_session, "h2@example.com")
    await _make_profile(db_session, user)
    out = await H.submit_quiz(
        db_session, user, [HumorAnswer(card_id="c1", funny=True)]
    )
    assert out.vector["sarcasm"] == 1.0

    got = await H.get_humor(db_session, user)
    assert got.vector["sarcasm"] == 1.0


@pytest.mark.asyncio
async def test_get_humor_empty_when_no_vector(db_session):
    user = await _make_user(db_session, "h3@example.com")
    await _make_profile(db_session, user)
    got = await H.get_humor(db_session, user)
    assert got.vector == {}


@pytest.mark.asyncio
async def test_get_humor_404_without_profile(db_session):
    user = await _make_user(db_session, "h4@example.com")
    with pytest.raises(HTTPException) as exc:
        await H.get_humor(db_session, user)
    assert exc.value.status_code == 404

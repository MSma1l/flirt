"""Unit teste pentru humor_service — quiz, vector, submit, 404, comutator."""
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


_TYPES_BY_KEY = {q["key"]: q["humor_type"] for q in H.DEFAULT_QUESTIONS}


@pytest.mark.asyncio
async def test_get_quiz_returns_all_types(db_session):
    """Seed-ul leneș (baza fără migrații) aduce cele 7 glume istorice."""
    cards = await H.get_quiz(db_session)
    assert len(cards) == len(H.HUMOR_TYPES)
    assert {c.type for c in cards} == set(H.HUMOR_TYPES)
    assert [c.id for c in cards] == [q["key"] for q in H.DEFAULT_QUESTIONS]


def test_build_vector_uniform_when_no_funny():
    answers = [HumorAnswer(card_id="c1", funny=False)]
    vector = H._build_vector(answers, _TYPES_BY_KEY)
    assert abs(sum(vector.values()) - 1.0) < 1e-9
    # Toate egale.
    assert len(set(round(v, 6) for v in vector.values())) == 1


def test_build_vector_weighted_by_funny():
    answers = [
        HumorAnswer(card_id="c1", funny=True),   # sarcasm
        HumorAnswer(card_id="c2", funny=True),   # dark
        HumorAnswer(card_id="c3", funny=False),  # memes (ignorat)
    ]
    vector = H._build_vector(answers, _TYPES_BY_KEY)
    assert abs(sum(vector.values()) - 1.0) < 1e-9
    assert vector["sarcasm"] == 0.5
    assert vector["dark"] == 0.5
    assert vector["memes"] == 0.0


def test_build_vector_ignores_unknown_card():
    answers = [HumorAnswer(card_id="does-not-exist", funny=True)]
    vector = H._build_vector(answers, _TYPES_BY_KEY)
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


@pytest.mark.asyncio
async def test_is_enabled_defaults_off_without_side_effects(db_session):
    """Rândul de setări lipsă = OPRIT, iar citirea nu creează nimic."""
    from app.models.humor import HumorSettings

    assert await H.is_enabled(db_session) is False
    assert await db_session.get(HumorSettings, H.SETTINGS_ID) is None


@pytest.mark.asyncio
async def test_submit_scores_answers_for_deleted_question_as_unknown(db_session):
    """O glumă ștearsă între timp nu crapă trimiterea: răspunsul e ignorat."""
    from sqlalchemy import select

    from app.models.humor import HumorQuestion

    user = await _make_user(db_session, "h5@example.com")
    await _make_profile(db_session, user)
    await H.get_quiz(db_session)  # seed
    q = await db_session.scalar(select(HumorQuestion).where(HumorQuestion.key == "c1"))
    await db_session.delete(q)
    await db_session.commit()

    out = await H.submit_quiz(
        db_session,
        user,
        [HumorAnswer(card_id="c1", funny=True), HumorAnswer(card_id="c2", funny=True)],
    )
    assert out.vector["dark"] == 1.0
    assert out.vector["sarcasm"] == 0.0

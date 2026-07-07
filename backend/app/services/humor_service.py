"""Logica Testului de umor (TZ 2.7).

Userul evaluează câteva glume scurte (funny / not funny). Din răspunsuri
construim un vector normalizat de ponderi pe cele 7 tipuri de umor și îl
salvăm în `Profile.humor_vector` (câmp JSON existent), de unde e citit de
`compatibility.py`.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profile import Profile
from app.models.user import User
from app.schemas.humor import HumorAnswer, HumorCard, HumorProfileOut

# --- Cele 7 tipuri de umor (TZ 2.7) — constante ------------------------------
HUMOR_TYPES: list[str] = [
    "sarcasm",
    "dark",
    "memes",
    "intellectual",
    "absurd",
    "wholesome",
    "physical",
]

# --- Cardurile quiz-ului — o glumă scurtă per tip ----------------------------
# Fiecare card are un `type` dintre HUMOR_TYPES; textele sunt scurte și neutre.
QUIZ_CARDS: list[HumorCard] = [
    HumorCard(
        id="c1",
        text="Oh, great, another Monday. Just what I always wished for.",
        type="sarcasm",
    ),
    HumorCard(
        id="c2",
        text="My plants and I have a lot in common: we both die a little inside.",
        type="dark",
    ),
    HumorCard(
        id="c3",
        text="Me pretending to work while the loading spinner does all the effort.",
        type="memes",
    ),
    HumorCard(
        id="c4",
        text="I told a chemistry joke, but there was no reaction.",
        type="intellectual",
    ),
    HumorCard(
        id="c5",
        text="A horse walks into a bar and orders a glass of water. That's it.",
        type="absurd",
    ),
    HumorCard(
        id="c6",
        text="A puppy tried to catch its own tail and fell asleep mid-spin.",
        type="wholesome",
    ),
    HumorCard(
        id="c7",
        text="He slipped on a banana peel — cartoon-style, arms flailing and all.",
        type="physical",
    ),
]

# Index rapid card_id -> tip, pentru scorare.
_CARD_TYPE_BY_ID: dict[str, str] = {card.id: card.type for card in QUIZ_CARDS}


def get_quiz() -> list[HumorCard]:
    """Întoarce cardurile quiz-ului de umor."""
    return list(QUIZ_CARDS)


def _build_vector(answers: list[HumorAnswer]) -> dict[str, float]:
    """Construiește vectorul normalizat de ponderi pe tip din răspunsuri.

    Numără câte `funny=True` per tip, apoi normalizează să sumeze ~1.0.
    Dacă niciun răspuns nu e amuzant → vector uniform pe cele 7 tipuri.
    """
    # Numărăm doar răspunsurile pozitive pentru carduri cunoscute.
    counts: dict[str, int] = {t: 0 for t in HUMOR_TYPES}
    for answer in answers:
        if not answer.funny:
            continue
        humor_type = _CARD_TYPE_BY_ID.get(answer.card_id)
        if humor_type is not None:
            counts[humor_type] += 1

    total = sum(counts.values())
    if total == 0:
        # Fără preferințe exprimate → distribuție uniformă.
        uniform = 1.0 / len(HUMOR_TYPES)
        return {t: uniform for t in HUMOR_TYPES}

    return {t: counts[t] / total for t in HUMOR_TYPES}


async def _load_profile(db: AsyncSession, user: User) -> Profile:
    """Încarcă profilul userului după user_id; 404 dacă lipsește."""
    result = await db.execute(select(Profile).where(Profile.user_id == user.id))
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Anketa nu există încă.",
        )
    return profile


async def submit_quiz(
    db: AsyncSession, user: User, answers: list[HumorAnswer]
) -> HumorProfileOut:
    """Calculează vectorul de umor și îl salvează în profilul userului."""
    profile = await _load_profile(db, user)
    vector = _build_vector(answers)
    profile.humor_vector = vector
    await db.commit()
    return HumorProfileOut(vector=vector)


async def get_humor(db: AsyncSession, user: User) -> HumorProfileOut:
    """Întoarce vectorul de umor curent (sau {} dacă lipsește)."""
    profile = await _load_profile(db, user)
    vector = profile.humor_vector if isinstance(profile.humor_vector, dict) else {}
    return HumorProfileOut(vector=vector)

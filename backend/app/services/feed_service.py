"""Logica feed-ului de swipe + match-uri (TZ secț. 4)."""
from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.account import Block, UserSettings
from app.models.interest import Interest, ProfileInterest
from app.models.profile import Profile
from app.models.swipe import Like, Match
from app.models.user import User
from app.schemas.feed import FeedCard, MatchOut, SwipeResult
from app.services import chat_service
from app.services.compatibility import compute_compatibility

# --- Reguli de business (din config, nu hardcodate în mijlocul logicii) ------
MAX_TOP_INTERESTS = 3   # câte interese afișăm pe cartelă (TZ 4.1)


def _calc_age(birth_date: date, today: date | None = None) -> int:
    """Vârsta în ani împliniți la `today` (implicit azi)."""
    today = today or date.today()
    return (
        today.year
        - birth_date.year
        - ((today.month, today.day) < (birth_date.month, birth_date.day))
    )


def _age_group(age: int) -> str:
    """Grupa de vârstă pentru separarea din feed (TZ 2.3): 'minor' vs 'adult'."""
    return "adult" if age >= settings.adult_age else "minor"


def _normalized_pair(x: uuid.UUID, y: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    """Ordonează perechea (mai mic, mai mare) după reprezentarea string a UUID."""
    return (x, y) if str(x) <= str(y) else (y, x)


async def _interests_by_profile(
    db: AsyncSession, profile_ids: list[uuid.UUID]
) -> dict[uuid.UUID, set[str]]:
    """Mapează profile_id -> set de slug-uri de interese, pentru multe profiluri."""
    if not profile_ids:
        return {}
    result = await db.execute(
        select(ProfileInterest.profile_id, Interest.slug)
        .join(Interest, Interest.id == ProfileInterest.interest_id)
        .where(ProfileInterest.profile_id.in_(profile_ids))
    )
    mapping: dict[uuid.UUID, set[str]] = {}
    for profile_id, slug in result.all():
        mapping.setdefault(profile_id, set()).add(slug)
    return mapping


def _has_common_language(a: Profile, b: Profile) -> bool:
    """True dacă cele două profiluri au cel puțin o limbă comună (gate TZ 4.6)."""
    la = {str(x) for x in (a.languages or []) if x}
    lb = {str(x) for x in (b.languages or []) if x}
    return bool(la & lb)


async def get_feed(
    db: AsyncSession, user: User, limit: int | None = None
) -> list[FeedCard]:
    """Feed-ul de candidate pentru `user`, sortat descrescător după compatibilitate.

    Candidate = profiluri `completed`, exclus userul curent și cei deja swipe-uiți,
    din aceeași grupă de vârstă (16–17 vs 18+, TZ 2.3). Sunt excluși userii
    blocați (în orice direcție, I1), cei cu profil ascuns (I2) și cei fără nicio
    limbă comună (gate dur, I3 / TZ 4.6).
    """
    # Limita implicită vine din config (fără hardcodare).
    if limit is None:
        limit = settings.feed_limit

    # Profilul propriu — fără el nu putem calcula compatibilitate.
    my_result = await db.execute(select(Profile).where(Profile.user_id == user.id))
    my_profile = my_result.scalar_one_or_none()
    if my_profile is None or not my_profile.completed:
        return []

    my_group = _age_group(_calc_age(my_profile.birth_date))

    # Userii deja swipe-uiți de mine (nu-i mai arăt).
    swiped_result = await db.execute(
        select(Like.to_user_id).where(Like.from_user_id == user.id)
    )
    swiped_ids = {row[0] for row in swiped_result.all()}

    # I1 — userii blocați în ORICE direcție (blocat de mine SAU care m-a blocat).
    blocked_result = await db.execute(
        select(Block.blocker_id, Block.blocked_id).where(
            or_(Block.blocker_id == user.id, Block.blocked_id == user.id)
        )
    )
    blocked_ids: set[uuid.UUID] = set()
    for blocker_id, blocked_id in blocked_result.all():
        blocked_ids.add(blocked_id if blocker_id == user.id else blocker_id)

    # I2 — userii cu profilul ascuns (UserSettings.profile_hidden = True).
    hidden_result = await db.execute(
        select(UserSettings.user_id).where(UserSettings.profile_hidden.is_(True))
    )
    hidden_ids = {row[0] for row in hidden_result.all()}

    # Candidate: profiluri completate, nu eu, nu swipe-uiți, nu blocați, nu ascunși.
    excluded = swiped_ids | blocked_ids | hidden_ids | {user.id}
    cand_result = await db.execute(
        select(Profile).where(
            Profile.completed.is_(True),
            Profile.user_id.notin_(excluded),
        )
    )
    candidates = list(cand_result.scalars().all())

    # Filtrare pe grupa de vârstă (calc din birth_date).
    candidates = [
        p for p in candidates if _age_group(_calc_age(p.birth_date)) == my_group
    ]
    # I3 — gate dur pe limbă: fără nicio limbă comună, candidatul e EXCLUS.
    candidates = [p for p in candidates if _has_common_language(my_profile, p)]
    if not candidates:
        return []

    # Interesele mele + ale candidaților (o singură interogare batch).
    profile_ids = [my_profile.id] + [p.id for p in candidates]
    interests_map = await _interests_by_profile(db, profile_ids)
    my_interests = interests_map.get(my_profile.id, set())

    # Calcul compatibilitate + construcție cartelă.
    cards: list[tuple[int, FeedCard]] = []
    for p in candidates:
        p_interests = interests_map.get(p.id, set())
        score = compute_compatibility(my_profile, p, my_interests, p_interests)
        card = FeedCard(
            user_id=p.user_id,
            name=p.name,
            age=_calc_age(p.birth_date),
            gender=p.gender,
            city=p.city,
            distance_km=None,  # fără geocoding încă (TZ 4.6 placeholder)
            about=p.about,
            top_interests=sorted(p_interests)[:MAX_TOP_INTERESTS],
            languages=list(p.languages or []),
            compatibility=score,
            photos=list(p.photos or []),
        )
        cards.append((score, card))

    # Sortare descrescătoare după compatibilitate, apoi tăiere la `limit`.
    cards.sort(key=lambda item: item[0], reverse=True)
    return [card for _, card in cards[: max(0, limit)]]


async def swipe(
    db: AsyncSession, user: User, target_user_id: uuid.UUID, action: str
) -> SwipeResult:
    """Înregistrează un swipe; creează Match dacă like-ul e reciproc (TZ 4.4/4.7)."""
    is_like = action == "like"

    # Upsert Like direcțional (from user -> target).
    existing_result = await db.execute(
        select(Like).where(
            Like.from_user_id == user.id,
            Like.to_user_id == target_user_id,
        )
    )
    like = existing_result.scalar_one_or_none()
    if like is None:
        like = Like(
            from_user_id=user.id, to_user_id=target_user_id, is_like=is_like
        )
        db.add(like)
    else:
        like.is_like = is_like

    # Fără like nu poate exista match.
    if not is_like:
        await db.commit()
        return SwipeResult(matched=False, match_id=None)

    # Verifică like-ul reciproc (target -> user).
    reciprocal_result = await db.execute(
        select(Like).where(
            Like.from_user_id == target_user_id,
            Like.to_user_id == user.id,
            Like.is_like.is_(True),
        )
    )
    reciprocal = reciprocal_result.scalar_one_or_none()
    if reciprocal is None:
        await db.commit()
        return SwipeResult(matched=False, match_id=None)

    # Match! Stocăm perechea normalizată (idempotent).
    a_id, b_id = _normalized_pair(user.id, target_user_id)
    match_result = await db.execute(
        select(Match).where(Match.user_a_id == a_id, Match.user_b_id == b_id)
    )
    match = match_result.scalar_one_or_none()
    if match is None:
        match = Match(user_a_id=a_id, user_b_id=b_id)
        db.add(match)
        await db.flush()

    # La producerea unui match asigurăm (idempotent) un chat pentru el, ca
    # dialogul să existe imediat (TZ 4.7/5.1). Refolosim logica din chat_service.
    chat = await chat_service.ensure_chat_for_match(db, match)

    await db.commit()
    return SwipeResult(matched=True, match_id=match.id, chat_id=chat.id)


async def get_matches(db: AsyncSession, user: User) -> list[MatchOut]:
    """Toate match-urile userului, cu datele celuilalt profil (TZ 4.7)."""
    result = await db.execute(
        select(Match).where(
            or_(Match.user_a_id == user.id, Match.user_b_id == user.id)
        )
    )
    matches = list(result.scalars().all())
    if not matches:
        return []

    # Profilul meu (pentru scorul de compatibilitate afișat).
    my_result = await db.execute(select(Profile).where(Profile.user_id == user.id))
    my_profile = my_result.scalar_one_or_none()

    # Id-urile "celuilalt" din fiecare match.
    other_ids: list[uuid.UUID] = []
    for m in matches:
        other = m.user_b_id if m.user_a_id == user.id else m.user_a_id
        other_ids.append(other)

    # Profilurile celorlalți, indexate după user_id.
    others_result = await db.execute(
        select(Profile).where(Profile.user_id.in_(other_ids))
    )
    profiles_by_user = {p.user_id: p for p in others_result.scalars().all()}

    # Interesele mele + ale celorlalți pentru scor.
    profile_ids = [p.id for p in profiles_by_user.values()]
    if my_profile is not None:
        profile_ids.append(my_profile.id)
    interests_map = await _interests_by_profile(db, profile_ids)
    my_interests = (
        interests_map.get(my_profile.id, set()) if my_profile is not None else set()
    )

    out: list[MatchOut] = []
    for m, other_id in zip(matches, other_ids):
        p = profiles_by_user.get(other_id)
        if p is None:
            continue  # profil șters/incomplet — sărim
        if my_profile is not None:
            score = compute_compatibility(
                my_profile, p, my_interests, interests_map.get(p.id, set())
            )
        else:
            score = 0
        out.append(
            MatchOut(
                match_id=m.id,
                user_id=p.user_id,
                name=p.name,
                age=_calc_age(p.birth_date),
                city=p.city,
                compatibility=score,
            )
        )
    return out

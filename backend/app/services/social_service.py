"""Latura socială a like-urilor: „cine ți-a dat ȚIE like" (TZ 4.7 / 6).

Simetricul lui `account_service.list_likes_sent/pending` (like-uri TRIMISE): aici
listăm like-urile PRIMITE la care userul curent ÎNCĂ nu a răspuns — inbox-ul de
cereri. Din el, userul deschide ancheta persoanei și răspunde cu `POST /feed/swipe`
(`action=like`), ceea ce produce match + chat, cu ambele mesaje deferred livrate.

Excluderile sunt ALINIATE cu feed-ul (nu inventăm reguli noi): profil completat cu
minim de poze, block în orice direcție, profil ascuns, cont banat / purjat GDPR.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.config import settings
from app.models.account import Block, UserSettings
from app.models.profile import Profile
from app.models.swipe import Like
from app.models.user import User
from app.schemas.social import LikeReceivedOut, LikeReceivedPage, ReceivedProfile
from app.services.contact_masker import mask_contacts
from app.services.pagination import (
    SOCIAL_MAX_LIMIT,
    SOCIAL_PAGE_LIMIT,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)


def _calc_age(birth_date: date, today: date | None = None) -> int:
    """Vârsta în ani împliniți la `today` (implicit azi)."""
    today = today or date.today()
    return (
        today.year
        - birth_date.year
        - ((today.month, today.day) < (birth_date.month, birth_date.day))
    )


async def list_likes_received(
    db: AsyncSession,
    user: User,
    limit: int | None = None,
    cursor: str | None = None,
) -> LikeReceivedPage:
    """Like-urile PRIMITE de user la care ÎNCĂ nu a răspuns (cele noi primele).

    Sursa e `likes` (swipe-ul altora spre MINE): rânduri `to_user_id = eu`,
    `is_like = True`. „Încă nu am răspuns" = NU există niciun swipe de-al meu spre
    autor (nici like reciproc — ar fi deja match și ar trece în chaturi —, nici
    dislike — l-aș fi respins). Diferența față de `list_likes_*` (care privesc
    like-urile MELE) e tocmai direcția și acest `NOT EXISTS` pe swipe-ul meu.

    Excluderi (aceleași ca feedul, `NOT EXISTS`/join pe index — fără N+1):
      - profil incomplet sau sub `min_photos` (fără card de randat / regula feed);
      - block în ORICE direcție (eu → el sau el → eu);
      - profil ascuns (`profile_hidden`);
      - cont banat (`users.banned_at`) sau purjat GDPR (`users.deleted_at`).

    Eficiență: profilurile vin în ACELAȘI scan (`JOIN Profile`), nu cu un al doilea
    query per rând — zero N+1. `message` = `deferred_message`-ul autorului, MASCAT
    de contacte (TZ 5.5) înainte de a ajunge la destinatar.

    Ordine + paginare: cursor peste `(created_at, id)` al like-ului, cele mai
    recente primele — identic cu `list_likes_sent/pending`. `is_super` e expus ca
    flag (badge/sortare pe client), dar ordinea pe server rămâne strict pe dată, ca
    monotonicitatea cursorului să nu se rupă.
    """
    limit = clamp_limit(limit, SOCIAL_PAGE_LIMIT, SOCIAL_MAX_LIMIT)

    # Block în orice direcție (semi-join pe index), ca în feed / like-urile trimise.
    not_blocked = ~(
        select(Block.id)
        .where(
            or_(
                and_(
                    Block.blocker_id == user.id,
                    Block.blocked_id == Like.from_user_id,
                ),
                and_(
                    Block.blocker_id == Like.from_user_id,
                    Block.blocked_id == user.id,
                ),
            )
        )
        .exists()
    )

    # „Încă nu am răspuns": niciun swipe de-al meu spre autor (ORICE `is_like`).
    # Îl aliasăm (`MyResponse`) — e tot `likes`, dar rândul MEU spre el, corelat pe
    # `uq_like_pair` (`from_user_id, to_user_id`), deci lovește indexul. Dacă
    # EXISTĂ (like reciproc = deja match, sau dislike = respins), rândul e EXCLUS.
    MyResponse = aliased(Like)
    no_response_from_me = ~(
        select(MyResponse.id)
        .where(
            MyResponse.from_user_id == user.id,
            MyResponse.to_user_id == Like.from_user_id,
        )
        .exists()
    )

    # Profil ascuns al autorului ⇒ nu apare (semi-join pe index).
    not_hidden = ~(
        select(UserSettings.id)
        .where(
            UserSettings.user_id == Like.from_user_id,
            UserSettings.profile_hidden.is_(True),
        )
        .exists()
    )

    stmt = (
        select(Like, Profile)
        .join(Profile, Profile.user_id == Like.from_user_id)
        .join(User, User.id == Like.from_user_id)
        .where(
            Like.to_user_id == user.id,
            Like.is_like.is_(True),
            Profile.completed.is_(True),
            User.deleted_at.is_(None),
            User.banned_at.is_(None),
            not_blocked,
            no_response_from_me,
            not_hidden,
        )
    )

    # Minim de poze — gate dur al feedului (un profil gol nu are card de randat).
    # `min_photos <= 0` (config) = poartă dezactivată. `json_array_length` există
    # și pe Postgres, și pe SQLite (JSON1); NULL (rând legacy) ⇒ exclus.
    if settings.min_photos > 0:
        stmt = stmt.where(
            func.json_array_length(Profile.photos) >= settings.min_photos
        )

    if cursor:
        anchor_id = decode_cursor(cursor)
        # Momentul rândului-ancoră, citit DB-side (vezi pagination.py).
        anchor_at = (
            select(Like.created_at)
            .where(Like.id == anchor_id, Like.to_user_id == user.id)
            .scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                Like.created_at < anchor_at,
                and_(Like.created_at == anchor_at, Like.id < anchor_id),
            )
        )

    result = await db.execute(
        stmt.order_by(Like.created_at.desc(), Like.id.desc()).limit(limit + 1)
    )
    rows = list(result.all())

    has_more = len(rows) > limit
    rows = rows[:limit]
    if not rows:
        return LikeReceivedPage(items=[], next_cursor=None)

    items: list[LikeReceivedOut] = []
    for like, p in rows:
        # Mesajul autorului, MASCAT de contacte înainte de a ajunge la destinatar
        # (TZ 5.5) — la fel ca la livrarea în chat (`feed_service`).
        message = None
        if like.deferred_message:
            message, _ = mask_contacts(like.deferred_message)
        items.append(
            LikeReceivedOut(
                user_id=like.from_user_id,
                is_super=like.is_super,
                message=message,
                created_at=like.created_at,
                profile=ReceivedProfile(
                    name=p.name,
                    age=_calc_age(p.birth_date),
                    gender=p.gender,
                    city=p.city,
                    about=p.about,
                    photos=list(p.photos or []),
                    languages=list(p.languages or []),
                ),
            )
        )

    return LikeReceivedPage(
        items=items,
        next_cursor=encode_cursor(rows[-1][0].id) if has_more else None,
    )

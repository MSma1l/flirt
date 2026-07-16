"""Logica modulului Stories (TZ secț. 11).

Poveștile expiră la 24h. Sunt vizibile autorului și utilizatorilor cu care
are Match. Cele expirate sunt mereu filtrate.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.profile import Profile
from app.models.story import Story
from app.models.swipe import Match
from app.models.user import User
from app.schemas.story import (
    StoryIn,
    StoryOut,
    StoryPage,
    UserStories,
    UserStoriesPage,
)
from app.services.pagination import (
    STORIES_MAX_LIMIT,
    STORIES_PAGE_LIMIT,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)


def _to_story_out(story: Story) -> StoryOut:
    return StoryOut(
        id=story.id,
        user_id=story.user_id,
        media_url=story.media_url,
        media_type=story.media_type,
        caption=story.caption,
        created_at=story.created_at,
        expires_at=story.expires_at,
    )


async def create_story(db: AsyncSession, user: User, data: StoryIn) -> StoryOut:
    """Creează o poveste FOTO care expiră peste 24h; video → 422.

    Story-urile noi sunt doar poze: uploadul de video e refuzat în endpoint, iar aici
    închidem și a doua cale (`media_type='video'` cu un `media_url` arbitrar). Motivul
    e același — un video nu poate fi moderat automat (Apple Guideline 1.2), spre
    deosebire de poze, care trec prin `photo_moderation`.
    `media_type='video'` rămâne valid în schemă doar pentru poveștile deja existente
    în baza de date, ca vizualizatorul să le poată reda până expiră.
    """
    if data.media_type != "image":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Story-urile acceptă doar fotografii.",
        )

    # Durata de viață a poveștii vine din config (TZ secț. 11), fără hardcodare.
    story = Story(
        user_id=user.id,
        media_url=data.media_url,
        media_type=data.media_type,
        caption=data.caption,
        expires_at=datetime.now(timezone.utc)
        + timedelta(hours=settings.story_ttl_hours),
    )
    db.add(story)
    await db.commit()
    await db.refresh(story)
    return _to_story_out(story)


async def _match_user_ids(db: AsyncSession, user: User) -> set[uuid.UUID]:
    """Id-urile utilizatorilor cu care userul curent are Match."""
    result = await db.execute(
        select(Match).where(
            or_(Match.user_a_id == user.id, Match.user_b_id == user.id)
        )
    )
    ids: set[uuid.UUID] = set()
    for m in result.scalars().all():
        ids.add(m.user_b_id if m.user_a_id == user.id else m.user_a_id)
    return ids


async def list_active_grouped(
    db: AsyncSession,
    user: User,
    limit: int | None = None,
    cursor: str | None = None,
) -> UserStoriesPage:
    """Poveștile active proprii + ale match-urilor, grupate pe user (paginat).

    Sortare (neschimbată): userul curent primul, apoi ceilalți după cea mai
    recentă poveste, desc.

    Înainte încărca TOATE poveștile active ale TUTUROR match-urilor, fără nicio
    limită. Acum paginăm la nivel de USER (cursorul e ancorat de ultimul grup
    redat), deci un grup nu se rupe între pagini și un user nu poate apărea de
    două ori. Numărul de query-uri e constant (4), indiferent de câte grupuri.
    """
    now = datetime.now(timezone.utc)
    limit = clamp_limit(limit, STORIES_PAGE_LIMIT, STORIES_MAX_LIMIT)
    visible_ids = {user.id} | await _match_user_ids(db, user)

    # Cheia de sortare a unui GRUP: (userul curent primul, cea mai recentă
    # poveste desc, user_id desc — tiebreak determinist).
    me_first = case((Story.user_id == user.id, 0), else_=1)
    last_at = func.max(Story.created_at)

    groups_stmt = (
        select(Story.user_id, last_at.label("last_at"))
        .where(Story.user_id.in_(visible_ids), Story.expires_at > now)
        .group_by(Story.user_id)
    )

    if cursor:
        anchor_uid = decode_cursor(cursor)
        if anchor_uid == user.id:
            # Grupul propriu e mereu primul → după el vin exact toți ceilalți.
            groups_stmt = groups_stmt.where(Story.user_id != user.id)
        else:
            # Momentul ultimei povești a grupului-ancoră, citit DB-side.
            anchor_at = (
                select(func.max(Story.created_at))
                .where(Story.user_id == anchor_uid, Story.expires_at > now)
                .scalar_subquery()
            )
            groups_stmt = groups_stmt.where(Story.user_id != user.id).having(
                or_(
                    last_at < anchor_at,
                    and_(last_at == anchor_at, Story.user_id < anchor_uid),
                )
            )

    groups_result = await db.execute(
        groups_stmt.order_by(me_first, last_at.desc(), Story.user_id.desc()).limit(
            limit + 1
        )
    )
    group_rows = list(groups_result.all())

    has_more = len(group_rows) > limit
    group_rows = group_rows[:limit]
    if not group_rows:
        return UserStoriesPage(items=[], next_cursor=None)

    ordered_ids = [row.user_id for row in group_rows]
    next_cursor = encode_cursor(ordered_ids[-1]) if has_more else None

    # Poveștile grupurilor din PAGINA curentă (o singură interogare).
    stories_result = await db.execute(
        select(Story)
        .where(Story.user_id.in_(ordered_ids), Story.expires_at > now)
        .order_by(Story.created_at.desc(), Story.id.desc())
    )
    grouped: dict[uuid.UUID, list[Story]] = {}
    for story in stories_result.scalars().all():
        grouped.setdefault(story.user_id, []).append(story)

    names = await _display_names(db, set(ordered_ids))

    return UserStoriesPage(
        items=[
            UserStories(
                user_id=uid,
                name=names.get(uid, ""),
                story_count=len(grouped.get(uid, [])),
                stories=[_to_story_out(s) for s in grouped.get(uid, [])],
            )
            for uid in ordered_ids
        ],
        next_cursor=next_cursor,
    )


async def list_mine(
    db: AsyncSession,
    user: User,
    limit: int | None = None,
    cursor: str | None = None,
) -> StoryPage:
    """Poveștile active proprii, cea mai recentă prima (paginat pe cursor)."""
    now = datetime.now(timezone.utc)
    limit = clamp_limit(limit, STORIES_PAGE_LIMIT, STORIES_MAX_LIMIT)

    stmt = select(Story).where(Story.user_id == user.id, Story.expires_at > now)
    if cursor:
        anchor_id = decode_cursor(cursor)
        # Momentul poveștii-ancoră, citit DB-side (vezi pagination.py).
        anchor_at = (
            select(Story.created_at)
            .where(Story.id == anchor_id, Story.user_id == user.id)
            .scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                Story.created_at < anchor_at,
                and_(Story.created_at == anchor_at, Story.id < anchor_id),
            )
        )

    # Ordonare TOTALĂ (created_at, id) → fără duplicate / fără povești sărite.
    result = await db.execute(
        stmt.order_by(Story.created_at.desc(), Story.id.desc()).limit(limit + 1)
    )
    rows = list(result.scalars().all())

    has_more = len(rows) > limit
    rows = rows[:limit]
    return StoryPage(
        items=[_to_story_out(s) for s in rows],
        next_cursor=encode_cursor(rows[-1].id) if (has_more and rows) else None,
    )


async def delete_story(db: AsyncSession, user: User, story_id: uuid.UUID) -> None:
    """Șterge o poveste proprie. 404 dacă lipsește, 403 dacă e a altcuiva."""
    story = await db.get(Story, story_id)
    if story is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Story not found"
        )
    if story.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not your story"
        )
    await db.delete(story)
    await db.commit()


async def _display_names(
    db: AsyncSession, user_ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """Numele de afișare (din Profile) pentru un set de useri."""
    if not user_ids:
        return {}
    result = await db.execute(
        select(Profile.user_id, Profile.name).where(Profile.user_id.in_(user_ids))
    )
    return {uid: name for uid, name in result.all()}

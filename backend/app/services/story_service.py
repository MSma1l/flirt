"""Logica modulului Stories (TZ secț. 11).

Poveștile expiră la 24h. Sunt vizibile autorului și utilizatorilor cu care
are Match. Cele expirate sunt mereu filtrate.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.profile import Profile
from app.models.story import Story
from app.models.swipe import Match
from app.models.user import User
from app.schemas.story import StoryIn, StoryOut, UserStories


def _to_story_out(story: Story) -> StoryOut:
    return StoryOut(
        id=story.id,
        user_id=story.user_id,
        media_url=story.media_url,
        caption=story.caption,
        created_at=story.created_at,
        expires_at=story.expires_at,
    )


async def create_story(db: AsyncSession, user: User, data: StoryIn) -> StoryOut:
    """Creează o poveste care expiră peste 24h."""
    # Durata de viață a poveștii vine din config (TZ secț. 11), fără hardcodare.
    story = Story(
        user_id=user.id,
        media_url=data.media_url,
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


async def list_active_grouped(db: AsyncSession, user: User) -> list[UserStories]:
    """Poveștile active proprii + ale match-urilor, grupate pe user.

    Sortare: userul curent primul, apoi ceilalți după cea mai recentă poveste.
    """
    now = datetime.now(timezone.utc)
    visible_ids = {user.id} | await _match_user_ids(db, user)

    result = await db.execute(
        select(Story)
        .where(Story.user_id.in_(visible_ids), Story.expires_at > now)
        .order_by(Story.created_at.desc())
    )
    stories = list(result.scalars().all())
    if not stories:
        return []

    # Numele de afișare din Profile pentru userii implicați.
    names = await _display_names(db, {s.user_id for s in stories})

    # Grupăm păstrând ordinea desc după created_at (cel mai recent primul).
    grouped: dict[uuid.UUID, list[Story]] = {}
    for story in stories:
        grouped.setdefault(story.user_id, []).append(story)

    def _sort_key(uid: uuid.UUID) -> tuple:
        # Userul curent primul; apoi după cea mai recentă poveste, desc.
        latest = grouped[uid][0].created_at
        return (0 if uid == user.id else 1, -latest.timestamp())

    ordered_ids = sorted(grouped.keys(), key=_sort_key)
    return [
        UserStories(
            user_id=uid,
            name=names.get(uid, ""),
            story_count=len(grouped[uid]),
            stories=[_to_story_out(s) for s in grouped[uid]],
        )
        for uid in ordered_ids
    ]


async def list_mine(db: AsyncSession, user: User) -> list[StoryOut]:
    """Poveștile active proprii, cea mai recentă prima."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(Story)
        .where(Story.user_id == user.id, Story.expires_at > now)
        .order_by(Story.created_at.desc())
    )
    return [_to_story_out(s) for s in result.scalars().all()]


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

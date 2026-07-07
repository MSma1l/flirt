"""Rute Stories — sub prefixul /api/v1/stories (TZ secț. 11).

`/mine` e declarat înaintea rutelor parametrizate. Poveștile expiră la 24h și
sunt vizibile autorului + utilizatorilor cu care are Match.
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.story import StoryIn, StoryOut, UserStories
from app.services import story_service

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.post("/", response_model=StoryOut, status_code=status.HTTP_201_CREATED)
async def create_story(data: StoryIn, db: DbDep, user: UserDep) -> StoryOut:
    """Publică o poveste care expiră peste 24h (protejat)."""
    return await story_service.create_story(db, user, data)


@router.get("/", response_model=list[UserStories])
async def list_stories(db: DbDep, user: UserDep) -> list[UserStories]:
    """Poveștile active proprii + ale match-urilor, grupate pe user (protejat)."""
    return await story_service.list_active_grouped(db, user)


@router.get("/mine", response_model=list[StoryOut])
async def list_mine(db: DbDep, user: UserDep) -> list[StoryOut]:
    """Poveștile active proprii (protejat)."""
    return await story_service.list_mine(db, user)


@router.delete("/{story_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_story(story_id: uuid.UUID, db: DbDep, user: UserDep) -> None:
    """Șterge o poveste proprie; 403/404 altfel (protejat)."""
    await story_service.delete_story(db, user, story_id)

"""Rute Stories — sub prefixul /api/v1/stories (TZ secț. 11).

`/mine` e declarat înaintea rutelor parametrizate. Poveștile expiră la 24h și
sunt vizibile autorului + utilizatorilor cu care are Match.
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.story import StoryIn, StoryOut, UserStories
from app.services import story_service
from app.services.pagination import MAX_CURSOR_LENGTH, STORIES_MAX_LIMIT

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]

LimitQuery = Annotated[int | None, Query(ge=1, le=STORIES_MAX_LIMIT)]
CursorQuery = Annotated[str | None, Query(max_length=MAX_CURSOR_LENGTH)]


@router.post("/", response_model=StoryOut, status_code=status.HTTP_201_CREATED)
async def create_story(data: StoryIn, db: DbDep, user: UserDep) -> StoryOut:
    """Publică o poveste care expiră peste 24h (protejat)."""
    return await story_service.create_story(db, user, data)


@router.get("/", response_model=list[UserStories])
async def list_stories(
    db: DbDep,
    user: UserDep,
    response: Response,
    limit: LimitQuery = None,
    cursor: CursorQuery = None,
) -> list[UserStories]:
    """Poveștile active proprii + ale match-urilor, grupate pe user (protejat).

    Paginare pe cursor la nivel de USER (convenția `/feed`): cursorul paginii
    următoare vine în header-ul `X-Next-Cursor`.
    """
    page = await story_service.list_active_grouped(
        db, user, limit=limit, cursor=cursor
    )
    if page.next_cursor:
        response.headers["X-Next-Cursor"] = page.next_cursor
    return page.items


@router.get("/mine", response_model=list[StoryOut])
async def list_mine(
    db: DbDep,
    user: UserDep,
    response: Response,
    limit: LimitQuery = None,
    cursor: CursorQuery = None,
) -> list[StoryOut]:
    """Poveștile active proprii (protejat), paginate pe cursor."""
    page = await story_service.list_mine(db, user, limit=limit, cursor=cursor)
    if page.next_cursor:
        response.headers["X-Next-Cursor"] = page.next_cursor
    return page.items


@router.delete("/{story_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_story(story_id: uuid.UUID, db: DbDep, user: UserDep) -> None:
    """Șterge o poveste proprie; 403/404 altfel (protejat)."""
    await story_service.delete_story(db, user, story_id)

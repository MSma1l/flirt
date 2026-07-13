"""Rute de chat — montate sub /api/v1/chats (TZ secț. 5). Toate protejate."""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.chat import ChatSummary, MessageIn, MessageOut, ReactionIn
from app.services import chat_service
from app.services.pagination import MAX_CURSOR_LENGTH, MESSAGES_MAX_LIMIT

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.get("/", response_model=list[ChatSummary])
async def list_chats(db: DbDep, user: UserDep) -> list[ChatSummary]:
    """Lista dialogurilor userului curent (TZ 5.1)."""
    return await chat_service.list_chats(db, user)


@router.get("/{chat_id}/messages", response_model=list[MessageOut])
async def get_messages(
    chat_id: uuid.UUID,
    db: DbDep,
    user: UserDep,
    response: Response,
    limit: Annotated[int | None, Query(ge=1, le=MESSAGES_MAX_LIMIT)] = None,
    cursor: Annotated[str | None, Query(max_length=MAX_CURSOR_LENGTH)] = None,
) -> list[MessageOut]:
    """O pagină de mesaje dintr-un chat — cele mai NOI prima dată (TZ 5.2).

    Paginare pe cursor (aceeași convenție ca `/feed`): dacă mai există istoric,
    cursorul paginii mai VECHI e întors în header-ul `X-Next-Cursor`; trimite-l
    înapoi ca `?cursor=…`. Corpul rămâne o listă de `MessageOut`, în ordine
    cronologică crescătoare.

    NU marchează mesajele ca citite — un GET nu mută stare. Folosește
    `POST /chats/{chat_id}/read`.
    """
    page = await chat_service.get_messages(
        db, user, chat_id, limit=limit, cursor=cursor
    )
    if page.next_cursor:
        response.headers["X-Next-Cursor"] = page.next_cursor
    return page.items


@router.post(
    "/{chat_id}/messages",
    response_model=MessageOut,
    status_code=status.HTTP_201_CREATED,
)
async def send_message(
    chat_id: uuid.UUID, data: MessageIn, db: DbDep, user: UserDep
) -> MessageOut:
    """Trimite un mesaj (contactele sunt mascate automat, TZ 5.5)."""
    return await chat_service.send_message(db, user, chat_id, data.body)


@router.post("/{chat_id}/messages/{message_id}/react", response_model=MessageOut)
async def react_to_message(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    data: ReactionIn,
    db: DbDep,
    user: UserDep,
) -> MessageOut:
    """Reacționează la un mesaj (emoji); reaction=None scoate reacția (TZ 5.2)."""
    return await chat_service.react_to_message(
        db, user, chat_id, message_id, data.reaction
    )


@router.post("/{chat_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(chat_id: uuid.UUID, db: DbDep, user: UserDep) -> None:
    """Marchează citite mesajele primite din chat."""
    await chat_service.mark_read(db, user, chat_id)

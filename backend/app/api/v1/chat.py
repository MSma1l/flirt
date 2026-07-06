"""Rute de chat — montate sub /api/v1/chats (TZ secț. 5). Toate protejate."""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.chat import ChatSummary, MessageIn, MessageOut
from app.services import chat_service

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.get("/", response_model=list[ChatSummary])
async def list_chats(db: DbDep, user: UserDep) -> list[ChatSummary]:
    """Lista dialogurilor userului curent (TZ 5.1)."""
    return await chat_service.list_chats(db, user)


@router.get("/{chat_id}/messages", response_model=list[MessageOut])
async def get_messages(
    chat_id: uuid.UUID, db: DbDep, user: UserDep
) -> list[MessageOut]:
    """Mesajele unui chat; marchează primite ca citite (TZ 5.2)."""
    return await chat_service.get_messages(db, user, chat_id)


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


@router.post("/{chat_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(chat_id: uuid.UUID, db: DbDep, user: UserDep) -> None:
    """Marchează citite mesajele primite din chat."""
    await chat_service.mark_read(db, user, chat_id)

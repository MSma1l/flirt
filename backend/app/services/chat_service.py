"""Logica de chat: dialoguri per match, mesaje, mascare contacte (TZ secț. 5)."""
from __future__ import annotations

import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import Chat, Message
from app.models.profile import Profile
from app.models.swipe import Match
from app.models.user import User
from app.schemas.chat import ChatSummary, MessageOut
from app.services.contact_masker import mask_contacts


def _calc_age(birth_date: date, today: date | None = None) -> int:
    """Vârsta în ani împliniți la `today` (implicit azi)."""
    today = today or date.today()
    return (
        today.year
        - birth_date.year
        - ((today.month, today.day) < (birth_date.month, birth_date.day))
    )


def _other_id(chat: Chat, user_id: uuid.UUID) -> uuid.UUID:
    """Id-ul celuilalt participant din chat."""
    return chat.user_b_id if chat.user_a_id == user_id else chat.user_a_id


async def _ensure_chat_for_match(db: AsyncSession, match: Match) -> Chat:
    """Întoarce chat-ul match-ului, creându-l idempotent dacă lipsește."""
    result = await db.execute(select(Chat).where(Chat.match_id == match.id))
    chat = result.scalar_one_or_none()
    if chat is None:
        chat = Chat(
            match_id=match.id,
            user_a_id=match.user_a_id,
            user_b_id=match.user_b_id,
        )
        db.add(chat)
        await db.flush()  # avem nevoie de chat.id înainte de commit
    return chat


async def _get_participant_chat(
    db: AsyncSession, user: User, chat_id: uuid.UUID
) -> Chat:
    """Încarcă chat-ul verificând că `user` e participant; altfel 404."""
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if chat is None or user.id not in (chat.user_a_id, chat.user_b_id):
        # Nu divulgăm existența unui chat străin → 404.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found"
        )
    return chat


async def list_chats(db: AsyncSession, user: User) -> list[ChatSummary]:
    """Lista dialogurilor userului (TZ 5.1).

    Pentru fiecare match care îl conține pe user asigură un chat (idempotent),
    apoi compune rezumatul cu datele celuilalt + ultimul mesaj + necitite.
    """
    # Toate match-urile userului.
    matches_result = await db.execute(
        select(Match).where(
            or_(Match.user_a_id == user.id, Match.user_b_id == user.id)
        )
    )
    matches = list(matches_result.scalars().all())
    if not matches:
        return []

    # Asigură câte un chat per match (creează cele lipsă).
    chats: list[Chat] = []
    for match in matches:
        chats.append(await _ensure_chat_for_match(db, match))
    await db.commit()

    # Profilurile celorlalți participanți, indexate după user_id.
    other_ids = [_other_id(c, user.id) for c in chats]
    profiles_result = await db.execute(
        select(Profile).where(Profile.user_id.in_(other_ids))
    )
    profiles_by_user = {p.user_id: p for p in profiles_result.scalars().all()}

    summaries: list[ChatSummary] = []
    for chat in chats:
        other_id = _other_id(chat, user.id)
        profile = profiles_by_user.get(other_id)

        # Ultimul mesaj din chat (după created_at).
        last_result = await db.execute(
            select(Message)
            .where(Message.chat_id == chat.id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        last_msg = last_result.scalar_one_or_none()

        # Necitite = mesaje primite de la celălalt, nemarcate citite.
        unread_result = await db.execute(
            select(func.count())
            .select_from(Message)
            .where(
                Message.chat_id == chat.id,
                Message.sender_id != user.id,
                Message.is_read.is_(False),
            )
        )
        unread_count = int(unread_result.scalar_one())

        summaries.append(
            ChatSummary(
                chat_id=chat.id,
                other_user_id=other_id,
                other_name=profile.name if profile else "",
                other_age=_calc_age(profile.birth_date) if profile else None,
                other_city=profile.city if profile else None,
                last_message=last_msg.body if last_msg else None,
                last_message_at=last_msg.created_at if last_msg else None,
                unread_count=unread_count,
            )
        )

    # Cele mai recente dialoguri primele (ultimul mesaj / creare chat).
    summaries.sort(
        key=lambda s: (s.last_message_at is not None, s.last_message_at),
        reverse=True,
    )
    return summaries


async def get_messages(
    db: AsyncSession, user: User, chat_id: uuid.UUID
) -> list[MessageOut]:
    """Mesajele unui chat, ordonate cronologic; marchează primite ca citite."""
    chat = await _get_participant_chat(db, user, chat_id)

    # Marchează citite mesajele primite (de la celălalt).
    await _mark_read(db, chat, user)

    result = await db.execute(
        select(Message)
        .where(Message.chat_id == chat.id)
        .order_by(Message.created_at.asc(), Message.id.asc())
    )
    messages = list(result.scalars().all())
    return [MessageOut.model_validate(m) for m in messages]


async def send_message(
    db: AsyncSession, user: User, chat_id: uuid.UUID, body: str
) -> MessageOut:
    """Trimite un mesaj: aplică mascarea contactelor și persistă (TZ 5.5)."""
    chat = await _get_participant_chat(db, user, chat_id)

    masked_body, was_masked = mask_contacts(body)
    message = Message(
        chat_id=chat.id,
        sender_id=user.id,
        body=masked_body,
        was_masked=was_masked,
        is_read=False,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    return MessageOut.model_validate(message)


async def mark_read(db: AsyncSession, user: User, chat_id: uuid.UUID) -> None:
    """Marchează citite toate mesajele primite din chat (endpoint dedicat)."""
    chat = await _get_participant_chat(db, user, chat_id)
    await _mark_read(db, chat, user)


async def _mark_read(db: AsyncSession, chat: Chat, user: User) -> None:
    """Setează `is_read=True` pe mesajele primite de la celălalt participant."""
    result = await db.execute(
        select(Message).where(
            Message.chat_id == chat.id,
            Message.sender_id != user.id,
            Message.is_read.is_(False),
        )
    )
    changed = False
    for message in result.scalars().all():
        message.is_read = True
        changed = True
    if changed:
        await db.commit()

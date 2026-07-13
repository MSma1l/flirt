"""Logica de chat: dialoguri per match, mesaje, mascare contacte (TZ secț. 5)."""
from __future__ import annotations

import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Block
from app.models.chat import Chat, Message
from app.models.interest import Interest, ProfileInterest
from app.models.profile import Profile
from app.models.swipe import Match
from app.models.user import User
from app.schemas.chat import ChatSummary, MessageOut, MessagePage
from app.services.compatibility import compute_compatibility
from app.services.contact_masker import mask_contacts
from app.services.pagination import (
    MESSAGES_MAX_LIMIT,
    MESSAGES_PAGE_LIMIT,
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


def _other_id(chat: Chat, user_id: uuid.UUID) -> uuid.UUID:
    """Id-ul celuilalt participant din chat."""
    return chat.user_b_id if chat.user_a_id == user_id else chat.user_a_id


async def _interests_by_profile(
    db: AsyncSession, profile_ids: list[uuid.UUID]
) -> dict[uuid.UUID, set[str]]:
    """Mapează profile_id -> set de slug-uri de interese (ca în feed_service)."""
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


async def ensure_chat_for_match(db: AsyncSession, match: Match) -> Chat:
    """Wrapper public reutilizabil (ex. din feed_service la producerea unui match).

    Nu comite — apelantul decide momentul commit-ului.
    """
    return await _ensure_chat_for_match(db, match)


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


async def _ensure_not_blocked(
    db: AsyncSession, user_id: uuid.UUID, other_id: uuid.UUID
) -> None:
    """403 dacă există un Block în ORICARE direcție între cei doi participanți.

    Un user blocat nu mai poate interacționa (scrie / reacționa) într-un chat
    deja existent, chiar dacă apartenența la chat e validă (breșă CHAT-BLOCK).
    """
    result = await db.execute(
        select(Block.id).where(
            or_(
                and_(Block.blocker_id == user_id, Block.blocked_id == other_id),
                and_(Block.blocker_id == other_id, Block.blocked_id == user_id),
            )
        )
    )
    if result.first() is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Interaction blocked between these users",
        )


async def _last_messages_by_chat(
    db: AsyncSession, user: User
) -> dict[uuid.UUID, tuple[str, object]]:
    """Ultimul mesaj (body, created_at) din FIECARE chat al userului — O(1) query.

    Window function `ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY created_at
    DESC, id DESC)`, filtrată la rândul 1. Înlocuiește un `SELECT ... LIMIT 1`
    per chat (N+1). Suportată de Postgres și de SQLite ≥ 3.25.
    """
    rank = (
        func.row_number()
        .over(
            partition_by=Message.chat_id,
            order_by=(Message.created_at.desc(), Message.id.desc()),
        )
        .label("rank")
    )
    ranked = (
        select(
            Message.chat_id.label("chat_id"),
            Message.body.label("body"),
            Message.created_at.label("created_at"),
            rank,
        )
        # JOIN pe chat (nu `IN (:id1, …, :idN)`) — numărul de parametri legați nu
        # crește cu numărul de chat-uri (limita de 999 variabile pe SQLite).
        .join(Chat, Chat.id == Message.chat_id)
        .where(or_(Chat.user_a_id == user.id, Chat.user_b_id == user.id))
        .subquery()
    )
    result = await db.execute(
        select(ranked.c.chat_id, ranked.c.body, ranked.c.created_at).where(
            ranked.c.rank == 1
        )
    )
    return {row.chat_id: (row.body, row.created_at) for row in result.all()}


async def _unread_counts_by_chat(
    db: AsyncSession, user: User
) -> dict[uuid.UUID, int]:
    """Numărul de necitite în FIECARE chat al userului — O(1) query (GROUP BY).

    Înlocuiește un `SELECT COUNT(*)` per chat (N+1). Chat-urile fără necitite
    lipsesc din dict → apelantul folosește 0 ca default.
    """
    result = await db.execute(
        select(Message.chat_id, func.count())
        .join(Chat, Chat.id == Message.chat_id)
        .where(
            or_(Chat.user_a_id == user.id, Chat.user_b_id == user.id),
            Message.sender_id != user.id,
            Message.is_read.is_(False),
        )
        .group_by(Message.chat_id)
    )
    return {chat_id: int(count) for chat_id, count in result.all()}


async def list_chats(db: AsyncSession, user: User) -> list[ChatSummary]:
    """Lista dialogurilor userului (TZ 5.1).

    Pentru fiecare match care îl conține pe user asigură un chat (idempotent),
    apoi compune rezumatul cu datele celuilalt + ultimul mesaj + necitite.

    NUMĂR CONSTANT DE QUERY-URI (endpointul e cel mai *polled* al aplicației —
    mobilul face polling, nu WebSocket): 6 interogări, indiferent dacă userul are
    1 sau 200 de chat-uri. Varianta anterioară făcea 3 query-uri PER CHAT
    (chat-ul match-ului + ultimul mesaj + necitite) — ~600 la 200 de match-uri.
    """
    # 1. Toate match-urile userului.
    matches_result = await db.execute(
        select(Match).where(
            or_(Match.user_a_id == user.id, Match.user_b_id == user.id)
        )
    )
    matches = list(matches_result.scalars().all())
    if not matches:
        return []

    # 2. Chat-urile existente ale userului, într-o singură interogare.
    #    (`chats.user_a_id`/`user_b_id` oglindesc participanții match-ului, deci
    #    orice chat al unui match care îl conține pe user apare aici.)
    chats_result = await db.execute(
        select(Chat).where(
            or_(Chat.user_a_id == user.id, Chat.user_b_id == user.id)
        )
    )
    chats = list(chats_result.scalars().all())

    # 3. Creează în BULK chat-urile lipsă (normal: niciunul — chat-ul se creează
    #    odată cu match-ul, în feed_service). Un singur INSERT (executemany).
    existing_match_ids = {c.match_id for c in chats}
    missing = [m for m in matches if m.id not in existing_match_ids]
    if missing:
        new_chats = [
            Chat(
                match_id=m.id,
                user_a_id=m.user_a_id,
                user_b_id=m.user_b_id,
            )
            for m in missing
        ]
        db.add_all(new_chats)
        await db.commit()
        chats.extend(new_chats)

    # 4. Profilurile celorlalți participanți + propriul profil, într-un singur
    #    SELECT (compatibilitatea are nevoie de ambele, TZ 5.2 / 4.6).
    other_ids = [_other_id(c, user.id) for c in chats]
    profiles_result = await db.execute(
        select(Profile).where(Profile.user_id.in_([*other_ids, user.id]))
    )
    profiles_by_user = {p.user_id: p for p in profiles_result.scalars().all()}
    my_profile = profiles_by_user.get(user.id)

    # 5. Interesele mele + ale celorlalți (o singură interogare batch, ca în feed).
    interests_map = await _interests_by_profile(
        db, [p.id for p in profiles_by_user.values()]
    )
    my_interests = (
        interests_map.get(my_profile.id, set()) if my_profile is not None else set()
    )

    # 6. + 7. Ultimul mesaj și necititele pentru TOATE chat-urile — 2 agregate.
    last_by_chat = await _last_messages_by_chat(db, user)
    unread_by_chat = await _unread_counts_by_chat(db, user)

    summaries: list[ChatSummary] = []
    for chat in chats:
        other_id = _other_id(chat, user.id)
        profile = profiles_by_user.get(other_id)

        # Compatibilitatea cu celălalt user (0 dacă lipsește vreun profil).
        if my_profile is not None and profile is not None:
            compatibility = compute_compatibility(
                my_profile, profile, my_interests, interests_map.get(profile.id, set())
            )
        else:
            compatibility = 0

        last_body, last_at = last_by_chat.get(chat.id, (None, None))

        summaries.append(
            ChatSummary(
                chat_id=chat.id,
                other_user_id=other_id,
                other_name=profile.name if profile else "",
                other_age=_calc_age(profile.birth_date) if profile else None,
                other_city=profile.city if profile else None,
                last_message=last_body,
                last_message_at=last_at,
                unread_count=unread_by_chat.get(chat.id, 0),
                compatibility=compatibility,
            )
        )

    # Cele mai recente dialoguri primele (ultimul mesaj / creare chat).
    summaries.sort(
        key=lambda s: (s.last_message_at is not None, s.last_message_at),
        reverse=True,
    )
    return summaries


async def get_messages(
    db: AsyncSession,
    user: User,
    chat_id: uuid.UUID,
    limit: int | None = None,
    cursor: str | None = None,
) -> MessagePage:
    """O PAGINĂ de mesaje dintr-un chat, cea mai recentă fereastră prima.

    Înainte întorcea TOATE mesajele chat-ului, fără limită: un chat cu 50.000 de
    mesaje însemna 50.000 de rânduri materializate în RAM + serializate în JSON
    la fiecare deschidere a conversației (OOM garantat pe server).

    Semantica paginării (ca în orice client de chat): pagina 1 conține cele mai
    NOI `limit` mesaje — exact ce vedea userul și înainte, când derula la capătul
    de jos. `next_cursor` duce spre mesaje mai VECHI (scroll în istoric).
    În interiorul paginii mesajele rămân în ordine cronologică crescătoare, ca
    până acum.

    NU MAI MARCHEAZĂ CITIT: un GET nu are voie să mute stare (nu e idempotent,
    strică orice cache/retry HTTP și orice prefetch al clientului). Marcarea se
    face explicit prin `POST /chats/{id}/read`.
    """
    chat = await _get_participant_chat(db, user, chat_id)

    limit = clamp_limit(limit, MESSAGES_PAGE_LIMIT, MESSAGES_MAX_LIMIT)

    stmt = select(Message).where(Message.chat_id == chat.id)
    if cursor:
        anchor_id = decode_cursor(cursor)
        # Momentul mesajului-ancoră citit DB-side (vezi pagination.py: evită
        # nepotrivirea de format a datetime-urilor între bind și stocare).
        anchor_at = (
            select(Message.created_at)
            .where(Message.id == anchor_id, Message.chat_id == chat.id)
            .scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                Message.created_at < anchor_at,
                and_(
                    Message.created_at == anchor_at,
                    Message.id < anchor_id,
                ),
            )
        )

    # Ordonare TOTALĂ (created_at, id) — `id` e unic, deci nu există egalități
    # ambigue: paginarea nu poate întoarce duplicate și nu poate sări mesaje,
    # chiar dacă mai multe mesaje au același `created_at` (pe SQLite timestampul
    # are rezoluție de o secundă). `limit + 1` = sondă pentru „mai există".
    result = await db.execute(
        stmt.order_by(Message.created_at.desc(), Message.id.desc()).limit(limit + 1)
    )
    rows = list(result.scalars().all())

    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = encode_cursor(rows[-1].id) if (has_more and rows) else None

    rows.reverse()  # cronologic crescător în interiorul paginii
    return MessagePage(
        items=[MessageOut.model_validate(m) for m in rows],
        next_cursor=next_cursor,
    )


async def send_message(
    db: AsyncSession, user: User, chat_id: uuid.UUID, body: str
) -> MessageOut:
    """Trimite un mesaj: aplică mascarea contactelor și persistă (TZ 5.5)."""
    chat = await _get_participant_chat(db, user, chat_id)
    # Breșă CHAT-BLOCK: un user blocat (oricare direcție) nu poate scrie.
    await _ensure_not_blocked(db, user.id, _other_id(chat, user.id))

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


async def react_to_message(
    db: AsyncSession,
    user: User,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    reaction: str | None,
) -> MessageOut:
    """Setează (sau scoate cu None) reacția la un mesaj din chat (TZ 5.2).

    Poți reacționa la orice mesaj din chatul tău. 404 dacă userul nu e
    participant la chat sau dacă mesajul nu aparține acelui chat.
    """
    chat = await _get_participant_chat(db, user, chat_id)
    # Breșă CHAT-BLOCK: un user blocat (oricare direcție) nu poate reacționa.
    await _ensure_not_blocked(db, user.id, _other_id(chat, user.id))

    result = await db.execute(
        select(Message).where(
            Message.id == message_id, Message.chat_id == chat.id
        )
    )
    message = result.scalar_one_or_none()
    if message is None:
        # Mesaj inexistent sau din alt chat → nu divulgăm → 404.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Message not found"
        )

    message.reaction = reaction  # None scoate reacția
    await db.commit()
    await db.refresh(message)
    return MessageOut.model_validate(message)


async def mark_read(db: AsyncSession, user: User, chat_id: uuid.UUID) -> None:
    """Marchează citite toate mesajele primite din chat (endpoint dedicat)."""
    chat = await _get_participant_chat(db, user, chat_id)
    await _mark_read(db, chat, user)


async def _mark_read(db: AsyncSession, chat: Chat, user: User) -> None:
    """Setează `is_read=True` pe mesajele primite de la celălalt participant.

    UN SINGUR `UPDATE ... WHERE` — varianta anterioară SELECTA toate mesajele
    necitite, le încărca în Python și le muta una câte una (un chat cu 5.000 de
    necitite = 5.000 de obiecte în RAM + 5.000 de UPDATE-uri la flush).
    """
    await db.execute(
        update(Message)
        .where(
            Message.chat_id == chat.id,
            Message.sender_id != user.id,
            Message.is_read.is_(False),
        )
        .values(is_read=True)
        # Nu sincronizăm sesiunea: nu ținem mesajele încărcate în identity map.
        .execution_options(synchronize_session=False)
    )
    # Comitem necondiționat: statement-ul a deschis oricum o tranzacție, iar un
    # UPDATE care nu a atins niciun rând nu schimbă nimic.
    await db.commit()

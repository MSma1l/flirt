"""Exportul datelor personale ale userului (dreptul de acces și portabilitate).

Legea nr. 195/2024 / GDPR art. 15 și 20: userul primește, într-un format
structurat, citibil automat (JSON), datele pe care le deținem despre el.

CE INCLUDEM: tot ce e legat de cont — profil, setări, aprecieri trimise,
potriviri, mesajele TRIMISE de el (nu și pe cele ale celorlalți — acelea sunt
datele altor persoane), favorite, blocări, raportări trimise, povești,
evenimente, bilete, comenzi, fidelitate, abonamente, dispozitive, consimțăminte.

CE EXCLUDEM INTENȚIONAT: secrete tehnice (hash-ul parolei, hash-ul tokenului de
sesiune, token-ul de push complet), notițele interne ale adminilor, raportările
făcute de ALȚII împotriva lui (protecția raportorului).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Iterable

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import AccountDeletionRequest, Block, Favorite, Ticket, UserSettings
from app.models.billing import PurchaseReceipt, Subscription
from app.models.chat import Chat, Message
from app.models.consent import UserConsent
from app.models.device import PushDevice
from app.models.event import EventAttendance, FlirtPassportStamp
from app.models.interest import Interest, ProfileInterest
from app.models.loyalty import LoyaltyInviteRedemption
from app.models.moderation import Report
from app.models.profile import Profile
from app.models.session import RefreshSession
from app.models.story import Story
from app.models.swipe import Like, Match
from app.models.ticket_order import TicketOrder
from app.models.user import User

EXPORT_FORMAT_VERSION = 1


def _json_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    return value


def _row(obj: Any, exclude: Iterable[str] = ()) -> dict[str, Any]:
    """Toate coloanele unui rând, serializabile JSON, minus cele excluse."""
    skip = set(exclude)
    return {
        attr.key: _json_value(getattr(obj, attr.key))
        for attr in sa_inspect(obj).mapper.column_attrs
        if attr.key not in skip
    }


async def _all(db: AsyncSession, stmt) -> list:
    return list((await db.execute(stmt)).scalars().all())


async def export_user_data(db: AsyncSession, user: User) -> dict[str, Any]:
    uid = user.id

    profile = (
        await db.execute(select(Profile).where(Profile.user_id == uid))
    ).scalar_one_or_none()
    interests: list[str] = []
    if profile is not None:
        interests = list(
            (
                await db.execute(
                    select(Interest.slug)
                    .join(ProfileInterest, ProfileInterest.interest_id == Interest.id)
                    .where(ProfileInterest.profile_id == profile.id)
                )
            ).scalars().all()
        )

    settings_row = (
        await db.execute(select(UserSettings).where(UserSettings.user_id == uid))
    ).scalar_one_or_none()

    chats = await _all(
        db, select(Chat).where(or_(Chat.user_a_id == uid, Chat.user_b_id == uid))
    )
    messages = await _all(
        db,
        select(Message).where(Message.sender_id == uid).order_by(Message.created_at),
    )
    sessions = await _all(db, select(RefreshSession).where(RefreshSession.user_id == uid))
    devices = await _all(db, select(PushDevice).where(PushDevice.user_id == uid))

    return {
        "export_format_version": EXPORT_FORMAT_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "account": _row(user, exclude=("password_hash",)),
        "profile": (
            {**_row(profile), "interests": interests} if profile is not None else None
        ),
        "settings": _row(settings_row) if settings_row is not None else None,
        "likes_sent": [
            _row(x) for x in await _all(db, select(Like).where(Like.from_user_id == uid))
        ],
        "matches": [
            _row(x)
            for x in await _all(
                db, select(Match).where(or_(Match.user_a_id == uid, Match.user_b_id == uid))
            )
        ],
        "chats": [_row(x) for x in chats],
        "messages_sent": [_row(x) for x in messages],
        "favorites": [
            _row(x) for x in await _all(db, select(Favorite).where(Favorite.user_id == uid))
        ],
        "blocks": [
            _row(x) for x in await _all(db, select(Block).where(Block.blocker_id == uid))
        ],
        "reports_submitted": [
            _row(x)
            for x in await _all(db, select(Report).where(Report.reporter_id == uid))
        ],
        "stories": [
            _row(x) for x in await _all(db, select(Story).where(Story.user_id == uid))
        ],
        "event_attendances": [
            _row(x)
            for x in await _all(
                db, select(EventAttendance).where(EventAttendance.user_id == uid)
            )
        ],
        "passport_stamps": [
            _row(x)
            for x in await _all(
                db, select(FlirtPassportStamp).where(FlirtPassportStamp.user_id == uid)
            )
        ],
        "loyalty_invite_redemptions": [
            _row(x)
            for x in await _all(
                db,
                select(LoyaltyInviteRedemption).where(
                    LoyaltyInviteRedemption.user_id == uid
                ),
            )
        ],
        "ticket": [
            _row(x, exclude=("admitted_by",))
            for x in await _all(db, select(Ticket).where(Ticket.user_id == uid))
        ],
        "ticket_orders": [
            _row(x, exclude=("admin_note", "decided_by", "admitted_by"))
            for x in await _all(db, select(TicketOrder).where(TicketOrder.user_id == uid))
        ],
        "subscriptions": [
            _row(x)
            for x in await _all(db, select(Subscription).where(Subscription.user_id == uid))
        ],
        "purchase_receipts": [
            _row(x)
            for x in await _all(
                db, select(PurchaseReceipt).where(PurchaseReceipt.user_id == uid)
            )
        ],
        "push_devices": [
            {
                "platform": d.platform,
                # Doar sufixul: token-ul complet e un secret de livrare.
                "token_suffix": d.token[-6:] if d.token else None,
                "created_at": _json_value(d.created_at),
            }
            for d in devices
        ],
        "sessions": [
            {
                "created_at": _json_value(s.created_at),
                "expires_at": _json_value(s.expires_at),
                "revoked": s.revoked,
            }
            for s in sessions
        ],
        "consents": [
            _row(x)
            for x in await _all(
                db,
                select(UserConsent)
                .where(UserConsent.user_id == uid)
                .order_by(UserConsent.accepted_at),
            )
        ],
        "account_deletion_request": next(
            (
                _row(x)
                for x in await _all(
                    db,
                    select(AccountDeletionRequest).where(
                        AccountDeletionRequest.user_id == uid
                    ),
                )
            ),
            None,
        ),
    }

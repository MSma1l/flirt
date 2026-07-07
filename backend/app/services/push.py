"""Schelet de push notifications (TZ 6.3) — abstracție PushSender + STUB.

Provider-ul se alege din `settings.push_provider`:
- 'stub' (implicit): nu trimite nimic, doar „loghează".
- 'expo' | 'fcm': punct de conectare (nu e implementat încă).

`register_device` face upsert pe (user_id, token); `send_to_user` trimite către
toate dispozitivele active ale unui user (în stub, doar loghează).
"""
from __future__ import annotations

import logging
import uuid
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.device import PushDevice
from app.models.user import User

logger = logging.getLogger("app.push")


class PushSender(Protocol):
    """Contractul minim de trimitere push folosit de servicii/endpoint-uri."""

    async def send(
        self, tokens: list[str], title: str, body: str
    ) -> None:
        """Trimite o notificare către token-urile date."""
        ...


class StubPush:
    """Sender fals pentru dezvoltare/teste: nu atinge rețeaua, doar loghează."""

    async def send(self, tokens: list[str], title: str, body: str) -> None:
        """RO: doar loghează payload-ul; niciun apel de rețea."""
        logger.info(
            "STUB push -> %d device(s): title=%r body=%r", len(tokens), title, body
        )


def get_push_sender() -> PushSender:
    """Fabrică de sender în funcție de `settings.push_provider`."""
    provider = settings.push_provider
    if provider == "stub":
        return StubPush()
    if provider == "expo":
        # RO: aici se adaugă ExpoPush — POST la https://exp.host/--/api/v2/push/send
        # cu lista de mesaje {to, title, body}, folosind settings.push_api_key.
        raise NotImplementedError(
            "Push Expo nu este implementat încă. Setează PUSH_API_KEY și "
            "adaugă clientul HTTP către Expo Push API."
        )
    if provider == "fcm":
        # RO: aici se adaugă FcmPush — POST la endpoint-ul FCM v1
        # (messaging.send) cu credențialele service account / settings.push_api_key.
        raise NotImplementedError(
            "Push FCM nu este implementat încă. Setează PUSH_API_KEY și "
            "adaugă clientul HTTP către Firebase Cloud Messaging."
        )
    raise NotImplementedError(
        f"Provider de push necunoscut: '{provider}'. "
        "Valori permise: 'stub', 'expo', 'fcm'."
    )


async def register_device(
    db: AsyncSession, user: User, token: str, platform: str
) -> PushDevice:
    """Upsert pe (user_id, token): actualizează platforma dacă tokenul există."""
    result = await db.execute(
        select(PushDevice).where(
            PushDevice.user_id == user.id, PushDevice.token == token
        )
    )
    device = result.scalars().first()
    if device is None:
        device = PushDevice(user_id=user.id, token=token, platform=platform)
        db.add(device)
    else:
        device.platform = platform

    await db.commit()
    await db.refresh(device)
    return device


async def send_to_user(
    db: AsyncSession, user_id: uuid.UUID, title: str, body: str
) -> None:
    """Trimite o notificare către toate dispozitivele userului (stub: loghează)."""
    result = await db.execute(
        select(PushDevice.token).where(PushDevice.user_id == user_id)
    )
    tokens = [row[0] for row in result.all()]
    sender = get_push_sender()
    await sender.send(tokens, title, body)

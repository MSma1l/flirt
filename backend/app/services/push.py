"""Push notifications (TZ 6.3) — abstracție PushSender + STUB / Expo / FCM.

Provider-ul se alege din `settings.push_provider`:
- 'stub' (implicit): nu trimite nimic, doar „loghează".
- 'expo': trimite prin Expo Push API (https://exp.host/--/api/v2/push/send).
- 'fcm' : trimite prin Firebase Cloud Messaging (legacy HTTP).

`register_device` face upsert pe (user_id, token); `send_to_user` trimite către
toate dispozitivele active ale unui user, prin sender-ul ales în config.

Notă: providerii live sunt robuști la erori HTTP — o eroare pe un token nu
oprește restul și nu propagă excepția către apelant (`send_to_user` nu crapă).
"""
from __future__ import annotations

import logging
import uuid
from typing import Protocol

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.device import PushDevice
from app.models.user import User

logger = logging.getLogger("app.push")

# Endpoint-urile oficiale ale provider-ilor (fără hardcodare la nivel de apel).
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
FCM_PUSH_URL = "https://fcm.googleapis.com/fcm/send"

# Timeout comun pentru apelurile HTTP către provideri (secunde).
_HTTP_TIMEOUT = 10.0


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


class ExpoPush:
    """Sender live prin Expo Push API.

    Trimite câte un mesaj `{to, title, body}` pentru fiecare token. Dacă
    `settings.push_api_key` e setat, adaugă header-ul `Authorization: Bearer ...`.
    """

    async def send(self, tokens: list[str], title: str, body: str) -> None:
        """POST la Expo Push API pentru fiecare token; robust la erori HTTP."""
        if not tokens:
            return

        # Header-ul de autorizare e opțional (Expo acceptă și fără cheie).
        headers = {"Content-Type": "application/json"}
        if settings.push_api_key:
            headers["Authorization"] = f"Bearer {settings.push_api_key}"

        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            for token in tokens:
                payload = {"to": token, "title": title, "body": body}
                try:
                    resp = await client.post(
                        EXPO_PUSH_URL, json=payload, headers=headers
                    )
                    resp.raise_for_status()
                except httpx.HTTPError as exc:  # RO: nu oprim restul token-urilor
                    logger.warning("Expo push failed for token %r: %s", token, exc)


class FcmPush:
    """Sender live prin Firebase Cloud Messaging (legacy HTTP).

    Folosește `settings.fcm_server_key` în header-ul `Authorization: key=...` și
    payload-ul `{to, notification:{title, body}}` pentru fiecare token.
    """

    async def send(self, tokens: list[str], title: str, body: str) -> None:
        """POST la FCM pentru fiecare token; robust la erori HTTP."""
        if not tokens:
            return

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"key={settings.fcm_server_key}",
        }

        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            for token in tokens:
                payload = {"to": token, "notification": {"title": title, "body": body}}
                try:
                    resp = await client.post(
                        FCM_PUSH_URL, json=payload, headers=headers
                    )
                    resp.raise_for_status()
                except httpx.HTTPError as exc:  # RO: nu oprim restul token-urilor
                    logger.warning("FCM push failed for token %r: %s", token, exc)


def get_push_sender() -> PushSender:
    """Fabrică de sender în funcție de `settings.push_provider`."""
    provider = settings.push_provider
    if provider == "stub":
        return StubPush()
    if provider == "expo":
        return ExpoPush()
    if provider == "fcm":
        return FcmPush()
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
    """Trimite o notificare către toate dispozitivele userului, prin sender-ul ales."""
    result = await db.execute(
        select(PushDevice.token).where(PushDevice.user_id == user_id)
    )
    tokens = [row[0] for row in result.all()]
    sender = get_push_sender()
    await sender.send(tokens, title, body)

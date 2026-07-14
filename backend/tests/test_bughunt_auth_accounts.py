"""Bug-hunt: autentificare + conturi + ștergere (GDPR).

Fiecare test ASERTEAZĂ comportamentul CORECT; roșu = bug demonstrat.
NU repară nimic — doar demonstrează.
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from app.models.account import UserSettings
from app.models.user import User
from app.services import account_service

pytestmark = pytest.mark.asyncio

AUTH = "/api/v1/auth"
SETTINGS = "/api/v1/settings"
PASSWORD = "supersecret123"


async def _register(client: AsyncClient, email: str, password: str = PASSWORD):
    return await client.post(
        f"{AUTH}/register", json={"email": email, "password": password}
    )


async def _get_user(db, email: str) -> User:
    return await db.scalar(select(User).where(User.email == email))


# --------------------------------------------------------------------------- #
# BUG: access token-ul unui cont ȘTERS (GDPR purge) rămâne acceptat.
#
# `admin_service.delete_user` și cron-ul GDPR rulează `purge_user_data`, care
# șterge sesiunile de refresh dar NU setează `banned_at`. Access token-ul
# stateless (15 min) rămâne criptografic valid, iar `get_current_user` încarcă
# userul (anonimizat, banned_at=None) și îl ACCEPTĂ. Spre deosebire de BAN, care
# e verificat în DB la fiecare cerere (`is_banned` → 403), ștergerea nu are un
# echivalent — deci un cont „șters" continuă să facă cereri autentificate.
# --------------------------------------------------------------------------- #
async def test_deleted_account_access_token_is_rejected(client: AsyncClient, db_session):
    reg = await _register(client, "purged@example.com")
    access = reg.json()["access_token"]

    user = await _get_user(db_session, "purged@example.com")
    # Exact codul rulat de `DELETE /admin/users/{id}` și de cron-ul GDPR.
    await account_service.purge_user_data(db_session, user.id)
    await db_session.commit()

    # Endpoint protejat care NU serializează emailul (evită zgomotul de
    # ResponseValidationError de la /auth/me): dacă întoarce 200, poarta de acces
    # a lăsat să treacă un cont ȘTERS.
    resp = await client.get(
        f"{SETTINGS}/", headers={"Authorization": f"Bearer {access}"}
    )
    assert resp.status_code in (401, 403), (
        f"Cont ȘTERS (GDPR) încă autentificat: {SETTINGS}/ → {resp.status_code}. "
        "purge_user_data nu setează banned_at, deci access token-ul rămâne valid."
    )


# --------------------------------------------------------------------------- #
# BUG (aceeași rădăcină, consecință GDPR gravă): un cont ȘTERS își RE-CREEAZĂ
# date personale. `GET /settings/` cheamă `_get_or_create_settings`, care scrie
# un rând NOU în `user_settings` pentru userul purjat — resurecție de date exact
# după o ștergere „ireversibilă" GDPR.
# --------------------------------------------------------------------------- #
async def test_deleted_account_cannot_resurrect_settings_row(
    client: AsyncClient, db_session
):
    reg = await _register(client, "ghost@example.com")
    access = reg.json()["access_token"]
    user = await _get_user(db_session, "ghost@example.com")
    uid = user.id

    await account_service.purge_user_data(db_session, uid)
    await db_session.commit()

    # După purge nu există niciun rând de setări pentru user.
    before = await db_session.scalar(
        select(func.count())
        .select_from(UserSettings)
        .where(UserSettings.user_id == uid)
    )
    assert before == 0, "Fixtura ruptă: purge nu a șters setările."

    await client.get(f"{SETTINGS}/", headers={"Authorization": f"Bearer {access}"})

    after = await db_session.scalar(
        select(func.count())
        .select_from(UserSettings)
        .where(UserSettings.user_id == uid)
    )
    assert after == 0, (
        "Un cont ȘTERS și-a RE-CREAT un rând de setări folosind access token-ul "
        "rămas valid — resurecție de date personale după ștergerea GDPR."
    )

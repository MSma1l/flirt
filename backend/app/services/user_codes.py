"""Codurile PERSONALE ale userului, generate LENEȘ: codul de plată și tokenul
QR-ului Flirt Passport.

CODUL DE PLATĂ (`users.payment_code`): 6 cifre, prima ≠ 0 (ex. `482719`). Userul
scrie DOAR acest cod în comentariul transferului bancar; adminul îl caută în
extrasul băncii. E STABIL (același pentru toate comenzile userului) și UNIC.
Înlocuiește vechiul `U-XXXXXXXX` derivat din uuid — prea greu de tastat corect.

TOKENUL PAȘAPORTULUI (`users.passport_token`): 32 hex. QR-ul arătat la intrare e
`FLIRTP-<token>`; scanarea îl recunoaște după prefix (vezi `ticket_scan_service`).

GENERARE: aleator (`secrets`), cu verificare prealabilă + UPDATE condiționat
(`… WHERE coloana IS NULL`) într-un SAVEPOINT. O coliziune pe UNIQUE (alt user a
primit între timp același cod) → reîncercăm cu altul; o cursă pe ACELAȘI user
(două cereri simultane) → UPDATE-ul nu mai găsește rândul NULL și citim valoarea
câștigătoare. Helperii NU fac commit: apelantul persistă în tranzacția lui.
"""
from __future__ import annotations

import secrets

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

# Prefixul QR-ului Flirt Passport (așa cum îl afișează Mini App-ul).
PASSPORT_QR_PREFIX = "FLIRTP-"
# Reîncercări la coliziune: 900.000 de coduri posibile — o coliziune repetată de
# atâtea ori înseamnă un spațiu practic epuizat, nu ghinion.
_MAX_ATTEMPTS = 20


def new_payment_code() -> str:
    """6 cifre, prima ≠ 0 (100000–999999)."""
    return str(100000 + secrets.randbelow(900000))


def new_passport_token() -> str:
    return secrets.token_hex(16)


async def _ensure(db: AsyncSession, user: User, column, generate) -> str:
    current = getattr(user, column.key)
    if current:
        return current
    for _ in range(_MAX_ATTEMPTS):
        value = generate()
        if await db.scalar(select(User.id).where(column == value)) is not None:
            continue
        try:
            async with db.begin_nested():
                await db.execute(
                    update(User)
                    .where(User.id == user.id, column.is_(None))
                    .values({column.key: value})
                    .execution_options(synchronize_session=False)
                )
        except IntegrityError:
            continue  # coliziune pe UNIQUE între verificare și scriere
        await db.refresh(user, [column.key])
        current = getattr(user, column.key)
        if current:
            return current
    raise RuntimeError(f"could not allocate a unique {column.key}")


async def ensure_payment_code(db: AsyncSession, user: User) -> str:
    """Codul de plată al userului; îl generează la prima nevoie (fără commit)."""
    return await _ensure(db, user, User.payment_code, new_payment_code)


async def ensure_passport_token(db: AsyncSession, user: User) -> str:
    """Tokenul QR-ului Flirt Passport; generat la prima nevoie (fără commit)."""
    return await _ensure(db, user, User.passport_token, new_passport_token)

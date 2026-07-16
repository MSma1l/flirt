"""Login-ul panoului de administrare — `POST /api/v1/admin/login`.

DE CE O RUTĂ SEPARATĂ DE `/auth/login`, dacă tot userul și tot tabelul sunt aceleași:

1. RATE LIMIT PROPRIU, MULT MAI STRICT. `rate_limit_admin_login_per_min` (3/min)
   față de `rate_limit_login_per_min` (5/min). Numărul de administratori e mic și
   cunoscut, deci un prag mic nu deranjează pe nimeni legitim — dar un cont de
   admin spart înseamnă tot produsul spart, așa că fereastra de brute-force
   trebuie să fie cât mai îngustă. Bucket-ul e separat („admin_login"), deci
   încercările pe panou nu consumă din cota login-ului obișnuit și nici invers.

2. AUDIT. Fiecare autentificare reușită de admin se scrie în `AdminAuditLog`
   (`admin.login`), cu IP. Când un cont de admin e compromis, prima întrebare a
   anchetei e „de unde și când s-a logat", iar `/auth/login` nu răspunde la ea.

3. REFUZ ÎNAINTE DE EMITEREA TOKEN-ULUI. `require_role=ROLE_ADMIN` respinge un
   user obișnuit cu 403 ÎNAINTE ca `auth_service` să emită perechea de token-uri
   (vezi docstring-ul lui `authenticate`) — un login de admin respins nu lasă în
   urmă o sesiune de refresh valabilă 7 zile.

Verificarea rolului se face DUPĂ parolă, deliberat: un 403 înaintea validării
parolei ar fi un oracol de enumerare („acest email e admin"), oferit gratuit
oricui, fără nicio credențială.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ratelimit import rate_limit
from app.db.session import get_db
from app.models.user import ROLE_ADMIN, User
from app.schemas.auth import LoginIn, TokenPair
from app.services import admin_service, auth_service

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]

# Prag din config (`rate_limit_admin_login_per_min`), fereastră de 60s, per IP.
_admin_login_rl = rate_limit("admin_login", "rate_limit_admin_login_per_min", 60)


@router.post(
    "/login",
    response_model=TokenPair,
    tags=["admin"],
    dependencies=[Depends(_admin_login_rl)],
)
async def admin_login(data: LoginIn, request: Request, db: DbDep) -> TokenPair:
    """Autentifică un ADMIN și emite perechea de token-uri.

    401 = credențiale greșite (identic pentru „email inexistent" și „parolă
    greșită" — fără oracol). 403 = credențiale corecte, dar contul nu e admin
    (sau e banat). 429 = prea multe încercări de la același IP.
    """
    pair = await auth_service.authenticate(
        db,
        email=data.email,
        password=data.password,
        require_role=ROLE_ADMIN,
    )

    # Am ajuns aici ⇒ userul EXISTĂ, parola e corectă, contul nu e banat și are
    # rol de admin (altfel `authenticate` ar fi ridicat deja 401/403).
    admin = await db.scalar(
        select(User).where(User.email == data.email.strip().lower())
    )
    if admin is not None:
        await admin_service.record_login(
            db, admin, ip=admin_service.request_ip(request)
        )
    return pair

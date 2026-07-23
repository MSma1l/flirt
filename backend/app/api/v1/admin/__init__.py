"""Panoul de administrare — agregatorul rutelor `/api/v1/admin/*`.

DECIZIA DE SECURITATE CENTRALĂ A PACHETULUI:
`require_admin` NU se pune rută cu rută. Se pune AICI, o singură dată, pe
`include_router(...)`, pentru fiecare sub-router protejat.

Motivul e că apărarea „ține minte să adaugi dependency-ul pe fiecare handler" e
o apărare care funcționează exact până când cineva adaugă a 21-a rută într-o
vineri seara. O rută de admin uitată nu dă eroare, nu pică niciun test scris
înainte de ea și nu se vede în code review — pur și simplu servește date de
moderare oricui are un token valid de utilizator obișnuit. Aplicat pe router,
un handler nou este protejat PRIN CONSTRUCȚIE: trebuie să te străduiești ca să
îl expui, nu ca să îl aperi.

Singura rută neprotejată e `POST /admin/login` — evident, nu poți cere un token
de admin celui care tocmai încearcă să obțină unul. Ea are în schimb propriul
rate limit, mai strict decât login-ul obișnuit (vezi `auth.py`).

Contract, garantat de `require_admin` (`core/deps.py`) și verificat în
`tests/test_admin_security.py` pentru FIECARE rută:
    fără token / token invalid   → 401
    token de user obișnuit       → 403
    token de admin banat         → 403
    rol retras între două cereri → 403 IMEDIAT (rolul e citit din DB, nu din JWT)
"""
from fastapi import APIRouter, Depends

from app.api.v1.admin import (
    ads,
    audit,
    auth,
    events,
    moderation,
    stats,
    subscriptions,
    ticket_orders,
    users,
)
from app.core.deps import require_admin

router = APIRouter()

# Poarta de acces. O listă, ca să fie evident că se aplică la TOT ce urmează.
_admin_only = [Depends(require_admin)]

# Login-ul de admin — SINGURA rută publică din tot pachetul (are rate limit propriu).
router.include_router(auth.router)

# Tot restul: protejat prin construcție.
router.include_router(stats.router, dependencies=_admin_only)
router.include_router(users.router, dependencies=_admin_only)
router.include_router(moderation.router, dependencies=_admin_only)
router.include_router(events.router, dependencies=_admin_only)
router.include_router(subscriptions.router, dependencies=_admin_only)
router.include_router(audit.router, dependencies=_admin_only)
router.include_router(ads.router, dependencies=_admin_only)
router.include_router(ticket_orders.router, dependencies=_admin_only)

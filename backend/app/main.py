"""Punct de intrare FastAPI — app, middleware, observabilitate, handler-e globale."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import legal
from app.api.v1 import health
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.logging import (
    REQUEST_ID_HEADER,
    AccessLogMiddleware,
    RequestContextMiddleware,
    configure_logging,
    get_request_id,
)

configure_logging()
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Migrațiile rulează prin Alembic la deploy (vezi entrypoint.sh).
    # Purjarea GDPR rulează într-un serviciu SEPARAT (`scripts/gdpr_purge.py`),
    # NU aici: cu 4 workeri gunicorn un task în lifespan ar rula de 4 ori.
    log.info("startup", extra={"env": settings.environment})
    yield
    log.info("shutdown", extra={"env": settings.environment})


app = FastAPI(
    title=f"{settings.app_name} API",
    version="0.1.0",
    debug=settings.debug,
    lifespan=lifespan,
)

# --------------------------------------------------------------------------- #
# Middleware
# RO: ultimul adăugat = cel mai din exterior. Vrem request-id-ul setat ÎNAINTE
# de orice altceva, ca toate log-urile cererii (inclusiv access log-ul și
# stack trace-urile) să poarte aceeași corelare.
# --------------------------------------------------------------------------- #
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # `X-Next-Cursor` DEBUIE expus: paginarea (/feed, /chats, /stories, /events,
    # /social/*) întoarce cursorul în header, iar fără `expose_headers` browserul
    # îl ascunde de JS — un client web nu putea paginile deloc. Pe mobil (RN) nu
    # se aplică politica CORS, de aceea a trecut neobservat.
    expose_headers=[REQUEST_ID_HEADER, "X-Next-Cursor"],
)
app.add_middleware(AccessLogMiddleware)
app.add_middleware(RequestContextMiddleware)


# --------------------------------------------------------------------------- #
# Handler global de excepții
# RO: orice excepție neprinsă e logată COMPLET (stack trace) pe server, dar
# clientul primește un răspuns GENERIC. Fără el, o eroare internă poate scurge
# detalii (căi de fișiere, SQL, DSN cu parolă) direct în răspuns. Singurul lucru
# pe care îl dăm înapoi e `request_id`-ul: userul îl raportează la suport, noi
# găsim exact cererea în log-uri.
# --------------------------------------------------------------------------- #
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Handler-ul rulează în ServerErrorMiddleware, care e ÎN AFARA
    # RequestContextMiddleware — contextul a fost deja curățat. Luăm id-ul de pe
    # `request.state` (pus tot de RequestContextMiddleware) și cădem pe context
    # doar dacă lipsește.
    request_id = getattr(request.state, "request_id", None) or get_request_id()
    route = request.scope.get("route")
    path = getattr(route, "path", None) or request.url.path
    log.exception(
        "unhandled exception",
        extra={
            "method": request.method,
            "path": path,
            "error_type": type(exc).__name__,
            "request_id": request_id,
        },
    )
    headers = {REQUEST_ID_HEADER: request_id} if request_id else None
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "request_id": request_id},
        headers=headers,
    )


app.include_router(api_router, prefix=settings.api_v1_prefix)
# Health checks la RĂDĂCINĂ (nu sub /api/v1): nginx, Docker healthcheck și
# load balancer-ele le caută acolo, iar ele nu fac parte din API-ul public.
app.include_router(health.router)
# Paginile legale (/legal/terms, /legal/privacy, /legal/support) — tot la RĂDĂCINĂ și
# tot în afara /api/v1: nu sunt API, sunt HTML citit de oameni (și de recenzentul App
# Store, NELOGAT). Fără dependență de autentificare — vezi app/api/legal.py.
app.include_router(legal.router)

# Media încărcată (poze de profil, story-uri) servită static când
# STORAGE_PROVIDER=local — GRATUIT, fără AWS. Fișierele trăiesc într-un volum
# Docker (STORAGE_LOCAL_DIR), iar URL-urile întoarse de `LocalStorage` pointează
# aici. Public, fără auth (media publică de profil), în afara /api/v1.
if settings.storage_provider == "local":
    import os

    from fastapi.staticfiles import StaticFiles

    os.makedirs(settings.storage_local_dir, exist_ok=True)
    app.mount(
        "/media",
        StaticFiles(directory=settings.storage_local_dir),
        name="media",
    )

"""Observabilitate: logging structurat JSON + request-id + acces log.

RO: Într-un incident de producție singura ta fereastră către sistem sunt
log-urile. Aici stau:

- `configure_logging()` — un singur handler pe stdout, format JSON (o linie =
  un eveniment). Docker/systemd/Loki/CloudWatch colectează stdout-ul.
- `RequestContextMiddleware` — atașează un `request_id` fiecărei cereri
  (îl preia din antetul `X-Request-ID` dacă vine de la proxy, altfel îl
  generează) și îl pune într-un `ContextVar`, ca ORICE log emis în timpul
  cererii să fie corelabil. Îl întoarce și în răspuns, în același antet.
- `AccessLogMiddleware` — o linie per cerere: metodă, cale, status, durată.

Zero dependențe noi: doar `logging`, `json`, `time`, `uuid` din stdlib.

PII: NU logăm niciodată body-uri, tokenuri, parole, mesaje de chat, telefoane
sau emailuri. Logăm doar metadate de transport (metodă, cale, status, durată).
Query string-ul e omis intenționat — poate conține date sensibile.
"""
from __future__ import annotations

import json
import logging
import sys
import time
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.config import settings
from starlette.responses import Response

# --------------------------------------------------------------------------- #
# Context per-cerere (corelare log-uri)
# --------------------------------------------------------------------------- #

REQUEST_ID_HEADER = "X-Request-ID"

_request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)


def get_request_id() -> str | None:
    """Request-id-ul cererii curente (None în afara unei cereri)."""
    return _request_id_ctx.get()


def set_request_id(value: str | None) -> None:
    _request_id_ctx.set(value)


def new_request_id() -> str:
    return uuid.uuid4().hex


# Antetul vine din exterior: îl acceptăm doar dacă e „cuminte" (id de corelare,
# nu vector de injecție în log-uri / header splitting).
_MAX_REQUEST_ID_LEN = 64


def _sanitize_request_id(raw: str | None) -> str:
    if not raw:
        return new_request_id()
    cleaned = "".join(c for c in raw.strip() if c.isalnum() or c in "-_")[
        :_MAX_REQUEST_ID_LEN
    ]
    return cleaned or new_request_id()


# --------------------------------------------------------------------------- #
# Formatter JSON
# --------------------------------------------------------------------------- #

# Câmpurile standard ale `LogRecord` — tot ce e în plus e „extra" pus de noi.
_RESERVED = set(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__
) | {"message", "asctime", "taskName"}


class JsonFormatter(logging.Formatter):
    """Formatter care scrie o linie JSON per eveniment.

    Include automat `request_id` din context (dacă există) și `extra`-urile
    pasate la apel (`logger.info("...", extra={"status": 500})`).
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": time.strftime(
                "%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)
            )
            + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }

        request_id = getattr(record, "request_id", None) or get_request_id()
        if request_id:
            payload["request_id"] = request_id

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        for key, value in record.__dict__.items():
            if key in _RESERVED or key == "request_id":
                continue
            payload[key] = value if _json_safe(value) else repr(value)

        return json.dumps(payload, ensure_ascii=False, default=str)


def _json_safe(value: object) -> bool:
    return isinstance(value, (str, int, float, bool, type(None), list, dict))


# --------------------------------------------------------------------------- #
# Configurare
# --------------------------------------------------------------------------- #

_configured = False


def configure_logging(level: str | None = None) -> None:
    """Instalează handler-ul JSON pe root logger (idempotent).

    Nivelul vine din `LOG_LEVEL` (implicit INFO). Formatul poate fi comutat pe
    text simplu în dev cu `LOG_FORMAT=text` (mai lizibil în terminal).
    """
    global _configured
    if _configured:
        return

    level_name = (level or settings.log_level).upper()
    log_format = settings.log_format.lower()

    handler = logging.StreamHandler(sys.stdout)
    if log_format == "text":
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        )
    else:
        handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    # Înlocuim handler-ele existente (gunicorn/uvicorn își pun ale lor) ca să
    # nu avem log-uri duplicate, în formate diferite.
    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(getattr(logging, level_name, logging.INFO))

    # Uvicorn/gunicorn: le lăsăm să propage către root (formatul nostru), fără
    # handler-ele lor proprii.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "gunicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True

    _configured = True


# --------------------------------------------------------------------------- #
# Middleware
# --------------------------------------------------------------------------- #


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Atașează un request-id fiecărei cereri (context + antet de răspuns)."""

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        request_id = _sanitize_request_id(request.headers.get(REQUEST_ID_HEADER))
        token = _request_id_ctx.set(request_id)
        request.state.request_id = request_id
        try:
            response: Response = await call_next(request)
            response.headers[REQUEST_ID_HEADER] = request_id
            return response
        finally:
            # Resetăm contextul chiar dacă cererea a aruncat: altfel request-id-ul
            # s-ar putea scurge într-o cerere ulterioară de pe același task.
            _request_id_ctx.reset(token)


class AccessLogMiddleware(BaseHTTPMiddleware):
    """O linie de log per cerere: metodă, cale, status, durată, request-id.

    NU logăm query string, body, antete (pot conține tokenuri/PII).
    """

    def __init__(self, app, logger_name: str = "app.access") -> None:
        super().__init__(app)
        self._log = logging.getLogger(logger_name)

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        started = time.perf_counter()
        status_code = 500
        try:
            response: Response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            # Ruta „template" (ex. /api/v1/profiles/{user_id}) evită
            # cardinalitatea infinită și scurgerea de ID-uri în log.
            route = request.scope.get("route")
            path = getattr(route, "path", None) or request.url.path
            self._log.info(
                "request",
                extra={
                    "method": request.method,
                    "path": path,
                    "status": status_code,
                    "duration_ms": duration_ms,
                    "client_ip": _client_ip(request),
                },
            )


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    if request.client and request.client.host:
        return request.client.host
    return "-"

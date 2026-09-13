"""Access log-ul: adresa clientului NU are voie să fie aleasă de client.

ACELAȘI DEFECT, A DOUA OARĂ
---------------------------
`ratelimit.client_ip` lua PRIMA intrare din `X-Forwarded-For` și a fost reparat:
antetul care ajunge la aplicație are forma produsă de
`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` —
„ce a inventat clientul, VIRGULĂ, IP-ul real al conexiunii" — deci singura
intrare pe care clientul NU o poate scrie e ULTIMA.

`logging._client_ip` avea copia defectă a aceleiași funcții. Consecința nu e un
plafon ratat, ci ceva mai rău pe termen lung: jurnalul de acces înregistra
adrese FABRICATE. Cine abuza API-ul își alegea singur ce adresă apare în
log-urile noastre, deci orice investigație („de la ce IP a venit valul ăsta?")
ducea la o victimă nevinovată sau la nimic.

CE VERIFICĂM
------------
1. Că există o SINGURĂ implementare (aceeași funcție, nu o a doua copie care
   poate diverge din nou la următoarea reparație).
2. Comportamentul, prin antete HTTP REALE — nu un `dict` pasat în locul
   antetelor. Antetele HTTP sunt insensibile la majuscule și sunt transportate
   lowercase de ASGI; un test care pune un `dict` cu cheia „X-Forwarded-For" în
   `request.headers` testează dicționarul, nu antetul.
"""
from __future__ import annotations

import logging as stdlib_logging

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from app.core import logging as app_logging
from app.core import ratelimit

# IP-ul adăugat de PROXY-UL nostru la capătul listei (adresa reală a conexiunii).
REAL_PEER = "203.0.113.7"
FORGED = "9.9.9.9"


def _request(xff: str | None, *, peer: str | None = REAL_PEER) -> Request:
    """Cerere ASGI minimă, cu antetele în forma REALĂ de transport.

    ASGI transportă numele antetelor lowercase, ca `list[tuple[bytes, bytes]]` —
    exact cum le primește aplicația de la uvicorn. Construim scope-ul, nu un
    dicționar pus peste `request.headers`.
    """
    headers: list[tuple[bytes, bytes]] = []
    if xff is not None:
        headers.append((b"x-forwarded-for", xff.encode()))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": headers,
            "client": (peer, 51234) if peer else None,
        }
    )


# --------------------------------------------------------------------------- #
# 1. O singură implementare
# --------------------------------------------------------------------------- #


def test_access_log_foloseste_exact_functia_din_ratelimit():
    """Anti-divergență: aceeași funcție, nu o a doua copie.

    Defectul a supraviețuit tocmai pentru că existau DOUĂ implementări ale
    aceleiași reguli. Reparând-o pe una, cealaltă rămâne greșită în tăcere.
    """
    assert app_logging._client_ip is ratelimit.client_ip


# --------------------------------------------------------------------------- #
# 2. Comportament
# --------------------------------------------------------------------------- #


def test_prefixul_fabricat_nu_ajunge_in_log():
    """Prima intrare e text scris de client; log-ul trebuie să ignore."""
    assert app_logging._client_ip(_request(f"{FORGED}, {REAL_PEER}")) == REAL_PEER


def test_lista_intreaga_de_intrari_fabricate_este_ignorata():
    assert (
        app_logging._client_ip(_request(f"1.1.1.1, 2.2.2.2, not-an-ip, {REAL_PEER}"))
        == REAL_PEER
    )


def test_fara_antet_ramane_adresa_conexiunii():
    assert app_logging._client_ip(_request(None)) == REAL_PEER


def test_fara_antet_si_fara_peer_nu_crapa():
    """Fără nimic de raportat întoarcem un marcaj, nu o excepție în middleware."""
    value = app_logging._client_ip(_request(None, peer=None))
    assert isinstance(value, str) and value


# --------------------------------------------------------------------------- #
# 3. End-to-end, prin middleware-ul real și un antet trimis de un client real
# --------------------------------------------------------------------------- #


def _tiny_app() -> Starlette:
    """Aplicație minimă cu DOAR middleware-ul de access log."""
    app = Starlette(routes=[Route("/ping", lambda request: PlainTextResponse("ok"))])
    app.add_middleware(app_logging.AccessLogMiddleware)
    return app


async def _access_record(caplog, headers: dict[str, str]):
    transport = ASGITransport(app=_tiny_app())
    with caplog.at_level(stdlib_logging.INFO, logger="app.access"):
        async with AsyncClient(transport=transport, base_url="http://t") as ac:
            resp = await ac.get("/ping", headers=headers)
    assert resp.status_code == 200
    records = [r for r in caplog.records if r.name == "app.access"]
    assert records, "middleware-ul de access log nu a emis nimic"
    return records[-1]


@pytest.mark.asyncio
async def test_middleware_logheaza_ultima_intrare_nu_prima(caplog):
    """Antet scris de un client HTTP real (nume cu majuscule, ca în browser).

    Clientul HTTP normalizează numele antetului la transport — de asta testul
    trece prin `AsyncClient` și nu injectează un dicționar.
    """
    record = await _access_record(
        caplog, {"X-Forwarded-For": f"{FORGED}, {REAL_PEER}"}
    )
    assert record.client_ip == REAL_PEER
    assert record.client_ip != FORGED
    assert FORGED not in str(record.__dict__)


@pytest.mark.asyncio
async def test_middleware_accepta_antetul_scris_cu_alte_majuscule(caplog):
    """`x-FORWARDED-for` e ACELAȘI antet: HTTP e insensibil la majuscule."""
    record = await _access_record(
        caplog, {"x-FORWARDED-for": f"{FORGED}, {REAL_PEER}"}
    )
    assert record.client_ip == REAL_PEER

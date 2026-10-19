"""ETag + Cache-Control pentru răspunsurile JSON ale API-ului (middleware ASGI pur).

DE CE
-----
Mini App-ul re-cere aceleași liste (feed, chaturi, profil, capabilități) la
fiecare revenire pe ecran. Fără validatori, fiecare cerere descarcă tot corpul
JSON din nou, pe o rețea mobilă. Cu `ETag`, browserul/WebView-ul trimite
`If-None-Match`, iar dacă nimic nu s-a schimbat primește `304` FĂRĂ corp.

CE FACE
-------
Doar pentru `GET` cu răspuns `200`, `Content-Type: application/json`, sub
512 KB, necomprimat și fără `Cache-Control: no-store`:

- `ETag` slab = sha1(corp + antetul `X-Next-Cursor`, dacă există). Cursorul de
  paginare stă în ANTET, nu în corp: două pagini cu același corp dar cursoare
  diferite NU au voie să primească același ETag (clientul ar continua de la
  cursorul vechi).
- `If-None-Match` potrivit → `304` fără corp (antetele de cache rămân).
- `Cache-Control`: `private, no-cache` implicit (orice răspuns poate depinde de
  utilizator — se revalidează mereu, nu se păstrează în cache-uri partajate).
  `public` DOAR pe rute care sigur nu depind de utilizator: catalogul de
  referință, capabilitățile serverului, documentele legale.
  Un `Cache-Control` pus explicit de endpoint e respectat.

CE NU ATINGE
------------
Metodele care modifică (POST/PUT/PATCH/DELETE), răspunsurile streaming (fără
`Content-Length`) sau fișiere (alt Content-Type), răspunsurile mari (trec
neschimbate, în flux).

ORDINEA ÎN `main.py`: înregistrat ÎNAINTEA lui `CORSMiddleware` (adică mai în
interior), ca și răspunsul `304` construit aici să primească antetele CORS —
altfel browserul l-ar trata ca eroare de rețea.

Nu folosim `BaseHTTPMiddleware`: ar bufferiza ORICE răspuns (inclusiv fișiere)
și are probleme cunoscute cu contextul și streaming-ul.
"""
from __future__ import annotations

import hashlib
from collections.abc import Iterable

from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Peste pragul ăsta nu mai bufferizăm corpul în memorie: răspunsul trece în flux.
MAX_BODY_BYTES = 512 * 1024

DEFAULT_CACHE_CONTROL = "private, no-cache"

CURSOR_HEADER = b"x-next-cursor"


def _strip_weak(tag: str) -> str:
    tag = tag.strip()
    return tag[2:] if tag.startswith(("W/", "w/")) else tag


def _etag_matches(if_none_match: str, etag: str) -> bool:
    """Comparație SLABĂ (RFC 9110 §13.1.2): `W/"x"` == `"x"`; `*` potrivește orice."""
    if if_none_match.strip() == "*":
        return True
    ours = _strip_weak(etag)
    return any(_strip_weak(candidate) == ours for candidate in if_none_match.split(","))


def _header(headers: Iterable[tuple[bytes, bytes]], name: bytes) -> bytes | None:
    for key, value in headers:
        if key.lower() == name:
            return value
    return None


class HTTPCacheMiddleware:
    """ETag + revalidare 304 + Cache-Control pe GET-urile JSON."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        public_paths: dict[str, str] | None = None,
        public_prefixes: dict[str, str] | None = None,
    ) -> None:
        self.app = app
        # cale exactă → valoarea Cache-Control publică
        self.public_paths = public_paths or {}
        # prefix → valoarea Cache-Control publică
        self.public_prefixes = public_prefixes or {}

    def _cache_control_for(self, path: str) -> str:
        normalized = path.rstrip("/") or "/"
        if normalized in self.public_paths:
            return self.public_paths[normalized]
        for prefix, value in self.public_prefixes.items():
            if path.startswith(prefix):
                return value
        return DEFAULT_CACHE_CONTROL

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "GET":
            await self.app(scope, receive, send)
            return

        if_none_match: str | None = None
        for key, value in scope.get("headers") or ():
            if key == b"if-none-match":
                if_none_match = value.decode("latin-1")
                break

        start: Message | None = None
        chunks: list[bytes] = []
        size = 0
        # "undecided" → încă nu știm; "buffer" → candidat la ETag; "pass" → în flux
        mode = "undecided"

        async def send_wrapper(message: Message) -> None:
            nonlocal start, size, mode

            if mode == "pass":
                await send(message)
                return

            if message["type"] == "http.response.start":
                start = message
                headers = message.get("headers") or []
                content_type = (_header(headers, b"content-type") or b"").lower()
                cache_control = (_header(headers, b"cache-control") or b"").lower()
                eligible = (
                    message["status"] == 200
                    and content_type.startswith(b"application/json")
                    and _header(headers, b"content-encoding") is None
                    # Fără Content-Length = răspuns streaming (StreamingResponse,
                    # SSE, NDJSON): îl lăsăm să curgă, nu îl bufferizăm.
                    and _header(headers, b"content-length") is not None
                    and b"no-store" not in cache_control
                )
                if eligible:
                    mode = "buffer"
                else:
                    mode = "pass"
                    await send(message)
                return

            if message["type"] != "http.response.body":  # ex. trailers / extensii
                await send(message)
                return

            body = message.get("body", b"")
            size += len(body)
            if size > MAX_BODY_BYTES:
                # Prea mare pentru ETag: livrăm ce am strâns și trecem în flux.
                mode = "pass"
                chunks.append(body)
                more = message.get("more_body", False)
                await send(start)  # type: ignore[arg-type]
                await send(
                    {"type": "http.response.body", "body": b"".join(chunks), "more_body": more}
                )
                chunks.clear()
                return

            chunks.append(body)
            if message.get("more_body", False):
                return

            await self._finish(start, b"".join(chunks), if_none_match, send, scope)  # type: ignore[arg-type]

        await self.app(scope, receive, send_wrapper)

    async def _finish(
        self,
        start: Message,
        body: bytes,
        if_none_match: str | None,
        send: Send,
        scope: Scope,
    ) -> None:
        headers: list[tuple[bytes, bytes]] = list(start.get("headers") or [])

        digest = hashlib.sha1(body)
        cursor = _header(headers, CURSOR_HEADER)
        if cursor:
            digest.update(b"\x00cursor:")
            digest.update(cursor)
        etag = f'W/"{digest.hexdigest()}"'

        headers = [(k, v) for k, v in headers if k.lower() != b"etag"]
        headers.append((b"etag", etag.encode("latin-1")))
        if _header(headers, b"cache-control") is None:
            value = self._cache_control_for(scope.get("path", ""))
            headers.append((b"cache-control", value.encode("latin-1")))

        if if_none_match and _etag_matches(if_none_match, etag):
            # 304: fără corp și fără antetele care descriu corpul.
            not_modified = [
                (k, v)
                for k, v in headers
                if k.lower() not in (b"content-length", b"content-type")
            ]
            await send(
                {"type": "http.response.start", "status": 304, "headers": not_modified}
            )
            await send({"type": "http.response.body", "body": b"", "more_body": False})
            return

        await send({**start, "headers": headers})
        await send({"type": "http.response.body", "body": body, "more_body": False})

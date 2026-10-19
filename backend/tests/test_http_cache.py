"""ETag / 304 / Cache-Control (app/core/http_cache.py) + CORS max_age.

Middleware-ul e testat pe o aplicație Starlette minimă (comportament exact,
fără DB) și pe aplicația REALĂ pentru ce contează la integrare: ordinea față de
CORSMiddleware (304 trebuie să poarte antetele CORS) și regulile de cache public.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import JSONResponse, PlainTextResponse, StreamingResponse
from starlette.routing import Route

from app.core.config import settings
from app.core.http_cache import MAX_BODY_BYTES, HTTPCacheMiddleware
from app.main import app

API = settings.api_v1_prefix.rstrip("/")


# --------------------------------------------------------------------------- #
# Aplicația minimă
# --------------------------------------------------------------------------- #


async def _items(request):
    cursor = request.query_params.get("cursor")
    headers = {"X-Next-Cursor": cursor} if cursor else {}
    return JSONResponse({"items": [1, 2, 3]}, headers=headers)


async def _write(request):
    return JSONResponse({"ok": True})


async def _no_store(request):
    return JSONResponse({"secret": 1}, headers={"Cache-Control": "no-store"})


async def _text(request):
    return PlainTextResponse("salut " * 500)


async def _stream(request):
    async def gen():
        yield b'{"a":'
        yield b"1}"

    return StreamingResponse(gen(), media_type="application/json")


async def _big(request):
    return JSONResponse({"x": "a" * (MAX_BODY_BYTES + 10)})


async def _public(request):
    return JSONResponse({"catalog": True})


async def _error(request):
    return JSONResponse({"detail": "nu"}, status_code=404)


mini = Starlette(
    routes=[
        Route("/items", _items),
        Route("/items", _write, methods=["POST"]),
        Route("/no-store", _no_store),
        Route("/text", _text),
        Route("/stream", _stream),
        Route("/big", _big),
        Route("/pub", _public),
        Route("/docs/{doc}", _public),
        Route("/missing", _error),
    ],
    middleware=[
        Middleware(
            HTTPCacheMiddleware,
            public_paths={"/pub": "public, max-age=300"},
            public_prefixes={"/docs/": "public, max-age=3600"},
        )
    ],
)


@pytest.fixture
async def mc():
    async with AsyncClient(transport=ASGITransport(app=mini), base_url="http://t") as c:
        yield c


async def test_get_json_primeste_etag_slab_si_private_no_cache(mc):
    r = await mc.get("/items")
    assert r.status_code == 200
    assert r.headers["etag"].startswith('W/"')
    assert r.headers["cache-control"] == "private, no-cache"
    assert r.json() == {"items": [1, 2, 3]}


async def test_if_none_match_potrivit_da_304_fara_corp(mc):
    etag = (await mc.get("/items")).headers["etag"]

    r = await mc.get("/items", headers={"If-None-Match": etag})
    assert r.status_code == 304
    assert r.content == b""
    assert r.headers["etag"] == etag
    assert r.headers["cache-control"] == "private, no-cache"
    assert "content-type" not in r.headers


async def test_comparatie_slaba_si_lista_de_etaguri(mc):
    etag = (await mc.get("/items")).headers["etag"]
    strong = etag[2:]  # fără W/

    r = await mc.get("/items", headers={"If-None-Match": f'"altceva", {strong}'})
    assert r.status_code == 304


async def test_if_none_match_vechi_da_200_cu_corp(mc):
    r = await mc.get("/items", headers={"If-None-Match": 'W/"vechi"'})
    assert r.status_code == 200
    assert r.json() == {"items": [1, 2, 3]}


async def test_cursor_diferit_inseamna_etag_diferit(mc):
    """Corpul e identic, cursorul (în antet) nu: ETag-ul TREBUIE să difere."""
    a = await mc.get("/items", params={"cursor": "abc"})
    b = await mc.get("/items", params={"cursor": "xyz"})
    fara = await mc.get("/items")

    assert a.content == b.content == fara.content
    assert len({a.headers["etag"], b.headers["etag"], fara.headers["etag"]}) == 3

    # Și: ETag-ul paginii `abc` nu validează pagina `xyz`.
    r = await mc.get("/items", params={"cursor": "xyz"}, headers={"If-None-Match": a.headers["etag"]})
    assert r.status_code == 200
    assert r.headers["x-next-cursor"] == "xyz"


async def test_post_nu_primeste_etag_si_nici_cache(mc):
    r = await mc.post("/items", headers={"If-None-Match": "*"})
    assert r.status_code == 200
    assert "etag" not in r.headers
    assert "cache-control" not in r.headers


async def test_no_store_al_endpointului_e_respectat(mc):
    r = await mc.get("/no-store")
    assert r.headers["cache-control"] == "no-store"
    assert "etag" not in r.headers


@pytest.mark.parametrize("path", ["/text", "/stream", "/missing"])
async def test_non_json_streaming_si_erorile_nu_sunt_atinse(mc, path):
    r = await mc.get(path)
    assert "etag" not in r.headers
    assert "cache-control" not in r.headers


async def test_streaming_ramane_intact(mc):
    r = await mc.get("/stream")
    assert r.json() == {"a": 1}


async def test_raspuns_mare_trece_neschimbat(mc):
    r = await mc.get("/big")
    assert r.status_code == 200
    assert "etag" not in r.headers
    assert len(r.json()["x"]) == MAX_BODY_BYTES + 10


async def test_cache_public_doar_pe_rutele_declarate(mc):
    assert (await mc.get("/pub")).headers["cache-control"] == "public, max-age=300"
    assert (await mc.get("/docs/terms")).headers["cache-control"] == "public, max-age=3600"
    assert (await mc.get("/items")).headers["cache-control"] == "private, no-cache"


# --------------------------------------------------------------------------- #
# Aplicația reală: ordinea față de CORS + reguli publice
# --------------------------------------------------------------------------- #

ORIGIN = settings.cors_origins_list[0] if settings.cors_origins_list else "http://localhost:8081"


@pytest.fixture
async def real():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.skipif(not settings.cors_origins_list, reason="fără origini CORS configurate")
async def test_304_poarta_antetele_cors(real):
    """Un 304 fără `Access-Control-Allow-Origin` = eroare de rețea în browser."""
    first = await real.get(f"{API}/capabilities", headers={"Origin": ORIGIN})
    assert first.status_code == 200
    etag = first.headers["etag"]

    r = await real.get(
        f"{API}/capabilities", headers={"Origin": ORIGIN, "If-None-Match": etag}
    )
    assert r.status_code == 304
    assert r.headers["access-control-allow-origin"] == ORIGIN
    assert "x-next-cursor" in r.headers["access-control-expose-headers"].lower()


async def test_capabilities_are_cache_public_scurt(real):
    r = await real.get(f"{API}/capabilities")
    assert r.headers["cache-control"] == "public, max-age=300"


async def test_ruta_cu_utilizator_nu_e_niciodata_publica(real):
    """Un răspuns care depinde de utilizator nu are voie în cache-uri partajate."""
    from app.main import app as real_app

    mw = next(m for m in real_app.user_middleware if m.cls is HTTPCacheMiddleware)
    public = {**mw.kwargs["public_paths"], **mw.kwargs["public_prefixes"]}
    assert set(public) == {
        f"{API}/capabilities",
        f"{API}/profiles/reference",
        f"{API}/legal/documents/",
    }


@pytest.mark.skipif(not settings.cors_origins_list, reason="fără origini CORS configurate")
async def test_preflight_cors_e_cacheuit_2_ore(real):
    r = await real.options(
        f"{API}/feed",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-max-age"] == "7200"


async def test_middleware_cache_e_in_interiorul_cors():
    """`user_middleware[0]` = cel mai din exterior. HTTPCache trebuie DUPĂ CORS."""
    from fastapi.middleware.cors import CORSMiddleware

    order = [m.cls for m in app.user_middleware]
    assert order.index(CORSMiddleware) < order.index(HTTPCacheMiddleware)


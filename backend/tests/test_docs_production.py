"""/docs, /redoc, /openapi.json nu sunt servite în producție."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.main import _docs_kwargs, app


# --------------------------------------------------------------------------- #
# /docs, /redoc, /openapi.json — închise în producție
# --------------------------------------------------------------------------- #


async def test_documentatia_e_inchisa_in_productie():
    prod = FastAPI(**_docs_kwargs("production"))
    async with AsyncClient(transport=ASGITransport(app=prod), base_url="http://t") as c:
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert (await c.get(path)).status_code == 404, path


@pytest.mark.parametrize("env", ["development", "staging"])
def test_documentatia_ramane_in_dev_si_staging(env):
    assert _docs_kwargs(env) == {
        "docs_url": "/docs",
        "redoc_url": "/redoc",
        "openapi_url": "/openapi.json",
    }


async def test_aplicatia_curenta_de_test_serveste_openapi():
    assert settings.environment != "production"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.get("/openapi.json")).status_code == 200

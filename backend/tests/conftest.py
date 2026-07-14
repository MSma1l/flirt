"""Fixturi comune de test — rulează pe POSTGRESQL real (ca producția).

DE CE POSTGRES, NU SQLITE
-------------------------
Producția rulează pe PostgreSQL. Testele TREBUIE să ruleze pe același motor, altfel
apar bug-uri care trec în teste și cad în producție. S-a întâmplat concret: seeder-ul
insera copii înaintea părinților — pe SQLite mergea (foreign-key-urile sunt oprite
implicit), pe Postgres real pica cu ForeignKeyViolationError. Un test pe SQLite care
promite „verde" în timp ce Postgres ar refuza operația e mai rău decât niciun test.

CUM SE OBȚINE POSTGRES
----------------------
- Dacă `TEST_DATABASE_URL` e setat (ex. în CI, cu un serviciu Postgres), îl folosim.
- Altfel pornim automat un container Postgres efemer prin `testcontainers` (are nevoie
  de Docker). Zero pași manuali: `pytest` își provizionează singur baza.

IZOLARE ÎNTRE TESTE
-------------------
Schema se creează O SINGURĂ DATĂ; înaintea fiecărui test golim TOATE tabelele
(`TRUNCATE ... RESTART IDENTITY CASCADE`) — slate curat, rapid, fără DDL per test.
"""
import os

# Mediu de test determinist ÎNAINTE de importul aplicației.
os.environ.setdefault("ENVIRONMENT", "development")

# TESTELE TREBUIE SĂ FIE ERMETICE. `Settings` citește `.env` (env_file), deci pe o
# mașină cu un `.env` local (ex. cel folosit ca să ridici stack-ul în Docker) testele
# preluau valori de acolo: `REDIS_URL=redis://redis:6379/0` arăta spre un host care
# există DOAR în rețeaua Docker, iar readiness-ul pica cu 503 — teste roșii fără nicio
# legătură cu codul. Un `.env` prezent nu are voie să schimbe rezultatul testelor.
os.environ["REDIS_URL"] = ""  # rate-limit in-memory + readiness fără Redis, în teste

# --- Provizionăm PostgreSQL ÎNAINTE de a importa aplicația -------------------------
# (engine-ul aplicației se creează la import din DATABASE_URL — trebuie să existe deja.)
_PG_CONTAINER = None


def _ensure_test_database_url() -> str:
    """Întoarce un DATABASE_URL de Postgres pentru teste; pornește un container dacă
    nu e furnizat unul din mediu (CI). Setează și `os.environ` pentru app import."""
    global _PG_CONTAINER
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        os.environ["DATABASE_URL"] = url
        return url

    from testcontainers.postgres import PostgresContainer

    _PG_CONTAINER = PostgresContainer("postgres:16-alpine")
    _PG_CONTAINER.start()
    # testcontainers dă un URL psycopg2 sync — îl convertim la asyncpg.
    raw = _PG_CONTAINER.get_connection_url()  # postgresql+psycopg2://...
    url = raw.replace("postgresql+psycopg2://", "postgresql+asyncpg://").replace(
        "postgresql://", "postgresql+asyncpg://"
    )
    os.environ["DATABASE_URL"] = url
    return url


_ensure_test_database_url()

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.db.session import AsyncSessionLocal, engine as app_engine, get_db  # noqa: E402
from app.main import app  # noqa: E402

# Chei RSA efemere de test, generate în proces (nu se comită chei reale).
from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402

_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_priv = _key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
).decode()
_pub = (
    _key.public_key()
    .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    .decode()
)
os.environ["JWT_PRIVATE_KEY"] = _priv
os.environ["JWT_PUBLIC_KEY"] = _pub

_schema_ready = False


def pytest_sessionfinish(session, exitstatus):
    """Oprește containerul Postgres la sfârșitul rulării, dacă l-am pornit noi."""
    if _PG_CONTAINER is not None:
        _PG_CONTAINER.stop()


async def _truncate_all(conn) -> None:
    """Golește TOATE tabelele — slate curat între teste, fără a recrea schema."""
    tables = ", ".join(f'"{t.name}"' for t in reversed(Base.metadata.sorted_tables))
    if tables:
        await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest_asyncio.fixture
async def engine():
    """Engine-ul APLICAȚIEI (același ca în producție, doar cu DB de test).

    Expus separat ca testele de performanță să atașeze un event listener
    (`before_cursor_execute`) și să NUMERE query-urile SQL. Schema se creează o
    dată; înaintea fiecărui test golim tabelele (izolare).
    """
    global _schema_ready
    async with app_engine.begin() as conn:
        if not _schema_ready:
            await conn.run_sync(Base.metadata.create_all)
            _schema_ready = True
        await _truncate_all(conn)
    yield app_engine
    # Nu facem dispose: engine-ul aplicației e refolosit între teste (pool comun).


@pytest_asyncio.fixture
async def db_session(engine):
    """Sesiune de test — ACELAȘI `AsyncSessionLocal` ca aplicația (config identică)."""
    async with AsyncSessionLocal() as session:
        yield session


@pytest_asyncio.fixture
async def client(db_session):
    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()

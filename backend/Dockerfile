# FLIRT backend — imagine de producție (multi-stage, slim)
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependențe de sistem minime (build asyncpg / cryptography)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
# Instalăm DOAR dependențele (inclusiv extras-ul `live`), nu pachetul în sine.
#
# De ce nu `pip install ".[live]"`: aplicația rulează din /app ca `app.main:app`, deci
# nu trebuie instalată ca pachet — dar `pip install .` construiește oricum un wheel,
# iar pentru asta are nevoie de directorul `app/`, care e copiat abia mai jos. Rezultat:
# build-ul eșua cu „package directory 'app' does not exist". Imaginea NU s-a construit
# niciodată cu succes.
#
# De ce nu mutăm pur și simplu `COPY . .` mai sus: atunci orice modificare de cod ar
# invalida layer-ul de pip și ar reinstala toate dependențele la fiecare deploy.
# Așa, layer-ul se invalidează doar când se schimbă `pyproject.toml`.
RUN pip install --upgrade pip && \
    python -c "\
import tomllib; \
d = tomllib.load(open('pyproject.toml', 'rb'))['project']; \
deps = d['dependencies'] + d.get('optional-dependencies', {}).get('live', []); \
open('/tmp/requirements.txt', 'w').write('\n'.join(deps))" && \
    pip install -r /tmp/requirements.txt

COPY . .

# Utilizator non-root
RUN useradd -m appuser && chown -R appuser:appuser /app
# Directorul de media (STORAGE_PROVIDER=local) e proprietatea lui appuser din
# imagine. Când volumul Docker `mediadata` se montează prima dată gol peste el,
# Docker COPIAZĂ această proprietate în volum → appuser poate scrie fără chown
# manual. (Pe volumele deja create ca root, se face un chown o singură dată.)
RUN mkdir -p /data/media && chown -R appuser:appuser /data
USER appuser

EXPOSE 8000

# Readiness REAL (SELECT 1 pe DB + PING pe Redis), nu un 200 static — ca imaginea
# să fie corectă și în afara docker-compose (Swarm, ECS, k8s fără probe proprii).
# `start-period` acoperă migrațiile Alembic din entrypoint.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://localhost:8000/health/ready || exit 1

# Migrații + gunicorn (workeri uvicorn)
COPY entrypoint.sh /entrypoint.sh
CMD ["/entrypoint.sh"]

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
# Imagine de producție: include dependențele integrărilor LIVE.
RUN pip install --upgrade pip && pip install ".[live]"

COPY . .

# Utilizator non-root
RUN useradd -m appuser && chown -R appuser:appuser /app
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

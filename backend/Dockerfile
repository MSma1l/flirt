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
RUN pip install --upgrade pip && pip install .

COPY . .

# Utilizator non-root
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Migrații + gunicorn (workeri uvicorn)
COPY entrypoint.sh /entrypoint.sh
CMD ["/entrypoint.sh"]

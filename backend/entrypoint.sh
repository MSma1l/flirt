#!/usr/bin/env sh
set -e

echo "→ Rulez migrațiile Alembic..."
alembic upgrade head

echo "→ Pornesc gunicorn (uvicorn workers)..."
exec gunicorn app.main:app \
  --workers "${WEB_CONCURRENCY:-4}" \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --access-logfile - \
  --error-logfile -

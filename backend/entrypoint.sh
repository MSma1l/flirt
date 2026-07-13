#!/usr/bin/env sh
set -e

echo "→ Rulez migrațiile Alembic..."
alembic upgrade head

echo "→ Pornesc gunicorn (uvicorn workers)..."
# --forwarded-allow-ips: acceptăm X-Forwarded-* DOAR de la reverse proxy (nginx,
#   în rețeaua Docker). Fără el uvicorn ignoră X-Forwarded-Proto și consideră
#   cererile HTTP chiar dacă vin prin TLS.
# Access log-ul gunicorn e OPRIT intenționat: îl emite AccessLogMiddleware în
#   format JSON structurat, cu request-id (vezi app/core/logging.py). Două
#   log-uri de acces în formate diferite = zgomot și dublă stocare.
exec gunicorn app.main:app \
  --workers "${WEB_CONCURRENCY:-4}" \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-*}" \
  --timeout "${GUNICORN_TIMEOUT:-60}" \
  --graceful-timeout "${GUNICORN_GRACEFUL_TIMEOUT:-30}" \
  --error-logfile -

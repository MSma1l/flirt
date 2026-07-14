#!/usr/bin/env sh
set -e

# ---------------------------------------------------------------------------- #
# 0. Verificare .env: au rămas valori NECOMPLETATE?
# ---------------------------------------------------------------------------- #
# Guardul din app/core/config.py prinde variabilele GOALE și providerii pe 'stub',
# dar NU poate prinde un `.env` copiat și necompletat: pentru el,
# `JWT_PRIVATE_KEY=<<< COMPLETEAZĂ >>>` e un șir nevid, deci „valid". Aplicația ar
# porni „sănătoasă" și ar crăpa abia la primul login real (PEM invalid) — exact
# genul de eroare care ajunge în producție, pe utilizatori.
# Verificăm AICI, la pornire, și ne oprim cu un mesaj limpede.
UNFILLED="$(env | grep 'COMPLETEAZĂ' | cut -d= -f1 || true)"
if [ -n "$UNFILLED" ]; then
    echo "✗ .env NU e completat. Variabile rămase cu <<< COMPLETEAZĂ >>>:"
    echo "$UNFILLED" | sed 's/^/    - /'
    echo "  Completează-le în backend/.env (vezi .env.production.example) și repornește."
    exit 1
fi

# Cheia privată JWT trebuie să fie un PEM real, nu un text oarecare. Fără asta,
# fiecare cerere de login ar întoarce 500 în producție.
if [ "${ENVIRONMENT:-development}" = "production" ]; then
    case "${JWT_PRIVATE_KEY:-}" in
        *"-----BEGIN"*"PRIVATE KEY-----"*) : ;;
        *)
            echo "✗ JWT_PRIVATE_KEY nu arată a cheie PEM (lipsește '-----BEGIN ... PRIVATE KEY-----')."
            echo "  Generează: openssl genrsa -out private.pem 2048"
            echo "  și pune-o în .env pe o singură linie (procedura din docs/DEPLOYMENT.md)."
            exit 1
            ;;
    esac
fi

# Migrațiile rulează AUTOMAT la fiecare pornire a containerului — de asta
# `docker compose up --build -d` e suficient pe un server curat: nu există un pas
# manual „rulează întâi migrațiile".
#
# Retry: `depends_on: service_healthy` garantează că Postgres a răspuns la
# `pg_isready`, dar între acel moment și prima conexiune reală mai poate exista o
# fereastră (DB în recuperare după un restart brusc, disc lent). O eroare
# tranzitorie nu are voie să lase containerul într-un crash-loop.
ATTEMPTS="${MIGRATION_ATTEMPTS:-5}"
DELAY="${MIGRATION_RETRY_SECONDS:-3}"

i=1
while :; do
    echo "→ Rulez migrațiile Alembic (încercarea $i/$ATTEMPTS)..."
    if alembic upgrade head; then
        echo "→ Migrații OK."
        break
    fi
    if [ "$i" -ge "$ATTEMPTS" ]; then
        echo "✗ Migrațiile au eșuat după $ATTEMPTS încercări. Nu pornesc API-ul cu o"
        echo "  schemă necunoscută — ar corupe date. Verifică: docker compose logs db"
        exit 1
    fi
    echo "  eșec; reîncerc peste ${DELAY}s"
    sleep "$DELAY"
    i=$((i + 1))
done

# NUMĂRUL DE WORKERI — AUTO-SCALARE DUPĂ RAM.
# Dacă `WEB_CONCURRENCY` nu e setat explicit, îl calculăm din RAM-ul REAL al
# containerului, ca ACEEAȘI imagine să folosească tot ce are la dispoziție:
# 2 workeri pe un VPS de 1 GB, mulți pe unul de 8 GB, fără nicio schimbare
# manuală după un upgrade de plan. Așa cererea „folosește tot RAM-ul" se
# îndeplinește singură — pe orice hardware.
#
# Formula: reservăm ~450 MB pentru OS + kernel, socotim ~180 MB per worker
# uvicorn (FastAPI + SQLAlchemy + pool), și plafonăm la 2·nproc+1 (peste atât,
# workerii se bat pe CPU degeaba). Minim 2.
if [ -z "${WEB_CONCURRENCY}" ]; then
    RAM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 1024)
    CPUS=$(nproc 2>/dev/null || echo 2)
    BY_RAM=$(( (RAM_MB - 450) / 180 ))
    BY_CPU=$(( 2 * CPUS + 1 ))
    WEB_CONCURRENCY=$BY_RAM
    [ "$WEB_CONCURRENCY" -gt "$BY_CPU" ] && WEB_CONCURRENCY=$BY_CPU
    [ "$WEB_CONCURRENCY" -lt 2 ] && WEB_CONCURRENCY=2
    echo "→ WEB_CONCURRENCY auto: ${WEB_CONCURRENCY} workeri (RAM ${RAM_MB}MB, ${CPUS} CPU)"
fi

echo "→ Pornesc gunicorn (uvicorn workers)..."
# --forwarded-allow-ips: acceptăm X-Forwarded-* DOAR de la reverse proxy (nginx,
#   în rețeaua Docker). Fără el uvicorn ignoră X-Forwarded-Proto și consideră
#   cererile HTTP chiar dacă vin prin TLS.
# Access log-ul gunicorn e OPRIT intenționat: îl emite AccessLogMiddleware în
#   format JSON structurat, cu request-id (vezi app/core/logging.py). Două
#   log-uri de acces în formate diferite = zgomot și dublă stocare.
exec gunicorn app.main:app \
  --workers "${WEB_CONCURRENCY}" \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-*}" \
  --timeout "${GUNICORN_TIMEOUT:-60}" \
  --graceful-timeout "${GUNICORN_GRACEFUL_TIMEOUT:-30}" \
  --error-logfile -

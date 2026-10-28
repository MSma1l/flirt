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

# ---------------------------------------------------------------------------- #
# 0b. Producția rulează DOAR pe Kubernetes (k3s).
# ---------------------------------------------------------------------------- #
# Din 28.10.2026 producția e pe k3s (deploy/k8s/). Un `docker compose up` rătăcit
# pe server, cu .env-ul de producție, ar porni un al doilea API care scrie într-o
# bază veche. Kubernetes injectează KUBERNETES_SERVICE_HOST în ORICE pod; lipsa
# ei = nu suntem în cluster → refuzăm. Ieșire de urgență, conștientă:
# ALLOW_PROD_OUTSIDE_K8S=1.
if [ "${ENVIRONMENT:-development}" = "production" ] \
    && [ -z "${KUBERNETES_SERVICE_HOST:-}" ] \
    && [ "${ALLOW_PROD_OUTSIDE_K8S:-0}" != "1" ]; then
    echo "✗ ENVIRONMENT=production în afara Kubernetes — refuz să pornesc."
    echo "  Producția rulează pe k3s: deploy/k8s/scripts/deploy.sh"
    echo "  (runbook: deploy/k8s/scripts/README.md)."
    echo "  docker compose e DOAR pentru dezvoltare locală (ENVIRONMENT=development)."
    echo "  Urgență, conștient: ALLOW_PROD_OUTSIDE_K8S=1."
    exit 1
fi

# Migrațiile rulează AUTOMAT la fiecare pornire a containerului (dev: docker
# compose) — nu există un pas manual „rulează întâi migrațiile".
#
# Retry: `depends_on: service_healthy` garantează că Postgres a răspuns la
# `pg_isready`, dar între acel moment și prima conexiune reală mai poate exista o
# fereastră (DB în recuperare după un restart brusc, disc lent). O eroare
# tranzitorie nu are voie să lase containerul într-un crash-loop.
#
# RUN_MIGRATIONS=0 (k8s): migrațiile le rulează O SINGURĂ DATĂ Job-ul `migrate`,
# ÎNAINTE de rollout (deploy/k8s/scripts/deploy.sh). Cu N replici, N procese
# `alembic upgrade` pornite simultan s-ar bate pe aceeași schemă. Implicit 1
# (dezvoltare locală cu docker compose).
if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
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
            echo "  schemă necunoscută — ar corupe date. Verifică log-urile bazei de date."
            exit 1
        fi
        echo "  eșec; reîncerc peste ${DELAY}s"
        sleep "$DELAY"
        i=$((i + 1))
    done
else
    echo "→ RUN_MIGRATIONS=${RUN_MIGRATIONS} → sar peste migrații (le rulează Job-ul migrate)."
fi

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
#
# LIMITELE CONTAINERULUI (cgroup) au prioritate: /proc/meminfo și `nproc` arată
# resursele HOST-ului, nu limitele containerului (resources.limits în k8s). Fără
# corecția asta, pe un host mare cu limită de memorie setată am porni workeri
# calculați pentru tot RAM-ul host-ului → OOM-kill în buclă.
if [ -z "${WEB_CONCURRENCY:-}" ]; then
    RAM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 1024)
    CPUS=$(nproc 2>/dev/null || echo 2)
    # cgroup v2: memory.max = octeți sau „max"; v1: memory.limit_in_bytes.
    CG_MEM=""
    if [ -r /sys/fs/cgroup/memory.max ]; then
        CG_MEM=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || true)
    elif [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
        CG_MEM=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || true)
    fi
    case "$CG_MEM" in
        ''|max|*[!0-9]*) : ;;
        *)
            CG_MEM_MB=$(( CG_MEM / 1048576 ))
            if [ "$CG_MEM_MB" -gt 0 ] && [ "$CG_MEM_MB" -lt "$RAM_MB" ]; then
                RAM_MB=$CG_MEM_MB
            fi
            ;;
    esac
    # cgroup v2: cpu.max = „<quota> <period>" sau „max <period>".
    if [ -r /sys/fs/cgroup/cpu.max ]; then
        CG_QUOTA=""; CG_PERIOD=""
        read -r CG_QUOTA CG_PERIOD < /sys/fs/cgroup/cpu.max || true
        case "${CG_QUOTA}:${CG_PERIOD}" in
            max:*|:*|*:|*[!0-9:]*) : ;;
            *)
                CG_CPUS=$(( (CG_QUOTA + CG_PERIOD - 1) / CG_PERIOD ))
                if [ "$CG_CPUS" -gt 0 ] && [ "$CG_CPUS" -lt "$CPUS" ]; then
                    CPUS=$CG_CPUS
                fi
                ;;
        esac
    fi
    BY_RAM=$(( (RAM_MB - 450) / 180 ))
    BY_CPU=$(( 2 * CPUS + 1 ))
    WEB_CONCURRENCY=$BY_RAM
    [ "$WEB_CONCURRENCY" -gt "$BY_CPU" ] && WEB_CONCURRENCY=$BY_CPU
    [ "$WEB_CONCURRENCY" -lt 2 ] && WEB_CONCURRENCY=2
    echo "→ WEB_CONCURRENCY auto: ${WEB_CONCURRENCY} workeri (RAM ${RAM_MB}MB, ${CPUS} CPU)"
fi

# PROXY-URI DE ÎNCREDERE (--forwarded-allow-ips).
# Uvicorn aplică X-Forwarded-For / X-Forwarded-Proto (IP-ul clientului în
# `request.client`, schema https) DOAR dacă cererea vine de la o adresă din
# listă. Înainte era „*": ORICINE ajungea direct la :8000 (alt container, un
# port publicat din greșeală) își putea alege IP-ul și schema.
#
# Implicit: rețelele la care e conectat DIRECT containerul (rutele fără gateway
# din /proc/net/route) + 127.0.0.1. În k8s, api.yaml setează FORWARDED_ALLOW_IPS
# explicit; detecția rămâne pentru dezvoltarea locală cu docker compose.
# Override explicit: FORWARDED_ALLOW_IPS="172.18.0.0/16,127.0.0.1" în .env.
# Dacă detecția eșuează, cădem pe rangurile private (tot mai strict decât „*").
#
# „*" e tratat ca NESETAT: `.env.production.example` îl conținea, deci .env-urile
# deja copiate pe server îl au — fără regula asta, reparația n-ar ajunge în
# producție decât după o editare manuală a .env-ului.
#
# NB: rate limiting-ul din aplicație (`app/core/ratelimit.py: client_ip`)
# citește ULTIMA intrare din X-Forwarded-For, pusă de nginx — nu depinde de
# această listă, deci funcționează identic în spatele lui nginx.
if [ "${FORWARDED_ALLOW_IPS:-}" = "*" ]; then
    echo "→ FORWARDED_ALLOW_IPS='*' ignorat (prea permisiv) — detectez rețeaua Docker."
    FORWARDED_ALLOW_IPS=""
fi
if [ -z "${FORWARDED_ALLOW_IPS:-}" ]; then
    FORWARDED_ALLOW_IPS="$(python3 - /proc/net/route 2>/dev/null <<'PY' || true
import ipaddress
import socket
import struct
import sys

nets = []
with open(sys.argv[1], encoding="ascii") as fh:
    next(fh, None)  # antetul
    for line in fh:
        # Iface Destination Gateway Flags RefCnt Use Metric Mask ...
        f = line.split()
        if len(f) < 8 or f[1] == "00000000" or f[2] != "00000000":
            continue  # ruta implicită / rută prin gateway → nu e rețeaua locală
        dest = socket.inet_ntoa(struct.pack("<L", int(f[1], 16)))
        mask = socket.inet_ntoa(struct.pack("<L", int(f[7], 16)))
        net = ipaddress.ip_network(f"{dest}/{mask}", strict=False)
        if net.is_private and str(net) not in nets:
            nets.append(str(net))
if nets:
    print(",".join(["127.0.0.1"] + nets))
PY
)"
    if [ -z "$FORWARDED_ALLOW_IPS" ]; then
        FORWARDED_ALLOW_IPS="127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
    fi
fi
echo "→ Proxy-uri de încredere (forwarded-allow-ips): ${FORWARDED_ALLOW_IPS}"

echo "→ Pornesc gunicorn (uvicorn workers)..."
# Access log-ul gunicorn e OPRIT intenționat: îl emite AccessLogMiddleware în
#   format JSON structurat, cu request-id (vezi app/core/logging.py). Două
#   log-uri de acces în formate diferite = zgomot și dublă stocare.
exec gunicorn app.main:app \
  --workers "${WEB_CONCURRENCY}" \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS}" \
  --timeout "${GUNICORN_TIMEOUT:-60}" \
  --graceful-timeout "${GUNICORN_GRACEFUL_TIMEOUT:-30}" \
  --error-logfile -

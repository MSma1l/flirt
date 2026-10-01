#!/usr/bin/env bash
# ============================================================================ #
#  FLIRT — retenția în TIMP a jurnalelor containerelor (rulează pe HOST, cron).
# ============================================================================ #
#
# Politica de confidențialitate promite că jurnalele tehnice se păstrează cel
# mult LOG_RETENTION_DAYS (implicit 30) de zile. Driverul Docker `json-file`
# (docker-compose.yml, `x-logging`) rotește DOAR după mărime (10 MB × 5): pe un
# server cu trafic mic, o linie putea rămâne luni de zile. Scriptul ăsta aplică
# limita în timp, pentru fiecare container al proiectului compose `flirt`:
#
#   1. fișierele ROTITE (`…-json.log.N`, eventual `.gz`) a căror ultimă scriere e
#      mai veche de N zile → șterse (tot conținutul lor e mai vechi de N zile);
#   2. fișierul ACTIV: liniile cu `"time"` mai vechi de N zile sunt eliminate pe
#      loc (același inode — Docker îl ține deschis în O_APPEND și continuă să
#      scrie în el).
#
# Instalare (o singură dată, ca root, pe server):
#
#   sudo install -m 0755 /opt/flirt/backend/scripts/prune_container_logs.sh \
#        /usr/local/sbin/flirt-prune-logs
#   echo '17 3 * * * root ENV_FILE=/opt/flirt/backend/.env /usr/local/sbin/flirt-prune-logs' \
#        | sudo tee /etc/cron.d/flirt-prune-logs
#
# Rulare manuală / probă:   sudo ENV_FILE=/opt/flirt/backend/.env bash prune_container_logs.sh
# Variabile: LOG_RETENTION_DAYS (sau citit din ENV_FILE), COMPOSE_PROJECT (flirt).
# Idempotent. Necesită: docker, awk, find (prezente pe orice Ubuntu).
# ---------------------------------------------------------------------------- #
set -euo pipefail

COMPOSE_PROJECT="${COMPOSE_PROJECT:-flirt}"
ENV_FILE="${ENV_FILE:-}"

if [ -z "${LOG_RETENTION_DAYS:-}" ] && [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
    LOG_RETENTION_DAYS="$(sed -n 's/^LOG_RETENTION_DAYS=\([0-9][0-9]*\).*/\1/p' "$ENV_FILE" | tail -n1)"
fi
DAYS="${LOG_RETENTION_DAYS:-30}"
case "$DAYS" in ''|*[!0-9]*) echo "LOG_RETENTION_DAYS invalid: $DAYS" >&2; exit 1 ;; esac
[ "$DAYS" -ge 1 ] || { echo "LOG_RETENTION_DAYS trebuie să fie >= 1" >&2; exit 1; }

# Docker scrie `"time":"2026-10-01T07:51:12.123456789Z"` (RFC3339, UTC) ⇒ șirurile
# ISO se compară corect lexicografic.
CUTOFF="$(date -u -d "-${DAYS} days" +%Y-%m-%dT%H:%M:%S)"

containers="$(docker ps -aq --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}")"
[ -n "$containers" ] || exit 0

for cid in $containers; do
    log_path="$(docker inspect --format '{{.LogPath}}' "$cid" 2>/dev/null || true)"
    [ -n "$log_path" ] || continue
    log_dir="$(dirname "$log_path")"
    base="$(basename "$log_path")"

    # 1. Fișiere rotite, integral mai vechi decât termenul.
    find "$log_dir" -maxdepth 1 -type f -name "${base}.*" -mtime "+$((DAYS - 1))" -delete

    # 2. Fișierul activ: păstrăm doar liniile din termen.
    [ -f "$log_path" ] || continue
    first_time="$(head -n1 "$log_path" | sed -n 's/.*"time":"\([^"]*\)".*/\1/p')"
    [ -n "$first_time" ] || continue
    if [[ "$first_time" < "$CUTOFF" ]]; then
        tmp="$(mktemp "${log_dir}/.prune.XXXXXX")"
        awk -v cutoff="$CUTOFF" '
            match($0, /"time":"[^"]*"/) {
                t = substr($0, RSTART + 8, RLENGTH - 9)
                if (t < cutoff) next
            }
            { print }
        ' "$log_path" > "$tmp"
        # `cat >` păstrează inode-ul (Docker scrie în continuare în același fișier).
        cat "$tmp" > "$log_path"
        rm -f "$tmp"
    fi
done

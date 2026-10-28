#!/bin/sh
# Entrypoint flirt-web: randează șablonul → `nginx -t` → pornește nginx.
#
# Rulează ca uid 101 (non-root). Scrie DOAR în /tmp (configul randat, pid,
# buffere) → merge și cu readOnlyRootFilesystem + emptyDir pe /tmp.
set -eu

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [web-entrypoint] $*"; }

DOMAIN="${DOMAIN:-}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-}"
# Mini App gol/nesetat → nume-santinelă nerutabil: `server_name ;` gol ar fi
# eroare de sintaxă și ar ține jos și API-ul (același nginx).
MINIAPP_DOMAIN="${MINIAPP_DOMAIN:-}"
[ -n "$MINIAPP_DOMAIN" ] || MINIAPP_DOMAIN="miniapp.localhost"

# Numele ajung direct în config (server_name, CSP) → acceptăm DOAR caractere de
# hostname. Un `;` sau `"` strecurat în .env ar putea injecta directive nginx.
for pair in "DOMAIN=$DOMAIN" "ADMIN_DOMAIN=$ADMIN_DOMAIN" "MINIAPP_DOMAIN=$MINIAPP_DOMAIN"; do
    name="${pair%%=*}"; value="${pair#*=}"
    if [ -z "$value" ]; then
        log "EROARE: $name nu e setat (vine din secretul flirt-env)"; exit 1
    fi
    case "$value" in
        *[!A-Za-z0-9.-]*) log "EROARE: $name='$value' nu e un hostname valid"; exit 1 ;;
    esac
done
export DOMAIN ADMIN_DOMAIN MINIAPP_DOMAIN

mkdir -p /tmp/nginx
# Listă FIXĂ: variabilele nginx ($host, $uri, $request_id...) rămân neatinse.
# shellcheck disable=SC2016
envsubst '${DOMAIN} ${ADMIN_DOMAIN} ${MINIAPP_DOMAIN}' \
    < /etc/nginx/flirt/flirt.conf.template > /tmp/nginx/flirt.conf
log "config randat: DOMAIN=$DOMAIN ADMIN_DOMAIN=$ADMIN_DOMAIN MINIAPP_DOMAIN=$MINIAPP_DOMAIN"

# `nginx -t` rezolvă upstream-ul `api` prin DNS. Într-un pod NOU, NetworkPolicy
# (egress DNS) se aplică cu ~1-2s întârziere → reîncercăm scurt înainte să
# declarăm configul invalid (altfel containerul repornește o dată inutil).
i=1
until nginx -t -q 2>/dev/null; do
    if [ "$i" -ge 15 ]; then
        nginx -t -q || true
        log "EROARE: configurația nginx e invalidă (vezi mai sus). Nu pornesc."
        exit 1
    fi
    i=$((i + 1))
    sleep 1
done

exec nginx -g 'daemon off;'

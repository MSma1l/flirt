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

if ! nginx -t -q; then
    log "EROARE: configurația nginx e invalidă (vezi mai sus). Nu pornesc."
    exit 1
fi

exec nginx -g 'daemon off;'

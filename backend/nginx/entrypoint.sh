#!/bin/sh
# Entrypoint nginx: randează șablonul → asigură un certificat → validează → pornește.
#
# Rulează ca `command:` al serviciului `nginx` din docker-compose.yml. Face, în
# ordine, exact lucrurile fără de care `docker compose up -d` NU ar fi suficient:
#
#   1. RANDEAZĂ /etc/nginx/templates/default.conf.template → conf.d/default.conf,
#      înlocuind ${DOMAIN} și ${ADMIN_DOMAIN} (domeniul nu e hardcodat în config).
#   2. ASIGURĂ un certificat (Let's Encrypt dacă există; altfel SELF-SIGNED), ca
#      nginx să poată porni din prima pe un server curat, fără niciun pas manual.
#   3. VALIDEAZĂ configurația (`nginx -t`) — o greșeală de sintaxă trebuie să iasă
#      la iveală AICI, cu un mesaj clar, nu ca un container care intră în crash-loop.
#   4. Pornește nginx și, în fundal, supraveghează certificatul: când `certbot`
#      emite/reînnoiește cel real, îl preia și dă `reload` (fără downtime).
set -eu

DOMAIN="${DOMAIN:-localhost}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-admin.localhost}"
TEMPLATE=/etc/nginx/templates/default.conf.template
RENDERED=/etc/nginx/conf.d/default.conf
CERT=/etc/nginx/certs/fullchain.pem
# Cât de des re-verificăm certificatul. Emiterea inițială (certbot) durează
# secunde-minute după ce DNS-ul e corect: nu vrem ca serverul să rămână pe
# self-signed ore întregi pentru că am pus un interval de 12h.
WATCH_INTERVAL="${CERT_WATCH_INTERVAL:-60}"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [nginx-entrypoint] $*"; }

# --- 1. Randare șablon ------------------------------------------------------ #
# `sed` cu o listă FIXĂ de variabile: variabilele nginx ($host, $request_id,
# $binary_remote_addr...) rămân intacte — nu le poate atinge din greșeală nimeni.
log "randez configurația pentru DOMAIN=$DOMAIN ADMIN_DOMAIN=$ADMIN_DOMAIN"
sed \
    -e "s|\${DOMAIN}|${DOMAIN}|g" \
    -e "s|\${ADMIN_DOMAIN}|${ADMIN_DOMAIN}|g" \
    "$TEMPLATE" > "$RENDERED"

# --- 2. Certificat ---------------------------------------------------------- #
sh /usr/local/bin/ensure-cert.sh

# --- 3. Validare ------------------------------------------------------------ #
if ! nginx -t; then
    log "EROARE: configurația nginx e invalidă (vezi mesajul de mai sus). Nu pornesc."
    exit 1
fi

# --- 4. Supraveghere certificat, în fundal ---------------------------------- #
# Amprenta conținutului (md5sum urmărește symlink-ul către /etc/letsencrypt):
# se schimbă și la EMITEREA inițială, și la fiecare REÎNNOIRE. Reload doar când
# chiar s-a schimbat ceva — un `nginx -s reload` la fiecare minut e zgomot inutil.
(
    prev="$(md5sum "$CERT" 2>/dev/null | cut -d' ' -f1 || echo none)"
    while :; do
        sleep "$WATCH_INTERVAL"
        sh /usr/local/bin/ensure-cert.sh >/dev/null 2>&1 || true
        curr="$(md5sum "$CERT" 2>/dev/null | cut -d' ' -f1 || echo none)"
        if [ "$curr" != "$prev" ]; then
            log "certificatul s-a schimbat (Let's Encrypt emis/reînnoit) → reload"
            nginx -t && nginx -s reload || log "reload EȘUAT — păstrez configurația veche"
            prev="$curr"
        fi
    done
) &

log "pornesc nginx"
exec nginx -g 'daemon off;'

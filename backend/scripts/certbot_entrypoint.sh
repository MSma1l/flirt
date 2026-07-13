#!/bin/sh
# Certbot — emitere AUTOMATĂ + reînnoire, fără niciun pas manual.
#
# DE CE: criteriul de acceptare e `git pull && docker compose up --build -d`, atât.
# Un „rulează o dată comanda asta ca să emiți certificatul" e exact genul de pas
# care se uită și te lasă în producție cu un certificat self-signed (adică: toate
# telefoanele refuză conexiunea, App Transport Security respinge, aplicația e moartă).
#
# Cum funcționează:
#   1. nginx pornește ORICUM (self-signed) și servește /.well-known/acme-challenge/
#      pe :80 din webroot-ul partajat.
#   2. Scriptul ăsta cere certificatul REAL pentru AMBELE nume (api + admin), într-un
#      singur certificat (lineage numit după $DOMAIN).
#   3. nginx observă schimbarea certificatului (verifică la fiecare minut) și dă reload.
#   4. La fiecare $CERTBOT_INTERVAL_SECONDS reluăm: `--keep-until-expiring` face
#      operația inofensivă dacă certificatul e încă valid (no-op), și reînnoiește
#      când mai sunt <30 de zile.
#
# Rezistență la realitate:
#   - dacă DNS-ul pentru `admin` nu e încă propagat, emiterea pentru AMBELE nume
#     eșuează → reîncercăm DOAR cu $DOMAIN, ca API-ul să aibă totuși TLS real.
#     La ciclul următor, când DNS-ul admin apare, `--expand` adaugă și al doilea nume.
#   - eșec → reîncercare peste $CERTBOT_RETRY_SECONDS (implicit 1h). Let's Encrypt
#     limitează la 5 validări eșuate/oră/hostname: nu ne batem cu limita.
set -eu

DOMAIN="${DOMAIN:-localhost}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
WEBROOT=/var/www/certbot
INTERVAL="${CERTBOT_INTERVAL_SECONDS:-43200}"      # 12h
RETRY="${CERTBOT_RETRY_SECONDS:-3600}"             # 1h după un eșec
# CERTBOT_STAGING=true → mediul de test Let's Encrypt (certificat NEÎNCREZUT de
# browsere, dar fără limite de rată). Folosește-l când testezi procedura.
STAGING_FLAG=""
[ "${CERTBOT_STAGING:-false}" = "true" ] && STAGING_FLAG="--staging"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [certbot] $*"; }

# --- Condiții în care NU cerem certificat ----------------------------------- #
# Let's Encrypt nu poate valida `localhost` sau un IP: în dev rămânem pe self-signed.
case "$DOMAIN" in
    localhost | *.localhost | *.local | "" )
        log "DOMAIN='$DOMAIN' nu e un domeniu public → rămân pe self-signed. Nu fac nimic."
        trap exit TERM
        while :; do sleep 86400 & wait ${!}; done
        ;;
esac
if [ -z "$CERTBOT_EMAIL" ]; then
    log "CERTBOT_EMAIL e GOL → nu pot cere certificat (Let's Encrypt cere un contact"
    log "pentru avertizările de expirare). Completează-l în .env și repornește."
    trap exit TERM
    while :; do sleep 86400 & wait ${!}; done
fi

# Numele cerute: api + (opțional) admin.
DOMAIN_ARGS="-d $DOMAIN"
[ -n "$ADMIN_DOMAIN" ] && DOMAIN_ARGS="$DOMAIN_ARGS -d $ADMIN_DOMAIN"

issue() {
    # $1 = lista de `-d ...`
    # shellcheck disable=SC2086
    certbot certonly \
        --webroot -w "$WEBROOT" \
        $1 \
        --cert-name "$DOMAIN" \
        --email "$CERTBOT_EMAIL" \
        --agree-tos --no-eff-email \
        --non-interactive \
        --keep-until-expiring \
        --expand \
        $STAGING_FLAG
}

ensure_cert() {
    log "cer/verific certificatul pentru: $DOMAIN_ARGS"
    if issue "$DOMAIN_ARGS"; then
        log "OK — certificat valid pentru toate numele cerute."
        return 0
    fi

    if [ -n "$ADMIN_DOMAIN" ]; then
        log "EȘEC pe setul complet (probabil DNS-ul pentru $ADMIN_DOMAIN nu e gata)."
        log "Reîncerc DOAR cu $DOMAIN — API-ul trebuie să aibă TLS real chiar dacă"
        log "panoul de admin mai așteaptă DNS-ul."
        if issue "-d $DOMAIN"; then
            log "OK — certificat emis pentru $DOMAIN. Voi adăuga $ADMIN_DOMAIN automat"
            log "la un ciclu următor, când DNS-ul lui va fi corect."
            return 0
        fi
    fi

    log "EȘEC. Cauze uzuale, în ordinea probabilității:"
    log "  1. DNS: A record pentru $DOMAIN nu arată spre IP-ul ACESTUI server"
    log "  2. Firewall: portul 80 nu e accesibil din internet (ACME HTTP-01)"
    log "  3. Limite Let's Encrypt (prea multe încercări) — așteaptă o oră"
    return 1
}

trap exit TERM
while :; do
    if ensure_cert; then
        sleep "$INTERVAL" & wait ${!}
    else
        log "reîncerc peste ${RETRY}s"
        sleep "$RETRY" & wait ${!}
    fi
done

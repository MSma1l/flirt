#!/bin/sh
# Garantează că nginx are un certificat la pornire — altfel nu pornește deloc.
#
# Rulează din `nginx/entrypoint.sh`: o dată la pornire și apoi periodic, ca un
# certificat Let's Encrypt emis DUPĂ pornire (sau reînnoit) să fie preluat fără
# nicio intervenție manuală.
#
# Logica:
#   1. Dacă există certificat Let's Encrypt pentru $DOMAIN → îl folosim (symlink,
#      ca reînnoirile certbot să fie preluate fără să rescriem nimic). Certificatul
#      e emis pentru AMBELE nume (api + admin) într-un singur lineage, numit după
#      $DOMAIN (primul `-d` dat lui certbot).
#   2. Altfel → generăm un certificat SELF-SIGNED, cu ambele nume în SAN. Serverul
#      pornește imediat și poate răspunde la provocarea ACME pe :80, ca certbot să
#      emită certificatul REAL. Fără asta ai un ou-și-găina: nginx nu pornește fără
#      cert, certbot nu poate emite cert fără nginx care să servească challenge-ul.
#      (În dev, pe `localhost`, self-signed-ul e tot ce ai nevoie — browserul
#      avertizează, e normal.)
set -e

CERT_DIR=/etc/nginx/certs
DOMAIN="${DOMAIN:-localhost}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-admin.localhost}"
LE_DIR="/etc/letsencrypt/live/${DOMAIN}"

mkdir -p "$CERT_DIR"

if [ -f "$LE_DIR/fullchain.pem" ] && [ -f "$LE_DIR/privkey.pem" ]; then
    echo "[cert] Folosesc certificatul Let's Encrypt pentru ${DOMAIN} (+ ${ADMIN_DOMAIN})"
    ln -sf "$LE_DIR/fullchain.pem" "$CERT_DIR/fullchain.pem"
    ln -sf "$LE_DIR/privkey.pem"   "$CERT_DIR/privkey.pem"
    exit 0
fi

# Certificat self-signed deja generat (restart de container) → nu-l regenerăm.
if [ -f "$CERT_DIR/fullchain.pem" ] && [ ! -L "$CERT_DIR/fullchain.pem" ]; then
    echo "[cert] Certificat self-signed existent, îl păstrez"
    exit 0
fi

echo "[cert] ATENȚIE: nu există (încă) certificat Let's Encrypt pentru ${DOMAIN}."
echo "[cert] Generez unul SELF-SIGNED, ca stack-ul să pornească. Serviciul 'certbot'"
echo "[cert] îl va înlocui automat cu cel REAL de îndată ce DNS-ul arată spre server."

if ! command -v openssl >/dev/null 2>&1; then
    apk add --no-cache openssl >/dev/null
fi

rm -f "$CERT_DIR/fullchain.pem" "$CERT_DIR/privkey.pem"
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout "$CERT_DIR/privkey.pem" \
    -out "$CERT_DIR/fullchain.pem" \
    -subj "/CN=${DOMAIN}" \
    -addext "subjectAltName=DNS:${DOMAIN},DNS:${ADMIN_DOMAIN},DNS:localhost,IP:127.0.0.1" \
    2>/dev/null

echo "[cert] Gata (self-signed, valabil 365 zile, SAN: ${DOMAIN}, ${ADMIN_DOMAIN})."

#!/bin/sh
# Garantează că nginx are un certificat la pornire — altfel nu pornește deloc.
#
# Rulează la pornirea containerului nginx (vezi `command:` din docker-compose.yml)
# și, periodic, în bucla de reload — ca un certificat Let's Encrypt emis DUPĂ
# pornire (sau reînnoit) să fie preluat fără intervenție manuală.
#
# Logica:
#   1. Dacă există certificat Let's Encrypt pentru $DOMAIN → îl folosim (symlink,
#      ca reînnoirile certbot să fie preluate fără să rescriem nimic).
#   2. Altfel → generăm un certificat SELF-SIGNED. Dev-ul merge imediat pe
#      https://localhost (browserul avertizează — normal, e self-signed), iar în
#      producție serverul pornește și poate răspunde la provocarea ACME pe :80,
#      ca certbot să emită certificatul REAL. Fără asta ai un ou-și-găina:
#      nginx nu pornește fără cert, certbot nu poate emite cert fără nginx.
set -e

CERT_DIR=/etc/nginx/certs
LE_DIR="/etc/letsencrypt/live/${DOMAIN:-localhost}"

mkdir -p "$CERT_DIR"

if [ -f "$LE_DIR/fullchain.pem" ] && [ -f "$LE_DIR/privkey.pem" ]; then
    echo "[cert] Folosesc certificatul Let's Encrypt pentru ${DOMAIN:-localhost}"
    ln -sf "$LE_DIR/fullchain.pem" "$CERT_DIR/fullchain.pem"
    ln -sf "$LE_DIR/privkey.pem"   "$CERT_DIR/privkey.pem"
    exit 0
fi

# Certificat self-signed deja generat (restart de container) → nu-l regenerăm.
if [ -f "$CERT_DIR/fullchain.pem" ] && [ ! -L "$CERT_DIR/fullchain.pem" ]; then
    echo "[cert] Certificat self-signed existent, îl păstrez"
    exit 0
fi

echo "[cert] ATENȚIE: nu există certificat Let's Encrypt pentru ${DOMAIN:-localhost}."
echo "[cert] Generez unul SELF-SIGNED (valabil pentru dev; NU pentru producție)."

if ! command -v openssl >/dev/null 2>&1; then
    apk add --no-cache openssl >/dev/null
fi

rm -f "$CERT_DIR/fullchain.pem" "$CERT_DIR/privkey.pem"
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout "$CERT_DIR/privkey.pem" \
    -out "$CERT_DIR/fullchain.pem" \
    -subj "/CN=${DOMAIN:-localhost}" \
    -addext "subjectAltName=DNS:${DOMAIN:-localhost},DNS:localhost,IP:127.0.0.1" \
    2>/dev/null

echo "[cert] Gata. În producție rulează procedura certbot din docs/DEPLOYMENT.md."

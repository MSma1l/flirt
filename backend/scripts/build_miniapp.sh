#!/bin/sh
# Build-ul Telegram Mini App (SPA Vite din `miniapp/`) → volumul servit de nginx.
#
# Geamăn cu `build_admin.sh`, cu ACELEAȘI reguli — doar sursa, destinația și
# variabilele injectate la build diferă. Rulează în serviciul `miniapp-build` din
# docker-compose (imagine node, o singură execuție, apoi iese). Sursa e montată
# READ-ONLY: acest script NU scrie niciodată în `miniapp/` — folderul aparține
# altui agent/dezvoltator. Copiem sursa într-un director temporar și construim acolo.
#
# REGULA DE AUR: scriptul iese ÎNTOTDEAUNA cu 0.
# Mini App-ul e un CLIENT, nu backend-ul. API-ul (pe care rulează aplicația mobilă)
# NU are voie să rămână jos pentru că `npm run build` a picat sau pentru că folderul
# `miniapp/` încă nu există. În acest caz servim un placeholder și scriem în log.
#
# Idempotent: dacă sursa nu s-a schimbat de la ultimul build reușit (amprentă
# stocată în volum), nu reconstruim nimic.
set -u

SRC="${MINIAPP_SRC:-/src/miniapp}"
OUT="${MINIAPP_OUT:-/dist}"
WORK=/tmp/miniapp-build
HASH_FILE="$OUT/.build-hash"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [miniapp-build] $*"; }

placeholder() {
    mkdir -p "$OUT"
    rm -f "$HASH_FILE"
    cat > "$OUT/index.html" <<'HTML'
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FLIRT — Mini App</title>
<style>body{font:16px/1.6 system-ui,sans-serif;margin:10vh auto;max-width:40rem;padding:0 1rem;color:#222}code{background:#f2f2f2;padding:.1em .35em;border-radius:3px}</style>
<h1>Mini App-ul nu este construit</h1>
<p>API-ul funcționează normal — acest mesaj se referă DOAR la frontendul Telegram.</p>
<p>Cauza e una dintre:</p>
<ul>
  <li>folderul <code>miniapp/</code> nu există încă în repo;</li>
  <li><code>npm run build</code> a eșuat.</li>
</ul>
<p>Verifică: <code>docker compose logs miniapp-build</code></p>
HTML
    log "am scris un placeholder în $OUT"
}

# --- 1. Există sursa? ------------------------------------------------------- #
if [ ! -f "$SRC/package.json" ]; then
    log "ATENȚIE: $SRC/package.json lipsește (folderul miniapp/ nu există încă)."
    log "Backend-ul pornește normal; Mini App-ul va apărea când folderul există."
    placeholder
    exit 0
fi

# --- 2. S-a schimbat ceva de la ultimul build? ------------------------------ #
current_hash="$(
    find "$SRC" \
        -type d \( -name node_modules -o -name dist -o -name .git \) -prune -o \
        -type f -print0 2>/dev/null \
    | sort -z | xargs -0 md5sum 2>/dev/null | md5sum | cut -d' ' -f1
)"
previous_hash="$(cat "$HASH_FILE" 2>/dev/null || echo none)"

if [ -f "$OUT/index.html" ] && [ "$current_hash" = "$previous_hash" ]; then
    log "sursa e neschimbată și build-ul există → nu reconstruiesc (amprentă $current_hash)"
    exit 0
fi

# --- 3. Build ---------------------------------------------------------------- #
log "construiesc Mini App-ul din $SRC (amprentă $current_hash)"
rm -rf "$WORK"
mkdir -p "$WORK"
( cd "$SRC" && tar cf - \
    --exclude=./node_modules --exclude=./dist --exclude=./.git . ) \
  | ( cd "$WORK" && tar xf - ) || {
    log "EȘEC la copierea surselor din $SRC"
    [ -f "$OUT/index.html" ] && exit 0
    placeholder
    exit 0
}

cd "$WORK" || { log "nu pot intra în $WORK"; placeholder; exit 0; }

if [ -f package-lock.json ]; then
    install_cmd="npm ci"
else
    log "package-lock.json lipsește → folosesc 'npm install' (build nereproductibil;"
    log "commit-ează lock-file-ul în miniapp/)"
    install_cmd="npm install"
fi

# Variabile injectate la BUILD (Vite inline-uiește VITE_*). NICIUN SECRET aici:
# bundle-ul e public. TELEGRAM_BOT_TOKEN nu trebuie să ajungă NICIODATĂ în build —
# validarea `initData` se face pe backend, nu în browser.
if [ -z "${VITE_API_URL:-}" ]; then
    VITE_API_URL="https://${DOMAIN:-localhost}${API_V1_PREFIX:-/api/v1}"
fi
export VITE_API_URL
VITE_TELEGRAM_BOT_USERNAME="${VITE_TELEGRAM_BOT_USERNAME:-${TELEGRAM_BOT_USERNAME:-}}"
export VITE_TELEGRAM_BOT_USERNAME
log "VITE_API_URL=$VITE_API_URL VITE_TELEGRAM_BOT_USERNAME=$VITE_TELEGRAM_BOT_USERNAME"

if ! $install_cmd; then
    log "EȘEC la instalarea dependențelor."
    [ -f "$OUT/index.html" ] && { log "păstrez build-ul ANTERIOR din $OUT"; exit 0; }
    placeholder
    exit 0
fi

if ! npm run build; then
    log "EȘEC la 'npm run build'."
    [ -f "$OUT/index.html" ] && { log "păstrez build-ul ANTERIOR din $OUT"; exit 0; }
    placeholder
    exit 0
fi

# Vite scrie în `dist/`; alte setup-uri în `build/`. Acceptăm ambele.
BUILT=""
for d in "${MINIAPP_BUILD_DIR:-dist}" dist build; do
    if [ -f "$WORK/$d/index.html" ]; then BUILT="$WORK/$d"; break; fi
done

if [ -z "$BUILT" ]; then
    log "EȘEC: build-ul a mers, dar nu găsesc index.html (am căutat în dist/, build/)."
    log "Setează MINIAPP_BUILD_DIR în .env dacă Mini App-ul scrie în alt folder."
    [ -f "$OUT/index.html" ] && exit 0
    placeholder
    exit 0
fi

# --- 4. Publicare în volumul citit de nginx ---------------------------------- #
mkdir -p "$OUT"
rm -rf "${OUT:?}"/*
cp -R "$BUILT"/. "$OUT"/
echo "$current_hash" > "$HASH_FILE"
log "GATA — Mini App-ul e publicat ($(find "$OUT" -type f | wc -l) fișiere)."
exit 0

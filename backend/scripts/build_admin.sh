#!/bin/sh
# Build-ul panoului de admin (SPA React/Vite din `admin/`) → volumul servit de nginx.
#
# Rulează în serviciul `admin-build` din docker-compose (imagine node, o singură
# execuție, apoi iese). Sursa e montată READ-ONLY: acest script NU scrie niciodată
# în `admin/` — folderul aparține altui agent/dezvoltator. Copiem sursa într-un
# director temporar din container și construim acolo.
#
# REGULA DE AUR: scriptul iese ÎNTOTDEAUNA cu 0.
# Panoul de admin este un ACCESORIU. Backend-ul (API-ul pe care rulează aplicația
# mobilă) NU are voie să rămână jos pentru că `npm run build` a picat sau pentru că
# folderul `admin/` încă nu există. Într-un asemenea caz servim un placeholder și
# scriem clar în log ce s-a întâmplat.
#
# Idempotent: dacă sursa nu s-a schimbat de la ultimul build reușit (amprentă
# stocată în volum), nu reconstruim nimic — `docker compose up -d` repetat nu
# mai plătește 2-3 minute de `npm ci` degeaba.
set -u

SRC="${ADMIN_SRC:-/src/admin}"
OUT="${ADMIN_OUT:-/dist}"
WORK=/tmp/admin-build
HASH_FILE="$OUT/.build-hash"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [admin-build] $*"; }

placeholder() {
    # Un 200 explicativ e mai bun decât un 404 misterios pe admin.flirt.md.
    mkdir -p "$OUT"
    rm -f "$HASH_FILE"
    cat > "$OUT/index.html" <<'HTML'
<!doctype html>
<meta charset="utf-8">
<title>FLIRT — admin</title>
<style>body{font:16px/1.6 system-ui,sans-serif;margin:10vh auto;max-width:40rem;padding:0 1rem;color:#222}code{background:#f2f2f2;padding:.1em .35em;border-radius:3px}</style>
<h1>Panoul de admin nu este construit</h1>
<p>API-ul funcționează normal — acest mesaj se referă DOAR la interfața de admin.</p>
<p>Cauza e una dintre:</p>
<ul>
  <li>folderul <code>admin/</code> nu există încă în repo;</li>
  <li><code>npm run build</code> a eșuat.</li>
</ul>
<p>Verifică: <code>docker compose logs admin-build</code></p>
HTML
    log "am scris un placeholder în $OUT"
}

# --- 1. Există sursa? ------------------------------------------------------- #
if [ ! -f "$SRC/package.json" ]; then
    log "ATENȚIE: $SRC/package.json lipsește (folderul admin/ nu există încă)."
    log "Backend-ul pornește normal; panoul de admin va apărea când folderul există."
    placeholder
    exit 0
fi

# --- 2. S-a schimbat ceva de la ultimul build? ------------------------------ #
# Amprenta = numele + conținutul fișierelor sursă (fără node_modules / dist).
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
log "construiesc panoul de admin din $SRC (amprentă $current_hash)"
rm -rf "$WORK"
mkdir -p "$WORK"
# Copiem FĂRĂ node_modules/dist/.git: pe un VPS mic, copierea a câteva sute de MB
# de node_modules (doar ca să le ștergem imediat după) e minute pierdute la fiecare
# deploy. `npm ci` reinstalează oricum dependențele, curat, din lock-file.
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
    log "commit-ează lock-file-ul în admin/)"
    install_cmd="npm install"
fi

# VITE_API_URL: panoul trebuie să știe unde e API-ul. E injectat la BUILD (Vite
# inline-uiește variabilele VITE_* în bundle) — de aceea vine din compose, nu din
# codul panoului. Dacă nu e setat explicit în .env, îl compunem din DOMAIN.
if [ -z "${VITE_API_URL:-}" ]; then
    VITE_API_URL="https://${DOMAIN:-localhost}${API_V1_PREFIX:-/api/v1}"
fi
export VITE_API_URL
log "VITE_API_URL=$VITE_API_URL"

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

# Vite scrie în `dist/`; CRA în `build/`. Acceptăm ambele.
BUILT=""
for d in "${ADMIN_BUILD_DIR:-dist}" dist build; do
    if [ -f "$WORK/$d/index.html" ]; then BUILT="$WORK/$d"; break; fi
done

if [ -z "$BUILT" ]; then
    log "EȘEC: build-ul a mers, dar nu găsesc index.html (am căutat în dist/, build/)."
    log "Setează ADMIN_BUILD_DIR în .env dacă panoul scrie în alt folder."
    [ -f "$OUT/index.html" ] && exit 0
    placeholder
    exit 0
fi

# --- 4. Publicare atomică-ish în volumul citit de nginx ---------------------- #
mkdir -p "$OUT"
rm -rf "${OUT:?}"/*
cp -R "$BUILT"/. "$OUT"/
echo "$current_hash" > "$HASH_FILE"
log "GATA — panoul de admin e publicat ($(find "$OUT" -type f | wc -l) fișiere)."
exit 0

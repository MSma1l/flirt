#!/usr/bin/env bash
# ============================================================================ #
#  FLIRT — de la server Ubuntu GOL la aplicație live.
# ============================================================================ #
#
#   curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/main/backend/scripts/bootstrap_server.sh -o bootstrap.sh
#   sudo bash bootstrap.sh
#
# sau, dacă ai deja repo-ul clonat:
#
#   sudo bash backend/scripts/bootstrap_server.sh
#
# Ce face:
#   1. instalează Docker Engine + plugin compose (dacă lipsesc)
#   2. deschide portul 80 și 443 în firewall (dacă ufw e activ)
#   3. clonează repo-ul (dacă nu e deja clonat)
#   4. generează cheile JWT RS256 și le scrie în .env
#   5. creează .env din .env.production.example (dacă nu există) + parolă Postgres
#   6. se oprește și îți cere să completezi cheile marcate <<< COMPLETEAZĂ >>>
#   7. pornește stack-ul și verifică că răspunde
#
# IDEMPOTENT: rulează-l de câte ori vrei. Nu suprascrie niciodată un `.env` existent,
# nu regenerează cheile JWT dacă există deja, nu reinstalează Docker degeaba.
#
# Certificatul Let's Encrypt NU se cere manual nicăieri: serviciul `certbot` din
# compose îl emite singur pentru api + admin, imediat ce DNS-ul e corect.
# ---------------------------------------------------------------------------- #
set -euo pipefail

REPO_URL="${REPO_URL:-}"                    # ex. https://github.com/user/flirt.git
INSTALL_DIR="${INSTALL_DIR:-/opt/flirt}"
BRANCH="${BRANCH:-main}"

C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_OFF=$'\033[0m'
step() { echo; echo "${C_OK}==>${C_OFF} $*"; }
warn() { echo "${C_WARN}[!]${C_OFF} $*"; }
die()  { echo "${C_ERR}[✗]${C_OFF} $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Rulează ca root (sudo bash $0)"

# ---------------------------------------------------------------------------- #
step "1/7  Docker"
# ---------------------------------------------------------------------------- #
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "    Docker + compose sunt deja instalate ($(docker --version))."
else
    echo "    Instalez Docker Engine (script oficial get.docker.com)..."
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl git openssl >/dev/null
    curl -fsSL https://get.docker.com | sh
    docker compose version >/dev/null 2>&1 || die "pluginul 'docker compose' lipsește după instalare"
    echo "    OK: $(docker --version)"
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------- #
step "2/7  Firewall (80 + 443)"
# ---------------------------------------------------------------------------- #
# Portul 80 e OBLIGATORIU: fără el, Let's Encrypt nu poate valida domeniul (HTTP-01)
# și rămâi fără certificat, adică fără aplicație.
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp  >/dev/null && echo "    ufw: 80/tcp permis"
    ufw allow 443/tcp >/dev/null && echo "    ufw: 443/tcp permis"
    ufw allow 22/tcp  >/dev/null || true
else
    warn "ufw nu e activ — verifică MANUAL că porturile 80 și 443 sunt deschise"
    warn "(și în firewall-ul providerului: Hetzner/DigitalOcean/AWS au propriul lor)."
fi

# ---------------------------------------------------------------------------- #
step "3/7  Codul sursă"
# ---------------------------------------------------------------------------- #
if [ -f "$(dirname "$0")/../docker-compose.yml" ]; then
    # Scriptul rulează din interiorul repo-ului deja clonat.
    APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
    echo "    Folosesc repo-ul existent: $APP_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
    APP_DIR="$INSTALL_DIR/backend"
    echo "    Repo existent în $INSTALL_DIR → git pull"
    git -C "$INSTALL_DIR" pull --ff-only || warn "git pull a eșuat (modificări locale?) — continui cu ce e pe disc"
else
    [ -n "$REPO_URL" ] || die "Setează REPO_URL=https://github.com/.../flirt.git (sau clonează repo-ul manual în $INSTALL_DIR)"
    echo "    Clonez $REPO_URL în $INSTALL_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    APP_DIR="$INSTALL_DIR/backend"
fi
cd "$APP_DIR"

# ---------------------------------------------------------------------------- #
step "4/7  Fișierul .env"
# ---------------------------------------------------------------------------- #
NEEDS_INPUT=0
if [ -f .env ]; then
    echo "    .env există deja — NU îl ating (idempotent)."
else
    [ -f .env.production.example ] || die ".env.production.example lipsește din $APP_DIR"
    cp .env.production.example .env
    chmod 600 .env
    echo "    .env creat din .env.production.example (chmod 600)."

    # Parolă Postgres generată automat — un lucru mai puțin de completat manual.
    PG_PASS="$(openssl rand -base64 32 | tr -d '\n/+=' | cut -c1-32)"
    sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PASS}|" .env
    echo "    POSTGRES_PASSWORD generat automat."
    NEEDS_INPUT=1
fi

# ---------------------------------------------------------------------------- #
step "5/7  Chei JWT (RS256)"
# ---------------------------------------------------------------------------- #
# Cheia privată se generează PE SERVER și nu pleacă niciodată de aici.
if grep -q '^JWT_PRIVATE_KEY=.\{100,\}' .env; then
    echo "    Cheile JWT există deja în .env — nu le regenerez (rotația ar deconecta"
    echo "    toți userii). Ca să le rotești intenționat: șterge liniile și rulează din nou."
else
    # ÎN AFARA repo-ului, intenționat: o cheie privată într-un director versionat e
    # la un `git add .` distanță de a ajunge publică pe GitHub.
    KEY_DIR="${JWT_KEY_DIR:-/etc/flirt/keys}"
    mkdir -p "$KEY_DIR"; chmod 700 "$KEY_DIR"
    openssl genrsa -out "$KEY_DIR/private.pem" 2048 2>/dev/null
    openssl rsa -in "$KEY_DIR/private.pem" -pubout -out "$KEY_DIR/public.pem" 2>/dev/null
    chmod 600 "$KEY_DIR/private.pem"

    PRIV="$(awk '{printf "%s\\n", $0}' "$KEY_DIR/private.pem")"
    PUB="$(awk  '{printf "%s\\n", $0}' "$KEY_DIR/public.pem")"

    # `|` ca separator + escape: PEM-ul conține `/` și `+`.
    python3 - "$PRIV" "$PUB" <<'PY'
import sys, re, pathlib
priv, pub = sys.argv[1], sys.argv[2]
p = pathlib.Path(".env")
txt = p.read_text()
txt = re.sub(r"(?m)^JWT_PRIVATE_KEY=.*$", "JWT_PRIVATE_KEY=" + priv, txt)
txt = re.sub(r"(?m)^JWT_PUBLIC_KEY=.*$",  "JWT_PUBLIC_KEY="  + pub,  txt)
p.write_text(txt)
PY
    echo "    Chei JWT generate și scrise în .env (copie în $KEY_DIR, chmod 600)."
fi

# ---------------------------------------------------------------------------- #
step "6/7  Ce mai trebuie completat MANUAL"
# ---------------------------------------------------------------------------- #
if grep -q '<<< COMPLETEAZĂ' .env; then
    echo
    warn "În .env au rămas valori necompletate. Aplicația NU va porni fără ele"
    warn "(guardul de producție din app/core/config.py le verifică pe toate):"
    echo
    grep -n '<<< COMPLETEAZĂ' .env | sed 's/^/      /'
    echo
    echo "    Editează:  nano $APP_DIR/.env"
    echo "    Apoi rulează DIN NOU acest script (e idempotent), sau direct:"
    echo "        cd $APP_DIR && docker compose up --build -d"
    echo
    exit 0
fi

# ---------------------------------------------------------------------------- #
step "7/7  Pornesc stack-ul"
# ---------------------------------------------------------------------------- #
# Verificăm config-ul ÎNAINTE de a porni: un guard care pică aici e un mesaj clar,
# nu un container în crash-loop.
echo "    Verific configurația..."
docker compose build api >/dev/null
if ! docker compose run --rm --no-deps api \
        python -c "from app.core.config import Settings; Settings(); print('config OK')"; then
    die "Configurația din .env NU e validă pentru producție (vezi lista de mai sus)."
fi

docker compose up --build -d
echo "    Aștept ca API-ul să devină 'healthy' (migrațiile rulează acum)..."

DOMAIN_VAL="$(grep -E '^DOMAIN=' .env | cut -d= -f2- | tr -d '"' | xargs || echo localhost)"
for i in $(seq 1 60); do
    if docker compose ps api | grep -q "healthy"; then
        echo "    API healthy."
        break
    fi
    [ "$i" -eq 60 ] && { docker compose logs api --tail 40; die "API-ul nu a devenit healthy în 5 minute"; }
    sleep 5
done

echo
echo "    Verificare locală (prin nginx, ignorând certificatul dacă e self-signed):"
curl -sk --resolve "${DOMAIN_VAL}:443:127.0.0.1" "https://${DOMAIN_VAL}/health/ready" || true
echo
echo
echo "${C_OK}================ GATA ================${C_OFF}"
echo "  Stack pornit. Ce urmează, automat, fără să faci nimic:"
echo "    • certbot cere certificatul Let's Encrypt pentru ${DOMAIN_VAL} (+ admin)"
echo "    • nginx îl preia în ≤1 minut și dă reload"
echo
echo "  Verifică din AFARA serverului (de pe laptop), peste 1-2 minute:"
echo "      curl -I https://${DOMAIN_VAL}/health"
echo "      curl -s  https://${DOMAIN_VAL}/health/ready"
echo
echo "  Dacă certificatul nu apare:  docker compose logs certbot"
echo "  (cauza #1: DNS-ul A pentru ${DOMAIN_VAL} nu arată spre IP-ul acestui server)"
echo "======================================"

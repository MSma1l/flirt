#!/usr/bin/env bash
# Funcții comune pentru scripturile din deploy/k8s/scripts/ (se include cu `.`).
# Nu se rulează direct.
# shellcheck disable=SC2034  # variabilele sunt folosite de scripturile care includ fișierul

# --------------------------------------------------------------------------- #
# Căi și unelte
# --------------------------------------------------------------------------- #
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$LIB_DIR/../../.." && pwd)"
MANIFESTS="$REPO_ROOT/deploy/k8s/manifests"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/backend/.env}"
NS="${NS:-flirt}"
STATE_DIR="${STATE_DIR:-/var/lib/flirt}"

# Pe server nu există kubectl separat: `k3s kubectl`. Suprascriere: KUBECTL=kubectl.
read -r -a KUBECTL_CMD <<< "${KUBECTL:-k3s kubectl}"
# Imaginile k8s stau în containerd-ul lui k3s, namespace-ul `k8s.io`.
read -r -a CTR_CMD <<< "${CTR:-k3s ctr -n k8s.io}"

kc() { "${KUBECTL_CMD[@]}" "$@"; }
kn() { "${KUBECTL_CMD[@]}" -n "$NS" "$@"; }
ctr_k3s() { "${CTR_CMD[@]}" "$@"; }

# Cheile fără de care stack-ul NU poate porni (db, web, ingress).
REQUIRED_ENV_KEYS="POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB DOMAIN ADMIN_DOMAIN"

# --------------------------------------------------------------------------- #
# Log
# --------------------------------------------------------------------------- #
log()  { printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${LOG_TAG:-flirt}" "$*" >&2; }
warn() { log "ATENȚIE: $*"; }
die()  { log "EROARE: $*"; exit 1; }

require_root() { [ "$(id -u)" -eq 0 ] || die "rulează ca root (docker, k3s ctr, /var/lib/rancher)"; }
require_cmd()  { local c; for c in "$@"; do command -v "$c" >/dev/null 2>&1 || die "lipsește comanda: $c"; done; }

# Întrebare da/nu. ASSUME_YES=1 (sau --yes) → răspuns automat „da".
confirm() {
    [ "${ASSUME_YES:-0}" = "1" ] && { log "$1 → da (--yes)"; return 0; }
    local ans
    read -r -p "$1 [da/NU] " ans </dev/tty || return 1
    case "$ans" in da|DA|y|Y|yes) return 0 ;; *) return 1 ;; esac
}

# --------------------------------------------------------------------------- #
# .env → fișier KEY=VALUE curat pentru `kubectl create secret --from-env-file`
# --------------------------------------------------------------------------- #
# `--from-env-file` NU înțelege sintaxa docker compose: ar păstra ghilimelele și
# comentariile inline (`MINIAPP_DOMAIN=miniapp.flrt.md   # decis...` ar deveni
# valoarea întreagă). Normalizăm ca docker compose:
#   - linii goale și `# comentariu` → sărite; prefixul `export ` → scos;
#   - valoare între "..." sau '...' → conținutul exact dintre ghilimele;
#   - valoare fără ghilimele → tăiem DOAR `<spațiu>#...` (un `#` lipit de text,
#     ex. într-o parolă `ab#cd`, rămâne) și spațiile de la capăt;
#   - cheie duplicată → câștigă ULTIMA (ca la compose).
# Cheile JWT rămân pe o linie cu `\n` LITERAL: app/core/config.py
# (`_normalize_pem`) le transformă în linii noi — nu le expandăm aici.
# Valori între ghilimele pe MAI MULTE linii (cheile PEM, ca în .env-ul de pe
# server) → unite cu `\n` literal, pe care config.py îl transformă înapoi.
env_clean() {
    local src="$1" dst="$2"
    [ -r "$src" ] || die "nu pot citi $src"
    awk -v sq="'" -v src="$src" '
        function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t\r]+$/, "", s); return s }
        {
            line = $0; sub(/\r$/, "", line)
            if (pkey != "") {
                end = index(line, pq)
                if (end == 0) { pval = pval "\\n" line; next }
                val = pval "\\n" substr(line, 1, end - 1)
                if (!(pkey in vals)) order[++n] = pkey
                vals[pkey] = val; pkey = ""
                next
            }
            t = trim(line)
            if (t == "" || substr(t, 1, 1) == "#") next
            if (substr(t, 1, 7) == "export ") t = trim(substr(t, 8))
            eq = index(t, "=")
            if (eq == 0) { printf "%s:%d: linie fără = (ignorată)\n", src, NR > "/dev/stderr"; next }
            key = trim(substr(t, 1, eq - 1))
            val = substr(t, eq + 1); sub(/^[ \t]+/, "", val)
            if (key !~ /^[A-Za-z_][A-Za-z0-9_]*$/) { printf "%s:%d: cheie invalidă \"%s\"\n", src, NR, key > "/dev/stderr"; bad = 1; next }
            q = substr(val, 1, 1)
            if (q == "\"" || q == sq) {
                rest = substr(val, 2); end = index(rest, q)
                if (end == 0) { pkey = key; pq = q; pval = rest; pline = NR; next }
                val = substr(rest, 1, end - 1)
            } else {
                if (match(val, /[ \t]#/)) val = substr(val, 1, RSTART - 1)
                sub(/[ \t]+$/, "", val)
            }
            if (!(key in vals)) order[++n] = key
            vals[key] = val
        }
        END {
            if (pkey != "") { printf "%s:%d: ghilimele neînchise la %s\n", src, pline, pkey > "/dev/stderr"; bad = 1 }
            if (bad) exit 2
            for (i = 1; i <= n; i++) print order[i] "=" vals[order[i]]
        }
    ' "$src" > "$dst" || die "$src are linii pe care nu le pot converti (vezi mai sus)"
}

# Valoarea unei chei dintr-un fișier deja curățat (gol dacă lipsește).
env_get() { awk -v k="$2" 'index($0, k "=") == 1 { v = substr($0, length(k) + 2) } END { printf "%s", v }' "$1"; }

# Verifică cheile obligatorii + că nu au rămas valori <<< COMPLETEAZĂ >>>.
env_validate() {
    local f="$1" k missing="" unfilled
    for k in $REQUIRED_ENV_KEYS; do
        [ -n "$(env_get "$f" "$k")" ] || missing="$missing $k"
    done
    [ -z "$missing" ] || die ".env: lipsesc / sunt goale cheile obligatorii:$missing"
    unfilled="$(grep 'COMPLETEAZĂ' "$f" | cut -d= -f1 | tr '\n' ' ' || true)"
    [ -z "$unfilled" ] || die ".env: valori necompletate (<<< COMPLETEAZĂ >>>): $unfilled"
    [ -n "$(env_get "$f" MINIAPP_DOMAIN)" ] || warn "MINIAPP_DOMAIN gol → web folosește santinela miniapp.localhost"
}

# Creează un fișier temporar cu .env-ul curățat (umask 077) și îl curăță la ieșire.
# Rezultat în variabila globală CLEAN_ENV.
CLEAN_ENV=""
_cleanup_env() { [ -n "$CLEAN_ENV" ] && rm -f "$CLEAN_ENV"; return 0; }
load_env() {
    [ -n "$CLEAN_ENV" ] && [ -f "$CLEAN_ENV" ] && return 0
    CLEAN_ENV="$(umask 077 && mktemp /tmp/flirt-env.XXXXXX)"
    trap _cleanup_env EXIT
    env_clean "$ENV_FILE" "$CLEAN_ENV"
    env_validate "$CLEAN_ENV"
}

# Secretul `flirt-env` = .env-ul curățat. Idempotent (apply). Setează ENV_SHA =
# amprenta conținutului, pusă ca adnotare pe pod-uri: .env schimbat → pod-uri noi
# (envFrom NU se reîncarcă singur în pod-urile care rulează).
ENV_SHA=""
refresh_secret() {
    load_env
    kc apply -f "$MANIFESTS/namespace.yaml" >&2
    log "actualizez secretul $NS/flirt-env din $ENV_FILE"
    kn create secret generic flirt-env --from-env-file="$CLEAN_ENV" \
        --dry-run=client -o yaml | kn apply -f - >&2
    ENV_SHA="$(sha256sum "$CLEAN_ENV" | cut -c1-16)"
}

# --------------------------------------------------------------------------- #
# Resurse la nivel de cluster: storageclass → traefik-config → issuers
# --------------------------------------------------------------------------- #
apply_cluster() {
    load_env
    log "aplic resursele de cluster (storageclass, traefik-config, issuers)"
    kc apply -f "$MANIFESTS/cluster/storageclass.yaml" >&2
    kc apply -f "$MANIFESTS/cluster/traefik-config.yaml" >&2
    if ! kc get crd clusterissuers.cert-manager.io >/dev/null 2>&1; then
        warn "cert-manager nu e instalat (CRD lipsă) → sar peste issuers.yaml (rulează install-k3s.sh phase1)"
        return 0
    fi
    local email
    email="$(env_get "$CLEAN_ENV" CERTBOT_EMAIL)"
    case "$email" in
        *@*.*) ;;
        *) die "CERTBOT_EMAIL din .env nu e un e-mail valid (necesar pentru ClusterIssuer Let's Encrypt)" ;;
    esac
    sed "s|__ACME_EMAIL__|${email}|g" "$MANIFESTS/cluster/issuers.yaml" | kc apply -f - >&2
}

# --------------------------------------------------------------------------- #
# Imagini: docker → containerd-ul k3s
# --------------------------------------------------------------------------- #
# Numele complet în containerd: flirt-api:abc → docker.io/library/flirt-api:abc
ctr_ref() { printf 'docker.io/library/%s' "$1"; }

ctr_has_image() { ctr_k3s images ls -q | grep -qxF "$(ctr_ref "$1")"; }

# docker save <repo:tag> | ctr import
import_image() {
    log "import în containerd (k3s): $1"
    docker save "$1" | ctr_k3s images import - >&2 || die "import eșuat pentru $1"
    ctr_has_image "$1" || die "după import nu găsesc $(ctr_ref "$1") în containerd"
}

# Mută tag-ul `current` din containerd pe <repo:tag> — ca un `kubectl apply -k`
# ulterior (manifestele cer `:current`) să NU readucă o imagine veche.
ctr_retag_current() {
    local img="$1" repo="${1%%:*}"
    ctr_k3s images tag --force "$(ctr_ref "$img")" "$(ctr_ref "$repo:current")" >/dev/null \
        || die "nu pot muta $repo:current pe $img"
    log "containerd: $repo:current → $img"
}

# Imaginea curentă a unui container dintr-un Deployment/CronJob (gol dacă lipsește).
deploy_image() {
    kn get deployment "$1" -o jsonpath="{.spec.template.spec.containers[?(@.name==\"$2\")].image}" 2>/dev/null || true
}
cronjob_image() {
    kn get cronjob "$1" -o jsonpath="{.spec.jobTemplate.spec.template.spec.containers[?(@.name==\"$2\")].image}" 2>/dev/null || true
}

# --------------------------------------------------------------------------- #
# Manifeste: echivalentul `kubectl apply -k`, cu imaginile FIXATE
# --------------------------------------------------------------------------- #
# Manifestele din git cer `flirt-api:current` / `flirt-web:current`. Un `apply -k`
# brut ar muta Deployment-urile (care rulează `flirt-api:<tag>`) pe `current` →
# rollout NECONTROLAT, înaintea migrațiilor. De aceea randăm kustomize și
# înlocuim `:current` cu imaginea dată (de regulă cea care rulează deja): restul
# manifestului se aplică normal, iar imaginile se schimbă DOAR prin pasul de
# rollout (cu migrații înainte și rollback automat).
apply_manifests_pinned() {
    local api_img="$1" web_img="$2" rendered
    rendered="$(kc kustomize "$MANIFESTS")" || die "kustomize a eșuat pe $MANIFESTS"
    printf '%s\n' "$rendered" \
        | sed -e "s#\(image:[[:space:]]*\)flirt-api:current\$#\1${api_img}#" \
              -e "s#\(image:[[:space:]]*\)flirt-web:current\$#\1${web_img}#" \
        | kc apply -f - >&2
}

# --------------------------------------------------------------------------- #
# Job-ul de migrații (o singură rulare alembic, ÎNAINTE de rollout)
# --------------------------------------------------------------------------- #
run_migrate_job() {
    local tag="$1" timeout="${MIGRATE_TIMEOUT:-300}" conds deadline
    log "migrații: Job migrate cu flirt-api:$tag"
    kn delete job migrate --ignore-not-found --wait=true >&2
    sed "s#flirt-api:__IMAGE__#flirt-api:${tag}#g" "$MANIFESTS/jobs/migrate-job.yaml" | kn apply -f - >&2
    deadline=$((SECONDS + timeout))
    while :; do
        conds=" $(kn get job migrate -o jsonpath='{range .status.conditions[?(@.status=="True")]}{.type}{" "}{end}' 2>/dev/null || true) "
        case "$conds" in
            *" Complete "*)
                log "migrații OK"
                kn logs -l job-name=migrate --tail=20 >&2 2>/dev/null || true
                return 0 ;;
            *" Failed "*) break ;;
        esac
        if [ "$SECONDS" -ge "$deadline" ]; then
            log "migrații: timeout după ${timeout}s"
            break
        fi
        sleep 3
    done
    log "MIGRAȚIILE AU EȘUAT — loguri:"
    kn logs -l job-name=migrate --all-containers --prefix --tail=200 >&2 2>/dev/null || true
    kn describe job migrate 2>/dev/null | tail -n 25 >&2 || true
    return 1
}

# Diagnostic după un rollout eșuat.
rollout_diag() {
    local d="$1"
    log "diagnostic $d:"
    kn get pods -l "app.kubernetes.io/name=$d" -o wide >&2 || true
    kn get events --sort-by=.lastTimestamp 2>/dev/null | tail -n 20 >&2 || true
    local p
    for p in $(kn get pods -l "app.kubernetes.io/name=$d" --sort-by=.metadata.creationTimestamp -o name 2>/dev/null | tail -n 2); do
        log "--- loguri $p"
        kn logs "$p" --all-containers --tail=60 >&2 2>/dev/null || true
    done
}

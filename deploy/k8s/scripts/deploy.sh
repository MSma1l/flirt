#!/usr/bin/env bash
# FLIRT — deploy zero-downtime pe k3s, cu rollback automat. Rulează PE SERVER:
#
#   ssh flirt 'cd /opt/flirt && deploy/k8s/scripts/deploy.sh'
#
# Opțiuni:
#   (fără)       pull → build → import → secret → manifeste → migrații → rollout
#   --rollback   revine la versiunea anterioară (api + web + cronjob purge)
#   --prepare    doar pull + build + import + secret + resurse de cluster (fără
#                rollout) — pregătire, ex. pe un server nou înainte de primul deploy
#   --no-pull    sare peste `git pull` (deploy al commit-ului deja prezent)
#
# ⚠️  MIGRAȚII COMPATIBILE ÎNAPOI (expand/contract) — OBLIGATORIU.
#     Job-ul `migrate` rulează ÎNAINTE de rollout, iar pod-urile VECHI servesc
#     trafic în timpul rollout-ului (și după un rollback). Schema nouă trebuie
#     deci să funcționeze și cu codul vechi:
#       - adaugi coloane NULLABLE / cu default, tabele noi, indexuri CONCURRENTLY;
#       - NU redenumești / ștergi / faci NOT NULL într-un singur deploy: întâi
#         codul nou care nu mai folosește coloana (deploy N), abia apoi migrația
#         care o șterge (deploy N+1).
#     Rollback-ul revine DOAR la cod; migrațiile NU se anulează.
#
# Pași: 1 git pull --ff-only · 2 docker build flirt-api / flirt-web :TAG
#   3 import în containerd k3s · 4 storageclass → traefik-config → issuers
#   5 secret flirt-env din .env · 6 manifeste (apply -k, imagini fixate)
#   7 Job migrate (eșec → STOP, versiunea veche rămâne online)
#   8 rollout api (+ cronjob purge) → rollout web; eșec → `rollout undo`
#   9 `:current` în containerd → noul tag · 10 curățenie: păstrăm ultimele 3 tag-uri
set -euo pipefail

LOG_TAG=deploy
# shellcheck source=lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

MODE=deploy
DO_PULL=1
for arg in "$@"; do
    case "$arg" in
        --rollback) MODE=rollback ;;
        --prepare)  MODE=prepare ;;
        --no-pull)  DO_PULL=0 ;;
        -h|--help)  sed -n '2,30p' "$0"; exit 0 ;;
        *) die "opțiune necunoscută: $arg (vezi --help)" ;;
    esac
done

ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-300s}"
KEEP_IMAGES="${KEEP_IMAGES:-3}"
HISTORY_FILE="$STATE_DIR/deploy-tags"
LOG_FILE="${LOG_FILE:-/var/log/flirt-deploy.log}"

require_root
require_cmd git docker k3s flock sha256sum

# Jurnal persistent + o singură rulare odată (două deploy-uri simultane s-ar
# călca pe tag-uri și pe Job-ul migrate).
mkdir -p "$STATE_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
exec 9>/run/flirt-deploy.lock
flock -n 9 || die "rulează deja un deploy (lock /run/flirt-deploy.lock)"

cd "$REPO_ROOT"

# --------------------------------------------------------------------------- #
# Rollback
# --------------------------------------------------------------------------- #
# Aduce `purge` și tag-urile `current` la imaginile care rulează efectiv.
sync_after_rollback() {
    local api_img web_img
    api_img="$(deploy_image api api)"
    web_img="$(deploy_image web web)"
    if [ -n "$api_img" ]; then
        kn set image cronjob/purge "purge=$api_img" >&2 || warn "nu pot seta imaginea cronjob/purge"
        ctr_has_image "$api_img" && ctr_retag_current "$api_img"
    fi
    if [ -n "$web_img" ]; then
        ctr_has_image "$web_img" && ctr_retag_current "$web_img"
    fi
}

undo_deployment() {
    local d="$1"
    log "ROLLBACK $d: kubectl rollout undo"
    kn rollout undo "deployment/$d" >&2 || { warn "rollout undo $d a eșuat (nu există revizie anterioară?)"; return 1; }
    kn rollout status "deployment/$d" --timeout="$ROLLOUT_TIMEOUT" >&2 \
        || { warn "$d nu s-a stabilizat nici după undo — intervenție manuală"; return 1; }
    log "$d: rollback OK → $(deploy_image "$d" "$d")"
}

if [ "$MODE" = rollback ]; then
    log "=== ROLLBACK manual (api + web) ==="
    rc=0
    undo_deployment api || rc=1
    undo_deployment web || rc=1
    sync_after_rollback
    warn "migrațiile NU au fost anulate (de aceea trebuie să fie compatibile înapoi)"
    exit "$rc"
fi

# --------------------------------------------------------------------------- #
# 1. Cod
# --------------------------------------------------------------------------- #
if [ "$DO_PULL" = 1 ]; then
    log "git pull --ff-only"
    git pull --ff-only
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ] && [ "${ALLOW_DIRTY:-0}" != 1 ]; then
    git status --short --untracked-files=no >&2
    die "copia de lucru are modificări necomise → tag-ul n-ar descrie imaginea (ALLOW_DIRTY=1 ca să forțezi)"
fi
TAG="$(git rev-parse --short HEAD)"
log "=== deploy $TAG ($(git log -1 --format=%s | cut -c1-80)) ==="

load_env

# --------------------------------------------------------------------------- #
# 2. Build
# --------------------------------------------------------------------------- #
export DOCKER_BUILDKIT=1
BUILD_FLAGS=()
# Fără atestări BuildKit: `docker save` ar produce un index OCI pe care
# `ctr import` nu-l poate importa complet.
if docker buildx version >/dev/null 2>&1; then
    BUILD_FLAGS+=(--provenance=false --sbom=false)
fi

log "build flirt-api:$TAG"
docker build "${BUILD_FLAGS[@]}" -t "flirt-api:$TAG" -t flirt-api:current "$REPO_ROOT/backend"

# Variabilele VITE_* sunt inline-uite în bundle → build-arg din .env (doar cele
# setate; restul iau valorile implicite din Dockerfile).
WEB_ARGS=()
for k in DOMAIN API_V1_PREFIX VITE_API_URL TELEGRAM_BOT_USERNAME VITE_TELEGRAM_BOT_USERNAME; do
    v="$(env_get "$CLEAN_ENV" "$k")"
    [ -n "$v" ] && WEB_ARGS+=(--build-arg "$k=$v")
done
log "build flirt-web:$TAG"
docker build "${BUILD_FLAGS[@]}" "${WEB_ARGS[@]}" -f "$REPO_ROOT/deploy/k8s/images/web/Dockerfile" \
    -t "flirt-web:$TAG" -t flirt-web:current "$REPO_ROOT"

# --------------------------------------------------------------------------- #
# 3. Import în containerd (DOAR :TAG; `current` se mută după rollout reușit)
# --------------------------------------------------------------------------- #
import_image "flirt-api:$TAG"
import_image "flirt-web:$TAG"
# Istoricul importurilor (pentru curățenie: ultimele N rămân pentru rollback).
echo "$TAG" >> "$HISTORY_FILE"

# --------------------------------------------------------------------------- #
# 4-5. Cluster + secret
# --------------------------------------------------------------------------- #
apply_cluster
refresh_secret

API_RUNNING="$(deploy_image api api)"
WEB_RUNNING="$(deploy_image web web)"

if [ "$MODE" = prepare ]; then
    # Instalare nouă (încă nimic în k8s): `current` = imaginea tocmai construită,
    # ca `apply -k` să aibă ce porni.
    [ -n "$API_RUNNING" ] || ctr_retag_current "flirt-api:$TAG"
    [ -n "$WEB_RUNNING" ] || ctr_retag_current "flirt-web:$TAG"
    log "=== --prepare gata: imagini flirt-api:$TAG / flirt-web:$TAG importate, secret actualizat ==="
    exit 0
fi

FRESH=0
if [ -z "$API_RUNNING" ] || [ -z "$WEB_RUNNING" ]; then
    # Prima instalare: nu există versiune veche de protejat.
    warn "Deployment-urile nu există încă → instalare nouă"
    FRESH=1
    ctr_retag_current "flirt-api:$TAG"
    ctr_retag_current "flirt-web:$TAG"
    API_RUNNING="flirt-api:current"
    WEB_RUNNING="flirt-web:current"
fi

# --------------------------------------------------------------------------- #
# 6. Manifeste (apply -k) — imaginile rămân cele care rulează
# --------------------------------------------------------------------------- #
log "apply manifeste (imagini fixate: $API_RUNNING, $WEB_RUNNING)"
apply_manifests_pinned "$API_RUNNING" "$WEB_RUNNING"
if [ "$FRESH" = 1 ]; then
    kn rollout status statefulset/db --timeout="$ROLLOUT_TIMEOUT" >&2
fi

# --------------------------------------------------------------------------- #
# 7. Migrații — eșec = STOP înainte de a atinge Deployment-urile
# --------------------------------------------------------------------------- #
if ! run_migrate_job "$TAG"; then
    die "migrațiile au eșuat → NU am atins Deployment-urile; versiunea veche ($API_RUNNING) servește în continuare"
fi

# --------------------------------------------------------------------------- #
# 8. Rollout
# --------------------------------------------------------------------------- #
# Un singur patch = o singură revizie: imaginea + amprenta .env (pod-uri noi și
# când s-a schimbat doar .env-ul).
rollout() {
    local d="$1" img="$2"
    log "rollout $d → $img"
    kn annotate "deployment/$d" kubernetes.io/change-cause="deploy $TAG" --overwrite >&2
    kn patch "deployment/$d" --type strategic -p "$(printf \
        '{"spec":{"template":{"metadata":{"annotations":{"flirt.md/env-sha":"%s"}},"spec":{"containers":[{"name":"%s","image":"%s"}]}}}}' \
        "$ENV_SHA" "$d" "$img")" >&2
    if kn rollout status "deployment/$d" --timeout="$ROLLOUT_TIMEOUT" >&2; then
        log "$d: rollout OK"
        return 0
    fi
    log "$d: ROLLOUT EȘUAT"
    rollout_diag "$d"
    undo_deployment "$d" || true
    return 1
}

if ! rollout api "flirt-api:$TAG"; then
    sync_after_rollback
    die "api: rollout eșuat → revenit la $(deploy_image api api). Web neatins."
fi
kn set image cronjob/purge "purge=flirt-api:$TAG" >&2
ctr_retag_current "flirt-api:$TAG"

if ! rollout web "flirt-web:$TAG"; then
    sync_after_rollback
    die "web: rollout eșuat → revenit la $(deploy_image web web). API-ul rămâne pe flirt-api:$TAG (compatibil)."
fi
ctr_retag_current "flirt-web:$TAG"

log "=== deploy $TAG REUȘIT ==="

# --------------------------------------------------------------------------- #
# 10. Curățenie imagini: ultimele $KEEP_IMAGES tag-uri + tot ce e folosit
# --------------------------------------------------------------------------- #
prune_images() {
    local keep in_use ref tag repo
    # Ultimele N tag-uri unice, în ordinea importului.
    keep="$(tac "$HISTORY_FILE" | awk '!seen[$0]++' | head -n "$KEEP_IMAGES")"
    # Plus orice imagine folosită acum (pod-uri, deployment-uri, cronjob-uri).
    in_use="$(kn get pods,deployments,cronjobs,jobs -o jsonpath='{range .items[*]}{..image}{" "}{end}' 2>/dev/null \
        | tr ' ' '\n' | sed -n 's#^\(docker.io/library/\)\{0,1\}flirt-\(api\|web\):##p' | sort -u)"
    keep="$(printf '%s\n%s\n' "$keep" "$in_use" | grep -v '^$' | sort -u)"
    if [ "$(tac "$HISTORY_FILE" | awk '!seen[$0]++' | wc -l)" -lt 2 ]; then
        log "curățenie: istoric prea scurt ($HISTORY_FILE) → nu șterg nimic din containerd"
    else
        for ref in $(ctr_k3s images ls -q | grep -E '^docker.io/library/flirt-(api|web):' || true); do
            tag="${ref##*:}"
            [ "$tag" = current ] && continue
            grep -qxF "$tag" <<< "$keep" && continue
            log "curățenie containerd: $ref"
            ctr_k3s images rm "$ref" >/dev/null || warn "nu pot șterge $ref"
        done
    fi
    for repo in flirt-api flirt-web; do
        for tag in $(docker image ls "$repo" --format '{{.Tag}}' | grep -v -e '^current$' -e '^<none>$' || true); do
            grep -qxF "$tag" <<< "$keep" && continue
            log "curățenie docker: $repo:$tag"
            docker rmi "$repo:$tag" >/dev/null || warn "nu pot șterge $repo:$tag"
        done
    done
    # Istoricul: păstrăm doar intrările încă relevante.
    tac "$HISTORY_FILE" | awk '!seen[$0]++' | head -n "$KEEP_IMAGES" | tac > "$HISTORY_FILE.tmp" \
        && mv "$HISTORY_FILE.tmp" "$HISTORY_FILE"
}
prune_images || warn "curățenia imaginilor a eșuat (deploy-ul e totuși REUȘIT)"

kn get deploy,pods -o wide >&2 || true

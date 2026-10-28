#!/usr/bin/env bash
# FLIRT — cutover UNIC: docker compose → k3s. Rulează PE SERVER, din /opt/flirt:
#
#   deploy/k8s/scripts/install-k3s.sh phase1      (o dată; deja făcut)
#   deploy/k8s/scripts/deploy.sh --prepare        (imagini + secret)
#   deploy/k8s/scripts/migrate-from-compose.sh    (acest script)
#
# Opțiuni: --yes (fără întrebări), --skip-tls-import
#
# Pași (fiecare anunțat; cei făcuți se sar la re-rulare — marcaje în
# /var/lib/flirt/cutover/):
#   a. verificări (k3s, cert-manager, imagini, secret, compose)
#   a2. FĂRĂ downtime: cluster + certificat TLS importat + manifeste; api la 0
#       replici și cronjob-urile suspendate până după restaurare
#   b. DOWNTIME începe: docker compose stop api purge (nu mai scrie nimeni)
#   c. pg_dump din compose → /opt/flirt-backups/cutover-<dată>.sql.gz
#   d. restaurare în Postgres-ul k8s (DOAR dacă baza țintă e goală) + Job migrate
#   e. media: volumul compose flirt_mediadata → PVC `media` (chown 1000)
#   g. pornire api în k8s → stop compose nginx/certbot/backup → phase2 (Traefik)
#   h. teste de fum pe cele trei domenii
#   i. instrucțiuni de rollback
#
# NU se face niciodată `docker compose down -v`: volumele compose rămân intacte
# (ele SUNT planul de rollback).
set -euo pipefail

LOG_TAG=cutover
# shellcheck source=lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

SKIP_TLS=0
for arg in "$@"; do
    case "$arg" in
        --yes) ASSUME_YES=1 ;;
        --skip-tls-import) SKIP_TLS=1 ;;
        -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
        *) die "opțiune necunoscută: $arg" ;;
    esac
done

COMPOSE_DIR="$REPO_ROOT/backend"
COMPOSE_PROJECT=flirt
BACKUP_DIR="${BACKUP_HOST_DIR:-/opt/flirt-backups}"
CUTOVER_STATE="$STATE_DIR/cutover"
API_UID="${API_UID:-1000}"     # runAsUser din api.yaml = appuser din backend/Dockerfile
LOG_FILE="${LOG_FILE:-/var/log/flirt-cutover.log}"

require_root
require_cmd docker k3s gzip tar ss curl openssl flock

mkdir -p "$CUTOVER_STATE" "$BACKUP_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
exec 9>/run/flirt-deploy.lock
flock -n 9 || die "rulează deja un deploy/cutover (lock /run/flirt-deploy.lock)"

dc() { (cd "$COMPOSE_DIR" && docker compose "$@"); }
done_mark() { touch "$CUTOVER_STATE/$1.done"; }
is_done()   { [ -f "$CUTOVER_STATE/$1.done" ]; }
step()      { log ""; log "================ $* ================"; }

# psql cu stdin, în Postgres-ul k8s / compose (variabilele POSTGRES_* ale containerului).
# shellcheck disable=SC2016  # $POSTGRES_* se expandează ÎN container, intenționat
k8s_psql() {
    kn exec -i db-0 -c postgres -- sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' psql "$@"
}
# shellcheck disable=SC2016
compose_psql() {
    dc exec -T db sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' psql "$@"
}
# Numărul EXACT de rânduri din fiecare tabel public: „tabel|n" pe linie.
COUNT_SQL="SELECT format('SELECT %L, count(*) FROM %I.%I', tablename, schemaname, tablename) FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename \\gexec"

load_env
DOMAIN="$(env_get "$CLEAN_ENV" DOMAIN)"
ADMIN_DOMAIN="$(env_get "$CLEAN_ENV" ADMIN_DOMAIN)"
MINIAPP_DOMAIN="$(env_get "$CLEAN_ENV" MINIAPP_DOMAIN)"
HOSTS="$DOMAIN $ADMIN_DOMAIN${MINIAPP_DOMAIN:+ $MINIAPP_DOMAIN}"

# =========================================================================== #
step "a. Verificări"
# =========================================================================== #
kc get nodes --no-headers | awk '{print $2}' | grep -qx Ready || die "nodul k3s nu e Ready"
log "k3s: $(k3s --version | head -1)"
kc -n cert-manager rollout status deploy/cert-manager deploy/cert-manager-webhook deploy/cert-manager-cainjector --timeout=60s >/dev/null \
    || die "cert-manager nu e gata (install-k3s.sh phase1)"
log "cert-manager: OK"
for img in flirt-api:current flirt-web:current; do
    ctr_has_image "$img" || die "lipsește $img în containerd → rulează: deploy/k8s/scripts/deploy.sh --prepare"
done
log "imagini în containerd: OK"
kn get secret flirt-env >/dev/null 2>&1 || die "secretul $NS/flirt-env lipsește → deploy.sh --prepare"
for k in $REQUIRED_ENV_KEYS; do
    kn get secret flirt-env -o jsonpath="{.data.$k}" | grep -q . || die "flirt-env nu are cheia $k"
done
log "secret flirt-env: OK"
uid="$(docker run --rm --entrypoint id flirt-api:current -u 2>/dev/null || true)"
[ "$uid" = "$API_UID" ] || die "utilizatorul imaginii flirt-api are uid '$uid', manifestele presupun $API_UID (API_UID=...)"
MEDIA_SRC="$(docker volume inspect "${COMPOSE_PROJECT}_mediadata" -f '{{.Mountpoint}}' 2>/dev/null || true)"
[ -d "$MEDIA_SRC" ] || die "volumul ${COMPOSE_PROJECT}_mediadata nu există"
log "media compose: $MEDIA_SRC ($(du -sh "$MEDIA_SRC" | cut -f1), $(find "$MEDIA_SRC" -type f | wc -l) fișiere)"
log "spațiu liber în $BACKUP_DIR: $(df -h --output=avail "$BACKUP_DIR" | tail -1 | tr -d ' ')"
log "domenii: $HOSTS"
if ! is_done restore; then
    dc ps --status running --services | grep -qx db || die "Postgres-ul din compose nu rulează (e sursa datelor)"
fi

cat >&2 <<EOF

  Planul:
    a2. pregătire k8s (fără downtime)
    b.  DOWNTIME: docker compose stop api purge
    c.  pg_dump → $BACKUP_DIR/cutover-<dată>.sql.gz
    d.  restaurare în k8s (doar dacă baza e goală) + migrații
    e.  copiere media → PVC media
    g.  api k8s pornit → compose stop nginx certbot backup backup-media → Traefik (phase2)
    h.  teste de fum

EOF
confirm "Continui?" || die "anulat"

if is_done phase2; then
    log "cutover-ul e deja făcut (marcaj phase2) → rulez doar testele de fum"
else

# =========================================================================== #
step "a2. Pregătire k8s (fără downtime)"
# =========================================================================== #
apply_cluster
refresh_secret

# TLS: certificatul Let's Encrypt din compose (UNUL, cu SAN pe toate numele) devine
# secretul inițial `flirt-tls` al Ingress-ului → zero fereastră fără TLS valid.
# cert-manager îl vede ca „neemis de el" și cere imediat unul nou (HTTP-01, după
# phase2); până atunci Traefik servește certificatul importat.
import_tls() {
    if kn get secret flirt-tls >/dev/null 2>&1; then
        log "secretul flirt-tls există deja → nu-l ating"
        return 0
    fi
    local le live h san
    le="$(docker volume inspect "${COMPOSE_PROJECT}_letsencrypt" -f '{{.Mountpoint}}' 2>/dev/null || true)"
    live="$le/live/$DOMAIN"
    if [ -z "$le" ] || [ ! -s "$live/fullchain.pem" ] || [ ! -s "$live/privkey.pem" ]; then
        warn "nu găsesc certificatul compose ($live) → cert-manager va emite unul nou după phase2 (~30-60s fără TLS valid)"
        return 0
    fi
    if ! openssl x509 -in "$live/fullchain.pem" -noout -checkend 86400 >/dev/null; then
        warn "certificatul compose expiră în <24h → nu-l import"
        return 0
    fi
    san="$(openssl x509 -in "$live/fullchain.pem" -noout -ext subjectAltName 2>/dev/null || true)"
    for h in $HOSTS; do
        if ! grep -qF "DNS:$h" <<< "$san"; then
            warn "certificatul compose NU acoperă $h → nu-l import (cert-manager emite unul nou după phase2)"
            return 0
        fi
    done
    kn create secret tls flirt-tls --cert="$live/fullchain.pem" --key="$live/privkey.pem" >&2
    log "importat certificatul compose ca flirt-tls (expiră: $(openssl x509 -in "$live/fullchain.pem" -noout -enddate | cut -d= -f2))"
}
if [ "$SKIP_TLS" = 1 ]; then log "--skip-tls-import → sar peste import"; else import_tls; fi

log "apply -k $MANIFESTS"
kc apply -k "$MANIFESTS" >&2
# api oprit până după restaurare + migrații: nu are voie să atingă o bază pe
# jumătate restaurată. Cronjob-urile (purge, backup) suspendate din același motiv.
kn scale deployment/api --replicas=0 >&2
for cj in $(kn get cronjob -o name); do
    kn patch "$cj" -p '{"spec":{"suspend":true}}' >&2
done
log "aștept Postgres-ul din k8s"
kn rollout status statefulset/db --timeout=300s >&2
kn rollout status statefulset/redis --timeout=300s >&2

# =========================================================================== #
step "b. DOWNTIME începe: opresc scrierile în compose (api, purge)"
# =========================================================================== #
if is_done restore; then
    log "restaurarea e deja făcută → compose api/purge trebuie să fie oprite"
fi
dc stop api purge >&2
log "compose api + purge OPRITE (nginx din compose răspunde 502 pe API până la phase2)"

# =========================================================================== #
step "c+d. Dump din compose + restaurare în k8s"
# =========================================================================== #
if is_done restore; then
    log "restaurare deja făcută (marcaj $CUTOVER_STATE/restore.done) → sar"
else
    tables="$(echo "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';" | k8s_psql -tA)"
    if [ "$tables" != "0" ]; then
        die "baza din k8s NU e goală ($tables tabele) și nu există marcaj de restaurare → nu suprascriu nimic.
       Verifică manual; dacă e sigur de aruncat: kubectl -n $NS delete sts db && kubectl -n $NS delete pvc data-db-0
       (PV-ul are Retain → șterge-l și pe el), apoi re-rulează."
    fi
    DUMP="$BACKUP_DIR/cutover-$(date -u +%Y%m%d-%H%M%S).sql.gz"
    log "pg_dump → $DUMP"
    ( umask 077
      # shellcheck disable=SC2016
      dc exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' \
          | gzip -6 > "$DUMP.partial" )
    gzip -t "$DUMP.partial" || die "dump corupt"
    mv "$DUMP.partial" "$DUMP"
    log "dump OK ($(du -h "$DUMP" | cut -f1))"

    log "restaurez în db-0"
    gunzip -c "$DUMP" | k8s_psql >/dev/null || die "restaurarea a eșuat (baza k8s poate fi parțial populată — vezi mesajul de mai sus)"

    log "verific numărul de rânduri (compose vs k8s)"
    src_counts="$(printf '%s\n' "$COUNT_SQL" | compose_psql -tA)"
    dst_counts="$(printf '%s\n' "$COUNT_SQL" | k8s_psql -tA)"
    if [ "$src_counts" != "$dst_counts" ]; then
        diff <(printf '%s\n' "$src_counts") <(printf '%s\n' "$dst_counts") >&2 || true
        die "numărul de rânduri diferă între compose și k8s"
    fi
    log "rânduri identice în $(printf '%s\n' "$dst_counts" | grep -c .) tabele"
    echo "$DUMP" > "$CUTOVER_STATE/dump.path"
    done_mark restore
fi

run_migrate_job current || die "migrațiile au eșuat pe baza restaurată (compose e doar oprit: rollback = docker compose start api purge)"

# =========================================================================== #
step "e. Media: volum compose → PVC media"
# =========================================================================== #
# PVC-ul (WaitForFirstConsumer) se leagă când pornește primul pod care îl
# montează (web). Copiem direct pe disc, în directorul local-path al PV-ului.
for _ in $(seq 1 60); do
    [ "$(kn get pvc media -o jsonpath='{.status.phase}')" = Bound ] && break
    sleep 2
done
[ "$(kn get pvc media -o jsonpath='{.status.phase}')" = Bound ] || die "PVC media nu e Bound (kubectl -n $NS describe pvc media)"
PV="$(kn get pvc media -o jsonpath='{.spec.volumeName}')"
MEDIA_DST="$(kc get pv "$PV" -o jsonpath='{.spec.hostPath.path}{.spec.local.path}')"
[ -d "$MEDIA_DST" ] || die "nu găsesc directorul PV-ului $PV pe disc ('$MEDIA_DST')"
log "copiez $MEDIA_SRC → $MEDIA_DST"
# Cheile media sunt imuabile → re-rularea doar rescrie aceleași fișiere.
tar -C "$MEDIA_SRC" -cf - . | tar -C "$MEDIA_DST" -xpf - --numeric-owner
# api rulează ca uid $API_UID și scrie aici; hostPath nu aplică fsGroup.
chown -R "$API_UID:$API_UID" "$MEDIA_DST"
chmod 0755 "$MEDIA_DST"
n_src="$(find "$MEDIA_SRC" -type f | wc -l)"
n_dst="$(find "$MEDIA_DST" -type f | wc -l)"
[ "$n_dst" -ge "$n_src" ] || die "media: $n_dst fișiere în PVC < $n_src în compose"
log "media OK ($n_dst fișiere, proprietar $API_UID)"
done_mark media

# =========================================================================== #
step "g. Pornesc aplicația în k8s și mut porturile 80/443 la Traefik"
# =========================================================================== #
kc apply -k "$MANIFESTS" >&2           # replicas + restul exact ca în git
kn scale deployment/api --replicas=2 >&2
for cj in $(kn get cronjob -o name); do
    kn patch "$cj" -p '{"spec":{"suspend":false}}' >&2
done
kn rollout status deployment/api --timeout=300s >&2 || { rollout_diag api; die "api nu pornește în k8s (compose: docker compose start api purge = rollback)"; }
kn rollout status deployment/web --timeout=300s >&2 || { rollout_diag web; die "web nu pornește în k8s"; }
log "api + web gata în k8s"

confirm "Opresc nginx/certbot/backup din compose și pornesc Traefik (phase2)?" || die "oprit înainte de phase2 (compose nginx încă ține 80/443)"
dc stop nginx certbot backup backup-media >&2
"$LIB_DIR/install-k3s.sh" phase2
done_mark phase2
fi  # ! is_done phase2

# =========================================================================== #
step "h. Teste de fum"
# =========================================================================== #
fails=0
smoke() {
    local host="$1" path="$2" want_hdr="$3" out="" code="" k=""
    # Până la 2 minute: Traefik/ServiceLB pot avea nevoie de câteva secunde.
    for _ in $(seq 1 24); do
        if out="$(curl -sS -o /dev/null -D - ${k:+-k} --max-time 10 --resolve "$host:443:127.0.0.1" "https://$host$path" 2>&1)"; then
            code="$(awk 'toupper($1) ~ /^HTTP/ {c=$2} END {print c}' <<< "$out")"
            [ "$code" = 200 ] && break
        elif [ -z "$k" ] && grep -qi 'certificate\|SSL' <<< "$out"; then
            warn "$host: TLS încă neconfirmat (certificat în curs de emitere?) → reîncerc fără verificare"
            k=1
        fi
        sleep 5
    done
    if [ "$code" != 200 ]; then
        log "✗ https://$host$path → ${code:-fără răspuns}"; fails=$((fails + 1)); return
    fi
    local h missing=""
    for h in strict-transport-security x-content-type-options $want_hdr; do
        grep -qi "^$h:" <<< "$out" || missing="$missing $h"
    done
    if [ -n "$missing" ]; then
        log "✗ https://$host$path → 200 dar lipsesc antetele:$missing"; fails=$((fails + 1))
    else
        log "✓ https://$host$path → 200 ${k:+(cert neverificat)}"
    fi
}
smoke "$DOMAIN" /health/ready ""
smoke "$ADMIN_DOMAIN" / "content-security-policy x-frame-options"
[ -n "$MINIAPP_DOMAIN" ] && smoke "$MINIAPP_DOMAIN" / "content-security-policy permissions-policy"
redir="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$DOMAIN:80:127.0.0.1" "http://$DOMAIN/health" || true)"
log "http://$DOMAIN → $redir (așteptat 301/308 spre https)"
kn get certificate 2>/dev/null >&2 || true
log "IP-ul real al clienților: verifică în 'kubectl -n $NS logs deploy/web' că apar IP-uri publice (trunchiate .0), NU 10.42.x.0"

# =========================================================================== #
step "i. Rollback (dacă e nevoie)"
# =========================================================================== #
cat >&2 <<EOF

  ATENȚIE: datele scrise DUPĂ cutover există DOAR în Postgres-ul / PVC-ul din k8s.
  Un rollback la compose le pierde, dacă nu le exporți întâi
  (kubectl -n $NS exec db-0 -c postgres -- pg_dump ... > dump.sql).

  Rollback la docker compose:
    kubectl -n $NS scale deploy/api deploy/web --replicas=0     # (k3s kubectl)
    systemctl stop k3s && /usr/local/bin/k3s-killall.sh          # eliberează 80/443
    cd $COMPOSE_DIR && docker compose up -d                      # NICIODATĂ 'down -v'

  Revenire la k8s după aceea: docker compose stop nginx certbot api purge backup backup-media
                              && systemctl start k3s

  Compose db + redis rulează încă (sursa rollback-ului). După câteva zile stabile:
    cd $COMPOSE_DIR && docker compose stop db redis
EOF

if [ "$fails" -gt 0 ]; then
    die "$fails teste de fum au eșuat — verifică înainte de a declara cutover-ul gata"
fi
log "CUTOVER GATA."

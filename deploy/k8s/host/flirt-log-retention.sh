#!/usr/bin/env bash
# FLIRT — retenția în TIMP a jurnalelor de pe host (rulează ca root, zilnic).
#
# Politica de confidențialitate promite: jurnalele se șterg după cel mult
# LOG_RETENTION_DAYS (implicit 30) de zile. Kubelet rotește log-urile podurilor
# DOAR după mărime (container-log-max-size × container-log-max-files), deci pe un
# container cu trafic mic o linie ar putea rămâne luni de zile. Scriptul ăsta
# aplică limita în timp:
#
#   1. /var/log/pods — fișierele ROTITE de kubelet (`0.log.<stamp>`, `.gz`):
#      șterse când ultima lor linie e mai veche de termen (după conținut, nu doar
#      mtime: kubelet comprimă la rotația URMĂTOARE, deci mtime-ul `.gz` poate fi
#      mult mai nou decât conținutul). Fișierul ACTIV (`N.log`): liniile mai vechi
#      de termen sunt scoase pe loc (același inode; containerd scrie în O_APPEND).
#      Un container tăcut de peste termen rămâne cu fișierul gol.
#   2. /var/log/containers — doar symlink-uri spre (1); cele rupte sunt șterse.
#   3. /var/lib/docker/containers — Docker mai e folosit doar la build: rotitele
#      vechi șterse, din fișierul activ `*-json.log` liniile vechi scoase.
#   4. /var/log (rsyslog/logrotate: syslog, auth.log, ufw.log, kern.log, btmp…):
#      fișierele rotite (`*.N`, `*.N.gz`) mai vechi de termen, șterse.
#   journald (k3s, containerd, ssh) are MaxRetentionSec în
#   /etc/systemd/journald.conf.d/flirt-retention.conf (install-k3s.sh host-hardening).
#
# Ca să nu depășim termenul între două rulări zilnice, ștergem tot ce e mai vechi
# de LOG_RETENTION_DAYS - 1 zile (o zi de marjă).
#
# Instalat de `deploy/k8s/scripts/install-k3s.sh host-hardening` ca
# /usr/local/sbin/flirt-log-retention, rulat de flirt-log-retention.timer.
# Variabile: LOG_RETENTION_DAYS (din /etc/default/flirt-log-retention), DRY_RUN=1
# (doar numără, nu modifică nimic). Scrie în jurnal DOAR numărători, niciun conținut.
set -euo pipefail
export LC_ALL=C

DAYS="${LOG_RETENTION_DAYS:-30}"
case "$DAYS" in ''|*[!0-9]*) echo "LOG_RETENTION_DAYS invalid: $DAYS" >&2; exit 1 ;; esac
[ "$DAYS" -ge 2 ] || { echo "LOG_RETENTION_DAYS trebuie să fie >= 2" >&2; exit 1; }
DRY_RUN="${DRY_RUN:-0}"

MAX_AGE=$((DAYS - 1))                       # zile; vezi „o zi de marjă" mai sus
CUT_EPOCH=$(( $(date +%s) - MAX_AGE * 86400 ))
CUT_UTC="$(date -u -d "@$CUT_EPOCH" +%Y-%m-%dT%H:%M:%S)"
CUT_LOCAL="$(date -d "@$CUT_EPOCH" +%Y-%m-%dT%H:%M:%S)"

POD_LOGS="${POD_LOGS:-/var/log/pods}"
CONTAINER_LINKS="${CONTAINER_LINKS:-/var/log/containers}"
DOCKER_CONTAINERS="${DOCKER_CONTAINERS:-/var/lib/docker/containers}"
SYS_LOGS="${SYS_LOGS:-/var/log}"

deleted=0 trimmed=0 lines_removed=0

say() { printf '[flirt-log-retention] %s\n' "$*"; }

remove_file() {
    deleted=$((deleted + 1))
    [ "$DRY_RUN" = 1 ] || rm -f -- "$1"
}

# Prima coloană a unei linii CRI: RFC3339Nano, în fusul orar al lui containerd
# (`Z` dacă hostul e pe UTC, altfel `+HH:MM`).
cri_ts_epoch() { date -d "$1" +%s 2>/dev/null || echo ""; }

# Pragul în ACELAȘI format ca timestamp-ul dat (comparație lexicografică în awk;
# toate liniile unui fișier au același decalaj, în afară de o schimbare de oră).
cutoff_for() { case "$1" in *Z) echo "$CUT_UTC" ;; *) echo "$CUT_LOCAL" ;; esac; }

# Scoate pe loc liniile mai vechi de prag. $1 fișier, $2 prag, $3 extractor awk
# ("cri" = primul câmp, "docker" = câmpul JSON "time"). Același inode: `cat >`
# trunchiază și rescrie; scriitorul (containerd/dockerd, O_APPEND) continuă la final.
trim_file() {
    local f="$1" cut="$2" mode="$3" tmp before after
    tmp="$(mktemp)"
    awk -v cut="$cut" -v mode="$mode" '
        {
            if (mode == "cri") t = substr($1, 1, 19)
            else if (match($0, /"time":"[^"]*"/)) t = substr($0, RSTART + 8, 19)
            else t = ""
            if (t != "" && t < cut) next
            print
        }
    ' "$f" > "$tmp"
    before=$(wc -l < "$f"); after=$(wc -l < "$tmp")
    if [ "$after" -lt "$before" ]; then
        trimmed=$((trimmed + 1))
        lines_removed=$((lines_removed + before - after))
        [ "$DRY_RUN" = 1 ] || cat "$tmp" > "$f"
    fi
    rm -f "$tmp"
}

# --- 1. loguri de poduri ---------------------------------------------------- #
if [ -d "$POD_LOGS" ]; then
    # 1a. rotite: mtime peste termen → sigur vechi; altfel după ultima linie.
    while IFS= read -r -d '' f; do
        if [ -n "$(find "$f" -maxdepth 0 -mtime "+$((MAX_AGE - 1))" -print)" ]; then
            remove_file "$f"; continue
        fi
        case "$f" in
            *.gz) last="$(zcat -- "$f" 2>/dev/null | tail -n1 | awk '{print $1}')" ;;
            *)    last="$(tail -n1 -- "$f" | awk '{print $1}')" ;;
        esac
        e="$(cri_ts_epoch "$last")"
        if [ -n "$e" ] && [ "$e" -lt "$CUT_EPOCH" ]; then remove_file "$f"; fi
    done < <(find "$POD_LOGS" -mindepth 3 -maxdepth 3 -type f -name '*.log.*' -print0)

    # 1b. active: doar dacă PRIMA linie e mai veche de prag (altfel nimic de scos).
    while IFS= read -r -d '' f; do
        [ -s "$f" ] || continue
        first="$(head -n1 -- "$f" | awk '{print $1}')"
        [ -n "$first" ] || continue
        cut="$(cutoff_for "$first")"
        if [[ "${first:0:19}" < "$cut" ]]; then trim_file "$f" "$cut" cri; fi
    done < <(find "$POD_LOGS" -mindepth 3 -maxdepth 3 -type f -name '*.log' -print0)

    # Directoare goale rămase (kubelet le șterge de obicei odată cu podul).
    if [ "$DRY_RUN" != 1 ]; then
        find "$POD_LOGS" -mindepth 1 -type d -empty -mtime "+$((MAX_AGE - 1))" -delete 2>/dev/null || true
    fi
fi

# --- 2. symlink-uri rupte --------------------------------------------------- #
if [ -d "$CONTAINER_LINKS" ]; then
    while IFS= read -r -d '' f; do remove_file "$f"; done \
        < <(find "$CONTAINER_LINKS" -maxdepth 1 -xtype l -print0)
fi

# --- 3. Docker (json-file) -------------------------------------------------- #
if [ -d "$DOCKER_CONTAINERS" ]; then
    while IFS= read -r -d '' f; do remove_file "$f"; done \
        < <(find "$DOCKER_CONTAINERS" -mindepth 2 -maxdepth 2 -type f -name '*-json.log.*' \
                -mtime "+$((MAX_AGE - 1))" -print0)
    while IFS= read -r -d '' f; do
        [ -s "$f" ] || continue
        first="$(head -n1 -- "$f" | sed -n 's/.*"time":"\([^"]*\)".*/\1/p')"
        [ -n "$first" ] || continue
        if [[ "${first:0:19}" < "$CUT_UTC" ]]; then trim_file "$f" "$CUT_UTC" docker; fi
    done < <(find "$DOCKER_CONTAINERS" -mindepth 2 -maxdepth 2 -type f -name '*-json.log' -print0)
fi

# --- 4. /var/log rotit de logrotate ---------------------------------------- #
# Conținutul unui fișier rotit nu e mai nou decât mtime-ul lui ⇒ ștergerea după
# mtime e sigură. Jurnalul journald, podurile și containerele sunt tratate separat.
if [ -d "$SYS_LOGS" ]; then
    while IFS= read -r -d '' f; do remove_file "$f"; done < <(
        find "$SYS_LOGS" -mindepth 1 -maxdepth 2 \
            \( -path "$SYS_LOGS/journal" -o -path "$SYS_LOGS/pods" -o -path "$SYS_LOGS/containers" \) -prune -o \
            -type f -regextype posix-extended -regex '.*\.[0-9]+(\.gz)?' \
            -mtime "+$((MAX_AGE - 1))" -print0)
fi

mode=""; [ "$DRY_RUN" = 1 ] && mode=" (DRY_RUN: nimic modificat)"
say "termen ${DAYS}z (prag ${MAX_AGE}z): fișiere șterse=$deleted, fișiere active curățate=$trimmed, linii scoase=$lines_removed$mode"

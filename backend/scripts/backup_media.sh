#!/bin/sh
# Backup MEDIA — arhivă comprimată a volumului cu pozele/story-urile userilor.
#
# DE CE EXISTĂ: auditul a constatat că baza de date are backup automat
# (`backup_db.sh`), dar volumul `mediadata` NU avea niciunul. Într-o aplicație de
# dating, pozele SUNT profilul: un volum pierdut înseamnă mii de conturi goale,
# irecuperabile — la fel de grav ca pierderea DB-ului, doar că mai puțin vizibil
# (dump-ul SQL se restaurează, dar el conține doar CĂILE către fișiere).
#
# Rulare:
#   sh scripts/backup_media.sh          # o singură arhivă, apoi iese (cron extern)
#   sh scripts/backup_media.sh --loop   # buclă (serviciul `backup-media` din compose)
#
# Config (din mediu — vezi docker-compose.yml / .env):
#   MEDIA_DIR                      — ce arhivăm (implicit /data/media), montat :ro
#   MEDIA_BACKUP_DIR               — unde scrie (implicit /backups/media)
#   MEDIA_BACKUP_INTERVAL_SECONDS  — cadența în modul --loop (implicit 86400 = zilnic)
#   MEDIA_BACKUP_RETENTION_DAYS    — câte zile păstrăm arhivele (implicit 14)
#
# ⚠️  SIGURANȚĂ — acest script NU ȘTERGE NICIODATĂ date sursă:
#   - sursa e deschisă DOAR pentru citire (`tar -c`); nu există niciun `rm`, `mv`
#     sau redirectare care să atingă $MEDIA_DIR;
#   - `rm` apare o singură dată, pe fișierul TEMPORAR .partial din directorul de
#     backup, iar retenția (`find -delete`) e limitată la $MEDIA_BACKUP_DIR,
#     `-maxdepth 1`, `-type f` și la tiparul EXACT al numelor produse de el;
#   - dacă directorul de backup ar fi (din greșeală) în interiorul celui de media,
#     scriptul refuză să ruleze — altfel retenția ar putea ajunge la date reale;
#   - în compose, volumul de media e montat `:ro`, deci chiar și o greșeală
#     viitoare de cod ar fi oprită de kernel.
#
# Restore (manual, cu stack-ul oprit — vezi docs/DEPLOYMENT.md):
#   docker run --rm -v flirt_mediadata:/data/media -v "$PWD/backups/media:/b:ro" \
#     alpine sh -c 'tar xzf /b/media-AAAALLZZ-HHMMSS.tar.gz -C /'
# TESTEAZĂ restore-ul periodic: o arhivă nerestaurată vreodată NU e backup.
set -eu

MEDIA_DIR="${MEDIA_DIR:-/data/media}"
MEDIA_BACKUP_DIR="${MEDIA_BACKUP_DIR:-/backups/media}"
MEDIA_BACKUP_INTERVAL_SECONDS="${MEDIA_BACKUP_INTERVAL_SECONDS:-86400}"
MEDIA_BACKUP_RETENTION_DAYS="${MEDIA_BACKUP_RETENTION_DAYS:-14}"
PREFIX=media

log() {
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [backup-media] $*"
}

do_backup() {
    if [ ! -d "$MEDIA_DIR" ]; then
        log "EȘEC: $MEDIA_DIR nu există (volumul de media nu e montat?)"
        return 1
    fi

    # Plasa de siguranță descrisă mai sus: destinația NU are voie să fie în sursă.
    case "$MEDIA_BACKUP_DIR/" in
        "$MEDIA_DIR"/*)
            log "REFUZ: MEDIA_BACKUP_DIR ($MEDIA_BACKUP_DIR) e în interiorul"
            log "MEDIA_DIR ($MEDIA_DIR) — retenția ar putea șterge date reale."
            return 1
            ;;
    esac

    mkdir -p "$MEDIA_BACKUP_DIR"
    stamp="$(date -u +%Y%m%d-%H%M%S)"
    target="$MEDIA_BACKUP_DIR/${PREFIX}-${stamp}.tar.gz"
    tmp="${target}.partial"

    log "arhivez $MEDIA_DIR → $target"
    # Scriem întâi în .partial și abia apoi redenumim: o arhivă întreruptă (kill,
    # disc plin) NU trebuie să arate ca un backup valid.
    # `-C /` + cale relativă: arhiva conține `data/media/...`, deci restore-ul se
    # face cu `tar xzf ... -C /`, fără ghicit prefixe.
    rel="${MEDIA_DIR#/}"
    if tar czf "$tmp" -C / "$rel"; then
        mv "$tmp" "$target"
        log "OK ($(wc -c < "$target") octeți)"
    else
        rm -f "$tmp"
        log "EȘEC: tar a returnat eroare"
        return 1
    fi

    # Retenție: ștergem DOAR arhivele proprii, mai vechi de N zile, din directorul
    # de backup (niciodată recursiv, niciodată în afara tiparului de nume).
    deleted="$(find "$MEDIA_BACKUP_DIR" -maxdepth 1 -type f -name "${PREFIX}-*.tar.gz" -mtime "+${MEDIA_BACKUP_RETENTION_DAYS}" -print -delete | wc -l)"
    if [ "$deleted" -gt 0 ]; then
        log "retenție: am șters $deleted arhive mai vechi de ${MEDIA_BACKUP_RETENTION_DAYS} zile"
    fi
}

if [ "${1:-}" = "--loop" ]; then
    log "pornit în buclă (la fiecare ${MEDIA_BACKUP_INTERVAL_SECONDS}s, retenție ${MEDIA_BACKUP_RETENTION_DAYS} zile)"
    while :; do
        # O eroare temporară (volum nemontat încă) nu are voie să omoare bucla.
        do_backup || log "continui; reîncerc la următorul ciclu"
        sleep "$MEDIA_BACKUP_INTERVAL_SECONDS"
    done
else
    do_backup
fi

#!/bin/sh
# Backup Postgres — pg_dump comprimat + retenție. Zero valori hardcodate.
#
# Într-o aplicație de dating pierderea DB-ului = pierderea produsului (conturi,
# match-uri, conversații — toate irecuperabile).
#
# Rulare:
#   sh scripts/backup_db.sh          # un singur dump, apoi iese (cron extern)
#   sh scripts/backup_db.sh --loop   # buclă (serviciul `backup` din compose)
#
# Config (din mediu — vezi docker-compose.yml / .env):
#   PGHOST, PGUSER, PGPASSWORD, PGDATABASE  — conexiunea (variabile standard libpq)
#   BACKUP_DIR                              — unde scrie (implicit /backups)
#   BACKUP_INTERVAL_SECONDS                 — cadența în modul --loop (implicit 86400 = zilnic)
#   BACKUP_RETENTION_DAYS                   — câte zile păstrăm (implicit 14)
#
# Restore: `sh scripts/restore_db.sh <fișier.sql.gz>` — vezi docs/DEPLOYMENT.md.
# TESTEAZĂ restore-ul periodic: un backup nerestaurat vreodată NU e backup.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
PGDATABASE="${PGDATABASE:-flirt}"

log() {
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [backup] $*"
}

do_backup() {
    mkdir -p "$BACKUP_DIR"
    stamp="$(date -u +%Y%m%d-%H%M%S)"
    target="$BACKUP_DIR/${PGDATABASE}-${stamp}.sql.gz"
    tmp="${target}.partial"

    log "dump → $target"
    # --clean --if-exists: dump-ul poate fi reaplicat peste o bază existentă.
    # Scriem întâi în .partial și abia apoi redenumim: un dump întrerupt (kill,
    # disc plin) NU trebuie să arate ca un backup valid.
    if pg_dump --clean --if-exists --no-owner --no-privileges "$PGDATABASE" | gzip -9 > "$tmp"; then
        mv "$tmp" "$target"
        log "OK ($(wc -c < "$target") octeți)"
    else
        rm -f "$tmp"
        log "EȘEC: pg_dump a returnat eroare"
        return 1
    fi

    # Retenție: ștergem dump-urile mai vechi de N zile.
    deleted="$(find "$BACKUP_DIR" -name "${PGDATABASE}-*.sql.gz" -type f -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete | wc -l)"
    if [ "$deleted" -gt 0 ]; then
        log "retenție: am șters $deleted backup-uri mai vechi de ${BACKUP_RETENTION_DAYS} zile"
    fi
}

if [ "${1:-}" = "--loop" ]; then
    log "pornit în buclă (la fiecare ${BACKUP_INTERVAL_SECONDS}s, retenție ${BACKUP_RETENTION_DAYS} zile)"
    while :; do
        # O eroare temporară (DB în restart) nu are voie să omoare bucla.
        do_backup || log "continui; reîncerc la următorul ciclu"
        sleep "$BACKUP_INTERVAL_SECONDS"
    done
else
    do_backup
fi

#!/bin/sh
# Restore Postgres dintr-un backup produs de `backup_db.sh`.
#
# DE CE EXISTĂ: un backup pe care nu l-ai restaurat niciodată NU e un backup — e
# o presupunere. Rulează procedura asta pe o bază de TEST cel puțin o dată pe
# trimestru și după orice schimbare de schemă majoră.
#
# Rulare (din containerul `backup`, care are pg_restore/psql și acces la db):
#   docker compose run --rm \
#     -e PGDATABASE=flirt_restore_test \
#     backup sh /scripts/restore_db.sh /backups/flirt-20260712-030000.sql.gz
#
# ⚠️  Restore-ul face DROP pe obiectele existente din baza țintă (dump-ul e luat
# cu --clean --if-exists). Verifică de DOUĂ ori PGDATABASE înainte să rulezi în
# producție. Implicit refuzăm baza de producție dacă nu confirmi explicit cu
# `--force` (protecție anti-degete-grase).
set -eu

DUMP_FILE="${1:-}"
FORCE="${2:-}"

if [ -z "$DUMP_FILE" ]; then
    echo "Utilizare: sh restore_db.sh <fișier.sql.gz> [--force]" >&2
    exit 2
fi
if [ ! -f "$DUMP_FILE" ]; then
    echo "Fișierul nu există: $DUMP_FILE" >&2
    exit 2
fi

PGDATABASE="${PGDATABASE:-flirt}"
PROD_DB="${POSTGRES_DB:-flirt}"

if [ "$PGDATABASE" = "$PROD_DB" ] && [ "$FORCE" != "--force" ]; then
    cat >&2 <<EOF
REFUZ: baza țintă ($PGDATABASE) este baza de PRODUCȚIE.
Restore-ul ar SUPRASCRIE datele curente.

- test de restore  → rulează cu PGDATABASE=<bază_de_test> (recomandat)
- restore real     → adaugă --force, conștient că pierzi datele curente
EOF
    exit 3
fi

echo "→ Creez baza țintă dacă nu există: $PGDATABASE"
psql -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$PGDATABASE'" \
    | grep -q 1 || psql -d postgres -c "CREATE DATABASE \"$PGDATABASE\""

echo "→ Restaurez $DUMP_FILE în $PGDATABASE ..."
# ON_ERROR_STOP: dacă o instrucțiune eșuează, ne oprim — nu vrem un restore
# „pe jumătate reușit" pe care să-l credem complet.
gunzip -c "$DUMP_FILE" | psql --set ON_ERROR_STOP=on -d "$PGDATABASE"

echo "→ Verificare rapidă (numărul de utilizatori):"
psql -d "$PGDATABASE" -c "SELECT count(*) AS users FROM users;"

echo "✓ Restore terminat în baza '$PGDATABASE'."
echo "  Următorul pas: 'alembic upgrade head' (dacă backup-ul e dintr-o schemă mai veche)."

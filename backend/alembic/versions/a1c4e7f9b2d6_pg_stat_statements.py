"""extensia pg_stat_statements (statistica query-urilor lente)

Revision ID: a1c4e7f9b2d6
Revises: b7e2d4f9a3c1

Fără nicio schimbare de schemă a aplicației. Creează extensia ca să putem vedea
ce query-uri consumă timp pe producție:

    SELECT calls, round(mean_exec_time::numeric, 1) AS ms, query
    FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;

Colectarea propriu-zisă cere `shared_preload_libraries=pg_stat_statements` la
pornirea serverului (setat în deploy/k8s/manifests/db.yaml și în docker-compose.yml de dev; cere restart).
Fără el, extensia se creează, dar view-ul dă eroare la citire — aplicația nu-l
folosește, deci nimic nu se strică.

NU are voie să blocheze o migrare: dacă rolul nu are drepturi (extensia nu e
„trusted") sau pachetul contrib lipsește, blocul `EXCEPTION` înghite eroarea
(subtranzacție, deci tranzacția migrării rămâne validă) și lasă doar un NOTICE.
Manual, ca superuser: `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`
"""
from typing import Sequence, Union

from alembic import op

revision: str = "a1c4e7f9b2d6"
down_revision: Union[str, None] = "b7e2d4f9a3c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pg_stat_statements nu a putut fi creata: %', SQLERRM;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            DROP EXTENSION IF EXISTS pg_stat_statements;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pg_stat_statements nu a putut fi stearsa: %', SQLERRM;
        END
        $$;
        """
    )

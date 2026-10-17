"""recalculează events.tickets_sold din comenzile aprobate (corecție de date)

Revision ID: b8e1d4f7a2c3
Revises: a7d3f5c9b2e8

DE CE: până la valul de concurență pe bilete, aprobarea unei comenzi DIRECTE
(`ticket_order_service.approve` / `change_status`) nu ocupa locuri — doar cererile
manuale incrementau `tickets_sold`. Contorul e deci prea mic pe evenimentele cu
comenzi directe aprobate, iar capacitatea putea fi depășită.

Recalculăm contorul pentru TOATE evenimentele, din sursa de adevăr: suma
`ticket_quantity` a comenzilor `approved` (directe + cereri). Idempotentă: rulată
de două ori dă același rezultat. Doar date, fără schimbări de schemă.

Downgrade = no-op: valoarea veche era greșită, nu are rost restaurată.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "b8e1d4f7a2c3"
down_revision: Union[str, None] = "a7d3f5c9b2e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Expus ca modul-constantă ca testele să ruleze EXACT același SQL pe DB-ul de test.
RECOMPUTE_TICKETS_SOLD_SQL = """
UPDATE events AS e
SET tickets_sold = COALESCE((
    SELECT SUM(COALESCE(o.ticket_quantity, 1))
    FROM ticket_orders AS o
    WHERE o.event_id = e.id AND o.status = 'approved'
), 0)
"""


def upgrade() -> None:
    op.execute(RECOMPUTE_TICKETS_SOLD_SQL)


def downgrade() -> None:
    # Corecție de date: nu restaurăm contorul greșit.
    pass

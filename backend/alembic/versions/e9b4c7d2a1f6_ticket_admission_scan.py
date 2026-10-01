"""bilete: intrarea la eveniment (scanarea QR de staff la ușă)

Revision ID: e9b4c7d2a1f6
Revises: d4e7b2c9a815

Aditivă și sigură pe tabele populate: doar coloane NULL-abile, fără default
(doar metadate pe Postgres). NULL = biletul nu a fost scanat încă — exact starea
tuturor biletelor existente. Stările „used"/„expired" NU se stochează: se
calculează din ora evenimentului, deci nu e nevoie de cron.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e9b4c7d2a1f6"
down_revision: Union[str, None] = "d4e7b2c9a815"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Comenzile de bilet la evenimente (biletul are deja `event_id`).
    op.add_column("ticket_orders", sa.Column("admitted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("ticket_orders", sa.Column("admitted_by", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_ticket_orders_admitted_by_users", "ticket_orders", "users",
        ["admitted_by"], ["id"], ondelete="SET NULL",
    )
    # Biletul Flirt Party (nelegat de eveniment la emitere → reținem unde a intrat).
    op.add_column("tickets", sa.Column("admitted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tickets", sa.Column("admitted_by", sa.Uuid(), nullable=True))
    op.add_column("tickets", sa.Column("admitted_event_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_tickets_admitted_by_users", "tickets", "users",
        ["admitted_by"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_tickets_admitted_event_id_events", "tickets", "events",
        ["admitted_event_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_tickets_admitted_event_id_events", "tickets", type_="foreignkey")
    op.drop_constraint("fk_tickets_admitted_by_users", "tickets", type_="foreignkey")
    op.drop_column("tickets", "admitted_event_id")
    op.drop_column("tickets", "admitted_by")
    op.drop_column("tickets", "admitted_at")
    op.drop_constraint("fk_ticket_orders_admitted_by_users", "ticket_orders", type_="foreignkey")
    op.drop_column("ticket_orders", "admitted_by")
    op.drop_column("ticket_orders", "admitted_at")

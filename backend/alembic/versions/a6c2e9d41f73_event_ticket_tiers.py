"""events: tipuri de bilet (până la 4 prețuri per eveniment)

Revision ID: a6c2e9d41f73
Revises: d3f8a1c5e2b9

Tabel nou `event_ticket_tiers` (nume, preț, capacitate proprie opțională,
descriere, ordine, `sold`) + `ticket_orders.ticket_tier_id` (FK SET NULL) și
`ticket_tier_name` (snapshot-ul numelui, ca adminul să vadă ce s-a cumpărat și
după ștergerea tipului).

COMPATIBILITATE: fiecare eveniment care avea deja `ticket_price` primește UN tip
implicit „Standard" cu același preț, iar `sold` preia `tickets_sold` (capacitatea
rămâne pe eveniment, ca total). `events.ticket_price` NU dispare: devine prețul
minim al tipurilor („de la X lei"), sincronizat de admin la salvare — clienții
vechi și cotația de fidelitate funcționează neschimbat. Comenzile existente ale
acestor evenimente se leagă de tipul „Standard" (prețul lor rămâne cel
snapshot-uit pe comandă), ca anularea unui bilet vechi să elibereze corect și
locul din tip.

Downgrade: coloanele și tabelul dispar; `events.ticket_price` (prețul minim)
rămâne prețul unic al evenimentului.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "a6c2e9d41f73"
down_revision: Union[str, None] = "d3f8a1c5e2b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "event_ticket_tiers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("description", sa.String(length=200), nullable=True),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=True),
        sa.Column("sold", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_event_ticket_tiers_event_id", "event_ticket_tiers", ["event_id"]
    )

    op.add_column(
        "ticket_orders",
        sa.Column(
            "ticket_tier_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("event_ticket_tiers.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "ticket_orders",
        sa.Column("ticket_tier_name", sa.String(length=60), nullable=True),
    )
    op.create_index(
        "ix_ticket_orders_ticket_tier_id", "ticket_orders", ["ticket_tier_id"]
    )

    # Prețul unic existent → un tip implicit „Standard" (vezi antetul).
    # `md5(random()…)::uuid` în loc de `gen_random_uuid()`: merge și pe Postgres
    # fără extensia pgcrypto (< 13).
    op.execute(
        """
        INSERT INTO event_ticket_tiers (id, event_id, name, price, capacity, sold, position)
        SELECT md5(random()::text || clock_timestamp()::text || e.id::text)::uuid,
               e.id, 'Standard', e.ticket_price, NULL, COALESCE(e.tickets_sold, 0), 0
        FROM events e
        WHERE e.ticket_price IS NOT NULL
        """
    )
    op.execute(
        """
        UPDATE ticket_orders o
        SET ticket_tier_id = t.id, ticket_tier_name = t.name
        FROM event_ticket_tiers t
        WHERE t.event_id = o.event_id
        """
    )


def downgrade() -> None:
    op.drop_index("ix_ticket_orders_ticket_tier_id", table_name="ticket_orders")
    op.drop_column("ticket_orders", "ticket_tier_name")
    op.drop_column("ticket_orders", "ticket_tier_id")
    op.drop_index("ix_event_ticket_tiers_event_id", table_name="event_ticket_tiers")
    op.drop_table("event_ticket_tiers")

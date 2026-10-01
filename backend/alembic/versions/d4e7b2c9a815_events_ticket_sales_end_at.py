"""events: ora la care se închide vânzarea online de bilete

Revision ID: d4e7b2c9a815
Revises: c3d8e5a1f027

Aditivă și sigură pe tabelul `events` populat: o singură coloană NULL-abilă,
fără default (doar metadate pe Postgres). NULL = vânzarea se închide la
`starts_at` — exact comportamentul de până acum, deci evenimentele existente nu
se schimbă.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d4e7b2c9a815"
down_revision: Union[str, None] = "c3d8e5a1f027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("ticket_sales_end_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("events", "ticket_sales_end_at")

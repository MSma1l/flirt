"""bilete: dovada plății pe comenzile directe, stări mai lungi, QR-ul MIA

Revision ID: c3f8a2d6e4b1
Revises: b5c8e2f4a6d1

Aditivă și sigură pe tabele populate (doar metadate pe Postgres):
  * ticket_orders.payment_declared_at — când userul a trimis plata spre verificare;
  * ticket_orders.payment_method — `mia` | `iban` declarat de user; NULL = necunoscut;
  * ticket_orders.status: VARCHAR(24) → VARCHAR(40) — `additional_information_required`
    (31 de caractere) nu încăpea;
  * payment_settings.mia_qr_url — imaginea codului QR MIA; NULL = fără QR.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c3f8a2d6e4b1"
down_revision: Union[str, None] = "b5c8e2f4a6d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("payment_settings", sa.Column("mia_qr_url", sa.String(length=500), nullable=True))
    op.add_column("ticket_orders", sa.Column("payment_declared_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("ticket_orders", sa.Column("payment_method", sa.String(length=8), nullable=True))
    op.alter_column(
        "ticket_orders", "status",
        existing_type=sa.String(length=24), type_=sa.String(length=40), existing_nullable=False,
    )


def downgrade() -> None:
    # Lărgirea lui `status` NU se inversează: valorile lungi existente ar fi trunchiate.
    op.drop_column("ticket_orders", "payment_method")
    op.drop_column("ticket_orders", "payment_declared_at")
    op.drop_column("payment_settings", "mia_qr_url")

"""plăți: MIA Plăți Instant (număr de telefon) în setările de plată

Revision ID: a7d3e5f1c9b2
Revises: e9b4c7d2a1f6

Aditivă și sigură pe tabele populate: doar coloane NULL-abile, fără default.
NULL = metoda MIA nu e configurată — exact starea de azi (doar IBAN).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a7d3e5f1c9b2"
down_revision: Union[str, None] = "e9b4c7d2a1f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("payment_settings", sa.Column("mia_phone", sa.String(length=16), nullable=True))
    op.add_column("payment_settings", sa.Column("mia_recipient_name", sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column("payment_settings", "mia_recipient_name")
    op.drop_column("payment_settings", "mia_phone")

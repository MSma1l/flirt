"""plăți: comutatorul GLOBAL al vânzării online de bilete

Revision ID: c9e2f6a4d1b7
Revises: b8e1d4f7a2c3

Aditivă și sigură pe tabele populate: o coloană NOT NULL cu `server_default
true`, deci rândul singleton existent rămâne cu vânzarea PORNITĂ — exact
comportamentul de azi. Downgrade = coloana dispare (vânzarea redevine mereu
pornită).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c9e2f6a4d1b7"
down_revision: Union[str, None] = "b8e1d4f7a2c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "payment_settings",
        sa.Column(
            "online_sales_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("payment_settings", "online_sales_enabled")

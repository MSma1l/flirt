"""profiles: începutul trecerii curente prin feed (feed_cycle_started_at)

Revision ID: a7c3e5f9b1d2
Revises: b6e1d4a7c3f2

Aditivă și sigură pe tabele populate: o coloană NULL-abilă, fără backfill
(NULL = userul n-a încheiat încă nicio trecere ⇒ comportamentul de azi: orice
swipe exclude). Downgrade = coloana dispare, nimic altceva nu depinde de ea.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a7c3e5f9b1d2"
down_revision: Union[str, None] = "b6e1d4a7c3f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "profiles",
        sa.Column("feed_cycle_started_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("profiles", "feed_cycle_started_at")

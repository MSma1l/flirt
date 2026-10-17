"""users: preferințele notificărilor din bot + limba botului

Revision ID: d3f8a1c5e2b9
Revises: c9e2f6a4d1b7

Aditivă și sigură pe tabele populate: patru coloane NOT NULL cu `server_default
true` (conturile existente primesc notificările PORNITE, fără backfill) și o
coloană NULL-abilă pentru limba botului (NULL = română). Downgrade = coloanele
dispar, nimic altceva nu depinde de ele.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d3f8a1c5e2b9"
down_revision: Union[str, None] = "c9e2f6a4d1b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PREF_COLUMNS = (
    "tg_notify_messages",
    "tg_notify_likes",
    "tg_notify_stories",
    "tg_notify_matches",
)


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("telegram_language", sa.String(length=8), nullable=True)
    )
    for name in _PREF_COLUMNS:
        op.add_column(
            "users",
            sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.true()),
        )


def downgrade() -> None:
    for name in reversed(_PREF_COLUMNS):
        op.drop_column("users", name)
    op.drop_column("users", "telegram_language")

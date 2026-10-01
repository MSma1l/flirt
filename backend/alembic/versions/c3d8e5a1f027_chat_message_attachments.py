"""chat: mesaje media (poză / video / mesaj vocal)

Revision ID: c3d8e5a1f027
Revises: af3e9d1c7b20

Sigură pe tabelul `messages` populat: `kind` primește un server_default
constant ('text') — pe Postgres ≥ 11 ADD COLUMN cu default constant NU rescrie
tabelul (doar metadate). Restul coloanelor sunt NULL-abile, fără default.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c3d8e5a1f027"
down_revision: Union[str, None] = "af3e9d1c7b20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="text"),
    )
    op.add_column("messages", sa.Column("attachment_url", sa.String(length=1024), nullable=True))
    op.add_column("messages", sa.Column("attachment_mime", sa.String(length=64), nullable=True))
    op.add_column("messages", sa.Column("attachment_size", sa.Integer(), nullable=True))
    op.add_column("messages", sa.Column("attachment_duration_ms", sa.Integer(), nullable=True))
    op.add_column("messages", sa.Column("attachment_width", sa.Integer(), nullable=True))
    op.add_column("messages", sa.Column("attachment_height", sa.Integer(), nullable=True))


def downgrade() -> None:
    for name in (
        "attachment_height",
        "attachment_width",
        "attachment_duration_ms",
        "attachment_size",
        "attachment_mime",
        "attachment_url",
        "kind",
    ):
        op.drop_column("messages", name)

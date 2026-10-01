"""legal: evidența consimțămintelor (`user_consents`, Legea nr. 195/2024)

Revision ID: b5c8e2f4a6d1
Revises: a7d3e5f1c9b2

Aditivă: un tabel NOU, nimic modificat în tabelele existente. Conturile
existente nu au niciun rând → `consent_required` = true pentru ei, iar Mini App-ul
le cere acceptarea la următoarea deschidere (comportamentul dorit).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b5c8e2f4a6d1"
down_revision: Union[str, None] = "a7d3e5f1c9b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_consents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("document", sa.String(length=32), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_consents_user_id", "user_consents", ["user_id"])
    op.create_index(
        "ix_user_consents_user_document", "user_consents", ["user_id", "document"]
    )


def downgrade() -> None:
    op.drop_index("ix_user_consents_user_document", table_name="user_consents")
    op.drop_index("ix_user_consents_user_id", table_name="user_consents")
    op.drop_table("user_consents")

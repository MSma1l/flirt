"""messages: editare, ștergere pentru toți și răspuns (citat) — coloane aditive

* `edited_at` (timestamptz, NULL = needitat) — momentul ultimei editări.
* `deleted_at` (timestamptz, NULL = activ) — ștergere „pentru toți" (soft
  delete); la setare corpul, reacția și atașamentul sunt golite de aplicație.
* `reply_to_id` (UUID, FK -> messages.id, ON DELETE SET NULL) — mesajul citat.

Doar coloane NULLABLE, fără backfill și fără default: compatibil cu podurile
vechi care rulează în timpul rollout-ului (nu selectează coloanele noi) și
instant pe un tabel populat (Postgres nu rescrie tabelul pentru o coloană
nullable fără default). FK-ul se validează pe o coloană integral NULL — rapid.

Revision ID: b3d8e1f5a7c2
Revises: 7e583da3cefa
Create Date: 2026-11-06
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b3d8e1f5a7c2"
down_revision: Union[str, None] = "7e583da3cefa"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FK = "fk_messages_reply_to_id_messages"


def upgrade() -> None:
    op.add_column("messages", sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("messages", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("messages", sa.Column("reply_to_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        _FK, "messages", "messages", ["reply_to_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(_FK, "messages", type_="foreignkey")
    op.drop_column("messages", "reply_to_id")
    op.drop_column("messages", "deleted_at")
    op.drop_column("messages", "edited_at")

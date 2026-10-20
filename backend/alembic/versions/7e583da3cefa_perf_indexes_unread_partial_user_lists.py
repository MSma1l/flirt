"""perf: index partial pe necitite + indexuri (user, created_at) pe listele per user

Revision ID: 7e583da3cefa
Revises: a6c2e9d41f73
Create Date: 2026-10-20

Doar indexuri, nicio coloana/tabel nu se schimba. Tabelele sunt mici, deci
CREATE INDEX simplu (fara CONCURRENTLY).

* `messages`: indexul complet `ix_messages_chat_sender_unread`
  (chat_id, sender_id, is_read) e inlocuit de indexul PARTIAL
  `ix_messages_unread_chat_sender` (chat_id, sender_id) WHERE is_read = false —
  contine doar mesajele necitite (badge-ul din GET /chats, mark_read,
  notificarea Telegram filtreaza toate pe `is_read = false`).
* `stories(user_id, expires_at)` — povestile active ale unor useri.
* `ticket_orders(user_id, created_at)` — cererile mele / comanda activa.
* `favorites(user_id, created_at)` si `blocks(blocker_id, created_at)` —
  listele paginate `ORDER BY created_at DESC, id DESC`.

`likes(to_user_id, created_at)` exista deja (`ix_likes_to_user_created`,
revizia b7e4d2a9c1f3) — nu se dubleaza.

Downgrade: indexurile noi dispar, indexul complet pe necitite revine.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "7e583da3cefa"
down_revision: Union[str, None] = "a6c2e9d41f73"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (nume, tabel, coloane) — indexurile compuse noi, fara predicat.
_COMPOSITE = (
    ("ix_stories_user_expires", "stories", ["user_id", "expires_at"]),
    ("ix_ticket_orders_user_created", "ticket_orders", ["user_id", "created_at"]),
    ("ix_favorites_user_created", "favorites", ["user_id", "created_at"]),
    ("ix_blocks_blocker_created", "blocks", ["blocker_id", "created_at"]),
)


def upgrade() -> None:
    op.create_index(
        "ix_messages_unread_chat_sender",
        "messages",
        ["chat_id", "sender_id"],
        unique=False,
        postgresql_where=sa.text("is_read = false"),
        postgresql_concurrently=False,
    )
    op.drop_index("ix_messages_chat_sender_unread", table_name="messages")

    for name, table, columns in _COMPOSITE:
        op.create_index(
            name, table, columns, unique=False, postgresql_concurrently=False
        )


def downgrade() -> None:
    for name, table, _columns in reversed(_COMPOSITE):
        op.drop_index(name, table_name=table)

    op.create_index(
        "ix_messages_chat_sender_unread",
        "messages",
        ["chat_id", "sender_id", "is_read"],
        unique=False,
        postgresql_concurrently=False,
    )
    op.drop_index("ix_messages_unread_chat_sender", table_name="messages")

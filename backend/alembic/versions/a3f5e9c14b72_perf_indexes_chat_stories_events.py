"""Index-uri de performanță: mesaje, povești, evenimente

Treapta 2 — performanță. Index-urile lipsă care făceau ca endpointurile cele mai
folosite să scaneze tabele întregi la fiecare cerere:

  * `messages (chat_id, created_at)` — listarea paginată a conversației și
    „ultimul mesaj" din fiecare chat (`GET /chats`, endpointul *polled* de mobil).
  * `messages (chat_id, sender_id, is_read)` — numărul de NECITITE per chat.
    `messages.sender_id` nu era indexat DELOC, deși apare în predicatul de
    unread al fiecărei cereri `GET /chats`.
  * `stories.expires_at` — `WHERE expires_at > now()`, predicatul principal al
    modulului Stories (prezent în toate listările).
  * `events.starts_at` — `WHERE starts_at >= now() ORDER BY starts_at`, query-ul
    listării de evenimente (și cheia de paginare pe cursor).

Index-urile pe Profile / Like / Subscription au fost adăugate în `9d4c7f21ab30`
și NU sunt duplicate aici.

Revision ID: a3f5e9c14b72
Revises: 9d4c7f21ab30
Create Date: 2026-07-13
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a3f5e9c14b72'
down_revision: Union[str, None] = '9d4c7f21ab30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- messages -------------------------------------------------------------
    op.create_index(
        'ix_messages_chat_created',
        'messages',
        ['chat_id', 'created_at'],
        unique=False,
    )
    op.create_index(
        'ix_messages_chat_sender_unread',
        'messages',
        ['chat_id', 'sender_id', 'is_read'],
        unique=False,
    )

    # --- stories --------------------------------------------------------------
    op.create_index(
        op.f('ix_stories_expires_at'), 'stories', ['expires_at'], unique=False
    )

    # --- events ---------------------------------------------------------------
    op.create_index(
        op.f('ix_events_starts_at'), 'events', ['starts_at'], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_events_starts_at'), table_name='events')
    op.drop_index(op.f('ix_stories_expires_at'), table_name='stories')
    op.drop_index('ix_messages_chat_sender_unread', table_name='messages')
    op.drop_index('ix_messages_chat_created', table_name='messages')

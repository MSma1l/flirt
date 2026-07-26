"""Index de performanță: reports(status, created_at)

Treapta de performanță — singurul index care mai lipsea pe un predicat FIERBINTE.

Coada de moderare (`admin_service.list_reports`) e un endpoint POLLED de panou și
filtrează `WHERE reports.status IN (...)`, ordonând apoi `created_at DESC`.
`admin_service.get_stats` numără rapoartele în așteptare tot pe `status`, iar
`resolve_report` face un `UPDATE ... WHERE reported_id = ? AND status IN (...)`.
Până acum `reports` era indexat DOAR pe `reporter_id` / `reported_id` (migrația
`164b16936bbd`) — `status` nu era indexat deloc, deci fiecare deschidere a cozii
scana întreaga tabelă de rapoarte.

Index COMPUS `(status, created_at)`, nu doar pe `status`: coada filtrează pe
`status` ȘI sortează pe `created_at` în interiorul fiecărei stări, deci indexul
compus servește ambele într-un singur scan (leftmost prefix acoperă și un filtru
pe `status` singur — ex. contorul din `get_stats`).

Celelalte predicate fierbinți erau deja acoperite și NU se dublează aici:
`ticket_orders.status`/`user_id`/`event_id` (model + `d3f7a1c96b28`),
`messages(chat_id, created_at)` + `messages(chat_id, sender_id, is_read)`,
`stories.expires_at`, `events.starts_at`, `profiles.*`, `likes(from_user_id,
created_at)`, `subscriptions.user_id`.

Revision ID: e5c2a9f14b70
Revises: d3f7a1c96b28
Create Date: 2026-07-24
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e5c2a9f14b70'
down_revision: Union[str, None] = 'd3f7a1c96b28'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        'ix_reports_status_created',
        'reports',
        ['status', 'created_at'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_reports_status_created', table_name='reports')

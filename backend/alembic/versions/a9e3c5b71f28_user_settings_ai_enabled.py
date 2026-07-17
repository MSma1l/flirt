"""user_settings ai_enabled column (comutatorul AI per user, oprit implicit)

Revision ID: a9e3c5b71f28
Revises: d7b34f1e8a92
Create Date: 2026-07-17 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a9e3c5b71f28'
down_revision: Union[str, None] = 'd7b34f1e8a92'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Comutatorul funcțiilor AI per user — vezi `models.account.UserSettings`.
    #
    # DE CE `server_default=sa.false()` (și nu doar un default în ORM): fără el,
    # `ADD COLUMN ... NOT NULL` ar fi respins de Postgres pentru rândurile
    # EXISTENTE de setări, iar cu `nullable=True` toate conturile vechi ar rămâne
    # cu `ai_enabled = NULL` — o a treia stare, nici pornit nici oprit, pe care
    # codul ar trebui să o ghicească. Cu server_default, tot istoricul devine
    # `false` instantaneu, ceea ce e exact adevărul și exact cerința: AI-ul e
    # OPRIT până când userul îl aprinde el însuși din setări.
    #
    # `server_default` rămâne pe coloană și după migrare: inserturile vin din ORM
    # (care trimite valoarea explicit), dar îl păstrăm ca un INSERT scris de mână
    # să nu poată porni AI-ul din greșeală pentru cineva.
    op.add_column(
        'user_settings',
        sa.Column(
            'ai_enabled',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column('user_settings', 'ai_enabled')

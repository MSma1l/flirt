"""like is_super column (super like)

Revision ID: d7b34f1e8a92
Revises: c8e1b47d20fa
Create Date: 2026-07-17 09:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd7b34f1e8a92'
down_revision: Union[str, None] = 'c8e1b47d20fa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Super like (swipe sus): flag peste like, nu o stare separată — vezi
    # `models.swipe.Like`.
    #
    # DE CE `server_default='false'` ȘI NU un backfill în doi pași: `likes` e o
    # tabelă mare (un rând per swipe, per user). Un `ADD COLUMN ... NOT NULL` cu
    # server_default e, din Postgres 11, o operație de METADATE — nu rescrie
    # tabela și nu ia un lock lung pe ea. Fără default, `NOT NULL` ar fi respins
    # pentru rândurile existente; cu default adăugat abia ulterior, rândurile
    # vechi ar rămâne NULL. Așa, tot istoricul de like-uri devine `is_super=false`
    # instantaneu, ceea ce e exact adevărul: înainte de acest release nu exista
    # niciun super like.
    #
    # `server_default` rămâne pe coloană și după migrare (nu îl scoatem):
    # inserturile vin din ORM, care trimite mereu valoarea explicit, iar
    # păstrarea lui face coloana sigură și pentru un INSERT scris de mână.
    op.add_column(
        'likes',
        sa.Column(
            'is_super',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column('likes', 'is_super')

"""users.deleted_at — marcaj de purjare GDPR verificat la fiecare cerere

De ce e nevoie de coloană, nu doar de anonimizarea existentă:

`account_service.purge_user_data` șterge datele personale și anonimizează rândul
`users` (email `@deleted.invalid`, hash de parolă invalid), dar access token-ul
stateless emis ÎNAINTE de purjare rămâne valid criptografic ~15 min. Fără un
marcaj verificat în DB la fiecare cerere, `get_current_user` încărca userul
anonimizat (banned_at=NULL) și îl ACCEPTA — contul „șters ireversibil" continua
să facă cereri autentificate și chiar își RE-crea date (rândul `user_settings`).

`deleted_at` e tratat exact ca `banned_at`: NULL = cont activ; setat ⇒
`get_current_user` respinge cererea imediat. E un marcaj DISTINCT de ban (o
ștergere nu e un ban), de-aia o coloană separată, nu reutilizarea lui `banned_at`
(care ar contamina statisticile de moderare). Indexat: cron-ul de purjare și
listările pot filtra pe el. Nullable ⇒ rândurile existente rămân „active" fără un
UPDATE de backfill.

Revision ID: e7c4a9b2f1d0
Revises: d5a1c7e93b40
Create Date: 2026-07-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7c4a9b2f1d0'
down_revision: Union[str, None] = 'd5a1c7e93b40'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        op.f('ix_users_deleted_at'), 'users', ['deleted_at'], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_users_deleted_at'), table_name='users')
    op.drop_column('users', 'deleted_at')

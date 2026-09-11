"""users.telegram_user_id + telegram_linked_at — identitatea Telegram Mini App

Login-ul prin Mini App refolosește modelul `User` printr-un email sintetic
(`telegram_{id}@ext.flirt`), exact ca Apple/Google/telefon. Dar emailul NU poate
fi sursa de adevăr pentru „cine e userul ăsta pe Telegram": e doar un șir, pe
care orice alt flux l-ar putea produce, și nu spune nimic despre faptul că
semnătura `initData` a fost verificată. De-aia identitatea Telegram primește o
coloană proprie, scrisă DOAR după verificarea HMAC.

`BigInteger`, nu `Integer`: id-urile de utilizator Telegram au depășit deja
intervalul de 32 de biți, deci un `Integer` ar începe să crape pe conturi noi.

UNIQUE: un cont de Telegram nu are voie să fie legat de două conturi FLIRT —
altfel „mă loghez cu Telegram" ar deveni nedeterminist. Constrângerea e în DB,
nu doar în Python: un `SELECT` urmat de `INSERT` pierde cursa între două cereri
concurente (două deschideri simultane ale Mini App-ului la prima intrare).

Migrație NEDISTRUCTIVĂ: două coloane NULLABLE adăugate, zero backfill, zero
rescriere de rânduri. Versiunea VECHE a aplicației rulează neschimbată peste
schema nouă (nu știe de coloane, iar ele acceptă NULL), deci se poate aplica
înainte de deploy, fără fereastră de nefuncționare.

Revision ID: c4e18b7d9a20
Revises: e5c2a9f14b70
Create Date: 2026-09-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4e18b7d9a20'
down_revision: Union[str, None] = 'e5c2a9f14b70'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('telegram_user_id', sa.BigInteger(), nullable=True),
    )
    op.add_column(
        'users',
        sa.Column('telegram_linked_at', sa.DateTime(timezone=True), nullable=True),
    )
    # Index UNIC: servește și căutarea „userul cu acest telegram_user_id" (calea
    # fierbinte a fiecărui login prin Mini App), și constrângerea de unicitate.
    op.create_index(
        op.f('ix_users_telegram_user_id'),
        'users',
        ['telegram_user_id'],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_users_telegram_user_id'), table_name='users')
    op.drop_column('users', 'telegram_linked_at')
    op.drop_column('users', 'telegram_user_id')

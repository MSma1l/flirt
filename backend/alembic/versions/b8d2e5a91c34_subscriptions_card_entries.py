"""subscriptions card-of-discounts entries

Extinde tabela `subscriptions` cu evidența „cardului de reduceri" la evenimente:
  * `entries_total`     — câte intrări (check-in-uri cu reducere) a cumpărat userul;
  * `entries_remaining` — câte i-au mai rămas (se decrementează la fiecare check-in).

Setate DOAR pentru planurile card ('card_5' = 5, 'card_10' = 10); NULL pentru
celelalte planuri. Ambele coloane nullable → migrarea e RETROCOMPATIBILĂ:
abonamentele existente rămân valide, fără evidență de intrări.

Revision ID: b8d2e5a91c34
Revises: f7a3c1e908b2
Create Date: 2026-07-23 15:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8d2e5a91c34'
down_revision: Union[str, None] = 'f7a3c1e908b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('subscriptions', sa.Column('entries_total', sa.Integer(), nullable=True))
    op.add_column('subscriptions', sa.Column('entries_remaining', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('subscriptions', 'entries_remaining')
    op.drop_column('subscriptions', 'entries_total')

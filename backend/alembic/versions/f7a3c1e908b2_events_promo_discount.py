"""events promo/discount fields

Extinde tabela `events` cu un promo/reducere de MARKETING, configurabil de admin:
  * `promo_discount_percent` — procentul reducerii (0..100), afișat în Flirt Passport;
  * `promo_code`             — cod scurt arătat la intrare (ex. „FLIRT10"), max 32;
  * `promo_description`      — ce se întâmplă când arăți codul la intrare, max 500.

Promo-ul e ACELAȘI pentru toți userii care merg la eveniment (nu coduri per user).
Toate coloanele sunt nullable → migrarea e RETROCOMPATIBILĂ: evenimentele existente
rămân valide (fără promo).

Revision ID: f7a3c1e908b2
Revises: e2d7b9a4c1f5
Create Date: 2026-07-23 13:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f7a3c1e908b2'
down_revision: Union[str, None] = 'e2d7b9a4c1f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('events', sa.Column('promo_discount_percent', sa.Integer(), nullable=True))
    op.add_column('events', sa.Column('promo_code', sa.String(length=32), nullable=True))
    op.add_column('events', sa.Column('promo_description', sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column('events', 'promo_description')
    op.drop_column('events', 'promo_code')
    op.drop_column('events', 'promo_discount_percent')

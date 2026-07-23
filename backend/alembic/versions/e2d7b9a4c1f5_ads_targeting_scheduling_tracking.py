"""ads targeting, scheduling and tracking

Extinde tabela `ads` cu:
  * targetare  — `target_gender`, `target_age_min`, `target_age_max` (toate NULL = fără restricție)
  * programare — `starts_at`, `ends_at` (fereastra de difuzare; NULL = fără limită)
  * tracking   — `impressions`, `clicks` (contoare brute, server_default 0)

Toate coloanele sunt nullable sau au `server_default` → migrarea e RETROCOMPATIBILĂ:
reclamele existente rămân valide (fără targetare, fără programare, contoare 0).

Revision ID: e2d7b9a4c1f5
Revises: f4b2c9a1e7d3
Create Date: 2026-07-23 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e2d7b9a4c1f5'
down_revision: Union[str, None] = 'f4b2c9a1e7d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('ads', sa.Column('target_gender', sa.String(length=16), nullable=True))
    op.add_column('ads', sa.Column('target_age_min', sa.Integer(), nullable=True))
    op.add_column('ads', sa.Column('target_age_max', sa.Integer(), nullable=True))
    op.add_column('ads', sa.Column('starts_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('ads', sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        'ads',
        sa.Column('impressions', sa.Integer(), server_default=sa.text('0'), nullable=False),
    )
    op.add_column(
        'ads',
        sa.Column('clicks', sa.Integer(), server_default=sa.text('0'), nullable=False),
    )


def downgrade() -> None:
    op.drop_column('ads', 'clicks')
    op.drop_column('ads', 'impressions')
    op.drop_column('ads', 'ends_at')
    op.drop_column('ads', 'starts_at')
    op.drop_column('ads', 'target_age_max')
    op.drop_column('ads', 'target_age_min')
    op.drop_column('ads', 'target_gender')

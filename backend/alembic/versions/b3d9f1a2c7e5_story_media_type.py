"""story media_type column

Revision ID: b3d9f1a2c7e5
Revises: f2a81d6c40e5
Create Date: 2026-07-15 09:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3d9f1a2c7e5'
down_revision: Union[str, None] = 'f2a81d6c40e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Tipul de media al poveștii: 'image' | 'video'. `server_default='image'` face
    # coloana non-null pentru rândurile deja existente (create înainte de suportul
    # video, când exista doar imagine), fără un pas separat de backfill.
    op.add_column(
        'stories',
        sa.Column(
            'media_type',
            sa.String(length=16),
            nullable=False,
            server_default='image',
        ),
    )


def downgrade() -> None:
    op.drop_column('stories', 'media_type')

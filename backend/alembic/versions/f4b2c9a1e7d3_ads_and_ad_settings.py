"""ads and ad_settings

Creează tabelele sistemului de reclame:
  * `ads`         — creativele rotite în feed (PK numeric autoincrement).
  * `ad_settings` — parametrii globali, un SINGUR rând (singleton, id=1), inserat
                    aici cu valorile implicite (15 / 10 / enabled).

Revision ID: f4b2c9a1e7d3
Revises: a9e3c5b71f28
Create Date: 2026-07-23 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f4b2c9a1e7d3'
down_revision: Union[str, None] = 'a9e3c5b71f28'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ads',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('video_url', sa.String(length=500), nullable=True),
        sa.Column('image_url', sa.String(length=500), nullable=True),
        sa.Column('duration_seconds', sa.Integer(), nullable=False),
        sa.Column('active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('weight', sa.Integer(), server_default=sa.text('1'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'ad_settings',
        sa.Column('id', sa.Integer(), autoincrement=False, nullable=False),
        sa.Column('swipes_before_ad', sa.Integer(), server_default=sa.text('15'), nullable=False),
        sa.Column('max_video_seconds', sa.Integer(), server_default=sa.text('10'), nullable=False),
        sa.Column('enabled', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    # Rândul SINGLETON de setări (id=1) cu valorile implicite. Endpoint-urile îl
    # creează oricum leneș dacă lipsește, dar îl inserăm aici ca baza să fie
    # completă imediat după migrare, fără prima cerere „de încălzire".
    op.execute(
        sa.text(
            "INSERT INTO ad_settings (id, swipes_before_ad, max_video_seconds, enabled) "
            "VALUES (1, 15, 10, true)"
        )
    )


def downgrade() -> None:
    op.drop_table('ad_settings')
    op.drop_table('ads')

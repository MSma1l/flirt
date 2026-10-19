"""events: incadrarea copertei + participanti afisati

Revision ID: b7e2d4f9a3c1
Revises: b6e1d4a7c9f2

Adauga pe `events`:
  * `cover_focus_x`, `cover_focus_y` — punctul focal al copertei (0..1), NOT NULL
    cu `server_default 0.5` (centru);
  * `cover_zoom` — zoom-ul copertei (1..3), NOT NULL cu `server_default 1`;
  * `displayed_attendee_count` — „Participanti afisati" setat de admin, NULL-abil
    (NULL = numarul real).

Aditiva si sigura pe tabele populate: evenimentele existente primesc centrul si
zoom 1 (exact cum aratau inainte) si niciun numar afisat. Downgrade = coloanele
dispar, nimic altceva nu depinde de ele.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b7e2d4f9a3c1"
down_revision: Union[str, None] = "b6e1d4a7c9f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("cover_focus_x", sa.Float(), nullable=False, server_default="0.5"),
    )
    op.add_column(
        "events",
        sa.Column("cover_focus_y", sa.Float(), nullable=False, server_default="0.5"),
    )
    op.add_column(
        "events",
        sa.Column("cover_zoom", sa.Float(), nullable=False, server_default="1"),
    )
    op.add_column(
        "events",
        sa.Column("displayed_attendee_count", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("events", "displayed_attendee_count")
    op.drop_column("events", "cover_zoom")
    op.drop_column("events", "cover_focus_y")
    op.drop_column("events", "cover_focus_x")

"""centrul de activitate: vizualizări de profil + semnul de citire

Revision ID: b7e4d2a9c1f3
Revises: d3f8a1c5e2b9

Aditivă: două tabele noi și un index nou pe `likes`. Nimic existent nu se
rescrie. `profile_views` e deduplicată de baza de date (un rând per viewer, per
profil, per zi). `activity_read_marks` ține un singur rând per user.
Indexul `ix_likes_to_user_created` servește lista cronologică de like-uri primite
și numărul de necitite. Downgrade = obiectele dispar.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b7e4d2a9c1f3"
down_revision: Union[str, None] = "d3f8a1c5e2b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "profile_views",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("viewer_id", sa.Uuid(), nullable=False),
        sa.Column("viewed_id", sa.Uuid(), nullable=False),
        sa.Column("view_date", sa.Date(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["viewer_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["viewed_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "viewer_id", "viewed_id", "view_date", name="uq_profile_view_daily"
        ),
    )
    op.create_index(
        "ix_profile_views_viewed_date",
        "profile_views",
        ["viewed_id", "view_date", "created_at"],
    )

    op.create_table(
        "activity_read_marks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )

    op.create_index(
        "ix_likes_to_user_created", "likes", ["to_user_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_likes_to_user_created", table_name="likes")
    op.drop_table("activity_read_marks")
    op.drop_index("ix_profile_views_viewed_date", table_name="profile_views")
    op.drop_table("profile_views")

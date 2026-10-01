"""cod de plată simplu + QR Flirt Passport + intrarea cash la ușă

Revision ID: a7d3f5c9b2e8
Revises: c3f8a2d6e4b1

Aditivă și sigură pe tabele populate:
  * users.payment_code — codul de plată de 6 cifre (prima ≠ 0), UNIQUE, NULL-abil:
    generat LENEȘ la prima comandă/cerere sau la deschiderea pașaportului, deci
    userii existenți rămân NULL (fără backfill). Comenzile vechi își păstrează
    `reference` istoric (`U-XXXXXXXX`);
  * users.passport_token — tokenul QR-ului Flirt Passport (32 hex), UNIQUE,
    NULL-abil, tot leneș;
  * event_door_admissions — intrările plătite cash la ușă (unic per eveniment+user).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a7d3f5c9b2e8"
down_revision: Union[str, None] = "c3f8a2d6e4b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("payment_code", sa.String(length=6), nullable=True))
    op.add_column("users", sa.Column("passport_token", sa.String(length=32), nullable=True))
    op.create_unique_constraint("uq_users_payment_code", "users", ["payment_code"])
    op.create_unique_constraint("uq_users_passport_token", "users", ["passport_token"])

    op.create_table(
        "event_door_admissions",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("payment_method", sa.String(length=16), server_default="cash", nullable=False),
        sa.Column("admitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("admitted_by", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["admitted_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "user_id", name="uq_door_admission_pair"),
    )
    op.create_index(
        op.f("ix_event_door_admissions_event_id"), "event_door_admissions", ["event_id"], unique=False
    )
    op.create_index(
        op.f("ix_event_door_admissions_user_id"), "event_door_admissions", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_event_door_admissions_user_id"), table_name="event_door_admissions")
    op.drop_index(op.f("ix_event_door_admissions_event_id"), table_name="event_door_admissions")
    op.drop_table("event_door_admissions")
    op.drop_constraint("uq_users_passport_token", "users", type_="unique")
    op.drop_constraint("uq_users_payment_code", "users", type_="unique")
    op.drop_column("users", "passport_token")
    op.drop_column("users", "payment_code")

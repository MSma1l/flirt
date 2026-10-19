"""users: poza de profil preluată automat din Telegram (avatar de rezervă)

Revision ID: b6e1d4a7c9f2
Revises: d3f8a1c5e2b9

Aditivă și sigură pe tabele populate: trei coloane NULL-abile, fără backfill —
se completează la următorul login prin Mini App (`telegram_avatar`).
  * `telegram_photo_url`        — URL-ul pe care îl servim ca avatar de rezervă
                                  (copia din storage-ul nostru sau, până la
                                  descărcare, URL-ul https Telegram validat);
  * `telegram_photo_source`     — identitatea pozei sursă (URL-ul din initData
                                  sau `file_unique_id` din Bot API), ca să nu
                                  descărcăm aceeași poză la fiecare login;
  * `telegram_photo_checked_at` — ultima verificare prin Bot API (plafon).
Downgrade = coloanele dispar, nimic altceva nu depinde de ele.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b6e1d4a7c9f2"
down_revision: Union[str, None] = "d3f8a1c5e2b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("telegram_photo_url", sa.String(length=512), nullable=True)
    )
    op.add_column(
        "users", sa.Column("telegram_photo_source", sa.String(length=512), nullable=True)
    )
    op.add_column(
        "users",
        sa.Column("telegram_photo_checked_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "telegram_photo_checked_at")
    op.drop_column("users", "telegram_photo_source")
    op.drop_column("users", "telegram_photo_url")

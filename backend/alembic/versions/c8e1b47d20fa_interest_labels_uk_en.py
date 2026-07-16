"""interest labels uk + en (aplicația în 4 limbi)

Revision ID: c8e1b47d20fa
Revises: b3d9f1a2c7e5
Create Date: 2026-07-16 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c8e1b47d20fa'
down_revision: Union[str, None] = 'b3d9f1a2c7e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Traducerile catalogului (TZ 2.5), duplicate INTENȚIONAT aici: o migrare trebuie
# să dea același rezultat oricând e rulată, deci nu importă `INTERESTS_CATALOG`
# din cod (acela evoluează; migrarea e o fotografie a momentului).
_UK_EN: list[tuple[str, str, str]] = [
    ('sport', 'Спорт', 'Sports'),
    ('travel', 'Подорожі', 'Travel'),
    ('cars', 'Автомобілі', 'Cars'),
    ('music', 'Музика', 'Music'),
    ('dancing', 'Танці', 'Dancing'),
    ('business', 'Бізнес', 'Business'),
    ('movies', 'Кіно та серіали', 'Movies & TV series'),
    ('books', 'Книги', 'Books'),
    ('games', 'Ігри', 'Games'),
    ('animals', 'Собаки / тварини', 'Dogs / animals'),
    ('cooking', 'Кулінарія', 'Cooking'),
    ('photography', 'Фотографія', 'Photography'),
    ('yoga', 'Йога та медитація', 'Yoga & meditation'),
    ('fashion', 'Мода', 'Fashion'),
    ('nature', 'Природа та активний відпочинок', 'Nature & outdoors'),
    ('board_games', 'Настільні ігри', 'Board games'),
    ('volunteering', 'Волонтерство', 'Volunteering'),
    ('technology', 'Технології', 'Technology'),
    ('art', 'Мистецтво', 'Art'),
]


def upgrade() -> None:
    # 1) Coloanele intră NULLABLE — nu există o valoare implicită corectă pentru
    #    o etichetă, iar un `server_default` ar lăsa text greșit în DB.
    op.add_column('interests', sa.Column('label_uk', sa.String(length=120), nullable=True))
    op.add_column('interests', sa.Column('label_en', sa.String(length=120), nullable=True))

    # 2) Backfill pe slug pentru intrările din catalog.
    conn = op.get_bind()
    stmt = sa.text(
        "UPDATE interests SET label_uk = :uk, label_en = :en WHERE slug = :slug"
    )
    for slug, label_uk, label_en in _UK_EN:
        conn.execute(stmt, {'slug': slug, 'uk': label_uk, 'en': label_en})

    # 3) Interese adăugate din admin (TZ 2.5: catalogul e extensibil fără release)
    #    nu au traducere aici. Ca să putem pune NOT NULL, cad pe eticheta cea mai
    #    apropiată ca alfabet/limbă: uk ← ru, en ← ro. Un admin le poate corecta
    #    ulterior; important e să nu rămână NULL și să nu se piardă rânduri.
    conn.execute(sa.text("UPDATE interests SET label_uk = label_ru WHERE label_uk IS NULL"))
    conn.execute(sa.text("UPDATE interests SET label_en = label_ro WHERE label_en IS NULL"))

    # 4) Abia acum devin obligatorii — modelul le declară nullable=False.
    op.alter_column('interests', 'label_uk', nullable=False)
    op.alter_column('interests', 'label_en', nullable=False)


def downgrade() -> None:
    op.drop_column('interests', 'label_en')
    op.drop_column('interests', 'label_uk')

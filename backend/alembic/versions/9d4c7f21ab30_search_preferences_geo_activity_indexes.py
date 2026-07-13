"""Preferințe de căutare + coordonate persistate + last_active_at + index-uri feed

Aduce la zi schema pentru algoritmul de feed (Treapta 1 — corectitudine):

  * `profiles.lat` / `profiles.lng` — coordonate GEOCODATE LA SALVAREA ANKETEI
    (nu la fiecare cerere de feed). Deblochează filtrarea pe rază în SQL și
    distanța reală în scor, fără apel de rețea per candidat.
  * `user_settings.interested_in` / `age_min` / `age_max` — preferințele de
    căutare (gen + interval de vârstă), aplicate ca filtre DURE în feed.
    Până acum genul exista pe profil, dar nu era folosit NICIODATĂ la filtrare.
  * `users.last_active_at` — semnal de activitate; feed-ul nu mai promovează
    conturile abandonate la egalitate cu cele active.
  * Index-uri pentru predicatele reale ale feed-ului: `profiles.completed`
    (predicatul principal!), `profiles.city`, `profiles.birth_date`,
    `profiles.gender`, `(profiles.lat, profiles.lng)` și
    `(likes.from_user_id, likes.created_at)` (limita zilnică de swipe + undo).

`subscriptions.user_id` era deja indexat (migrația c1792e250ccf).

Revision ID: 9d4c7f21ab30
Revises: 64f32c9f9dad
Create Date: 2026-07-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '9d4c7f21ab30'
down_revision: Union[str, None] = '64f32c9f9dad'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- profiles: coordonate persistate (TZ 7) ------------------------------
    op.add_column('profiles', sa.Column('lat', sa.Float(), nullable=True))
    op.add_column('profiles', sa.Column('lng', sa.Float(), nullable=True))
    # Index compus: susține bounding-box-ul filtrului pe rază.
    op.create_index('ix_profiles_lat_lng', 'profiles', ['lat', 'lng'], unique=False)

    # --- profiles: index-uri pe predicatele feed-ului ------------------------
    op.create_index(
        op.f('ix_profiles_completed'), 'profiles', ['completed'], unique=False
    )
    op.create_index(op.f('ix_profiles_city'), 'profiles', ['city'], unique=False)
    op.create_index(
        op.f('ix_profiles_birth_date'), 'profiles', ['birth_date'], unique=False
    )
    op.create_index(op.f('ix_profiles_gender'), 'profiles', ['gender'], unique=False)

    # --- users: ultima activitate --------------------------------------------
    op.add_column(
        'users',
        sa.Column('last_active_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        op.f('ix_users_last_active_at'), 'users', ['last_active_at'], unique=False
    )

    # --- user_settings: preferințele de căutare ------------------------------
    # `interested_in` e NOT NULL cu default '[]' ca rândurile EXISTENTE să
    # primească „fără restricție de gen" (comportament neschimbat pentru ele).
    op.add_column(
        'user_settings',
        sa.Column(
            'interested_in',
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )
    # NULL = „nesetat" ⇒ feed-ul folosește default-urile din config
    # (SEARCH_AGE_MIN_DEFAULT / SEARCH_AGE_MAX_DEFAULT), cu pragul 18+ forțat.
    op.add_column('user_settings', sa.Column('age_min', sa.Integer(), nullable=True))
    op.add_column('user_settings', sa.Column('age_max', sa.Integer(), nullable=True))

    # --- likes: index compus pentru cota zilnică de swipe + undo -------------
    op.create_index(
        'ix_likes_from_user_created',
        'likes',
        ['from_user_id', 'created_at'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_likes_from_user_created', table_name='likes')

    op.drop_column('user_settings', 'age_max')
    op.drop_column('user_settings', 'age_min')
    op.drop_column('user_settings', 'interested_in')

    op.drop_index(op.f('ix_users_last_active_at'), table_name='users')
    op.drop_column('users', 'last_active_at')

    op.drop_index(op.f('ix_profiles_gender'), table_name='profiles')
    op.drop_index(op.f('ix_profiles_birth_date'), table_name='profiles')
    op.drop_index(op.f('ix_profiles_city'), table_name='profiles')
    op.drop_index(op.f('ix_profiles_completed'), table_name='profiles')
    op.drop_index('ix_profiles_lat_lng', table_name='profiles')
    op.drop_column('profiles', 'lng')
    op.drop_column('profiles', 'lat')

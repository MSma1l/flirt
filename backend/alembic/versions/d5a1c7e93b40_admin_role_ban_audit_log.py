"""Panou de administrare: rol pe user, ban, jurnal de audit

Trei schimbări, toate cerute de panoul de admin (`/api/v1/admin/*`):

  1. `users.role` — 'user' (implicit) | 'admin'. Coloană TEXT, nu boolean
     `is_admin`: adăugarea unui rol nou (moderator, support) devine o migrație de
     DATE, nu o rescriere a modelului. Astăzi se implementează DOAR user vs admin.
     `server_default='user'` ca rândurile EXISTENTE să primească rolul implicit
     fără un UPDATE manual (coloana e NOT NULL).

  2. `users.banned_at` + `users.ban_reason` — banul de moderare. NULL = cont în
     regulă. Setat ⇒ login refuzat, token existent invalidat (403), profil scos
     din feed. Indexat pe `banned_at`: e predicat de filtrare în feed.

  3. `admin_audit_logs` — jurnalul APPEND-ONLY al acțiunilor de admin.
     `actor_id` are ON DELETE SET NULL (nu CASCADE): ștergerea contului de admin
     NU are voie să șteargă istoria acțiunilor lui. `target_id` e un UUID FĂRĂ
     cheie externă — ținta poate fi ștearsă chiar de acțiunea auditată
     (`user.delete`), iar un FK ar face imposibilă înregistrarea ștergerii.

Revision ID: d5a1c7e93b40
Revises: a3f5e9c14b72
Create Date: 2026-07-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5a1c7e93b40'
down_revision: Union[str, None] = 'a3f5e9c14b72'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- 1 + 2. users: rol + ban ---------------------------------------------
    op.add_column(
        'users',
        sa.Column(
            'role',
            sa.String(length=16),
            nullable=False,
            server_default='user',
        ),
    )
    op.add_column(
        'users',
        sa.Column('banned_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'users',
        sa.Column('ban_reason', sa.String(length=500), nullable=True),
    )
    op.create_index(op.f('ix_users_role'), 'users', ['role'], unique=False)
    op.create_index(
        op.f('ix_users_banned_at'), 'users', ['banned_at'], unique=False
    )

    # --- 3. admin_audit_logs --------------------------------------------------
    op.create_table(
        'admin_audit_logs',
        sa.Column('actor_id', sa.Uuid(), nullable=True),
        sa.Column('actor_email', sa.String(length=255), nullable=False),
        sa.Column('action', sa.String(length=64), nullable=False),
        sa.Column('target_type', sa.String(length=32), nullable=True),
        sa.Column('target_id', sa.Uuid(), nullable=True),
        sa.Column('meta', sa.JSON(), nullable=False),
        sa.Column('ip', sa.String(length=64), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_admin_audit_logs_actor_id'),
        'admin_audit_logs',
        ['actor_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_admin_audit_logs_action'),
        'admin_audit_logs',
        ['action'],
        unique=False,
    )
    op.create_index(
        'ix_admin_audit_created', 'admin_audit_logs', ['created_at'], unique=False
    )
    op.create_index(
        'ix_admin_audit_target',
        'admin_audit_logs',
        ['target_type', 'target_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_admin_audit_target', table_name='admin_audit_logs')
    op.drop_index('ix_admin_audit_created', table_name='admin_audit_logs')
    op.drop_index(
        op.f('ix_admin_audit_logs_action'), table_name='admin_audit_logs'
    )
    op.drop_index(
        op.f('ix_admin_audit_logs_actor_id'), table_name='admin_audit_logs'
    )
    op.drop_table('admin_audit_logs')

    op.drop_index(op.f('ix_users_banned_at'), table_name='users')
    op.drop_index(op.f('ix_users_role'), table_name='users')
    op.drop_column('users', 'ban_reason')
    op.drop_column('users', 'banned_at')
    op.drop_column('users', 'role')

"""loyalty tiers + special invites

Adaugă mecanismul de FIDELITATE (trepte Flirt Passport) și INVITAȚIILE speciale:
  * `loyalty_settings`           — pragurile treptelor (JSON) + plafonul de
                                   reducere; rând SINGLETON (id=1);
  * `loyalty_invites`            — invitație la un eveniment: cod unic generat pe
                                   server, număr maxim de folosiri, expirare,
                                   treaptă minimă, revocare soft;
  * `loyalty_invite_redemptions` — folosirea unei invitații de către un user,
                                   UNICĂ per (invitație, user).

NEDISTRUCTIVĂ PRIN CONSTRUCȚIE: doar tabele NOI. Nicio coloană existentă nu e
ștearsă, redenumită sau modificată — `events`, `ticket_orders` și
`flirt_passport_stamps` rămân exact cum erau, deci versiunea veche a aplicației
continuă să funcționeze pe schema nouă (deploy fără fereastră de indisponibilitate).

REVERSIBILĂ: `downgrade` șterge exact cele trei tabele adăugate aici și nimic
altceva. Ciclul upgrade → downgrade → upgrade a fost rulat pe o bază reală.

DE CE NU INSEREAZĂ RÂNDUL SINGLETON: valorile de pornire ale treptelor vin din
configurare (`LOYALTY_TIERS`), iar `services/loyalty._get_or_create_settings` îl
creează leneș la prima citire — ca `AdSettings`. Un rând inserat aici, cu praguri
fixate în migrare, ar ignora tocmai configurarea instalării.

Revision ID: b6f1d27a4c93
Revises: c4e18b7d9a20
Create Date: 2026-09-13 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b6f1d27a4c93'
down_revision: Union[str, None] = 'c4e18b7d9a20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- loyalty_settings (singleton id=1) ------------------------------------
    op.create_table(
        'loyalty_settings',
        sa.Column('id', sa.Integer(), autoincrement=False, nullable=False),
        sa.Column('tiers', sa.JSON(), nullable=False),
        sa.Column(
            'max_total_discount_percent', sa.Integer(),
            server_default='30', nullable=False,
        ),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    # --- loyalty_invites ------------------------------------------------------
    op.create_table(
        'loyalty_invites',
        sa.Column('event_id', sa.Uuid(), nullable=False),
        sa.Column('code', sa.String(length=64), nullable=False),
        sa.Column('max_uses', sa.Integer(), nullable=False),
        sa.Column('used_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('min_stamps_required', sa.Integer(), nullable=True),
        sa.Column('min_tier_code', sa.String(length=32), nullable=True),
        sa.Column('discount_percent', sa.Integer(), nullable=True),
        sa.Column('note', sa.String(length=500), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', sa.Uuid(), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['event_id'], ['events.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        # Unicitatea codului e o garanție de BAZĂ DE DATE, nu o speranță a
        # generatorului: o coliziune cade la INSERT, nu produce două invitații
        # care răspund la același cod.
        sa.UniqueConstraint('code', name='uq_loyalty_invites_code'),
    )
    op.create_index(
        op.f('ix_loyalty_invites_event_id'), 'loyalty_invites', ['event_id'], unique=False
    )

    # --- loyalty_invite_redemptions -------------------------------------------
    op.create_table(
        'loyalty_invite_redemptions',
        sa.Column('invite_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('event_id', sa.Uuid(), nullable=False),
        sa.Column('discount_percent', sa.Integer(), server_default='0', nullable=False),
        sa.Column('redeemed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['invite_id'], ['loyalty_invites.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['event_id'], ['events.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        # Un user nu poate folosi de două ori ACEEAȘI invitație — regula care face
        # folosirea idempotentă și blochează dublu-tap-ul (vezi services/loyalty.py).
        sa.UniqueConstraint('invite_id', 'user_id', name='uq_invite_redemption_pair'),
    )
    op.create_index(
        op.f('ix_loyalty_invite_redemptions_invite_id'),
        'loyalty_invite_redemptions', ['invite_id'], unique=False,
    )
    op.create_index(
        op.f('ix_loyalty_invite_redemptions_user_id'),
        'loyalty_invite_redemptions', ['user_id'], unique=False,
    )
    op.create_index(
        op.f('ix_loyalty_invite_redemptions_event_id'),
        'loyalty_invite_redemptions', ['event_id'], unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_loyalty_invite_redemptions_event_id'),
        table_name='loyalty_invite_redemptions',
    )
    op.drop_index(
        op.f('ix_loyalty_invite_redemptions_user_id'),
        table_name='loyalty_invite_redemptions',
    )
    op.drop_index(
        op.f('ix_loyalty_invite_redemptions_invite_id'),
        table_name='loyalty_invite_redemptions',
    )
    op.drop_table('loyalty_invite_redemptions')
    op.drop_index(op.f('ix_loyalty_invites_event_id'), table_name='loyalty_invites')
    op.drop_table('loyalty_invites')
    op.drop_table('loyalty_settings')

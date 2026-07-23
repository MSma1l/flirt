"""ticket orders, payment settings + event ticket price

Adaugă fluxul de CUMPĂRARE BILET ONLINE prin transfer bancar cu verificare manuală:
  * `ticket_orders`     — o comandă de bilet a unui user la un eveniment cu preț;
  * `payment_settings`  — datele bancare GLOBALE, un SINGUR rând (singleton id=1),
                          inserat aici cu placeholder-uri goale;
  * `events.ticket_price` (+ `ticket_currency`) — prețul biletului online. NULL =
                          biletul online NU e disponibil (retrocompatibil: toate
                          evenimentele existente rămân valide, fără vânzare).

Revision ID: d3f7a1c96b28
Revises: b8d2e5a91c34
Create Date: 2026-07-23 16:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd3f7a1c96b28'
down_revision: Union[str, None] = 'b8d2e5a91c34'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- events: prețul biletului online (retrocompatibil, nullable) ----------
    op.add_column('events', sa.Column('ticket_price', sa.Float(), nullable=True))
    op.add_column(
        'events',
        sa.Column(
            'ticket_currency', sa.String(length=8), server_default='lei', nullable=True
        ),
    )

    # --- ticket_orders --------------------------------------------------------
    op.create_table(
        'ticket_orders',
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('event_id', sa.Uuid(), nullable=False),
        sa.Column('price', sa.Float(), nullable=False),
        sa.Column('currency', sa.String(length=8), server_default='lei', nullable=False),
        sa.Column('reference', sa.String(length=32), nullable=False),
        sa.Column(
            'status', sa.String(length=24),
            server_default='awaiting_payment', nullable=False,
        ),
        sa.Column('user_note', sa.String(length=500), nullable=True),
        sa.Column('admin_note', sa.String(length=500), nullable=True),
        sa.Column('ticket_code', sa.String(length=64), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('decided_by', sa.Uuid(), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['event_id'], ['events.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['decided_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('ticket_code', name='uq_ticket_orders_ticket_code'),
    )
    op.create_index(op.f('ix_ticket_orders_user_id'), 'ticket_orders', ['user_id'], unique=False)
    op.create_index(op.f('ix_ticket_orders_event_id'), 'ticket_orders', ['event_id'], unique=False)
    op.create_index(op.f('ix_ticket_orders_status'), 'ticket_orders', ['status'], unique=False)

    # --- payment_settings (singleton id=1) ------------------------------------
    op.create_table(
        'payment_settings',
        sa.Column('id', sa.Integer(), autoincrement=False, nullable=False),
        sa.Column('bank_beneficiary', sa.String(length=200), server_default='', nullable=False),
        sa.Column('bank_iban', sa.String(length=64), server_default='', nullable=False),
        sa.Column('bank_name', sa.String(length=200), nullable=True),
        sa.Column('instructions', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    # Rândul SINGLETON (id=1) cu placeholder-uri goale. Endpoint-urile îl creează
    # oricum leneș dacă lipsește, dar îl inserăm aici ca baza să fie completă imediat.
    op.execute(
        sa.text(
            "INSERT INTO payment_settings (id, bank_beneficiary, bank_iban) "
            "VALUES (1, '', '')"
        )
    )


def downgrade() -> None:
    op.drop_table('payment_settings')
    op.drop_index(op.f('ix_ticket_orders_status'), table_name='ticket_orders')
    op.drop_index(op.f('ix_ticket_orders_event_id'), table_name='ticket_orders')
    op.drop_index(op.f('ix_ticket_orders_user_id'), table_name='ticket_orders')
    op.drop_table('ticket_orders')
    op.drop_column('events', 'ticket_currency')
    op.drop_column('events', 'ticket_price')

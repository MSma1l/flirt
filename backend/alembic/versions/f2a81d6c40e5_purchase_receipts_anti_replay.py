"""purchase_receipts — dedup de tranzacții IAP (anti-replay)

DE CE E NEVOIE DE TABEL, NU DE O COLOANĂ PE `subscriptions`

`subscriptions` ține STAREA curentă: un rând per user, suprascris la fiecare
reînnoire. Anti-replay-ul are nevoie de altceva — un registru IMUABIL al
tranzacțiilor deja consumate, cu unicitate GLOBALĂ (nu per user).

Fără el, verificarea achizițiilor accepta același receipt de oricâte ori: un singur
abonament cumpărat o dată, de un singur om, putea fi pasat între conturi (sau
revândut) și deschidea premium la toți. Semnătura Apple rămâne perfect validă la
al doilea, al zecelea, al o mielea user — o semnătură dovedește că tranzacția e
REALĂ, nu că e A TA și nefolosită.

`transaction_id` e UNIQUE la nivel de BAZĂ DE DATE, nu verificat în Python: două
cereri concurente cu același receipt ar trece amândouă de un `SELECT ... WHERE
transaction_id = ?` (nimic nu e commit-at încă) și ar activa premium pe două
conturi. Constrângerea din DB e singura care arbitrează cursa.

`original_transaction_id` NU e UNIQUE, intenționat: la Apple/Google fiecare
reînnoire lunară e o tranzacție NOUĂ care păstrează același `original` — un UNIQUE
aici ar refuza reînnoirile legitime ale aceluiași user, adică ar rupe produsul. E
doar indexat, iar serviciul verifică separat că lanțul nu e revendicat de alt cont
(cont de magazin partajat = tot replay, doar cu alt id de tranzacție).

Revision ID: f2a81d6c40e5
Revises: e7c4a9b2f1d0
Create Date: 2026-07-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f2a81d6c40e5'
down_revision: Union[str, None] = 'e7c4a9b2f1d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'purchase_receipts',
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('provider', sa.String(length=16), nullable=False),
        sa.Column('transaction_id', sa.String(length=255), nullable=False),
        sa.Column('original_transaction_id', sa.String(length=255), nullable=False),
        sa.Column('product_id', sa.String(length=128), nullable=False),
        sa.Column('plan', sa.String(length=32), nullable=False),
        sa.Column('environment', sa.String(length=16), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_purchase_receipts_user_id'),
        'purchase_receipts',
        ['user_id'],
        unique=False,
    )
    # Bariera anti-replay.
    op.create_index(
        op.f('ix_purchase_receipts_transaction_id'),
        'purchase_receipts',
        ['transaction_id'],
        unique=True,
    )
    op.create_index(
        op.f('ix_purchase_receipts_original_transaction_id'),
        'purchase_receipts',
        ['original_transaction_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_purchase_receipts_original_transaction_id'),
        table_name='purchase_receipts',
    )
    op.drop_index(
        op.f('ix_purchase_receipts_transaction_id'), table_name='purchase_receipts'
    )
    op.drop_index(
        op.f('ix_purchase_receipts_user_id'), table_name='purchase_receipts'
    )
    op.drop_table('purchase_receipts')

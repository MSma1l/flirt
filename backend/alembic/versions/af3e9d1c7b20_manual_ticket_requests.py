"""manual ticket requests, proof metadata and event capacity

Revision ID: af3e9d1c7b20
Revises: b6f1d27a4c93
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "af3e9d1c7b20"
down_revision: Union[str, None] = "b6f1d27a4c93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("events", sa.Column("ticket_capacity", sa.Integer(), nullable=True))
    op.add_column("events", sa.Column("tickets_sold", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("ticket_orders", sa.Column("ticket_quantity", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("ticket_orders", sa.Column("total_amount", sa.Float(), nullable=False, server_default="0"))
    # NULL means legacy ticket-order; the new API requires these columns.
    op.add_column("ticket_orders", sa.Column("full_name", sa.String(length=200), nullable=True))
    op.add_column("ticket_orders", sa.Column("phone", sa.String(length=40), nullable=True))
    op.add_column("ticket_orders", sa.Column("email", sa.String(length=255), nullable=True))
    op.add_column("ticket_orders", sa.Column("client_message", sa.String(length=500), nullable=True))
    op.add_column("ticket_orders", sa.Column("payment_description", sa.String(length=500), nullable=True))
    op.add_column("ticket_orders", sa.Column("payment_proof_url", sa.String(length=500), nullable=True))
    op.create_index("ix_ticket_orders_request_status", "ticket_orders", ["status", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ticket_orders_request_status", table_name="ticket_orders")
    for name in ("payment_proof_url", "payment_description", "client_message", "email", "phone", "full_name", "total_amount", "ticket_quantity"):
        op.drop_column("ticket_orders", name)
    op.drop_column("events", "tickets_sold")
    op.drop_column("events", "ticket_capacity")

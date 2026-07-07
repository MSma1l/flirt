"""Model PushDevice — token-uri de push per dispozitiv (TZ 6.3).

Fiecare rând leagă un user de un token de notificare pe o platformă. Unicitatea
pe (user_id, token) permite upsert idempotent la re-înregistrare.
"""
from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PushDevice(Base):
    """Un dispozitiv înregistrat pentru push.

    `platform`: 'ios' | 'android'. `token` = token-ul furnizat de Expo/FCM.
    """

    __tablename__ = "push_devices"
    __table_args__ = (
        UniqueConstraint("user_id", "token", name="uq_push_device_user_token"),
    )

    # Proprietarul dispozitivului; indexat pentru lookup rapid pe user.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Token-ul de push (Expo/FCM); opac pentru backend.
    token: Mapped[str] = mapped_column(String(255), nullable=False)
    # Platforma dispozitivului: 'ios' | 'android'.
    platform: Mapped[str] = mapped_column(String(16), nullable=False)

"""Declarative base + import al tuturor modelelor (pentru Alembic autogenerate)."""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base cu PK uuid + timestamps, moștenit de toate modelele."""

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# Importurile de modele se adaugă în app/models/__init__.py, care e importat aici
# pentru ca `Base.metadata` să conțină toate tabelele la momentul migrării.
from app import models  # noqa: E402,F401

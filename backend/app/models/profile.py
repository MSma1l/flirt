"""Model profil / anketă — datele din chestionarul de înregistrare (TZ 2.4–2.7)."""
import uuid

from sqlalchemy import JSON, Boolean, Date, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Profile(Base):
    """Anketa unui utilizator. O linie per user (relație 1:1 cu `users`)."""

    __tablename__ = "profiles"
    __table_args__ = (
        # Index compus pe coordonate: susține bounding-box-ul din filtrul pe rază
        # (feed_service) — fără el, filtrarea geografică ar face seq scan.
        Index("ix_profiles_lat_lng", "lat", "lng"),
    )

    # Legătura 1:1 către user (unic + indexat pentru lookup rapid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )

    # Câmpuri obligatorii (TZ 2.4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Indexat: feed-ul filtrează DUR pe interval de vârstă (birth_date between …).
    birth_date: Mapped["Date"] = mapped_column(Date, nullable=False, index=True)
    # Indexat: feed-ul filtrează pe genurile căutate (`interested_in`).
    gender: Mapped[str] = mapped_column(
        String(16), nullable=False, index=True
    )  # male/female/other
    height_cm: Mapped[int] = mapped_column(Integer, nullable=False)
    city: Mapped[str] = mapped_column(String(120), nullable=False, index=True)

    # Câmpuri opționale (TZ 2.4)
    street: Mapped[str | None] = mapped_column(String(200), nullable=True)
    nationality: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # Coordonate persistate (TZ 7). Geocodate O SINGURĂ DATĂ, la salvarea anketei
    # (`profile_service.upsert_anketa`), NU la fiecare cerere de feed. Permit
    # filtrarea pe rază în SQL (bounding-box) și distanța reală în scor, fără
    # niciun apel de rețea per candidat. None = oraș negeocodabil (distanță
    # necunoscută → scor neutru, fără penalizare).
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Liste stocate ca JSON (portabil SQLite + Postgres)
    languages: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    about: Mapped[str | None] = mapped_column(String(500), nullable=True)  # ≤500 (TZ 2.4)
    dating_statuses: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # Vectorul de umor (TZ 2.7) — completat mai târziu de testul/analiza AI
    humor_vector: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Pozele — upload-ul se face mai târziu; aici doar o listă de URL-uri opțională
    photos: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # Marcat True când anketa a fost completată integral.
    # Indexat: e PREDICATUL PRINCIPAL al feed-ului (`WHERE completed = true`).
    completed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, index=True
    )

    # Verificare facială reușită (TZ 2.2) — setat de /profiles/verify-face
    verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

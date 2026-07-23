"""Modele pentru sistemul de reclame (Ads).

Două entități:
  * `Ad`            — un creativ (video sau imagine) rotit între swipe-uri.
  * `AdSettings`    — un SINGUR rând (singleton, id=1) cu parametrii de afișare:
                      la câte swipe-uri apare o reclamă, durata maximă a videoului
                      și dacă sistemul e activat global.

DE CE PK INTEGER (și nu uuid ca restul modelelor)
-------------------------------------------------
`Base` dă implicit un PK `uuid`. Aici îl SUPRASCRIEM cu `Integer`:
  * panoul de admin lucrează cu id-uri numerice mici, ușor de citit/logat;
  * `AdSettings` e un singleton adresat prin `id == 1` — o cheie fixă, previzibilă,
    e mai naturală ca număr decât ca uuid random.
Suprascrierea coloanei `id` moștenite din `Base` e suportată nativ de declarativul
SQLAlchemy 2.0 (coloana redeclarată în subclasă o înlocuiește pe cea din bază).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Ad(Base):
    """Un creativ publicitar rotit în feed între swipe-uri."""

    __tablename__ = "ads"

    # PK numeric autoincrement — suprascrie `id: uuid` din `Base`.
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Titlul intern al reclamei (afișat în panou, opțional și în overlay).
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # Sursa video a creativului (opțional dacă e o reclamă doar-imagine).
    video_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Sursa imagine (fallback / creativ static).
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Lungimea REALĂ a creativului, în secunde. Afișarea o plafonează la
    # `AdSettings.max_video_seconds` (vezi serviciu), dar aici păstrăm valoarea brută.
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    # Reclamă activă în rotație? Inactivarea o scoate din `/ads/next` fără a o șterge.
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true", default=True
    )
    # Pondere pentru selecția aleatoare: o reclamă cu weight=3 apare de ~3× mai des
    # decât una cu weight=1. Minim 1 (0 ar însemna „niciodată" — folosește `active`).
    weight: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1", default=1
    )

    # --- Targetare (toate NULL = fără restricție, retrocompatibil) -------------
    # Genul căruia i se adresează reclama. NULL = oricine; altfel „male"/„female".
    # Selecția compară cu `Profile.gender` al userului care cere reclama.
    target_gender: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Fereastra de vârstă țintă (ani împliniți). NULL pe o margine = fără acea
    # margine. Un user fără profil/dată de naștere NU se potrivește la reclamele
    # care au setată vreo margine de vârstă (vezi `ad_service.get_next`).
    target_age_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_age_max: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # --- Programare (fereastra de difuzare) -----------------------------------
    # Reclama e eligibilă doar între `starts_at` și `ends_at` (dacă sunt setate).
    # NULL pe o margine = fără acea limită (difuzează de la/până la infinit).
    starts_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ends_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # --- Tracking (contoare brute de evenimente, non-idempotente) -------------
    impressions: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0", default=0
    )
    clicks: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0", default=0
    )
    # created_at / updated_at vin din `Base`.


class AdSettings(Base):
    """Parametrii GLOBALI ai sistemului de reclame — rând SINGLETON (id=1).

    Nu se creează niciodată mai mult de un rând. Serviciul îl citește mereu pe
    `id == 1` și îl creează leneș cu valorile implicite dacă lipsește, ca
    endpoint-urile să funcționeze chiar înainte de a rula migrarea de seed.
    """

    __tablename__ = "ad_settings"

    # PK fix — singura valoare validă e 1 (singleton). Fără autoincrement.
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)

    # După câte swipe-uri se intercalează o reclamă.
    swipes_before_ad: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="15", default=15
    )
    # Plafonul global al duratei unui creativ afișat (secunde).
    max_video_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="10", default=10
    )
    # Comutator global. `False` → `/ads/next` întoarce 204 și `/ads/config` semnalează
    # dezactivarea, indiferent câte reclame active există.
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true", default=True
    )
    # created_at / updated_at vin din `Base` (updated_at se rescrie la fiecare PUT).

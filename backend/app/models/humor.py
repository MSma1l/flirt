"""Modele pentru Testul de umor administrat din panou (TZ 2.7).

Două entități:
  * `HumorSettings` — un SINGUR rând (singleton, id=1): comutatorul global
                      „testul de umor e activ" + textul ecranului de introducere
                      (ro/ru/en), editabile din panou fără deploy.
  * `HumorQuestion` — o glumă din test: textul în ro/ru/en, tipul de umor pe care
                      îl măsoară, ordinea și dacă e activă.

DE CE `key` SEPARAT DE `id`
---------------------------
Clientul trimite răspunsurile ca `card_id`. Cardurile istorice aveau id-uri
scurte („c1".."c7"), iar aplicația nativă deja publicată le poate avea în
memorie în mijlocul unui test. `key` păstrează exact acele id-uri pentru glumele
migrate; glumele noi primesc o cheie generată pe server. `id` (uuid din `Base`)
rămâne cheia internă a panoului.

DE CE RĂSPUNSURILE VECHI NU CRAPĂ
---------------------------------
Nu salvăm răspunsurile per întrebare, ci doar REZULTATUL: vectorul pe cele 7
TIPURI de umor (`Profile.humor_vector`). Tipurile sunt fixe; glumele sunt doar
instrumentul de măsurare. Deci o glumă editată, dezactivată sau ștearsă nu
invalidează niciun vector deja salvat, iar compatibilitatea continuă să compare
vectori pe aceleași 7 axe.
"""
from __future__ import annotations

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Acțiunile auditate ale modulului (ca la fidelitate: modulul e autonom,
# `AdminAuditLog.action` e un `String(64)` liber).
ACTION_HUMOR_SETTINGS_UPDATE = "humor.settings.update"
ACTION_HUMOR_QUESTION_CREATE = "humor.question.create"
ACTION_HUMOR_QUESTION_UPDATE = "humor.question.update"
ACTION_HUMOR_QUESTION_DELETE = "humor.question.delete"
ACTION_HUMOR_QUESTIONS_REORDER = "humor.questions.reorder"


class HumorSettings(Base):
    """Setările globale ale testului de umor — rând SINGLETON (id=1).

    `enabled=False` (implicit): nimeni nu e obligat să dea testul, swipe-ul nu
    mai cere vector de umor, iar umorul nu mai influențează scorul de chimie.
    """

    __tablename__ = "humor_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)

    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
    # Ecranul de introducere afișat înainte de prima glumă. Gol = clientul își
    # folosește textul implicit din cataloagele i18n.
    intro_ro: Mapped[str] = mapped_column(Text, nullable=False, server_default="", default="")
    intro_ru: Mapped[str] = mapped_column(Text, nullable=False, server_default="", default="")
    intro_en: Mapped[str] = mapped_column(Text, nullable=False, server_default="", default="")
    # created_at / updated_at vin din `Base`.


class HumorQuestion(Base):
    """O glumă din test, etichetată cu tipul de umor pe care îl măsoară."""

    __tablename__ = "humor_questions"

    # Id-ul public al cardului (`card_id` în răspunsuri). Unic, imuabil.
    key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # Unul dintre `humor_service.HUMOR_TYPES`.
    humor_type: Mapped[str] = mapped_column(String(32), nullable=False)
    text_ro: Mapped[str] = mapped_column(String(500), nullable=False)
    text_ru: Mapped[str] = mapped_column(String(500), nullable=False)
    text_en: Mapped[str] = mapped_column(String(500), nullable=False)
    # Ordinea în test (crescător). Rescrisă integral la reordonare.
    position: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0", default=0, index=True
    )
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true", default=True
    )

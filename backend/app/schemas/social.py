"""Scheme Pydantic v2 pentru modulul social — like-uri PRIMITE (TZ 4.7 / 6).

`/social/likes/sent` și `/social/likes/pending` (like-uri TRIMISE) trăiesc în
`schemas/account.py`. Aici stă latura simetrică: „cine ți-a dat ȚIE like", ca
userul să vadă cererile primite, să deschidă ancheta persoanei și să răspundă.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ReceivedProfile(BaseModel):
    """Cardul de profil al celui care mi-a dat like — ca să-i deschid anketa.

    Câmpurile sunt cele expuse și de feed (`FeedCard`): nume, vârstă, gen, oraș,
    „despre", poze, limbi. Nu reutilizăm direct `FeedCard` fiindcă acela cere un
    `compatibility` calculat (mașinăria de scor din feed, pe care n-o atingem
    aici); păstrăm exact aceleași câmpuri de profil, fără scorul de feed.
    """

    name: str
    age: int  # calculat din birth_date
    gender: str
    city: str
    about: str | None = None
    photos: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)


class LikeReceivedOut(BaseModel):
    """Un like PRIMIT la care ÎNCĂ nu am răspuns — o „cerere" în inbox.

    `message` = `deferred_message`-ul autorului (cu sau fără), MASCAT de contacte
    (TZ 5.5): fără mascare, un like cu telefon/telegram în text ar livra datele de
    contact destinatarului înainte de orice match, ocolind exact filtrul de chat.
    `is_super` pune un badge pe mobil. Ca să răspund, dau `POST /feed/swipe` cu
    `action=like` (+ mesaj opțional) pe `user_id` → se creează match + chat, iar
    AMBELE mesaje deferred (al lui + al meu) ajung în conversație.
    """

    user_id: uuid.UUID
    is_super: bool = False
    message: str | None = None
    created_at: datetime
    profile: ReceivedProfile


class LikeReceivedPage(BaseModel):
    """O pagină de like-uri PRIMITE + cursorul spre următoarea (convenția `/feed`)."""

    items: list[LikeReceivedOut] = Field(default_factory=list)
    next_cursor: str | None = None

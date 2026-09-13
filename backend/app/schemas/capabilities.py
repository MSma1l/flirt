"""Schema răspunsului `GET /capabilities` — adevărul despre ce merge azi.

CONTRACT cu clientul (Mini App / mobil): fiecare câmp e o FUNCȚIE DE PRODUS și
are voie să fie doar `true` sau `false`. Nu apar nume de provideri, versiuni,
chei, mesaje de eroare sau orice altceva de infrastructură — un atacator care
citește răspunsul nu află nimic în plus față de ce ar afla apăsând butonul.

De ce există: produsul rulează ca Telegram Mini App, iar câteva integrări au
rămas în modul de dezvoltare fiindcă funcțiile pe care le deserveau au ieșit
din scop. Regula casei e că o astfel de funcție se declară INDISPONIBILĂ, nu se
servește cu un rezultat fals — iar acesta e locul unde se declară.

Sursa valorilor e `Settings.capabilities` (app/core/config.py), aceeași pe care
garda de producție o folosește ca să decidă dacă are voie să pornească.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class CapabilitiesOut(BaseModel):
    """Ce poate face clientul pe ACEST server. Doar da/nu, pe funcții."""

    # `extra="forbid"` nu e cosmetic: împiedică pe viitor lipirea unui câmp
    # „de diagnostic" (nume de provider, versiune) pe un răspuns PUBLIC.
    model_config = ConfigDict(extra="forbid")

    # --- Autentificare: pe unde se poate intra ------------------------------
    # Clientul le citește ÎNAINTE de login, ca să arate doar butoanele care duc
    # undeva. Un buton „Continuă cu Google" care nu funcționează e o promisiune
    # ruptă la prima atingere.
    telegram_login: bool = Field(description="Intrare prin Telegram Mini App")
    social_login: bool = Field(description="Intrare prin Google / Apple")
    phone_login: bool = Field(description="Intrare prin cod trimis pe telefon")

    # --- Profil și căutare --------------------------------------------------
    photo_upload: bool = Field(description="Încărcarea pozelor de profil")
    face_verification: bool = Field(
        description="Verificarea facială care acordă insigna de profil verificat"
    )
    distance_search: bool = Field(description="Distanța și raza de căutare")

    # --- Funcții opționale --------------------------------------------------
    payments: bool = Field(description="Abonamente și plăți în aplicație")
    push_notifications: bool = Field(description="Notificări native pe dispozitiv")
    ai_assistant: bool = Field(description="Sugestiile AI de conversație")

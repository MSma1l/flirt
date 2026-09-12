"""Scheme Pydantic v2 pentru funcțiile AI de produs (hint de chat + chimie).

CONTRACT COMUN: ambele răspunsuri au `available` + `reason`, NU un cod HTTP de
eroare, atunci când AI-ul lipsește sau providerul cade. Motivul e același ca în
`services/ai.py`: AI-ul e o funcție de CONFORT. Produsul trebuie să funcționeze
complet fără chei AI (ca restul integrărilor: storage, push, billing, geo), iar
un 5xx pe o sugestie de mesaj ar transforma o funcție opțională într-o pană.

Excepția (deliberată) e poarta de activare: `ai_enabled=false` pe cont NU e o
degradare, ci o alegere a userului — acolo ruta ridică 403 cu un mesaj
acționabil („pornește-le din Setări"), ca mobilul să poată duce userul exact
unde trebuie.
"""
from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

# --- Etichete stabile pentru `reason` ----------------------------------------
# Sunt CONTRACT cu clientul (mobil/miniapp alege mesajul afișat după ele) și
# ajung în loguri — nu se redenumesc fără să se schimbe și clientul.
REASON_NOT_CONFIGURED = "ai_not_configured"   # serverul nu are provider/cheie AI
REASON_PROVIDER_ERROR = "ai_provider_error"   # providerul a picat (429/timeout/5xx)
REASON_EMPTY = "ai_empty_response"            # a răspuns, dar fără nimic folosibil
REASON_NO_HISTORY = "ai_no_history"           # (rezervat) conversație fără context


class ChatHintIn(BaseModel):
    """Cererea de sugestie: doar identificatorul conversației.

    NU primim textul conversației de la client: l-am duplica, l-am putea
    falsifica și ar ocoli verificarea de apartenență. Mesajele se citesc
    server-side, din baza de date, prin `chat_service`.
    """

    chat_id: uuid.UUID


class ChatHintOut(BaseModel):
    """Sugestii scurte de mesaj pentru o conversație.

    `suggestions` e goală când `available` e False (vezi `reason`).
    `cached` spune dacă răspunsul vine din memoria temporară (Redis) — util la
    depanare și pentru telemetria de cost, fără să expună nimic sensibil.
    """

    available: bool
    suggestions: list[str] = Field(default_factory=list)
    reason: str | None = None
    cached: bool = False


class ChemistryOut(BaseModel):
    """Scorul de chimie dintre userul curent și un altul, cu explicație.

    `score` e MEREU prezent și e scorul de compatibilitate DETERMINIST
    (`services/compatibility.compute_compatibility`), același pe care îl afișează
    feed-ul și lista de chat-uri. AI-ul adaugă doar `explanation`; un scor
    inventat de model ar fi nereproductibil, netestabil și ar contrazice cifra
    afișată în restul aplicației.
    """

    user_id: uuid.UUID
    score: int = Field(ge=0, le=100)
    available: bool
    explanation: str | None = None
    reason: str | None = None

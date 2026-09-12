"""Rute AI de produs — sub prefixul /api/v1/ai. Toate protejate.

Două funcții, ambele opționale și oprite implicit pe fiecare cont
(`UserSettings.ai_enabled`, pornit din `PUT /api/v1/settings`):
  * `POST /ai/chat-hint`            — sugestii de mesaj pentru o conversație;
  * `GET  /ai/chemistry/{user_id}`  — scor de chimie explicat.

Logica stă în `services/ai_assist.py`; aici rămân doar contractul HTTP și
porțile transversale (autentificare + limitare de cereri).
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.core.ratelimit import rate_limit
from app.db.session import get_db
from app.models.user import User
from app.schemas.ai import ChatHintIn, ChatHintOut, ChemistryOut
from app.services import ai_assist

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]

# Limitare de cereri — tiparul din `core/ratelimit.py` (Redis partajat între
# workeri, fallback in-memory), cu prag PROPRIU și configurabil
# (`RATE_LIMIT_AI_PER_MIN`).
#
# DE CE UN PRAG SEPARAT: spre deosebire de restul rutelor, fiecare apel de aici
# costă bani reali la furnizorul extern, iar costul e nemărginit dacă cineva ține
# butonul apăsat sau scriptează ruta.
#
# DE CE 10/minut: un om citește o sugestie și scrie un mesaj în zeci de secunde,
# deci 10 pe minut e deja de câteva ori mai mult decât folosirea normală (și se
# adaugă peste memorarea temporară, care servește gratuit apăsările repetate pe
# aceeași conversație). Suficient de generos cât să nu deranjeze mai mulți useri
# ieșiți prin același NAT de operator mobil — cazul real al Mini App-ului, vezi
# motivarea pragului Telegram din `core/config.py` — și suficient de strâns cât
# să plafoneze factura. Poarta principală de cost rămâne `ai_enabled`, oprit
# implicit pe fiecare cont.
_ai_rl = rate_limit("ai", "rate_limit_ai_per_min", 60)


@router.post("/chat-hint", response_model=ChatHintOut, dependencies=[Depends(_ai_rl)])
async def chat_hint(data: ChatHintIn, db: DbDep, user: UserDep) -> ChatHintOut:
    """Sugestii scurte de mesaj pentru o conversație a userului curent.

    404 dacă userul nu e participant la conversație (nu divulgăm existența unui
    chat străin), 403 dacă funcțiile AI sunt oprite pe cont, 429 la depășirea
    limitei. Fără chei AI sau cu providerul căzut întoarce 200 cu
    `available=false` + `reason` — nu o eroare de server.
    """
    return await ai_assist.chat_hint(db, user, data.chat_id)


@router.get(
    "/chemistry/{user_id}",
    response_model=ChemistryOut,
    dependencies=[Depends(_ai_rl)],
)
async def chemistry(user_id: uuid.UUID, db: DbDep, user: UserDep) -> ChemistryOut:
    """Scorul de chimie cu `user_id`, explicat de AI.

    `score` (0–100) e calculul DETERMINIST existent și vine mereu, chiar și când
    AI-ul lipsește (`available=false`) — explicația e partea opțională. Regulile
    de vizibilitate sunt cele de la swipe: 403 la blocare, 404 la profil ascuns /
    banat / șters / inexistent.
    """
    return await ai_assist.chemistry(db, user, user_id)

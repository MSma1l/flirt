"""Logica Testului de umor (TZ 2.7).

Userul evaluează câteva glume scurte (funny / not funny). Din răspunsuri
construim un vector normalizat de ponderi pe cele 7 tipuri de umor și îl
salvăm în `Profile.humor_vector` (câmp JSON existent), de unde e citit de
`compatibility.py`.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profile import Profile
from app.models.user import User
from app.schemas.humor import HumorAnswer, HumorCard, HumorProfileOut

# --- Cele 7 tipuri de umor (TZ 2.7) — constante ------------------------------
HUMOR_TYPES: list[str] = [
    "sarcasm",
    "dark",
    "memes",
    "intellectual",
    "absurd",
    "wholesome",
    "physical",
]

# --- Cardurile quiz-ului — o glumă scurtă per tip ----------------------------
# Fiecare card are un `type` dintre HUMOR_TYPES; textele sunt scurte și neutre.
#
# Glumele sunt ADAPTATE, nu traduse cuvânt cu cuvânt: o glumă tradusă literal
# încetează să fie glumă, iar userul ar bifa „not funny" din cauza traducerii, nu
# a tipului de umor — și vectorul (deci scorul de compatibilitate din
# `compatibility.py`) ar ieși fals. Ce se păstrează identic între limbi e TIPUL;
# textul poate diferi cât e nevoie ca poanta să funcționeze nativ.
QUIZ_CARDS: list[HumorCard] = [
    # Sarcasm: entuziasm fals față de ceva evident neplăcut. Funcționează 1:1 în
    # toate 4 limbile — nu depinde de joc de cuvinte.
    HumorCard(
        id="c1",
        text_ro="Super, încă o luni. Exact ce ceream de la viață.",
        text_ru="Прекрасно, ещё один понедельник. Именно то, о чём я мечтал.",
        text_uk="Чудово, ще один понеділок. Саме про це я й мріяв.",
        text_en="Oh good, another Monday. Exactly what I put on my wish list.",
        type="sarcasm",
    ),
    # Dark: autoironie despre epuizare. În ru/uk poanta stă pe „вянем/в'янемо"
    # (a se ofili) — verbul merge și la plante, și la om, deci gluma e mai
    # naturală decât calcul după engleză.
    HumorCard(
        id="c2",
        text_ro="Eu și plantele mele avem multe în comun: murim încet, pe dinăuntru.",
        text_ru="У меня с растениями много общего: мы одинаково медленно вянем внутри.",
        text_uk="У мене з рослинами багато спільного: ми однаково повільно в'янемо всередині.",
        text_en="My plants and I have a lot in common: we're both slowly dying inside.",
        type="dark",
    ),
    # Memes: formatul de caption „Eu, cel care...” / „Я, который...” e recunoscut
    # ca meme în toate 4 limbile.
    HumorCard(
        id="c3",
        text_ro="Eu, făcând pe ocupatul, în timp ce rotița de încărcare muncește pentru amândoi.",
        text_ru="Я, изображающий бурную деятельность, пока полоска загрузки работает за меня.",
        text_uk="Я, який вдає бурхливу діяльність, поки смужка завантаження працює за мене.",
        text_en="Me looking busy while the loading spinner does all the actual work.",
        type="memes",
    ),
    # Intellectual: joc de cuvinte pe „reacție” (chimică / de răspuns). Norocos:
    # cuvântul e polisemic la fel în ro, ru, uk și en, deci poanta se păstrează.
    HumorCard(
        id="c4",
        text_ro="Am spus o glumă despre chimie. Zero reacție.",
        text_ru="Рассказал шутку про химию — реакции ноль.",
        text_uk="Розповів жарт про хімію — жодної реакції.",
        text_en="I told a chemistry joke, but there was no reaction.",
        type="intellectual",
    ),
    # Absurd: anti-glumă (construiește așteptarea, apoi refuză poanta). „Intră X
    # într-un bar” / „Заходит X в бар” e un format cunoscut în toate 4 limbile.
    HumorCard(
        id="c5",
        text_ro="Un cal intră într-un bar și comandă un pahar cu apă. Atât.",
        text_ru="Заходит конь в бар и заказывает стакан воды. Всё.",
        text_uk="Заходить кінь у бар і замовляє склянку води. Усе.",
        text_en="A horse walks into a bar and orders a glass of water. That's it.",
        type="absurd",
    ),
    # Wholesome: tandru, fără victimă. Imaginea e vizuală, deci trece în orice limbă.
    HumorCard(
        id="c6",
        text_ro="Un cățel s-a apucat să-și prindă coada și a adormit din prima tură.",
        text_ru="Щенок гнался за своим хвостом, устал и уснул прямо на первом круге.",
        text_uk="Цуценя ганялося за власним хвостом і заснуло просто на першому колі.",
        text_en="A puppy chased its own tail and fell asleep on the very first lap.",
        type="wholesome",
    ),
    # Physical: slapstick. Comparația pentru brațe e localizată — „morișcă" (ro),
    # „мельница" (ru), „вітряк" (uk) — literalul ar suna străin în fiecare.
    HumorCard(
        id="c7",
        text_ro="A alunecat pe o coajă de banană — ca în desene, cu brațele ca o morișcă.",
        text_ru="Поскользнулся на банановой кожуре — как в мультике, руками мельницу изобразил.",
        text_uk="Посковзнувся на банановій шкірці — як у мультику, руками замахав, наче вітряк.",
        text_en="He slipped on a banana peel — cartoon-style, arms flailing and all.",
        type="physical",
    ),
]

# Index rapid card_id -> tip, pentru scorare.
_CARD_TYPE_BY_ID: dict[str, str] = {card.id: card.type for card in QUIZ_CARDS}


def get_quiz() -> list[HumorCard]:
    """Întoarce cardurile quiz-ului de umor."""
    return list(QUIZ_CARDS)


def _build_vector(answers: list[HumorAnswer]) -> dict[str, float]:
    """Construiește vectorul normalizat de ponderi pe tip din răspunsuri.

    Numără câte `funny=True` per tip, apoi normalizează să sumeze ~1.0.
    Dacă niciun răspuns nu e amuzant → vector uniform pe cele 7 tipuri.
    """
    # Numărăm doar răspunsurile pozitive pentru carduri cunoscute.
    counts: dict[str, int] = {t: 0 for t in HUMOR_TYPES}
    for answer in answers:
        if not answer.funny:
            continue
        humor_type = _CARD_TYPE_BY_ID.get(answer.card_id)
        if humor_type is not None:
            counts[humor_type] += 1

    total = sum(counts.values())
    if total == 0:
        # Fără preferințe exprimate → distribuție uniformă.
        uniform = 1.0 / len(HUMOR_TYPES)
        return {t: uniform for t in HUMOR_TYPES}

    return {t: counts[t] / total for t in HUMOR_TYPES}


async def _load_profile(db: AsyncSession, user: User) -> Profile:
    """Încarcă profilul userului după user_id; 404 dacă lipsește."""
    result = await db.execute(select(Profile).where(Profile.user_id == user.id))
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Anketa nu există încă.",
        )
    return profile


async def submit_quiz(
    db: AsyncSession, user: User, answers: list[HumorAnswer]
) -> HumorProfileOut:
    """Calculează vectorul de umor și îl salvează în profilul userului."""
    profile = await _load_profile(db, user)
    vector = _build_vector(answers)
    profile.humor_vector = vector
    await db.commit()
    return HumorProfileOut(vector=vector)


async def get_humor(db: AsyncSession, user: User) -> HumorProfileOut:
    """Întoarce vectorul de umor curent (sau {} dacă lipsește)."""
    profile = await _load_profile(db, user)
    vector = profile.humor_vector if isinstance(profile.humor_vector, dict) else {}
    return HumorProfileOut(vector=vector)

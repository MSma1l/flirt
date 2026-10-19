"""Logica Testului de umor (TZ 2.7).

Userul evaluează câteva glume scurte (funny / not funny). Din răspunsuri
construim un vector normalizat de ponderi pe cele 7 tipuri de umor și îl
salvăm în `Profile.humor_vector` (câmp JSON existent), de unde e citit de
`compatibility.py`.

ADMINISTRAT DIN PANOU
---------------------
Glumele și comutatorul global stau în DB (`models/humor.py`), editabile din
panou fără deploy:
  * `HumorSettings.enabled` (implicit OPRIT) decide dacă testul e impus: când e
    oprit, swipe-ul nu mai cere vector de umor (`feed_service._authorize_swipe`),
    scorul de chimie ignoră umorul (`compatibility.compute_compatibility`), iar
    Mini App-ul ascunde intrările spre test (`GET /humor/config`).
  * Quiz-ul și trimiterea rămân FUNCȚIONALE chiar și cu testul oprit: aplicația
    nativă deja publicată îl cere în onboarding și nu are voie să crape.

RĂSPUNSURI VECHI — DECIZIA
--------------------------
Vectorul salvat RĂMÂNE cel salvat: e pe cele 7 tipuri (fixe), nu pe glume, deci
nu depinde de ce glume există azi. La o trimitere nouă, scorăm doar răspunsurile
pentru glume care EXISTĂ în DB (active sau dezactivate între timp — tipul lor e
încă cunoscut); id-urile necunoscute (glume șterse) sunt ignorate, nu 422.
"""
from __future__ import annotations

import secrets
import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.humor import (
    ACTION_HUMOR_QUESTION_CREATE,
    ACTION_HUMOR_QUESTION_DELETE,
    ACTION_HUMOR_QUESTION_UPDATE,
    ACTION_HUMOR_QUESTIONS_REORDER,
    ACTION_HUMOR_SETTINGS_UPDATE,
    HumorQuestion,
    HumorSettings,
)
from app.models.profile import Profile
from app.models.user import User
from app.schemas.humor import (
    HumorAnswer,
    HumorCard,
    HumorConfigOut,
    HumorProfileOut,
    HumorQuestionIn,
    HumorQuestionOut,
    HumorQuestionUpdate,
    HumorSettingsIn,
    HumorSettingsOut,
)
from app.services.admin_service import audit

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

# Cheia fixă a rândului singleton de setări.
SETTINGS_ID = 1

# Câte glume ACTIVE trebuie să existe ca testul să poată fi pornit. Sub prag
# vectorul ar ieși din 1-2 răspunsuri, deci zgomot, nu profil.
MIN_ACTIVE_QUESTIONS = 3
# Plafon de siguranță pe numărul total de glume (testul trebuie să rămână scurt).
MAX_QUESTIONS = 50

# --- Seed: glumele istorice (aceleași ca în migrația de seed) -----------------
# Glumele sunt ADAPTATE, nu traduse cuvânt cu cuvânt: o glumă tradusă literal
# încetează să fie glumă. Ce se păstrează identic între limbi e TIPUL.
DEFAULT_QUESTIONS: list[dict[str, str]] = [
    {
        "key": "c1",
        "humor_type": "sarcasm",
        "text_ro": "Super, încă o luni. Exact ce ceream de la viață.",
        "text_ru": "Прекрасно, ещё один понедельник. Именно то, о чём я мечтал.",
        "text_en": "Oh good, another Monday. Exactly what I put on my wish list.",
    },
    {
        "key": "c2",
        "humor_type": "dark",
        "text_ro": "Eu și plantele mele avem multe în comun: murim încet, pe dinăuntru.",
        "text_ru": "У меня с растениями много общего: мы одинаково медленно вянем внутри.",
        "text_en": "My plants and I have a lot in common: we're both slowly dying inside.",
    },
    {
        "key": "c3",
        "humor_type": "memes",
        "text_ro": "Eu, făcând pe ocupatul, în timp ce rotița de încărcare muncește pentru amândoi.",
        "text_ru": "Я, изображающий бурную деятельность, пока полоска загрузки работает за меня.",
        "text_en": "Me looking busy while the loading spinner does all the actual work.",
    },
    {
        "key": "c4",
        "humor_type": "intellectual",
        "text_ro": "Am spus o glumă despre chimie. Zero reacție.",
        "text_ru": "Рассказал шутку про химию — реакции ноль.",
        "text_en": "I told a chemistry joke, but there was no reaction.",
    },
    {
        "key": "c5",
        "humor_type": "absurd",
        "text_ro": "Un cal intră într-un bar și comandă un pahar cu apă. Atât.",
        "text_ru": "Заходит конь в бар и заказывает стакан воды. Всё.",
        "text_en": "A horse walks into a bar and orders a glass of water. That's it.",
    },
    {
        "key": "c6",
        "humor_type": "wholesome",
        "text_ro": "Un cățel s-a apucat să-și prindă coada și a adormit din prima tură.",
        "text_ru": "Щенок гнался за своим хвостом, устал и уснул прямо на первом круге.",
        "text_en": "A puppy chased its own tail and fell asleep on the very first lap.",
    },
    {
        "key": "c7",
        "humor_type": "physical",
        "text_ro": "A alunecat pe o coajă de banană — ca în desene, cu brațele ca o morișcă.",
        "text_ru": "Поскользнулся на банановой кожуре — как в мультике, руками мельницу изобразил.",
        "text_en": "He slipped on a banana peel — cartoon-style, arms flailing and all.",
    },
]

# Textul implicit al ecranului de introducere (editabil din panou).
DEFAULT_INTRO: dict[str, str] = {
    "ro": (
        "De ce acest test? Îți arătăm câteva glume scurte și ne spui dacă te-au "
        "amuzat. Așa aflăm ce fel de umor ai și îți arătăm mai des oameni cu un "
        "simț al umorului compatibil, iar scorul de chimie devine mai precis.\n\n"
        "Durează 1–2 minute și nu există răspunsuri greșite. Răspunsurile nu apar "
        "în profilul tău și nu le vede nimeni: le folosim doar ca să calculăm "
        "potrivirea."
    ),
    "ru": (
        "Зачем этот тест? Мы покажем несколько коротких шуток, а ты отметишь, "
        "смешно ли тебе. Так мы поймём твоё чувство юмора, чаще будем показывать "
        "людей с похожим юмором, а оценка «химии» станет точнее.\n\n"
        "Это займёт 1–2 минуты, неправильных ответов нет. Ответы не видны в твоём "
        "профиле и никому не показываются: мы используем их только для подбора."
    ),
    "en": (
        "Why this test? We'll show you a few short jokes and you tell us whether "
        "they made you laugh. That's how we learn your sense of humor, show you "
        "more people whose humor clicks with yours, and make the chemistry score "
        "more accurate.\n\n"
        "It takes 1–2 minutes and there are no wrong answers. Your answers don't "
        "appear on your profile and nobody sees them: we only use them for matching."
    ),
}


# --------------------------------------------------------------------------- #
# Settings singleton + seed
# --------------------------------------------------------------------------- #
def _seed_questions(db: AsyncSession) -> None:
    for position, data in enumerate(DEFAULT_QUESTIONS):
        db.add(HumorQuestion(position=position, active=True, **data))


async def _get_or_create_settings(db: AsyncSession) -> HumorSettings:
    """Rândul singleton `id=1`, creat LENEȘ (cu glumele de seed) dacă lipsește.

    Seed-ul glumelor e legat de crearea setărilor, NU de „tabela de glume e
    goală": altfel un admin care șterge toate glumele s-ar trezi cu ele înapoi.
    În producție ambele vin din migrație; calea leneșă servește bazele create
    fără migrații (teste, dezvoltare).
    """
    s = await db.get(HumorSettings, SETTINGS_ID)
    if s is not None:
        return s
    s = HumorSettings(
        id=SETTINGS_ID,
        enabled=False,
        intro_ro=DEFAULT_INTRO["ro"],
        intro_ru=DEFAULT_INTRO["ru"],
        intro_en=DEFAULT_INTRO["en"],
    )
    db.add(s)
    existing = await db.scalar(select(func.count()).select_from(HumorQuestion))
    if not existing:
        _seed_questions(db)
    await db.commit()
    await db.refresh(s)
    return s


async def is_enabled(db: AsyncSession) -> bool:
    """True dacă testul de umor e activ (impus la swipe, folosit la scor).

    READ-ONLY, deliberat: e apelat din fluxul de swipe / feed, unde un commit
    neașteptat (crearea leneșă a singleton-ului) n-are ce căuta. Rândul lipsă
    înseamnă valoarea implicită: OPRIT.
    """
    s = await db.get(HumorSettings, SETTINGS_ID)
    return bool(s is not None and s.enabled)


async def _active_questions(db: AsyncSession) -> list[HumorQuestion]:
    rows = await db.scalars(
        select(HumorQuestion)
        .where(HumorQuestion.active.is_(True))
        .order_by(HumorQuestion.position, HumorQuestion.created_at)
    )
    return list(rows.all())


async def _count_active(db: AsyncSession) -> int:
    return int(
        await db.scalar(
            select(func.count())
            .select_from(HumorQuestion)
            .where(HumorQuestion.active.is_(True))
        )
        or 0
    )


# --------------------------------------------------------------------------- #
# Partea utilizatorului
# --------------------------------------------------------------------------- #
def _to_card(q: HumorQuestion) -> HumorCard:
    return HumorCard(
        id=q.key,
        text_ro=q.text_ro,
        text_ru=q.text_ru,
        text_en=q.text_en,
        type=q.humor_type,
    )


async def get_quiz(db: AsyncSession) -> list[HumorCard]:
    """Glumele ACTIVE, în ordinea din panou."""
    await _get_or_create_settings(db)
    return [_to_card(q) for q in await _active_questions(db)]


async def get_config(db: AsyncSession) -> HumorConfigOut:
    """Starea testului pentru client: activ sau nu + textul de introducere."""
    s = await _get_or_create_settings(db)
    return HumorConfigOut(
        enabled=s.enabled,
        intro_ro=s.intro_ro,
        intro_ru=s.intro_ru,
        intro_en=s.intro_en,
        question_count=await _count_active(db),
    )


def _build_vector(
    answers: list[HumorAnswer], type_by_key: dict[str, str]
) -> dict[str, float]:
    """Construiește vectorul normalizat de ponderi pe tip din răspunsuri.

    Numără câte `funny=True` per tip (doar pentru glume cunoscute), apoi
    normalizează să sumeze ~1.0. Niciun răspuns amuzant → vector uniform.
    """
    counts: dict[str, int] = {t: 0 for t in HUMOR_TYPES}
    for answer in answers:
        if not answer.funny:
            continue
        humor_type = type_by_key.get(answer.card_id)
        if humor_type in counts:
            counts[humor_type] += 1

    total = sum(counts.values())
    if total == 0:
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
    await _get_or_create_settings(db)
    keys = {a.card_id for a in answers}
    type_by_key: dict[str, str] = {}
    if keys:
        rows = await db.execute(
            select(HumorQuestion.key, HumorQuestion.humor_type).where(
                HumorQuestion.key.in_(keys)
            )
        )
        type_by_key = {k: t for k, t in rows.all()}
    vector = _build_vector(answers, type_by_key)
    profile.humor_vector = vector
    await db.commit()
    return HumorProfileOut(vector=vector)


async def get_humor(db: AsyncSession, user: User) -> HumorProfileOut:
    """Întoarce vectorul de umor curent (sau {} dacă lipsește)."""
    profile = await _load_profile(db, user)
    vector = profile.humor_vector if isinstance(profile.humor_vector, dict) else {}
    return HumorProfileOut(vector=vector)


# --------------------------------------------------------------------------- #
# Panoul de admin
# --------------------------------------------------------------------------- #
async def admin_get_settings(db: AsyncSession) -> HumorSettingsOut:
    s = await _get_or_create_settings(db)
    return HumorSettingsOut(
        enabled=s.enabled,
        intro_ro=s.intro_ro,
        intro_ru=s.intro_ru,
        intro_en=s.intro_en,
        active_questions=await _count_active(db),
        min_active_questions=MIN_ACTIVE_QUESTIONS,
        humor_types=list(HUMOR_TYPES),
        updated_at=s.updated_at,
    )


def _too_few_active(count: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            f"Testul are nevoie de cel puțin {MIN_ACTIVE_QUESTIONS} glume active "
            f"(acum: {count})."
        ),
    )


async def admin_update_settings(
    db: AsyncSession,
    data: HumorSettingsIn,
    actor: User | None = None,
    ip: str | None = None,
) -> HumorSettingsOut:
    s = await _get_or_create_settings(db)
    if data.enabled:
        count = await _count_active(db)
        if count < MIN_ACTIVE_QUESTIONS:
            raise _too_few_active(count)
    s.enabled = data.enabled
    s.intro_ro = data.intro_ro
    s.intro_ru = data.intro_ru
    s.intro_en = data.intro_en
    if actor is not None:
        audit(
            db,
            actor,
            ACTION_HUMOR_SETTINGS_UPDATE,
            target_type="humor_settings",
            meta={"enabled": s.enabled},
            ip=ip,
        )
    await db.commit()
    # `updated_at` e rescris de server (onupdate) → expirat după commit.
    await db.refresh(s)
    return await admin_get_settings(db)


def _to_question_out(q: HumorQuestion) -> HumorQuestionOut:
    return HumorQuestionOut(
        id=q.id,
        key=q.key,
        humor_type=q.humor_type,
        text_ro=q.text_ro,
        text_ru=q.text_ru,
        text_en=q.text_en,
        position=q.position,
        active=q.active,
        updated_at=q.updated_at,
    )


def _check_type(humor_type: str) -> None:
    if humor_type not in HUMOR_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Tip de umor necunoscut: {humor_type}.",
        )


async def admin_list_questions(db: AsyncSession) -> list[HumorQuestionOut]:
    await _get_or_create_settings(db)
    rows = await db.scalars(
        select(HumorQuestion).order_by(HumorQuestion.position, HumorQuestion.created_at)
    )
    return [_to_question_out(q) for q in rows.all()]


async def _get_question_or_404(db: AsyncSession, question_id: uuid.UUID) -> HumorQuestion:
    q = await db.get(HumorQuestion, question_id)
    if q is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gluma nu există.")
    return q


async def admin_create_question(
    db: AsyncSession,
    data: HumorQuestionIn,
    actor: User | None = None,
    ip: str | None = None,
) -> HumorQuestionOut:
    await _get_or_create_settings(db)
    _check_type(data.humor_type)
    total = int(await db.scalar(select(func.count()).select_from(HumorQuestion)) or 0)
    if total >= MAX_QUESTIONS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Maximum {MAX_QUESTIONS} glume.",
        )
    last = await db.scalar(select(func.max(HumorQuestion.position)))
    q = HumorQuestion(
        # Cheie publică generată pe SERVER (clientul nu propune id-uri).
        key=f"q{secrets.token_hex(6)}",
        humor_type=data.humor_type,
        text_ro=data.text_ro,
        text_ru=data.text_ru,
        text_en=data.text_en,
        active=data.active,
        position=(last + 1) if last is not None else 0,
    )
    db.add(q)
    await db.flush()
    if actor is not None:
        audit(
            db,
            actor,
            ACTION_HUMOR_QUESTION_CREATE,
            target_type="humor_question",
            target_id=q.id,
            ip=ip,
        )
    await db.commit()
    await db.refresh(q)
    return _to_question_out(q)


async def admin_update_question(
    db: AsyncSession,
    question_id: uuid.UUID,
    data: HumorQuestionUpdate,
    actor: User | None = None,
    ip: str | None = None,
) -> HumorQuestionOut:
    s = await _get_or_create_settings(db)
    q = await _get_question_or_404(db, question_id)
    changes = data.model_dump(exclude_unset=True)
    if "humor_type" in changes:
        _check_type(changes["humor_type"])
    # Dezactivarea nu are voie să lase un test ACTIV sub pragul minim.
    if changes.get("active") is False and q.active and s.enabled:
        count = await _count_active(db)
        if count - 1 < MIN_ACTIVE_QUESTIONS:
            raise _too_few_active(count - 1)
    for field, value in changes.items():
        setattr(q, field, value)
    if actor is not None:
        audit(
            db,
            actor,
            ACTION_HUMOR_QUESTION_UPDATE,
            target_type="humor_question",
            target_id=q.id,
            meta={"fields": sorted(changes)},
            ip=ip,
        )
    await db.commit()
    await db.refresh(q)
    return _to_question_out(q)


async def admin_delete_question(
    db: AsyncSession,
    question_id: uuid.UUID,
    actor: User | None = None,
    ip: str | None = None,
) -> None:
    s = await _get_or_create_settings(db)
    q = await _get_question_or_404(db, question_id)
    if q.active and s.enabled:
        count = await _count_active(db)
        if count - 1 < MIN_ACTIVE_QUESTIONS:
            raise _too_few_active(count - 1)
    if actor is not None:
        audit(
            db,
            actor,
            ACTION_HUMOR_QUESTION_DELETE,
            target_type="humor_question",
            target_id=q.id,
            meta={"key": q.key},
            ip=ip,
        )
    await db.delete(q)
    await db.commit()


async def admin_reorder_questions(
    db: AsyncSession,
    ids: list[uuid.UUID],
    actor: User | None = None,
    ip: str | None = None,
) -> list[HumorQuestionOut]:
    """Rescrie ordinea. Lista trebuie să conțină EXACT toate glumele, o dată."""
    await _get_or_create_settings(db)
    rows = list((await db.scalars(select(HumorQuestion))).all())
    by_id = {q.id: q for q in rows}
    if len(ids) != len(set(ids)) or set(ids) != set(by_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ordinea trebuie să conțină fiecare glumă exact o dată.",
        )
    for position, qid in enumerate(ids):
        by_id[qid].position = position
    if actor is not None:
        audit(
            db,
            actor,
            ACTION_HUMOR_QUESTIONS_REORDER,
            target_type="humor_question",
            ip=ip,
        )
    await db.commit()
    return await admin_list_questions(db)

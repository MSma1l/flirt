"""Logica feed-ului de swipe + match-uri (TZ secț. 4)."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.account import Block, UserSettings
from app.models.chat import Chat, Message
from app.models.interest import Interest, ProfileInterest
from app.models.profile import Profile
from app.models.swipe import Like, Match
from app.models.user import User
from app.schemas.feed import FeedCard, MatchOut, SwipeResult, UndoResult
from app.services import billing, chat_service, geo
from app.services.compatibility import compute_compatibility
from app.services.contact_masker import mask_contacts

# --- Reguli de business (din config, nu hardcodate în mijlocul logicii) ------
MAX_TOP_INTERESTS = 3   # câte interese afișăm pe cartelă (TZ 4.1)


def _calc_age(birth_date: date, today: date | None = None) -> int:
    """Vârsta în ani împliniți la `today` (implicit azi)."""
    today = today or date.today()
    return (
        today.year
        - birth_date.year
        - ((today.month, today.day) < (birth_date.month, birth_date.day))
    )


def _age_group(age: int) -> str:
    """Grupa de vârstă pentru separarea din feed (TZ 2.3): 'minor' vs 'adult'."""
    return "adult" if age >= settings.adult_age else "minor"


def _normalized_pair(x: uuid.UUID, y: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    """Ordonează perechea (mai mic, mai mare) după reprezentarea string a UUID."""
    return (x, y) if str(x) <= str(y) else (y, x)


async def _interests_by_profile(
    db: AsyncSession, profile_ids: list[uuid.UUID]
) -> dict[uuid.UUID, set[str]]:
    """Mapează profile_id -> set de slug-uri de interese, pentru multe profiluri."""
    if not profile_ids:
        return {}
    result = await db.execute(
        select(ProfileInterest.profile_id, Interest.slug)
        .join(Interest, Interest.id == ProfileInterest.interest_id)
        .where(ProfileInterest.profile_id.in_(profile_ids))
    )
    mapping: dict[uuid.UUID, set[str]] = {}
    for profile_id, slug in result.all():
        mapping.setdefault(profile_id, set()).add(slug)
    return mapping


def _has_common_language(a: Profile, b: Profile) -> bool:
    """True dacă cele două profiluri au cel puțin o limbă comună (gate TZ 4.6)."""
    la = {str(x) for x in (a.languages or []) if x}
    lb = {str(x) for x in (b.languages or []) if x}
    return bool(la & lb)


async def get_feed(
    db: AsyncSession, user: User, limit: int | None = None
) -> list[FeedCard]:
    """Feed-ul de candidate pentru `user`, sortat descrescător după compatibilitate.

    Candidate = profiluri `completed`, exclus userul curent și cei deja swipe-uiți,
    din aceeași grupă de vârstă (16–17 vs 18+, TZ 2.3). Sunt excluși userii
    blocați (în orice direcție, I1), cei cu profil ascuns (I2) și cei fără nicio
    limbă comună (gate dur, I3 / TZ 4.6).
    """
    # Limita implicită vine din config (fără hardcodare).
    if limit is None:
        limit = settings.feed_limit

    # Profilul propriu — fără el nu putem calcula compatibilitate.
    my_result = await db.execute(select(Profile).where(Profile.user_id == user.id))
    my_profile = my_result.scalar_one_or_none()
    if my_profile is None or not my_profile.completed:
        return []

    my_group = _age_group(_calc_age(my_profile.birth_date))

    # Userii deja swipe-uiți de mine (nu-i mai arăt).
    swiped_result = await db.execute(
        select(Like.to_user_id).where(Like.from_user_id == user.id)
    )
    swiped_ids = {row[0] for row in swiped_result.all()}

    # I1 — userii blocați în ORICE direcție (blocat de mine SAU care m-a blocat).
    blocked_result = await db.execute(
        select(Block.blocker_id, Block.blocked_id).where(
            or_(Block.blocker_id == user.id, Block.blocked_id == user.id)
        )
    )
    blocked_ids: set[uuid.UUID] = set()
    for blocker_id, blocked_id in blocked_result.all():
        blocked_ids.add(blocked_id if blocker_id == user.id else blocker_id)

    # I2 — userii cu profilul ascuns (UserSettings.profile_hidden = True).
    hidden_result = await db.execute(
        select(UserSettings.user_id).where(UserSettings.profile_hidden.is_(True))
    )
    hidden_ids = {row[0] for row in hidden_result.all()}

    # Candidate: profiluri completate, nu eu, nu swipe-uiți, nu blocați, nu ascunși.
    # Anti-DoS: PLAFONĂM scanarea la nivel SQL (`.limit`) ca un feed să nu poată
    # forța încărcarea + procesarea întregii baze de profiluri (D1). Limita vine
    # din config (`feed_scan_limit`), nu hardcodată.
    excluded = swiped_ids | blocked_ids | hidden_ids | {user.id}
    cand_result = await db.execute(
        select(Profile)
        .where(
            Profile.completed.is_(True),
            Profile.user_id.notin_(excluded),
        )
        .limit(max(0, settings.feed_scan_limit))
    )
    candidates = list(cand_result.scalars().all())

    # Filtrare pe grupa de vârstă (calc din birth_date).
    candidates = [
        p for p in candidates if _age_group(_calc_age(p.birth_date)) == my_group
    ]
    # I3 — gate dur pe limbă: fără nicio limbă comună, candidatul e EXCLUS.
    candidates = [p for p in candidates if _has_common_language(my_profile, p)]
    if not candidates:
        return []

    # Interesele mele + ale candidaților (o singură interogare batch).
    profile_ids = [my_profile.id] + [p.id for p in candidates]
    interests_map = await _interests_by_profile(db, profile_ids)
    my_interests = interests_map.get(my_profile.id, set())

    # Calcul compatibilitate (fără I/O de rețea) + sortare, ÎNAINTE de geocoding.
    scored: list[tuple[int, Profile, set[str]]] = []
    for p in candidates:
        p_interests = interests_map.get(p.id, set())
        score = compute_compatibility(my_profile, p, my_interests, p_interests)
        scored.append((score, p, p_interests))

    # Sortare descrescătoare după compatibilitate, apoi tăiere la `limit`.
    scored.sort(key=lambda item: item[0], reverse=True)
    top = scored[: max(0, limit)]

    # Geocoding DOAR pentru cardurile efectiv returnate (anti-DoS, D1): nu mai
    # geocodăm toți candidații scanați, ci strict rezultatele afișate.
    cards: list[FeedCard] = []
    for score, p, p_interests in top:
        # Distanța reală prin geocoding (TZ 7). Robust: None dacă vreun oraș nu
        # poate fi geocodat (provider stub cu oraș necunoscut etc.).
        distance_km = await geo.distance_km_between(
            my_profile.city, my_profile.street, p.city, p.street
        )
        cards.append(
            FeedCard(
                user_id=p.user_id,
                name=p.name,
                age=_calc_age(p.birth_date),
                gender=p.gender,
                city=p.city,
                distance_km=distance_km,  # geocoding real (TZ 7); None dacă nu se poate
                about=p.about,
                top_interests=sorted(p_interests)[:MAX_TOP_INTERESTS],
                languages=list(p.languages or []),
                compatibility=score,
                photos=list(p.photos or []),
            )
        )
    return cards


async def _authorize_swipe(
    db: AsyncSession, user: User, target_user_id: uuid.UUID
) -> None:
    """Validează dreptul de a face swipe pe `target_user_id` (breșă critică).

    Reproduce controalele din `get_feed` la nivel de acțiune, ca ținta să nu
    poată fi lovită direct prin `POST /feed/swipe` ocolind feed-ul. Ridică
    HTTPException (403/404) la orice încălcare; 404 „neutru" acolo unde nu vrem
    să divulgăm existența/starea contului țintă.
    """
    # Self-match interzis (nu-ți poți da like ție însuți).
    if target_user_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Nu poți face swipe pe propriul profil.",
        )

    # Profilul propriu — necesar pentru grupa de vârstă; incomplet ⇒ interzis.
    my_result = await db.execute(select(Profile).where(Profile.user_id == user.id))
    my_profile = my_result.scalar_one_or_none()
    if my_profile is None or not my_profile.completed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Profilul tău nu este complet.",
        )

    # Profilul țintei — inexistent SAU incomplet ⇒ 404 (nu divulgăm starea).
    target_result = await db.execute(
        select(Profile).where(Profile.user_id == target_user_id)
    )
    target_profile = target_result.scalar_one_or_none()
    if target_profile is None or not target_profile.completed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Utilizator indisponibil."
        )

    # Age-gate (TZ 2.3): swipe DOAR în aceeași grupă (siguranța minorilor).
    my_group = _age_group(_calc_age(my_profile.birth_date))
    target_group = _age_group(_calc_age(target_profile.birth_date))
    if my_group != target_group:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Swipe interzis între grupe de vârstă diferite.",
        )

    # I1 — block în ORICE direcție (eu → el sau el → eu).
    block_result = await db.execute(
        select(Block.id).where(
            or_(
                and_(
                    Block.blocker_id == user.id,
                    Block.blocked_id == target_user_id,
                ),
                and_(
                    Block.blocker_id == target_user_id,
                    Block.blocked_id == user.id,
                ),
            )
        )
    )
    if block_result.first() is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Interacțiune blocată."
        )

    # I2 — profil ascuns ⇒ indisponibil pentru swipe (404 neutru).
    hidden_result = await db.execute(
        select(UserSettings.user_id).where(
            UserSettings.user_id == target_user_id,
            UserSettings.profile_hidden.is_(True),
        )
    )
    if hidden_result.first() is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Utilizator indisponibil."
        )


async def _enforce_daily_swipe_limit(db: AsyncSession, user: User) -> None:
    """Aplică limita de swipe/zi pentru useri non-premium (TZ 4.5).

    Premium (entitlement `premium`) = fără limită. Non-premium: numărăm Like-urile
    userului din ultimele 24h; la atingerea `settings.free_daily_swipe_limit`
    ridicăm 429 (Too Many Requests). Limita vine din config, nu hardcodată.
    """
    ent = await billing.entitlements(db, user)
    if ent.premium:
        return

    since = datetime.now(timezone.utc) - timedelta(hours=24)
    count_result = await db.execute(
        select(func.count())
        .select_from(Like)
        .where(Like.from_user_id == user.id, Like.created_at >= since)
    )
    used = int(count_result.scalar_one())
    if used >= settings.free_daily_swipe_limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Ai atins limita zilnică de swipe-uri. "
                "Treci pe Premium pentru swipe nelimitat."
            ),
        )


async def swipe(
    db: AsyncSession,
    user: User,
    target_user_id: uuid.UUID,
    action: str,
    message: str | None = None,
) -> SwipeResult:
    """Înregistrează un swipe; creează Match dacă like-ul e reciproc (TZ 4.4/4.7).

    Un `message` opțional se atașează like-ului (`deferred_message`) și devine
    vizibil ca mesaj de chat abia când swipe-ul produce un match reciproc (TZ 4.7).

    Securitate (breșă critică): `swipe` aplică ACELEAȘI controale ca feed-ul —
    age-gate (separarea minor/adult), block în orice direcție, profil ascuns,
    profil incomplet/inexistent și interdicția de self-match — ca ținta să nu
    poată fi swipe-uită direct, ocolind filtrele din `get_feed`.
    """
    # --- Age-gate + authz pe țintă (înainte de ORICE scriere) -----------------
    await _authorize_swipe(db, user, target_user_id)

    is_like = action == "like"
    # Mesajul deferred are sens doar pentru like (nu pentru dislike).
    deferred = message if (is_like and message) else None

    # Upsert Like direcțional (from user -> target).
    existing_result = await db.execute(
        select(Like).where(
            Like.from_user_id == user.id,
            Like.to_user_id == target_user_id,
        )
    )
    like = existing_result.scalar_one_or_none()
    if like is None:
        # Limită de swipe/zi pentru non-premium (TZ 4.5) — se aplică DOAR la un
        # swipe NOU (re-swipe pe același target nu consumă din cotă).
        await _enforce_daily_swipe_limit(db, user)
        like = Like(
            from_user_id=user.id,
            to_user_id=target_user_id,
            is_like=is_like,
            deferred_message=deferred,
        )
        db.add(like)
    else:
        like.is_like = is_like
        # Re-swipe cu mesaj nou îl actualizează; fără mesaj păstrăm ce era.
        if deferred is not None:
            like.deferred_message = deferred

    # Fără like nu poate exista match.
    if not is_like:
        await db.commit()
        return SwipeResult(matched=False, match_id=None)

    # Verifică like-ul reciproc (target -> user).
    reciprocal_result = await db.execute(
        select(Like).where(
            Like.from_user_id == target_user_id,
            Like.to_user_id == user.id,
            Like.is_like.is_(True),
        )
    )
    reciprocal = reciprocal_result.scalar_one_or_none()
    if reciprocal is None:
        await db.commit()
        return SwipeResult(matched=False, match_id=None)

    # Match! Stocăm perechea normalizată (idempotent).
    a_id, b_id = _normalized_pair(user.id, target_user_id)
    match_result = await db.execute(
        select(Match).where(Match.user_a_id == a_id, Match.user_b_id == b_id)
    )
    match = match_result.scalar_one_or_none()
    if match is None:
        match = Match(user_a_id=a_id, user_b_id=b_id)
        db.add(match)
        await db.flush()

    # La producerea unui match asigurăm (idempotent) un chat pentru el, ca
    # dialogul să existe imediat (TZ 4.7/5.1). Refolosim logica din chat_service.
    chat = await chat_service.ensure_chat_for_match(db, match)

    # Livrăm mesajele deferred: pentru fiecare like din pereche (A->B și B->A)
    # care are `deferred_message`, creăm un mesaj în chat de la autorul like-ului
    # și consumăm textul (îl golim ca să nu-l re-livrăm la un eventual re-swipe).
    await _deliver_deferred_messages(db, chat, like, reciprocal)

    await db.commit()
    return SwipeResult(matched=True, match_id=match.id, chat_id=chat.id)


async def _deliver_deferred_messages(
    db: AsyncSession,
    chat: Chat,
    *like_pair: Like,
) -> None:
    """Creează câte un `Message` pentru fiecare like cu `deferred_message` (TZ 4.7).

    Inserează direct prin modelul `Message` (fără commit — apelantul comite), dar
    APLICĂ mascarea contactelor (breșă: mesajul deferred ajungea în chat nemascat,
    permițând schimb de telefon/telegram/email la primul match, ocolind TZ 5.5).
    `was_masked` reflectă dacă s-a ascuns ceva. Textul e consumat după livrare.
    """
    for like in like_pair:
        if like is None or not like.deferred_message:
            continue
        masked_body, was_masked = mask_contacts(like.deferred_message)
        db.add(
            Message(
                chat_id=chat.id,
                sender_id=like.from_user_id,
                body=masked_body,
                was_masked=was_masked,
                is_read=False,
            )
        )
        # Consumăm mesajul ca să nu fie re-livrat la un swipe ulterior.
        like.deferred_message = None


async def undo_last_swipe(db: AsyncSession, user: User) -> UndoResult:
    """Anulează ULTIMUL swipe al userului (cel mai recent după created_at, TZ 4.4).

    Șterge acel `Like`; dacă producea un `Match`, șterge și match-ul + chat-ul
    asociat (ca să nu rămână orfan). Userul astfel „re-swipe-abil" reapare în feed.
    Fără niciun swipe → {undone: false, target_user_id: null}.
    """
    last_result = await db.execute(
        select(Like)
        .where(Like.from_user_id == user.id)
        .order_by(Like.created_at.desc(), Like.id.desc())
        .limit(1)
    )
    like = last_result.scalar_one_or_none()
    if like is None:
        return UndoResult(undone=False, target_user_id=None)

    target_user_id = like.to_user_id

    # Dacă exista un match cu perechea, îl demontăm (chat mai întâi, apoi match).
    a_id, b_id = _normalized_pair(user.id, target_user_id)
    match_result = await db.execute(
        select(Match).where(Match.user_a_id == a_id, Match.user_b_id == b_id)
    )
    match = match_result.scalar_one_or_none()
    if match is not None:
        # Chat-ul asociat (dacă există) — îl ștergem ca să nu rămână orfan.
        chat_result = await db.execute(
            select(Chat).where(Chat.match_id == match.id)
        )
        chat = chat_result.scalar_one_or_none()
        if chat is not None:
            # Ștergem explicit mesajele (SQLite nu forțează implicit CASCADE).
            msgs_result = await db.execute(
                select(Message).where(Message.chat_id == chat.id)
            )
            for msg in msgs_result.scalars().all():
                await db.delete(msg)
            await db.delete(chat)
        await db.delete(match)

    await db.delete(like)
    await db.commit()
    return UndoResult(undone=True, target_user_id=target_user_id)


async def get_matches(db: AsyncSession, user: User) -> list[MatchOut]:
    """Toate match-urile userului, cu datele celuilalt profil (TZ 4.7)."""
    result = await db.execute(
        select(Match).where(
            or_(Match.user_a_id == user.id, Match.user_b_id == user.id)
        )
    )
    matches = list(result.scalars().all())
    if not matches:
        return []

    # Profilul meu (pentru scorul de compatibilitate afișat).
    my_result = await db.execute(select(Profile).where(Profile.user_id == user.id))
    my_profile = my_result.scalar_one_or_none()

    # Id-urile "celuilalt" din fiecare match.
    other_ids: list[uuid.UUID] = []
    for m in matches:
        other = m.user_b_id if m.user_a_id == user.id else m.user_a_id
        other_ids.append(other)

    # Profilurile celorlalți, indexate după user_id.
    others_result = await db.execute(
        select(Profile).where(Profile.user_id.in_(other_ids))
    )
    profiles_by_user = {p.user_id: p for p in others_result.scalars().all()}

    # Interesele mele + ale celorlalți pentru scor.
    profile_ids = [p.id for p in profiles_by_user.values()]
    if my_profile is not None:
        profile_ids.append(my_profile.id)
    interests_map = await _interests_by_profile(db, profile_ids)
    my_interests = (
        interests_map.get(my_profile.id, set()) if my_profile is not None else set()
    )

    out: list[MatchOut] = []
    for m, other_id in zip(matches, other_ids):
        p = profiles_by_user.get(other_id)
        if p is None:
            continue  # profil șters/incomplet — sărim
        if my_profile is not None:
            score = compute_compatibility(
                my_profile, p, my_interests, interests_map.get(p.id, set())
            )
        else:
            score = 0
        out.append(
            MatchOut(
                match_id=m.id,
                user_id=p.user_id,
                name=p.name,
                age=_calc_age(p.birth_date),
                city=p.city,
                compatibility=score,
            )
        )
    return out

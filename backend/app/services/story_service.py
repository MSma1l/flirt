"""Logica modulului Stories (TZ secț. 11).

Poveștile expiră la 24h. Sunt vizibile autorului și utilizatorilor cu care
are Match. Cele expirate sunt mereu filtrate.
"""
from __future__ import annotations

import logging
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from fastapi import HTTPException, status
from sqlalchemy import and_, case, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.profile import Profile
from app.models.story import Story
from app.models.swipe import Match
from app.models.user import User
from app.schemas.story import (
    StoryIn,
    StoryOut,
    StoryPage,
    StoryReplyOut,
    UserStories,
    UserStoriesPage,
)
from app.services import chat_service, retention_service, tg_notify
from app.services.contact_masker import mask_contacts

# Aceleași reguli de vizibilitate ca centrul de activitate (o singură definiție).
from app.services.activity_service import _not_blocked, _not_hidden
from app.services.pagination import (
    STORIES_MAX_LIMIT,
    STORIES_PAGE_LIMIT,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)
from app.services.storage import LocalStorage, _relative_key, variant_keys_for


log = logging.getLogger("app.stories")

# Cheia unei poze de story, EXACT cum o generează upload-ul
# (`stories.py::_story_media_key`): `stories/{user_id}/{uuid hex}.{ext}`. Fără
# `..`, fără sufix de variantă, fără sub-directoare.
_STORY_KEY_RE = re.compile(
    r"^stories/(?P<uid>[0-9a-f-]{36})/[0-9a-f]{32}\.(?:jpg|jpeg|png|webp)$"
)

# Fișierele din `stories/` fără rând în DB mai vechi de atât sunt orfane (upload
# reușit, dar story-ul n-a mai fost publicat). Ora acoperă larg fluxul normal:
# upload → POST /stories/ vine în câteva secunde.
ORPHAN_STORY_MEDIA_MIN_AGE_S = 3600
_PURGE_BATCH = 500


# Contextul cu care pleacă un răspuns la story în chat. Fără el, destinatarul ar
# primi un „❤️" fără să știe la ce s-a răspuns (povestea expiră în 24h, mesajul nu).
STORY_REPLY_PREFIX = "↩️ A răspuns la povestea ta: "


def _to_story_out(story: Story) -> StoryOut:
    return StoryOut(
        id=story.id,
        user_id=story.user_id,
        media_url=story.media_url,
        media_type=story.media_type,
        caption=story.caption,
        created_at=story.created_at,
        expires_at=story.expires_at,
    )


def own_story_media_key(url: str, user_id: uuid.UUID) -> str | None:
    """Cheia de storage dacă `url` e o poză de story a LUI `user_id`; altfel None.

    Același tipar ca pozele de profil (`storage.key_from_own_url`): host + schemă
    din storage-ul propriu (`allowed_hosts()` / `allowed_schemes()`), apoi cheia
    trebuie să fie sub `stories/{user_id}/` și să arate exact ca una generată de
    upload. Fără query / fragment / credențiale în URL.
    """
    parsed = urlparse(url)
    if parsed.query or parsed.fragment or parsed.username or parsed.password:
        return None
    key = _relative_key(url)
    if key is None:
        return None
    match = _STORY_KEY_RE.match(key)
    if match is None or match.group("uid") != str(user_id):
        return None
    return key


async def create_story(db: AsyncSession, user: User, data: StoryIn) -> StoryOut:
    """Creează o poveste FOTO care expiră peste 24h; video → 422.

    Story-urile noi sunt doar poze: uploadul de video e refuzat în endpoint, iar aici
    închidem și a doua cale (`media_type='video'` cu un `media_url` arbitrar). Motivul
    e același — un video nu poate fi moderat automat (Apple Guideline 1.2), spre
    deosebire de poze, care trec prin `photo_moderation`.
    `media_type='video'` rămâne valid în schemă doar pentru poveștile deja existente
    în baza de date, ca vizualizatorul să le poată reda până expiră.
    """
    if data.media_type != "image":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Story-urile acceptă doar fotografii.",
        )
    # `media_url` DOAR din storage-ul nostru, sub `stories/{user.id}/` — adică
    # exact ce a întors `POST /stories/media` (care trece prin moderarea NSFW).
    # Un URL arbitrar ar ocoli moderarea și ar face browserul FIECĂRUI match să
    # ceară o resursă de pe serverul atacatorului (scurgere de IP / tracking).
    if own_story_media_key(data.media_url, user.id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="media_url trebuie să fie o poză încărcată prin /stories/media.",
        )

    # Durata de viață a poveștii vine din config (TZ secț. 11), fără hardcodare.
    story = Story(
        user_id=user.id,
        media_url=data.media_url,
        media_type=data.media_type,
        # Ca la „despre" din profil: contactele nu ies din aplicație prin story.
        caption=mask_contacts(data.caption)[0] if data.caption else data.caption,
        expires_at=datetime.now(timezone.utc)
        + timedelta(hours=settings.story_ttl_hours),
    )
    db.add(story)
    await db.commit()
    await db.refresh(story)
    # Match-urile autorului află din botul Telegram (în fundal, după commit;
    # max 1 notificare / autor / destinatar / 6h — vezi `tg_notify`).
    tg_notify.notify_story(author_id=user.id)
    return _to_story_out(story)


async def _match_user_ids(db: AsyncSession, user: User) -> set[uuid.UUID]:
    """Id-urile match-urilor ale căror povești userul curent are voie să le vadă.

    Un match nu e suficient: excludem blocările (ORICARE direcție — cine a blocat
    pe cineva nu-i mai vede poveștile și nici nu i le mai arată), conturile
    banate / șterse și profilurile ascunse — aceleași reguli ca la activitate.
    """
    other = case((Match.user_a_id == user.id, Match.user_b_id), else_=Match.user_a_id)
    result = await db.execute(
        select(other)
        .select_from(Match)
        .join(User, User.id == other)
        .where(
            or_(Match.user_a_id == user.id, Match.user_b_id == user.id),
            User.deleted_at.is_(None),
            User.banned_at.is_(None),
            _not_blocked(user.id, other),
            _not_hidden(other),
        )
    )
    return {uid for (uid,) in result.all()}


async def list_active_grouped(
    db: AsyncSession,
    user: User,
    limit: int | None = None,
    cursor: str | None = None,
) -> UserStoriesPage:
    """Poveștile active proprii + ale match-urilor, grupate pe user (paginat).

    Sortare (neschimbată): userul curent primul, apoi ceilalți după cea mai
    recentă poveste, desc.

    Înainte încărca TOATE poveștile active ale TUTUROR match-urilor, fără nicio
    limită. Acum paginăm la nivel de USER (cursorul e ancorat de ultimul grup
    redat), deci un grup nu se rupe între pagini și un user nu poate apărea de
    două ori. Numărul de query-uri e constant (4), indiferent de câte grupuri.
    """
    now = datetime.now(timezone.utc)
    limit = clamp_limit(limit, STORIES_PAGE_LIMIT, STORIES_MAX_LIMIT)
    visible_ids = {user.id} | await _match_user_ids(db, user)

    # Cheia de sortare a unui GRUP: (userul curent primul, cea mai recentă
    # poveste desc, user_id desc — tiebreak determinist).
    me_first = case((Story.user_id == user.id, 0), else_=1)
    last_at = func.max(Story.created_at)

    groups_stmt = (
        select(Story.user_id, last_at.label("last_at"))
        .where(Story.user_id.in_(visible_ids), Story.expires_at > now)
        .group_by(Story.user_id)
    )

    if cursor:
        anchor_uid = decode_cursor(cursor)
        if anchor_uid == user.id:
            # Grupul propriu e mereu primul → după el vin exact toți ceilalți.
            groups_stmt = groups_stmt.where(Story.user_id != user.id)
        else:
            # Momentul ultimei povești a grupului-ancoră, citit DB-side.
            anchor_at = (
                select(func.max(Story.created_at))
                .where(Story.user_id == anchor_uid, Story.expires_at > now)
                .scalar_subquery()
            )
            groups_stmt = groups_stmt.where(Story.user_id != user.id).having(
                or_(
                    last_at < anchor_at,
                    and_(last_at == anchor_at, Story.user_id < anchor_uid),
                )
            )

    groups_result = await db.execute(
        groups_stmt.order_by(me_first, last_at.desc(), Story.user_id.desc()).limit(
            limit + 1
        )
    )
    group_rows = list(groups_result.all())

    has_more = len(group_rows) > limit
    group_rows = group_rows[:limit]
    if not group_rows:
        return UserStoriesPage(items=[], next_cursor=None)

    ordered_ids = [row.user_id for row in group_rows]
    next_cursor = encode_cursor(ordered_ids[-1]) if has_more else None

    # Poveștile grupurilor din PAGINA curentă (o singură interogare).
    stories_result = await db.execute(
        select(Story)
        .where(Story.user_id.in_(ordered_ids), Story.expires_at > now)
        .order_by(Story.created_at.desc(), Story.id.desc())
    )
    grouped: dict[uuid.UUID, list[Story]] = {}
    for story in stories_result.scalars().all():
        grouped.setdefault(story.user_id, []).append(story)

    names = await _display_names(db, set(ordered_ids))

    return UserStoriesPage(
        items=[
            UserStories(
                user_id=uid,
                name=names.get(uid, ""),
                story_count=len(grouped.get(uid, [])),
                stories=[_to_story_out(s) for s in grouped.get(uid, [])],
            )
            for uid in ordered_ids
        ],
        next_cursor=next_cursor,
    )


async def list_mine(
    db: AsyncSession,
    user: User,
    limit: int | None = None,
    cursor: str | None = None,
) -> StoryPage:
    """Poveștile active proprii, cea mai recentă prima (paginat pe cursor)."""
    now = datetime.now(timezone.utc)
    limit = clamp_limit(limit, STORIES_PAGE_LIMIT, STORIES_MAX_LIMIT)

    stmt = select(Story).where(Story.user_id == user.id, Story.expires_at > now)
    if cursor:
        anchor_id = decode_cursor(cursor)
        # Momentul poveștii-ancoră, citit DB-side (vezi pagination.py).
        anchor_at = (
            select(Story.created_at)
            .where(Story.id == anchor_id, Story.user_id == user.id)
            .scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                Story.created_at < anchor_at,
                and_(Story.created_at == anchor_at, Story.id < anchor_id),
            )
        )

    # Ordonare TOTALĂ (created_at, id) → fără duplicate / fără povești sărite.
    result = await db.execute(
        stmt.order_by(Story.created_at.desc(), Story.id.desc()).limit(limit + 1)
    )
    rows = list(result.scalars().all())

    has_more = len(rows) > limit
    rows = rows[:limit]
    return StoryPage(
        items=[_to_story_out(s) for s in rows],
        next_cursor=encode_cursor(rows[-1].id) if (has_more and rows) else None,
    )


async def delete_story(db: AsyncSession, user: User, story_id: uuid.UUID) -> None:
    """Șterge o poveste proprie. 404 dacă lipsește, 403 dacă e a altcuiva."""
    story = await db.get(Story, story_id)
    if story is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Story not found"
        )
    if story.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not your story"
        )
    media_url = story.media_url
    await db.delete(story)
    await db.commit()
    # Fișierul (+ variantele `_256.webp`) pleacă odată cu rândul — altfel o poveste
    # „ștearsă" rămânea publică pe disc/S3 la nesfârșit (GDPR art. 17). DUPĂ commit:
    # dacă ștergerea fișierului pică, rândul e deja șters, iar fișierul orfan îl
    # prinde măturarea periodică (`purge_orphan_story_media`).
    await retention_service.delete_files(await _unreferenced(db, [media_url]))


async def reply_to_story(
    db: AsyncSession, user: User, story_id: uuid.UUID, body: str
) -> StoryReplyOut:
    """Răspunde la povestea cuiva → un MESAJ în chatul match-ului (TZ 5.5 + 11).

    DE CE reutilizăm chatul, nu inventăm o mesagerie paralelă: o poveste e
    vizibilă DOAR autorului și match-urilor lui (`list_active_grouped`), deci
    oricine poate răspunde are deja un chat cu autorul. Așa răspunsul intră în
    aceeași conversație, cu aceleași reguli (mascare contacte, blocări, necitite).

    Mesajul e PREFIXAT cu contextul poveștii — altfel destinatarul primește un
    emoji fără să știe la ce s-a răspuns.

    404 dacă povestea nu există, a expirat sau nu e vizibilă pentru user (nu
    divulgăm existența poveștilor străine). 422 la propria poveste.
    """
    story = await db.get(Story, story_id)
    if story is None or story.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Story not found"
        )

    if story.user_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nu poți răspunde la propria poveste.",
        )

    # Vizibilitatea (deci și dreptul de a răspunde) = exact regula de la listare:
    # doar match-urile văd povestea. Fără match → 404, ca la o poveste inexistentă.
    result = await db.execute(
        select(Match).where(
            or_(
                and_(Match.user_a_id == user.id, Match.user_b_id == story.user_id),
                and_(Match.user_a_id == story.user_id, Match.user_b_id == user.id),
            )
        )
    )
    match = result.scalar_one_or_none()
    if match is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Story not found"
        )

    # Chatul match-ului (idempotent — normal există deja, creat la match).
    chat = await chat_service.ensure_chat_for_match(db, match)
    # `send_message` comite și aplică restul regulilor (blocare, mascare contacte).
    message = await chat_service.send_message(
        db, user, chat.id, f"{STORY_REPLY_PREFIX}{body}"
    )
    return StoryReplyOut(chat_id=chat.id, message=message)


async def _display_names(
    db: AsyncSession, user_ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """Numele de afișare (din Profile) pentru un set de useri."""
    if not user_ids:
        return {}
    result = await db.execute(
        select(Profile.user_id, Profile.name).where(Profile.user_id.in_(user_ids))
    )
    return {uid: name for uid, name in result.all()}


# --- Purjarea periodică (serviciul `purge`, `scripts/gdpr_purge.py`) ----------


async def _unreferenced(db: AsyncSession, urls: list[str]) -> list[str]:
    """URL-urile pe care NICIO poveste rămasă nu le mai folosește.

    Același upload poate fi publicat de două ori (reîncercare din client); fără
    verificarea asta, ștergerea/expirarea primei povești ar lăsa-o pe a doua fără
    poză.
    """
    if not urls:
        return []
    still_used = set(
        (
            await db.execute(
                select(Story.media_url).where(Story.media_url.in_(set(urls)))
            )
        ).scalars()
    )
    return [u for u in dict.fromkeys(urls) if u not in still_used]


async def purge_expired_stories(db: AsyncSession) -> int:
    """Șterge poveștile EXPIRATE: rândul + fișierul (+ variantele). Întoarce câte.

    Poveștile expiră la 24h, dar până acum rămâneau în DB și pe disc pentru
    totdeauna. În loturi, ca o restanță mare să nu țină o tranzacție uriașă.
    Rândul se șterge întâi (commit), apoi fișierele — dacă o ștergere de fișier
    pică, îl prinde `purge_orphan_story_media` la o trecere următoare.
    """
    now = datetime.now(timezone.utc)
    total = 0
    while True:
        rows = (
            await db.execute(
                select(Story.id, Story.media_url)
                .where(Story.expires_at <= now)
                .order_by(Story.expires_at)
                .limit(_PURGE_BATCH)
            )
        ).all()
        if not rows:
            break
        await db.execute(delete(Story).where(Story.id.in_([r.id for r in rows])))
        await db.commit()
        await retention_service.delete_files(
            await _unreferenced(db, [r.media_url for r in rows])
        )
        total += len(rows)
        if len(rows) < _PURGE_BATCH:
            break
    return total


async def purge_orphan_story_media(
    db: AsyncSession, min_age_s: int = ORPHAN_STORY_MEDIA_MIN_AGE_S
) -> int:
    """Șterge fișierele din `stories/` fără rând `Story`, mai vechi de `min_age_s`.

    Cazul: poza a trecut de `POST /stories/media` (salvată), dar story-ul n-a mai
    fost publicat — sau ștergerea fișierului la `delete_story` a eșuat. Ieftin
    DOAR pe providerul `local` (producția): listăm directorul de pe disc. Pe S3 /
    stub nu facem nimic (listarea bucketului ar costa cereri; vezi raportul).
    """
    if settings.storage_provider != "local":
        return 0
    root = LocalStorage()._root() / "stories"
    if not root.is_dir():
        return 0

    referenced: set[str] = set()
    result = await db.execute(select(Story.media_url))
    for (url,) in result.all():
        # Cheia din PATH, nu prin `_relative_key`: dacă `storage_base_url` s-a
        # schimbat între timp (alt domeniu), URL-urile vechi n-ar mai fi
        # recunoscute ca „ale noastre" și fișierele unor povești ACTIVE ar fi
        # tratate drept orfane. Aici greșeala trebuie să fie spre păstrare.
        path = urlparse(url or "").path
        idx = path.find("/stories/")
        if idx == -1:
            continue
        key = path[idx + 1 :]
        referenced.add(key)
        referenced.update(variant_keys_for(key))

    cutoff = time.time() - min_age_s
    removed = 0
    base = root.parent
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            path = os.path.join(dirpath, name)
            key = os.path.relpath(path, base).replace(os.sep, "/")
            if key in referenced:
                continue
            try:
                if os.path.getmtime(path) > cutoff:
                    continue  # upload recent: story-ul poate fi încă în curs
                os.unlink(path)
                removed += 1
            except OSError:
                log.warning("stories: fișier orfan imposibil de șters: %s", key)
    return removed

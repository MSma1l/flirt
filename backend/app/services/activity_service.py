"""Centrul de activitate: statistici + cronologia „ce s-a întâmplat cu profilul meu".

SURSE (fără tabel de notificări duplicat):
  - like / super like primit → `likes` (`to_user_id = eu`, `is_like = True`);
  - match nou                → `matches` (eu în pereche);
  - vizualizări de profil    → `profile_views`, AGREGATE pe zi („5 oameni ți-au
                               văzut profilul azi") — niciodată cine, doar câți.
Dislike-urile apar DOAR ca număr în statistici, niciodată în listă și niciodată
cu identitatea autorului.

Starea „citit" e un semn de carte per user (`ActivityReadMark.last_read_at`):
tot ce e mai nou decât el e necitit. Necititele sunt COUNT-uri pe index.

IDENTITATEA celor care ți-au dat like urmează EXACT regula din
`GET /social/likes/received` (`social_service.list_likes_received`): e vizibilă
oricui, fără paywall (nu există nicio poartă de abonament pe ea, iar plățile
sunt oricum inactive în Telegram — `capabilities.payments`). Aceleași excluderi
ca acolo: block în orice direcție, profil ascuns, cont banat / purjat GDPR.

PAGINARE: lista amestecă trei surse, deci cursorul e peste ordinea totală
`(occurred_at DESC, rank DESC, id DESC)`. Fiecare sursă aduce cel mult
`limit + 1` rânduri pe indexul ei (keyset, fără OFFSET), apoi le interclasăm în
Python — trei query-uri mici, oricât de lungă ar fi istoria.
"""
from __future__ import annotations

import base64
import binascii
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import and_, case, distinct, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Block, UserSettings
from app.models.activity import ActivityReadMark, ProfileView
from app.models.chat import Chat
from app.models.profile import Profile
from app.models.swipe import Like, Match
from app.models.user import User
from app.schemas.notifications import (
    ActivityActor,
    ActivityItem,
    ActivityPage,
    ActivityStats,
)
from app.services.pagination import SOCIAL_MAX_LIMIT, SOCIAL_PAGE_LIMIT, clamp_limit
from app.services.social_service import _calc_age

# Rangul departajează evenimentele cu ACELAȘI moment: like-ul care produce un
# match și match-ul se scriu în aceeași tranzacție (același `now()`), iar
# match-ul, fiind consecința, trebuie să stea deasupra.
_RANK_MATCH = 3
_RANK_LIKE = 2
_RANK_VIEWS = 1

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_MICRO = timedelta(microseconds=1)


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


# --- Înregistrarea vizualizărilor -------------------------------------------
async def record_profile_view(
    db: AsyncSession, viewer_id: uuid.UUID, viewed_id: uuid.UUID
) -> None:
    """Notează că `viewer` a văzut profilul lui `viewed` azi. NU comite.

    Idempotent prin baza de date: `ON CONFLICT DO NOTHING` pe
    `uq_profile_view_daily`, deci a doua vizualizare din aceeași zi nu scrie
    nimic și nu poate produce o cursă între două cereri paralele.
    """
    if viewer_id == viewed_id:
        return
    await db.execute(
        pg_insert(ProfileView)
        .values(
            id=uuid.uuid4(),
            viewer_id=viewer_id,
            viewed_id=viewed_id,
            view_date=_today_utc(),
        )
        .on_conflict_do_nothing(
            index_elements=["viewer_id", "viewed_id", "view_date"]
        )
    )


async def record_profile_open(
    db: AsyncSession, viewer: User, viewed_id: uuid.UUID
) -> None:
    """Vizualizare din DETALIU (anketa deschisă). Comite.

    Ținta trebuie să existe, să nu fie banată / purjată și să nu fie în block
    cu viewerul (în orice direcție). Orice abatere e ignorată în TĂCERE: ruta
    răspunde la fel, ca să nu devină un oracol „există / m-a blocat".
    """
    if viewer.id == viewed_id:
        return
    blocked = (
        select(Block.id)
        .where(
            or_(
                and_(Block.blocker_id == viewer.id, Block.blocked_id == viewed_id),
                and_(Block.blocker_id == viewed_id, Block.blocked_id == viewer.id),
            )
        )
        .exists()
    )
    target = await db.execute(
        select(User.id).where(
            User.id == viewed_id,
            User.deleted_at.is_(None),
            User.banned_at.is_(None),
            ~blocked,
        )
    )
    if target.scalar_one_or_none() is None:
        return
    await record_profile_view(db, viewer.id, viewed_id)
    await db.commit()


# --- Excluderi comune (aliniate cu `list_likes_received`) -------------------
def _not_blocked(me: uuid.UUID, other):
    return ~(
        select(Block.id)
        .where(
            or_(
                and_(Block.blocker_id == me, Block.blocked_id == other),
                and_(Block.blocker_id == other, Block.blocked_id == me),
            )
        )
        .exists()
    )


def _not_hidden(other):
    return ~(
        select(UserSettings.id)
        .where(
            UserSettings.user_id == other,
            UserSettings.profile_hidden.is_(True),
        )
        .exists()
    )


def _other_in_match(me: uuid.UUID):
    """Celălalt user dintr-un match (perechea e stocată normalizat)."""
    return case((Match.user_a_id == me, Match.user_b_id), else_=Match.user_a_id)


def _likes_base(me: uuid.UUID):
    """Like-urile primite, vizibile (cu actor valid). Fără SELECT-ul coloanelor."""
    return (
        select()
        .select_from(Like)
        .join(Profile, Profile.user_id == Like.from_user_id)
        .join(User, User.id == Like.from_user_id)
        .where(
            Like.to_user_id == me,
            Like.is_like.is_(True),
            User.deleted_at.is_(None),
            User.banned_at.is_(None),
            _not_blocked(me, Like.from_user_id),
            _not_hidden(Like.from_user_id),
        )
    )


def _matches_base(me: uuid.UUID):
    other = _other_in_match(me)
    return (
        select()
        .select_from(Match)
        .join(Profile, Profile.user_id == other)
        .join(User, User.id == other)
        .where(
            or_(Match.user_a_id == me, Match.user_b_id == me),
            User.deleted_at.is_(None),
            User.banned_at.is_(None),
            _not_blocked(me, other),
        )
    )


# --- Cursor ------------------------------------------------------------------
@dataclass(frozen=True)
class _Cursor:
    at: datetime
    rank: int
    key: str


def _encode_cursor(at: datetime, rank: int, key: str) -> str:
    micros = (at - _EPOCH) // _MICRO
    raw = f"{micros}.{rank}.{key}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _bad_cursor(exc: Exception | None = None) -> HTTPException:
    error = HTTPException(
        status_code=422, detail="Invalid cursor"
    )
    if exc is not None:
        error.__cause__ = exc
    return error


def _decode_cursor(cursor: str) -> _Cursor:
    """Cursor → (moment, rang, cheie). 422 la orice formă stricată/fabricată."""
    try:
        padding = "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(cursor + padding).decode()
        micros_s, rank_s, key = raw.split(".", 2)
        rank = int(rank_s)
        at = _EPOCH + int(micros_s) * _MICRO
    except (ValueError, UnicodeDecodeError, binascii.Error, OverflowError) as exc:
        raise _bad_cursor(exc) from exc
    if rank not in (_RANK_MATCH, _RANK_LIKE, _RANK_VIEWS):
        raise _bad_cursor()
    # Cheia se validează după tipul sursei ei: nimic neparsat nu ajunge în SQL.
    try:
        if rank == _RANK_VIEWS:
            date.fromisoformat(key)
        else:
            uuid.UUID(key)
    except ValueError as exc:
        raise _bad_cursor(exc) from exc
    return _Cursor(at=at, rank=rank, key=key)


def _after(cur: _Cursor | None, rank: int, at_col, key_col, key_value):
    """Condiția keyset „strict după cursor" pentru o sursă cu rangul `rank`.

    Ordinea totală e (moment, rang, cheie) descrescător. Pentru o sursă cu rang
    FIX, comparația pe rang se rezolvă aici, în Python: rang mai mic ⇒ momentul
    egal e încă „după"; rang mai mare ⇒ doar momentele strict mai vechi.
    """
    if cur is None:
        return None
    if rank < cur.rank:
        return at_col <= cur.at
    if rank > cur.rank:
        return at_col < cur.at
    return or_(at_col < cur.at, and_(at_col == cur.at, key_col < key_value))


def _actor(user_id: uuid.UUID, name: str, birth_date: date, photos) -> ActivityActor:
    photo_list = list(photos or [])
    return ActivityActor(
        user_id=user_id,
        name=name,
        age=_calc_age(birth_date),
        photo=photo_list[0] if photo_list else None,
    )


# --- Citiri ------------------------------------------------------------------
async def _read_mark(db: AsyncSession, user: User) -> datetime | None:
    result = await db.execute(
        select(ActivityReadMark.last_read_at).where(
            ActivityReadMark.user_id == user.id
        )
    )
    return result.scalar_one_or_none()


async def get_stats(db: AsyncSession, user: User) -> ActivityStats:
    """Toate contoarele într-un SINGUR round-trip (subinterogări scalare).

    Fiecare COUNT lovește un index care începe cu userul curent
    (`ix_likes_to_user_created`, `ix_profile_views_viewed_date`, indexurile pe
    `matches.user_a_id` / `user_b_id`). Contoarele sunt brute, ca un total:
    numără tot ce s-a întâmplat, nu doar ce mai e afișabil azi.
    """
    me = user.id
    week_start = _today_utc() - timedelta(days=6)

    def likes_count(*conds):
        return (
            select(func.count(Like.id))
            .where(Like.to_user_id == me, *conds)
            .scalar_subquery()
        )

    views_total = (
        select(func.count(ProfileView.id))
        .where(ProfileView.viewed_id == me)
        .scalar_subquery()
    )
    views_week = (
        select(func.count(ProfileView.id))
        .where(ProfileView.viewed_id == me, ProfileView.view_date >= week_start)
        .scalar_subquery()
    )
    matches = (
        select(func.count(Match.id))
        .where(or_(Match.user_a_id == me, Match.user_b_id == me))
        .scalar_subquery()
    )
    row = (
        await db.execute(
            select(
                views_total,
                views_week,
                likes_count(Like.is_like.is_(True), Like.is_super.is_(False)),
                likes_count(Like.is_super.is_(True)),
                likes_count(Like.is_like.is_(False)),
                matches,
            )
        )
    ).one()
    return ActivityStats(
        views_total=row[0] or 0,
        views_last_7_days=row[1] or 0,
        likes=row[2] or 0,
        super_likes=row[3] or 0,
        dislikes=row[4] or 0,
        matches=row[5] or 0,
    )


async def unread_count(db: AsyncSession, user: User) -> int:
    """Câte elemente din listă sunt mai noi decât semnul de citire.

    Numără EXACT ce ar apărea necitit în listă (aceleași excluderi), ca badge-ul
    să nu promită ceva ce ecranul nu arată. O zi cu vizualizări noi = 1.
    """
    me = user.id
    mark = await _read_mark(db, user)

    likes_q = _likes_base(me).with_only_columns(func.count(Like.id))
    matches_q = _matches_base(me).with_only_columns(func.count(Match.id))
    views_q = select(func.count(distinct(ProfileView.view_date))).where(
        ProfileView.viewed_id == me
    )
    if mark is not None:
        likes_q = likes_q.where(Like.created_at > mark)
        matches_q = matches_q.where(Match.created_at > mark)
        views_q = views_q.where(ProfileView.created_at > mark)

    row = (
        await db.execute(
            select(
                likes_q.scalar_subquery(),
                matches_q.scalar_subquery(),
                views_q.scalar_subquery(),
            )
        )
    ).one()
    return int((row[0] or 0) + (row[1] or 0) + (row[2] or 0))


async def list_activity(
    db: AsyncSession,
    user: User,
    limit: int | None = None,
    cursor: str | None = None,
) -> ActivityPage:
    """O pagină din cronologie (cele mai noi primele) + statistici + necitite.

    Statisticile vin DOAR pe prima pagină (fără cursor): paginile următoare
    sunt derulare, nu reîncărcare, și n-au de ce să refacă agregările.
    """
    limit = clamp_limit(limit, SOCIAL_PAGE_LIMIT, SOCIAL_MAX_LIMIT)
    cur = _decode_cursor(cursor) if cursor else None
    me = user.id
    mark = await _read_mark(db, user)

    # (moment, rang, cheie comparabilă, ActivityItem fără `is_read`)
    entries: list[tuple[datetime, int, object, ActivityItem]] = []

    # --- Like-uri și super like-uri primite ---------------------------------
    likes_q = _likes_base(me).with_only_columns(
        Like.id,
        Like.created_at,
        Like.is_super,
        Profile.user_id,
        Profile.name,
        Profile.birth_date,
        Profile.photos,
    )
    cond = _after(
        cur,
        _RANK_LIKE,
        Like.created_at,
        Like.id,
        uuid.UUID(cur.key) if cur and cur.rank == _RANK_LIKE else None,
    )
    if cond is not None:
        likes_q = likes_q.where(cond)
    likes_q = likes_q.order_by(Like.created_at.desc(), Like.id.desc()).limit(limit + 1)
    for like_id, at, is_super, uid, name, birth, photos in (await db.execute(likes_q)).all():
        entries.append(
            (
                at,
                _RANK_LIKE,
                like_id,
                ActivityItem(
                    id=f"like:{like_id}",
                    kind="super_like" if is_super else "like",
                    occurred_at=at,
                    is_read=False,
                    actor=_actor(uid, name, birth, photos),
                ),
            )
        )

    # --- Match-uri ------------------------------------------------------------
    matches_q = (
        _matches_base(me)
        .outerjoin(Chat, Chat.match_id == Match.id)
        .with_only_columns(
            Match.id,
            Match.created_at,
            Chat.id,
            Profile.user_id,
            Profile.name,
            Profile.birth_date,
            Profile.photos,
        )
    )
    cond = _after(
        cur,
        _RANK_MATCH,
        Match.created_at,
        Match.id,
        uuid.UUID(cur.key) if cur and cur.rank == _RANK_MATCH else None,
    )
    if cond is not None:
        matches_q = matches_q.where(cond)
    matches_q = matches_q.order_by(Match.created_at.desc(), Match.id.desc()).limit(
        limit + 1
    )
    for match_id, at, chat_id, uid, name, birth, photos in (
        await db.execute(matches_q)
    ).all():
        entries.append(
            (
                at,
                _RANK_MATCH,
                match_id,
                ActivityItem(
                    id=f"match:{match_id}",
                    kind="match",
                    occurred_at=at,
                    is_read=False,
                    actor=_actor(uid, name, birth, photos),
                    chat_id=chat_id,
                ),
            )
        )

    # --- Vizualizări, agregate pe zi -----------------------------------------
    last_view = func.max(ProfileView.created_at)
    views_q = (
        select(ProfileView.view_date, last_view, func.count(ProfileView.id))
        .where(ProfileView.viewed_id == me)
        .group_by(ProfileView.view_date)
    )
    cond = _after(
        cur,
        _RANK_VIEWS,
        last_view,
        ProfileView.view_date,
        date.fromisoformat(cur.key) if cur and cur.rank == _RANK_VIEWS else None,
    )
    if cond is not None:
        views_q = views_q.having(cond)
    views_q = views_q.order_by(last_view.desc(), ProfileView.view_date.desc()).limit(
        limit + 1
    )
    for day, at, count in (await db.execute(views_q)).all():
        entries.append(
            (
                at,
                _RANK_VIEWS,
                day,
                ActivityItem(
                    id=f"views:{day.isoformat()}",
                    kind="views",
                    occurred_at=at,
                    is_read=False,
                    count=count,
                ),
            )
        )

    # --- Interclasare pe ordinea totală -----------------------------------
    # Cheile se compară doar între elemente de ACELAȘI rang (aceeași sursă),
    # deci tipurile (UUID / date) nu se amestecă niciodată.
    entries.sort(key=lambda e: (e[0], e[1], e[2]), reverse=True)
    has_more = len(entries) > limit
    page = entries[:limit]

    items: list[ActivityItem] = []
    for at, _rank, _key, item in page:
        item.is_read = mark is not None and at <= mark
        items.append(item)

    next_cursor = None
    if has_more and page:
        at, rank, key, _item = page[-1]
        key_str = key.isoformat() if isinstance(key, date) else str(key)
        next_cursor = _encode_cursor(at, rank, key_str)

    stats = await get_stats(db, user) if cur is None else None
    return ActivityPage(
        stats=stats,
        items=items,
        next_cursor=next_cursor,
        unread=await unread_count(db, user),
    )


# --- Scriere: marcare citit --------------------------------------------------
async def mark_read(
    db: AsyncSession, user: User, up_to: datetime | None = None
) -> int:
    """Mută semnul de citire la `up_to` (implicit: acum). Întoarce necititele.

    `up_to` = momentul celui mai nou element pe care clientul l-a AFIȘAT: un like
    sosit între încărcarea listei și apăsare rămâne necitit, nu se pierde. Semnul
    nu se mută niciodată înapoi (`GREATEST`) și nici în viitor (plafonat la acum).
    """
    now = datetime.now(timezone.utc)
    if up_to is not None and up_to.tzinfo is None:
        up_to = up_to.replace(tzinfo=timezone.utc)
    target = now if up_to is None else min(up_to, now)
    stmt = pg_insert(ActivityReadMark).values(
        id=uuid.uuid4(), user_id=user.id, last_read_at=target
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["user_id"],
        set_={
            "last_read_at": func.greatest(
                ActivityReadMark.last_read_at, stmt.excluded.last_read_at
            ),
            "updated_at": func.now(),
        },
    )
    await db.execute(stmt)
    await db.commit()
    return await unread_count(db, user)

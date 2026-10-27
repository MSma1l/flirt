"""Feed în TREPTE + TRECERI: profiluri potrivite, în ordine, fără repetări.

Ordinea: strict → relaxed (în afara razei sau inactiv), în fiecare treaptă
scorul de ranking DESCRESCĂTOR. Genul și vârsta sunt filtre DURE și RECIPROCE
(vezi `test_feed_ranking.py`) — nu mai există treapta `other_gender`. TRECERI:
un dislike exclude până la sfârșitul trecerii curente; când toți au fost văzuți,
feed-ul o ia de la capăt (dislike-urile revin ca `second_chance`, like-urile /
match-urile nu). Gate-urile DURE (profil complet, 18+, poze, self, block, ban,
ascuns, șters, like/match deja dat) se aplică în TOATE treptele. Testele
apelează serviciul direct (fixturi în DB), ca în `test_feed_service_unit.py`.

Pauza de reciclare (`feed_recycle_cooldown_hours`) e OPRITĂ aici, ca testele de
mecanică a trecerilor să nu depindă de ceas; e testată separat, în
`test_feed_ranking.py`.
"""
from __future__ import annotations

import base64
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import event, func, select, update

from app.core.config import settings
from app.core.security import hash_password
from app.models.account import Block, UserSettings
from app.models.profile import Profile
from app.models.swipe import Like, Match
from app.models.user import User
from app.services import feed_service as F
from app.services import tg_notify
from app.services.humor_service import HUMOR_TYPES

# Chișinău (eu) și București (~350 km — în afara razei implicite de 50 km).
NEAR = (47.0, 28.8)
FAR = (44.43, 26.10)


# --------------------------------------------------------------------------- #
# Fixturi
# --------------------------------------------------------------------------- #
@pytest.fixture(autouse=True)
def _no_recycle_cooldown(monkeypatch):
    """Reciclare imediată: testele de aici verifică mecanica trecerilor."""
    monkeypatch.setattr(settings, "feed_recycle_cooldown_hours", 0)


async def _user(db, email: str) -> User:
    user = User(email=email, password_hash=hash_password("Str0ng-Passw0rd!"))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _profile(
    db,
    user: User,
    *,
    gender: str = "female",
    age: int = 25,
    where: tuple[float, float] = NEAR,
    photos: int | None = None,
    completed: bool = True,
    languages: list[str] | None = None,
    statuses: list[str] | None = None,
) -> Profile:
    n_photos = settings.min_photos if photos is None else photos
    profile = Profile(
        user_id=user.id,
        name=f"P-{user.email.split('@')[0]}",
        birth_date=date(date.today().year - age, 1, 1),
        gender=gender,
        height_cm=170,
        city="Chișinău",
        lat=where[0],
        lng=where[1],
        languages=languages or ["ro"],
        dating_statuses=statuses or ["serious"],
        photos=[f"https://cdn.flirt.local/{user.id}/{i}.jpg" for i in range(n_photos)],
        humor_vector={t: 1.0 / len(HUMOR_TYPES) for t in HUMOR_TYPES},
        completed=completed,
    )
    db.add(profile)
    await db.commit()
    return profile


async def _person(db, email: str, **kwargs) -> User:
    user = await _user(db, email)
    await _profile(db, user, **kwargs)
    return user


async def _me(db, *, interested_in=("female",), age_min=20, age_max=30) -> User:
    """Eu: bărbat, 30 ani, caut femei 20–30 ani pe o rază de 50 km."""
    me = await _person(db, "me@example.com", gender="male", age=30)
    db.add(
        UserSettings(
            user_id=me.id,
            search_radius_km=50,
            interested_in=list(interested_in),
            age_min=age_min,
            age_max=age_max,
        )
    )
    await db.commit()
    return me


async def _age_swipe(db, me: User, target: User, hours: int) -> None:
    """Mută momentul swipe-ului meu pe `target` cu `hours` ore în trecut."""
    past = datetime.now(timezone.utc) - timedelta(hours=hours)
    await db.execute(
        update(Like)
        .where(Like.from_user_id == me.id, Like.to_user_id == target.id)
        .values(created_at=past, updated_at=past)
    )
    await db.commit()
    # Doar rândurile `Like` din sesiune sunt acum vechi (UPDATE la nivel core);
    # restul obiectelor rămân încărcate (expire_all le-ar reîncărca leneș, iar în
    # async asta înseamnă MissingGreenlet).
    for obj in list(db.identity_map.values()):
        if isinstance(obj, Like):
            db.expire(obj)


async def _feed(db, me: User, limit: int = 50):
    return (await F.get_feed(db, me, limit=limit)).items


async def _my_profile(db, me: User) -> Profile:
    return await db.scalar(select(Profile).where(Profile.user_id == me.id))


def _ids(cards) -> list:
    return [c.user_id for c in cards]


def _tier(cards, user: User):
    return next(c.fallback_tier for c in cards if c.user_id == user.id)


# --------------------------------------------------------------------------- #
# Ordinea treptelor
# --------------------------------------------------------------------------- #
async def test_strict_only_when_page_is_full(db_session):
    me = await _me(db_session)
    strict = [await _person(db_session, f"s{i}@example.com") for i in range(3)]
    await _person(db_session, "old@example.com", age=45)  # doar în relaxed

    page = await F.get_feed(db_session, me, limit=3)
    assert set(_ids(page.items)) == {u.id for u in strict}
    assert all(c.fallback_tier is None and c.outside_filters is False for c in page.items)


async def test_relaxed_fills_when_strict_is_short(db_session):
    me = await _me(db_session)
    strict = await _person(db_session, "strict@example.com")
    # În afara intervalului MEU de vârstă: filtru dur, nu treaptă.
    old = await _person(db_session, "old@example.com", age=45)
    far = await _person(db_session, "far@example.com", where=FAR)
    # Inactiv de mult: exclus din strict, dar acceptat în relaxed.
    idle = await _person(db_session, "idle@example.com")
    await db_session.execute(
        update(User)
        .where(User.id == idle.id)
        .values(last_active_at=datetime.now(timezone.utc) - timedelta(days=365))
    )
    await db_session.commit()

    cards = await _feed(db_session, me)
    ids = _ids(cards)
    # Strict-ul vine ÎNTÂI, cu default-urile neschimbate.
    assert ids[0] == strict.id
    assert cards[0].fallback_tier is None and cards[0].outside_filters is False
    assert old.id not in ids
    # Raza în afara preferințelor ⇒ relaxed + marcat.
    card = next(c for c in cards if c.user_id == far.id)
    assert card.fallback_tier == "relaxed"
    assert card.outside_filters is True
    # Inactivul e în preferințe (vârstă/rază/gen) ⇒ relaxed, dar NU „în afara".
    idle_card = next(c for c in cards if c.user_id == idle.id)
    assert idle_card.fallback_tier == "relaxed"
    assert idle_card.outside_filters is False
    assert len(ids) == len(set(ids)), "Fără duplicate între trepte."


async def test_other_gender_and_out_of_age_are_never_shown(db_session):
    """Regresie: după epuizarea strict-ului, feed-ul arăta bărbați unui bărbat
    care caută femei (`other_gender`) și oameni din afara vârstei căutate."""
    me = await _me(db_session)
    await _person(db_session, "man@example.com", gender="male")
    await _person(db_session, "old@example.com", age=45)
    disliked = await _person(db_session, "dis@example.com")
    await F.swipe(db_session, me, disliked.id, "dislike")

    cards = await _feed(db_session, me)
    # Doar refuzata (într-o trecere nouă) — niciodată alt gen / altă vârstă.
    assert _ids(cards) == [disliked.id]
    assert cards[0].fallback_tier == "second_chance"


async def test_no_other_gender_tier_without_gender_preference(db_session):
    me = await _me(db_session, interested_in=())
    man = await _person(db_session, "man@example.com", gender="male")
    cards = await _feed(db_session, me)
    # Fără preferință de gen, bărbatul e deja în strict (nu în other_gender).
    assert _ids(cards) == [man.id]
    assert cards[0].fallback_tier is None


# --------------------------------------------------------------------------- #
# Ordine: compatibilitate DESCRESCĂTOR, fără duplicate între pagini
# --------------------------------------------------------------------------- #
async def _ranked_people(db) -> list[User]:
    """Trei candidate stricte cu scoruri DIFERITE (limbă + status), în ordine."""
    best = await _person(db, "best@example.com")  # ro + serious, ca mine
    mid = await _person(db, "mid@example.com", languages=["ru"])
    low = await _person(db, "low@example.com", languages=["ru"], statuses=["fun"])
    return [best, mid, low]


async def test_order_follows_compatibility_when_other_signals_are_equal(db_session):
    """Cu apropiere/activitate/calitate egale, ordinea urmează compatibilitatea
    (jitter-ul per privitor e mai mic decât o diferență reală de potrivire)."""
    me = await _me(db_session)
    people = await _ranked_people(db_session)
    cards = await _feed(db_session, me)
    assert _ids(cards) == [u.id for u in people]
    scores = [c.compatibility for c in cards]
    assert scores == sorted(scores, reverse=True) and len(set(scores)) == 3


async def test_cursor_pages_have_no_duplicates_across_tiers(db_session):
    me = await _me(db_session)
    for i in range(5):
        await _person(db_session, f"s{i}@example.com")
    await _person(db_session, "far1@example.com", where=FAR)
    await _person(db_session, "far2@example.com", where=FAR)

    full = _ids(await _feed(db_session, me))
    seen: list = []
    tiers: list = []
    cursor = None
    for _ in range(10):
        page = await F.get_feed(db_session, me, limit=3, cursor=cursor)
        for c in page.items:
            seen.append(c.user_id)
            tiers.append({None: 0, "relaxed": 1}[c.fallback_tier])
        cursor = page.next_cursor
        if cursor is None:
            break
    assert len(seen) == 7 and len(set(seen)) == 7
    assert seen == full, "Paginile pe cursor = exact lista completă, în ordine."
    assert tiers == sorted(tiers), "Treapta strictă înaintea celei relaxate."


async def _feed_statements(db, engine, me: User, limit: int) -> tuple[list, list[str]]:
    statements: list[str] = []

    def _count(_conn, _cursor, statement, *_args):
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", _count)
    try:
        cards = await _feed(db, me, limit=limit)
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _count)
    return cards, statements


async def test_all_tiers_come_from_at_most_two_retrieval_queries(db_session, engine):
    """Performanță: strict + TOATE treptele de completare = 2 retrieval-uri + 1 interese.

    Înainte, fiecare treaptă de fallback rula propriul retrieval + interese (până
    la ~11 query-uri per cerere, cu `NOT IN (…uuid)` pentru deduplicare).
    """
    me = await _me(db_session)
    await _person(db_session, "s@example.com")
    await _person(db_session, "far1@example.com", where=FAR)
    await _person(db_session, "far2@example.com", where=FAR)

    cards, statements = await _feed_statements(db_session, engine, me, limit=50)
    assert len(cards) == 3
    assert sum("FROM profiles JOIN users" in s for s in statements) == 2, statements
    assert sum("FROM profile_interests" in s for s in statements) == 1, statements
    assert len(statements) <= 7, statements


async def test_full_strict_page_needs_one_retrieval_query(db_session, engine):
    """Cazul obișnuit: strict-ul umple pagina ⇒ treptele de completare nici nu se citesc."""
    me = await _me(db_session)
    for i in range(3):
        await _person(db_session, f"s{i}@example.com")
    await _person(db_session, "man@example.com", gender="male")

    cards, statements = await _feed_statements(db_session, engine, me, limit=2)
    assert len(cards) == 2 and all(c.fallback_tier is None for c in cards)
    assert sum("FROM profiles JOIN users" in s for s in statements) == 1, statements


async def test_legacy_cursor_is_still_accepted(db_session):
    me = await _me(db_session)
    people = await _ranked_people(db_session)
    first = (await F.get_feed(db_session, me, limit=1)).items[0]
    legacy = (
        base64.urlsafe_b64encode(f"{first.compatibility}:{first.user_id}".encode())
        .decode()
        .rstrip("=")
    )
    # Formatul vechi se decodează fără 422 (cheia lui era pe procent, nu pe
    # scorul de ranking, deci poziția nu mai e semnificativă — doar acceptat).
    page = await F.get_feed(db_session, me, limit=5, cursor=legacy)
    assert isinstance(page.items, list)
    assert set(_ids(page.items)) <= {u.id for u in people}


# --------------------------------------------------------------------------- #
# Treceri: după ce i-a văzut pe toți, feed-ul o ia de la capăt
# --------------------------------------------------------------------------- #
async def test_disliked_comes_back_only_in_a_new_pass(db_session):
    me = await _me(db_session)
    her = await _person(db_session, "her@example.com")
    other = await _person(db_session, "other@example.com")

    await F.swipe(db_session, me, her.id, "dislike")
    # Mai e cineva nevăzut ⇒ aceeași trecere, ea nu revine.
    assert _ids(await _feed(db_session, me)) == [other.id]
    assert (await _my_profile(db_session, me)).feed_cycle_started_at is None

    await F.swipe(db_session, me, other.id, "dislike")
    cards = await _feed(db_session, me)
    # Toți văzuți ⇒ trecere nouă: amândouă revin, marcate „încă o șansă".
    assert set(_ids(cards)) == {her.id, other.id}
    assert all(c.fallback_tier == "second_chance" for c in cards)
    assert all(c.outside_filters is False for c in cards)
    assert (await _my_profile(db_session, me)).feed_cycle_started_at is not None


async def test_new_pass_keeps_compatibility_order(db_session):
    me = await _me(db_session)
    people = await _ranked_people(db_session)
    for u in people:
        await F.swipe(db_session, me, u.id, "dislike")
    cards = await _feed(db_session, me)
    assert _ids(cards) == [u.id for u in people]


async def test_new_pass_never_brings_back_liked_or_matched(db_session):
    me = await _me(db_session)
    liked = await _person(db_session, "liked@example.com")
    matched = await _person(db_session, "matched@example.com")
    disliked = await _person(db_session, "dis@example.com")
    await F.swipe(db_session, me, liked.id, "like")
    await F.swipe(db_session, matched, me.id, "like")
    res = await F.swipe(db_session, me, matched.id, "like")
    assert res.matched is True
    await F.swipe(db_session, me, disliked.id, "dislike")

    for _ in range(3):  # oricâte treceri: doar dislike-ul revine
        assert _ids(await _feed(db_session, me)) == [disliked.id]
        await F.swipe(db_session, me, disliked.id, "dislike")


async def test_super_liked_never_comes_back(db_session):
    me = await _me(db_session)
    her = await _person(db_session, "her@example.com")
    await F.swipe(db_session, me, her.id, "super_like")
    assert await _feed(db_session, me) == []


async def test_only_likes_means_truly_empty_without_new_pass(db_session):
    me = await _me(db_session)
    her = await _person(db_session, "her@example.com")
    await F.swipe(db_session, me, her.id, "like")
    assert await _feed(db_session, me) == []
    # Nicio trecere nouă inutilă (n-avea pe cine readuce).
    assert (await _my_profile(db_session, me)).feed_cycle_started_at is None


async def test_new_pass_starts_only_without_cursor(db_session):
    me = await _me(db_session)
    her = await _person(db_session, "her@example.com")
    first = (await F.get_feed(db_session, me, limit=1)).items[0]
    cursor = F._encode_cursor(first.compatibility, first.user_id)
    await F.swipe(db_session, me, her.id, "dislike")
    # Capătul unei liste paginate pe cursor = gol; trecerea nouă o pornește
    # cererea de la începutul listei.
    assert (await F.get_feed(db_session, me, cursor=cursor)).items == []
    assert _ids(await _feed(db_session, me)) == [her.id]


async def test_matched_never_shown_even_without_my_like_row(db_session):
    """Match-ul e gate dur propriu, nu doar consecința like-ului meu."""
    me = await _me(db_session)
    her = await _person(db_session, "her@example.com")
    a_id, b_id = F._normalized_pair(me.id, her.id)
    db_session.add(Match(user_a_id=a_id, user_b_id=b_id))
    await db_session.commit()
    assert await _feed(db_session, me) == []


# --------------------------------------------------------------------------- #
# Gate-uri dure — în TOATE treptele și în orice trecere
# --------------------------------------------------------------------------- #
async def test_hard_gates_hold_in_every_tier(db_session):
    me = await _me(db_session)
    now = datetime.now(timezone.utc)
    gated: list[User] = []
    # Fiecare gate, pe AMBELE genuri (female = căutat; male = alt gen, exclus
    # oricum de potrivirea reciprocă) — niciunul nu are voie să apară.
    for gender in ("female", "male"):
        blocked_by_me = await _person(db_session, f"bme-{gender}@example.com", gender=gender)
        blocks_me = await _person(db_session, f"bby-{gender}@example.com", gender=gender)
        db_session.add(Block(blocker_id=me.id, blocked_id=blocked_by_me.id))
        db_session.add(Block(blocker_id=blocks_me.id, blocked_id=me.id))

        banned = await _person(db_session, f"ban-{gender}@example.com", gender=gender)
        deleted = await _person(db_session, f"del-{gender}@example.com", gender=gender)
        await db_session.execute(update(User).where(User.id == banned.id).values(banned_at=now))
        await db_session.execute(update(User).where(User.id == deleted.id).values(deleted_at=now))

        hidden = await _person(db_session, f"hid-{gender}@example.com", gender=gender)
        db_session.add(
            UserSettings(user_id=hidden.id, search_radius_km=50, profile_hidden=True)
        )
        minor = await _person(db_session, f"min-{gender}@example.com", gender=gender, age=17)
        no_photos = await _person(db_session, f"nop-{gender}@example.com", gender=gender, photos=0)
        incomplete = await _person(
            db_session, f"inc-{gender}@example.com", gender=gender, completed=False
        )
        await db_session.commit()
        gated += [blocked_by_me, blocks_me, banned, deleted, hidden, minor, no_photos, incomplete]

    # Dislike vechi pe toți (o trecere nouă i-ar readuce, dacă ar fi eligibili).
    for u in gated:
        db_session.add(
            Like(
                from_user_id=me.id,
                to_user_id=u.id,
                is_like=False,
                created_at=now - timedelta(days=3),
                updated_at=now - timedelta(days=3),
            )
        )
    await db_session.commit()
    # Și câte un profil NE-swipe-uit cu aceleași gate-uri.
    fresh_minor = await _person(db_session, "fmin@example.com", age=17)
    fresh_banned = await _person(db_session, "fban@example.com", gender="male")
    await db_session.execute(
        update(User).where(User.id == fresh_banned.id).values(banned_at=now)
    )
    await db_session.commit()

    cards = await _feed(db_session, me)
    shown = set(_ids(cards))
    assert me.id not in shown
    assert not shown & {u.id for u in gated + [fresh_minor, fresh_banned]}, cards
    # Nimeni eligibil ⇒ feed GOL (singurul caz în care e gol), și după ce s-a
    # încercat o trecere nouă.
    assert cards == []
    assert await _feed(db_session, me) == []


async def test_my_own_gates_still_apply(db_session):
    """Fără poze proprii ⇒ feed gol, chiar dacă fallback-ul ar avea candidați."""
    me = await _person(db_session, "me@example.com", gender="male", photos=0)
    await _person(db_session, "her@example.com")
    assert await _feed(db_session, me) == []


async def test_empty_only_when_truly_nobody(db_session):
    me = await _me(db_session)
    assert await _feed(db_session, me) == []
    # Un profil „imposibil" (alt gen, altă vârstă) NU apare: genul și vârsta
    # sunt filtre dure. Unul potrivit dar departe apare, în `relaxed`.
    await _person(db_session, "x@example.com", gender="male", age=60, where=FAR)
    assert await _feed(db_session, me) == []
    far = await _person(db_session, "far@example.com", where=FAR)
    cards = await _feed(db_session, me)
    assert _ids(cards) == [far.id]
    assert cards[0].fallback_tier == "relaxed" and cards[0].outside_filters


# --------------------------------------------------------------------------- #
# Re-swipe pe o cartelă revenită într-o trecere nouă
# --------------------------------------------------------------------------- #
async def test_dislike_again_in_new_pass_excludes_until_next_pass(db_session):
    me = await _me(db_session)
    her = await _person(db_session, "her@example.com")
    other = await _person(db_session, "other@example.com")
    await F.swipe(db_session, me, her.id, "dislike")
    await F.swipe(db_session, me, other.id, "dislike")
    assert set(_ids(await _feed(db_session, me))) == {her.id, other.id}  # trecere nouă

    res = await F.swipe(db_session, me, her.id, "dislike")
    assert res.matched is False
    rows = (
        await db_session.scalars(
            select(Like).where(Like.from_user_id == me.id, Like.to_user_id == her.id)
        )
    ).all()
    assert len(rows) == 1 and rows[0].is_like is False
    # Refuzată din nou în trecerea curentă ⇒ nu revine până la următoarea.
    assert _ids(await _feed(db_session, me)) == [other.id]


async def test_reswipe_second_chance_like_creates_match_and_notifies(
    db_session, monkeypatch
):
    me = await _me(db_session)
    her = await _person(db_session, "her@example.com")
    other = await _person(db_session, "other@example.com")
    sent_likes: list = []
    sent_matches: list = []
    monkeypatch.setattr(tg_notify, "notify_like", lambda **kw: sent_likes.append(kw))
    monkeypatch.setattr(tg_notify, "notify_match", lambda **kw: sent_matches.append(kw))

    await F.swipe(db_session, me, her.id, "dislike")
    # Ea îmi dă like între timp.
    await F.swipe(db_session, her, me.id, "like")
    # Un swipe mai recent pe altcineva (pentru verificarea lui undo).
    await F.swipe(db_session, me, other.id, "like")
    sent_likes.clear()

    # Toți văzuți (dislike / like) ⇒ trecere nouă: ea revine, like-ul nu.
    cards = await _feed(db_session, me)
    assert _ids(cards) == [her.id]
    assert _tier(cards, her) == "second_chance"
    res = await F.swipe(db_session, me, her.id, "like")
    assert res.matched is True and res.chat_id is not None
    assert len(sent_matches) == 1 and sent_matches[0]["recipient_id"] == her.id

    rows = (
        await db_session.scalars(
            select(Like).where(Like.from_user_id == me.id, Like.to_user_id == her.id)
        )
    ).all()
    assert len(rows) == 1 and rows[0].is_like is True
    # Like dat + match ⇒ nu mai apare în nicio treaptă.
    assert her.id not in _ids(await _feed(db_session, me))

    # Undo anulează swipe-ul de „a doua șansă" (cel mai RECENT — `created_at`
    # proaspăt), nu like-ul anterior pe `other`, și demontează match-ul.
    undo = await F.undo_last_swipe(db_session, me)
    assert undo.undone is True and undo.target_user_id == her.id
    assert await db_session.scalar(select(func.count()).select_from(Match)) == 0


async def test_second_chance_like_without_reciprocal_notifies_like(
    db_session, monkeypatch
):
    me = await _me(db_session)
    her = await _person(db_session, "her@example.com")
    sent: list = []
    monkeypatch.setattr(tg_notify, "notify_like", lambda **kw: sent.append(kw))

    await F.swipe(db_session, me, her.id, "dislike")
    res = await F.swipe(db_session, me, her.id, "like")
    assert res.matched is False
    # Trecerea dislike → like declanșează notificarea de like (o singură dată).
    assert len(sent) == 1 and sent[0]["recipient_id"] == her.id


async def test_second_chance_reswipe_is_undone_first(db_session):
    """Re-swipe-ul unui dislike primește `created_at` proaspăt ⇒ undo îl ia."""
    me = await _me(db_session)
    her = await _person(db_session, "her@example.com")
    other = await _person(db_session, "other@example.com")
    await F.swipe(db_session, me, her.id, "dislike")
    await _age_swipe(db_session, me, her, hours=25)
    await F.swipe(db_session, me, other.id, "dislike")
    await _age_swipe(db_session, me, other, hours=1)

    await F.swipe(db_session, me, her.id, "dislike")
    undo = await F.undo_last_swipe(db_session, me)
    assert undo.target_user_id == her.id


async def test_redislike_consumes_daily_quota(db_session, monkeypatch):
    """Re-swipe pe un dislike e o decizie NOUĂ ⇒ intră în limita zilnică."""
    me = await _me(db_session)
    her = await _person(db_session, "her@example.com")
    await F.swipe(db_session, me, her.id, "dislike")
    await _age_swipe(db_session, me, her, hours=25)
    monkeypatch.setattr(F.settings, "free_daily_swipe_limit", 0)
    try:
        await F.swipe(db_session, me, her.id, "dislike")
    except F.HTTPException as exc:
        assert exc.status_code == 429
    else:  # pragma: no cover - mesaj clar la regresie
        raise AssertionError("Re-swipe-ul unui dislike trebuie să consume din cotă.")


# --------------------------------------------------------------------------- #
# Progres: în aceeași trecere nimic nu se repetă; apoi doar dislike-urile revin
# --------------------------------------------------------------------------- #
async def test_progress_no_repeats_within_a_pass(db_session):
    me = await _me(db_session)
    await _person(db_session, "s@example.com")
    await _person(db_session, "old@example.com", age=45)
    await _person(db_session, "far@example.com", where=FAR)
    await _person(db_session, "man@example.com", gender="male")
    dis = await _person(db_session, "dis@example.com")
    await F.swipe(db_session, me, dis.id, "dislike")
    await _age_swipe(db_session, me, dis, hours=25)

    liked: set = set()
    disliked: set = {dis.id}
    shown_in_pass: set = set()
    rounds = 0
    while True:
        page = await F.get_feed(db_session, me, limit=2)
        assert page.items, "Feed-ul nu are voie să se golească: există dislike-uri."
        rounds += 1
        assert rounds < 10, "Feed-ul nu face progres."
        ids = set(_ids(page.items))
        if ids & (liked | disliked):
            # Trecere NOUĂ: abia după ce TOȚI au fost văzuți, și doar dislike-urile.
            # s, far, dis (bărbatul și cea de 45 de ani nu apar deloc).
            assert len(liked | disliked) == 3
            assert not ids & liked
            break
        for card in page.items:
            assert card.user_id not in shown_in_pass, "Repetare în aceeași trecere."
            shown_in_pass.add(card.user_id)
            # Alternăm like/dislike: ambele trebuie să excludă cartela.
            if len(shown_in_pass) % 2:
                await F.swipe(db_session, me, card.user_id, "like")
                liked.add(card.user_id)
            else:
                await F.swipe(db_session, me, card.user_id, "dislike")
                disliked.add(card.user_id)

    assert set(_ids(await _feed(db_session, me))) == disliked

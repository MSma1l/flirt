"""Feed în TREPTE: când feed-ul strict s-a epuizat, arătăm profiluri ORICUM.

Ordinea: strict → relaxed (fără vârstă/rază/inactivitate) → second_chance
(dislike-uri vechi de ≥ 24h) → other_gender. Gate-urile DURE (profil complet,
18+, poze, self, block, ban, ascuns, șters, like/match deja dat) se aplică în
TOATE treptele. Testele apelează serviciul direct (fixturi în DB), ca în
`test_feed_service_unit.py`.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select, update

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
        languages=["ro"],
        dating_statuses=["serious"],
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
    # Vârsta/raza în afara preferințelor ⇒ relaxed + marcate.
    for u in (old, far):
        card = next(c for c in cards if c.user_id == u.id)
        assert card.fallback_tier == "relaxed"
        assert card.outside_filters is True
    # Inactivul e în preferințe (vârstă/rază/gen) ⇒ relaxed, dar NU „în afara".
    idle_card = next(c for c in cards if c.user_id == idle.id)
    assert idle_card.fallback_tier == "relaxed"
    assert idle_card.outside_filters is False
    assert len(ids) == len(set(ids)), "Fără duplicate între trepte."


async def test_other_gender_is_last_and_flagged(db_session):
    me = await _me(db_session)
    man = await _person(db_session, "man@example.com", gender="male")
    old = await _person(db_session, "old@example.com", age=45)
    disliked = await _person(db_session, "dis@example.com")
    await F.swipe(db_session, me, disliked.id, "dislike")
    await _age_swipe(db_session, me, disliked, hours=25)

    cards = await _feed(db_session, me)
    assert _ids(cards) == [old.id, disliked.id, man.id]
    assert [c.fallback_tier for c in cards] == ["relaxed", "second_chance", "other_gender"]
    assert cards[-1].outside_filters is True


async def test_other_gender_excludes_liked_and_recent_dislike(db_session):
    me = await _me(db_session)
    liked = await _person(db_session, "liked@example.com", gender="male")
    recent = await _person(db_session, "recent@example.com", gender="male")
    old_dis = await _person(db_session, "olddis@example.com", gender="male")
    await F.swipe(db_session, me, liked.id, "like")
    await F.swipe(db_session, me, recent.id, "dislike")
    await F.swipe(db_session, me, old_dis.id, "dislike")
    await _age_swipe(db_session, me, liked, hours=72)
    await _age_swipe(db_session, me, old_dis, hours=25)

    cards = await _feed(db_session, me)
    assert _ids(cards) == [old_dis.id]
    assert cards[0].fallback_tier == "other_gender"


async def test_no_other_gender_tier_without_gender_preference(db_session):
    me = await _me(db_session, interested_in=())
    man = await _person(db_session, "man@example.com", gender="male")
    cards = await _feed(db_session, me)
    # Fără preferință de gen, bărbatul e deja în strict (nu în other_gender).
    assert _ids(cards) == [man.id]
    assert cards[0].fallback_tier is None


# --------------------------------------------------------------------------- #
# A doua șansă
# --------------------------------------------------------------------------- #
async def test_second_chance_only_after_24h(db_session):
    me = await _me(db_session)
    her = await _person(db_session, "her@example.com")
    await F.swipe(db_session, me, her.id, "dislike")

    assert her.id not in _ids(await _feed(db_session, me))

    await _age_swipe(db_session, me, her, hours=23)
    assert her.id not in _ids(await _feed(db_session, me))

    await _age_swipe(db_session, me, her, hours=25)
    cards = await _feed(db_session, me)
    assert _tier(cards, her) == "second_chance"


async def test_second_chance_never_liked_or_matched(db_session):
    me = await _me(db_session)
    liked = await _person(db_session, "liked@example.com")
    matched = await _person(db_session, "matched@example.com")
    await F.swipe(db_session, me, liked.id, "like")
    await F.swipe(db_session, matched, me.id, "like")
    res = await F.swipe(db_session, me, matched.id, "like")
    assert res.matched is True
    for u in (liked, matched):
        await _age_swipe(db_session, me, u, hours=24 * 30)

    assert await _feed(db_session, me) == []


async def test_matched_never_shown_even_without_my_like_row(db_session):
    """Match-ul e gate dur propriu, nu doar consecința like-ului meu."""
    me = await _me(db_session)
    her = await _person(db_session, "her@example.com")
    a_id, b_id = F._normalized_pair(me.id, her.id)
    db_session.add(Match(user_a_id=a_id, user_b_id=b_id))
    await db_session.commit()
    assert await _feed(db_session, me) == []


# --------------------------------------------------------------------------- #
# Gate-uri dure — în TOATE treptele
# --------------------------------------------------------------------------- #
async def test_hard_gates_hold_in_every_tier(db_session):
    me = await _me(db_session)
    now = datetime.now(timezone.utc)
    gated: list[User] = []
    # Fiecare gate, pe AMBELE genuri (female = strict/relaxed/second_chance,
    # male = other_gender) — niciunul nu are voie să apară.
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

    # Dislike vechi pe toți (ca și second_chance / other_gender să-i poată „vedea").
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
    # Și câte un profil NE-swipe-uit cu aceleași gate-uri (pentru relaxed /
    # other_gender ne-swipe-uit).
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
    # Nimeni eligibil ⇒ feed GOL (singurul caz în care e gol).
    assert cards == []


async def test_my_own_gates_still_apply(db_session):
    """Fără poze proprii ⇒ feed gol, chiar dacă fallback-ul ar avea candidați."""
    me = await _person(db_session, "me@example.com", gender="male", photos=0)
    await _person(db_session, "her@example.com")
    assert await _feed(db_session, me) == []


async def test_empty_only_when_truly_nobody(db_session):
    me = await _me(db_session)
    assert await _feed(db_session, me) == []
    # Un singur profil „imposibil" (alt gen, altă vârstă, departe) — tot apare.
    other = await _person(db_session, "x@example.com", gender="male", age=60, where=FAR)
    cards = await _feed(db_session, me)
    assert _ids(cards) == [other.id]
    assert cards[0].fallback_tier == "other_gender" and cards[0].outside_filters


# --------------------------------------------------------------------------- #
# Re-swipe pe o cartelă „a doua șansă"
# --------------------------------------------------------------------------- #
async def test_reswipe_second_chance_dislike_again_restarts_cooldown(db_session):
    me = await _me(db_session)
    her = await _person(db_session, "her@example.com")
    await F.swipe(db_session, me, her.id, "dislike")
    await _age_swipe(db_session, me, her, hours=25)
    assert _tier(await _feed(db_session, me), her) == "second_chance"

    res = await F.swipe(db_session, me, her.id, "dislike")
    assert res.matched is False
    rows = (
        await db_session.scalars(
            select(Like).where(Like.from_user_id == me.id, Like.to_user_id == her.id)
        )
    ).all()
    assert len(rows) == 1 and rows[0].is_like is False
    # Perioada de 24h a repornit ⇒ nu revine la cererea următoare.
    assert her.id not in _ids(await _feed(db_session, me))


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
    await _age_swipe(db_session, me, her, hours=25)
    # Ea îmi dă like între timp.
    await F.swipe(db_session, her, me.id, "like")
    # Un swipe mai recent pe altcineva (pentru verificarea lui undo).
    await F.swipe(db_session, me, other.id, "like")
    sent_likes.clear()

    assert _tier(await _feed(db_session, me), her) == "second_chance"
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
    await _age_swipe(db_session, me, her, hours=25)
    res = await F.swipe(db_session, me, her.id, "like")
    assert res.matched is False
    # Trecerea dislike → like declanșează notificarea de like (o singură dată).
    assert len(sent) == 1 and sent[0]["recipient_id"] == her.id


async def test_second_chance_reswipe_is_undone_first(db_session):
    """Re-swipe-ul de „a doua șansă" primește `created_at` proaspăt ⇒ undo îl ia."""
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


# --------------------------------------------------------------------------- #
# Progres: ce am swipe-uit acum nu revine la cererea următoare
# --------------------------------------------------------------------------- #
async def test_progress_swiped_cards_never_come_back(db_session):
    me = await _me(db_session)
    await _person(db_session, "s@example.com")
    await _person(db_session, "old@example.com", age=45)
    await _person(db_session, "far@example.com", where=FAR)
    await _person(db_session, "man@example.com", gender="male")
    dis = await _person(db_session, "dis@example.com")
    await F.swipe(db_session, me, dis.id, "dislike")
    await _age_swipe(db_session, me, dis, hours=25)

    swiped: set = set()
    rounds = 0
    while True:
        page = await F.get_feed(db_session, me, limit=2)
        if not page.items:
            break
        rounds += 1
        assert rounds < 10, "Feed-ul nu face progres."
        for card in page.items:
            assert card.user_id not in swiped, "Cartelă swipe-uită revenită în feed."
            # Alternăm like/dislike: ambele trebuie să excludă cartela.
            action = "like" if len(swiped) % 2 == 0 else "dislike"
            await F.swipe(db_session, me, card.user_id, action)
            swiped.add(card.user_id)

    assert len(swiped) == 5
    assert await _feed(db_session, me) == []

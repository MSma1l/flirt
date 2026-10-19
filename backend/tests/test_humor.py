"""Teste pentru Testul de umor (TZ 2.7) + administrarea lui din panou."""
from datetime import date

import pytest
from sqlalchemy import select

from app.models.admin import AdminAuditLog
from app.models.user import ROLE_ADMIN, User
from app.services import humor_service
from app.services.humor_service import HUMOR_TYPES
from tests import conftest

API = "/api/v1"
_ADULT_YEAR = date.today().year - 25


def _extract_token(payload: dict) -> str | None:
    if isinstance(payload, dict):
        for key in ("access_token", "accessToken", "token"):
            if isinstance(payload.get(key), str):
                return payload[key]
    return None


async def _register(client, email: str, password: str = "Str0ng-Passw0rd!") -> dict:
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": password}
    )
    assert resp.status_code in (200, 201), resp.text
    return {"Authorization": f"Bearer {_extract_token(resp.json())}"}


def _anketa(name: str) -> dict:
    return {
        "name": name,
        "birth_date": date(_ADULT_YEAR, 1, 1).isoformat(),
        "gender": "male",
        "height_cm": 180,
        "city": "Chișinău",
        "nationality": "Moldovean",
        "languages": ["ru", "ro"],
        "about": f"Salut, sunt {name}.",
        "dating_statuses": ["serious"],
        "interests": ["sport", "travel"],
        "photos": [],
    }


async def _make_user(client, email: str, name: str) -> dict:
    """Înregistrare + anketă completă → întoarce headerele de auth."""
    headers = await _register(client, email)
    resp = await client.put(f"{API}/profiles/me", json=_anketa(name), headers=headers)
    assert resp.status_code == 200, resp.text
    return headers


# Limbile interfeței — sufixele câmpurilor de text de pe card.
_LOCALES = ("ro", "ru", "en")


@pytest.mark.asyncio
async def test_quiz_returns_valid_cards(client):
    """GET /humor/quiz întoarce carduri ne-goale cu tip valid."""
    headers = await _make_user(client, "a@example.com", "A")

    resp = await client.get(f"{API}/humor/quiz", headers=headers)
    assert resp.status_code == 200, resp.text
    cards = resp.json()
    assert len(cards) > 0
    for card in cards:
        assert card["id"] and card["text"]
        assert card["type"] in HUMOR_TYPES


@pytest.mark.asyncio
async def test_quiz_cards_localized_in_all_languages(client):
    """(a) Fiecare card vine cu textul în ro/ru/en, niciunul gol."""
    headers = await _make_user(client, "loc@example.com", "Loc")

    cards = (await client.get(f"{API}/humor/quiz", headers=headers)).json()
    for card in cards:
        for locale in _LOCALES:
            key = f"text_{locale}"
            assert key in card, f"cardul {card['id']} nu are {key}"
            # (d) niciun text gol / doar spații în nicio limbă.
            assert card[key].strip(), f"cardul {card['id']} are {key} gol"


@pytest.mark.asyncio
async def test_quiz_cards_texts_differ_between_languages(client):
    """Textele chiar sunt localizate, nu același șir copiat în toate limbile."""
    headers = await _make_user(client, "diff@example.com", "Diff")

    cards = (await client.get(f"{API}/humor/quiz", headers=headers)).json()
    for card in cards:
        texts = {card[f"text_{locale}"] for locale in _LOCALES}
        assert len(texts) == len(_LOCALES), f"cardul {card['id']} are texte duplicate"


@pytest.mark.asyncio
async def test_quiz_covers_every_humor_type(client):
    """(b) Toate cele 7 tipuri apar în quiz — altfel vectorul iese distorsionat."""
    headers = await _make_user(client, "types@example.com", "Types")

    cards = (await client.get(f"{API}/humor/quiz", headers=headers)).json()
    assert {c["type"] for c in cards} == set(HUMOR_TYPES)


@pytest.mark.asyncio
async def test_quiz_keeps_deprecated_text_alias(client):
    """Câmpul deprecat `text` rămâne în răspuns (= text_ro) pentru clientul publicat."""
    headers = await _make_user(client, "alias@example.com", "Alias")

    cards = (await client.get(f"{API}/humor/quiz", headers=headers)).json()
    for card in cards:
        assert card["text"] == card["text_ro"]


@pytest.mark.asyncio
async def test_submit_builds_normalized_vector(client):
    """POST /humor/submit → vector cu sumă ≈ 1.0 și ponderi mai mari pe alese."""
    headers = await _make_user(client, "b@example.com", "B")

    cards = (await client.get(f"{API}/humor/quiz", headers=headers)).json()
    # Alegem primele două carduri drept amuzante, restul nu.
    chosen = cards[:2]
    chosen_types = {c["type"] for c in chosen}
    answers = [
        {"card_id": c["id"], "funny": c in chosen} for c in cards
    ]

    resp = await client.post(
        f"{API}/humor/submit", json={"answers": answers}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    vector = resp.json()["vector"]

    # Suma ponderilor ≈ 1.0.
    assert abs(sum(vector.values()) - 1.0) < 1e-6

    # Tipurile alese au pondere strict mai mare decât cele nealese.
    for chosen_type in chosen_types:
        assert vector[chosen_type] > 0
    for humor_type in HUMOR_TYPES:
        if humor_type not in chosen_types:
            assert vector[humor_type] == 0


@pytest.mark.asyncio
async def test_get_me_returns_saved_vector(client):
    """GET /humor/me întoarce vectorul salvat anterior."""
    headers = await _make_user(client, "c@example.com", "C")
    cards = (await client.get(f"{API}/humor/quiz", headers=headers)).json()
    answers = [{"card_id": c["id"], "funny": c["type"] == "memes"} for c in cards]

    submitted = (
        await client.post(
            f"{API}/humor/submit", json={"answers": answers}, headers=headers
        )
    ).json()["vector"]

    resp = await client.get(f"{API}/humor/me", headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["vector"] == submitted
    assert submitted["memes"] == pytest.approx(1.0)


@pytest.mark.asyncio
async def test_submit_without_profile_404(client):
    """User fără anketă → submit întoarce 404."""
    headers = await _register(client, "noprofile@example.com")
    resp = await client.post(
        f"{API}/humor/submit",
        json={"answers": [{"card_id": "c1", "funny": True}]},
        headers=headers,
    )
    assert resp.status_code == 404, resp.text



# --------------------------------------------------------------------------- #
# Comutatorul global + panoul de admin
# --------------------------------------------------------------------------- #
ADMIN = f"{API}/admin"


async def _make_admin(client, db, email: str = "admin@example.com") -> dict:
    headers = await _register(client, email)
    user = await db.scalar(select(User).where(User.email == email))
    user.role = ROLE_ADMIN
    await db.commit()
    return headers


def _question(**overrides) -> dict:
    data = {
        "humor_type": "absurd",
        "text_ro": "O glumă nouă.",
        "text_ru": "Новая шутка.",
        "text_en": "A new joke.",
    }
    data.update(overrides)
    return data


@pytest.mark.asyncio
async def test_config_disabled_by_default_with_intro(client):
    """Implicit testul e OPRIT, dar introducerea există în toate cele 3 limbi."""
    headers = await _make_user(client, "cfg@example.com", "Cfg")
    resp = await client.get(f"{API}/humor/config", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["enabled"] is False
    assert body["question_count"] == len(humor_service.DEFAULT_QUESTIONS)
    for locale in _LOCALES:
        assert body[f"intro_{locale}"].strip()


@pytest.mark.asyncio
async def test_config_requires_auth(client):
    resp = await client.get(f"{API}/humor/config")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_quiz_still_served_when_disabled(client):
    """Cu testul oprit, quiz-ul și trimiterea merg (aplicația nativă le cere)."""
    headers = await _make_user(client, "off@example.com", "Off")
    await conftest.complete_humor(client, headers)


@pytest.mark.asyncio
async def test_admin_routes_reject_regular_user(client):
    headers = await _make_user(client, "plain@example.com", "Plain")
    for method, path in (
        ("GET", "/humor/settings"),
        ("PUT", "/humor/settings"),
        ("GET", "/humor/questions"),
        ("POST", "/humor/questions"),
    ):
        resp = await client.request(method, f"{ADMIN}{path}", headers=headers, json={})
        assert resp.status_code == 403, (method, path, resp.text)


@pytest.mark.asyncio
async def test_admin_toggle_controls_swipe_gate(client, db_session):
    """Comutatorul din panou: pornit/oprit, intro editabil, auditat."""
    admin = await _make_admin(client, db_session)

    settings_resp = await client.get(f"{ADMIN}/humor/settings", headers=admin)
    assert settings_resp.status_code == 200, settings_resp.text
    current = settings_resp.json()
    assert current["enabled"] is False
    assert current["active_questions"] == 7
    assert current["humor_types"] == HUMOR_TYPES

    on = await client.put(
        f"{ADMIN}/humor/settings",
        json={
            "enabled": True,
            "intro_ro": "De ce?\nCa să potrivim umorul.",
            "intro_ru": "",
            "intro_en": "Why?",
        },
        headers=admin,
    )
    assert on.status_code == 200, on.text
    assert on.json()["enabled"] is True
    assert on.json()["intro_ro"] == "De ce?\nCa să potrivim umorul."

    user = await _make_user(client, "gate@example.com", "Gate")
    cfg = (await client.get(f"{API}/humor/config", headers=user)).json()
    assert cfg["enabled"] is True and cfg["intro_en"] == "Why?"
    assert await humor_service.is_enabled(db_session) is True

    logs = (
        await db_session.scalars(
            select(AdminAuditLog).where(AdminAuditLog.action == "humor.settings.update")
        )
    ).all()
    assert len(logs) == 1

    off = await client.put(
        f"{ADMIN}/humor/settings", json={"enabled": False}, headers=admin
    )
    assert off.status_code == 200, off.text
    assert await humor_service.is_enabled(db_session) is False


@pytest.mark.asyncio
async def test_admin_settings_validation(client, db_session):
    admin = await _make_admin(client, db_session)
    too_long = await client.put(
        f"{ADMIN}/humor/settings",
        json={"enabled": False, "intro_ro": "a" * 2001},
        headers=admin,
    )
    assert too_long.status_code == 422
    html = await client.put(
        f"{ADMIN}/humor/settings",
        json={"enabled": False, "intro_ro": "<script>x</script>"},
        headers=admin,
    )
    assert html.status_code == 422


@pytest.mark.asyncio
async def test_admin_question_crud_and_quiz_follows(client, db_session):
    admin = await _make_admin(client, db_session)
    user = await _make_user(client, "crud@example.com", "Crud")

    listed = (await client.get(f"{ADMIN}/humor/questions", headers=admin)).json()
    assert [q["key"] for q in listed] == ["c1", "c2", "c3", "c4", "c5", "c6", "c7"]

    # Creare → apare la finalul quiz-ului.
    created = await client.post(
        f"{ADMIN}/humor/questions", json=_question(), headers=admin
    )
    assert created.status_code == 201, created.text
    new = created.json()
    assert new["position"] == 7 and new["active"] is True
    quiz = (await client.get(f"{API}/humor/quiz", headers=user)).json()
    assert quiz[-1]["id"] == new["key"]
    assert quiz[-1]["text_en"] == "A new joke."

    # Editare.
    patched = await client.patch(
        f"{ADMIN}/humor/questions/{new['id']}",
        json={"text_ro": "Gluma editată.", "humor_type": "dark"},
        headers=admin,
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["text_ro"] == "Gluma editată."
    assert patched.json()["humor_type"] == "dark"

    # Dezactivare → dispare din quiz.
    hidden = await client.patch(
        f"{ADMIN}/humor/questions/{new['id']}", json={"active": False}, headers=admin
    )
    assert hidden.status_code == 200
    quiz = (await client.get(f"{API}/humor/quiz", headers=user)).json()
    assert new["key"] not in {c["id"] for c in quiz}

    # Reordonare: c7 devine prima.
    ids = [q["id"] for q in listed] + [new["id"]]
    reordered = await client.put(
        f"{ADMIN}/humor/questions/order",
        json={"ids": [ids[-2]] + ids[:-2] + [ids[-1]]},
        headers=admin,
    )
    assert reordered.status_code == 200, reordered.text
    quiz = (await client.get(f"{API}/humor/quiz", headers=user)).json()
    assert quiz[0]["id"] == "c7"

    # Ordine incompletă → 422.
    bad = await client.put(
        f"{ADMIN}/humor/questions/order", json={"ids": ids[:3]}, headers=admin
    )
    assert bad.status_code == 422

    # Ștergere.
    deleted = await client.delete(f"{ADMIN}/humor/questions/{new['id']}", headers=admin)
    assert deleted.status_code == 204
    missing = await client.delete(f"{ADMIN}/humor/questions/{new['id']}", headers=admin)
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_admin_question_validation(client, db_session):
    admin = await _make_admin(client, db_session)
    for payload in (
        _question(text_ru="   "),
        _question(text_en="x" * 501),
        _question(humor_type="slapstick"),
        _question(text_ro="<b>bold</b>"),
    ):
        resp = await client.post(f"{ADMIN}/humor/questions", json=payload, headers=admin)
        assert resp.status_code == 422, (payload, resp.text)

    first = (await client.get(f"{ADMIN}/humor/questions", headers=admin)).json()[0]
    null_text = await client.patch(
        f"{ADMIN}/humor/questions/{first['id']}", json={"text_ro": None}, headers=admin
    )
    assert null_text.status_code == 422


@pytest.mark.asyncio
async def test_cannot_enable_or_drop_below_min_active_questions(client, db_session):
    """Testul nu poate fi pornit (sau lăsat pornit) cu prea puține glume active."""
    admin = await _make_admin(client, db_session)
    questions = (await client.get(f"{ADMIN}/humor/questions", headers=admin)).json()
    minimum = humor_service.MIN_ACTIVE_QUESTIONS

    # Cu testul PORNIT, nu poți coborî sub prag.
    assert (
        await client.put(f"{ADMIN}/humor/settings", json={"enabled": True}, headers=admin)
    ).status_code == 200
    for q in questions[: len(questions) - minimum]:
        r = await client.patch(
            f"{ADMIN}/humor/questions/{q['id']}", json={"active": False}, headers=admin
        )
        assert r.status_code == 200, r.text
    last_active = questions[len(questions) - minimum]
    blocked = await client.patch(
        f"{ADMIN}/humor/questions/{last_active['id']}", json={"active": False}, headers=admin
    )
    assert blocked.status_code == 409
    blocked_delete = await client.delete(
        f"{ADMIN}/humor/questions/{last_active['id']}", headers=admin
    )
    assert blocked_delete.status_code == 409

    # Oprit: poți coborî sub prag, dar apoi nu-l mai poți porni.
    await client.put(f"{ADMIN}/humor/settings", json={"enabled": False}, headers=admin)
    r = await client.patch(
        f"{ADMIN}/humor/questions/{last_active['id']}", json={"active": False}, headers=admin
    )
    assert r.status_code == 200
    refused = await client.put(
        f"{ADMIN}/humor/settings", json={"enabled": True}, headers=admin
    )
    assert refused.status_code == 409


@pytest.mark.asyncio
async def test_saved_vector_survives_question_deletion(client, db_session):
    """Vectorul salvat e pe TIPURI, deci ștergerea glumelor nu-l atinge."""
    admin = await _make_admin(client, db_session)
    user = await _make_user(client, "keep@example.com", "Keep")
    cards = (await client.get(f"{API}/humor/quiz", headers=user)).json()
    answers = [{"card_id": c["id"], "funny": c["type"] == "dark"} for c in cards]
    saved = (
        await client.post(f"{API}/humor/submit", json={"answers": answers}, headers=user)
    ).json()["vector"]

    dark = next(
        q
        for q in (await client.get(f"{ADMIN}/humor/questions", headers=admin)).json()
        if q["humor_type"] == "dark"
    )
    assert (
        await client.delete(f"{ADMIN}/humor/questions/{dark['id']}", headers=admin)
    ).status_code == 204

    assert (await client.get(f"{API}/humor/me", headers=user)).json()["vector"] == saved
    # Retrimiterea răspunsurilor vechi (cu id-ul glumei șterse) nu crapă.
    again = await client.post(
        f"{API}/humor/submit", json={"answers": answers}, headers=user
    )
    assert again.status_code == 200, again.text


def test_migration_seed_matches_service_defaults():
    """Seed-ul din migrație = glumele de fallback ale serviciului; testul pleacă oprit."""
    import importlib.util
    from pathlib import Path

    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "b6e1d4a7c3f2_humor_settings_and_questions.py"
    )
    spec = importlib.util.spec_from_file_location("humor_migration", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    seeded = [
        {"key": k, "humor_type": t, "text_ro": ro, "text_ru": ru, "text_en": en}
        for k, t, ro, ru, en in module._QUESTIONS
    ]
    assert seeded == humor_service.DEFAULT_QUESTIONS
    assert module._INTRO_RO == humor_service.DEFAULT_INTRO["ro"]
    assert module._INTRO_RU == humor_service.DEFAULT_INTRO["ru"]
    assert module._INTRO_EN == humor_service.DEFAULT_INTRO["en"]
    assert '"enabled": False' in path.read_text(encoding="utf-8")

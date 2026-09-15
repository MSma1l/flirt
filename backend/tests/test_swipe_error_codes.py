"""Refuzurile de la swipe poartă un cod STABIL, pe lângă textul pentru oameni.

Problema reală pe care o apără. Backendul dă mesaje distincte tocmai ca aplicația
să știe UNDE să ducă utilizatorul: la testul de umor, la poze, sau la completarea
profilului. Singurul semnal era textul, în română, comparat exact de client.

Mini App-ul nu recunoștea niciun caz, afișa o eroare generică, iar utilizatorii
rămâneau blocați fără să afle ce li se cere — s-a întâmplat în producție, pe
utilizatori reali.

Un text se traduce sau se rescrie la o corectură. Un cod nu.

Al doilea contract apărat aici e la fel de important: `detail` NU are voie să se
schimbe. Aplicația nativă e în producție și compară textul.
"""
import pytest

from app.core.errors import ErrorCode
from app.services.feed_service import HUMOR_REQUIRED_DETAIL, PHOTOS_REQUIRED_DETAIL

from tests.test_upload_security import API, _make_user

pytestmark = pytest.mark.asyncio


async def _tinta(client, email: str) -> str:
    """Un al doilea utilizator REAL.

    O țintă inventată produce 404 „utilizator indisponibil" înainte să se ajungă
    la verificarea umorului — testul ar fi trecut pe motivul greșit.
    """
    headers = await _make_user(client, email)
    return (await client.get(f"{API}/auth/me", headers=headers)).json()["id"]


async def test_refuzul_poarta_codul_potrivit_textului(client):
    """Cazul care a blocat utilizatorii reali: un refuz la swipe.

    NU fixăm care poartă se închide prima — ordinea verificărilor din backend e
    detaliu de implementare și se poate schimba. Fixăm ce contează: refuzul vine
    cu un cod, iar codul corespunde textului. Fără împerecherea asta, clientul ar
    duce utilizatorul în locul greșit.
    """
    headers = await _make_user(client, "fara-umor@example.com")
    tinta = await _tinta(client, "tinta-cod@example.com")

    r = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": tinta, "action": "like"},
        headers=headers,
    )

    assert r.status_code == 403, r.text
    corp = r.json()

    perechi = {
        HUMOR_REQUIRED_DETAIL: ErrorCode.HUMOR_REQUIRED,
        PHOTOS_REQUIRED_DETAIL: ErrorCode.PHOTOS_REQUIRED,
        "Profilul tău nu este complet.": ErrorCode.PROFILE_INCOMPLETE,
    }
    assert corp["detail"] in perechi, f"refuz neasteptat: {corp}"
    assert corp.get("code") == perechi[corp["detail"]], (
        f"textul si codul nu se potrivesc — clientul ar duce userul aiurea: {corp}"
    )


async def test_super_like_primeste_acelasi_tratament(client):
    """Super like-ul trece prin aceeași autorizare, deci același cod.

    Proprietarul a raportat că NICI like, NICI super like nu merg. Ar fi fost ușor
    să reparăm doar unul.
    """
    headers = await _make_user(client, "super@example.com")
    tinta = await _tinta(client, "tinta-super@example.com")

    r = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": tinta, "action": "super_like"},
        headers=headers,
    )

    assert r.status_code == 403, r.text
    assert r.json().get("code"), f"super like fara cod stabil: {r.json()}"


async def test_codurile_sunt_distincte_pentru_destinatii_diferite(client):
    """Fiecare refuz duce în alt loc, deci fiecare are alt cod."""
    coduri = {
        ErrorCode.SELF_SWIPE,
        ErrorCode.PROFILE_INCOMPLETE,
        ErrorCode.PHOTOS_REQUIRED,
        ErrorCode.HUMOR_REQUIRED,
        ErrorCode.UNDERAGE,
        ErrorCode.INTERACTION_BLOCKED,
    }
    assert len(coduri) == 6, "doua refuzuri cu acelasi cod ar duce userul in locul gresit"


async def test_swipe_pe_propriul_profil_are_codul_lui(client):
    headers = await _make_user(client, "eu-insumi@example.com")
    eu = (await client.get(f"{API}/auth/me", headers=headers)).json()["id"]

    r = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": eu, "action": "like"},
        headers=headers,
    )

    assert r.status_code == 403, r.text
    assert r.json().get("code") == ErrorCode.SELF_SWIPE, r.text


async def test_textele_raman_neschimbate_pentru_aplicatia_nativa():
    """Contract cu aplicația din producție: textele sunt parte din API, nu decor."""
    assert HUMOR_REQUIRED_DETAIL == "Completează testul de umor."
    assert PHOTOS_REQUIRED_DETAIL == "Profilul tău nu are destule poze."

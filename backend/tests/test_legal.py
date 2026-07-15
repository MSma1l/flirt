"""Paginile legale publice (`/legal/*`) — cerințe de App Store, nu decor.

Aplicația NU poate fi publicată fără ele, iar testele de aici verifică exact motivele
pentru care Apple respinge:

  1. **Accesibile FĂRĂ autentificare** (Guideline 5.1.1). Recenzentul le deschide dintr-un
     browser, nelogat. Un 401 = respingere. Verificăm și că nicio rută `/legal/*` nu are
     cerințe de securitate în `dependant` — dacă cineva pune mâine un `Depends(get_current_user)`
     global, testul cade AICI, nu în review-ul Apple.
  2. **Clauzele obligatorii există în text** (Guideline 1.2): toleranță ZERO față de conținutul
     ofensator și utilizatorii abuzivi, filtrare, raportare, blocare, eliminarea abuzatorilor
     în 24h; 18+; dreptul la ștergere; adresa de contact.
  3. **Bilingv RO + EN** — o politică pe care recenzentul nu o poate citi e un risc real.
  4. **`content-type: text/html`** și zero dependențe externe (fără CDN: pagina trebuie să se
     încarce identic într-o rețea care blochează domenii terțe).
"""
from __future__ import annotations

import pytest
from fastapi.security.base import SecurityBase

from app.api import legal
from app.main import app

_aio = pytest.mark.asyncio

PAGES = ["/legal/terms", "/legal/privacy", "/legal/support"]


# --------------------------------------------------------------------------- #
# 1. Publice, fără autentificare
# --------------------------------------------------------------------------- #
@_aio
@pytest.mark.parametrize("path", PAGES + ["/legal"])
async def test_pagina_raspunde_200_fara_token(client, path):
    """FĂRĂ antet `Authorization` — exact ca browserul recenzentului Apple."""
    resp = await client.get(path)
    assert resp.status_code == 200, f"{path} a întors {resp.status_code} nelogat"
    assert "text/html" in resp.headers["content-type"]
    assert "charset=utf-8" in resp.headers["content-type"].lower()


@_aio
@pytest.mark.parametrize("path", PAGES)
async def test_token_invalid_nu_blocheaza_pagina(client, path):
    """Un `Authorization` gunoi nu are voie să transforme pagina în 401.

    Un browser poate trimite antete reziduale; pagina legală rămâne publică oricum.
    """
    resp = await client.get(path, headers={"Authorization": "Bearer nu-e-un-token"})
    assert resp.status_code == 200


def _rute_aplatizate(routes):
    """Toate rutele, recursiv.

    FastAPI ≥ 0.139 NU mai aplatizează router-ele incluse în `app.routes`: le
    împachetează într-un `_IncludedRouter`, care ține router-ul original în
    `original_router`. O simplă iterare peste `app.routes` nu vede deloc rutele reale.
    """
    for ruta in routes:
        inclus = getattr(ruta, "original_router", None)
        sub = getattr(inclus, "routes", None) or getattr(ruta, "routes", None)
        if sub:
            yield from _rute_aplatizate(sub)
        else:
            yield ruta


def _scheme_de_securitate(dependant) -> bool:
    """True dacă undeva în arborele de dependențe există o schemă de securitate.

    (`security_requirements` a dispărut din `Dependant` în FastAPI recent — verificăm
    direct dacă vreun `call` din arbore e o schemă de securitate.)
    """
    for dep in dependant.dependencies:
        if isinstance(dep.call, SecurityBase) or _scheme_de_securitate(dep):
            return True
    return False


def test_rutele_legal_nu_au_cerinte_de_securitate():
    """Gardă de regresie: nicio rută `/legal/*` nu are dependențe de securitate."""
    rute = [
        r
        for r in _rute_aplatizate(app.routes)
        if getattr(r, "path", "").startswith("/legal")
    ]
    assert rute, "rutele /legal nu sunt montate în aplicație"
    assert {r.path for r in rute} >= set(PAGES)
    for ruta in rute:
        # Zero dependențe = zero șanse ca un `Depends(get_current_user)` global (pus
        # pe app sau pe router) să ceară token pe o pagină legală.
        assert not ruta.dependant.dependencies, (
            f"{ruta.path} are dependențe — Apple o deschide NELOGAT (Guideline 5.1.1)"
        )
        assert not _scheme_de_securitate(ruta.dependant), (
            f"{ruta.path} cere autentificare — pagina legală TREBUIE să fie publică"
        )


# --------------------------------------------------------------------------- #
# 2. Clauzele obligatorii (Guideline 1.2 + GDPR)
# --------------------------------------------------------------------------- #
@_aio
async def test_eula_contine_toleranta_zero_si_mecanismele_anti_abuz(client):
    resp = await client.get("/legal/terms")
    text = resp.text
    lower = text.lower()

    # Toleranță zero — în AMBELE limbi (recenzentul citește engleza).
    assert "toleranță zero" in lower
    assert "zero tolerance" in lower
    # ... explicit față de conținut ofensator ȘI utilizatori abuzivi.
    assert "objectionable content" in lower
    assert "abusive users" in lower
    assert "utilizatorii abuzivi" in lower

    # Mecanismele cerute: filtrare, raportare, blocare, eliminare în 24h.
    for marker in ("filtrare", "filtering", "raporta", "report", "blocare", "block"):
        assert marker in lower, f"lipsește mecanismul: {marker}"
    assert "24 de ore" in lower  # RO
    assert "24 hours" in lower  # EN

    # 18+ și contactul.
    assert "18+" in text
    assert legal.CONTACT_EMAIL in text


@_aio
async def test_privacy_contine_datele_scopurile_si_dreptul_la_stergere(client):
    resp = await client.get("/legal/privacy")
    text = resp.text
    lower = text.lower()

    # Ce colectăm (declarat explicit).
    for marker in ("e-mail", "telefon", "data nașterii", "locație", "fotografii", "mesaj"):
        assert marker in lower, f"lipsește categoria de date: {marker}"
    for marker in ("phone", "date of birth", "location", "photos", "purchase history"):
        assert marker in lower, f"lipsește categoria de date (EN): {marker}"

    # Dreptul la ștergere + perioada REALĂ de grație din cod (30 de zile).
    assert "ștergerea contului" in lower
    assert "delete account" in lower
    assert "right to be forgotten" in lower
    assert "30 de zile" in lower and "30-day" in lower

    # GDPR, 18+, contact.
    assert "gdpr" in lower
    assert "18+" in text
    assert legal.CONTACT_EMAIL in text


@_aio
async def test_privacy_declara_aceeasi_perioada_de_gratie_ca_backendul(client):
    """Politica nu are voie să mintă: cele 30 de zile trebuie să fie cele din config."""
    from app.core.config import settings

    resp = await client.get("/legal/privacy")
    assert f"{settings.account_deletion_grace_days} de zile" in resp.text
    assert f"{settings.account_deletion_grace_days}-day" in resp.text


@_aio
async def test_support_contine_contactul_si_caile_de_raportare(client):
    resp = await client.get("/legal/support")
    text = resp.text
    lower = text.lower()

    assert legal.CONTACT_EMAIL in text
    assert f"mailto:{legal.CONTACT_EMAIL}" in text  # click direct din telefon
    assert "raporta" in lower and "report" in lower
    assert "blochează" in lower or "blocare" in lower
    assert "block" in lower
    assert "24 de ore" in lower and "24 hours" in lower
    assert "18+" in text


# --------------------------------------------------------------------------- #
# 3. Bilingv + fără dependențe externe
# --------------------------------------------------------------------------- #
@_aio
@pytest.mark.parametrize("path", PAGES)
async def test_pagina_e_bilingva(client, path):
    """RO sus, EN dedesubt — ambele secțiuni prezente în ACEEAȘI pagină."""
    html_text = (await client.get(path)).text
    assert 'id="ro"' in html_text
    assert 'id="en"' in html_text
    assert html_text.index('id="ro"') < html_text.index('id="en"')


@_aio
@pytest.mark.parametrize("path", PAGES + ["/legal"])
async def test_fara_resurse_externe(client, path):
    """Zero CDN: fără `<script>`, fără fonturi/stiluri de pe alte domenii.

    O pagină legală care depinde de un CDN blocat se încarcă goală — adică, pentru
    recenzent, nu există.
    """
    lower = (await client.get(path)).text.lower()
    assert "<script" not in lower
    assert "cdn" not in lower
    assert "//fonts." not in lower
    assert "@import" not in lower
    # Singurele linkuri absolute permise sunt `mailto:` — restul sunt relative (/legal/*).
    assert 'href="http' not in lower
    assert 'src="http' not in lower


@_aio
@pytest.mark.parametrize("path", PAGES)
async def test_pagina_e_responsive(client, path):
    """Se deschid pe telefon (Linking.openURL din setari.tsx / paywall.tsx)."""
    text = (await client.get(path)).text
    assert 'name="viewport"' in text
    assert "width=device-width" in text


# --------------------------------------------------------------------------- #
# 4. Marcajul „numele operatorului — de completat"
# --------------------------------------------------------------------------- #
@_aio
async def test_marcajul_operatorului_e_vizibil_cat_timp_numele_lipseste(client):
    """Nu inventăm un SRL. Cât timp numele nu e decis, marcajul TREBUIE să se vadă."""
    if legal.OPERATOR_LEGAL_NAME.strip():
        pytest.skip("numele operatorului a fost completat — marcajul nu mai are sens")
    text = (await client.get("/legal/terms")).text
    assert "DE COMPLETAT" in text
    assert "TO BE COMPLETED" in text
    assert 'class="todo"' in text


def test_numele_operatorului_apare_in_pagini_cand_e_completat(monkeypatch):
    """Când se scrie numele în `OPERATOR_LEGAL_NAME`, apare în AMBELE documente."""
    monkeypatch.setattr(legal, "OPERATOR_LEGAL_NAME", "Ion Popescu")
    legal.render_page.cache_clear()
    try:
        for pagina in ("terms", "privacy"):
            html_text = legal.render_page(pagina)
            assert "Ion Popescu" in html_text
            assert "DE COMPLETAT" not in html_text
    finally:
        # Cache-ul e la nivel de modul: îl golim ca testele următoare să randeze
        # din nou cu valoarea reală (goală), nu cu numele fals injectat aici.
        legal.render_page.cache_clear()


def test_numele_operatorului_e_escapat(monkeypatch):
    """Chiar și o constantă a noastră trece prin escape — fără excepții „de încredere"."""
    monkeypatch.setattr(legal, "OPERATOR_LEGAL_NAME", '<img src=x onerror="alert(1)">')
    legal.render_page.cache_clear()
    try:
        html_text = legal.render_page("terms")
        assert "<img src=x" not in html_text
        assert "&lt;img" in html_text
    finally:
        legal.render_page.cache_clear()

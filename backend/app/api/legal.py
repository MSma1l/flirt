"""Pagini legale PUBLICE: `/legal/terms`, `/legal/privacy`, `/legal/support`.

DE CE EXISTĂ
------------
Fără ele aplicația NU poate fi publicată. Recenzentul App Store deschide URL-urile
dintr-un browser, **nelogat**:

- Guideline 1.2 (conținut generat de utilizatori) — EULA trebuie să declare explicit
  toleranță ZERO față de conținutul ofensator și utilizatorii abuzivi, plus filtrare,
  raportare, blocare și eliminarea abuzatorilor în 24h.
- Guideline 5.1.1 — politică de confidențialitate publică (GDPR).
- Guideline 3.1.2 — ecranul de abonament trebuie să linkuiască Termenii și
  Confidențialitatea (`mobile/src/paywall.tsx` pointează exact aici).

DE CE LA RĂDĂCINĂ, NU SUB `/api/v1`
-----------------------------------
`/legal/*` NU e API: e conținut pentru oameni, deschis din browser. Montat la rădăcină
(ca `/health`), în afara prefixului `settings.api_v1_prefix`. Rutele NU au nicio
dependență de autentificare — o pagină legală care cere token e motiv de RESPINGERE.
`tests/test_legal.py` verifică exact asta: 200 fără antet `Authorization`.

RANDARE
-------
HTML-ul stă în `app/templates/legal/*.html` (fragmentele RO+EN) + `_base.html` (layout
și CSS). Substituție cu `string.Template` (`$placeholder`), NU `str.format`: acoladele
din CSS ar fi trebuit escapate peste tot. Rezultatul e memorat în cache (`lru_cache`) —
paginile sunt statice, nu recitim fișierele la fiecare cerere.

FĂRĂ DEPENDENȚE EXTERNE: zero CDN, zero fonturi și scripturi de pe alte domenii. Pagina
trebuie să se încarce identic și într-o rețea care blochează CDN-urile.
"""
from __future__ import annotations

import html
from functools import lru_cache
from pathlib import Path
from string import Template

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(prefix="/legal", tags=["legal"])

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates" / "legal"

# Adresa publicată în toate documentele. Trebuie să fie o cutie poștală REALĂ și
# monitorizată: Apple îi scrie de acolo, iar utilizatorii raportează abuzuri.
CONTACT_EMAIL = "support@flrt.md"

# ┌─ DE COMPLETAT ───────────────────────────────────────────────────────────────┐
# │ Numele complet al PERSOANEI FIZICE care operează aplicația (nu există încă o  │
# │ firmă înregistrată — NU inventăm SRL, IDNO sau sediu). Cât timp e gol, în     │
# │ pagini apare un marcaj vizibil „DE COMPLETAT". Când numele e decis, se scrie  │
# │ AICI, o singură dată, și apare automat în Termeni + Confidențialitate.        │
# └──────────────────────────────────────────────────────────────────────────────┘
OPERATOR_LEGAL_NAME = ""

# Data ultimei actualizări a documentelor (se modifică MANUAL, la orice schimbare de
# conținut — nu `date.today()`: o politică datată „azi" la fiecare încărcare arată
# fabricat și nu spune nimic despre când s-a schimbat de fapt textul).
LAST_UPDATED_RO = "14 iulie 2026"
LAST_UPDATED_EN = "14 July 2026"

# Pagini statice: lăsăm browserul/CDN-ul să le cacheze o oră.
CACHE_CONTROL = "public, max-age=3600"

# Titlurile paginilor (bilingve — recenzentul Apple nu citește română).
_TITLES = {
    "index": "Documente legale / Legal",
    "terms": "Termeni și condiții / Terms of Service",
    "privacy": "Politica de confidențialitate / Privacy Policy",
    "support": "Suport / Support",
}


def _operator(lang: str) -> str:
    """Numele operatorului sau marcajul „de completat", dacă încă nu e decis."""
    name = OPERATOR_LEGAL_NAME.strip()
    if name:
        # Escapăm: numele e o constantă a noastră, dar nu injectăm niciodată text
        # neescapat în HTML — regula nu are excepții „de încredere".
        return html.escape(name)
    todo = (
        "DE COMPLETAT: numele complet al operatorului"
        if lang == "ro"
        else "TO BE COMPLETED: full name of the operator"
    )
    return f'<span class="todo">{todo}</span>'


@lru_cache(maxsize=8)
def render_page(page: str) -> str:
    """Randează o pagină legală (layout + fragment RO/EN). Rezultatul e cache-uit."""
    body = Template((TEMPLATES_DIR / f"{page}.html").read_text(encoding="utf-8")).substitute(
        contact_email=CONTACT_EMAIL,
        operator_ro=_operator("ro"),
        operator_en=_operator("en"),
        updated_ro=LAST_UPDATED_RO,
        updated_en=LAST_UPDATED_EN,
    )
    base = Template((TEMPLATES_DIR / "_base.html").read_text(encoding="utf-8"))
    return base.substitute(title=_TITLES[page], body=body, contact_email=CONTACT_EMAIL)


def _page(name: str) -> HTMLResponse:
    return HTMLResponse(content=render_page(name), headers={"Cache-Control": CACHE_CONTROL})


@router.get("", response_class=HTMLResponse, summary="Cuprinsul documentelor legale")
@router.get("/", response_class=HTMLResponse, include_in_schema=False)
async def legal_index() -> HTMLResponse:
    """Cuprins — ca `/legal` (fără sufix) să nu dea 404."""
    return _page("index")


@router.get("/terms", response_class=HTMLResponse, summary="Termeni și condiții (EULA)")
async def terms() -> HTMLResponse:
    """EULA — PUBLICĂ. Conține clauza de toleranță zero cerută de Guideline 1.2."""
    return _page("terms")


@router.get("/privacy", response_class=HTMLResponse, summary="Politica de confidențialitate")
async def privacy() -> HTMLResponse:
    """Politica de confidențialitate — PUBLICĂ (GDPR + Guideline 5.1.1)."""
    return _page("privacy")


@router.get("/support", response_class=HTMLResponse, summary="Suport / contact")
async def support() -> HTMLResponse:
    """Pagina de suport — PUBLICĂ. Adresa de contact cerută de Apple."""
    return _page("support")

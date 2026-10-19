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

EXCEPȚIE — POLITICA DE CONFIDENȚIALITATE: `/legal/privacy` NU are text propriu. Randează
documentul versionat `app/legal_content/privacy.{ro,en,ru}.md` (același pe care îl
acceptă utilizatorii în aplicație, prin `legal_service.render_document`), convertit în
HTML de `markdown_to_html` de mai jos. Așa pagina publică nu poate rămâne în urma
documentului acceptat (o copie HTML separată ajunsese să promită altceva decât v2.0).

FĂRĂ DEPENDENȚE EXTERNE: zero CDN, zero fonturi și scripturi de pe alte domenii. Pagina
trebuie să se încarce identic și într-o rețea care blochează CDN-urile.
"""
from __future__ import annotations

import html
import re
from functools import lru_cache
from pathlib import Path
from string import Template

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app.core.config import settings
from app.services import legal_service

router = APIRouter(prefix="/legal", tags=["legal"])

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates" / "legal"

# Adresa publicată în toate documentele. Trebuie să fie o cutie poștală REALĂ și
# monitorizată: Apple îi scrie de acolo, iar utilizatorii raportează abuzuri.
CONTACT_EMAIL = "support@flrt.md"

# ┌─ NUMELE OPERATORULUI LEGAL ───────────────────────────────────────────────────┐
# │ Numele complet al PERSOANEI FIZICE / firmei care operează aplicația. NU e      │
# │ hardcodat aici (nu inventăm SRL, IDNO sau sediu): se citește din settings /    │
# │ env `OPERATOR_LEGAL_NAME` (vezi `Settings.operator_legal_name`). Cât timp e    │
# │ gol, în pagini apare un marcaj vizibil „DE COMPLETAT". Când numele e decis, se │
# │ pune în env, o singură dată, și apare automat în Termeni + Confidențialitate.  │
# │                                                                                │
# │ Citit ca funcție (nu ca CONSTANTĂ la import) fiindcă `render_page` e memorat   │
# │ cu `lru_cache`: dacă am „înghețat" valoarea la momentul importului, o schimbare │
# │ de env în teste/redeploy n-ar mai avea efect. `_operator()` citește settings   │
# │ la fiecare randare NON-cache-uită.                                             │
# └──────────────────────────────────────────────────────────────────────────────┘
def _operator_legal_name() -> str:
    return settings.operator_legal_name

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
    name = _operator_legal_name().strip()
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


# --------------------------------------------------------------------------- #
# Markdown → HTML (doar subsetul folosit în `app/legal_content/*.md`)
# --------------------------------------------------------------------------- #
# Fără dependență nouă: documentele folosesc doar titluri `#`, paragrafe, liste `-`,
# tabele `| … |`, `**bold**` și linkuri `[text](url)`. Textul e ESCAPAT întâi (inclusiv
# valorile din config injectate în placeholdere), abia apoi se aplică marcajele —
# deci nimic din document nu poate deveni HTML activ. Linkurile acceptă doar
# `https:` și `mailto:`; orice altă schemă rămâne text simplu.
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_LIST_RE = re.compile(r"^\s*[-*]\s+(.*)$")
_TABLE_SEP_RE = re.compile(r"^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$")
_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")

# Limbile paginii publice: RO și EN (recenzentul Apple), plus RU (utilizatorii).
PRIVACY_LANGS = (("ro", "Română"), ("en", "English"), ("ru", "Русский"))


def _inline(text: str) -> str:
    out = html.escape(text, quote=True)

    def _link(m: re.Match) -> str:
        label, url = m.group(1), m.group(2)
        if url.startswith(("https://", "mailto:")):
            return f'<a href="{url}">{label}</a>'
        return label

    out = _LINK_RE.sub(_link, out)
    return _BOLD_RE.sub(r"<strong>\1</strong>", out)


def _table(rows: list[str]) -> str:
    def cells(row: str) -> list[str]:
        return [c.strip() for c in row.strip().strip("|").split("|")]

    head, body = cells(rows[0]), [r for r in rows[1:] if not _TABLE_SEP_RE.match(r.strip())]
    parts = ['<div class="table"><table>']
    if any(head):  # antet gol („| | |") = tabel cheie/valoare, fără <thead>
        parts.append("<thead><tr>" + "".join(f"<th>{_inline(c)}</th>" for c in head) + "</tr></thead>")
    parts.append("<tbody>")
    for row in body:
        parts.append("<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in cells(row)) + "</tr>")
    parts.append("</tbody></table></div>")
    return "".join(parts)


def markdown_to_html(md: str) -> str:
    """Convertește subsetul markdown al documentelor legale în HTML sigur."""
    lines = md.splitlines()
    out: list[str] = []
    para: list[str] = []

    def flush() -> None:
        if para:
            out.append(f"<p>{_inline(' '.join(para))}</p>")
            para.clear()

    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        if not stripped:
            flush()
            i += 1
            continue
        heading = _HEADING_RE.match(stripped)
        if heading:
            flush()
            level = len(heading.group(1))
            out.append(f"<h{level}>{_inline(heading.group(2))}</h{level}>")
            i += 1
            continue
        if stripped.startswith("|"):
            flush()
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i].strip())
                i += 1
            out.append(_table(rows))
            continue
        if _LIST_RE.match(lines[i]):
            flush()
            items = []
            while i < len(lines) and _LIST_RE.match(lines[i]):
                items.append(_LIST_RE.match(lines[i]).group(1))  # type: ignore[union-attr]
                i += 1
            out.append("<ul>" + "".join(f"<li>{_inline(x)}</li>" for x in items) + "</ul>")
            continue
        para.append(stripped)
        i += 1
    flush()

    result = "\n".join(out)
    # Placeholderele necompletate („[de completat]") — vizibile, ca în celelalte pagini.
    for mark in legal_service._MISSING_MARK.values():
        result = result.replace(mark, f'<span class="todo">{mark}</span>')
    return result


def _privacy_body() -> str:
    """Politica: documentul versionat (RO, EN, RU), fără text HTML duplicat."""
    sections = []
    for lang, _label in PRIVACY_LANGS:
        doc = legal_service.render_document("privacy", lang)
        sections.append(
            f'<section id="{lang}" lang="{lang}">\n{markdown_to_html(doc["content"])}\n</section>'
        )
    return "<main>\n" + "\n\n".join(sections) + "\n</main>"


def _nav(langs: tuple[tuple[str, str], ...]) -> str:
    return "\n      ".join(f'<a href="#{code}">{label}</a>' for code, label in langs)


@lru_cache(maxsize=8)
def render_page(page: str) -> str:
    """Randează o pagină legală (layout + fragment RO/EN). Rezultatul e cache-uit."""
    if page == "privacy":
        body = _privacy_body()
        nav = _nav(PRIVACY_LANGS)
    else:
        body = Template((TEMPLATES_DIR / f"{page}.html").read_text(encoding="utf-8")).substitute(
            contact_email=CONTACT_EMAIL,
            operator_ro=_operator("ro"),
            operator_en=_operator("en"),
            updated_ro=LAST_UPDATED_RO,
            updated_en=LAST_UPDATED_EN,
        )
        nav = _nav(PRIVACY_LANGS[:2])
    base = Template((TEMPLATES_DIR / "_base.html").read_text(encoding="utf-8"))
    return base.substitute(
        title=_TITLES[page], body=body, nav=nav, contact_email=CONTACT_EMAIL
    )


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

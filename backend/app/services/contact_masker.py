"""Mascarea datelor de contact din mesaje (TZ 5.5).

Modul NLP „light": scanează textul unui mesaj înainte de a fi salvat și
înlocuiește cu `****` datele care ar permite ocolirea platformei
(telefoane, email-uri, link-uri, handle-uri sociale, mențiuni de mesagerie),
astfel încât mesajul să pară în continuare organic.

Regex-urile sunt CONSTANTE la începutul modulului, ușor de extins.
Funcția `mask_contacts` este pură: nu are efecte secundare.
"""
from __future__ import annotations

import re

# Textul cu care înlocuim orice dată de contact detectată.
MASK = "****"

# --- Constante regex (ușor de extins, fără hardcodare în logică) --------------

# TLD-uri uzuale — folosite atât pentru domenii „bare", cât și pentru email-ul
# ofuscat. Lista limitează false-positive-urile pe cuvinte cu punct.
_TLD = (
    r"com|net|org|io|me|ru|md|ua|ro|info|app|link|gg|tv"
)

# 1) Email „clasic": nume@domeniu.tld
EMAIL_RE = re.compile(
    r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}",
)

# 1b) Email OFUSCAT — tehnica clasică de ocolire (TZ 5.5): `@`/`.` scrise ca
#     `(at)`/`[at]`/` at ` și `(dot)`/`[dot]`/` dot `. Cerem AMBELE separatoare
#     (at ȘI dot) + un TLD din listă, ca varianta scrisă în litere (` at `/` dot `)
#     să nu prindă fraze organice („ne vedem la mare"), ci doar adrese reale.
_AT_SEP = r"(?:\s*(?:@|\(at\)|\[at\])\s*|\s+at\s+)"
_DOT_SEP = r"(?:\s*(?:\.|\(dot\)|\[dot\])\s*|\s+dot\s+)"
OBFUSCATED_EMAIL_RE = re.compile(
    r"[A-Za-z0-9._%+\-]+" + _AT_SEP + r"[A-Za-z0-9\-]+" + _DOT_SEP
    + r"(?:" + _TLD + r")\b",
    re.IGNORECASE,
)

# 2) URL-uri explicite (cu schemă sau `www.`), inclusiv linkuri de mesagerie.
URL_RE = re.compile(
    r"\b(?:https?://|www\.)[^\s]+",
    re.IGNORECASE,
)

# 3) Domenii „bare" (fără schemă) pe TLD-uri uzuale + eventual o cale.
#    `\s*` în jurul punctelor prinde și ofuscarea prin spații („gmail . com").
BARE_DOMAIN_RE = re.compile(
    r"\b[A-Za-z0-9\-]+(?:\s*\.\s*[A-Za-z0-9\-]+)*"
    r"\s*\.\s*(?:" + _TLD + r")\b"
    r"(?:\s*/[^\s]*)?",
    re.IGNORECASE,
)

# 4) Mențiuni de mesagerie: cuvânt-cheie urmat de un nick. Mascăm DOAR nick-ul,
#    păstrând cuvântul-cheie („telegram ****"), ca în TZ. Cheia trebuie să fie
#    cuvânt întreg (`\b...\b`), altfel `want2go` s-ar mascha ca `wa****`.
#
# 4a) Chei „tari" (telegram/instagram/…): contextul e neechivoc, deci mascăm
#     ORICE nick care urmează, inclusiv unul pur alfabetic sau cu punct
#     (`telegram ionpopescu`, `telegram ion.popescu`).
MESSENGER_STRONG_RE = re.compile(
    r"\b(?P<kw>telegram|instagram|whatsapp|viber|"
    r"телеграм|инстаграм|ватсап|вайбер)\b"
    r"(?P<sep>[\s:\-—]*)"
    r"(?P<nick>@?[\w.]{2,})",
    re.IGNORECASE,
)

# 4b) Chei „scurte"/ambigue (tg/wa/insta/…): ca să nu stricăm text organic,
#     cerem un nick care ori începe cu `@`, ori conține cifră/underscore.
MESSENGER_WEAK_RE = re.compile(
    r"\b(?P<kw>tg|insta|инста|ig|wapp|wa)\b"
    r"(?P<sep>[\s:\-—]*)"
    r"(?P<nick>@[\w.]{2,}|[\w.]*[_\d][\w.]*)",
    re.IGNORECASE,
)

# 5) Handle social generic: `@nume` (min 2 caractere după @).
#    Negative lookbehind pe `\w` ca să nu prindem cozile de email deja mascate.
HANDLE_RE = re.compile(r"(?<![\w@])@[A-Za-z0-9_.]{2,}")

# 6) Telefon: secvență de cifre cu separatori uzuali; validată prin numărul
#    de cifre în callback (evită să prindem numere scurte / ani / prețuri).
PHONE_CANDIDATE_RE = re.compile(r"(?<!\w)\+?\d[\d\s\-().]{5,}\d(?!\w)")
MIN_PHONE_DIGITS = 7  # sub acest prag nu considerăm un număr de telefon


def _mask_phone(match: re.Match[str]) -> str:
    """Înlocuiește candidatul cu `****` doar dacă are destule cifre reale."""
    digits = sum(ch.isdigit() for ch in match.group(0))
    return MASK if digits >= MIN_PHONE_DIGITS else match.group(0)


def _mask_messenger(match: re.Match[str]) -> str:
    """Păstrează cuvântul-cheie + separatorul, ascunde doar nick-ul."""
    return f"{match.group('kw')}{match.group('sep')}{MASK}"


def mask_contacts(text: str) -> tuple[str, bool]:
    """Ascunde datele de contact dintr-un mesaj.

    Întoarce `(text_mascat, s_a_mascat_ceva)`. Ordinea contează:
    întâi tipare specifice (email/url/mesagerie), apoi cele generice
    (handle/telefon), ca să evităm mascări parțiale sau duble.
    """
    if not text:
        return text, False

    masked = text
    # Ordinea: cele mai specifice / cu context întâi.
    masked = EMAIL_RE.sub(MASK, masked)
    masked = OBFUSCATED_EMAIL_RE.sub(MASK, masked)
    masked = URL_RE.sub(MASK, masked)
    masked = BARE_DOMAIN_RE.sub(MASK, masked)
    masked = MESSENGER_STRONG_RE.sub(_mask_messenger, masked)
    masked = MESSENGER_WEAK_RE.sub(_mask_messenger, masked)
    masked = HANDLE_RE.sub(MASK, masked)
    masked = PHONE_CANDIDATE_RE.sub(_mask_phone, masked)

    return masked, masked != text

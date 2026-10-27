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

# ANTI-ReDoS (toate tiparele de mai jos): cuantificatori MĂRGINIȚI și ancore
# prin lookbehind. Un tipar ca `[A-Za-z0-9._%+\-]+@...` fără ancoră e încercat de
# la FIECARE poziție a unui șir lung fără `@`, iar fiecare încercare scanează până
# la capăt → O(n²): 8 000 de caractere „aaaa…" costau ~1 s de CPU, sincron, pe
# event loop. Cu lookbehind-ul „nu începe în mijlocul unui token" + plafoanele
# RFC (local ≤ 64, etichetă de domeniu ≤ 63), fiecare poziție costă O(1).
_LOCAL_PART = r"(?<![A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]{1,64}"
_DOMAIN_LABEL = r"[A-Za-z0-9\-]{1,63}"

# 1) Email „clasic": nume@domeniu.tld
EMAIL_RE = re.compile(
    _LOCAL_PART + r"@[A-Za-z0-9.\-]{1,253}\.[A-Za-z]{2,24}",
)

# 1b) Email OFUSCAT — tehnica clasică de ocolire (TZ 5.5): `@`/`.` scrise ca
#     `(at)`/`[at]`/` at ` și `(dot)`/`[dot]`/` dot `. Cerem AMBELE separatoare
#     (at ȘI dot) + un TLD din listă, ca varianta scrisă în litere (` at `/` dot `)
#     să nu prindă fraze organice („ne vedem la mare"), ci doar adrese reale.
_AT_SEP = r"(?:\s{0,3}(?:@|\(at\)|\[at\])\s{0,3}|\s{1,3}at\s{1,3})"
_DOT_SEP = r"(?:\s{0,3}(?:\.|\(dot\)|\[dot\])\s{0,3}|\s{1,3}dot\s{1,3})"
OBFUSCATED_EMAIL_RE = re.compile(
    _LOCAL_PART + _AT_SEP + _DOMAIN_LABEL + _DOT_SEP
    + r"(?:" + _TLD + r")\b",
    re.IGNORECASE,
)

# 2) URL-uri explicite (cu schemă sau `www.`), inclusiv linkuri de mesagerie.
URL_RE = re.compile(
    r"\b(?:https?://|www\.)[^\s]+",
    re.IGNORECASE,
)

# 3) Domenii „bare" (fără schemă) pe TLD-uri uzuale + eventual o cale.
#    Spațiile în jurul punctelor prind și ofuscarea („gmail . com"). Începem doar
#    la marginea unui token (lookbehind) și plafonăm numărul de etichete (≤ 8) și
#    lungimea lor — fără asta, `a.a.a.a…` sau `a-a-a-…` era pătratic.
_SPACED_DOT = r"\s{0,3}\.\s{0,3}"
BARE_DOMAIN_RE = re.compile(
    r"(?<![\w\-])" + _DOMAIN_LABEL
    + r"(?:" + _SPACED_DOT + _DOMAIN_LABEL + r"){0,7}"
    + _SPACED_DOT + r"(?:" + _TLD + r")\b"
    r"(?:\s{0,3}/[^\s]{0,200})?",
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
    r"(?P<sep>[\s:\-—]{0,5})"
    r"(?P<nick>@?[\w.]{2,64})",
    re.IGNORECASE,
)

# 4b) Chei „scurte"/ambigue (tg/wa/insta/…): ca să nu stricăm text organic,
#     cerem un nick care ori începe cu `@`, ori conține cifră/underscore.
MESSENGER_WEAK_RE = re.compile(
    r"\b(?P<kw>tg|insta|инста|ig|wapp|wa)\b"
    r"(?P<sep>[\s:\-—]{0,5})"
    r"(?P<nick>@[\w.]{2,64}|[\w.]{0,64}[_\d][\w.]{0,64})",
    re.IGNORECASE,
)

# 5) Handle social generic: `@nume` (min 2 caractere după @).
#    Negative lookbehind pe `\w` ca să nu prindem cozile de email deja mascate.
HANDLE_RE = re.compile(r"(?<![\w@])@[A-Za-z0-9_.]{2,64}")

# 6) Telefon: secvență de cifre cu separatori uzuali; validată prin numărul
#    de cifre în callback (evită să prindem numere scurte / ani / prețuri).
#    Separator acceptat și o SINGURĂ literă între două cifre (`069a123b45` —
#    ocolirea „cifre despărțite de litere"); literele nu se numără ca cifre, deci
#    textul normal („am 25 de ani", „COVID19") nu atinge pragul de 7 cifre.
#    Lungime plafonată (anti-ReDoS): un șir lung de cifre e mascat pe bucăți.
_PHONE_SEP = r"(?:[\d\s\-().]|(?<=\d)[^\W\d_](?=\d))"
PHONE_CANDIDATE_RE = re.compile(
    r"(?<!\w)\+?\d" + _PHONE_SEP + r"{5,40}\d(?!\w)"
)
MIN_PHONE_DIGITS = 7  # sub acest prag nu considerăm un număr de telefon

# Plafon de lungime pentru textul mascat (defense-in-depth peste tiparele
# liniare): schemele limitează deja mesajele / „despre" mult sub această valoare.
MAX_MASK_INPUT_CHARS = 10_000


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

    # Defense-in-depth: niciun apelant nu are voie să trimită aici un text
    # nemărginit (rulează sincron, pe event loop). Peste plafon tăiem.
    text = text[:MAX_MASK_INPUT_CHARS]
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

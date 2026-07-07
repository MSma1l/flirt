"""Validatori reutilizabili de input — validare defensivă pe backend (anti-XSS
stocat, control chars, lungime, non-gol). Aplicați în schemele Pydantic.

Regula: fiecare string de la user e curățat (trim), non-gol unde e obligatoriu,
plafonat ca lungime, fără caractere de control și fără tag-uri HTML/`<script>`
acolo unde textul nu e HTML (prevenire XSS stocat servit în alte contexte).
"""
import re
from typing import Annotated

from pydantic import AfterValidator, StringConstraints

# Caractere de control (exceptând \n, \t) — nu au ce căuta în input text.
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# Tag-uri HTML / script — respinse în text simplu (anti-XSS stocat).
_HTML_RE = re.compile(r"<[^>]*>")


def no_control_chars(v: str) -> str:
    if _CONTROL_RE.search(v):
        raise ValueError("Textul conține caractere de control nepermise.")
    return v


def no_html(v: str) -> str:
    """Respinge tag-uri HTML (ex. <script>) în câmpuri de text simplu."""
    if _HTML_RE.search(v):
        raise ValueError("Textul nu poate conține marcaje HTML.")
    return v


def _clean(v: str) -> str:
    return no_html(no_control_chars(v))


def safe_str(max_length: int, min_length: int = 1) -> type:
    """Tip string sigur: trim automat, non-gol (min 1), plafon lungime, fără
    control chars / HTML. Folosește ca `name: safe_str(120)`.
    """
    return Annotated[
        str,
        StringConstraints(
            strip_whitespace=True, min_length=min_length, max_length=max_length
        ),
        AfterValidator(_clean),
    ]


def optional_safe_str(max_length: int) -> type:
    """Ca `safe_str` dar permite None (câmp opțional); string gol după trim → interzis."""
    return Annotated[
        str,
        StringConstraints(
            strip_whitespace=True, min_length=1, max_length=max_length
        ),
        AfterValidator(_clean),
    ]


# URL de storage propriu — allowlist schemă https (validat suplimentar în serviciu
# față de domeniul din settings.storage_base_url).
_URL_RE = re.compile(r"^https://[^\s<>\"']{1,500}$")


def is_https_url(v: str) -> str:
    if not _URL_RE.match(v):
        raise ValueError("URL invalid (se acceptă doar https).")
    return v

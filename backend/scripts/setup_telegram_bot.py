#!/usr/bin/env python
"""Configurează botul Telegram: profilul (comenzi, descrieri, nume, meniu, poză)
și, la cerere, webhookul.

PROBLEMA PE CARE O REZOLVĂ
--------------------------
Un bot Telegram nu „află" singur unde e serverul nostru și nici cum să se
prezinte. Cineva trebuie să apeleze, după deploy:
  - `setMyCommands` — meniul „/" (ro implicit + ru, en, ro; implicit și în
    chat-urile private);
  - `setMyDescription` / `setMyShortDescription` — textul din chat-ul gol înainte
    de „Start" și cel din profil / previzualizarea la partajare;
  - `setMyName` — numele afișat;
  - `setChatMenuButton` — butonul persistent „FLIRT" care deschide Mini App-ul;
  - `setMyProfilePhoto` (opțional, `--with-photo`) — avatarul botului;
  - `setWebhook` (DOAR dacă e dat un URL de webhook) — ca Telegram să ne trimită
    update-urile (`message` + `callback_query`), cu secretul de antet.

IDEMPOTENT: descrierile și numele se citesc întâi (`getMy*`) și se scriu doar
dacă diferă (`setMyName` are limite stricte de frecvență). Comenzile și butonul
de meniu se rescriu (operații ieftine, rezultat identic). Poza de profil NU se
trimite implicit: fiecare trimitere adaugă încă o poză în istoricul botului.

DE CE UN SCRIPT ȘI NU UN APEL LA PORNIREA APLICAȚIEI
----------------------------------------------------
`setWebhook` e global pe bot: dacă l-ar apela fiecare instanță la boot, o
pornire accidentală a mediului de staging ar FURA update-urile producției
(ultimul `setWebhook` câștigă). Un script rulat manual, din interiorul
mașinii/containerului, face pasul explicit și intenționat.

UTILIZARE
---------
    # Profilul botului (fără să atingă webhookul; îl verifică doar):
    docker compose exec -T api python scripts/setup_telegram_bot.py

    # + poza de profil (o singură dată, sau când se schimbă avatarul):
    docker compose exec -T api python scripts/setup_telegram_bot.py --with-photo

    # + (re)înregistrarea webhookului (URL-ul dat explicit sau din TELEGRAM_WEBHOOK_URL):
    docker compose exec -T api python scripts/setup_telegram_bot.py \\
        --webhook-url https://api.flrt.md/api/v1/telegram/webhook

    # Doar afișează ce ar face, fără niciun apel (nu cere token):
    python scripts/setup_telegram_bot.py --dry-run

    # Dezactivează livrarea update-urilor (ex. înainte de o migrare):
    python scripts/setup_telegram_bot.py --delete-webhook

SECURITATE: tokenul NU se tipărește niciodată (nici trunchiat) și nu se acceptă
din argumente — ar ajunge în `ps aux` și în istoricul shell-ului. Se citește doar
din mediu, prin `settings`.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

# Permite rularea directă (`python scripts/setup_telegram_bot.py`) din backend/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import bot_texts, telegram_bot  # noqa: E402

# Calea rutei de webhook (trebuie să corespundă cu `api/v1/telegram.py`).
WEBHOOK_PATH = "/telegram/webhook"

# Variabila de mediu din care se poate lua direct URL-ul complet de webhook.
WEBHOOK_URL_ENV_VAR = "TELEGRAM_WEBHOOK_URL"

# Textul butonului persistent de meniu (limita Telegram: 64 de caractere).
MENU_BUTTON_TEXT = bot_texts.MENU_BUTTON_TEXT

# Limbile profilului: `None` = implicit (oricine fără traducere dedicată) → ro.
PROFILE_LANGS: tuple[tuple[str | None, str], ...] = (
    (None, "ro"),
    ("ro", "ro"),
    ("ru", "ru"),
    ("en", "en"),
)

# Scopurile comenzilor: implicit + toate chat-urile private (Telegram alege cel mai
# specific scop existent, deci le setăm pe amândouă la fel).
COMMAND_SCOPES: tuple[dict | None, ...] = (None, {"type": "all_private_chats"})

BOTFATHER_PHOTO_STEPS = (
    "Poza de profil se pune manual din @BotFather:\n"
    "      1. Deschide @BotFather → /mybots → alege botul\n"
    "      2. Edit Bot → Edit Botpic\n"
    "      3. Trimite fișierul backend/app/assets/bot/avatar.png din repo (640x640) ca POZĂ"
)


def _default_webhook_url() -> str:
    """URL-ul de webhook din mediu (`TELEGRAM_WEBHOOK_URL`), dacă e setat.

    Nu îl deducem din alte setări: aplicația nu cunoaște URL-ul ei public
    (nginx face terminarea TLS), iar un URL ghicit greșit ar ajunge la Telegram
    ca webhook valid și ar rupe botul tăcut.
    """
    return os.environ.get(WEBHOOK_URL_ENV_VAR, "").strip()


def _require_token() -> None:
    """Refuză să ruleze fără token. NU tipărește tokenul."""
    if telegram_bot.bot_token():
        return
    raise SystemExit(
        "TELEGRAM_BOT_TOKEN lipsește.\n"
        "Ia tokenul de la @BotFather și pune-l în mediu (sau în backend/.env):\n"
        "    TELEGRAM_BOT_TOKEN=...\n"
        "Scriptul NU acceptă tokenul ca argument: ar ajunge în `ps aux` și în "
        "istoricul shell-ului."
    )


def _warn_if_stub() -> None:
    """Avertizează dacă modul e 'stub': apelurile vor fi doar simulate."""
    if telegram_bot.auth_mode() == "live":
        return
    print(
        "ATENȚIE: TELEGRAM_AUTH_MODE nu e 'live' → apelurile sunt SIMULATE "
        "(niciun apel real către Telegram).\n"
        "Setează TELEGRAM_AUTH_MODE=live ca să configurezi botul cu adevărat."
    )


class Summary:
    """Ce s-a setat, ce s-a sărit, ce a eșuat și ce rămâne de făcut manual."""

    def __init__(self) -> None:
        self.done: list[str] = []
        self.skipped: list[str] = []
        self.failed: list[str] = []
        self.manual: list[str] = []

    def record(self, label: str, result: dict) -> bool:
        if result.get("stub"):
            print(f"  [simulat] {label}: OK (mod stub, fără rețea)")
            self.done.append(f"{label} (simulat)")
            return True
        if result.get("ok"):
            print(f"  {label}: OK")
            self.done.append(label)
            return True
        detail = result.get("description") or result.get("error") or "eroare necunoscută"
        print(f"  {label}: EȘUAT — {detail}")
        self.failed.append(f"{label}: {detail}")
        return False

    def print(self) -> None:
        print("\n================ REZUMAT ================")
        print(f"Setate ({len(self.done)}):")
        for item in self.done:
            print(f"  ✓ {item}")
        if self.skipped:
            print(f"Deja la zi, sărite ({len(self.skipped)}):")
            for item in self.skipped:
                print(f"  = {item}")
        if self.failed:
            print(f"EȘUATE ({len(self.failed)}):")
            for item in self.failed:
                print(f"  ✗ {item}")
        if self.manual:
            print("DE FĂCUT MANUAL:")
            for item in self.manual:
                print(f"  → {item}")
        print("=========================================")


def _lang_label(code: str | None) -> str:
    return code or "implicit"


def _current(result: dict, field: str) -> str | None:
    """Valoarea curentă din `getMy*` (None dacă nu s-a putut citi / stub)."""
    if result.get("stub") or not result.get("ok"):
        return None
    value = (result.get("result") or {}).get(field)
    return value if isinstance(value, str) else None


def _validate_texts() -> None:
    """Limitele Telegram, verificate ÎNAINTE de orice apel."""
    for lang in bot_texts.LANGS:
        assert len(bot_texts.DESCRIPTION[lang]) <= 512, f"descriere {lang} > 512"
        assert len(bot_texts.SHORT_DESCRIPTION[lang]) <= 120, f"descriere scurtă {lang} > 120"
        assert 1 <= len(bot_texts.BOT_NAME[lang]) <= 64, f"nume {lang}"
        for name, desc in bot_texts.COMMANDS[lang]:
            assert 1 <= len(name) <= 32 and name.islower(), f"comandă {name}"
            assert 1 <= len(desc) <= 256, f"descriere comandă {name}"


def _print_plan(webhook_url: str, with_photo: bool) -> None:
    print("Plan:")
    for code, lang in PROFILE_LANGS:
        cmds = ", ".join(f"/{c}" for c, _ in bot_texts.COMMANDS[lang])
        print(f"  setMyCommands [{_lang_label(code)}; implicit + chat-uri private]: {cmds}")
    for code, lang in PROFILE_LANGS:
        print(f"  setMyName [{_lang_label(code)}]: {bot_texts.BOT_NAME[lang]}")
        print(f"  setMyShortDescription [{_lang_label(code)}]: {bot_texts.SHORT_DESCRIPTION[lang]}")
        print(
            f"  setMyDescription [{_lang_label(code)}]: "
            f"{len(bot_texts.DESCRIPTION[lang])} caractere"
        )
    miniapp = telegram_bot.miniapp_url() or "(TELEGRAM_MINIAPP_URL nesetat → sărit)"
    print(f"  setChatMenuButton: „{MENU_BUTTON_TEXT}” → {miniapp}")
    print(f"  setMyProfilePhoto: {'DA (' + telegram_bot.AVATAR_IMAGE.name + ')' if with_photo else 'nu (adaugă --with-photo)'}")
    if webhook_url:
        print(
            f"  setWebhook: {webhook_url} (allowed_updates="
            f"{telegram_bot.ALLOWED_UPDATES}, secret din TELEGRAM_WEBHOOK_SECRET)"
        )
    else:
        print("  webhook: doar verificare (getWebhookInfo), fără modificări")


async def _setup_profile(summary: Summary) -> None:
    print("\nComenzi:")
    for code, lang in PROFILE_LANGS:
        for scope in COMMAND_SCOPES:
            scope_label = scope["type"] if scope else "default"
            summary.record(
                f"setMyCommands [{_lang_label(code)}/{scope_label}]",
                await telegram_bot.set_my_commands(bot_texts.COMMANDS[lang], scope, code),
            )

    print("\nNume și descrieri:")
    for code, lang in PROFILE_LANGS:
        label = _lang_label(code)

        name = bot_texts.BOT_NAME[lang]
        if _current(await telegram_bot.get_my_name(code), "name") == name:
            summary.skipped.append(f"setMyName [{label}]")
            print(f"  setMyName [{label}]: deja „{name}”")
        else:
            summary.record(f"setMyName [{label}]", await telegram_bot.set_my_name(name, code))

        short = bot_texts.SHORT_DESCRIPTION[lang]
        current_short = _current(
            await telegram_bot.get_my_short_description(code), "short_description"
        )
        if current_short == short:
            summary.skipped.append(f"setMyShortDescription [{label}]")
            print(f"  setMyShortDescription [{label}]: deja la zi")
        else:
            summary.record(
                f"setMyShortDescription [{label}]",
                await telegram_bot.set_my_short_description(short, code),
            )

        desc = bot_texts.DESCRIPTION[lang]
        if _current(await telegram_bot.get_my_description(code), "description") == desc:
            summary.skipped.append(f"setMyDescription [{label}]")
            print(f"  setMyDescription [{label}]: deja la zi")
        else:
            summary.record(
                f"setMyDescription [{label}]",
                await telegram_bot.set_my_description(desc, code),
            )

    print("\nButonul de meniu:")
    miniapp = telegram_bot.miniapp_url()
    if not miniapp.startswith("https://"):
        print("  setChatMenuButton: SĂRIT — TELEGRAM_MINIAPP_URL lipsește sau nu e HTTPS")
        summary.manual.append("Setează TELEGRAM_MINIAPP_URL (HTTPS) și rulează din nou scriptul.")
    else:
        summary.record(
            "setChatMenuButton",
            await telegram_bot.set_chat_menu_button(miniapp, MENU_BUTTON_TEXT),
        )


async def _setup_photo(summary: Summary) -> None:
    print("\nPoza de profil:")
    result = await telegram_bot.set_my_profile_photo(telegram_bot.AVATAR_IMAGE)
    if result.get("ok"):
        summary.record("setMyProfilePhoto", result)
        return
    # Metodă necunoscută pe acest server Bot API → 404 „Not Found".
    not_found = result.get("error_code") == 404 or "not found" in str(
        result.get("description", "")
    ).lower()
    if not_found:
        print("  setMyProfilePhoto: metoda NU există pe acest Bot API.")
        summary.manual.append(BOTFATHER_PHOTO_STEPS)
        return
    summary.record("setMyProfilePhoto", result)
    summary.manual.append(BOTFATHER_PHOTO_STEPS)


async def _check_webhook(summary: Summary) -> None:
    """Afișează webhookul curent și ce lipsește — FĂRĂ să-l modifice."""
    print("\nWebhook (verificare):")
    info = await telegram_bot.get_webhook_info()
    if info.get("stub"):
        print("  [simulat] getWebhookInfo")
        return
    if not info.get("ok"):
        print(f"  getWebhookInfo: EȘUAT — {info.get('description') or info.get('error')}")
        return
    data = info.get("result") or {}
    url = data.get("url") or ""
    allowed = data.get("allowed_updates") or []
    print(f"  url             : {url or '(niciunul — botul NU primește update-uri)'}")
    print(f"  allowed_updates : {allowed or '(implicit: toate, inclusiv callback_query)'}")
    print(f"  în așteptare    : {data.get('pending_update_count', 0)}")
    if data.get("last_error_message"):
        print(f"  ultima eroare   : {telegram_bot._redact(data.get('last_error_message'))}")

    fix = (
        "Rulează din nou cu --webhook-url "
        f"{url or 'https://api.flrt.md/api/v1' + WEBHOOK_PATH} (același URL; secretul "
        "se ia din TELEGRAM_WEBHOOK_SECRET) ca să setezi "
        f"allowed_updates={telegram_bot.ALLOWED_UPDATES}."
    )
    if not url:
        summary.manual.append("Webhookul nu e setat. " + fix)
    elif allowed and not set(telegram_bot.ALLOWED_UPDATES) <= set(allowed):
        print("  ATENȚIE: lipsește callback_query/message din allowed_updates")
        summary.manual.append("Butoanele „Ajutor/Contacte” nu vor răspunde. " + fix)
    else:
        print("  OK: primește mesaje și apăsări de butoane")


async def _set_webhook(summary: Summary, webhook_url: str) -> None:
    secret = telegram_bot.webhook_secret()
    if not secret:
        raise SystemExit(
            "TELEGRAM_WEBHOOK_SECRET lipsește.\n"
            "Fără el, oricine poate POST-a update-uri false pe rută. Generează-l cu:\n"
            "    python -c \"import secrets; print(secrets.token_urlsafe(32))\"\n"
            "și pune-l în mediu ca TELEGRAM_WEBHOOK_SECRET (aceeași valoare și în "
            "backend/.env, ca ruta să îl poată verifica)."
        )
    print("\nWebhook:")
    summary.record("setWebhook", await telegram_bot.set_webhook(webhook_url, secret))


async def _run(args: argparse.Namespace) -> int:
    _validate_texts()

    if args.delete_webhook:
        print("Dezactivez webhookul botului...")
        if args.dry_run:
            print("  [dry-run] deleteWebhook")
            return 0
        _require_token()
        _warn_if_stub()
        summary = Summary()
        return 0 if summary.record("deleteWebhook", await telegram_bot.delete_webhook()) else 1

    webhook_url = (args.webhook_url or _default_webhook_url()).strip()
    if webhook_url and not webhook_url.startswith("https://"):
        raise SystemExit(f"Telegram acceptă DOAR webhook-uri HTTPS. Primit: {webhook_url}")

    username = telegram_bot.bot_username()
    print("Configurez botul Telegram:")
    print(f"  bot        : @{username}" if username else "  bot        : (username nesetat)")
    print(f"  mini app   : {telegram_bot.miniapp_url() or '(nesetat)'}")
    print("  token      : " + ("setat (nu se afișează)" if telegram_bot.bot_token() else "LIPSĂ"))
    _print_plan(webhook_url, args.with_photo)

    if args.dry_run:
        print("\n[dry-run] Nu s-a făcut niciun apel.")
        return 0

    _require_token()
    _warn_if_stub()

    summary = Summary()
    await _setup_profile(summary)
    if args.with_photo:
        await _setup_photo(summary)
    else:
        summary.manual.append(
            "Poza de profil nu a fost trimisă: rulează o dată cu --with-photo "
            "(sau manual din @BotFather → Edit Botpic, fișierul app/assets/bot/avatar.png)."
        )
    if webhook_url:
        await _set_webhook(summary, webhook_url)
    await _check_webhook(summary)

    summary.print()
    if summary.failed:
        print(
            "\nCel puțin un apel a eșuat. Verifică tokenul (la @BotFather), "
            "conectivitatea spre api.telegram.org și că URL-ul de webhook e public."
        )
        return 1
    print("\nGata. Deschide chat-ul cu botul și trimite /start — trebuie să vezi poza de bun venit.")
    return 0


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Configurează profilul (comenzi, descrieri, meniu, poză) și webhookul botului FLIRT.",
    )
    parser.add_argument(
        "--webhook-url",
        default="",
        help="Dacă e dat (sau setat în "
        f"{WEBHOOK_URL_ENV_VAR}), apelează și setWebhook. Calea rutei este {WEBHOOK_PATH}.",
    )
    parser.add_argument(
        "--with-photo",
        action="store_true",
        help="Trimite și poza de profil (app/assets/bot/avatar.png) prin setMyProfilePhoto.",
    )
    parser.add_argument(
        "--delete-webhook",
        action="store_true",
        help="Dezactivează livrarea update-urilor (deleteWebhook) și iese.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Afișează ce s-ar configura, fără niciun apel către Telegram.",
    )
    return asyncio.run(_run(parser.parse_args(argv)))


if __name__ == "__main__":
    try:
        sys.exit(_main())
    except KeyboardInterrupt:
        print("\nAnulat.")
        sys.exit(1)

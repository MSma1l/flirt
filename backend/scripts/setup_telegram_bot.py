#!/usr/bin/env python
"""Configurează botul Telegram: webhookul + butonul de meniu al Mini App-ului.

PROBLEMA PE CARE O REZOLVĂ
--------------------------
Un bot Telegram nu „află" singur unde e serverul nostru. Cineva trebuie să
apeleze O SINGURĂ DATĂ, după deploy, `setWebhook` (ca Telegram să ne trimită
update-urile, cu secretul de antet) și `setChatMenuButton` (ca fiecare chat cu
botul să aibă butonul persistent care deschide Mini App-ul). Fără acest pas,
botul e mut: `/start` nu ajunge niciodată la noi.

DE CE UN SCRIPT ȘI NU UN APEL LA PORNIREA APLICAȚIEI
----------------------------------------------------
`setWebhook` e global pe bot: dacă l-ar apela fiecare instanță la boot, o
pornire accidentală a mediului de staging ar FURA update-urile producției
(ultimul `setWebhook` câștigă). Un script rulat manual, din interiorul
mașinii/containerului, face pasul explicit și intenționat.

UTILIZARE
---------
    # Din containerul API, cu variabilele deja în mediu:
    docker compose exec api python scripts/setup_telegram_bot.py

    # Local, cu URL dat explicit:
    TELEGRAM_BOT_TOKEN='...' TELEGRAM_AUTH_MODE=live \
    TELEGRAM_WEBHOOK_SECRET='...' TELEGRAM_MINIAPP_URL='https://...' \
    python scripts/setup_telegram_bot.py --webhook-url https://api.flrt.md/api/v1/telegram/webhook

    # Doar afișează ce ar face, fără niciun apel:
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

from app.services import telegram_bot  # noqa: E402

# Calea rutei de webhook (trebuie să corespundă cu `api/v1/telegram.py`).
WEBHOOK_PATH = "/telegram/webhook"

# Variabila de mediu din care se poate lua direct URL-ul complet de webhook.
WEBHOOK_URL_ENV_VAR = "TELEGRAM_WEBHOOK_URL"

# Textul butonului persistent de meniu (limita Telegram: 64 de caractere).
MENU_BUTTON_TEXT = "Deschide FLIRT"


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


def _report(label: str, result: dict) -> bool:
    """Tipărește rezultatul unui apel. Întoarce True dacă a reușit."""
    if result.get("stub"):
        print(f"  [simulat] {label}: OK (mod stub, fără rețea)")
        return True
    if result.get("ok"):
        print(f"  {label}: OK")
        return True
    detail = result.get("description") or result.get("error") or "eroare necunoscută"
    print(f"  {label}: EȘUAT — {detail}")
    return False


async def _run(args: argparse.Namespace) -> int:
    _require_token()
    _warn_if_stub()

    if args.delete_webhook:
        print("Dezactivez webhookul botului...")
        if args.dry_run:
            print("  [dry-run] deleteWebhook")
            return 0
        return 0 if _report("deleteWebhook", await telegram_bot.delete_webhook()) else 1

    webhook_url = (args.webhook_url or _default_webhook_url()).strip()
    if not webhook_url:
        raise SystemExit(
            "URL-ul de webhook lipsește.\n"
            f"Dă-l cu --webhook-url, sau setează {WEBHOOK_URL_ENV_VAR} "
            "(ex. https://api.flrt.md/api/v1/telegram/webhook)."
        )
    if not webhook_url.startswith("https://"):
        raise SystemExit(
            f"Telegram acceptă DOAR webhook-uri HTTPS. Primit: {webhook_url}"
        )

    secret = telegram_bot.webhook_secret()
    if not secret:
        raise SystemExit(
            "TELEGRAM_WEBHOOK_SECRET lipsește.\n"
            "Fără el, oricine poate POST-a update-uri false pe rută. Generează-l cu:\n"
            "    python -c \"import secrets; print(secrets.token_urlsafe(32))\"\n"
            "și pune-l în mediu ca TELEGRAM_WEBHOOK_SECRET (aceeași valoare și în "
            "backend/.env, ca ruta să îl poată verifica)."
        )

    miniapp_url = telegram_bot.miniapp_url()
    if not miniapp_url:
        raise SystemExit(
            "TELEGRAM_MINIAPP_URL lipsește.\n"
            "E URL-ul HTTPS al Mini App-ului (paginile web servite userului în "
            "Telegram). Setează-l înainte de a configura butonul de meniu."
        )
    if not miniapp_url.startswith("https://"):
        raise SystemExit(
            f"Mini App-ul trebuie servit pe HTTPS. Primit: {miniapp_url}"
        )

    username = telegram_bot.bot_username()
    print("Configurez botul Telegram:")
    print(f"  bot        : @{username}" if username else "  bot        : (username nesetat)")
    print(f"  webhook    : {webhook_url}")
    print(f"  mini app   : {miniapp_url}")
    print("  secret     : setat (nu se afișează)")
    print("  token      : setat (nu se afișează)")

    if args.dry_run:
        print("\n[dry-run] Nu s-a făcut niciun apel.")
        return 0

    print()
    ok = _report("setWebhook", await telegram_bot.set_webhook(webhook_url, secret))
    ok = _report(
        "setChatMenuButton",
        await telegram_bot.set_chat_menu_button(miniapp_url, MENU_BUTTON_TEXT),
    ) and ok

    if ok:
        print(
            "\nGata. Verifică deschizând un chat cu botul și trimițând /start — "
            "trebuie să primești mesajul de bun venit cu butonul „"
            f"{MENU_BUTTON_TEXT}"
            "\"."
        )
        return 0

    print(
        "\nCel puțin un apel a eșuat. Verifică tokenul (la @BotFather), "
        "conectivitatea spre api.telegram.org și că URL-ul de webhook e public."
    )
    return 1


def _main() -> int:
    parser = argparse.ArgumentParser(
        description="Configurează webhookul și butonul de meniu ale botului FLIRT.",
    )
    parser.add_argument(
        "--webhook-url",
        default="",
        help="URL-ul HTTPS complet al rutei de webhook (implicit: din "
        f"{WEBHOOK_URL_ENV_VAR}). Calea rutei este {WEBHOOK_PATH}.",
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
    return asyncio.run(_run(parser.parse_args()))


if __name__ == "__main__":
    try:
        sys.exit(_main())
    except KeyboardInterrupt:
        print("\nAnulat.")
        sys.exit(1)

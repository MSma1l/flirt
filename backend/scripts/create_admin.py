#!/usr/bin/env python
"""Creează (sau promovează) un cont de ADMINISTRATOR — bootstrap-ul panoului.

PROBLEMA PE CARE O REZOLVĂ (problema „oul și găina"):
Toate rutele `/api/v1/admin/*` cer rolul `admin`, iar rolul `admin` se poate
acorda doar... din panoul de admin. Într-o bază proaspătă de producție nu există
niciun administrator, deci nimeni nu se poate loga în panou, deci nimeni nu poate
face pe nimeni administrator. Fără scriptul ăsta, panoul e inaccesibil PENTRU
TOTDEAUNA după deploy.

DE CE UN SCRIPT ȘI NU UN ENDPOINT „primul user devine admin":
Un astfel de endpoint e o cursă clasică: dacă cineva nimerește instanța înainte
de tine (sau baza e resetată din greșeală), primul care se înregistrează devine
administratorul PRODUCȚIEI. Un script rulat manual, din interiorul mașinii/
containerului, cere acces la infrastructură — adică exact garanția pe care o vrem.

DE CE NU IA PAROLA DIN ARGUMENTE:
Parola citită din `--password` ar ajunge în istoricul shell-ului (`~/.zsh_history`),
în lista de procese (`ps aux` o vede în clar, pentru ORICE user de pe mașină) și
în log-urile de audit ale orchestratorului. Aici se citește de la terminal, cu
ecoul oprit (`getpass`), sau dintr-o variabilă de mediu pentru rulările automate.

UTILIZARE
---------
    # Interactiv (recomandat) — parola se cere la terminal, nu se vede:
    python scripts/create_admin.py admin@flirt.md

    # Neinteractiv (CI / provisioning), parola dintr-o variabilă de mediu:
    ADMIN_PASSWORD='...' python scripts/create_admin.py admin@flirt.md --from-env

    # În Docker:
    docker compose exec api python scripts/create_admin.py admin@flirt.md

IDEMPOTENT: dacă emailul există deja, contul e PROMOVAT la rolul `admin` (parola
nu se schimbă decât dacă ceri explicit `--reset-password`). Deci re-rularea nu
strică nimic și poate fi folosită și ca „am uitat parola de admin".
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import re
import sys

# Permite rularea directă (`python scripts/create_admin.py`) din rădăcina backend.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.db.session import AsyncSessionLocal, engine  # noqa: E402
from app.models.user import ROLE_ADMIN, User  # noqa: E402

# Variabila de mediu folosită cu `--from-env` (provisioning automat).
PASSWORD_ENV_VAR = "ADMIN_PASSWORD"

# Cerințe minime de parolă pentru un cont care poate bana și ȘTERGE conturi.
# Deliberat mai stricte decât la un user obișnuit: aici nu există „doar contul meu".
MIN_PASSWORD_LENGTH = 12

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email(email: str) -> str:
    normalized = email.strip().lower()
    if not _EMAIL_RE.match(normalized):
        raise SystemExit(f"Email invalid: {email!r}")
    return normalized


def _validate_password(password: str) -> str:
    """Refuză parolele slabe ÎNAINTE de a le hash-ui."""
    problems: list[str] = []
    if len(password) < MIN_PASSWORD_LENGTH:
        problems.append(f"minim {MIN_PASSWORD_LENGTH} caractere")
    if not re.search(r"[a-z]", password):
        problems.append("cel puțin o literă mică")
    if not re.search(r"[A-Z]", password):
        problems.append("cel puțin o literă mare")
    if not re.search(r"\d", password):
        problems.append("cel puțin o cifră")
    if problems:
        raise SystemExit("Parolă prea slabă pentru un cont de admin: " + ", ".join(problems))
    return password


def _read_password(from_env: bool) -> str:
    """Citește parola FĂRĂ să o expună în `ps aux` sau în istoricul shell-ului."""
    if from_env:
        password = os.environ.get(PASSWORD_ENV_VAR, "")
        if not password:
            raise SystemExit(
                f"--from-env cere variabila de mediu {PASSWORD_ENV_VAR} (e goală)."
            )
        return _validate_password(password)

    if not sys.stdin.isatty():
        raise SystemExit(
            "Terminal indisponibil. Folosește --from-env cu "
            f"{PASSWORD_ENV_VAR} pentru rulări neinteractive."
        )

    password = getpass.getpass("Parolă admin (nu se afișează): ")
    confirm = getpass.getpass("Confirmă parola: ")
    if password != confirm:
        raise SystemExit("Parolele nu coincid.")
    return _validate_password(password)


async def create_admin(email: str, password: str, reset_password: bool) -> str:
    """Creează sau promovează contul. Întoarce un mesaj de stare pentru operator."""
    async with AsyncSessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == email))

        if user is None:
            db.add(
                User(
                    email=email,
                    password_hash=hash_password(password),
                    role=ROLE_ADMIN,
                    # Contul de admin nu trece prin anketă: nu apare în feed și
                    # nu are profil. E un cont de OPERARE, nu de dating.
                    profile_completed=False,
                )
            )
            await db.commit()
            return f"Cont de admin CREAT: {email}"

        # Contul există → îl promovăm (idempotent).
        was_admin = user.role == ROLE_ADMIN
        user.role = ROLE_ADMIN
        # Un cont banat care e promovat la admin ar fi respins instantaneu de
        # `require_admin` (banul se verifică înaintea rolului) → ridicăm banul,
        # altfel operatorul ar primi un 403 inexplicabil după un script „reușit".
        if user.banned_at is not None:
            user.banned_at = None
            user.ban_reason = None

        changed_password = False
        if reset_password:
            user.password_hash = hash_password(password)
            changed_password = True

        await db.commit()

        if was_admin and not changed_password:
            return f"Contul era deja admin, nimic de schimbat: {email}"
        if changed_password:
            return f"Cont de admin ACTUALIZAT (rol + parolă nouă): {email}"
        return f"Cont existent PROMOVAT la admin: {email}"


async def _main() -> int:
    parser = argparse.ArgumentParser(
        description="Creează sau promovează un cont de administrator FLIRT.",
    )
    parser.add_argument("email", help="Emailul contului de admin.")
    parser.add_argument(
        "--from-env",
        action="store_true",
        help=f"Citește parola din variabila de mediu {PASSWORD_ENV_VAR} "
        "(pentru CI / provisioning, fără terminal).",
    )
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="Dacă emailul există deja, îi SCHIMBĂ parola (recuperare acces).",
    )
    args = parser.parse_args()

    email = _validate_email(args.email)

    # Parola e necesară doar dacă (a) creăm un cont nou sau (b) resetăm explicit.
    # Ca să nu cerem inutil o parolă când doar promovăm un cont existent, verificăm
    # întâi dacă userul există.
    async with AsyncSessionLocal() as db:
        exists = await db.scalar(select(User.id).where(User.email == email))

    needs_password = exists is None or args.reset_password
    password = _read_password(args.from_env) if needs_password else ""

    try:
        message = await create_admin(email, password, args.reset_password)
        print(message)
        return 0
    finally:
        await engine.dispose()


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(_main()))
    except KeyboardInterrupt:
        print("\nAnulat.")
        sys.exit(1)

#!/usr/bin/env python
"""Purjare GDPR — șterge definitiv conturile cu perioada de grație expirată.

RO: `account_service.purge_expired_accounts()` exista, dar NU îl apela nimeni:
datele „șterse" de utilizatori rămâneau în DB pe termen nelimitat. E o problemă
LEGALĂ (GDPR art. 17 — dreptul la ștergere), nu doar tehnică. Scriptul ăsta e
apelantul lipsă.

Rulare:
    python scripts/gdpr_purge.py            # o singură trecere (cron extern)
    python scripts/gdpr_purge.py --loop     # buclă (serviciul `purge` din compose)

Intervalul buclei: `GDPR_PURGE_INTERVAL_SECONDS` (implicit 3600 = o oră).

De ce un proces SEPARAT și nu un task în lifespan-ul API-ului: `entrypoint.sh`
pornește 4 workeri gunicorn — un task în lifespan ar rula de 4 ori în paralel.
Aici avem o singură instanță, deci o singură purjare.

Idempotent: după purjare cererea de ștergere e consumată, deci re-rularea (sau o
rulare dublă accidentală) nu strică nimic.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys

# Permite rularea directă (`python scripts/gdpr_purge.py`) din rădăcina backend.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings  # noqa: E402
from app.core.logging import configure_logging  # noqa: E402
from app.db.session import AsyncSessionLocal, engine  # noqa: E402
from app.services.account_service import purge_expired_accounts  # noqa: E402

DEFAULT_INTERVAL_SECONDS = 3600

log = logging.getLogger("app.gdpr_purge")


def _interval_seconds() -> int:
    """Intervalul între purjări, din config (`GDPR_PURGE_INTERVAL_SECONDS`)."""
    return max(60, settings.gdpr_purge_interval_seconds)  # sub un minut protejăm DB-ul


async def run_once() -> int:
    """O trecere de purjare. Întoarce numărul de conturi șterse definitiv."""
    async with AsyncSessionLocal() as db:
        purged = await purge_expired_accounts(db)
    if purged:
        log.info("purjare GDPR", extra={"purged_accounts": purged})
    else:
        log.debug("purjare GDPR: nimic de șters")
    return purged


async def run_loop() -> None:
    interval = _interval_seconds()
    log.info("purjare GDPR pornită", extra={"interval_seconds": interval})
    while True:
        try:
            await run_once()
        except Exception:
            # O eroare (DB temporar indisponibil) NU are voie să oprească bucla:
            # altfel purjarea moare tăcut și datele rămân în DB.
            log.exception("purjare GDPR eșuată; reîncerc la următorul ciclu")
        await asyncio.sleep(interval)


async def _main() -> int:
    if "--help" in sys.argv or "-h" in sys.argv:
        print(__doc__)
        return 0

    configure_logging()
    loop_mode = "--loop" in sys.argv
    try:
        if loop_mode:
            await run_loop()
            return 0
        purged = await run_once()
        print(f"Conturi purjate: {purged}")
        return 0
    finally:
        await engine.dispose()


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(_main()))
    except KeyboardInterrupt:
        sys.exit(0)

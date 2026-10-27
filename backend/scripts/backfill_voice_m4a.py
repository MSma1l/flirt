#!/usr/bin/env python
"""Backfill: mesajele vocale DEJA trimise → M4A/AAC nefragmentat (redabil pe iOS).

RO: vocalele trimise înainte de conversia completă au rămas în formatul
browserului care le-a înregistrat: WebM/Opus (`.weba`, Android/desktop Chrome),
Ogg/Opus, AAC brut (`.aac`) sau MP4 FRAGMENTAT din `MediaRecorder`. WebView-ul
Telegram de pe iOS nu le poate reda (iar nginx servea `.weba`/`.aac` ca
`application/octet-stream`) — „я не могу прослушать". Uploadurile noi trec prin
`chat_media.ensure_playable_voice`; scriptul aduce mesajele vechi la același
format.

Rulare (în containerul API — are ffmpeg; din rădăcina backend):
    python scripts/backfill_voice_m4a.py --dry-run
    python scripts/backfill_voice_m4a.py --limit 20
    python scripts/backfill_voice_m4a.py
    python scripts/backfill_voice_m4a.py --delete-old   # șterge și fișierele vechi

Pentru fiecare mesaj `kind='voice'`: citește fișierul din storage, îl convertește,
îl salvează sub o cheie NOUĂ `.m4a` (cheile sunt imuabile, cache-ul nginx e de un
an) și actualizează URL-ul / tipul / mărimea / durata mesajului. Fișierul vechi
rămâne pe disc dacă nu se cere `--delete-old` (rollback simplu).

Idempotent: un vocal deja M4A nefragmentat (sau MP3) e sărit.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import uuid
from dataclasses import dataclass, field

# Permite rularea directă (`python scripts/backfill_voice_m4a.py`) din rădăcina backend.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import chat_media  # noqa: E402
from app.services.chat_media import (  # noqa: E402
    ChatMedia,
    _sniff_av,
    build_attachment_key,
    ensure_playable_voice,
    is_universal_voice,
    needs_voice_transcode,
)

log = logging.getLogger("app.backfill_voice_m4a")


@dataclass
class VoiceRow:
    id: uuid.UUID
    chat_id: uuid.UUID
    url: str
    duration_ms: int | None


@dataclass
class Stats:
    converted: int = 0
    skipped: int = 0  # deja M4A nefragmentat / MP3
    missing: int = 0  # URL în DB fără fișier
    invalid: int = 0  # nu e un fișier audio recunoscut
    failed: int = 0  # conversia a eșuat
    errors: list[str] = field(default_factory=list)


async def convert_row(storage, row: VoiceRow, *, dry_run: bool, stats: Stats) -> dict | None:
    """Convertește un vocal; întoarce câmpurile noi ale mesajului (sau None)."""
    found = await storage.read(row.url)
    if found is None:
        stats.missing += 1
        return None
    content = found[0]
    av = _sniff_av(content)
    if av is None or av[0] != "voice":
        stats.invalid += 1
        stats.errors.append(f"{row.id}: format necunoscut")
        return None
    media = ChatMedia(kind="voice", mime=av[1], content=content, duration_ms=row.duration_ms)
    if not needs_voice_transcode(media):
        stats.skipped += 1
        return None
    if dry_run:
        stats.converted += 1
        return None

    out = await ensure_playable_voice(media)
    if out is media or not is_universal_voice(out.content):
        stats.failed += 1
        stats.errors.append(f"{row.id}: conversia a eșuat ({media.mime})")
        return None
    key = build_attachment_key(row.chat_id, out.mime)
    url = await storage.save(key, out.content, out.mime)
    stats.converted += 1
    return {
        "attachment_url": url,
        "attachment_mime": out.mime,
        "attachment_size": len(out.content),
        "attachment_duration_ms": out.duration_ms,
    }


async def run(*, limit: int | None, dry_run: bool, delete_old: bool) -> Stats:
    from sqlalchemy import select, update

    from app.db.session import AsyncSessionLocal
    from app.models.chat import Message
    from app.services.storage import get_storage

    stats = Stats()
    if not dry_run and chat_media._ffmpeg_path() is None:
        log.error("ffmpeg lipsește — rulează scriptul în containerul `api`")
        stats.errors.append("ffmpeg lipsește")
        return stats

    storage = get_storage()
    async with AsyncSessionLocal() as db:
        query = (
            select(Message.id, Message.chat_id, Message.attachment_url, Message.attachment_duration_ms)
            .where(Message.kind == "voice", Message.attachment_url.is_not(None))
            .order_by(Message.created_at)
        )
        rows = [VoiceRow(*r) for r in (await db.execute(query)).all()]
    if limit is not None:
        rows = rows[:limit]

    for row in rows:
        try:
            fields = await convert_row(storage, row, dry_run=dry_run, stats=stats)
        except Exception as exc:  # noqa: BLE001 — un fișier stricat nu oprește restul
            stats.failed += 1
            stats.errors.append(f"{row.id}: {exc}")
            continue
        if not fields:
            continue
        async with AsyncSessionLocal() as db:
            await db.execute(update(Message).where(Message.id == row.id).values(**fields))
            await db.commit()
        log.info("vocal %s → %s", row.id, fields["attachment_url"])
        if delete_old:
            try:
                await storage.delete(row.url)
            except Exception as exc:  # noqa: BLE001
                stats.errors.append(f"{row.id}: fișierul vechi nu s-a șters: {exc}")
    return stats


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Convertește vocalele vechi în M4A/AAC.")
    p.add_argument("--dry-run", action="store_true", help="nu scrie nimic, doar raportează")
    p.add_argument("--limit", type=int, default=None, help="procesează cel mult N mesaje")
    p.add_argument(
        "--delete-old", action="store_true", help="șterge fișierul vechi după conversie"
    )
    return p.parse_args(argv)


async def _main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        stats = await run(limit=args.limit, dry_run=args.dry_run, delete_old=args.delete_old)
    finally:
        from app.db.session import engine

        await engine.dispose()
    log.info(
        "%sgata: convertite=%d sărite=%d lipsă=%d invalide=%d eșuate=%d",
        "[dry-run] " if args.dry_run else "",
        stats.converted, stats.skipped, stats.missing, stats.invalid, stats.failed,
    )
    for err in stats.errors[:50]:
        log.warning("  %s", err)
    return 1 if stats.failed or "ffmpeg lipsește" in stats.errors else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))

#!/usr/bin/env python
"""Backfill: variante WebP (+ original fără EXIF) pentru pozele DEJA încărcate.

RO: pozele vechi s-au salvat la mărimea originală (până la 8 MB, cu EXIF/GPS).
Fluxurile noi de upload folosesc `image_variants.process_image` +
`save_with_variants`; scriptul ăsta aduce pozele existente la același format,
ca miniapp-ul să găsească `<hex>_256.webp` / `<hex>_800.webp` lângă original.

Rulare (din rădăcina backend, în containerul API ori cu .venv):
    python scripts/backfill_photo_variants.py --dry-run
    python scripts/backfill_photo_variants.py --limit 50
    python scripts/backfill_photo_variants.py                       # profiles.photos
    python scripts/backfill_photo_variants.py --prefix stories/     # fișierele din storage
    python scripts/backfill_photo_variants.py --prefix events/ --sizes 256,800,480

Surse:
- implicit: URL-urile din `profiles.photos` (doar cele din storage-ul propriu);
- `--prefix P`: listează direct obiectele din storage sub prefixul P (disc
  pentru providerul `local`, `list_objects_v2` pentru `s3`) — pentru povești,
  coperțile evenimentelor etc. Se iau doar `<32 hex>.(jpg|jpeg|png|webp)`.

Originalul:
- `.jpg`/`.jpeg` → rescris LA ACEEAȘI CHEIE cu JPEG-ul curățat (fără EXIF/GPS,
  micșorat la 1600px). URL-ul din DB nu se schimbă.
- `.png`/`.webp` → originalul rămâne NEATINS, se scriu doar variantele. Motiv:
  conținutul curățat e JPEG, iar a-l scrie sub o cheie `.png` ar minți despre
  tip (LocalStorage deduce Content-Type din extensie, deci browserul ar primi
  `image/png` cu bytes JPEG), iar schimbarea cheii ar cere actualizarea
  URL-ului peste tot unde e referit (profil, chat, povești) — în afara scopului
  unui backfill sigur. Upload-urile png/webp au fost oricum re-encodate la
  încărcare; miniapp-ul va cere aproape mereu variantele WebP.

Idempotent: o cheie care are deja `_256.webp` (prima variantă) e sărită — o
re-rulare (sau una întreruptă) continuă de unde a rămas. Providerul `stub` nu
are fișiere → nimic de făcut.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import re
import sys
from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass, field

# Permite rularea directă (`python scripts/backfill_photo_variants.py`) din rădăcina backend.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings  # noqa: E402
from app.services import storage as storage_mod  # noqa: E402
from app.services.image_variants import (  # noqa: E402
    DEFAULT_VARIANTS,
    InvalidImage,
    process_image,
    variant_key,
)

log = logging.getLogger("app.backfill_photo_variants")

# Cheie „originală" generată de server: `<prefix>/.../<32 hex>.<ext imagine>`.
_ORIGINAL_RE = re.compile(r"(?:^|/)[0-9a-f]{32}\.(?:jpg|jpeg|png|webp)$", re.IGNORECASE)
_JPEG_EXTS = (".jpg", ".jpeg")


def is_original_key(key: str) -> bool:
    """True pentru o cheie de imagine originală (nu variantă, nu video)."""
    return bool(_ORIGINAL_RE.search(key))


def keys_from_photo_lists(photo_lists: Iterable[list | None]) -> list[str]:
    """URL-urile din `profiles.photos` → cheile proprii, unice, în ordine."""
    seen: set[str] = set()
    keys: list[str] = []
    for photos in photo_lists:
        for url in photos or []:
            if not isinstance(url, str):
                continue
            key = storage_mod._relative_key(url)
            if key and is_original_key(key) and key not in seen:
                seen.add(key)
                keys.append(key)
    return keys


# --------------------------------------------------------------------------- #
# Acces brut la obiecte (pe cheie) — local și S3
# --------------------------------------------------------------------------- #


class LocalBlobs:
    """Fișiere pe disc sub `storage_local_dir` (aceeași rădăcină ca LocalStorage)."""

    def __init__(self) -> None:
        self._storage = storage_mod.LocalStorage()

    def exists(self, key: str) -> bool:
        return self._storage._path_for_key(key).is_file()

    def read(self, key: str) -> bytes:
        return self._storage._path_for_key(key).read_bytes()

    def write(self, key: str, content: bytes, content_type: str) -> None:
        target = self._storage._path_for_key(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + ".tmp")
        tmp.write_bytes(content)
        os.replace(tmp, target)  # atomic: serverul nu servește un fișier pe jumătate

    def list_keys(self, prefix: str) -> list[str]:
        root = self._storage._root()
        base = self._storage._path_for_key(prefix)
        if not base.is_dir():
            return []
        return sorted(
            p.relative_to(root).as_posix() for p in base.rglob("*") if p.is_file()
        )


class S3Blobs:
    """Obiecte în bucketul S3 din settings."""

    def __init__(self) -> None:
        self._client = storage_mod.S3Storage()._client()
        self._bucket = settings.s3_bucket

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return False
            raise

    def read(self, key: str) -> bytes:
        return self._client.get_object(Bucket=self._bucket, Key=key)["Body"].read()

    def write(self, key: str, content: bytes, content_type: str) -> None:
        self._client.put_object(
            Bucket=self._bucket, Key=key, Body=content, ContentType=content_type
        )

    def list_keys(self, prefix: str) -> list[str]:
        keys: list[str] = []
        paginator = self._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
            keys.extend(obj["Key"] for obj in page.get("Contents", []))
        return sorted(keys)


def get_blobs():
    provider = settings.storage_provider
    if provider == "local":
        return LocalBlobs()
    if provider == "s3":
        return S3Blobs()
    return None  # stub: nu există fișiere


# --------------------------------------------------------------------------- #
# Backfill
# --------------------------------------------------------------------------- #


@dataclass
class Stats:
    processed: int = 0
    skipped: int = 0  # deja au variante
    missing: int = 0  # cheie în DB fără fișier
    invalid: int = 0  # nu se decodează
    failed: int = 0  # altă eroare (I/O, rețea)
    bytes_before: int = 0
    bytes_after: int = 0
    errors: list[str] = field(default_factory=list)


def backfill_key(blobs, key: str, *, sizes: tuple[int, ...], dry_run: bool, stats: Stats) -> str:
    """Procesează o cheie; întoarce statusul (`processed`/`skipped`/...)."""
    if not sizes:
        raise ValueError("sizes gol")
    if blobs.exists(variant_key(key, sizes[0])):
        stats.skipped += 1
        return "skipped"
    if not blobs.exists(key):
        stats.missing += 1
        return "missing"
    content = blobs.read(key)
    try:
        processed = process_image(content, variants=sizes)
    except InvalidImage as exc:
        stats.invalid += 1
        stats.errors.append(f"{key}: {exc}")
        return "invalid"

    rewrite_original = key.lower().endswith(_JPEG_EXTS)
    stats.bytes_before += len(content)
    stats.bytes_after += len(processed.original) if rewrite_original else len(content)
    if not dry_run:
        # Variantele întâi; prima variantă (marcajul de idempotență) ULTIMA dintre
        # ele, ca o întrerupere să nu lase cheia „marcată" cu variante lipsă.
        for size in sorted(processed.variants, key=lambda n: n == sizes[0]):
            blobs.write(variant_key(key, size), processed.variants[size], "image/webp")
        if rewrite_original:
            blobs.write(key, processed.original, "image/jpeg")
    stats.processed += 1
    return "processed"


async def iter_profile_photo_keys() -> AsyncIterator[str]:
    """Cheile din `profiles.photos` (import DB lazy: testele nu au nevoie de el)."""
    from sqlalchemy import select

    from app.db.session import AsyncSessionLocal
    from app.models.profile import Profile

    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Profile.photos))).scalars().all()
    for key in keys_from_photo_lists(rows):
        yield key


async def run(
    *,
    prefix: str | None,
    limit: int | None,
    dry_run: bool,
    sizes: tuple[int, ...],
    blobs=None,
    keys: list[str] | None = None,
) -> Stats:
    stats = Stats()
    blobs = blobs if blobs is not None else get_blobs()
    if blobs is None:
        log.warning("providerul de storage '%s' nu are fișiere — nimic de făcut",
                    settings.storage_provider)
        return stats

    if keys is None:
        if prefix:
            listed = await asyncio.to_thread(blobs.list_keys, prefix)
            keys = [k for k in listed if is_original_key(k)]
        else:
            keys = [k async for k in iter_profile_photo_keys()]
    if limit is not None:
        keys = keys[:limit]

    total = len(keys)
    log.info("backfill pornit: %d chei, dry_run=%s, sizes=%s", total, dry_run, sizes)
    for i, key in enumerate(keys, 1):
        try:
            status = await asyncio.to_thread(
                backfill_key, blobs, key, sizes=sizes, dry_run=dry_run, stats=stats
            )
        except Exception as exc:  # noqa: BLE001 — o cheie stricată nu oprește restul
            stats.failed += 1
            stats.errors.append(f"{key}: {exc!r}")
            status = "failed"
        if i % 25 == 0 or i == total or status in ("invalid", "failed"):
            log.info("[%d/%d] %s %s", i, total, status, key)
    log.info(
        "gata: procesate=%d sărite=%d lipsă=%d invalide=%d erori=%d, "
        "originale %.1f MB → %.1f MB",
        stats.processed, stats.skipped, stats.missing, stats.invalid, stats.failed,
        stats.bytes_before / 1e6, stats.bytes_after / 1e6,
    )
    return stats


def _parse_sizes(raw: str) -> tuple[int, ...]:
    sizes = tuple(int(x) for x in raw.split(",") if x.strip())
    if not sizes or any(n <= 0 for n in sizes):
        raise argparse.ArgumentTypeError("--sizes: listă de întregi pozitivi, ex. 256,800")
    return sizes


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Backfill variante WebP pentru pozele existente.")
    p.add_argument("--dry-run", action="store_true", help="nu scrie nimic, doar raportează")
    p.add_argument("--limit", type=int, default=None, help="procesează cel mult N chei")
    p.add_argument(
        "--prefix", default=None,
        help="listează obiectele din storage sub prefix (ex. stories/, events/) "
             "în loc de profiles.photos",
    )
    p.add_argument(
        "--sizes", type=_parse_sizes, default=DEFAULT_VARIANTS,
        help="mărimile variantelor (prima e marcajul de idempotență), implicit 256,800",
    )
    return p.parse_args(argv)


async def _main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        stats = await run(
            prefix=args.prefix, limit=args.limit, dry_run=args.dry_run, sizes=args.sizes
        )
    finally:
        if not args.prefix:
            from app.db.session import engine

            await engine.dispose()
    for err in stats.errors[:50]:
        log.warning("eroare: %s", err)
    return 1 if stats.failed else 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(_main()))
    except KeyboardInterrupt:
        sys.exit(130)

#!/usr/bin/env python
"""Generează imaginile botului Telegram din logo: bannerul de bun venit + avatarul.

CE PRODUCE
----------
- `app/assets/bot/welcome.png` — 1280x720, trimis ca POZĂ la `/start` (vezi
  `services/telegram_bot.send_welcome_photo`). Fundal închis în degradeu, o
  strălucire roz de brand (#ff2d78) în spatele logoului, logoul pe centru și o
  linie scurtă dedesubt.
- `app/assets/bot/avatar.png` — 640x640, poza de profil a botului. Telegram o
  decupează în CERC și o arată la ~40px în lista de chat-uri, deci logoul e mare,
  centrat și cu un contur deschis — altfel literele vișinii dispar pe fundal închis.

DE CE PNG-URILE SUNT ÎN REPO
----------------------------
Imaginea de producție NU are fonturi de sistem și nici nu are nevoie de Pillow la
rulare. Scriptul se rulează O DATĂ, local (sau când se schimbă logoul), iar
rezultatele se comit. Sursa logoului e `mobile/assets/logo.png` (PNG transparent);
nu o copiem în backend — imaginea Docker are nevoie doar de rezultate.

UTILIZARE (din backend/):
    .venv/bin/python scripts/generate_bot_images.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ASSETS = Path(__file__).resolve().parent.parent / "app" / "assets" / "bot"
# Sursa logoului: logoul aplicației din monorepo (fundal transparent).
LOGO_SOURCE = Path(__file__).resolve().parents[2] / "mobile" / "assets" / "logo.png"

# Culorile de brand.
BRAND_PINK = (255, 45, 120)          # #ff2d78
BG_TOP = (26, 6, 22)                 # vișiniu aproape negru
BG_BOTTOM = (8, 3, 10)               # aproape negru
HALO = (255, 236, 244)               # contur deschis în jurul literelor

TAGLINE = "Dating  •  Flirt Party  •  Bilete"

# Fonturi încercate în ordine (scriptul rulează pe mașina de dezvoltare). Dacă
# niciunul nu există, banner-ul iese fără linia de text — nu crăpăm.
_FONT_CANDIDATES = (
    "/System/Library/Fonts/Avenir Next.ttc",
    "/System/Library/Fonts/Supplemental/Futura.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)


def _font(size: int) -> ImageFont.FreeTypeFont | None:
    for path in _FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                # index 2 în Avenir Next.ttc = Demi Bold; pe alte fișiere încercăm 0.
                return ImageFont.truetype(path, size, index=2 if "Avenir" in path else 0)
            except OSError:
                try:
                    return ImageFont.truetype(path, size)
                except OSError:
                    continue
    return None


def _gradient(size: tuple[int, int]) -> Image.Image:
    """Degradeu vertical BG_TOP → BG_BOTTOM."""
    w, h = size
    column = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        column.putpixel(
            (0, y), tuple(int(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM))
        )
    return column.resize((w, h))


def _glow(canvas: Image.Image, center: tuple[int, int], radius: int, alpha: int) -> None:
    """Strălucire roz difuză (elipsă estompată) compusă peste fundal."""
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    cx, cy = center
    draw.ellipse(
        (cx - radius, cy - int(radius * 0.72), cx + radius, cy + int(radius * 0.72)),
        fill=BRAND_PINK + (alpha,),
    )
    layer = layer.filter(ImageFilter.GaussianBlur(radius // 2))
    canvas.alpha_composite(layer)


def _logo(width: int) -> Image.Image:
    """Logoul redimensionat, cu un contur deschis (halo) pentru contrast."""
    src = Image.open(LOGO_SOURCE).convert("RGBA")
    bbox = src.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if bbox:
        src = src.crop(bbox)
    ratio = width / src.width
    logo = src.resize((width, int(src.height * ratio)), Image.LANCZOS)

    pad = max(8, width // 40)
    out = Image.new("RGBA", (logo.width + 2 * pad, logo.height + 2 * pad), (0, 0, 0, 0))
    alpha = Image.new("L", out.size, 0)
    alpha.paste(logo.getchannel("A"), (pad, pad))
    # Conturul: alfa dilatat (MaxFilter) + puțin estompat.
    stroke = alpha.filter(ImageFilter.MaxFilter(2 * (pad // 2) + 1))
    stroke = stroke.filter(ImageFilter.GaussianBlur(pad / 4))
    halo = Image.new("RGBA", out.size, HALO + (0,))
    halo.putalpha(ImageChops.multiply(stroke, Image.new("L", out.size, 235)))
    out.alpha_composite(halo)
    out.alpha_composite(logo, (pad, pad))
    return out


def make_welcome(path: Path) -> None:
    size = (1280, 720)
    canvas = _gradient(size).convert("RGBA")
    _glow(canvas, (640, 330), 520, 120)
    _glow(canvas, (640, 330), 300, 110)

    logo = _logo(700)
    font = _font(40)
    text_h = 70 if font else 0
    top = (size[1] - logo.height - text_h) // 2
    canvas.alpha_composite(logo, ((size[0] - logo.width) // 2, top))

    if font:
        draw = ImageDraw.Draw(canvas)
        tw = draw.textlength(TAGLINE, font=font)
        draw.text(
            ((size[0] - tw) / 2, top + logo.height + 18),
            TAGLINE,
            font=font,
            fill=(255, 255, 255, 235),
        )
    canvas.convert("RGB").save(path, "PNG", optimize=True)


def make_avatar(path: Path) -> None:
    size = (640, 640)
    canvas = _gradient(size).convert("RGBA")
    _glow(canvas, (320, 320), 330, 150)
    # Telegram decupează în cerc: logoul trebuie să încapă în ~78% din diametru.
    logo = _logo(470)
    canvas.alpha_composite(logo, ((size[0] - logo.width) // 2, (size[1] - logo.height) // 2))
    canvas.convert("RGB").save(path, "PNG", optimize=True)


def main() -> int:
    if not LOGO_SOURCE.exists():
        print(f"Lipsește sursa logoului: {LOGO_SOURCE}")
        return 1
    ASSETS.mkdir(parents=True, exist_ok=True)
    make_welcome(ASSETS / "welcome.png")
    make_avatar(ASSETS / "avatar.png")
    print(f"Generat: {ASSETS / 'welcome.png'}")
    print(f"Generat: {ASSETS / 'avatar.png'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

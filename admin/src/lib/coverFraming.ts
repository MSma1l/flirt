/**
 * Încadrarea copertei unui eveniment (punct focal + zoom), ca funcții PURE.
 *
 * OGLINDA EXACTĂ a lui `miniapp/src/features/events/coverFraming.ts`: aceleași
 * proporții de ramă (`COVER_RATIO`) și aceeași formulă CSS. Dacă una se schimbă,
 * se schimbă și cealaltă — altfel adminul vede altceva decât utilizatorul.
 *
 * Formula: `<img object-fit: cover>` cu
 *   - `object-position: x% y%` — punctul focal al imaginii stă în punctul
 *     (x%, y%) al ramei;
 *   - `transform: scale(z)` cu `transform-origin` în același punct — zoom-ul nu
 *     mută punctul focal.
 *
 * Valorile se trimit backendului ca fracții (`cover_focus_x/y` ∈ [0, 1],
 * `cover_zoom` ∈ [1, 3]), validate și acolo (`AdminEventIn`).
 */
import type { CSSProperties } from 'react';

/** Proporțiile ramelor (lățime / înălțime) — identice cu cele din miniapp. */
export const COVER_RATIO = {
  /** Coperta cardului din lista de evenimente. */
  card: 2,
  /** Posterul de pe pagina evenimentului. */
  hero: 4 / 3,
} as const;

export const COVER_FOCUS_DEFAULT = 0.5;
export const COVER_ZOOM_MIN = 1;
export const COVER_ZOOM_MAX = 3;

export interface Framing {
  x: number;
  y: number;
  zoom: number;
}

export const DEFAULT_FRAMING: Framing = {
  x: COVER_FOCUS_DEFAULT,
  y: COVER_FOCUS_DEFAULT,
  zoom: COVER_ZOOM_MIN,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Valori sigure: lipsă / NaN / în afara intervalului → centru, zoom 1. */
export function normalizeFraming(f: Partial<Framing>): Framing {
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  return {
    x: ok(f.x) ? clamp(f.x, 0, 1) : COVER_FOCUS_DEFAULT,
    y: ok(f.y) ? clamp(f.y, 0, 1) : COVER_FOCUS_DEFAULT,
    zoom: ok(f.zoom) ? clamp(f.zoom, COVER_ZOOM_MIN, COVER_ZOOM_MAX) : COVER_ZOOM_MIN,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Stilul `<img>`-ului: același ca în miniapp (`coverImageStyle`). */
export function coverImageStyle(f: Partial<Framing>): CSSProperties {
  const { x, y, zoom } = normalizeFraming(f);
  const position = `${round(x * 100)}% ${round(y * 100)}%`;
  return {
    objectFit: 'cover',
    objectPosition: position,
    transformOrigin: position,
    transform: zoom === 1 ? undefined : `scale(${round(zoom)})`,
  };
}

/**
 * Noul punct focal după o tragere cu `(dx, dy)` pixeli într-o ramă `frameW ×
 * frameH`, pentru o imagine cu proporțiile `naturalW × naturalH`.
 *
 * Imaginea „urmează degetul": cu `object-fit: cover` imaginea randată are
 * `imgW = naturalW · s` (s = scara de acoperire), iar după zoom `imgW · z`.
 * Surplusul care poate fi plimbat prin ramă e `imgW · z − frameW`; o tragere de
 * `dx` pixeli mută punctul focal cu `−dx / surplus`. Fără surplus pe o axă
 * (imaginea umple exact rama) punctul focal nu se mișcă pe acea axă.
 */
export function panFocus(
  framing: Framing,
  delta: { dx: number; dy: number },
  frame: { width: number; height: number },
  natural: { width: number; height: number },
): Framing {
  const { width: fw, height: fh } = frame;
  const { width: nw, height: nh } = natural;
  if (fw <= 0 || fh <= 0 || nw <= 0 || nh <= 0) return framing;
  const scale = Math.max(fw / nw, fh / nh);
  const spareX = nw * scale * framing.zoom - fw;
  const spareY = nh * scale * framing.zoom - fh;
  return {
    ...framing,
    x: spareX > 0.5 ? clamp(framing.x - delta.dx / spareX, 0, 1) : framing.x,
    y: spareY > 0.5 ? clamp(framing.y - delta.dy / spareY, 0, 1) : framing.y,
  };
}

export function isDefaultFraming(f: Framing): boolean {
  return f.x === COVER_FOCUS_DEFAULT && f.y === COVER_FOCUS_DEFAULT && f.zoom === COVER_ZOOM_MIN;
}

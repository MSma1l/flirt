/**
 * Încadrarea copertei unui eveniment, setată de admin în editorul de poster.
 *
 * Serverul trimite punctul focal (`cover_focus_x/y`, fracții 0..1 din imagine) și
 * zoom-ul (`cover_zoom`, 1..3). Le aplicăm pe un `<img object-fit: cover>`:
 *   - `object-position: x% y%` aliniază punctul focal al imaginii cu punctul
 *     (x%, y%) al ramei — așa funcționează procentele la `object-position`;
 *   - `transform: scale(z)` cu `transform-origin` în ACELAȘI punct mărește în
 *     jurul lui, deci punctul focal nu fuge din cadru la zoom.
 *
 * Aceeași formulă e folosită de previzualizarea din panoul de admin
 * (`admin/src/lib/coverFraming.ts`), iar proporțiile ramelor sunt identice
 * (`COVER_RATIO`) — ce vede adminul e ce vede utilizatorul. Echivalența (stil,
 * normalizare, proporțiile din `events.css`) e verificată de
 * `admin/src/lib/coverFraming.parity.test.ts`: schimbi aici → rulezi și testele
 * panoului.
 */
import type { CSSProperties } from 'react';

/** Proporțiile ramelor (lățime / înălțime). Oglindite în panoul de admin. */
export const COVER_RATIO = {
  /** Coperta cardului din listă. */
  card: 2,
  /** Posterul de pe pagina evenimentului. */
  hero: 4 / 3,
} as const;

export const COVER_FOCUS_DEFAULT = 0.5;
export const COVER_ZOOM_MIN = 1;
export const COVER_ZOOM_MAX = 3;

export interface CoverFraming {
  coverFocusX?: number | null;
  coverFocusY?: number | null;
  coverZoom?: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Valorile normalizate (lipsă / în afara intervalului → centru, zoom 1). */
export function normalizeFraming(f: CoverFraming): { x: number; y: number; zoom: number } {
  return {
    x: clamp(num(f.coverFocusX, COVER_FOCUS_DEFAULT), 0, 1),
    y: clamp(num(f.coverFocusY, COVER_FOCUS_DEFAULT), 0, 1),
    zoom: clamp(num(f.coverZoom, COVER_ZOOM_MIN), COVER_ZOOM_MIN, COVER_ZOOM_MAX),
  };
}

/** Stilul `<img>`-ului copertei: `object-position` + `scale` în punctul focal. */
export function coverImageStyle(f: CoverFraming): CSSProperties {
  const { x, y, zoom } = normalizeFraming(f);
  const position = `${round(x * 100)}% ${round(y * 100)}%`;
  return {
    objectPosition: position,
    transformOrigin: position,
    transform: zoom === 1 ? undefined : `scale(${round(zoom)})`,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

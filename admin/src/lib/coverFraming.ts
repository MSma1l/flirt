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

// ---------------------------------------------------------------------------
// Zona vizibilă, în fracții din IMAGINE — pentru selecția pe imaginea întreagă.
//
// Din formula CSS de mai sus rezultă direct ce dreptunghi al imaginii ajunge în
// ramă (verificat și în test, simulând la pixel `object-fit` + `object-position`
// + `scale`):
//   * la zoom 1, `object-fit: cover` păstrează o latură întreagă și taie din
//     cealaltă — mărimea „de bază" depinde doar de proporții (ramă vs imagine);
//   * zoom-ul `z` împarte mărimea la `z`;
//   * punctul focal stă la fracția (x, y) ÎN dreptunghi, deci
//     `left = x · (1 − lățime)`, `top = y · (1 − înălțime)`.
// Invers: dintr-un dreptunghi ales de admin, `x = left / (1 − lățime)`.
// ---------------------------------------------------------------------------

/** Dreptunghi în fracții din imagine (0..1 pe fiecare axă). */
export interface CoverRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Colțul de care e prins mânerul de redimensionare. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** Sub această rezervă (fracții) o axă e considerată „plină": x/y nu contează. */
const SPARE_EPS = 1e-6;

/** Mărimea zonei vizibile la zoom 1 (ce lasă `object-fit: cover`). */
export function coverBase(frameRatio: number, imageRatio: number): { width: number; height: number } {
  if (!(frameRatio > 0) || !(imageRatio > 0)) return { width: 1, height: 1 };
  return imageRatio > frameRatio
    ? { width: frameRatio / imageRatio, height: 1 }
    : { width: 1, height: imageRatio / frameRatio };
}

/** Partea din imagine care se vede într-o ramă cu proporția `frameRatio`. */
export function visibleRect(f: Partial<Framing>, frameRatio: number, imageRatio: number): CoverRect {
  const { x, y, zoom } = normalizeFraming(f);
  const base = coverBase(frameRatio, imageRatio);
  const width = base.width / zoom;
  const height = base.height / zoom;
  return { left: x * (1 - width), top: y * (1 - height), width, height };
}

/** Punctul focal care pune un dreptunghi de mărimea `size` la poziția `start`. */
function focusFor(current: number, start: number, size: number): number {
  const spare = 1 - size;
  return spare > SPARE_EPS ? clamp(start / spare, 0, 1) : current;
}

/**
 * Selecția mutată cu `(du, dv)` (fracții din imagine), oprită la margini.
 * Primește încadrarea de la ÎNCEPUTUL tragerii + deplasarea totală, ca
 * selecția să nu „alunece" când treci de margine și te întorci.
 */
export function moveSelection(
  framing: Framing,
  delta: { du: number; dv: number },
  frameRatio: number,
  imageRatio: number,
): Framing {
  const r = visibleRect(framing, frameRatio, imageRatio);
  return {
    ...framing,
    x: focusFor(framing.x, clamp(r.left + delta.du, 0, 1 - r.width), r.width),
    y: focusFor(framing.y, clamp(r.top + delta.dv, 0, 1 - r.height), r.height),
  };
}

/** Selecția centrată (cât se poate) în punctul `(u, v)` al imaginii. */
export function centerSelectionAt(
  framing: Framing,
  point: { u: number; v: number },
  frameRatio: number,
  imageRatio: number,
): Framing {
  const r = visibleRect(framing, frameRatio, imageRatio);
  return {
    ...framing,
    x: focusFor(framing.x, clamp(point.u - r.width / 2, 0, 1 - r.width), r.width),
    y: focusFor(framing.y, clamp(point.v - r.height / 2, 0, 1 - r.height), r.height),
  };
}

/**
 * Selecția redimensionată din colțul `corner`, cu colțul OPUS fix (luat din
 * încadrarea de la începutul tragerii). Proporția rămâne a ramei; mărimea e
 * cea mai mică ce ajunge la cursor, limitată de zoom-ul 1..3. Dacă nu mai
 * încape lângă ancoră, chenarul e împins înapoi în imagine.
 */
export function resizeSelection(
  framing: Framing,
  corner: Corner,
  pointer: { u: number; v: number },
  frameRatio: number,
  imageRatio: number,
): Framing {
  const base = coverBase(frameRatio, imageRatio);
  const r = visibleRect(framing, frameRatio, imageRatio);
  const west = corner === 'nw' || corner === 'sw';
  const north = corner === 'nw' || corner === 'ne';
  const anchorU = west ? r.left + r.width : r.left;
  const anchorV = north ? r.top + r.height : r.top;
  // Lățimea cerută de cursor pe fiecare axă (înălțimea trecută în lățime).
  // Cursorul NU e limitat la imagine: trăgând în afara ei ajungi la zoom 1, iar
  // chenarul e împins înapoi înăuntru de limitarea de mai jos.
  const wanted = Math.max(
    Math.abs(pointer.u - anchorU),
    (Math.abs(pointer.v - anchorV) * base.width) / base.height,
  );
  const zoom = wanted > 0 ? clamp(base.width / wanted, COVER_ZOOM_MIN, COVER_ZOOM_MAX) : COVER_ZOOM_MAX;
  const width = base.width / zoom;
  const height = base.height / zoom;
  const left = clamp(west ? anchorU - width : anchorU, 0, 1 - width);
  const top = clamp(north ? anchorV - height : anchorV, 0, 1 - height);
  return {
    x: focusFor(framing.x, left, width),
    y: focusFor(framing.y, top, height),
    zoom,
  };
}

/** Zoom-ul înmulțit cu `factor` (rotiță, pinch), în limitele 1..3. */
export function zoomBy(framing: Framing, factor: number): Framing {
  if (!Number.isFinite(factor) || factor <= 0) return framing;
  return { ...framing, zoom: clamp(framing.zoom * factor, COVER_ZOOM_MIN, COVER_ZOOM_MAX) };
}
